/**
 * Settings Routes
 * 
 * API endpoints for application settings (theme, etc.)
 */

import { Router } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { AppConfigRepository } from '../database/models/AppConfig.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/settings/theme
 * Get current theme configuration
 */
router.get('/theme', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        const themeJson = AppConfigRepository.get('theme_config');
        
        if (themeJson) {
            const themeConfig = JSON.parse(themeJson);
            res.json({
                success: true,
                result: themeConfig
            });
        } else {
            // Return default theme config if none exists
            res.json({
                success: true,
                result: {
                    theme: 'dark',
                    customColors: undefined,
                    cardOpacity: undefined
                }
            });
        }
    } catch (error) {
        logger.error('Settings', 'Failed to get theme config:', error);
        throw createError('Failed to get theme configuration', 500, 'THEME_CONFIG_ERROR');
    }
}));

/**
 * POST /api/settings/theme
 * Update theme configuration
 */
router.post('/theme', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        const { theme, customColors, cardOpacity } = req.body;

        // Validate theme
        const validThemes = ['dark', 'glass', 'modern', 'nightly', 'neon', 'elegant', 'full-animation'];
        if (theme && !validThemes.includes(theme)) {
            throw createError(`Invalid theme: ${theme}. Must be one of: ${validThemes.join(', ')}`, 400, 'INVALID_THEME');
        }

        // Build theme config object
        const themeConfig: {
            theme: string;
            customColors?: Record<string, string>;
            cardOpacity?: number;
        } = {
            theme: theme || 'dark'
        };

        // Add custom colors if provided and not empty
        if (customColors && Object.keys(customColors).length > 0) {
            themeConfig.customColors = customColors;
        }

        // Add card opacity if provided (0.1-1)
        if (typeof cardOpacity === 'number') {
            themeConfig.cardOpacity = Math.max(0.1, Math.min(1, cardOpacity));
        }

        // Save to database
        AppConfigRepository.set('theme_config', JSON.stringify(themeConfig));
        
        res.json({
            success: true,
            result: themeConfig,
            message: 'Theme configuration saved successfully'
        });
    } catch (error) {
        logger.error('Settings', 'Failed to save theme config:', error);
        if (error instanceof Error && error.message.includes('INVALID_THEME')) {
            throw error;
        }
        throw createError('Failed to save theme configuration', 500, 'THEME_CONFIG_ERROR');
    }
}));

export default router;
