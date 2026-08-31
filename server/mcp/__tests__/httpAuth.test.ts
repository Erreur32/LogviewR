/**
 * Tests for the requireMcpToken middleware (mcp_enabled/mcp_http_enabled gate,
 * IP allowlist, bearer token validity) used by the remote HTTP MCP transport.
 *
 * Uses Node.js built-in test runner (node:test + node:assert), in-memory SQLite.
 * Express req/res are hand-rolled fakes, no supertest/express app needed since
 * requireMcpToken is a plain (req, res, next) middleware function.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

// Dynamic import: connection.ts resolves its DB path once at module-evaluation
// time, and static imports are hoisted ahead of the env assignment above — a
// dynamic import is the only way to guarantee the env var is read first.
const { initializeDatabase, closeDatabase } = await import('../../database/connection.js');
const { McpApiTokenRepository } = await import('../../database/models/McpApiToken.js');
const { setMcpEnabled, setMcpHttpEnabled, setMcpHttpAllowedIps } = await import('../mcpConfig.js');
const { requireMcpToken } = await import('../httpAuth.js');
const { getMcpContext } = await import('../requestContext.js');

function fakeReq(
    overrides: { ip?: string; remoteAddress?: string; xForwardedFor?: string; authorization?: string } = {}
) {
    const headers: Record<string, string> = {};
    if (overrides.authorization) headers.authorization = overrides.authorization;
    if (overrides.xForwardedFor) headers['x-forwarded-for'] = overrides.xForwardedFor;
    return {
        ip: overrides.ip ?? '127.0.0.1',
        socket: { remoteAddress: overrides.remoteAddress ?? overrides.ip ?? '127.0.0.1' },
        headers,
    } as any;
}

function fakeRes() {
    const res: any = {
        statusCode: null,
        body: null,
        status(code: number) {
            res.statusCode = code;
            return res;
        },
        json(payload: unknown) {
            res.body = payload;
            return res;
        },
    };
    return res;
}

describe('requireMcpToken', () => {
    beforeEach(() => {
        closeDatabase();
        process.env.DATABASE_PATH = ':memory:';
        initializeDatabase();
        // Both mcp_enabled and mcp_http_enabled are opt-in (off by default) — most
        // tests exercise the token/IP checks, so enable both explicitly up front.
        setMcpEnabled(true);
        setMcpHttpEnabled(true);
        setMcpHttpAllowedIps([]);
        delete process.env.MCP_HTTP_ALLOWED_IPS;
    });

    afterEach(() => {
        closeDatabase();
        delete process.env.MCP_HTTP_ALLOWED_IPS;
    });

    it('rejects with -32001 when mcp_enabled is off', async () => {
        setMcpEnabled(false);
        const req = fakeReq({ authorization: 'Bearer whatever' });
        const res = fakeRes();
        let nextCalled = false;

        await requireMcpToken(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.error.code, -32001);
    });

    it('rejects with -32001 when mcp_http_enabled is off', async () => {
        setMcpHttpEnabled(false);
        const req = fakeReq({ authorization: 'Bearer whatever' });
        const res = fakeRes();
        let nextCalled = false;

        await requireMcpToken(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.error.code, -32001);
    });

    it('rejects with -32002 when the caller IP is not in the allowlist', async () => {
        setMcpHttpAllowedIps(['10.0.0.0/24']);
        const req = fakeReq({ ip: '192.168.1.50', authorization: 'Bearer whatever' });
        const res = fakeRes();
        let nextCalled = false;

        await requireMcpToken(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.error.code, -32002);
    });

    it('allows a caller IP matching a CIDR in the allowlist through to the token check', async () => {
        setMcpHttpAllowedIps(['10.0.0.0/24']);
        const req = fakeReq({ ip: '10.0.0.42' }); // no Authorization header
        const res = fakeRes();
        let nextCalled = false;

        await requireMcpToken(req, res, () => { nextCalled = true; });

        // Passed the IP gate, failed on the missing token instead.
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error.code, -32003);
    });

    it('rejects with -32003 when the Authorization header is missing', async () => {
        const req = fakeReq();
        const res = fakeRes();
        let nextCalled = false;

        await requireMcpToken(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error.code, -32003);
    });

    it('rejects with -32003 for an unknown bearer token', async () => {
        const req = fakeReq({ authorization: 'Bearer lvr_mcp_not-a-real-token' });
        const res = fakeRes();
        let nextCalled = false;

        await requireMcpToken(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error.code, -32003);
    });

    it('rejects with -32003 for a revoked token', async () => {
        const created = McpApiTokenRepository.create({ name: 'revoked-agent', scope: 'read', createdBy: 'admin' });
        McpApiTokenRepository.revoke(created.id);
        const req = fakeReq({ authorization: `Bearer ${created.token}` });
        const res = fakeRes();
        let nextCalled = false;

        await requireMcpToken(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error.code, -32003);
    });

    it('rejects with -32003 for an expired token', async () => {
        const created = McpApiTokenRepository.create({ name: 'expired-agent', scope: 'read', createdBy: 'admin', expiresInDays: 1 });
        const { getDatabase } = await import('../../database/connection.js');
        getDatabase()
            .prepare(`UPDATE mcp_api_tokens SET expires_at = strftime('%s','now') - 3600 WHERE id = ?`)
            .run(created.id);

        const req = fakeReq({ authorization: `Bearer ${created.token}` });
        const res = fakeRes();
        let nextCalled = false;

        await requireMcpToken(req, res, () => { nextCalled = true; });

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error.code, -32003);
    });

    it('calls next() and attaches req.mcpToken + request context for a valid token', async () => {
        const created = McpApiTokenRepository.create({ name: 'opencode-dev', scope: 'read_write', createdBy: 'admin' });
        const req = fakeReq({ authorization: `Bearer ${created.token}` });
        const res = fakeRes();
        let nextCalled = false;
        let contextInsideNext: { actor: string; scope: string } | null = null;

        await requireMcpToken(req, res, () => {
            nextCalled = true;
            contextInsideNext = getMcpContext();
        });

        assert.equal(nextCalled, true);
        assert.equal(res.statusCode, null);
        assert.equal(req.mcpToken.name, 'opencode-dev');
        assert.equal(req.mcpToken.scope, 'read_write');
        assert.deepEqual(contextInsideNext, { actor: 'http:opencode-dev', scope: 'read_write' });
    });

    it('ignores a spoofed X-Forwarded-For from a caller that is not a trusted proxy', async () => {
        setMcpHttpAllowedIps(['10.0.0.0/24']);
        // Attacker connects directly (untrusted peer) but claims an allowed IP via the header.
        const req = fakeReq({ remoteAddress: '203.0.113.5', xForwardedFor: '10.0.0.42', authorization: 'Bearer whatever' });
        const res = fakeRes();
        let nextCalled = false;

        await requireMcpToken(req, res, () => { nextCalled = true; });

        // The header is ignored, so the real (disallowed) peer address is checked and rejected.
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.error.code, -32002);
    });

    it('honors X-Forwarded-For when the direct peer is a trusted proxy (loopback)', async () => {
        setMcpHttpAllowedIps(['10.0.0.0/24']);
        // Request arrives from the local reverse proxy (loopback), forwarding the real client IP.
        const req = fakeReq({ remoteAddress: '127.0.0.1', xForwardedFor: '10.0.0.42' });
        const res = fakeRes();
        let nextCalled = false;

        await requireMcpToken(req, res, () => { nextCalled = true; });

        // Passed the IP gate (forwarded IP allowed), failed on the missing token instead.
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error.code, -32003);
    });

    it('merges the MCP_HTTP_ALLOWED_IPS env var with the DB-stored allowlist', async () => {
        setMcpHttpAllowedIps(['10.0.0.0/24']);
        process.env.MCP_HTTP_ALLOWED_IPS = '192.168.1.50';

        const req = fakeReq({ ip: '192.168.1.50' }); // only allowed via the env var, not the DB list
        const res = fakeRes();
        let nextCalled = false;

        await requireMcpToken(req, res, () => { nextCalled = true; });

        // Passed the IP gate (env-allowed), failed on the missing token instead.
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 401);
        assert.equal(res.body.error.code, -32003);
    });
});
