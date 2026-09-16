/**
 * Tests for the DB-first hybrid analytics reader: rollup-only coverage, and the
 * automatic raw-scan fallback + live-refresh flagging for days the rollup doesn't cover.
 *
 * Uses Node.js built-in test runner (node:test + node:assert), in-memory SQLite.
 * The raw-scan fallback path exercises the real plugin file scanner against a
 * non-existent/empty directory (no log files in this sandbox) — it must resolve to zero
 * entries without throwing, which is what we assert on: coverage flags and totals staying
 * consistent, not the (absent) scanned content itself.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

// Dynamic import: connection.ts resolves its DB path once at module-evaluation
// time, and static imports are hoisted ahead of the env assignment above — a
// dynamic import is the only way to guarantee the env var is read first.
const { initializeDatabase, closeDatabase } = await import('../../database/connection.js');
const { PluginConfigRepository } = await import('../../database/models/PluginConfig.js');
const { LogAnalyticsRollupService, aggregateEntries } = await import('../logAnalyticsRollupService.js');
const { getHybridAnalytics } = await import('../logAnalyticsHybridService.js');

function seedDay(date: string, pluginId: string, urls: { url: string; count: number }[]): void {
    const service = new LogAnalyticsRollupService() as unknown as {
        upsert: (date: string, pluginId: string, agg: ReturnType<typeof aggregateEntries>) => void;
    };
    const entries = urls.flatMap(({ url, count }) =>
        Array.from({ length: count }, (_, i) => ({ ip: `1.1.1.${i % 3}`, url, status: 200, size: 10 }))
    );
    service.upsert(date, pluginId, aggregateEntries(entries));
}

describe('getHybridAnalytics', () => {
    beforeEach(() => {
        closeDatabase();
        process.env.DATABASE_PATH = ':memory:';
        initializeDatabase();
        // resolveLogSourcePluginIds() only includes plugins explicitly enabled in plugin_configs.
        PluginConfigRepository.upsert({ pluginId: 'apache', enabled: true, settings: {} });
    });

    afterEach(() => {
        closeDatabase();
    });

    it('serves fully from the rollup when every requested day is covered, merging counts and top lists', async () => {
        seedDay('2026-09-10', 'apache', [{ url: '/a', count: 3 }, { url: '/b', count: 1 }]);
        seedDay('2026-09-11', 'apache', [{ url: '/a', count: 2 }]);

        const result = await getHybridAnalytics('apache', new Date('2026-09-10T00:00:00.000Z'), new Date('2026-09-11T00:00:00.000Z'));

        assert.equal(result.overview.totalRequests, 6);
        assert.equal(result.coverage.rollupDates.length, 2);
        assert.equal(result.coverage.scannedDates.length, 0);
        assert.equal(result.coverage.liveRefreshed, false);
        assert.equal(result.timeseries.length, 2);
        assert.equal(result.timeseries[0].label, '2026-09-10T00:00:00.000Z');
        assert.equal(result.timeseries[0].count, 4);
        assert.equal(result.top.urls[0].key, '/a');
        assert.equal(result.top.urls[0].count, 5); // 3 (day 1) + 2 (day 2), merged across days
    });

    it('falls back to a scan (empty, no real logs in this sandbox) for days the rollup does not cover, without throwing', async () => {
        seedDay('2026-09-11', 'apache', [{ url: '/a', count: 2 }]);

        const result = await getHybridAnalytics('apache', new Date('2026-09-01T00:00:00.000Z'), new Date('2026-09-11T00:00:00.000Z'));

        assert.equal(result.coverage.rollupDates.length, 1);
        assert.equal(result.coverage.rollupDates[0], '2026-09-11');
        assert.equal(result.coverage.scannedDates.length, 10); // 2026-09-01 .. 2026-09-10
        assert.equal(result.overview.totalRequests, 2); // only the rollup-covered day has data in this sandbox
    });

    it('flags liveRefreshed and re-scans today instead of trusting its rollup row when live=true', async () => {
        const todayLabel = new Date().toISOString().slice(0, 10);
        seedDay(todayLabel, 'apache', [{ url: '/stale', count: 99 }]);

        const result = await getHybridAnalytics('apache', new Date(`${todayLabel}T00:00:00.000Z`), new Date(`${todayLabel}T00:00:00.000Z`), { live: true });

        assert.equal(result.coverage.liveRefreshed, true);
        assert.deepEqual(result.coverage.scannedDates, [todayLabel]);
        assert.deepEqual(result.coverage.rollupDates, []);
        // The stale rollup row (99 hits) must not be used once live-refreshed — real scan finds nothing in this sandbox.
        assert.equal(result.overview.totalRequests, 0);
    });

    it('returns an empty-but-valid result when no log-source plugin is enabled/resolvable', async () => {
        const result = await getHybridAnalytics('not-a-real-plugin', new Date('2026-09-10T00:00:00.000Z'), new Date('2026-09-11T00:00:00.000Z'));

        assert.equal(result.overview.totalRequests, 0);
        assert.deepEqual(result.coverage, { rollupDates: [], scannedDates: [], liveRefreshed: false });
    });
});
