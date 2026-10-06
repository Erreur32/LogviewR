/**
 * Tests for the gate used by MCP write tools: kill switches, scope,
 * guardrails, confirm, and the human approval queue.
 *
 * Uses Node.js built-in test runner (node:test + node:assert), in-memory SQLite.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
// The write rate limit is a process-wide sliding window read at import time, lift it so
// confirmed actions from earlier tests don't throttle later ones.
process.env.LOGVIEWR_MCP_WRITE_RATE_LIMIT = '1000';

// Dynamic import: connection.ts resolves its DB path once at module-evaluation
// time, and static imports are hoisted ahead of the env assignment above — a
// dynamic import is the only way to guarantee the env var is read first.
const { initializeDatabase, closeDatabase } = await import('../../database/connection.js');
const { McpActionAuditRepository } = await import('../../database/models/McpActionAudit.js');
const { McpPendingActionRepository } = await import('../../database/models/McpPendingAction.js');
const { runGatedAction } = await import('../auditGate.js');
const { rejectPendingAction } = await import('../pendingApproval.js');
const { setMcpEnabled, setMcpWriteEnabled, setMcpApprovalMode } = await import('../mcpConfig.js');

const BAN = { jail: 'sshd', ip: '203.0.113.7' };

describe('runGatedAction', () => {
    beforeEach(() => {
        closeDatabase();
        process.env.DATABASE_PATH = ':memory:';
        process.env.LOGVIEWR_MCP_SCOPE = 'read_write';
        initializeDatabase();
        // MCP and its writes are opt-in (disabled by default), these tests exercise the
        // gate itself, so enable both explicitly and start from the legacy no-approval mode.
        setMcpEnabled(true);
        setMcpWriteEnabled(true);
        setMcpApprovalMode('none');
    });

    afterEach(() => {
        delete process.env.LOGVIEWR_MCP_SCOPE;
        closeDatabase();
    });

    it('rejects a call missing confirm:true, logs it, and never runs fn', async () => {
        let ran = false;
        const result = await runGatedAction('f2b_ban_ip', { ...BAN, confirm: false }, async () => {
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
        const result = await runGatedAction('f2b_ban_ip', { ...BAN, confirm: true }, async () => {
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
        const result = await runGatedAction('f2b_ban_ip', { ...BAN, confirm: true }, async () => {
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
            await runGatedAction('f2b_unban_ip', { ...BAN, confirm: true }, async () => 'ok');
            const rows = McpActionAuditRepository.list({ toolName: 'f2b_unban_ip' });
            assert.equal(rows[0].actor, 'claude-desktop-test');
        } finally {
            delete process.env.LOGVIEWR_MCP_ACTOR;
        }
    });

    it('rejects and logs when MCP is disabled, without running fn', async () => {
        setMcpEnabled(false);
        let ran = false;
        const result = await runGatedAction('f2b_ban_ip', { ...BAN, confirm: true }, async () => {
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

    it('defaults the stdio scope to read-only when LOGVIEWR_MCP_SCOPE is unset', async () => {
        delete process.env.LOGVIEWR_MCP_SCOPE;
        let ran = false;
        const result = await runGatedAction('f2b_ban_ip', { ...BAN, confirm: true }, async () => { ran = true; });

        assert.equal(ran, false);
        assert.match(result.error ?? '', /read_write scope/);
        assert.equal(McpActionAuditRepository.list({})[0].result, 'rejected_insufficient_scope');
    });

    it('rejects every write while mcp_write_enabled is off', async () => {
        setMcpWriteEnabled(false);
        let ran = false;
        const result = await runGatedAction('f2b_ban_ip', { ...BAN, confirm: true }, async () => { ran = true; });

        assert.equal(ran, false);
        assert.match(result.error ?? '', /write actions are disabled/);
        assert.equal(McpActionAuditRepository.list({})[0].result, 'rejected_write_disabled');
    });

    for (const [label, params, pattern] of [
        ['a private LAN IP', { jail: 'sshd', ip: '192.168.1.10' }, /private/],
        ['loopback', { jail: 'sshd', ip: '127.0.0.1' }, /private/],
        ['a non-IP string (whois option injection)', { jail: 'sshd', ip: '-hevil.example' }, /Invalid IP/],
        ['a malformed jail name', { jail: 'sshd; reboot', ip: '203.0.113.7' }, /Invalid jail/],
        ['a jail name parsed as an option', { jail: '-x', ip: '203.0.113.7' }, /Invalid jail/],
    ] as const) {
        it(`guardrail refuses to ban ${label}, dry-run included`, async () => {
            let ran = false;
            for (const gate of [{ dryRun: true }, { confirm: true }]) {
                const result = await runGatedAction('f2b_ban_ip', { ...params, ...gate }, async () => { ran = true; });
                assert.equal(result.ok, false);
                assert.match(result.error ?? '', pattern);
            }
            assert.equal(ran, false);
            assert.ok(McpActionAuditRepository.list({}).every((r) => r.result === 'rejected_guardrail'));
        });
    }
});

describe('runGatedAction human approval queue', () => {
    beforeEach(() => {
        closeDatabase();
        process.env.DATABASE_PATH = ':memory:';
        process.env.LOGVIEWR_MCP_SCOPE = 'read_write';
        initializeDatabase();
        setMcpEnabled(true);
        setMcpWriteEnabled(true);
        setMcpApprovalMode('weakening');
    });

    afterEach(() => {
        delete process.env.LOGVIEWR_MCP_SCOPE;
        closeDatabase();
    });

    it('queues a weakening action instead of running it', async () => {
        let ran = false;
        const result = await runGatedAction('f2b_unban_ip', { ...BAN, confirm: true }, async () => { ran = true; });

        assert.equal(ran, false);
        assert.equal(result.ok, false);
        assert.ok(result.pendingApproval);
        assert.match(result.pendingApproval.message, /NOT executed/);

        const pending = McpPendingActionRepository.findById(result.pendingApproval.id);
        assert.equal(pending?.status, 'pending');
        assert.deepEqual(pending?.params, BAN);
        assert.equal(McpActionAuditRepository.list({})[0].result, 'pending_approval');
    });

    it('stores only executor fields, never extra params the agent sent', async () => {
        const result = await runGatedAction(
            'f2b_unban_ip',
            { ...BAN, confirm: true, injected: 'x' },
            async () => 'ok'
        );
        const pending = McpPendingActionRepository.findById(result.pendingApproval!.id);
        assert.deepEqual(pending?.params, BAN);
    });

    it('still runs strengthening actions directly in weakening mode', async () => {
        let ran = false;
        const result = await runGatedAction('f2b_ban_ip', { ...BAN, confirm: true }, async () => { ran = true; return 'ok'; });
        assert.equal(ran, true);
        assert.equal(result.ok, true);
    });

    it('queues every write in "all" mode', async () => {
        setMcpApprovalMode('all');
        let ran = false;
        const result = await runGatedAction('f2b_ban_ip', { ...BAN, confirm: true }, async () => { ran = true; });
        assert.equal(ran, false);
        assert.ok(result.pendingApproval);
    });

    it('returns the same request when the agent retries an identical action', async () => {
        const first = await runGatedAction('f2b_jail_stop', { jail: 'sshd', confirm: true }, async () => 'ok');
        const second = await runGatedAction('f2b_jail_stop', { jail: 'sshd', confirm: true }, async () => 'ok');
        assert.equal(first.pendingApproval?.id, second.pendingApproval?.id);
        assert.equal(McpPendingActionRepository.countOpen(), 1);
    });

    it('expires a request once its TTL is over, so it can no longer be decided', async () => {
        const result = await runGatedAction('f2b_jail_stop', { jail: 'sshd', confirm: true }, async () => 'ok');
        const id = result.pendingApproval!.id;
        const { getDatabase } = await import('../../database/connection.js');
        getDatabase().prepare('UPDATE mcp_pending_actions SET expires_at = 0 WHERE id = ?').run(id);

        assert.equal(McpPendingActionRepository.findById(id)?.status, 'expired');
        assert.equal(McpPendingActionRepository.claimForExecution(id, 'admin'), false);
        assert.equal(rejectPendingAction(id, 'admin').ok, false);
    });

    it('lets an admin reject a request exactly once, and audits it', async () => {
        const result = await runGatedAction('f2b_jail_stop', { jail: 'sshd', confirm: true }, async () => 'ok');
        const id = result.pendingApproval!.id;

        assert.equal(rejectPendingAction(id, 'alice').ok, true);
        assert.equal(rejectPendingAction(id, 'alice').ok, false);
        assert.equal(McpPendingActionRepository.findById(id)?.status, 'rejected');
        assert.equal(McpPendingActionRepository.findById(id)?.decidedBy, 'alice');
        const rejected = McpActionAuditRepository.list({ result: 'rejected_by_admin' });
        assert.equal(rejected.length, 1);
        assert.match(rejected[0].actor, /^ui:alice/);
    });

    it('claims a request for execution only once (no double execution)', async () => {
        const result = await runGatedAction('f2b_jail_stop', { jail: 'sshd', confirm: true }, async () => 'ok');
        const id = result.pendingApproval!.id;
        assert.equal(McpPendingActionRepository.claimForExecution(id, 'alice'), true);
        assert.equal(McpPendingActionRepository.claimForExecution(id, 'bob'), false);
    });
});
