/**
 * MCP pending action queue
 *
 * Write actions an MCP agent requested but that need a human approval from
 * the LogviewR UI before running (see mcp_approval_mode). The agent can only
 * create and read rows; approve/reject happen exclusively through the
 * admin-authenticated /api/mcp/pending routes, never through an MCP tool, so
 * a prompt-injected agent has no path to approve its own request.
 *
 * Status lifecycle: pending -> executing -> executed | failed
 *                   pending -> rejected | expired
 * The pending -> executing transition is a single conditional UPDATE, so two
 * concurrent approvals can never run the same action twice.
 */

import { getDatabase } from '../connection.js';

export type McpPendingStatus = 'pending' | 'executing' | 'executed' | 'failed' | 'rejected' | 'expired';

export interface McpPendingAction {
    id: number;
    toolName: string;
    params: Record<string, unknown>;
    actor: string;
    status: McpPendingStatus;
    createdAt: number;
    expiresAt: number;
    decidedAt: number | null;
    decidedBy: string | null;
    resultMessage: string | null;
}

/** Pending requests expire after this delay without a decision. */
export const MCP_PENDING_TTL_SECONDS = 30 * 60;
/** Caps how many undecided requests an agent can stack up in the UI. */
export const MCP_PENDING_MAX_OPEN = 20;

function mapRow(row: any): McpPendingAction {
    let params: Record<string, unknown> = {};
    try { params = JSON.parse(row.params_json); } catch { /* keep empty */ }
    return {
        id: row.id,
        toolName: row.tool_name,
        params,
        actor: row.actor,
        status: row.status,
        createdAt: row.created_at * 1000,
        expiresAt: row.expires_at * 1000,
        decidedAt: row.decided_at ? row.decided_at * 1000 : null,
        decidedBy: row.decided_by ?? null,
        resultMessage: row.result_message ?? null,
    };
}

function nowSec(): number {
    return Math.floor(Date.now() / 1000);
}

export class McpPendingActionRepository {
    /** Lazily flips overdue pending rows to expired, called before every read. */
    static expireOverdue(): void {
        getDatabase()
            .prepare(`UPDATE mcp_pending_actions SET status = 'expired', decided_at = ? WHERE status = 'pending' AND expires_at <= ?`)
            .run(nowSec(), nowSec());
    }

    /** Returns the identical open request instead of stacking a duplicate when the agent retries. */
    static findOpenDuplicate(toolName: string, params: Record<string, unknown>): McpPendingAction | null {
        McpPendingActionRepository.expireOverdue();
        const row = getDatabase()
            .prepare(`SELECT * FROM mcp_pending_actions WHERE status = 'pending' AND tool_name = ? AND params_json = ? ORDER BY id DESC LIMIT 1`)
            .get(toolName, JSON.stringify(params));
        return row ? mapRow(row) : null;
    }

    static countOpen(): number {
        McpPendingActionRepository.expireOverdue();
        const row = getDatabase().prepare(`SELECT COUNT(*) AS count FROM mcp_pending_actions WHERE status = 'pending'`).get() as any;
        return row.count as number;
    }

    static create(input: { toolName: string; params: Record<string, unknown>; actor: string }): McpPendingAction {
        const db = getDatabase();
        const created = nowSec();
        const info = db
            .prepare(`INSERT INTO mcp_pending_actions (tool_name, params_json, actor, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`)
            .run(input.toolName, JSON.stringify(input.params), input.actor, created, created + MCP_PENDING_TTL_SECONDS);
        return McpPendingActionRepository.findById(Number(info.lastInsertRowid))!;
    }

    static findById(id: number): McpPendingAction | null {
        McpPendingActionRepository.expireOverdue();
        const row = getDatabase().prepare(`SELECT * FROM mcp_pending_actions WHERE id = ?`).get(id);
        return row ? mapRow(row) : null;
    }

    static list(options: { status?: McpPendingStatus; limit?: number } = {}): McpPendingAction[] {
        McpPendingActionRepository.expireOverdue();
        const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
        const db = getDatabase();
        const rows = options.status
            ? db.prepare(`SELECT * FROM mcp_pending_actions WHERE status = ? ORDER BY id DESC LIMIT ?`).all(options.status, limit)
            : db.prepare(`SELECT * FROM mcp_pending_actions ORDER BY id DESC LIMIT ?`).all(limit);
        return rows.map(mapRow);
    }

    /** Atomically claims a still-valid pending row for execution. False if already decided, expired or missing. */
    static claimForExecution(id: number, decidedBy: string): boolean {
        const now = nowSec();
        const info = getDatabase()
            .prepare(`UPDATE mcp_pending_actions SET status = 'executing', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending' AND expires_at > ?`)
            .run(now, decidedBy, id, now);
        return info.changes === 1;
    }

    static reject(id: number, decidedBy: string): boolean {
        const now = nowSec();
        const info = getDatabase()
            .prepare(`UPDATE mcp_pending_actions SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ? AND status = 'pending' AND expires_at > ?`)
            .run(now, decidedBy, id, now);
        return info.changes === 1;
    }

    static finish(id: number, status: 'executed' | 'failed', resultMessage: string | null): void {
        getDatabase()
            .prepare(`UPDATE mcp_pending_actions SET status = ?, result_message = ? WHERE id = ? AND status = 'executing'`)
            .run(status, resultMessage, id);
    }
}
