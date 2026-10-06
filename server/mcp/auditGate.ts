/**
 * Confirm + audit gate for MCP write tools
 *
 * Every write action must be called with `confirm: true`. Missing confirm is
 * refused and logged as `rejected_unconfirmed` without ever running the
 * underlying action. Every outcome (rejected, pending, success, error) is
 * written to mcp_action_audit, this is the only audit trail fail2ban writes get today.
 *
 * confirm:true is set by the agent itself, so on its own it does not stop an
 * indirect prompt injection (malicious text in a log line asking the agent to
 * unban an IP). The layers that do, in order:
 *   1. mcp_write_enabled kill switch (off by default)
 *   2. token/stdio scope (read by default)
 *   3. guardrails on the params (writeActions.ts)
 *   4. human approval in the LogviewR UI for the tools selected by mcp_approval_mode:
 *      the request is queued in mcp_pending_actions and never executed by the agent's call
 */

import { McpActionAuditRepository, type McpAuditResult } from '../database/models/McpActionAudit.js';
import { McpPendingActionRepository, MCP_PENDING_MAX_OPEN } from '../database/models/McpPendingAction.js';
import {
    isMcpEnabled, isMcpWriteEnabled, getMcpApprovalMode, touchHeartbeat,
    MCP_DISABLED_MESSAGE, MCP_WRITE_DISABLED_MESSAGE,
} from './mcpConfig.js';
import { getMcpContext } from './requestContext.js';
import { isMcpWriteTool, pickWriteParams, requiresApproval, validateWriteAction } from './writeActions.js';

export interface GatedParams {
    confirm?: boolean;
    dryRun?: boolean;
}

/** Tool arguments as received from the agent: gate flags plus the tool's own fields. */
export type GatedToolParams = GatedParams & Record<string, unknown>;

export interface GatedActionResult<T> {
    ok: boolean;
    data?: T;
    error?: string;
    dryRun?: boolean;
    wouldExecute?: { tool: string; params: unknown };
    pendingApproval?: { id: number; expiresAt: string; message: string };
}

// In-memory sliding window rate limit for confirmed write actions (approval requests included).
// The MCP process is one stdio process per session — no need to persist this.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = Number.parseInt(process.env.LOGVIEWR_MCP_WRITE_RATE_LIMIT || '5', 10) || 5;
const confirmedActionTimestamps: number[] = [];

function isRateLimited(): boolean {
    const now = Date.now();
    while (confirmedActionTimestamps.length > 0 && now - confirmedActionTimestamps[0] > RATE_LIMIT_WINDOW_MS) {
        confirmedActionTimestamps.shift();
    }
    return confirmedActionTimestamps.length >= RATE_LIMIT_MAX;
}

function recordConfirmedAction(): void {
    confirmedActionTimestamps.push(Date.now());
}

function queueForApproval<T>(toolName: string, params: GatedToolParams, actor: string): GatedActionResult<T> {
    const audit = (result: McpAuditResult) =>
        McpActionAuditRepository.create({ actor, toolName, params, confirmed: true, result });

    const stored = isMcpWriteTool(toolName) ? { ...pickWriteParams(toolName, params) } : {};
    const pending = McpPendingActionRepository.findOpenDuplicate(toolName, stored)
        ?? (McpPendingActionRepository.countOpen() < MCP_PENDING_MAX_OPEN
            ? McpPendingActionRepository.create({ toolName, params: stored, actor })
            : null);

    if (!pending) {
        audit('rejected_pending_limit');
        return { ok: false, error: `Too many actions already awaiting approval (max ${MCP_PENDING_MAX_OPEN}). Ask the admin to review them in the LogviewR UI.` };
    }

    recordConfirmedAction();
    audit('pending_approval');
    touchHeartbeat();
    return {
        ok: false,
        pendingApproval: {
            id: pending.id,
            expiresAt: new Date(pending.expiresAt).toISOString(),
            message: `${toolName} was NOT executed: it requires a human approval in the LogviewR UI (Settings > MCP > Approvals, request #${pending.id}). `
                + 'Tell the user to review it there; use mcp_pending_status to check the outcome. Do not retry.',
        },
    };
}

export async function runGatedAction<T>(
    toolName: string,
    params: GatedToolParams,
    fn: () => Promise<T>
): Promise<GatedActionResult<T>> {
    const context = getMcpContext();
    const actor = context.actor;
    const audit = (result: McpAuditResult, confirmed: boolean, errorMessage?: string) =>
        McpActionAuditRepository.create({ actor, toolName, params, confirmed, result, errorMessage });

    if (!isMcpEnabled()) {
        audit('rejected_disabled', false);
        return { ok: false, error: MCP_DISABLED_MESSAGE };
    }

    // runGatedAction is only ever called by write tools, a read-only scope (HTTP tokens
    // created without read_write, stdio without LOGVIEWR_MCP_SCOPE=read_write) must never
    // be able to reach fn(), dry-run included.
    if (context.scope !== 'read_write') {
        audit('rejected_insufficient_scope', false);
        return { ok: false, error: `${toolName} requires the read_write scope, this session is scoped to read-only access.` };
    }

    if (!isMcpWriteEnabled()) {
        audit('rejected_write_disabled', false);
        return { ok: false, error: MCP_WRITE_DISABLED_MESSAGE };
    }

    const refusal = await validateWriteAction(toolName, params);
    if (refusal) {
        audit('rejected_guardrail', params.confirm === true, refusal);
        return { ok: false, error: refusal };
    }

    if (params.dryRun === true) {
        audit('dry_run', false);
        touchHeartbeat();
        return { ok: true, dryRun: true, wouldExecute: { tool: toolName, params } };
    }

    if (params.confirm !== true) {
        audit('rejected_unconfirmed', false);
        return { ok: false, error: `${toolName} requires confirm:true — call again with confirm:true to proceed.` };
    }

    if (isRateLimited()) {
        audit('rejected_rate_limited', true);
        return {
            ok: false,
            error: `Rate limit exceeded: max ${RATE_LIMIT_MAX} confirmed write actions per ${RATE_LIMIT_WINDOW_MS / 1000}s. Wait and retry.`,
        };
    }

    if (requiresApproval(toolName, getMcpApprovalMode())) {
        return queueForApproval<T>(toolName, params, actor);
    }

    try {
        const data = await fn();
        recordConfirmedAction();
        audit('success', true);
        touchHeartbeat();
        return { ok: true, data };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        audit('error', true, message);
        touchHeartbeat();
        return { ok: false, error: message };
    }
}
