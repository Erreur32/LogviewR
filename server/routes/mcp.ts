/**
 * MCP admin routes
 *
 * Read-only observability + the enable/disable flag for LogviewR's MCP
 * server. The MCP process is a separate stdio process started by the user's
 * MCP client — these routes never talk to it directly, they only read/write
 * the shared SQLite state (app_config, mcp_action_audit) it also touches.
 */

import { Router } from 'express';
import expressRateLimit from 'express-rate-limit';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
    isMcpEnabled,
    setMcpEnabled,
    getLastSeenAt,
    isMcpHttpEnabled,
    setMcpHttpEnabled,
    getMcpHttpAllowedIps,
    setMcpHttpAllowedIps,
} from '../mcp/mcpConfig.js';
import { McpActionAuditRepository, type McpAuditResult } from '../database/models/McpActionAudit.js';
import { McpApiTokenRepository, MCP_TOKEN_MAX_EXPIRY_DAYS, type McpTokenScope } from '../database/models/McpApiToken.js';
import { attackCorrelationService } from '../services/attackCorrelationService.js';

const router = Router();

const mcpRateLimit = expressRateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});

router.use(mcpRateLimit, requireAuth, requireAdmin);

// GET /api/mcp/config
router.get('/config', asyncHandler(async (_req: AuthenticatedRequest, res) => {
    res.json({ success: true, result: { enabled: isMcpEnabled() } });
}));

// POST /api/mcp/config
router.post('/config', asyncHandler(async (req: AuthenticatedRequest, res) => {
    const enabled = req.body?.enabled === true;
    setMcpEnabled(enabled);
    res.json({ success: true, result: { enabled } });
}));

// GET /api/mcp/status
router.get('/status', asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const stats = McpActionAuditRepository.stats();
    res.json({
        success: true,
        result: {
            enabled: isMcpEnabled(),
            lastSeenAt: getLastSeenAt(),
            ...stats,
        },
    });
}));

// GET /api/mcp/audit
router.get('/audit', asyncHandler(async (req: AuthenticatedRequest, res) => {
    const limit = Number.parseInt(req.query.limit as string, 10) || 50;
    const offset = Number.parseInt(req.query.offset as string, 10) || 0;
    const filter = {
        toolName: (req.query.toolName as string) || undefined,
        actor: (req.query.actor as string) || undefined,
        result: (req.query.result as McpAuditResult) || undefined,
        limit,
        offset,
    };

    const entries = McpActionAuditRepository.list(filter);
    const total = McpActionAuditRepository.count(filter);

    res.json({ success: true, result: { entries, total, limit, offset } });
}));

// GET /api/mcp/threats
router.get('/threats', asyncHandler(async (req: AuthenticatedRequest, res) => {
    const windowHours = Number.parseFloat(req.query.windowHours as string) || 6;
    const clusters = await attackCorrelationService.getActiveThreats(windowHours);
    res.json({ success: true, result: { windowHours, clusters } });
}));

// GET /api/mcp/http-config
router.get('/http-config', asyncHandler(async (_req: AuthenticatedRequest, res) => {
    res.json({
        success: true,
        result: {
            httpEnabled: isMcpHttpEnabled(),
            allowedIps: getMcpHttpAllowedIps(),
        },
    });
}));

// POST /api/mcp/http-config
router.post('/http-config', asyncHandler(async (req: AuthenticatedRequest, res) => {
    if (typeof req.body?.httpEnabled === 'boolean') {
        setMcpHttpEnabled(req.body.httpEnabled);
    }
    if (Array.isArray(req.body?.allowedIps)) {
        const ips = req.body.allowedIps.filter((ip: unknown): ip is string => typeof ip === 'string');
        setMcpHttpAllowedIps(ips);
    }
    res.json({
        success: true,
        result: {
            httpEnabled: isMcpHttpEnabled(),
            allowedIps: getMcpHttpAllowedIps(),
        },
    });
}));

// GET /api/mcp/tokens
router.get('/tokens', asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const tokens = McpApiTokenRepository.list();
    res.json({ success: true, result: { tokens } });
}));

// POST /api/mcp/tokens
router.post('/tokens', asyncHandler(async (req: AuthenticatedRequest, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const scope: McpTokenScope = req.body?.scope === 'read_write' ? 'read_write' : 'read';
    const expiresInDays = Number.isFinite(req.body?.expiresInDays) ? Number(req.body.expiresInDays) : undefined;

    if (!name) {
        res.status(400).json({ success: true, result: { ok: false, error: 'Token name is required.' } });
        return;
    }
    if (expiresInDays !== undefined && (expiresInDays < 1 || expiresInDays > MCP_TOKEN_MAX_EXPIRY_DAYS)) {
        res.status(400).json({
            success: true,
            result: { ok: false, error: `expiresInDays must be between 1 and ${MCP_TOKEN_MAX_EXPIRY_DAYS}.` },
        });
        return;
    }

    const created = McpApiTokenRepository.create({
        name,
        scope,
        createdBy: req.user?.username || 'unknown-admin',
        expiresInDays,
    });

    res.json({ success: true, result: { token: created } });
}));

// DELETE /api/mcp/tokens/:id
router.delete('/tokens/:id', asyncHandler(async (req: AuthenticatedRequest, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        res.status(400).json({ success: true, result: { ok: false, error: 'Invalid token id.' } });
        return;
    }
    const revoked = McpApiTokenRepository.revoke(id);
    res.json({ success: true, result: { revoked } });
}));

export default router;
