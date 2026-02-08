/**
 * Info routes - Changelog and project info
 * Serves CHANGELOG.md for the Administration > Info tab
 */

import { Router } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { requireAuth } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/info/changelog
 * Returns the content of CHANGELOG.md (from project root)
 */
router.get('/changelog', requireAuth, asyncHandler(async (_req, res) => {
    try {
        const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
        const content = await fs.readFile(changelogPath, 'utf-8');
        res.json({
            success: true,
            result: { content }
        });
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            logger.warn('Info', 'CHANGELOG.md not found at project root');
            return res.json({
                success: true,
                result: { content: '# Changelog\n\n*Fichier non disponible.*' }
            });
        }
        logger.error('Info', 'Failed to read changelog:', error);
        throw error;
    }
}));

export default router;
