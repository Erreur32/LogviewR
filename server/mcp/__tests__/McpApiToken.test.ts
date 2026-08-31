/**
 * Tests for the MCP HTTP bearer token repository (create, hash, expiry, revocation, scope).
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
const { McpApiTokenRepository } = await import('../../database/models/McpApiToken.js');

describe('McpApiTokenRepository', () => {
    beforeEach(() => {
        closeDatabase();
        process.env.DATABASE_PATH = ':memory:';
        initializeDatabase();
    });

    afterEach(() => {
        closeDatabase();
    });

    it('creates a token with the lvr_mcp_ prefix, hashes it, and never stores the raw value', () => {
        const created = McpApiTokenRepository.create({ name: 'opencode-dev', scope: 'read', createdBy: 'admin' });

        assert.match(created.token, /^lvr_mcp_/);
        assert.equal(created.name, 'opencode-dev');
        assert.equal(created.scope, 'read');
        assert.equal(created.revokedAt, null);
        assert.equal(created.lastUsedAt, null);

        const row = getDatabase().prepare('SELECT token_hash FROM mcp_api_tokens WHERE id = ?').get(created.id) as any;
        assert.notEqual(row.token_hash, created.token);
        assert.equal(row.token_hash.length, 64); // sha256 hex digest
    });

    it('defaults expiry to 90 days and clamps a requested expiry to the 365-day maximum', () => {
        const nowSeconds = Math.floor(Date.now() / 1000);

        const defaultExpiry = McpApiTokenRepository.create({ name: 'default-expiry', scope: 'read', createdBy: 'admin' });
        const defaultDays = (defaultExpiry.expiresAt / 1000 - nowSeconds) / 86400;
        assert.ok(Math.abs(defaultDays - 90) < 1);

        const clamped = McpApiTokenRepository.create({
            name: 'too-long',
            scope: 'read',
            createdBy: 'admin',
            expiresInDays: 5000,
        });
        const clampedDays = (clamped.expiresAt / 1000 - nowSeconds) / 86400;
        assert.ok(Math.abs(clampedDays - 365) < 1);
    });

    it('verifyToken returns the identity for a valid token and updates last_used_at', () => {
        const created = McpApiTokenRepository.create({ name: 'verify-me', scope: 'read_write', createdBy: 'admin' });

        const verified = McpApiTokenRepository.verifyToken(created.token);
        assert.ok(verified);
        assert.equal(verified?.id, created.id);
        assert.equal(verified?.name, 'verify-me');
        assert.equal(verified?.scope, 'read_write');

        const row = getDatabase().prepare('SELECT last_used_at FROM mcp_api_tokens WHERE id = ?').get(created.id) as any;
        assert.ok(row.last_used_at !== null);
    });

    it('verifyToken rejects an unknown token', () => {
        assert.equal(McpApiTokenRepository.verifyToken('lvr_mcp_totally-made-up'), null);
    });

    it('verifyToken rejects a token missing the lvr_mcp_ prefix', () => {
        assert.equal(McpApiTokenRepository.verifyToken('not-even-close'), null);
        assert.equal(McpApiTokenRepository.verifyToken(''), null);
    });

    it('verifyToken rejects a revoked token', () => {
        const created = McpApiTokenRepository.create({ name: 'revoke-me', scope: 'read', createdBy: 'admin' });
        const revoked = McpApiTokenRepository.revoke(created.id);
        assert.equal(revoked, true);
        assert.equal(McpApiTokenRepository.verifyToken(created.token), null);
    });

    it('revoke is idempotent, returning false on a second call', () => {
        const created = McpApiTokenRepository.create({ name: 'revoke-twice', scope: 'read', createdBy: 'admin' });
        assert.equal(McpApiTokenRepository.revoke(created.id), true);
        assert.equal(McpApiTokenRepository.revoke(created.id), false);
    });

    it('verifyToken rejects an expired token', () => {
        const created = McpApiTokenRepository.create({ name: 'expire-me', scope: 'read', createdBy: 'admin', expiresInDays: 1 });
        getDatabase()
            .prepare(`UPDATE mcp_api_tokens SET expires_at = strftime('%s','now') - 3600 WHERE id = ?`)
            .run(created.id);

        assert.equal(McpApiTokenRepository.verifyToken(created.token), null);
    });

    it('list returns tokens newest first and revoke does not remove the row', () => {
        const first = McpApiTokenRepository.create({ name: 'first', scope: 'read', createdBy: 'admin' });
        const second = McpApiTokenRepository.create({ name: 'second', scope: 'read_write', createdBy: 'admin' });
        McpApiTokenRepository.revoke(first.id);

        const list = McpApiTokenRepository.list();
        assert.equal(list.length, 2);
        assert.equal(list[0].id, second.id);
        assert.ok(list.some((t) => t.id === first.id && t.revokedAt !== null));
    });
});
