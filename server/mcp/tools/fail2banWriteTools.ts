/**
 * Write fail2ban MCP tools
 *
 * Every tool here is confirm+audit gated via runGatedAction — no action runs
 * without an explicit confirm:true, and every outcome (including the
 * rejected-unconfirmed case) is written to mcp_action_audit.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Fail2banClientExec } from '../../plugins/fail2ban/Fail2banClientExec.js';
import { runGatedAction, type GatedParams } from '../auditGate.js';

function jsonResult(data: unknown): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

interface BanParams extends GatedParams {
    jail: string;
    ip: string;
    reason?: string;
}

interface JailParams extends GatedParams {
    jail: string;
}

export function registerFail2banWriteTools(server: McpServer): void {
    const client = new Fail2banClientExec();

    server.registerTool(
        'f2b_ban_ip',
        {
            description: 'Ban an IP in a fail2ban jail. Requires confirm:true.',
            inputSchema: {
                jail: z.string().min(1),
                ip: z.string().min(2),
                reason: z.string().optional(),
                confirm: z.boolean().optional(),
                dryRun: z.boolean().optional(),
            },
        },
        async (params: BanParams) => {
            const result = await runGatedAction('f2b_ban_ip', params, () => client.banIp(params.jail, params.ip));
            return jsonResult(result);
        }
    );

    server.registerTool(
        'f2b_unban_ip',
        {
            description: 'Unban an IP from a fail2ban jail. Requires confirm:true.',
            inputSchema: {
                jail: z.string().min(1),
                ip: z.string().min(2),
                reason: z.string().optional(),
                confirm: z.boolean().optional(),
                dryRun: z.boolean().optional(),
            },
        },
        async (params: BanParams) => {
            const result = await runGatedAction('f2b_unban_ip', params, () => client.unbanIp(params.jail, params.ip));
            return jsonResult(result);
        }
    );

    server.registerTool(
        'f2b_jail_start',
        {
            description: 'Start a stopped fail2ban jail. Requires confirm:true.',
            inputSchema: { jail: z.string().min(1), confirm: z.boolean().optional(), dryRun: z.boolean().optional() },
        },
        async (params: JailParams) => {
            const result = await runGatedAction('f2b_jail_start', params, () => client.startJail(params.jail));
            return jsonResult(result);
        }
    );

    server.registerTool(
        'f2b_jail_stop',
        {
            description: 'Stop a running fail2ban jail. Requires confirm:true.',
            inputSchema: { jail: z.string().min(1), confirm: z.boolean().optional(), dryRun: z.boolean().optional() },
        },
        async (params: JailParams) => {
            const result = await runGatedAction('f2b_jail_stop', params, () => client.stopJail(params.jail));
            return jsonResult(result);
        }
    );
}
