/**
 * Tests for the log-analytics daily rollup: pure aggregation math, and the
 * upsert/read path against the `log_daily_stats` table.
 *
 * Uses Node.js built-in test runner (node:test + node:assert), in-memory SQLite.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

// Dynamic import: connection.ts resolves its DB path once at module-evaluation
// time, and static imports are hoisted ahead of the env assignment above — a
// dynamic import is the only way to guarantee the env var is read first.
const { initializeDatabase, closeDatabase, getDatabase } = await import('../../database/connection.js');
const { aggregateEntries, LogAnalyticsRollupService } = await import('../logAnalyticsRollupService.js');

describe('aggregateEntries', () => {
    it('buckets statuses, dedupes IPs, and sums bytes', () => {
        const agg = aggregateEntries([
            { ip: '1.1.1.1', status: 200, size: 100 },
            { ip: '1.1.1.1', status: 201, size: 50 },
            { ip: '2.2.2.2', status: 301, size: 10 },
            { ip: '2.2.2.2', status: 404, size: 0 },
            { ip: '3.3.3.3', status: 500, size: 20 },
            { ip: '4.4.4.4', status: 999, size: 5 },
            { status: undefined }
        ]);

        assert.equal(agg.count, 7);
        assert.equal(agg.uniqueIps, 4);
        assert.equal(agg.totalBytes, 185);
        assert.equal(agg.status2xx, 2);
        assert.equal(agg.status3xx, 1);
        assert.equal(agg.status4xx, 1);
        assert.equal(agg.status5xx, 1);
        assert.equal(agg.statusOther, 2); // status 999 (out of range) + missing status
    });

    it('returns all zeros for an empty entry list', () => {
        const agg = aggregateEntries([]);
        assert.equal(agg.count, 0);
        assert.equal(agg.uniqueIps, 0);
        assert.equal(agg.totalBytes, 0);
        assert.deepEqual(agg.topUrls, []);
    });

    it('computes top URLs/IPs/referers/user-agents, most frequent first', () => {
        const agg = aggregateEntries([
            { ip: '1.1.1.1', url: '/a', referer: 'https://ref-a.com', userAgent: 'curl/8.0', status: 200 },
            { ip: '1.1.1.1', url: '/a', referer: 'https://ref-a.com', userAgent: 'curl/8.0', status: 200 },
            { ip: '2.2.2.2', url: '/b', referer: 'https://ref-b.com', userAgent: 'Mozilla/5.0', status: 200 }
        ]);

        assert.deepEqual(agg.topUrls[0], { key: '/a', count: 2, percent: 67 });
        assert.deepEqual(agg.topIps[0], { key: '1.1.1.1', count: 2, percent: 67 });
        assert.deepEqual(agg.topReferers[0], { key: 'https://ref-a.com', count: 2, percent: 67 });
        assert.deepEqual(agg.topUserAgents[0], { key: 'curl/8.0', count: 2, percent: 67 });
    });
});

describe('LogAnalyticsRollupService upsert + getDailyStats', () => {
    beforeEach(() => {
        closeDatabase();
        process.env.DATABASE_PATH = ':memory:';
        initializeDatabase();
    });

    afterEach(() => {
        closeDatabase();
    });

    it('upserts idempotently: a second write for the same (date, plugin) replaces the row instead of duplicating it', () => {
        const service = new LogAnalyticsRollupService() as unknown as {
            upsert: (date: string, pluginId: string, agg: ReturnType<typeof aggregateEntries>) => void;
        };

        service.upsert('2026-09-16', 'apache', aggregateEntries([{ ip: '1.1.1.1', status: 200, size: 10 }]));
        service.upsert('2026-09-16', 'apache', aggregateEntries([
            { ip: '1.1.1.1', status: 200, size: 10 },
            { ip: '2.2.2.2', status: 404, size: 20 }
        ]));

        const rows = getDatabase().prepare('SELECT * FROM log_daily_stats WHERE date = ? AND plugin_id = ?')
            .all('2026-09-16', 'apache') as { count: number; unique_ips: number; total_bytes: number }[];

        assert.equal(rows.length, 1);
        assert.equal(rows[0].count, 2);
        assert.equal(rows[0].unique_ips, 2);
        assert.equal(rows[0].total_bytes, 30);
    });

    it('getDailyStats filters by plugin and date range', () => {
        const service = new LogAnalyticsRollupService() as unknown as {
            upsert: (date: string, pluginId: string, agg: ReturnType<typeof aggregateEntries>) => void;
        };

        service.upsert('2026-09-14', 'apache', aggregateEntries([{ ip: '1.1.1.1', status: 200, size: 1 }]));
        service.upsert('2026-09-15', 'apache', aggregateEntries([{ ip: '1.1.1.1', status: 200, size: 1 }]));
        service.upsert('2026-09-15', 'npm', aggregateEntries([{ ip: '1.1.1.1', status: 200, size: 1 }]));

        const apacheOnly = LogAnalyticsRollupService.getDailyStats('apache', '2026-09-15', '2026-09-16');
        assert.equal(apacheOnly.length, 1);
        assert.equal(apacheOnly[0].pluginId, 'apache');
        assert.equal(apacheOnly[0].date, '2026-09-15');

        const allPlugins = LogAnalyticsRollupService.getDailyStats(undefined, '2026-09-15', '2026-09-16');
        assert.equal(allPlugins.length, 2);
    });

    it('round-trips top-N JSON columns through upsert and getDailyStats', () => {
        const service = new LogAnalyticsRollupService() as unknown as {
            upsert: (date: string, pluginId: string, agg: ReturnType<typeof aggregateEntries>) => void;
        };

        service.upsert('2026-09-16', 'apache', aggregateEntries([
            { ip: '1.1.1.1', url: '/a', status: 200 },
            { ip: '1.1.1.1', url: '/a', status: 200 },
            { ip: '2.2.2.2', url: '/b', status: 200 }
        ]));

        const [row] = LogAnalyticsRollupService.getDailyStats('apache', '2026-09-16', '2026-09-16');
        assert.deepEqual(row.topUrls, [{ key: '/a', count: 2, percent: 67 }, { key: '/b', count: 1, percent: 33 }]);
        assert.deepEqual(row.topIps, [{ key: '1.1.1.1', count: 2, percent: 67 }, { key: '2.2.2.2', count: 1, percent: 33 }]);
    });
});
