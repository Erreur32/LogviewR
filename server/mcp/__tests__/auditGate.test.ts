/**
 * Tests for the confirm+audit gate used by MCP write tools.
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
const { initializeDatabase, closeDatabase } = await import('../../database/connection.js');
const { McpActionAuditRepository } = await import('../../database/models/McpActionAudit.js');
const { runGatedAction } = await import('../auditGate.js');
const { setMcpEnabled } = await import('../mcpConfig.js');

describe('runGatedAction', () => {
    beforeEach(() => {
        closeDatabase();
        process.env.DATABASE_PATH = ':memory:';
        initializeDatabase();
        // MCP is opt-in (disabled by default) — these tests exercise the confirm/audit
        // gate itself, so enable it explicitly rather than the disabled-gate path.
        setMcpEnabled(true);
    });

    afterEach(() => {
        closeDatabase();
    });

    it('rejects a call missing confirm:true, logs it, and never runs fn', async () => {
        let ran = false;
        const result = await runGatedAction('f2b_ban_ip', { confirm: false }, async () => {
            ran = true;
            return 'should not happen';
        });

        assert.equal(ran, false);
        assert.equal(result.ok, false);
        assert.match(result.error ?? '', /confirm:true/);

        const rows = McpActionAuditRepository.list({ toolName: 'f2b_ban_ip' });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].result, 'rejected_unconfirmed');
        assert.equal(rows[0].confirmed, false);
    });

    it('runs fn and logs success when confirm:true', async () => {
        let ran = false;
        const result = await runGatedAction('f2b_ban_ip', { confirm: true }, async () => {
            ran = true;
            return { ok: true };
        });

        assert.equal(ran, true);
        assert.equal(result.ok, true);
        assert.deepEqual(result.data, { ok: true });

        const rows = McpActionAuditRepository.list({ toolName: 'f2b_ban_ip' });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].result, 'success');
        assert.equal(rows[0].confirmed, true);
    });

    it('logs an error result when fn throws, still confirmed:true', async () => {
        const result = await runGatedAction('f2b_ban_ip', { confirm: true }, async () => {
            throw new Error('fail2ban-client unreachable');
        });

        assert.equal(result.ok, false);
        assert.equal(result.error, 'fail2ban-client unreachable');

        const rows = McpActionAuditRepository.list({ toolName: 'f2b_ban_ip' });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].result, 'error');
        assert.equal(rows[0].confirmed, true);
        assert.equal(rows[0].errorMessage, 'fail2ban-client unreachable');
    });

    it('records the actor from LOGVIEWR_MCP_ACTOR when set', async () => {
        process.env.LOGVIEWR_MCP_ACTOR = 'claude-desktop-test';
        try {
            await runGatedAction('f2b_unban_ip', { confirm: true }, async () => 'ok');
            const rows = McpActionAuditRepository.list({ toolName: 'f2b_unban_ip' });
            assert.equal(rows[0].actor, 'claude-desktop-test');
        } finally {
            delete process.env.LOGVIEWR_MCP_ACTOR;
        }
    });

    it('rejects and logs when MCP is disabled, without running fn', async () => {
        setMcpEnabled(false);
        let ran = false;
        const result = await runGatedAction('f2b_ban_ip', { confirm: true }, async () => {
            ran = true;
            return 'should not happen';
        });

        assert.equal(ran, false);
        assert.equal(result.ok, false);
        assert.match(result.error ?? '', /disabled/);

        const rows = McpActionAuditRepository.list({ toolName: 'f2b_ban_ip' });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].result, 'rejected_disabled');
        assert.equal(rows[0].confirmed, false);
    });
});
