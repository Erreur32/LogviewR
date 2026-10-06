/**
 * Human approval of queued MCP write actions
 *
 * Called only from the admin-authenticated /api/mcp/pending routes (browser
 * session JWT + admin role), never from an MCP tool. Execution happens here,
 * in the Express process, with the params stored at queue time: the agent
 * cannot alter what gets executed after the admin saw it.
 *
 * Guardrails are re-checked right before execution, since the situation may
 * have changed while the request waited (e.g. the IP joined an attack cluster).
 */

import { McpActionAuditRepository } from '../database/models/McpActionAudit.js';
import { McpPendingActionRepository, type McpPendingAction } from '../database/models/McpPendingAction.js';
import { isMcpEnabled, isMcpWriteEnabled, MCP_DISABLED_MESSAGE, MCP_WRITE_DISABLED_MESSAGE } from './mcpConfig.js';
import { executeWriteAction, isMcpWriteTool, pickWriteParams, validateWriteAction } from './writeActions.js';

export interface PendingDecisionResult {
    ok: boolean;
    error?: string;
    action?: McpPendingAction | null;
}

function approverActor(admin: string, action: McpPendingAction): string {
    return `ui:${admin} (for ${action.actor})`;
}

export async function approvePendingAction(id: number, admin: string): Promise<PendingDecisionResult> {
    const action = McpPendingActionRepository.findById(id);
    if (!action) return { ok: false, error: 'Pending action not found.' };
    if (action.status !== 'pending') return { ok: false, error: `Action already ${action.status}.`, action };
    if (!isMcpEnabled()) return { ok: false, error: MCP_DISABLED_MESSAGE, action };
    if (!isMcpWriteEnabled()) return { ok: false, error: MCP_WRITE_DISABLED_MESSAGE, action };
    if (!isMcpWriteTool(action.toolName)) return { ok: false, error: `Unknown write tool "${action.toolName}".`, action };

    // Claim first so a double click / two admins can never execute the same request twice.
    if (!McpPendingActionRepository.claimForExecution(id, admin)) {
        return { ok: false, error: 'Action is no longer pending (already decided or expired).', action: McpPendingActionRepository.findById(id) };
    }

    const params = pickWriteParams(action.toolName, action.params);
    const auditBase = { actor: approverActor(admin, action), toolName: action.toolName, params, confirmed: true };

    const refusal = await validateWriteAction(action.toolName, { ...params });
    if (refusal) {
        McpPendingActionRepository.finish(id, 'failed', refusal);
        McpActionAuditRepository.create({ ...auditBase, result: 'rejected_guardrail', errorMessage: refusal });
        return { ok: false, error: refusal, action: McpPendingActionRepository.findById(id) };
    }

    try {
        const res = await executeWriteAction(action.toolName, params);
        const message = res.ok ? res.output || 'OK' : res.error || 'fail2ban-client error';
        McpPendingActionRepository.finish(id, res.ok ? 'executed' : 'failed', message);
        McpActionAuditRepository.create({ ...auditBase, result: res.ok ? 'success' : 'error', errorMessage: res.ok ? undefined : message });
        return { ok: res.ok, error: res.ok ? undefined : message, action: McpPendingActionRepository.findById(id) };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        McpPendingActionRepository.finish(id, 'failed', message);
        McpActionAuditRepository.create({ ...auditBase, result: 'error', errorMessage: message });
        return { ok: false, error: message, action: McpPendingActionRepository.findById(id) };
    }
}

export function rejectPendingAction(id: number, admin: string): PendingDecisionResult {
    const action = McpPendingActionRepository.findById(id);
    if (!action) return { ok: false, error: 'Pending action not found.' };
    if (!McpPendingActionRepository.reject(id, admin)) {
        return { ok: false, error: `Action already ${action.status}.`, action };
    }
    McpActionAuditRepository.create({
        actor: approverActor(admin, action),
        toolName: action.toolName,
        params: action.params,
        confirmed: false,
        result: 'rejected_by_admin',
    });
    return { ok: true, action: McpPendingActionRepository.findById(id) };
}
