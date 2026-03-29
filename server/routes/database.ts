/**
 * Database Management Routes
 * 
 * API endpoints for database performance configuration and statistics
 */

import { Router } from 'express';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { autoLog } from '../middleware/loggingMiddleware.js';
import {
    getDatabaseConfig,
    saveDatabaseConfig,
    getDatabaseStats,
    applyDatabaseConfig
} from '../database/dbConfig.js';
import { getDatabase } from '../database/connection.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/database/config
 * Get current database performance configuration
 */
router.get('/config', requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        const config = getDatabaseConfig();
        res.json({
            success: true,
            result: config
        });
    } catch (error: any) {
        logger.error('Database', 'Failed to get database config:', error);
        throw createError(error.message || 'Failed to get database config', 500, 'DB_CONFIG_ERROR');
    }
}));

/**
 * POST /api/database/config
 * Update database performance configuration
 */
router.post('/config', requireAuth, requireAdmin, autoLog('database', 'update-config'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        const config = req.body as Partial<import('../database/dbConfig.js').DatabasePerformanceConfig>;
        
        // Validate config values
        if (config.walMode && !['WAL', 'DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'OFF'].includes(config.walMode)) {
            throw createError('Invalid walMode value', 400, 'INVALID_WAL_MODE');
        }
        
        if (config.synchronous !== undefined && ![0, 1, 2].includes(config.synchronous)) {
            throw createError('Invalid synchronous value (must be 0, 1, or 2)', 400, 'INVALID_SYNCHRONOUS');
        }
        
        if (config.tempStore !== undefined && ![0, 1, 2].includes(config.tempStore)) {
            throw createError('Invalid tempStore value (must be 0, 1, or 2)', 400, 'INVALID_TEMP_STORE');
        }
        
        // Save and apply configuration
        const success = await saveDatabaseConfig(config);
        
        if (!success) {
            throw createError('Failed to save database configuration', 500, 'DB_CONFIG_SAVE_ERROR');
        }
        
        const updatedConfig = getDatabaseConfig();
        
        res.json({
            success: true,
            result: updatedConfig,
            message: 'Database configuration updated successfully'
        });
    } catch (error: any) {
        logger.error('Database', 'Failed to update database config:', error);
        throw error;
    }
}));

/**
 * GET /api/database/stats
 * Get database performance statistics
 * Note: requireAuth only (not requireAdmin) so dashboard can display stats
 */
router.get('/stats', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        const stats = getDatabaseStats();
        res.json({
            success: true,
            result: stats
        });
    } catch (error: any) {
        logger.error('Database', 'Failed to get database stats:', error);
        throw createError(error.message || 'Failed to get database stats', 500, 'DB_STATS_ERROR');
    }
}));

/**
 * POST /api/database/apply-config
 * Apply current database configuration (useful after manual changes)
 */
router.post('/apply-config', requireAuth, requireAdmin, autoLog('database', 'apply-config'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        applyDatabaseConfig();
        res.json({
            success: true,
            message: 'Database configuration applied successfully'
        });
    } catch (error: any) {
        logger.error('Database', 'Failed to apply database config:', error);
        throw createError(error.message || 'Failed to apply database config', 500, 'DB_CONFIG_APPLY_ERROR');
    }
}));

/**
 * GET /api/database/health
 * Run integrity/quick check and return fragmentation info.
 * Query param: ?full=1 for full integrity_check (slower), default is quick_check.
 */
router.get('/health', requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        const db = getDatabase();
        const full = req.query['full'] === '1';
        const pragma = full ? 'integrity_check' : 'quick_check';
        const rows = db.pragma(pragma) as Record<string, string>[];
        const firstValue = rows[0]?.[pragma] ?? rows[0]?.['integrity_check'] ?? '';
        const ok = rows.length === 1 && firstValue === 'ok';
        const freelistCount = db.pragma('freelist_count', { simple: true }) as number;
        const pageCount     = db.pragma('page_count',     { simple: true }) as number;
        const pageSize      = db.pragma('page_size',      { simple: true }) as number;
        const fragmentation = pageCount > 0 ? Math.round((freelistCount / pageCount) * 100) : 0;
        res.json({ success: true, result: { ok, full, checks: rows, freelistCount, pageCount, pageSize, fragmentation } });
    } catch (error: any) {
        logger.error('Database', 'Health check failed:', error);
        throw createError(error.message || 'Health check failed', 500, 'DB_HEALTH_ERROR');
    }
}));

/**
 * POST /api/database/vacuum
 * Compact the database file (reclaim freelist pages, defragment).
 * Uses better-sqlite3 db.exec() — hardcoded SQL, no injection risk.
 */
router.post('/vacuum', requireAuth, requireAdmin, autoLog('database', 'vacuum'), asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        const db = getDatabase();
        const pageSize  = db.pragma('page_size',  { simple: true }) as number;
        const beforePages = db.pragma('page_count', { simple: true }) as number;
        // db.exec is better-sqlite3 SQL executor — not child_process.exec
        db.exec('VACUUM');
        const afterPages = db.pragma('page_count', { simple: true }) as number;
        res.json({ success: true, result: { ok: true, beforeSize: beforePages * pageSize, afterSize: afterPages * pageSize, saved: (beforePages - afterPages) * pageSize } });
    } catch (error: any) {
        logger.error('Database', 'VACUUM failed:', error);
        throw createError(error.message || 'VACUUM failed', 500, 'DB_VACUUM_ERROR');
    }
}));

export default router;

