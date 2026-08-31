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
const MCP_HTTP_ENABLED_KEY = 'mcp_http_enabled';
const MCP_HTTP_ALLOWED_IPS_KEY = 'mcp_http_allowed_ips';
const MCP_LAST_SEEN_KEY = 'mcp_last_seen';
export const MCP_DISABLED_MESSAGE = 'MCP is disabled from the LogviewR admin panel: enable it before retrying.';
export const MCP_HTTP_DISABLED_MESSAGE = 'MCP remote HTTP access is disabled from the LogviewR admin panel: enable it before retrying.';

/** Absence of the key means disabled — MCP is opt-in and must be enabled explicitly from the admin panel. */
export function isMcpEnabled(): boolean {
    return AppConfigRepository.get(MCP_ENABLED_KEY) === 'true';
}

export function setMcpEnabled(enabled: boolean): boolean {
    return AppConfigRepository.set(MCP_ENABLED_KEY, enabled ? 'true' : 'false');
}

/** Dedicated circuit breaker for the remote HTTP transport, stdio keeps working even when this is off. Off by default. */
export function isMcpHttpEnabled(): boolean {
    return AppConfigRepository.get(MCP_HTTP_ENABLED_KEY) === 'true';
}

export function setMcpHttpEnabled(enabled: boolean): boolean {
    return AppConfigRepository.set(MCP_HTTP_ENABLED_KEY, enabled ? 'true' : 'false');
}

/**
 * CSV of IPs/CIDRs allowed to reach /mcp, merges the DB-stored allowlist (managed from the admin
 * panel) with the MCP_HTTP_ALLOWED_IPS env var (an infra-level floor that can't be relaxed via the UI).
 * Empty/unset means no allowlist restriction, not recommended for anything beyond localhost.
 */
export function getMcpHttpAllowedIps(): string[] {
    const fromDb = AppConfigRepository.get(MCP_HTTP_ALLOWED_IPS_KEY);
    const fromEnv = process.env.MCP_HTTP_ALLOWED_IPS;
    const combined = [
        ...(fromDb ? fromDb.split(',') : []),
        ...(fromEnv ? fromEnv.split(',') : []),
    ]
        .map((s) => s.trim())
        .filter(Boolean);
    return [...new Set(combined)];
}

export function setMcpHttpAllowedIps(ips: string[]): boolean {
    return AppConfigRepository.set(MCP_HTTP_ALLOWED_IPS_KEY, ips.map((s) => s.trim()).filter(Boolean).join(','));
}

/**
 * IPs/CIDRs of reverse proxies trusted to set X-Forwarded-For for /mcp. The app-wide
 * `trust proxy` setting in server/index.ts accepts that header from anyone, which would let a
 * remote attacker spoof their way past the /mcp IP allowlist above by sending their own
 * X-Forwarded-For — so for this one route the header is only honored when the direct TCP peer
 * (req.socket.remoteAddress, unspoofable) is itself in this list. Loopback is always trusted,
 * since network_mode: host means a reverse proxy on the same machine is the documented setup;
 * MCP_TRUSTED_PROXY_IPS env var extends this for a proxy running elsewhere.
 */
export function getMcpTrustedProxyIps(): string[] {
    const fromEnv = process.env.MCP_TRUSTED_PROXY_IPS;
    const extra = fromEnv ? fromEnv.split(',').map((s) => s.trim()).filter(Boolean) : [];
    return [...new Set(['127.0.0.1', '::1', ...extra])];
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
