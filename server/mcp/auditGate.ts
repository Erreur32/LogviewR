/**
 * Confirm + audit gate for MCP write tools
 *
 * Every write action must be called with `confirm: true`. Missing confirm is
 * refused and logged as `rejected_unconfirmed` without ever running the
 * underlying action. Every outcome (rejected, success, error) is written to
 * mcp_action_audit — this is the only audit trail fail2ban writes get today.
 */

import { McpActionAuditRepository } from '../database/models/McpActionAudit.js';
import { isMcpEnabled, touchHeartbeat } from './mcpConfig.js';

export function mcpActor(): string {
    return process.env.LOGVIEWR_MCP_ACTOR || 'unknown-mcp-agent';
}

export interface GatedParams {
    confirm?: boolean;
    dryRun?: boolean;
}

export interface GatedActionResult<T> {
    ok: boolean;
    data?: T;
    error?: string;
    dryRun?: boolean;
    wouldExecute?: { tool: string; params: unknown };
}

// In-memory sliding window rate limit for confirmed write actions.
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

export async function runGatedAction<T>(
    toolName: string,
    params: GatedParams,
    fn: () => Promise<T>
): Promise<GatedActionResult<T>> {
    const actor = mcpActor();

    if (!isMcpEnabled()) {
        McpActionAuditRepository.create({
            actor,
            toolName,
            params,
            confirmed: false,
            result: 'rejected_disabled',
        });
        return { ok: false, error: 'MCP is disabled from the LogviewR admin panel — enable it before retrying.' };
    }

    if (params.dryRun === true) {
        McpActionAuditRepository.create({
            actor,
            toolName,
            params,
            confirmed: false,
            result: 'dry_run',
        });
        touchHeartbeat();
        return { ok: true, dryRun: true, wouldExecute: { tool: toolName, params } };
    }

    if (params.confirm !== true) {
        McpActionAuditRepository.create({
            actor,
            toolName,
            params,
            confirmed: false,
            result: 'rejected_unconfirmed',
        });
        return { ok: false, error: `${toolName} requires confirm:true — call again with confirm:true to proceed.` };
    }

    if (isRateLimited()) {
        McpActionAuditRepository.create({
            actor,
            toolName,
            params,
            confirmed: true,
            result: 'rejected_rate_limited',
        });
        return {
            ok: false,
            error: `Rate limit exceeded: max ${RATE_LIMIT_MAX} confirmed write actions per ${RATE_LIMIT_WINDOW_MS / 1000}s. Wait and retry.`,
        };
    }

    try {
        const data = await fn();
        recordConfirmedAction();
        McpActionAuditRepository.create({
            actor,
            toolName,
            params,
            confirmed: true,
            result: 'success',
        });
        touchHeartbeat();
        return { ok: true, data };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        McpActionAuditRepository.create({
            actor,
            toolName,
            params,
            confirmed: true,
            result: 'error',
            errorMessage: message,
        });
        touchHeartbeat();
        return { ok: false, error: message };
    }
}
