/**
 * Settings Routes
 * 
 * API endpoints for application settings (theme, analysis, etc.)
 */

import { Router } from 'express';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { AppConfigRepository } from '../database/models/AppConfig.js';
import { logger } from '../utils/logger.js';
import {
    getErrorAnalysisConfig,
    setErrorAnalysisConfig,
    ALLOWED_PLUGINS,
    type ErrorAnalysisConfig,
    type SecurityCheckDepth
} from '../config/errorAnalysisConfig.js';
import { invalidateErrorSummaryCache } from '../services/errorSummaryService.js';

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

/**
 * GET /api/settings/stats-ui
 * Get Stats Logs page UI preferences (e.g. help section visibility)
 */
router.get('/stats-ui', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        const json = AppConfigRepository.get('stats_ui_config');
        if (json) {
            const config = JSON.parse(json);
            res.json({
                success: true,
                result: {
                    statsHelpSectionVisible: config.statsHelpSectionVisible !== false
                }
            });
        } else {
            res.json({
                success: true,
                result: { statsHelpSectionVisible: true }
            });
        }
    } catch (error) {
        logger.error('Settings', 'Failed to get stats-ui config:', error);
        throw createError('Failed to get stats UI configuration', 500, 'STATS_UI_CONFIG_ERROR');
    }
}));

/**
 * POST /api/settings/stats-ui
 * Update Stats Logs page UI preferences
 */
router.post('/stats-ui', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        const { statsHelpSectionVisible } = req.body;
        const config = {
            statsHelpSectionVisible: statsHelpSectionVisible !== false
        };
        AppConfigRepository.set('stats_ui_config', JSON.stringify(config));
        res.json({
            success: true,
            result: config,
            message: 'Stats UI preferences saved'
        });
    } catch (error) {
        logger.error('Settings', 'Failed to save stats-ui config:', error);
        throw createError('Failed to save stats UI configuration', 500, 'STATS_UI_CONFIG_ERROR');
    }
}));

/**
 * GET /api/settings/analysis
 * Get error analysis config (dashboard "Files with errors" + security check options)
 */
router.get('/analysis', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        const config = getErrorAnalysisConfig();
        res.json({
            success: true,
            result: config
        });
    } catch (error) {
        logger.error('Settings', 'Failed to get analysis config:', error);
        throw createError('Failed to get analysis configuration', 500, 'ANALYSIS_CONFIG_ERROR');
    }
}));

/**
 * PUT /api/settings/analysis
 * Update error analysis config (admin only)
 */
router.put('/analysis', requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    try {
        const body = req.body as Partial<ErrorAnalysisConfig>;
        if (!body || typeof body !== 'object') {
            throw createError('Invalid request body', 400, 'INVALID_BODY');
        }
        if (Array.isArray(body.enabledPlugins)) {
            body.enabledPlugins = body.enabledPlugins.filter((id) =>
                typeof id === 'string' && ALLOWED_PLUGINS.includes(id as typeof ALLOWED_PLUGINS[number])
            );
        }
        if (typeof body.securityCheckDepth === 'string' &&
            !(['light', 'normal', 'deep'] as SecurityCheckDepth[]).includes(body.securityCheckDepth)) {
            body.securityCheckDepth = undefined;
        }
        const ok = setErrorAnalysisConfig(body);
        if (!ok) {
            throw createError('Failed to save analysis configuration', 500, 'ANALYSIS_CONFIG_SAVE_ERROR');
        }
        invalidateErrorSummaryCache();
        const config = getErrorAnalysisConfig();
        res.json({
            success: true,
            result: config,
            message: 'Analysis configuration saved successfully'
        });
    } catch (error) {
        logger.error('Settings', 'Failed to save analysis config:', error);
        if (error instanceof Error && error.message.includes('Invalid')) {
            throw error;
        }
        throw createError('Failed to save analysis configuration', 500, 'ANALYSIS_CONFIG_SAVE_ERROR');
    }
}));

export default router;
