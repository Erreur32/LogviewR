/**
 * Hybrid analytics reader for /log-analytics: DB-first from `log_daily_stats`, with an
 * automatic raw-log-scan fallback for any requested day the rollup doesn't cover yet
 * (dates older than when the rollup started), plus an optional "live" scan that refreshes
 * today's numbers beyond the rollup's own cadence (ROLLUP_INTERVAL_MS in
 * logAnalyticsRollupService.ts).
 *
 * Only covers what the daily rollup actually stores: KPI overview, one bucket-per-day
 * timeseries, and the 4 stored top-N categories (urls/ips/referrer/ua). Widgets that need
 * full per-line detail (methods & codes by domain, bot detection, response time, top-N with
 * per-item visitor counts) still go through `getAllAnalytics()`'s raw-scan path — this is
 * intentionally a smaller result shape, not a drop-in replacement for `AnalyticsResult`.
 */

import {
    resolveLogSourcePluginIds,
    collectParsedEntries,
    computeOverview,
    computeTimeseries,
    computeTop,
    type AnalyticsOverview,
    type AnalyticsTimeseriesBucket,
    type AnalyticsTopItem
} from './logAnalyticsService.js';
import { LogAnalyticsRollupService, type DailyStatsRow } from './logAnalyticsRollupService.js';

const TOP_LIMIT_DEFAULT = 20;

export interface HybridAnalyticsResult {
    overview: AnalyticsOverview;
    timeseries: AnalyticsTimeseriesBucket[];
    top: {
        urls: AnalyticsTopItem[];
        ips: AnalyticsTopItem[];
        referrer: AnalyticsTopItem[];
        ua: AnalyticsTopItem[];
    };
    coverage: {
        /** Days served from log_daily_stats. */
        rollupDates: string[];
        /** Days served by a raw-log scan (pre-rollup gap, and/or today when live=true). */
        scannedDates: string[];
        /** True when `options.live` caused today to be re-scanned instead of read from the rollup. */
        liveRefreshed: boolean;
    };
}

function toDayLabel(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** Inclusive list of UTC day labels (YYYY-MM-DD) between fromDate and toDate. */
function enumerateDays(fromDate: Date, toDate: Date): string[] {
    const days: string[] = [];
    const cursor = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate()));
    const end = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate()));
    while (cursor <= end) {
        days.push(toDayLabel(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
}

/** Groups a sorted-or-unsorted list of day labels into contiguous [start, end] ranges. */
function groupConsecutiveDays(days: string[]): { start: string; end: string }[] {
    if (days.length === 0) return [];
    const sorted = [...days].sort();
    const ranges: { start: string; end: string }[] = [];
    let rangeStart = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
        const day = sorted[i];
        const expectedNext = new Date(`${prev}T00:00:00.000Z`);
        expectedNext.setUTCDate(expectedNext.getUTCDate() + 1);
        if (day === toDayLabel(expectedNext)) { prev = day; continue; }
        ranges.push({ start: rangeStart, end: prev });
        rangeStart = day;
        prev = day;
    }
    ranges.push({ start: rangeStart, end: prev });
    return ranges;
}

/** Sums an AnalyticsTopItem[] into a running key -> count map (percent is dropped, recomputed once at the end). */
function accumulateTop(target: Map<string, number>, items: AnalyticsTopItem[]): void {
    for (const item of items) {
        target.set(item.key, (target.get(item.key) ?? 0) + item.count);
    }
}

function finalizeTop(counts: Map<string, number>, total: number, limit: number): AnalyticsTopItem[] {
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => ({ key, count, percent: total > 0 ? Math.round((count / total) * 100) : 0 }));
}

function emptyOverview(): AnalyticsOverview {
    return { totalRequests: 0, uniqueIps: 0, status4xx: 0, status5xx: 0, totalBytes: 0, filesAnalyzed: 0 };
}

/**
 * DB-first analytics for a plugin/date-range: reads whatever `log_daily_stats` already
 * covers, and only falls back to a raw log scan for the days it doesn't (older than the
 * rollup's start, and/or today when `options.live` is set).
 */
export async function getHybridAnalytics(
    pluginId: string | undefined,
    fromDate: Date,
    toDate: Date,
    options?: { live?: boolean; topLimit?: number }
): Promise<HybridAnalyticsResult> {
    const pluginIds = resolveLogSourcePluginIds(pluginId);
    const topLimit = Math.min(options?.topLimit ?? TOP_LIMIT_DEFAULT, 50);
    const requestedDays = enumerateDays(fromDate, toDate);
    const todayLabel = toDayLabel(new Date());
    const liveRefreshed = Boolean(options?.live) && requestedDays.includes(todayLabel);

    if (pluginIds.length === 0 || requestedDays.length === 0) {
        return {
            overview: emptyOverview(),
            timeseries: [],
            top: { urls: [], ips: [], referrer: [], ua: [] },
            coverage: { rollupDates: [], scannedDates: [], liveRefreshed: false }
        };
    }

    const rows = LogAnalyticsRollupService.getDailyStats(pluginId, requestedDays[0], requestedDays[requestedDays.length - 1]);
    const rowsByDate = new Map<string, DailyStatsRow[]>();
    for (const row of rows) {
        const arr = rowsByDate.get(row.date);
        if (arr) arr.push(row); else rowsByDate.set(row.date, [row]);
    }

    const rollupDates = requestedDays.filter((d) => d !== todayLabel || !liveRefreshed)
        .filter((d) => (rowsByDate.get(d)?.length ?? 0) === pluginIds.length);
    const scannedDates = requestedDays.filter((d) => !rollupDates.includes(d));

    // --- Accumulators, seeded from the rollup-covered days ---
    let totalRequests = 0, uniqueIps = 0, totalBytes = 0;
    let validRequests = 0, status4xxExcl404 = 0, status5xx = 0, notFound = 0, staticFiles = 0, filesAnalyzed = 0;
    const dayBuckets = new Map<string, AnalyticsTimeseriesBucket>();
    const topUrlsCounts = new Map<string, number>();
    const topIpsCounts = new Map<string, number>();
    const topReferrerCounts = new Map<string, number>();
    const topUaCounts = new Map<string, number>();

    for (const date of rollupDates) {
        for (const row of rowsByDate.get(date) ?? []) {
            totalRequests += row.count;
            uniqueIps += row.uniqueIps; // Approximate: sum of daily uniques, not a true cross-day distinct count.
            totalBytes += row.totalBytes;
            validRequests += row.status2xx;
            status4xxExcl404 += row.status4xx - row.status404;
            status5xx += row.status5xx;
            notFound += row.status404;
            staticFiles += row.staticFiles;
            accumulateTop(topUrlsCounts, row.topUrls);
            accumulateTop(topIpsCounts, row.topIps);
            accumulateTop(topReferrerCounts, row.topReferers);
            accumulateTop(topUaCounts, row.topUserAgents);
        }
        // Multiple plugins for the same date (pluginId='all') collapse into one daily bucket.
        const label = `${date}T00:00:00.000Z`;
        const existing = dayBuckets.get(label);
        const dayRows = rowsByDate.get(date) ?? [];
        const merged: AnalyticsTimeseriesBucket = {
            label,
            count: (existing?.count ?? 0) + dayRows.reduce((s, r) => s + r.count, 0),
            uniqueVisitors: (existing?.uniqueVisitors ?? 0) + dayRows.reduce((s, r) => s + r.uniqueIps, 0),
            statusGroups: {
                s2xx: (existing?.statusGroups?.s2xx ?? 0) + dayRows.reduce((s, r) => s + r.status2xx, 0),
                s3xx: (existing?.statusGroups?.s3xx ?? 0) + dayRows.reduce((s, r) => s + r.status3xx, 0),
                s4xx: (existing?.statusGroups?.s4xx ?? 0) + dayRows.reduce((s, r) => s + r.status4xx, 0),
                s5xx: (existing?.statusGroups?.s5xx ?? 0) + dayRows.reduce((s, r) => s + r.status5xx, 0)
            },
            totalBytes: (existing?.totalBytes ?? 0) + dayRows.reduce((s, r) => s + r.totalBytes, 0)
        };
        dayBuckets.set(label, merged);
    }

    // --- Raw-scan fallback for whatever the rollup doesn't cover, one scan per contiguous range ---
    for (const range of groupConsecutiveDays(scannedDates)) {
        const rangeStart = new Date(`${range.start}T00:00:00.000Z`);
        const rangeEnd = new Date(`${range.end}T00:00:00.000Z`);
        rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);

        const { entries, filesAnalyzed: filesInRange } = await collectParsedEntries(pluginIds, rangeStart, rangeEnd, {
            fileScope: 'all',
            includeCompressed: true
        });

        const partOverview = computeOverview(entries, filesInRange);
        totalRequests += partOverview.totalRequests;
        uniqueIps += partOverview.uniqueIps;
        totalBytes += partOverview.totalBytes;
        validRequests += partOverview.validRequests ?? 0;
        status4xxExcl404 += partOverview.status4xx;
        status5xx += partOverview.status5xx;
        notFound += partOverview.notFound ?? 0;
        staticFiles += partOverview.staticFiles ?? 0;
        filesAnalyzed += filesInRange;

        for (const bucket of computeTimeseries(entries, 'day')) {
            dayBuckets.set(bucket.label, bucket);
        }
        accumulateTop(topUrlsCounts, computeTop(entries, 'urls', topLimit));
        accumulateTop(topIpsCounts, computeTop(entries, 'ips', topLimit));
        accumulateTop(topReferrerCounts, computeTop(entries, 'referrer', topLimit));
        accumulateTop(topUaCounts, computeTop(entries, 'ua', topLimit));
    }

    const overview: AnalyticsOverview = {
        totalRequests,
        uniqueIps,
        status4xx: status4xxExcl404,
        status5xx,
        totalBytes,
        filesAnalyzed,
        dateFrom: fromDate.toISOString(),
        dateTo: toDate.toISOString(),
        validRequests,
        failedRequests: status4xxExcl404 + status5xx,
        notFound,
        staticFiles
    };

    return {
        overview,
        timeseries: Array.from(dayBuckets.values()).sort((a, b) => a.label.localeCompare(b.label)),
        top: {
            // Merging per-day top-20 lists is an approximation: an item that never ranked in
            // any single day's top 20 but has a high cumulative count over the range can be
            // under-represented or missing. Acceptable tradeoff for an instant DB-first read.
            urls: finalizeTop(topUrlsCounts, totalRequests, topLimit),
            ips: finalizeTop(topIpsCounts, totalRequests, topLimit),
            referrer: finalizeTop(topReferrerCounts, totalRequests, topLimit),
            ua: finalizeTop(topUaCounts, totalRequests, topLimit)
        },
        coverage: { rollupDates, scannedDates, liveRefreshed }
    };
}
