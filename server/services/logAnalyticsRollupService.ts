/**
 * Log Analytics Rollup Service
 *
 * Periodically persists a daily summary (count/unique IPs/bytes/status groups, plus
 * top-20 URLs/IPs/referers/user-agents) per log-source plugin into `log_daily_stats`, so
 * long-term stats stop depending on raw log files still being present on disk
 * (rotation/retention/multi-vhost file selection all limit how far back
 * `collectParsedEntries` can actually see).
 *
 * No retroactive backfill: rotated logs have already destroyed most of that history, which
 * is exactly the problem this table exists to stop from recurring for future days.
 *
 * Runs every ROLLUP_INTERVAL_MS. Each cycle recomputes "today" and "yesterday" only —
 * today because it's still accumulating, yesterday to absorb log lines written right around
 * midnight that a run a few minutes earlier could have missed. Older days are left untouched
 * once written.
 */

import { getDatabase } from '../database/connection.js';
import { logger } from '../utils/logger.js';
import {
    LOG_SOURCE_PLUGINS,
    collectParsedEntries,
    computeTop,
    isStaticFileUrl,
    type ParsedAccessEntry,
    type AnalyticsTopItem
} from './logAnalyticsService.js';

const ROLLUP_INTERVAL_MS = 15 * 60_000;
const TOP_N = 20;

export interface DailyStatsAggregate {
    count: number;
    uniqueIps: number;
    totalBytes: number;
    /** All 4xx, including 404 (matches AnalyticsStatusGroups.s4xx semantics). */
    status4xx: number;
    /** Subset of status4xx: requests that returned exactly 404. */
    status404: number;
    status2xx: number;
    status3xx: number;
    status5xx: number;
    statusOther: number;
    staticFiles: number;
    topUrls: AnalyticsTopItem[];
    topIps: AnalyticsTopItem[];
    topReferers: AnalyticsTopItem[];
    topUserAgents: AnalyticsTopItem[];
}

export interface DailyStatsRow extends DailyStatsAggregate {
    date: string;
    pluginId: string;
}

function dayBounds(daysAgo: number): { start: Date; end: Date; label: string } {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end, label: start.toISOString().slice(0, 10) };
}

type StatusBucket = 'status2xx' | 'status3xx' | 'status4xx' | 'status5xx' | 'statusOther';

function statusBucket(status: number | undefined): StatusBucket {
    if (status === undefined) return 'statusOther';
    if (status >= 200 && status < 300) return 'status2xx';
    if (status >= 300 && status < 400) return 'status3xx';
    if (status >= 400 && status < 500) return 'status4xx';
    if (status >= 500 && status < 600) return 'status5xx';
    return 'statusOther';
}

export function aggregateEntries(entries: ParsedAccessEntry[]): DailyStatsAggregate {
    const agg: DailyStatsAggregate = {
        count: 0, uniqueIps: 0, totalBytes: 0,
        status2xx: 0, status3xx: 0, status4xx: 0, status404: 0, status5xx: 0, statusOther: 0,
        staticFiles: 0,
        topUrls: [], topIps: [], topReferers: [], topUserAgents: []
    };
    const ips = new Set<string>();

    for (const e of entries) {
        agg.count++;
        if (e.ip) ips.add(e.ip);
        if (typeof e.size === 'number') agg.totalBytes += e.size;
        if (isStaticFileUrl(e.url)) agg.staticFiles++;

        const bucket = statusBucket(e.status);
        agg[bucket]++;
        if (bucket === 'status4xx' && e.status === 404) agg.status404++;
    }

    agg.uniqueIps = ips.size;
    agg.topUrls = computeTop(entries, 'urls', TOP_N);
    agg.topIps = computeTop(entries, 'ips', TOP_N);
    agg.topReferers = computeTop(entries, 'referrer', TOP_N);
    agg.topUserAgents = computeTop(entries, 'ua', TOP_N);
    return agg;
}

export class LogAnalyticsRollupService {
    private timer: ReturnType<typeof setInterval> | null = null;
    private running = false;

    start(): void {
        if (this.timer) return;
        setTimeout(() => this.sync(), 10_000);
        this.timer = setInterval(() => this.sync(), ROLLUP_INTERVAL_MS);
    }

    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    async sync(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            for (const pluginId of LOG_SOURCE_PLUGINS) {
                await this.rollupDay(pluginId, 0); // today
                await this.rollupDay(pluginId, 1); // yesterday
            }
        } catch (e) {
            logger.error('LogAnalyticsRollup', `Sync failed: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            this.running = false;
        }
    }

    private async rollupDay(pluginId: string, daysAgo: number): Promise<void> {
        const { start, end, label } = dayBounds(daysAgo);
        try {
            const { entries } = await collectParsedEntries([pluginId], start, end, {
                fileScope: 'all',
                includeCompressed: true
            });
            const agg = aggregateEntries(entries);
            this.upsert(label, pluginId, agg);
        } catch (e) {
            logger.warn('LogAnalyticsRollup', `Rollup failed for ${pluginId} on ${label}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    private upsert(date: string, pluginId: string, agg: DailyStatsAggregate): void {
        getDatabase().prepare(`
            INSERT INTO log_daily_stats
                (date, plugin_id, count, unique_ips, total_bytes, status_2xx, status_3xx, status_4xx, status_404, status_5xx, status_other,
                 static_files, top_urls, top_ips, top_referers, top_user_agents, updated_at)
            VALUES (@date, @pluginId, @count, @uniqueIps, @totalBytes, @status2xx, @status3xx, @status4xx, @status404, @status5xx, @statusOther,
                 @staticFiles, @topUrls, @topIps, @topReferers, @topUserAgents, strftime('%s','now'))
            ON CONFLICT(date, plugin_id) DO UPDATE SET
                count = excluded.count,
                unique_ips = excluded.unique_ips,
                total_bytes = excluded.total_bytes,
                status_2xx = excluded.status_2xx,
                status_3xx = excluded.status_3xx,
                status_4xx = excluded.status_4xx,
                status_404 = excluded.status_404,
                status_5xx = excluded.status_5xx,
                status_other = excluded.status_other,
                static_files = excluded.static_files,
                top_urls = excluded.top_urls,
                top_ips = excluded.top_ips,
                top_referers = excluded.top_referers,
                top_user_agents = excluded.top_user_agents,
                updated_at = excluded.updated_at
        `).run({
            date, pluginId,
            count: agg.count, uniqueIps: agg.uniqueIps, totalBytes: agg.totalBytes,
            status2xx: agg.status2xx, status3xx: agg.status3xx, status4xx: agg.status4xx, status404: agg.status404,
            status5xx: agg.status5xx, statusOther: agg.statusOther, staticFiles: agg.staticFiles,
            topUrls: JSON.stringify(agg.topUrls), topIps: JSON.stringify(agg.topIps),
            topReferers: JSON.stringify(agg.topReferers), topUserAgents: JSON.stringify(agg.topUserAgents)
        });
    }

    /** Read rollup rows for a plugin filter (or all plugins) over an inclusive date range. */
    static getDailyStats(pluginId: string | undefined, fromDate: string, toDate: string): DailyStatsRow[] {
        const db = getDatabase();
        const rows = (
            pluginId && pluginId !== 'all'
                ? db.prepare(`
                    SELECT date, plugin_id, count, unique_ips, total_bytes, status_2xx, status_3xx, status_4xx, status_404, status_5xx, status_other,
                           static_files, top_urls, top_ips, top_referers, top_user_agents
                    FROM log_daily_stats WHERE plugin_id = ? AND date >= ? AND date <= ? ORDER BY date ASC
                `).all(pluginId, fromDate, toDate)
                : db.prepare(`
                    SELECT date, plugin_id, count, unique_ips, total_bytes, status_2xx, status_3xx, status_4xx, status_404, status_5xx, status_other,
                           static_files, top_urls, top_ips, top_referers, top_user_agents
                    FROM log_daily_stats WHERE date >= ? AND date <= ? ORDER BY date ASC
                `).all(fromDate, toDate)
        ) as {
            date: string; plugin_id: string; count: number; unique_ips: number; total_bytes: number;
            status_2xx: number; status_3xx: number; status_4xx: number; status_404: number; status_5xx: number; status_other: number;
            static_files: number; top_urls: string; top_ips: string; top_referers: string; top_user_agents: string;
        }[];

        const parseTop = (json: string): AnalyticsTopItem[] => {
            try {
                const parsed = JSON.parse(json);
                return Array.isArray(parsed) ? parsed as AnalyticsTopItem[] : [];
            } catch { return []; }
        };

        return rows.map((r) => ({
            date: r.date, pluginId: r.plugin_id, count: r.count, uniqueIps: r.unique_ips, totalBytes: r.total_bytes,
            status2xx: r.status_2xx, status3xx: r.status_3xx, status4xx: r.status_4xx, status404: r.status_404,
            status5xx: r.status_5xx, statusOther: r.status_other, staticFiles: r.static_files,
            topUrls: parseTop(r.top_urls), topIps: parseTop(r.top_ips),
            topReferers: parseTop(r.top_referers), topUserAgents: parseTop(r.top_user_agents)
        }));
    }
}

export const logAnalyticsRollupService = new LogAnalyticsRollupService();
