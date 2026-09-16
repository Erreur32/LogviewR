/**
 * Resolves the real client IP without trusting the app-wide `trust proxy: true` setting
 * (server/index.ts), which lets any caller set X-Forwarded-For to whatever it wants. Reads the
 * raw TCP peer directly from the socket (unspoofable), and only honors X-Forwarded-For when
 * that direct peer is itself a trusted reverse proxy. Loopback is always trusted, matching the
 * documented single-machine reverse-proxy topology (network_mode: host); TRUSTED_PROXY_IPS env
 * var extends this for a proxy running elsewhere.
 *
 * Generalized from server/mcp/httpAuth.ts's resolveClientIp() for use by any IP-keyed rate
 * limiter or allowlist outside the MCP transport (e.g. server/routes/log-viewer.ts).
 */

import type { Request } from 'express';
import { isIpAllowed } from '../mcp/ipAllowlist.js';

function normalizeIp(ip: string): string {
    return ip.replace(/^::ffff:/, '');
}

function getTrustedProxyIps(): string[] {
    const fromEnv = process.env.TRUSTED_PROXY_IPS;
    const extra = fromEnv ? fromEnv.split(',').map((s) => s.trim()).filter(Boolean) : [];
    return [...new Set(['127.0.0.1', '::1', ...extra])];
}

export function resolveClientIp(req: Request): string {
    const directPeer = normalizeIp(req.socket.remoteAddress ?? 'unknown');

    if (isIpAllowed(directPeer, getTrustedProxyIps())) {
        const forwardedFor = req.headers['x-forwarded-for'];
        const raw = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
        const first = raw?.split(',')[0]?.trim();
        if (first) return normalizeIp(first);
    }

    return directPeer;
}
