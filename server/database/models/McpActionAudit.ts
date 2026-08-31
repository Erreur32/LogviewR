/**
 * MCP action audit trail
 *
 * Records every write-tool invocation from the LogviewR MCP server,
 * including attempts rejected for missing confirm:true.
 */

import { getDatabase } from '../connection.js';

export type McpAuditResult =
    | 'success'
    | 'error'
    | 'rejected_unconfirmed'
    | 'rejected_disabled'
    | 'rejected_rate_limited'
    | 'rejected_insufficient_scope'
    | 'dry_run';

export interface McpActionAuditEntry {
    id: number;
    actor: string;
    toolName: string;
    paramsJson: string;
    confirmed: boolean;
    result: McpAuditResult;
    errorMessage?: string;
    createdAt: Date;
}

export interface CreateMcpActionAuditInput {
    actor: string;
    toolName: string;
    params: unknown;
    confirmed: boolean;
    result: McpAuditResult;
    errorMessage?: string;
}

export interface ListMcpActionAuditFilter {
    toolName?: string;
    actor?: string;
    result?: McpAuditResult;
    limit?: number;
    offset?: number;
}

export interface McpActionAuditStats {
    total: number;
    success: number;
    error: number;
    rejectedUnconfirmed: number;
    lastActionAt: Date | null;
}

function mapRow(row: any): McpActionAuditEntry {
    return {
        id: row.id,
        actor: row.actor,
        toolName: row.tool_name,
        paramsJson: row.params_json,
        confirmed: row.confirmed === 1,
        result: row.result,
        errorMessage: row.error_message || undefined,
        createdAt: new Date(row.created_at * 1000),
    };
}

export class McpActionAuditRepository {
    static create(input: CreateMcpActionAuditInput): void {
        const db = getDatabase();
        const stmt = db.prepare(`
            INSERT INTO mcp_action_audit (actor, tool_name, params_json, confirmed, result, error_message)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            input.actor,
            input.toolName,
            JSON.stringify(input.params),
            input.confirmed ? 1 : 0,
            input.result,
            input.errorMessage ?? null
        );
    }

    private static buildWhere(filter: ListMcpActionAuditFilter): { where: string; values: any[] } {
        const conditions: string[] = [];
        const values: any[] = [];

        if (filter.toolName) {
            conditions.push('tool_name = ?');
            values.push(filter.toolName);
        }
        if (filter.actor) {
            conditions.push('actor = ?');
            values.push(filter.actor);
        }
        if (filter.result) {
            conditions.push('result = ?');
            values.push(filter.result);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        return { where, values };
    }

    static list(filter: ListMcpActionAuditFilter = {}): McpActionAuditEntry[] {
        const db = getDatabase();
        const { where, values } = McpActionAuditRepository.buildWhere(filter);
        const limit = filter.limit && filter.limit > 0 ? filter.limit : 100;
        const offset = filter.offset && filter.offset > 0 ? filter.offset : 0;

        const stmt = db.prepare(`
            SELECT * FROM mcp_action_audit
            ${where}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        `);
        const rows = stmt.all(...values, limit, offset) as any[];
        return rows.map(mapRow);
    }

    static count(filter: ListMcpActionAuditFilter = {}): number {
        const db = getDatabase();
        const { where, values } = McpActionAuditRepository.buildWhere(filter);
        const row = db.prepare(`SELECT COUNT(*) AS count FROM mcp_action_audit ${where}`).get(...values) as any;
        return row.count as number;
    }

    static stats(): McpActionAuditStats {
        const db = getDatabase();
        const row = db
            .prepare(
                `
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) AS success,
                SUM(CASE WHEN result = 'error' THEN 1 ELSE 0 END) AS error,
                SUM(CASE WHEN result = 'rejected_unconfirmed' THEN 1 ELSE 0 END) AS rejectedUnconfirmed,
                MAX(created_at) AS lastActionAt
            FROM mcp_action_audit
        `
            )
            .get() as any;

        return {
            total: row.total ?? 0,
            success: row.success ?? 0,
            error: row.error ?? 0,
            rejectedUnconfirmed: row.rejectedUnconfirmed ?? 0,
            lastActionAt: row.lastActionAt ? new Date(row.lastActionAt * 1000) : null,
        };
    }
}
