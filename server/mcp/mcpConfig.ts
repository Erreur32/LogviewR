/**
 * MCP enable/disable flag + heartbeat, backed by the generic AppConfigRepository
 *
 * The MCP server is a stdio process started by the user's MCP client, not by
 * this Express app — Express cannot start/stop it. What it CAN do is flip a
 * flag that the MCP process checks on every tool call, so a disable from the
 * web UI takes effect immediately without restarting the external process.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AppConfigRepository } from '../database/models/AppConfig.js';

const MCP_ENABLED_KEY = 'mcp_enabled';
const MCP_LAST_SEEN_KEY = 'mcp_last_seen';
export const MCP_DISABLED_MESSAGE = 'MCP is disabled from the LogviewR admin panel: enable it before retrying.';

/** Absence of the key means disabled — MCP is opt-in and must be enabled explicitly from the admin panel. */
export function isMcpEnabled(): boolean {
    return AppConfigRepository.get(MCP_ENABLED_KEY) === 'true';
}

export function setMcpEnabled(enabled: boolean): boolean {
    return AppConfigRepository.set(MCP_ENABLED_KEY, enabled ? 'true' : 'false');
}

export function touchHeartbeat(): void {
    AppConfigRepository.set(MCP_LAST_SEEN_KEY, String(Date.now()));
}

export function getLastSeenAt(): number | null {
    const raw = AppConfigRepository.get(MCP_LAST_SEEN_KEY);
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

export function jsonResult(data: unknown): CallToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string): CallToolResult {
    return { content: [{ type: 'text', text: message }], isError: true };
}

/** Applies the mcp_enabled gate + heartbeat to a read-tool handler without duplicating the check per tool. */
export function withMcpGuard<Args extends unknown[]>(
    handler: (...args: Args) => Promise<CallToolResult>
): (...args: Args) => Promise<CallToolResult> {
    return async (...args: Args) => {
        if (!isMcpEnabled()) {
            return errorResult(MCP_DISABLED_MESSAGE);
        }
        const result = await handler(...args);
        touchHeartbeat();
        return result;
    };
}

/** Same mcp_enabled gate as withMcpGuard, for resource handlers that throw instead of returning a CallToolResult. */
export function assertMcpEnabled(): void {
    if (!isMcpEnabled()) {
        throw new Error(MCP_DISABLED_MESSAGE);
    }
}
