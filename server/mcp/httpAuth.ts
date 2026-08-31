/**
 * Authentication + network gating for the remote HTTP MCP transport
 *
 * The /mcp endpoint speaks MCP's JSON-RPC 2.0 wire format, not LogviewR's
 * usual { success, result } envelope, that mismatch is intentional (it is
 * the protocol's own transport), documented in Docs/MCP_SERVER.md.
 *
 * Layers enforced here, in order:
 *   1. mcp_enabled AND mcp_http_enabled (dedicated kill switch, off by default)
 *   2. IP allowlist (if configured: DB + MCP_HTTP_ALLOWED_IPS env)
 *   3. Bearer token: hashed lookup, expiry, revocation (McpApiTokenRepository)
 * A failure at any layer is logged via securityNotificationService for
 * brute-force visibility, and the request never reaches the MCP transport.
 */

import type { Request, Response, NextFunction } from 'express';
import expressRateLimit from 'express-rate-limit';
import { isMcpEnabled, isMcpHttpEnabled, getMcpHttpAllowedIps, getMcpTrustedProxyIps } from './mcpConfig.js';
import { McpApiTokenRepository } from '../database/models/McpApiToken.js';
import { isIpAllowed } from './ipAllowlist.js';
import { runWithMcpContext } from './requestContext.js';
import { securityNotificationService } from '../services/securityNotificationService.js';
import { logger } from '../utils/logger.js';

export interface McpTokenRequest extends Request {
    mcpToken?: { id: number; name: string; scope: 'read' | 'read_write' };
}

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
    res.status(status).json({ jsonrpc: '2.0', error: { code, message }, id: null });
}

function normalizeIp(ip: string): string {
    return ip.replace(/^::ffff:/, '');
}

/**
 * Resolves the real client IP for /mcp without trusting the app-wide `trust proxy: true`
 * setting (server/index.ts), which lets any caller set X-Forwarded-For to whatever it wants.
 * Instead: read the raw TCP peer directly from the socket (unspoofable), and only honor
 * X-Forwarded-For when that direct peer is itself a trusted reverse proxy
 * (getMcpTrustedProxyIps). A caller that isn't behind a trusted proxy gets its own socket
 * address checked against the allowlist, spoofing the header buys it nothing.
 */
function resolveClientIp(req: Request): string {
    const directPeer = normalizeIp(req.socket.remoteAddress ?? 'unknown');

    if (isIpAllowed(directPeer, getMcpTrustedProxyIps())) {
        const forwardedFor = req.headers['x-forwarded-for'];
        const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
        const first = raw?.split(',')[0]?.trim();
        if (first) return normalizeIp(first);
    }

    return directPeer;
}

/** Dedicated rate limit for /mcp, independent of the confirmed-write limit inside auditGate.ts. */
export const mcpHttpRateLimit = expressRateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    // Keyed on resolveClientIp (proxy-aware, spoof-resistant), not the default req.ip, which
    // inherits the app-wide permissive `trust proxy: true` setting.
    keyGenerator: (req) => resolveClientIp(req),
    validate: { trustProxy: false },
    message: { jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests' }, id: null },
});

export async function requireMcpToken(req: McpTokenRequest, res: Response, next: NextFunction): Promise<void> {
    const ip = resolveClientIp(req);

    if (!isMcpEnabled() || !isMcpHttpEnabled()) {
        jsonRpcError(res, 503, -32001, 'MCP remote HTTP access is disabled from the LogviewR admin panel.');
        return;
    }

    const allowlist = getMcpHttpAllowedIps();
    if (!isIpAllowed(ip, allowlist)) {
        logger.warn('McpHttp', `Rejected /mcp request from disallowed IP ${ip}`);
        await securityNotificationService.notifyMcpAuthFailed('IP address not in allowlist', ip).catch(() => {});
        jsonRpcError(res, 403, -32002, 'IP address not allowed.');
        return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        await securityNotificationService.notifyMcpAuthFailed('missing bearer token', ip).catch(() => {});
        jsonRpcError(res, 401, -32003, 'Missing or malformed Authorization header.');
        return;
    }

    const rawToken = authHeader.slice('Bearer '.length).trim();
    const verified = McpApiTokenRepository.verifyToken(rawToken);
    if (!verified) {
        await securityNotificationService.notifyMcpAuthFailed('invalid, expired, or revoked token', ip).catch(() => {});
        jsonRpcError(res, 401, -32003, 'Invalid, expired, or revoked token.');
        return;
    }

    req.mcpToken = verified;
    runWithMcpContext({ actor: `http:${verified.name}`, scope: verified.scope }, () => next());
}
