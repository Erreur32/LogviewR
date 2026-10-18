/**
 * Tests for the log_list_files MCP tool: size sort, limit, minSizeBytes filter,
 * unknown plugin, merge across active plugins.
 *
 * Uses Node.js built-in test runner, in-memory SQLite, stubbed plugins (no fs access).
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

// Dynamic import: connection.ts reads DATABASE_PATH at module-evaluation time.
const { initializeDatabase, closeDatabase } = await import('../../database/connection.js');
const { pluginManager } = await import('../../services/pluginManager.js');
const { listLogFiles } = await import('../tools/logFileTools.js');

function fakePlugin(id: string, enabled: boolean, files: Array<{ path: string; size: number }>) {
    return {
        getId: () => id,
        isEnabled: () => enabled,
        getDefaultBasePath: () => '/fake',
        getDefaultFilePatterns: () => ['*.log'],
        scanLogFiles: async () => files.map((f) => ({ ...f, type: 'access', modified: new Date('2026-01-02T03:04:05Z') })),
    };
}

describe('listLogFiles', () => {
    const plugins = new Map<string, ReturnType<typeof fakePlugin>>();

    beforeEach(() => {
        closeDatabase();
        process.env.DATABASE_PATH = ':memory:';
        initializeDatabase();
        plugins.clear();
        plugins.set('nginx', fakePlugin('nginx', true, [
            { path: '/n/small.log', size: 10 },
            { path: '/n/big.log', size: 5000 },
            { path: '/n/old.log.gz', size: 99999 },
        ]));
        plugins.set('apache', fakePlugin('apache', true, [{ path: '/a/mid.log', size: 300 }]));
        plugins.set('off', fakePlugin('off', false, [{ path: '/o/never.log', size: 1 }]));
        mock.method(pluginManager, 'getPlugin', (id: string) => plugins.get(id));
        mock.method(pluginManager, 'getAllPlugins', () => [...plugins.values()]);
    });

    afterEach(() => {
        mock.restoreAll();
        closeDatabase();
    });

    it('sorts by size descending and merges active plugins only', async () => {
        const result = await listLogFiles({});
        assert.ok(result.ok);
        assert.deepEqual(result.files.map((f) => f.path), ['/n/big.log', '/a/mid.log', '/n/small.log']);
        assert.deepEqual(result.files[0], {
            pluginId: 'nginx', path: '/n/big.log', type: 'access', size: 5000, modified: '2026-01-02T03:04:05.000Z',
        });
    });

    it('restricts to one plugin when pluginId is given', async () => {
        const result = await listLogFiles({ pluginId: 'apache' });
        assert.ok(result.ok);
        assert.deepEqual(result.files.map((f) => f.path), ['/a/mid.log']);
    });

    it('applies limit and caps it at 100', async () => {
        const limited = await listLogFiles({ limit: 2 });
        assert.equal(limited.ok && limited.files.length, 2);

        plugins.set('many', fakePlugin('many', true, Array.from({ length: 150 }, (_, i) => ({ path: `/m/${i}.log`, size: i }))));
        const capped = await listLogFiles({ pluginId: 'many', limit: 1000 });
        assert.equal(capped.ok && capped.files.length, 100);
    });

    it('defaults to 20 results', async () => {
        plugins.set('many', fakePlugin('many', true, Array.from({ length: 50 }, (_, i) => ({ path: `/m/${i}.log`, size: i }))));
        const result = await listLogFiles({ pluginId: 'many' });
        assert.equal(result.ok && result.files.length, 20);
    });

    it('filters on minSizeBytes (inclusive)', async () => {
        const result = await listLogFiles({ minSizeBytes: 300 });
        assert.ok(result.ok);
        assert.deepEqual(result.files.map((f) => f.path), ['/n/big.log', '/a/mid.log']);
    });

    it('returns an error for an unknown plugin', async () => {
        const result = await listLogFiles({ pluginId: 'nope' });
        assert.deepEqual(result, { ok: false, error: 'Unknown plugin: nope' });
    });
});
