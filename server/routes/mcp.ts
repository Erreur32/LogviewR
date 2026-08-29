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
import { isMcpEnabled, setMcpEnabled, getLastSeenAt } from '../mcp/mcpConfig.js';
import { McpActionAuditRepository, type McpAuditResult } from '../database/models/McpActionAudit.js';
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

export default router;
