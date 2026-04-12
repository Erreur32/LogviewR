/**
 * Logs routes
 * 
 * Handles retrieval of activity logs
 */

import { Router } from 'express';
import { loggingService } from '../services/loggingService.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { autoLog } from '../middleware/loggingMiddleware.js';

const router = Router();

/** Extract log filters from query params (shared between GET / and GET /count) */
function parseLogFilters(query: Record<string, any>): Record<string, any> {
    const filters: any = {};
    if (query.userId)    filters.userId = Number.parseInt(query.userId as string, 10);
    if (query.pluginId)  filters.pluginId = query.pluginId as string;
    if (query.action)    filters.action = query.action as string;
    if (query.resource)  filters.resource = query.resource as string;
    if (query.level)     filters.level = query.level as string;
    if (query.startDate) filters.startDate = new Date(query.startDate as string);
    if (query.endDate)   filters.endDate = new Date(query.endDate as string);
    return filters;
}

// GET /api/logs - Get logs with filters (admin only)
router.get('/', requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const filters = parseLogFilters(req.query);
    filters.limit = Number.parseInt((req.query.limit as string) || '100', 10);
    filters.offset = Number.parseInt((req.query.offset as string) || '0', 10);

    const logs = loggingService.getLogs(filters);
    const total = loggingService.countLogs(filters);

    res.json({
        success: true,
        result: {
            logs,
            total,
            limit: filters.limit,
            offset: filters.offset
        }
    });
}));

// GET /api/logs/count - Get log count with filters (admin only)
router.get('/count', requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const filters = parseLogFilters(req.query);
    const count = loggingService.countLogs(filters);

    res.json({
        success: true,
        result: { count }
    });
}));

// DELETE /api/logs/cleanup - Cleanup old logs (admin only)
router.delete('/cleanup', requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { daysToKeep = '90' } = req.query;
    const days = Number.parseInt(daysToKeep as string, 10);

    if (Number.isNaN(days) || days < 1) {
        throw createError('daysToKeep must be a positive number', 400, 'INVALID_DAYS');
    }

    const deletedCount = loggingService.cleanupOldLogs(days);

    // Log the action
    await loggingService.logUserAction(
        req.user!.userId,
        req.user!.username,
        'logs.cleanup',
        'logs',
        {
            details: { daysToKeep: days, deletedCount },
            level: 'info'
        }
    );

    res.json({
        success: true,
        result: {
            message: `Deleted ${deletedCount} old log entries`,
            deletedCount
        }
    });
}), autoLog('logs.cleanup', 'logs'));

// DELETE /api/logs - Delete all logs (admin only)
router.delete('/', requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const deletedCount = loggingService.deleteAllLogs();

    // Log the action (before deletion, so it will be the last log)
    await loggingService.logUserAction(
        req.user!.userId,
        req.user!.username,
        'logs.deleteAll',
        'logs',
        {
            details: { deletedCount },
            level: 'warning'
        }
    );

    res.json({
        success: true,
        result: {
            message: `Deleted ${deletedCount} log entries`,
            deletedCount
        }
    });
}), autoLog('logs.deleteAll', 'logs'));

export default router;

