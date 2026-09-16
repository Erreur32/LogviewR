/**
 * Log Analytics Rollup Service
 *
 * Periodically persists a daily summary (count/unique IPs/bytes/status groups) per
 * log-source plugin into `log_daily_stats`, so long-term stats stop depending on raw log
 * files still being present on disk (rotation/retention/multi-vhost file selection all
 * limit how far back `collectParsedEntries` can actually see).
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
    type ParsedAccessEntry
} from './logAnalyticsService.js';

const ROLLUP_INTERVAL_MS = 30 * 60_000;

export interface DailyStatsAggregate {
    count: number;
    uniqueIps: number;
    totalBytes: number;
    status2xx: number;
    status3xx: number;
    status4xx: number;
    status5xx: number;
    statusOther: number;
}

function dayBounds(daysAgo: number): { start: Date; end: Date; label: string } {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysAgo));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end, label: start.toISOString().slice(0, 10) };
}

export function aggregateEntries(entries: ParsedAccessEntry[]): DailyStatsAggregate {
    const agg: DailyStatsAggregate = {
        count: 0, uniqueIps: 0, totalBytes: 0,
        status2xx: 0, status3xx: 0, status4xx: 0, status5xx: 0, statusOther: 0
    };
    const ips = new Set<string>();

    for (const e of entries) {
        agg.count++;
        if (e.ip) ips.add(e.ip);
        if (typeof e.size === 'number') agg.totalBytes += e.size;

        const status = e.status;
        if (status === undefined) { agg.statusOther++; }
        else if (status >= 200 && status < 300) agg.status2xx++;
        else if (status >= 300 && status < 400) agg.status3xx++;
        else if (status >= 400 && status < 500) agg.status4xx++;
        else if (status >= 500 && status < 600) agg.status5xx++;
        else agg.statusOther++;
    }

    agg.uniqueIps = ips.size;
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
                (date, plugin_id, count, unique_ips, total_bytes, status_2xx, status_3xx, status_4xx, status_5xx, status_other, updated_at)
            VALUES (@date, @pluginId, @count, @uniqueIps, @totalBytes, @status2xx, @status3xx, @status4xx, @status5xx, @statusOther, strftime('%s','now'))
            ON CONFLICT(date, plugin_id) DO UPDATE SET
                count = excluded.count,
                unique_ips = excluded.unique_ips,
                total_bytes = excluded.total_bytes,
                status_2xx = excluded.status_2xx,
                status_3xx = excluded.status_3xx,
                status_4xx = excluded.status_4xx,
                status_5xx = excluded.status_5xx,
                status_other = excluded.status_other,
                updated_at = excluded.updated_at
        `).run({ date, pluginId, ...agg });
    }

    /** Read rollup rows for a plugin filter (or all plugins) over an inclusive date range. */
    static getDailyStats(pluginId: string | undefined, fromDate: string, toDate: string): {
        date: string; pluginId: string; count: number; uniqueIps: number; totalBytes: number;
        status2xx: number; status3xx: number; status4xx: number; status5xx: number; statusOther: number;
    }[] {
        const db = getDatabase();
        const rows = (
            pluginId && pluginId !== 'all'
                ? db.prepare(`
                    SELECT date, plugin_id, count, unique_ips, total_bytes, status_2xx, status_3xx, status_4xx, status_5xx, status_other
                    FROM log_daily_stats WHERE plugin_id = ? AND date >= ? AND date <= ? ORDER BY date ASC
                `).all(pluginId, fromDate, toDate)
                : db.prepare(`
                    SELECT date, plugin_id, count, unique_ips, total_bytes, status_2xx, status_3xx, status_4xx, status_5xx, status_other
                    FROM log_daily_stats WHERE date >= ? AND date <= ? ORDER BY date ASC
                `).all(fromDate, toDate)
        ) as {
            date: string; plugin_id: string; count: number; unique_ips: number; total_bytes: number;
            status_2xx: number; status_3xx: number; status_4xx: number; status_5xx: number; status_other: number;
        }[];

        return rows.map((r) => ({
            date: r.date, pluginId: r.plugin_id, count: r.count, uniqueIps: r.unique_ips, totalBytes: r.total_bytes,
            status2xx: r.status_2xx, status3xx: r.status_3xx, status4xx: r.status_4xx, status5xx: r.status_5xx, statusOther: r.status_other
        }));
    }
}

export const logAnalyticsRollupService = new LogAnalyticsRollupService();
