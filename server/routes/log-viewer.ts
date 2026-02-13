/**
 * Log Viewer Routes
 * 
 * API routes for log viewer functionality
 */

import { Router } from 'express';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { pluginManager } from '../services/pluginManager.js';
import { logParserService } from '../services/logParserService.js';
import { logReaderService } from '../services/logReaderService.js';
import { LogSourceRepository } from '../database/models/LogSource.js';
import { LogFileRepository } from '../database/models/LogFile.js';
import { PluginConfigRepository } from '../database/models/PluginConfig.js';
import type { LogSourcePlugin } from '../plugins/base/LogSourcePluginInterface.js';
import { logger } from '../utils/logger.js';
import { requireAuth } from '../middleware/authMiddleware.js';
import { generateRegexFromLogLine } from '../services/regexGeneratorService.js';
import { APACHE_ACCESS_VHOST_COMBINED_REGEX } from '../plugins/apache/ApacheParser.js';
import { APACHE_REGEX_KEYS, getApacheRegexKeyForPath, NPM_REGEX_KEYS, getNpmRegexKeyForPath, NGINX_REGEX_KEYS, getNginxRegexKeyForPath } from '../services/logParserService.js';
import { getAllAnalytics } from '../services/logAnalyticsService.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * Normalize file path to get the base log file path
 * Removes rotation numbers (.1, .2, .20240101) and compression extensions (.gz, .bz2, .xz)
 * Example: access.log.1.gz -> access.log
 */
function normalizeLogFilePath(filePath: string): string {
    // Remove rotation suffixes (.1, .2, .20240101, etc.) and compression extensions
    return filePath
        .replace(/\.\d+(\.(gz|bz2|xz))?$/, '') // Remove .1, .2, etc. optionally followed by compression
        .replace(/\.\d{8}(\.(gz|bz2|xz))?$/, '') // Remove .20240101, etc. optionally followed by compression
        .replace(/\.(gz|bz2|xz)$/, ''); // Remove compression extension if still present
}

/**
 * Resolve the base path to use for scanning log files.
 * Priority: 1) value from request (query/body), 2) plugin saved config (DB), 3) plugin default.
 * This ensures that when the frontend does not send basePath (e.g. LogViewer page calling
 * files-direct), we use the path configured in Settings (e.g. /home/docker/nginx_proxy/data/logs for NPM).
 */
function getEffectiveBasePath(
    pluginId: string,
    plugin: LogSourcePlugin,
    fromRequest: string | undefined
): string {
    if (fromRequest && typeof fromRequest === 'string' && fromRequest.trim()) {
        return fromRequest.trim();
    }
    const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
    const configured = pluginConfig?.settings?.basePath;
    if (configured && typeof configured === 'string' && configured.trim()) {
        return configured.trim();
    }
    return plugin.getDefaultBasePath();
}

/**
 * GET /api/log-viewer/plugins/:pluginId/files
 * List available log files for a plugin
 * 
 * Query params:
 * - quick=true: Only return non-compressed files for fast initial display
 */
router.get('/plugins/:pluginId/files', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { basePath, patterns, quick } = req.query;

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Check if plugin implements LogSourcePlugin
        if (!isLogSourcePlugin(plugin)) {
            return res.status(400).json({ error: `Plugin ${pluginId} does not implement LogSourcePlugin` });
        }

        // Get readCompressed setting from plugin configuration
        const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
        const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

        // Use base path from query, then from saved plugin config, then plugin default
        const actualBasePath = getEffectiveBasePath(pluginId, plugin, basePath as string);
        const actualPatterns = patterns 
            ? (Array.isArray(patterns) ? patterns as string[] : [patterns as string])
            : plugin.getDefaultFilePatterns();

        // Scan for log files
        const allFiles = await plugin.scanLogFiles(actualBasePath, actualPatterns);

        // Helper function to check if a file is compressed
        const isCompressedFile = (path: string): boolean => {
            return /\.(gz|bz2|xz)$/i.test(path);
        };

        // If quick mode, only process non-compressed files for fast response
        // If readCompressed is disabled, exclude .gz files anyway
        let files: typeof allFiles;
        if (quick === 'true') {
            // Quick mode: only non-compressed files
            files = allFiles.filter(file => !isCompressedFile(file.path));
        } else if (!readCompressed) {
            // Normal mode but readCompressed disabled: exclude .gz files
            files = allFiles.filter(file => !isCompressedFile(file.path));
        } else {
            // Normal mode with readCompressed enabled: include all files
            files = allFiles;
        }

        res.json({
            pluginId,
            basePath: actualBasePath,
            patterns: actualPatterns,
            files: files.map(file => ({
                path: file.path,
                type: file.type,
                size: file.size,
                modified: file.modified.toISOString()
            }))
        });
    } catch (error) {
        logger.error('LogViewer', 'Error listing files:', error);
        res.status(500).json({ 
            error: 'Failed to list log files',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * POST /api/log-viewer/plugins/:pluginId/scan
 * Scan for log files and optionally save them to database
 */
router.post('/plugins/:pluginId/scan', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { basePath, patterns, saveToDb, sourceId } = req.body;

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Check if plugin implements LogSourcePlugin
        if (!isLogSourcePlugin(plugin)) {
            return res.status(400).json({ error: `Plugin ${pluginId} does not implement LogSourcePlugin` });
        }

        // Use base path from body, then from saved plugin config, then plugin default
        const actualBasePath = getEffectiveBasePath(pluginId, plugin, basePath);
        const actualPatterns = patterns || plugin.getDefaultFilePatterns();

        // Scan for log files
        const files = await plugin.scanLogFiles(actualBasePath, actualPatterns);

        // Save to database if requested
        if (saveToDb && sourceId) {
            const savedFiles = [];
            for (const file of files) {
                const logFile = LogFileRepository.upsert({
                    sourceId: parseInt(sourceId, 10),
                    filePath: file.path,
                    logType: file.type,
                    enabled: true,
                    follow: true,
                    maxLines: 0 // 0 = no limit
                });
                savedFiles.push(logFile);
            }

            return res.json({
                pluginId,
                basePath: actualBasePath,
                patterns: actualPatterns,
                files: files.map(file => ({
                    path: file.path,
                    type: file.type,
                    size: file.size,
                    modified: file.modified.toISOString()
                })),
                saved: savedFiles.length
            });
        }

        res.json({
            pluginId,
            basePath: actualBasePath,
            patterns: actualPatterns,
            files: files.map(file => ({
                path: file.path,
                type: file.type,
                size: file.size,
                modified: file.modified.toISOString()
            }))
        });
    } catch (error) {
        logger.error('LogViewer', 'Error scanning files:', error);
        res.status(500).json({ 
            error: 'Failed to scan log files',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * GET /api/log-viewer/files/:fileId/logs
 * Read logs from a file
 */
router.get('/files/:fileId/logs', async (req, res) => {
    try {
        const { fileId } = req.params;
        const { maxLines = 0, fromLine = 0 } = req.query; // 0 = no limit (was 1000)

        // Get log file from database
        const logFile = LogFileRepository.findById(parseInt(fileId, 10));
        if (!logFile) {
            return res.status(404).json({ error: `Log file not found: ${fileId}` });
        }

        // Get source
        const source = LogSourceRepository.findById(logFile.sourceId);
        if (!source) {
            return res.status(404).json({ error: `Log source not found: ${logFile.sourceId}` });
        }

        // Get readCompressed from plugin settings
        const pluginConfig = PluginConfigRepository.findByPluginId(source.pluginId);
        const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

        // Parse log file
        const results = await logParserService.parseLogFile({
            pluginId: source.pluginId,
            filePath: logFile.filePath,
            logType: logFile.logType,
            maxLines: parseInt(maxLines as string, 10),
            fromLine: parseInt(fromLine as string, 10),
            readCompressed
        });

        // Get columns for this log type
        const columns = logParserService.getColumns(source.pluginId, logFile.logType);

        res.json({
            fileId: logFile.id,
            filePath: logFile.filePath,
            logType: logFile.logType,
            columns,
            logs: results.map(result => ({
                parsed: result.parsed,
                lineNumber: result.raw.lineNumber
            })),
            totalLines: results.length
        });
    } catch (error) {
        logger.error('LogViewer', 'Error reading logs:', error);
        res.status(500).json({ 
            error: 'Failed to read logs',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * GET /api/log-viewer/sources
 * List all log sources
 */
router.get('/sources', async (req, res) => {
    try {
        const sources = LogSourceRepository.findAll();
        res.json({ sources });
    } catch (error) {
        logger.error('LogViewer', 'Error listing sources:', error);
        res.status(500).json({ 
            error: 'Failed to list log sources',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * POST /api/log-viewer/sources
 * Create a new log source
 */
router.post('/sources', async (req, res) => {
    try {
        const input = req.body;
        const source = LogSourceRepository.create(input);
        res.status(201).json({ source });
    } catch (error) {
        logger.error('LogViewer', 'Error creating source:', error);
        res.status(500).json({ 
            error: 'Failed to create log source',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * GET /api/log-viewer/sources/:id
 * Get a log source by ID
 */
router.get('/sources/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const source = LogSourceRepository.findById(parseInt(id, 10));
        
        if (!source) {
            return res.status(404).json({ error: `Log source not found: ${id}` });
        }

        res.json({ source });
    } catch (error) {
        logger.error('LogViewer', 'Error getting source:', error);
        res.status(500).json({ 
            error: 'Failed to get log source',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * PUT /api/log-viewer/sources/:id
 * Update a log source
 */
router.put('/sources/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const input = req.body;
        const source = LogSourceRepository.update(parseInt(id, 10), input);
        
        if (!source) {
            return res.status(404).json({ error: `Log source not found: ${id}` });
        }

        res.json({ source });
    } catch (error) {
        logger.error('LogViewer', 'Error updating source:', error);
        res.status(500).json({ 
            error: 'Failed to update log source',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * DELETE /api/log-viewer/sources/:id
 * Delete a log source
 */
router.delete('/sources/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = LogSourceRepository.delete(parseInt(id, 10));
        
        if (!deleted) {
            return res.status(404).json({ error: `Log source not found: ${id}` });
        }

        // Also delete associated log files
        LogFileRepository.deleteBySourceId(parseInt(id, 10));

        res.json({ success: true });
    } catch (error) {
        logger.error('LogViewer', 'Error deleting source:', error);
        res.status(500).json({ 
            error: 'Failed to delete log source',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * GET /api/log-viewer/files
 * List all log files
 */
router.get('/files', async (req, res) => {
    try {
        const { sourceId } = req.query;
        
        const files = sourceId 
            ? LogFileRepository.findBySourceId(parseInt(sourceId as string, 10))
            : LogFileRepository.findAll();
        
        res.json({ files });
    } catch (error) {
        logger.error('LogViewer', 'Error listing files:', error);
        res.status(500).json({ 
            error: 'Failed to list log files',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * PUT /api/log-viewer/files/:id
 * Update a log file
 */
router.put('/files/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const input = req.body;
        const file = LogFileRepository.update(parseInt(id, 10), input);
        
        if (!file) {
            return res.status(404).json({ error: `Log file not found: ${id}` });
        }

        res.json({ file });
    } catch (error) {
        logger.error('LogViewer', 'Error updating file:', error);
        res.status(500).json({ 
            error: 'Failed to update log file',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * DELETE /api/log-viewer/files/:id
 * Delete a log file
 */
router.delete('/files/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = LogFileRepository.delete(parseInt(id, 10));
        
        if (!deleted) {
            return res.status(404).json({ error: `Log file not found: ${id}` });
        }

        res.json({ success: true });
    } catch (error) {
        logger.error('LogViewer', 'Error deleting file:', error);
        res.status(500).json({ 
            error: 'Failed to delete log file',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * POST /api/log-viewer/plugins/:pluginId/read-direct
 * Read logs directly from a file path without using database
 * Useful for testing without DB configuration
 */
router.post('/plugins/:pluginId/read-direct', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { filePath, logType, maxLines = 0, fromLine = 0 } = req.body; // 0 = no limit (was 1000)

        logger.info('LogViewer', `[read-direct] Request received: pluginId=${pluginId}, filePath=${filePath}, logType=${logType}, maxLines=${maxLines}, fromLine=${fromLine}`);

        if (!filePath || !logType) {
            logger.warn('LogViewer', `[read-direct] Missing required fields: filePath=${filePath}, logType=${logType}`);
            return res.status(400).json({ 
                error: 'Missing required fields: filePath and logType are required' 
            });
        }

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            logger.error('LogViewer', `[read-direct] Plugin not found: ${pluginId}`);
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        logger.debug('LogViewer', `[read-direct] Plugin found: ${pluginId}, type: ${plugin.constructor.name}`);

        // Check if plugin implements LogSourcePlugin
        if (!isLogSourcePlugin(plugin)) {
            logger.error('LogViewer', `[read-direct] Plugin ${pluginId} does not implement LogSourcePlugin`);
            return res.status(400).json({ error: `Plugin ${pluginId} does not implement LogSourcePlugin` });
        }

        logger.debug('LogViewer', `[read-direct] Starting to parse log file: ${filePath}`);

        // Get readCompressed from plugin settings
        const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
        const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

        // Parse log file directly
        const results = await logParserService.parseLogFile({
            pluginId,
            filePath,
            logType,
            maxLines: parseInt(maxLines as string, 10),
            fromLine: parseInt(fromLine as string, 10),
            readCompressed
        });

        logger.info('LogViewer', `[read-direct] Parsed ${results.length} log entries from ${filePath}`);

        // Debug: Check first few parsed entries for timestamp and hostname
        if (results.length > 0) {
            const firstEntry = results[0].parsed;
            logger.debug('LogViewer', `[read-direct] First entry sample:`, {
                hasTimestamp: !!firstEntry.timestamp,
                timestampType: firstEntry.timestamp ? typeof firstEntry.timestamp : 'none',
                timestampValue: firstEntry.timestamp instanceof Date ? firstEntry.timestamp.toISOString() : firstEntry.timestamp,
                hasHostname: !!firstEntry.hostname,
                hostnameValue: firstEntry.hostname,
                columns: Object.keys(firstEntry)
            });
        }

        // Get columns for this log type
        const columns = logParserService.getColumns(pluginId, logType);

        logger.debug('LogViewer', `[read-direct] Columns for logType ${logType}:`, columns.join(', '));

        const response = {
            success: true,
            result: {
                pluginId,
                filePath,
                logType,
                columns: Array.isArray(columns) ? columns : (typeof columns === 'string' ? [columns] : []),
                logs: results.map(result => ({
                    parsed: result.parsed,
                    lineNumber: result.raw.lineNumber
                })),
                totalLines: results.length
            }
        };

        logger.debug('LogViewer', `[read-direct] Sending response with ${response.result.logs.length} logs`);

        res.json(response);
    } catch (error) {
        logger.error('LogViewer', `[read-direct] Error reading logs directly:`, error);
        logger.error('LogViewer', `[read-direct] Error stack:`, error instanceof Error ? error.stack : 'No stack trace');
        res.status(500).json({ 
            error: 'Failed to read logs',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * POST /api/log-viewer/plugins/:pluginId/read-raw
 * Read raw log lines without parsing
 * Useful for viewing logs when parser is not ready
 */
router.post('/plugins/:pluginId/read-raw', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { filePath, maxLines = 0, fromLine = 0 } = req.body; // 0 = no limit (was 1000)

        logger.info('LogViewer', `[read-raw] Request received: pluginId=${pluginId}, filePath=${filePath}, maxLines=${maxLines}, fromLine=${fromLine}`);

        if (!filePath) {
            return res.status(400).json({ 
                error: 'Missing required field: filePath is required' 
            });
        }

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            logger.error('LogViewer', `[read-raw] Plugin not found: ${pluginId}`);
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Check if plugin implements LogSourcePlugin
        if (!isLogSourcePlugin(plugin)) {
            return res.status(400).json({ error: `Plugin ${pluginId} does not implement LogSourcePlugin` });
        }

        // Get readCompressed from plugin settings
        const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
        const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

        // Read raw log lines
        const logLines = await logReaderService.readLogFile(filePath, {
            maxLines: parseInt(maxLines as string, 10),
            fromLine: parseInt(fromLine as string, 10),
            encoding: 'utf8',
            readCompressed
        });

        logger.info('LogViewer', `[read-raw] Read ${logLines.length} raw log lines from ${filePath}`);

        const response = {
            success: true,
            result: {
                pluginId,
                filePath,
                lines: logLines.map(line => line.line),
                totalLines: logLines.length
            }
        };

        res.json(response);
    } catch (error) {
        logger.error('LogViewer', `[read-raw] Error reading raw logs:`, error);
        res.status(500).json({ 
            error: 'Failed to read raw logs',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * GET /api/log-viewer/plugins/:pluginId/files-direct
 * List available log files directly without using database
 * Useful for testing without DB configuration
 * 
 * Query params:
 * - quick=true: Only return non-compressed files for fast initial display
 */
router.get('/plugins/:pluginId/files-direct', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { basePath, patterns, quick } = req.query;

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Check if plugin implements LogSourcePlugin
        if (!isLogSourcePlugin(plugin)) {
            return res.status(400).json({ error: `Plugin ${pluginId} does not implement LogSourcePlugin` });
        }

        // Get readCompressed setting from plugin configuration
        const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
        const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

        // Use base path from query, then from saved plugin config, then plugin default (fixes Docker: LogViewer page does not send basePath)
        const actualBasePath = getEffectiveBasePath(pluginId, plugin, basePath as string);
        const actualPatterns = patterns
            ? (Array.isArray(patterns) ? patterns as string[] : [patterns as string])
            : plugin.getDefaultFilePatterns();

        // Scan for log files
        const allFiles = await plugin.scanLogFiles(actualBasePath, actualPatterns);

        // Helper function to check if a file is compressed
        const isCompressedFile = (path: string): boolean => {
            return /\.(gz|bz2|xz)$/i.test(path);
        };

        // If quick mode, only process non-compressed files for fast response
        // If readCompressed is disabled, exclude .gz files anyway
        let files: typeof allFiles;
        if (quick === 'true') {
            // Quick mode: only non-compressed files
            files = allFiles.filter(file => !isCompressedFile(file.path));
        } else if (!readCompressed) {
            // Normal mode but readCompressed disabled: exclude .gz files
            files = allFiles.filter(file => !isCompressedFile(file.path));
        } else {
            // Normal mode with readCompressed enabled: include all files
            files = allFiles;
        }

        // Check readability for each file
        const filesWithPermissions = await Promise.all(
            files.map(async (file) => {
                let readable = true;
                try {
                    await fs.access(file.path, fs.constants.R_OK);
                } catch (accessError: any) {
                    if (accessError.code === 'EACCES' || accessError.code === 'EPERM') {
                        readable = false;
                    }
                }
                return {
                    path: file.path,
                    type: file.type,
                    size: file.size,
                    modified: file.modified.toISOString(),
                    readable
                };
            })
        );

        res.json({
            success: true,
            result: {
                pluginId,
                basePath: actualBasePath,
                patterns: actualPatterns,
                files: filesWithPermissions
            }
        });
    } catch (error) {
        logger.error('LogViewer', 'Error listing files directly:', error);
        res.status(500).json({ 
            error: 'Failed to list log files',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * GET /api/log-viewer/sources/:id/stats
 * Get statistics for a log source
 * Returns: number of files, total size, last lines, recent errors
 */
router.get('/sources/:id/stats', async (req, res) => {
    try {
        const { id } = req.params;
        const source = LogSourceRepository.findById(parseInt(id, 10));
        
        if (!source) {
            return res.status(404).json({ error: `Log source not found: ${id}` });
        }

        // Get all files for this source
        const files = LogFileRepository.findBySourceId(parseInt(id, 10));

        // Get plugin
        const plugin = pluginManager.getPlugin(source.pluginId);
        if (!plugin || !isLogSourcePlugin(plugin)) {
            return res.status(400).json({ error: `Plugin ${source.pluginId} not found or does not implement LogSourcePlugin` });
        }

        // Get readCompressed setting from plugin configuration
        const pluginConfig = PluginConfigRepository.findByPluginId(source.pluginId);
        const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

        // Helper function to check if a file is compressed
        const isCompressedFile = (path: string): boolean => {
            return /\.(gz|bz2|xz)$/i.test(path);
        };

        // Calculate statistics
        const stats = {
            sourceId: source.id,
            sourceName: source.name,
            pluginId: source.pluginId,
            status: 'ok' as 'ok' | 'warning' | 'error',
            totalFiles: files.length,
            enabledFiles: 0,
            disabledFiles: 0,
            totalSize: 0,
            readableFiles: 0,
            unreadableFiles: 0,
            filesByType: {} as Record<string, { total: number; readable: number; unreadable: number; enabled: number; disabled: number }>,
            errors: [] as string[],
            lastUpdated: source.updatedAt
        };

        // Process each file
        for (const file of files) {
            const logType = file.logType || 'unknown';
            
            // Initialize type stats if needed
            if (!stats.filesByType[logType]) {
                stats.filesByType[logType] = { total: 0, readable: 0, unreadable: 0, enabled: 0, disabled: 0 };
            }
            stats.filesByType[logType].total++;
            
            // Count enabled/disabled
            if (file.enabled) {
                stats.enabledFiles++;
                stats.filesByType[logType].enabled++;
            } else {
                stats.disabledFiles++;
                stats.filesByType[logType].disabled++;
            }

            try {
                // Get file info (size, etc.)
                const fileInfo = await logReaderService.getFileInfo(file.filePath);
                stats.totalSize += fileInfo.size;

                // Test readability (only for enabled files)
                if (file.enabled) {
                    try {
                        const lines = await logReaderService.readLogFile(file.filePath, { 
                            maxLines: 1,
                            readCompressed: readCompressed && isCompressedFile(file.filePath)
                        });
                        
                        if (lines.length > 0 || fileInfo.size === 0) {
                            stats.readableFiles++;
                            stats.filesByType[logType].readable++;
                        } else {
                            stats.unreadableFiles++;
                            stats.filesByType[logType].unreadable++;
                            if (!isCompressedFile(file.filePath)) {
                                stats.errors.push(`Cannot read ${file.filePath}: File appears empty or inaccessible`);
                            }
                        }
                    } catch (error: any) {
                        stats.unreadableFiles++;
                        stats.filesByType[logType].unreadable++;
                        
                        if (error.code !== 'Z_DATA_ERROR') {
                            const errorMsg = error.code === 'EACCES' 
                                ? `Permission denied: ${file.filePath}`
                                : error.code === 'EPERM'
                                ? `Permission denied: ${file.filePath}`
                                : error.code === 'ENOENT'
                                ? `File not found: ${file.filePath}`
                                : `Error reading ${file.filePath}: ${error.message || error}`;
                            
                            stats.errors.push(errorMsg);
                        }
                    }
                }
            } catch (error: any) {
                // File doesn't exist or can't access
                stats.unreadableFiles++;
                stats.filesByType[logType].unreadable++;
                
                if (error.code === 'ENOENT') {
                    stats.errors.push(`File not found: ${file.filePath}`);
                } else if (error.code !== 'Z_DATA_ERROR') {
                    stats.errors.push(`Error accessing ${file.filePath}: ${error.message || error}`);
                }
            }
        }

        // Determine overall status
        if (stats.totalFiles === 0) {
            stats.status = 'error';
        } else if (stats.unreadableFiles === 0) {
            stats.status = 'ok';
        } else if (stats.readableFiles > 0) {
            stats.status = 'warning';
        } else {
            stats.status = 'error';
        }

        res.json({
            success: true,
            result: {
                sourceId: stats.sourceId,
                sourceName: stats.sourceName,
                pluginId: stats.pluginId,
                status: stats.status,
                totalFiles: stats.totalFiles,
                enabledFiles: stats.enabledFiles,
                disabledFiles: stats.disabledFiles,
                readableFiles: stats.readableFiles,
                unreadableFiles: stats.unreadableFiles,
                totalSize: stats.totalSize,
                filesByType: stats.filesByType,
                errors: stats.errors.slice(0, 10), // Limit errors to first 10
                lastUpdated: stats.lastUpdated.toISOString()
            }
        });
    } catch (error) {
        logger.error('LogViewer', 'Error getting source stats:', error);
        res.status(500).json({ 
            error: 'Failed to get source stats',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * GET /api/log-viewer/files/:id/stats
 * Get statistics for a log file
 * Returns: size, last lines, new lines since last read, status
 */
router.get('/files/:id/stats', async (req, res) => {
    try {
        const { id } = req.params;
        const logFile = LogFileRepository.findById(parseInt(id, 10));
        
        if (!logFile) {
            return res.status(404).json({ error: `Log file not found: ${id}` });
        }

        // Get source
        const source = LogSourceRepository.findById(logFile.sourceId);
        if (!source) {
            return res.status(404).json({ error: `Log source not found: ${logFile.sourceId}` });
        }

        // Get plugin
        const plugin = pluginManager.getPlugin(source.pluginId);
        if (!plugin || !isLogSourcePlugin(plugin)) {
            return res.status(400).json({ error: `Plugin ${source.pluginId} not found or does not implement LogSourcePlugin` });
        }

        // Get readCompressed setting from plugin configuration
        const pluginConfig = PluginConfigRepository.findByPluginId(source.pluginId);
        const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

        // Helper function to check if a file is compressed
        const isCompressedFile = (path: string): boolean => {
            return /\.(gz|bz2|xz)$/i.test(path);
        };

        // Get file info
        let fileInfo;
        let readable = false;
        let lastLines: string[] = [];
        let newLinesCount = 0;
        let errors: string[] = [];

        try {
            fileInfo = await logReaderService.getFileInfo(logFile.filePath);
            
            // Test readability
            try {
                const lines = await logReaderService.readLogFile(logFile.filePath, { 
                    maxLines: 10, // Get last 10 lines
                    readCompressed: readCompressed && isCompressedFile(logFile.filePath)
                });
                
                if (lines.length > 0 || fileInfo.size === 0) {
                    readable = true;
                    lastLines = lines.map(l => l.line);
                    
                    // Calculate new lines since last read
                    // If lastReadPosition is set, calculate difference
                    if (logFile.lastReadPosition !== undefined && logFile.lastReadPosition !== null) {
                        const totalLines = lines.length;
                        const currentPosition = totalLines;
                        newLinesCount = Math.max(0, currentPosition - logFile.lastReadPosition);
                    } else {
                        // Use newLinesCount from DB if available
                        newLinesCount = logFile.newLinesCount || 0;
                    }
                } else {
                    errors.push('File appears empty or inaccessible');
                }
            } catch (error: any) {
                if (error.code !== 'Z_DATA_ERROR') {
                    const errorMsg = error.code === 'EACCES' 
                        ? 'Permission denied'
                        : error.code === 'EPERM'
                        ? 'Permission denied'
                        : error.code === 'ENOENT'
                        ? 'File not found'
                        : `Error reading file: ${error.message || error}`;
                    
                    errors.push(errorMsg);
                }
            }
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                errors.push('File not found');
            } else {
                errors.push(`Error accessing file: ${error.message || error}`);
            }
        }

        // Determine status
        let status: 'active' | 'inactive' | 'error' = 'active';
        if (!logFile.enabled) {
            status = 'inactive';
        } else if (!readable || errors.length > 0) {
            status = 'error';
        }

        res.json({
            success: true,
            result: {
                fileId: logFile.id,
                filePath: logFile.filePath,
                logType: logFile.logType,
                status,
                enabled: logFile.enabled,
                follow: logFile.follow,
                size: fileInfo?.size || 0,
                readable,
                lastLines: lastLines.slice(0, 10), // Return last 10 lines
                newLinesCount,
                lastReadPosition: logFile.lastReadPosition || null,
                lastUpdated: logFile.updatedAt.toISOString(),
                errors: errors.slice(0, 5) // Limit errors to first 5
            }
        });
    } catch (error) {
        logger.error('LogViewer', 'Error getting file stats:', error);
        res.status(500).json({ 
            error: 'Failed to get file stats',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * GET /api/log-viewer/plugins/:pluginId/stats
 * Get statistics for a log source plugin
 * 
 * Query params:
 * - quick=true: Only return non-compressed files for fast initial display
 */
router.get('/plugins/:pluginId/stats', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { quick } = req.query;

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Check if plugin implements LogSourcePlugin
        if (!isLogSourcePlugin(plugin)) {
            return res.status(400).json({ error: `Plugin ${pluginId} does not implement LogSourcePlugin` });
        }

        // Get readCompressed setting from plugin configuration
        const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
        const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

        // Use saved plugin config basePath (same as files-direct) so dashboard/footer stats match configured path
        const basePath = getEffectiveBasePath(pluginId, plugin, undefined);
        const patterns = plugin.getDefaultFilePatterns();

        // Scan for log files
        const allFiles = await plugin.scanLogFiles(basePath, patterns);

        // Helper function to check if a file is compressed
        const isCompressedFile = (path: string): boolean => {
            return /\.(gz|bz2|xz)$/i.test(path);
        };

        // If quick mode, only process non-compressed files for fast response
        // If readCompressed is disabled, exclude .gz files anyway
        let files: typeof allFiles;
        if (quick === 'true') {
            // Quick mode: only non-compressed files
            files = allFiles.filter(file => !isCompressedFile(file.path));
        } else if (!readCompressed) {
            // Normal mode but readCompressed disabled: exclude .gz files
            files = allFiles.filter(file => !isCompressedFile(file.path));
        } else {
            // Normal mode with readCompressed enabled: include all files
            files = allFiles;
        }

        // Test readability of each file
        const stats = {
            pluginId,
            status: 'ok' as 'ok' | 'warning' | 'error',
            totalFiles: files.length,
            readableFiles: 0,
            unreadableFiles: 0,
            totalSize: 0, // Total size of all log files in bytes
            gzCount: 0, // Number of .gz files (for exporter/stats display)
            filesByType: {} as Record<string, { total: number; readable: number; unreadable: number }>,
            errors: [] as string[]
        };

        // Test each file
        for (const file of files) {
            const logType = file.type || 'unknown';
            if (/\.gz$/i.test(file.path)) stats.gzCount++;

            // Initialize type stats if needed
            if (!stats.filesByType[logType]) {
                stats.filesByType[logType] = { total: 0, readable: 0, unreadable: 0 };
            }
            stats.filesByType[logType].total++;

            // Add file size to total
            stats.totalSize += file.size;

            try {
                // Try to read first few lines to test readability
                // For compressed files, use readCompressed option
                const lines = await logReaderService.readLogFile(file.path, { 
                    maxLines: 1,
                    readCompressed: readCompressed && isCompressedFile(file.path)
                });
                
                if (lines.length > 0 || file.size === 0) {
                    // File is readable (or empty)
                    stats.readableFiles++;
                    stats.filesByType[logType].readable++;
                } else {
                    // File exists but couldn't read (may be corrupted gzip or empty)
                    stats.unreadableFiles++;
                    stats.filesByType[logType].unreadable++;
                    // Don't add to errors - corrupted gzip files are common and expected
                    // Only add if it's not a compressed file (compressed files that fail are likely corrupted)
                    if (!isCompressedFile(file.path)) {
                        stats.errors.push(`Cannot read ${file.path}: File appears empty or inaccessible`);
                    }
                }
            } catch (error: any) {
                // File is not readable
                stats.unreadableFiles++;
                stats.filesByType[logType].unreadable++;
                
                // Don't add corrupted gzip files to errors (Z_DATA_ERROR) - these are common
                if (error.code === 'Z_DATA_ERROR') {
                    // Corrupted gzip file - this is normal, don't add to errors
                    // Just mark as unreadable
                } else {
                    // Other errors should be reported
                    const errorMsg = error.code === 'EACCES' 
                        ? `Permission denied: ${file.path}`
                        : error.code === 'EPERM'
                        ? `Permission denied: ${file.path}`
                        : error.code === 'ENOENT'
                        ? `File not found: ${file.path}`
                        : `Error reading ${file.path}: ${error.message || error}`;
                    
                    stats.errors.push(errorMsg);
                }
            }
        }

        // Determine overall status
        if (stats.totalFiles === 0) {
            stats.status = 'error';
        } else if (stats.unreadableFiles === 0) {
            stats.status = 'ok';
        } else if (stats.readableFiles > 0) {
            stats.status = 'warning';
        } else {
            stats.status = 'error';
        }

        res.json({
            success: true,
            result: {
                pluginId,
                status: stats.status,
                totalFiles: stats.totalFiles,
                readableFiles: stats.readableFiles,
                unreadableFiles: stats.unreadableFiles,
                totalSize: stats.totalSize,
                gzCount: stats.gzCount,
                filesByType: stats.filesByType,
                errors: stats.errors.slice(0, 10) // Limit errors to first 10
            }
        });
    } catch (error) {
        logger.error('LogViewer', 'Error getting plugin stats:', error);
        res.status(500).json({ 
            error: 'Failed to get plugin stats',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * GET /api/log-viewer/largest-files
 * Get the largest log files across all plugins
 * 
 * Query params:
 * - quick=true: Only return non-compressed files for fast initial display
 */
router.get('/largest-files', async (req, res) => {
    try {
        const { limit = 10, quick } = req.query;
        const maxFiles = Math.min(parseInt(String(limit), 10) || 10, 50); // Max 50 files

        const allFiles: Array<{
            path: string;
            size: number;
            pluginId: string;
            pluginName: string;
            type: string;
            modified: Date;
            isCompressed: boolean;
        }> = [];

        // Helper function to check if a file is compressed
        const isCompressedFile = (path: string): boolean => {
            return /\.(gz|bz2|xz)$/i.test(path);
        };

        // Get all log source plugins
        const logSourcePlugins = ['host-system', 'nginx', 'apache', 'npm'];
        
        for (const pluginId of logSourcePlugins) {
            const plugin = pluginManager.getPlugin(pluginId);
            if (!plugin || !isLogSourcePlugin(plugin)) {
                continue;
            }

            // Get readCompressed setting
            const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
            const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

            try {
                const basePath = getEffectiveBasePath(pluginId, plugin, undefined);
                const patterns = plugin.getDefaultFilePatterns();
                const scannedFiles = await plugin.scanLogFiles(basePath, patterns);

                // Filter files based on quick mode and readCompressed setting
                let filteredFiles: typeof scannedFiles;
                if (quick === 'true') {
                    // Quick mode: only non-compressed files
                    filteredFiles = scannedFiles.filter(file => !isCompressedFile(file.path));
                } else if (!readCompressed) {
                    // Normal mode but readCompressed disabled: exclude .gz files
                    filteredFiles = scannedFiles.filter(file => !isCompressedFile(file.path));
                } else {
                    // Normal mode with readCompressed enabled: include all files
                    filteredFiles = scannedFiles;
                }

                for (const file of filteredFiles) {
                    const isCompressed = isCompressedFile(file.path);
                    allFiles.push({
                        path: file.path,
                        size: file.size,
                        pluginId,
                        pluginName: plugin.getName(),
                        type: file.type || 'unknown',
                        modified: file.modified,
                        isCompressed
                    });
                }
            } catch (error) {
                logger.warn('LogViewer', `Failed to scan files for plugin ${pluginId}:`, error);
                // Continue with other plugins
            }
        }

        // Sort by size (descending) and take top N
        const largestFiles = allFiles
            .sort((a, b) => b.size - a.size)
            .slice(0, maxFiles);

        res.json({
            success: true,
            result: {
                files: largestFiles.map(file => ({
                    path: file.path,
                    size: file.size,
                    pluginId: file.pluginId,
                    pluginName: file.pluginName,
                    type: file.type,
                    modified: file.modified.toISOString(),
                    isCompressed: file.isCompressed
                })),
                total: allFiles.length
            }
        });
    } catch (error) {
        logger.error('LogViewer', 'Error getting largest files:', error);
        res.status(500).json({ 
            error: 'Failed to get largest files',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * GET /api/log-viewer/analytics
 * Get aggregated log analytics (overview, timeseries, top metrics) for GoAccess-style stats page.
 *
 * Query params:
 * - pluginId: optional, filter by plugin (npm, apache, all) or omit for all
 * - from: optional ISO date string
 * - to: optional ISO date string
 * - bucket: optional, 'minute' | 'hour' | 'day' (default: hour)
 * - topLimit: optional, max items per top list (default: 10, max: 50)
 * - fileScope: optional, 'latest' | 'all' (default: all) - latest = only most recent file per plugin
 * - includeCompressed: optional, 'true' | 'false' - include .gz/.bz2/.xz when plugin has readCompressed enabled
 */
router.get('/analytics', async (req, res) => {
    try {
        const { pluginId, from, to, bucket, topLimit, fileScope, includeCompressed } = req.query;

        const fromDate = from && typeof from === 'string' ? new Date(from) : undefined;
        const toDate = to && typeof to === 'string' ? new Date(to) : undefined;
        const bucketVal = (bucket === 'minute' || bucket === 'hour' || bucket === 'day' ? bucket : 'hour') as 'minute' | 'hour' | 'day';
        const limit = topLimit ? Math.min(parseInt(String(topLimit), 10) || 10, 50) : 10;
        const fileScopeVal = (fileScope === 'latest' || fileScope === 'all' ? fileScope : 'all') as 'latest' | 'all';
        const includeCompressedVal = includeCompressed === 'true' || includeCompressed === '1';

        const result = await getAllAnalytics(
            pluginId && typeof pluginId === 'string' ? pluginId : undefined,
            fromDate && !isNaN(fromDate.getTime()) ? fromDate : undefined,
            toDate && !isNaN(toDate.getTime()) ? toDate : undefined,
            { bucket: bucketVal, topLimit: limit, fileScope: fileScopeVal, includeCompressed: includeCompressedVal }
        );

        res.json({
            success: true,
            result
        });
    } catch (error) {
        logger.error('LogViewer', 'Error getting analytics:', error);
        res.status(500).json({
            error: 'Failed to get analytics',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * Type guard to check if plugin implements LogSourcePlugin
 */
function isLogSourcePlugin(plugin: any): plugin is LogSourcePlugin {
    return (
        typeof plugin.scanLogFiles === 'function' &&
        typeof plugin.parseLogLine === 'function' &&
        typeof plugin.getColumns === 'function' &&
        typeof plugin.validateConfig === 'function'
    );
}

/**
 * GET /api/log-viewer/os-type
 * Get OS type for host-system plugin
 */
router.get('/os-type', async (req, res) => {
    try {
        const { detectOS } = await import('../plugins/host-system/OSDetector.js');
        const osInfo = await detectOS();
        
        res.json({
            success: true,
            result: {
                type: osInfo.type,
                version: osInfo.version,
                logFormat: osInfo.logFormat,
                usesISO8601: osInfo.usesISO8601
            }
        });
    } catch (error) {
        logger.error('LogViewer', 'Error getting OS type:', error);
        res.status(500).json({
            success: false,
            error: {
                message: 'Failed to get OS type',
                code: 'OS_DETECTION_ERROR'
            }
        });
    }
});

/**
 * GET /api/log-viewer/rsyslog-files
 * Parse rsyslog.conf to get configured log files
 * @deprecated Use /api/log-viewer/detect-logging-services instead
 */
router.get('/rsyslog-files', async (req, res) => {
    try {
        const { parseRsyslogConf, getRsyslogConfPath } = await import('../plugins/host-system/RsyslogParser.js');
        const rsyslogPath = getRsyslogConfPath();
        
        // Check if rsyslog.conf exists before trying to parse
        if (!fsSync.existsSync(rsyslogPath)) {
            // rsyslog.conf doesn't exist - return empty array (not an error)
            return res.json({
                success: true,
                result: {
                    rsyslogPath,
                    logFiles: []
                }
            });
        }
        
        const logFiles = await parseRsyslogConf(rsyslogPath);
        
        res.json({
            success: true,
            result: {
                rsyslogPath,
                logFiles
            }
        });
    } catch (error) {
        // Log error but return empty array instead of 500 error
        // This allows the frontend to continue loading even if rsyslog is not available
        logger.warn('LogViewer', 'Error parsing rsyslog.conf (returning empty array):', error instanceof Error ? error.message : error);
        res.json({
            success: true,
            result: {
                rsyslogPath: null,
                logFiles: []
            }
        });
    }
});

/**
 * GET /api/log-viewer/detect-logging-services
 * Automatically detect logging services (journalctl, syslog-ng, rsyslog) and their configured log files
 * Returns categorized log files (systemBaseFiles, autoDetectedFiles)
 */
router.get('/detect-logging-services', async (req, res) => {
    try {
        const { detectLoggingServices, getPrimaryLoggingService } = await import('../plugins/host-system/LoggingServiceDetector.js');
        const { detectOS } = await import('../plugins/host-system/OSDetector.js');
        
        // Get OS type for log rotation detection
        const osInfo = await detectOS();
        
        // Get all detected services
        const allServices = await detectLoggingServices();
        const primaryService = await getPrimaryLoggingService();
        
        // Get plugin instance to categorize files
        const { pluginManager } = await import('../services/pluginManager.js');
        const hostSystemPlugin = pluginManager.getPlugin('host-system');
        
        let categorizedFiles = {
            systemBaseFiles: [] as any[],
            autoDetectedFiles: [] as any[]
        };
        
        try {
            if (hostSystemPlugin && typeof (hostSystemPlugin as any).detectLoggingServicesConfig === 'function') {
                const result = await (hostSystemPlugin as any).detectLoggingServicesConfig();
                categorizedFiles = result.categorizedFiles;
            } else {
                // Fallback: categorize manually
                for (const service of allServices) {
                    for (const logFile of service.logFiles) {
                        const filename = path.basename(logFile.path).toLowerCase();
                        const isSystemBase = ['syslog', 'messages', 'auth.log', 'secure', 'kern.log', 'daemon.log', 'mail.log', 'maillog'].some(
                            critical => filename === critical || filename.startsWith(critical)
                        );
                        
                        if (isSystemBase) {
                            categorizedFiles.systemBaseFiles.push({
                                path: logFile.path,
                                type: logFile.type === 'journald' ? 'journald' : logFile.type,
                                enabled: true,
                                detected: true,
                                validated: logFile.source === 'config',
                                isSystemCritical: true
                            });
                        } else {
                            categorizedFiles.autoDetectedFiles.push({
                                path: logFile.path,
                                type: logFile.type === 'journald' ? 'syslog' : logFile.type,
                                enabled: true,
                                detected: true,
                                validated: logFile.source === 'config',
                                parserType: logFile.type
                            });
                        }
                    }
                }
            }
        } catch (detectError) {
            // If detectLoggingServicesConfig fails, use fallback
            logger.warn('LogViewer', 'Error in detectLoggingServicesConfig, using fallback:', detectError instanceof Error ? detectError.message : detectError);
            // Fallback: categorize manually
            for (const service of allServices) {
                for (const logFile of service.logFiles) {
                    const filename = path.basename(logFile.path).toLowerCase();
                    const isSystemBase = ['syslog', 'messages', 'auth.log', 'secure', 'kern.log', 'daemon.log', 'mail.log', 'maillog'].some(
                        critical => filename === critical || filename.startsWith(critical)
                    );
                    
                    if (isSystemBase) {
                        categorizedFiles.systemBaseFiles.push({
                            path: logFile.path,
                            type: logFile.type === 'journald' ? 'journald' : logFile.type,
                            enabled: true,
                            detected: true,
                            validated: logFile.source === 'config',
                            isSystemCritical: true
                        });
                    } else {
                        categorizedFiles.autoDetectedFiles.push({
                            path: logFile.path,
                            type: logFile.type === 'journald' ? 'syslog' : logFile.type,
                            enabled: true,
                            detected: true,
                            validated: logFile.source === 'config',
                            parserType: logFile.type
                        });
                    }
                }
            }
        }
        
        // Detect log rotation system
        let logRotationInfo = null;
        try {
            const { detectLogRotation } = await import('../plugins/host-system/LogRotationDetector.js');
            logRotationInfo = await detectLogRotation(osInfo.type);
        } catch (error) {
            logger.warn('LogViewer', 'Error detecting log rotation:', error instanceof Error ? error.message : error);
        }
        
        res.json({
            success: true,
            result: {
                primaryService: primaryService ? {
                    type: primaryService.type,
                    active: primaryService.active,
                    configPath: primaryService.configPath,
                    logFilesCount: primaryService.logFiles.length
                } : null,
                allServices: allServices.map(s => ({
                    type: s.type,
                    active: s.active,
                    configPath: s.configPath,
                    logFilesCount: s.logFiles.length
                })),
                categorizedFiles,
                logRotation: logRotationInfo
            }
        });
    } catch (error) {
        // Log error but return empty result instead of 500 error
        // This allows the frontend to continue loading even if detection fails
        logger.warn('LogViewer', 'Error detecting logging services (returning empty result):', error instanceof Error ? error.message : error);
        res.json({
            success: true,
            result: {
                primaryService: null,
                allServices: [],
                categorizedFiles: {
                    systemBaseFiles: [],
                    autoDetectedFiles: []
                },
                logRotation: null
            }
        });
    }
});

/**
 * GET /api/log-viewer/log-rotation-info
 * Detect log rotation system (logrotate) and get configured log files
 */
router.get('/log-rotation-info', async (req, res) => {
    try {
        const { detectLogRotation } = await import('../plugins/host-system/LogRotationDetector.js');
        const { detectOS } = await import('../plugins/host-system/OSDetector.js');
        
        const osInfo = await detectOS();
        const rotationInfo = await detectLogRotation(osInfo.type);
        
        res.json({
            success: true,
            result: rotationInfo
        });
    } catch (error) {
        logger.warn('LogViewer', 'Error detecting log rotation (returning empty result):', error instanceof Error ? error.message : error);
        res.json({
            success: true,
            result: {
                rotationSystem: 'unknown',
                active: false,
                configuredLogFiles: [],
                commonLogFiles: []
            }
        });
    }
});

/**
 * GET /api/log-viewer/default-log-files
 * Get default log files for host-system plugin based on OS
 */
router.get('/default-log-files', async (req, res) => {
    try {
        const { detectOS } = await import('../plugins/host-system/OSDetector.js');
        const { getDefaultLogFiles } = await import('../plugins/host-system/OSDetector.js');
        const osInfo = await detectOS();
        const defaultFiles = getDefaultLogFiles(osInfo.type);
        
        res.json({
            success: true,
            result: {
                osType: osInfo.type,
                logFiles: defaultFiles
            }
        });
    } catch (error) {
        // Log error but return empty result instead of 500 error
        // This allows the frontend to continue loading even if OS detection fails
        logger.warn('LogViewer', 'Error getting default log files (returning empty result):', error instanceof Error ? error.message : error);
        res.json({
            success: true,
            result: {
                osType: 'unknown',
                logFiles: []
            }
        });
    }
});

/**
 * GET /api/log-viewer/plugins/:pluginId/default-regex
 * Get default regex pattern for a log type
 */
router.get('/plugins/:pluginId/default-regex', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { logType } = req.query;

        if (!logType) {
            return res.status(400).json({ error: 'logType parameter is required' });
        }

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Get default regex based on plugin and log type
        let defaultRegex: string | null = null;

        if (pluginId === 'npm') {
            if (logType === 'access') {
                // NPM access log regex
                defaultRegex = '^(\\S+)\\s+-\\s+-\\s+\\[([^\\]]+)\\]\\s+"(\\S+)\\s+(\\S+)\\s+([^"]+)"\\s+(\\d+)\\s+(\\S+)\\s+"([^"]*)"\\s+"([^"]*)"(?:\\s+"([^"]*)")?(?:\\s+"([^"]*)")?(?:\\s+"([^"]*)")?';
            } else if (logType === 'error') {
                // NPM error log regex
                defaultRegex = '^(\\d{4}\\/\\d{2}\\/\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+\\[(\\w+)\\]\\s+(.+)$';
            }
        } else if (pluginId === 'nginx') {
            if (logType === 'access') {
                defaultRegex = '^(\\S+)\\s+-\\s+-\\s+\\[([^\\]]+)\\]\\s+"(\\S+)\\s+(\\S+)\\s+([^"]+)"\\s+(\\d+)\\s+(\\S+)\\s+"([^"]*)"\\s+"([^"]*)"(?:\\s+"([^"]*)")?';
            } else if (logType === 'error') {
                defaultRegex = '^(\\d{4}\\/\\d{2}\\/\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+\\[(\\w+)\\]\\s+(.+)$';
            }
        } else if (pluginId === 'apache') {
            if (logType === 'access') {
                // vhost_combined: %t %h %a %l %u %v "%r" %>s %O "%{Referer}i" "%{User-Agent}i" (timestamp first, then vhost)
                defaultRegex = APACHE_ACCESS_VHOST_COMBINED_REGEX;
            } else if (logType === 'error') {
                defaultRegex = '^\\[([^\\]]+)\\]\\s+\\[(\\w+)\\]\\s+(?:\\[([^\\]]+)\\]\\s+)?(.+)$';
            }
        } else if (pluginId === 'host-system') {
            // System logs use various formats, return a generic syslog pattern
            if (logType === 'syslog' || logType === 'auth' || logType === 'daemon' || logType === 'kern' || logType === 'mail') {
                defaultRegex = '^(?:<(\\d+)>)?(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}[^\\s]+)\\s+(\\S+)\\s+(\\S+)(?:\\[(\\d+)\\])?:\\s+(.+)$';
            }
        }

        res.json({
            success: true,
            result: {
                regex: defaultRegex || ''
            }
        });
    } catch (error) {
        logger.error('LogViewer', 'Failed to get default regex:', error);
        res.status(500).json({ error: 'Failed to get default regex' });
    }
});

/**
 * GET /api/log-viewer/plugins/:pluginId/regex-config
 * Get custom regex configuration for a file
 */
router.get('/plugins/:pluginId/regex-config', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { filePath } = req.query;

        if (!filePath) {
            return res.status(400).json({ error: 'filePath parameter is required' });
        }

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Get plugin config from database
        const dbConfig = PluginConfigRepository.findByPluginId(pluginId);
        if (!dbConfig || !dbConfig.settings) {
            return res.json({
                success: true,
                result: { regex: null }
            });
        }

        // Check for custom regex in plugin settings
        // Format: { customRegex: { [filePath]: { regex: string, logType: string } } }
        const customRegex = (dbConfig.settings as any).customRegex;
        
        // First, try to find regex for the exact file path
        if (customRegex && customRegex[filePath as string]) {
            return res.json({
                success: true,
                result: {
                    regex: customRegex[filePath as string].regex,
                    logType: customRegex[filePath as string].logType
                }
            });
        }
        
        // If not found, try to find regex for the base log file (without rotation/compression)
        // Example: access.log.1.gz -> access.log
        const baseFilePath = normalizeLogFilePath(filePath as string);
        if (baseFilePath !== filePath && customRegex && customRegex[baseFilePath]) {
            return res.json({
                success: true,
                result: {
                    regex: customRegex[baseFilePath].regex,
                    logType: customRegex[baseFilePath].logType
                }
            });
        }

        res.json({
            success: true,
            result: { regex: null }
        });
    } catch (error) {
        logger.error('LogViewer', 'Failed to get regex config:', error);
        res.status(500).json({ error: 'Failed to get regex config' });
    }
});

/**
 * PUT /api/log-viewer/plugins/:pluginId/regex-config
 * Save custom regex configuration for a file
 */
router.put('/plugins/:pluginId/regex-config', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { filePath, logType, regex } = req.body;

        if (!filePath || !regex) {
            return res.status(400).json({ error: 'filePath and regex are required' });
        }

        // Validate regex
        try {
            new RegExp(regex);
        } catch (err) {
            return res.status(400).json({ error: `Invalid regex: ${err instanceof Error ? err.message : String(err)}` });
        }

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Get current config from database
        const dbConfig = PluginConfigRepository.findByPluginId(pluginId);
        const currentSettings = dbConfig?.settings || {};
        
        // Initialize customRegex if it doesn't exist
        if (!(currentSettings as any).customRegex) {
            (currentSettings as any).customRegex = {};
        }

        // Normalize file path to base log file (remove rotation/compression)
        // This ensures that access.log, access.log.1, access.log.gz, access.log.1.gz all use the same regex
        const normalizedFilePath = normalizeLogFilePath(filePath);

        // Save regex for the normalized file path
        (currentSettings as any).customRegex[normalizedFilePath] = {
            regex: regex.trim(),
            logType: logType || 'custom',
            updatedAt: new Date().toISOString()
        };

        // Update plugin config in database
        PluginConfigRepository.upsert({
            pluginId: pluginId,
            enabled: dbConfig?.enabled ?? false,
            settings: currentSettings
        });

        // Reinitialize plugin to apply changes
        await pluginManager.updatePluginConfig(pluginId, {
            settings: currentSettings
        });

        res.json({
            success: true,
            result: {
                message: 'Regex configuration saved successfully'
            }
        });
    } catch (error) {
        logger.error('LogViewer', 'Failed to save regex config:', error);
        res.status(500).json({ error: 'Failed to save regex config' });
    }
});

/**
 * GET /api/log-viewer/plugins/:pluginId/custom-regex-count
 * Get count of custom regexes for a plugin
 */
router.get('/plugins/:pluginId/custom-regex-count', async (req, res) => {
    try {
        const { pluginId } = req.params;

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Get plugin config from database
        const dbConfig = PluginConfigRepository.findByPluginId(pluginId);
        if (!dbConfig || !dbConfig.settings) {
            return res.json({
                success: true,
                result: { count: 0 }
            });
        }

        // Check for custom regex in plugin settings
        const customRegex = (dbConfig.settings as any).customRegex;
        const count = customRegex && typeof customRegex === 'object' 
            ? Object.keys(customRegex).length 
            : 0;

        res.json({
            success: true,
            result: { count }
        });
    } catch (error) {
        logger.error('LogViewer', 'Failed to get custom regex count:', error);
        res.status(500).json({ error: 'Failed to get custom regex count' });
    }
});

/**
 * GET /api/log-viewer/custom-regexes
 * Get all custom regexes from all plugins
 */
router.get('/custom-regexes', async (req, res) => {
    try {
        const result: Record<string, Record<string, { regex: string; logType: string; updatedAt?: string }>> = {};

        // Get all plugins
        const allPlugins = pluginManager.getAllPlugins();
        
        for (const plugin of allPlugins) {
            const pluginId = plugin.getId();
            
            // Get plugin config from database
            const dbConfig = PluginConfigRepository.findByPluginId(pluginId);
            if (!dbConfig || !dbConfig.settings) {
                continue;
            }

            // Check for custom regex in plugin settings
            const customRegex = (dbConfig.settings as any).customRegex;
            if (customRegex && typeof customRegex === 'object' && Object.keys(customRegex).length > 0) {
                result[pluginId] = {};
                Object.entries(customRegex).forEach(([filePath, config]: [string, any]) => {
                    result[pluginId][filePath] = {
                        regex: config.regex || '',
                        logType: config.logType || 'custom',
                        updatedAt: config.updatedAt
                    };
                });
            }
        }

        res.json({
            success: true,
            result
        });
    } catch (error) {
        logger.error('LogViewer', 'Failed to get custom regexes:', error);
        res.status(500).json({ error: 'Failed to get custom regexes' });
    }
});

/**
 * DELETE /api/log-viewer/plugins/:pluginId/regex-config
 * Delete a custom regex configuration for a file
 */
router.delete('/plugins/:pluginId/regex-config', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { filePath } = req.query;

        if (!filePath || typeof filePath !== 'string') {
            return res.status(400).json({ error: 'filePath query parameter is required' });
        }

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Get current config from database
        const dbConfig = PluginConfigRepository.findByPluginId(pluginId);
        if (!dbConfig || !dbConfig.settings) {
            return res.json({
                success: true,
                result: { message: 'No regex config found' }
            });
        }

        const currentSettings = dbConfig.settings as any;
        
        // Normalize file path to base log file (remove rotation/compression)
        const normalizedFilePath = normalizeLogFilePath(filePath);
        
        // Remove regex for this file (try both original and normalized paths)
        let deleted = false;
        if (currentSettings.customRegex) {
            if (currentSettings.customRegex[filePath]) {
                delete currentSettings.customRegex[filePath];
                deleted = true;
            }
            if (currentSettings.customRegex[normalizedFilePath] && normalizedFilePath !== filePath) {
                delete currentSettings.customRegex[normalizedFilePath];
                deleted = true;
            }
            
            // If no more custom regexes, remove the customRegex object
            if (Object.keys(currentSettings.customRegex).length === 0) {
                delete currentSettings.customRegex;
            }
        }

        if (deleted) {
            // Update plugin config in database
            PluginConfigRepository.upsert({
                pluginId: pluginId,
                enabled: dbConfig.enabled ?? false,
                settings: currentSettings
            });

            // Reinitialize plugin to apply changes
            await pluginManager.updatePluginConfig(pluginId, {
                settings: currentSettings
            });
        }

        res.json({
            success: true,
            result: {
                message: 'Regex configuration deleted successfully'
            }
        });
    } catch (error) {
        logger.error('LogViewer', 'Failed to delete regex config:', error);
        res.status(500).json({ error: 'Failed to delete regex config' });
    }
});

/**
 * POST /api/log-viewer/plugins/:pluginId/detect-format
 * Detect log format for a file using automatic format detection
 */
router.post('/plugins/:pluginId/detect-format', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { filePath, sampleSize } = req.body;

        if (!filePath || typeof filePath !== 'string') {
            return res.status(400).json({ error: 'filePath is required and must be a string' });
        }

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Check if plugin implements LogSourcePlugin
        if (!isLogSourcePlugin(plugin)) {
            return res.status(400).json({ error: `Plugin ${pluginId} does not implement LogSourcePlugin` });
        }

        // Import LogFormatDetector dynamically (only for host-system plugin)
        if (pluginId === 'host-system') {
            const { detectLogFormat, validateDetectedFormat } = await import('../plugins/host-system/LogFormatDetector.js');
            
            const detectedFormat = await detectLogFormat(filePath, sampleSize || 50);
            
            if (!detectedFormat) {
                return res.status(404).json({ error: 'Could not detect format' });
            }

            // Validate the detected format
            const isValidated = await validateDetectedFormat(filePath, detectedFormat, 100);

            res.json({
                success: true,
                result: {
                    format: detectedFormat.format,
                    confidence: detectedFormat.confidence,
                    parserType: detectedFormat.parserType,
                    patternName: detectedFormat.patternName,
                    sampleMatches: detectedFormat.sampleMatches,
                    totalSamples: detectedFormat.totalSamples,
                    validated: isValidated
                }
            });
        } else {
            // For other plugins, return format based on logType detection
            const logType = (plugin as any).determineLogType?.(filePath) || 'custom';
            res.json({
                success: true,
                result: {
                    format: logType,
                    confidence: 100,
                    parserType: logType,
                    patternName: `${pluginId}-${logType}`,
                    sampleMatches: 0,
                    totalSamples: 0,
                    validated: true
                }
            });
        }
    } catch (error) {
        logger.error('LogViewer', 'Failed to detect format:', error);
        res.status(500).json({ 
            error: 'Failed to detect format',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

/**
 * POST /api/log-viewer/generate-regex
 * Generate a regex pattern from a log line
 */
router.post('/generate-regex', async (req, res) => {
    try {
        const { logLine } = req.body;

        if (!logLine || typeof logLine !== 'string') {
            return res.status(400).json({ error: 'logLine is required and must be a string' });
        }

        const result = generateRegexFromLogLine(logLine);

        res.json({
            success: true,
            result
        });
    } catch (error) {
        logger.error('LogViewer', 'Failed to generate regex:', error);
        res.status(500).json({ 
            error: error instanceof Error ? error.message : 'Failed to generate regex' 
        });
    }
});

/**
 * GET /api/log-viewer/plugins/:pluginId/detected-files
 * Used ONLY by the "Files detected with regex" section in Settings > Plugins (regex options).
 * Returns files + regex info for editing. Does NOT affect the log file selector (header/dropdown),
 * which uses GET /plugins/:pluginId/files-direct and shows the full list of scanned files.
 *
 * For Apache: returns 3 generic entries (access.log, error.log, access_*.log) + custom per-file.
 * For NPM: returns 10 generic entries (proxy-host-*_access/error, default-host, fallback, dead-host, letsencrypt) + custom.
 * For Nginx: returns 2 generic entries (access.log, error.log) + custom per-file.
 *
 * Query params:
 * - quick=true: Only return non-compressed files for fast initial display
 */
router.get('/plugins/:pluginId/detected-files', async (req, res) => {
    try {
        const { pluginId } = req.params;
        const { basePath, quick } = req.query;

        // Get plugin
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin) {
            return res.status(404).json({ error: `Plugin not found: ${pluginId}` });
        }

        // Check if plugin implements LogSourcePlugin
        if (!isLogSourcePlugin(plugin)) {
            return res.status(400).json({ error: `Plugin ${pluginId} does not implement LogSourcePlugin` });
        }

        // Get readCompressed setting from plugin configuration
        const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
        const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

        // Use base path from query, then from saved plugin config, then plugin default
        const actualBasePath = getEffectiveBasePath(pluginId, plugin, basePath as string);
        const actualPatterns = plugin.getDefaultFilePatterns();

        // Get plugin config to check for manually added files
        const dbConfig = PluginConfigRepository.findByPluginId(pluginId);
        
        // For host-system: exclude manually added files (only show OS-detected files)
        // Get manually added files from plugin config
        let manuallyAddedFiles: string[] = [];
        if (pluginId === 'host-system') {
            const hostSystemConfig = dbConfig?.settings as any;
            if (hostSystemConfig?.logFiles && Array.isArray(hostSystemConfig.logFiles)) {
                manuallyAddedFiles = hostSystemConfig.logFiles
                    .filter((f: any) => f.enabled !== false)
                    .map((f: any) => f.path);
            }
        }

        // Scan for log files
        const allFiles = await plugin.scanLogFiles(actualBasePath, actualPatterns);

        // Helper function to check if a file is compressed
        const isCompressedFile = (path: string): boolean => {
            return /\.(gz|bz2|xz)$/i.test(path);
        };

        // If quick mode, only process non-compressed files for fast response
        // If readCompressed is disabled, exclude .gz files anyway
        let files: typeof allFiles;
        if (quick === 'true') {
            // Quick mode: only non-compressed files
            files = allFiles.filter(file => !isCompressedFile(file.path));
        } else if (!readCompressed) {
            // Normal mode but readCompressed disabled: exclude .gz files
            files = allFiles.filter(file => !isCompressedFile(file.path));
        } else {
            // Normal mode with readCompressed enabled: include all files
            files = allFiles;
        }

        // Import parsers to get default regex
        let getDefaultRegex: ((logType: string) => string) | null = null;
        
        if (pluginId === 'apache') {
            const { getApacheDefaultRegex } = await import('../plugins/apache/ApacheParser.js');
            getDefaultRegex = (logType: string) => {
                if (logType === 'access' || logType === 'error') {
                    return getApacheDefaultRegex(logType as 'access' | 'error');
                }
                return '';
            };
        } else if (pluginId === 'nginx') {
            // Nginx uses inline regex, we'll provide common patterns
            getDefaultRegex = (logType: string) => {
                if (logType === 'access') {
                    return '^(\\S+)\\s+-\\s+(\\S+)\\s+\\[([^\\]]+)\\]\\s+"([^"]+)"\\s+(\\d{3})\\s+(\\d+)\\s+"([^"]*)"\\s+"([^"]*)"';
                } else if (logType === 'error') {
                    return '^(\\d{4}\\/\\d{2}\\/\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+\\[(\\w+)\\]\\s+(.+)$';
                }
                return '';
            };
        } else if (pluginId === 'npm') {
            // NPM uses inline regex, we'll provide common patterns
            getDefaultRegex = (logType: string) => {
                if (logType === 'access') {
                    return '^\\[([^\\]]+)\\]\\s+(\\S+)\\s+(\\S+)\\s+(\\d+)\\s+-\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+"([^"]+)"\\s+\\[Client\\s+([\\d\\.]+)\\]';
                } else if (logType === 'error') {
                    return '^(\\d{4}\\/\\d{2}\\/\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+\\[(\\w+)\\]\\s+(.+)$';
                }
                return '';
            };
        } else if (pluginId === 'host-system') {
            getDefaultRegex = (logType: string) => {
                // Generic syslog pattern
                return '^(?:<(\\d+)>)?(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}[^\\s]+)\\s+(\\S+)\\s+(\\S+)(?:\\[(\\d+)\\])?:\\s+(.+)$';
            };
        }

        // Get custom regexes from database (already loaded above)
        const customRegexes = (dbConfig?.settings as any)?.customRegex || {};

        // Get default regexes from database (plugin-level overrides)
        const defaultRegexOverrides = (dbConfig?.settings as any)?.defaultRegex || {};

        // For host-system: include files from rotation config if they exist
        if (pluginId === 'host-system') {
            try {
                const { detectLogRotation } = await import('../plugins/host-system/LogRotationDetector.js');
                const { detectOS } = await import('../plugins/host-system/OSDetector.js');
                const osInfo = await detectOS();
                const rotationInfo = await detectLogRotation(osInfo.type);
                
                // Add rotation config files to the list if they exist and aren't already in the list
                if (rotationInfo.configuredLogFiles && rotationInfo.configuredLogFiles.length > 0) {
                    for (const rotationFile of rotationInfo.configuredLogFiles) {
                        // Check if file exists
                        try {
                            await fs.access(rotationFile.path);
                            // Check if already in files list
                            const existsInFiles = files.some(f => f.path === rotationFile.path);
                            if (!existsInFiles) {
                                // Get file stats
                                try {
                                    const stats = await fs.stat(rotationFile.path);
                                    // Add to files list
                                    files.push({
                                        path: rotationFile.path,
                                        type: rotationFile.type === 'syslog' ? 'syslog' : rotationFile.type,
                                        size: stats.size,
                                        modified: stats.mtime
                                    });
                                } catch {
                                    // Can't get stats, skip
                                }
                            }
                        } catch {
                            // File doesn't exist, skip
                        }
                    }
                }
            } catch (error) {
                // If rotation detection fails, continue without rotation files
                logger.warn('LogViewer', 'Error detecting rotation files:', error instanceof Error ? error.message : error);
            }
        }

        // For host-system: filter out manually added files (they will be added separately with their regex)
        let filesToProcess = files;
        if (pluginId === 'host-system' && manuallyAddedFiles.length > 0) {
            filesToProcess = files.filter(file => !manuallyAddedFiles.includes(file.path));
        }

        // Apache: return only 3 generic regex entries (access.log, error.log, access_*.log) + custom per-file entries
        if (pluginId === 'apache') {
            const { getApacheDefaultRegex } = await import('../plugins/apache/ApacheParser.js');
            const defaultAccessRegex = APACHE_ACCESS_VHOST_COMBINED_REGEX;
            const defaultErrorRegex = getApacheDefaultRegex('error');
            const apacheVirtualKeys = [
                { path: APACHE_REGEX_KEYS.ACCESS, type: 'access' as const, defaultRegex: defaultAccessRegex },
                { path: APACHE_REGEX_KEYS.ERROR, type: 'error' as const, defaultRegex: defaultErrorRegex },
                { path: APACHE_REGEX_KEYS.ACCESS_VHOST, type: 'access' as const, defaultRegex: defaultAccessRegex }
            ];
            const result: Array<{
                path: string;
                type: string;
                size: number;
                modified: string;
                regex: string;
                isCustom: boolean;
                isDefaultOverride: boolean;
                defaultRegex: string;
            }> = [];
            const genericKeys: string[] = [APACHE_REGEX_KEYS.ACCESS, APACHE_REGEX_KEYS.ERROR, APACHE_REGEX_KEYS.ACCESS_VHOST];
            // Custom keys (e.g. full path from header editor): replace the generic row for the same slot
            const customKeysOnly = (Object.keys(customRegexes) as string[]).filter(k => !genericKeys.includes(k));
            const genericKeysReplacedByCustom = new Set<string>();
            for (const customPath of customKeysOnly) {
                const slot = getApacheRegexKeyForPath(customPath);
                if (slot) genericKeysReplacedByCustom.add(slot);
            }
            // Add generic row only if no custom entry replaces this slot
            for (const { path: virtualPath, type: virtualType, defaultRegex: defRegex } of apacheVirtualKeys) {
                if (genericKeysReplacedByCustom.has(virtualPath)) continue;
                const customRegex = customRegexes[virtualPath];
                const defaultRegexOverride = defaultRegexOverrides[virtualType];
                let regex: string;
                let isDefaultOverride = false;
                if (customRegex) {
                    regex = customRegex.regex;
                } else if (defaultRegexOverride) {
                    regex = defaultRegexOverride;
                    isDefaultOverride = true;
                } else {
                    regex = defRegex;
                }
                result.push({
                    path: virtualPath,
                    type: virtualType,
                    size: 0,
                    modified: new Date().toISOString(),
                    regex,
                    isCustom: !!customRegex,
                    isDefaultOverride,
                    defaultRegex: defRegex
                });
            }
            // Custom entries: replace generic row (no duplicate slot)
            for (const [customPath, config] of Object.entries(customRegexes) as [string, any][]) {
                if (genericKeys.includes(customPath)) continue;
                result.push({
                    path: customPath,
                    type: config.logType || 'access',
                    size: 0,
                    modified: config.updatedAt || new Date().toISOString(),
                    regex: config.regex || '',
                    isCustom: true,
                    isDefaultOverride: false,
                    defaultRegex: customPath.includes('error') ? defaultErrorRegex : defaultAccessRegex
                });
            }
            return res.json({
                success: true,
                result: {
                    pluginId,
                    basePath: actualBasePath,
                    patterns: actualPatterns,
                    files: result
                }
            });
        }

        // NPM: return only virtual regex entries (one per pattern) + custom per-file entries (like Apache)
        if (pluginId === 'npm') {
            const defaultNpmAccessRegex = '^(\\S+)\\s+-\\s+-\\s+\\[([^\\]]+)\\]\\s+"(\\S+)\\s+(\\S+)\\s+([^"]+)"\\s+(\\d+)\\s+(\\S+)\\s+"([^"]*)"\\s+"([^"]*)"(?:\\s+"([^"]*)")?(?:\\s+"([^"]*)")?(?:\\s+"([^"]*)")?';
            const defaultNpmErrorRegex = '^(\\d{4}\\/\\d{2}\\/\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+\\[(\\w+)\\]\\s+(.+)$';
            const npmVirtualKeysWithType: { path: (typeof NPM_REGEX_KEYS)[number]; type: 'access' | 'error'; defaultRegex: string }[] = [
                { path: 'proxy-host-*_access.log', type: 'access', defaultRegex: defaultNpmAccessRegex },
                { path: 'proxy-host-*_error.log', type: 'error', defaultRegex: defaultNpmErrorRegex },
                { path: 'dead-host-*_access.log', type: 'access', defaultRegex: defaultNpmAccessRegex },
                { path: 'dead-host-*_error.log', type: 'error', defaultRegex: defaultNpmErrorRegex },
                { path: 'default-host_access.log', type: 'access', defaultRegex: defaultNpmAccessRegex },
                { path: 'default-host_error.log', type: 'error', defaultRegex: defaultNpmErrorRegex },
                { path: 'fallback_access.log', type: 'access', defaultRegex: defaultNpmAccessRegex },
                { path: 'fallback_error.log', type: 'error', defaultRegex: defaultNpmErrorRegex },
                { path: 'letsencrypt-requests_access.log', type: 'access', defaultRegex: defaultNpmAccessRegex },
                { path: 'letsencrypt-requests_error.log', type: 'error', defaultRegex: defaultNpmErrorRegex }
            ];
            const result: Array<{ path: string; type: string; size: number; modified: string; regex: string; isCustom: boolean; isDefaultOverride: boolean; defaultRegex: string }> = [];
            const npmGenericKeysList: string[] = [...NPM_REGEX_KEYS];
            const npmCustomKeysOnly = (Object.keys(customRegexes) as string[]).filter(k => !npmGenericKeysList.includes(k));
            const npmKeysReplacedByCustom = new Set<string>();
            for (const customPath of npmCustomKeysOnly) {
                const slot = getNpmRegexKeyForPath(customPath);
                if (slot) npmKeysReplacedByCustom.add(slot);
            }
            for (const { path: virtualPath, type: virtualType, defaultRegex: defRegex } of npmVirtualKeysWithType) {
                if (npmKeysReplacedByCustom.has(virtualPath)) continue;
                const customRegex = customRegexes[virtualPath];
                const defaultRegexOverride = defaultRegexOverrides[virtualType];
                let regex: string;
                let isDefaultOverride = false;
                if (customRegex) {
                    regex = customRegex.regex;
                } else if (defaultRegexOverride) {
                    regex = defaultRegexOverride;
                    isDefaultOverride = true;
                } else {
                    regex = defRegex;
                }
                result.push({
                    path: virtualPath,
                    type: virtualType,
                    size: 0,
                    modified: new Date().toISOString(),
                    regex,
                    isCustom: !!customRegex,
                    isDefaultOverride,
                    defaultRegex: defRegex
                });
            }
            for (const [customPath, config] of Object.entries(customRegexes) as [string, any][]) {
                if (npmGenericKeysList.includes(customPath)) continue;
                result.push({
                    path: customPath,
                    type: config.logType || 'access',
                    size: 0,
                    modified: config.updatedAt || new Date().toISOString(),
                    regex: config.regex || '',
                    isCustom: true,
                    isDefaultOverride: false,
                    defaultRegex: customPath.includes('error') ? defaultNpmErrorRegex : defaultNpmAccessRegex
                });
            }
            return res.json({
                success: true,
                result: {
                    pluginId,
                    basePath: actualBasePath,
                    patterns: actualPatterns,
                    files: result
                }
            });
        }

        // Nginx: return only 2 virtual entries (access.log, error.log) + custom per-file entries
        if (pluginId === 'nginx') {
            const defaultNginxAccessRegex = '^(\\S+)\\s+-\\s+-\\s+\\[([^\\]]+)\\]\\s+"(\\S+)\\s+(\\S+)\\s+([^"]+)"\\s+(\\d+)\\s+(\\S+)\\s+"([^"]*)"\\s+"([^"]*)"(?:\\s+"([^"]*)")?';
            const defaultNginxErrorRegex = '^(\\d{4}\\/\\d{2}\\/\\d{2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+\\[(\\w+)\\]\\s+(.+)$';
            const nginxVirtualKeysWithType: { path: string; type: 'access' | 'error'; defaultRegex: string }[] = [
                { path: 'access.log', type: 'access', defaultRegex: defaultNginxAccessRegex },
                { path: 'error.log', type: 'error', defaultRegex: defaultNginxErrorRegex }
            ];
            const result: Array<{ path: string; type: string; size: number; modified: string; regex: string; isCustom: boolean; isDefaultOverride: boolean; defaultRegex: string }> = [];
            const nginxGenericKeysList: string[] = [...NGINX_REGEX_KEYS];
            const nginxCustomKeysOnly = (Object.keys(customRegexes) as string[]).filter(k => !nginxGenericKeysList.includes(k));
            const nginxKeysReplacedByCustom = new Set<string>();
            for (const customPath of nginxCustomKeysOnly) {
                const slot = getNginxRegexKeyForPath(customPath);
                if (slot) nginxKeysReplacedByCustom.add(slot);
            }
            for (const { path: virtualPath, type: virtualType, defaultRegex: defRegex } of nginxVirtualKeysWithType) {
                if (nginxKeysReplacedByCustom.has(virtualPath)) continue;
                const customRegex = customRegexes[virtualPath];
                const defaultRegexOverride = defaultRegexOverrides[virtualType];
                let regex: string;
                let isDefaultOverride = false;
                if (customRegex) {
                    regex = customRegex.regex;
                } else if (defaultRegexOverride) {
                    regex = defaultRegexOverride;
                    isDefaultOverride = true;
                } else {
                    regex = defRegex;
                }
                result.push({
                    path: virtualPath,
                    type: virtualType,
                    size: 0,
                    modified: new Date().toISOString(),
                    regex,
                    isCustom: !!customRegex,
                    isDefaultOverride,
                    defaultRegex: defRegex
                });
            }
            for (const [customPath, config] of Object.entries(customRegexes) as [string, any][]) {
                if (nginxGenericKeysList.includes(customPath)) continue;
                result.push({
                    path: customPath,
                    type: config.logType || 'access',
                    size: 0,
                    modified: config.updatedAt || new Date().toISOString(),
                    regex: config.regex || '',
                    isCustom: true,
                    isDefaultOverride: false,
                    defaultRegex: customPath.includes('error') ? defaultNginxErrorRegex : defaultNginxAccessRegex
                });
            }
            return res.json({
                success: true,
                result: {
                    pluginId,
                    basePath: actualBasePath,
                    patterns: actualPatterns,
                    files: result
                }
            });
        }

        // Build result with files and their regex info (only OS-detected files for host-system)
        const result = filesToProcess.map(file => {
            // Check if there's a custom regex for this file
            let customRegex = customRegexes[file.path];
            let isCustom = false;
            
            // If not found, try to find regex for the base log file (without rotation/compression)
            // Example: access.log.1.gz -> access.log
            if (!customRegex) {
                const baseFilePath = normalizeLogFilePath(file.path);
                if (baseFilePath !== file.path && customRegexes[baseFilePath]) {
                    customRegex = customRegexes[baseFilePath];
                    isCustom = true;
                }
            } else {
                isCustom = true;
            }
            
            // Check if there's a default regex override for this log type
            const defaultRegexOverride = defaultRegexOverrides[file.type];
            
            // Get the actual regex to use
            let regex: string;
            let isDefaultOverride = false;
            
            if (customRegex) {
                regex = customRegex.regex;
            } else if (defaultRegexOverride) {
                regex = defaultRegexOverride;
                isDefaultOverride = true;
            } else if (getDefaultRegex) {
                regex = getDefaultRegex(file.type);
            } else {
                regex = '';
            }

            return {
                path: file.path,
                type: file.type,
                size: file.size,
                modified: file.modified.toISOString(),
                regex,
                isCustom,
                isDefaultOverride,
                defaultRegex: getDefaultRegex ? getDefaultRegex(file.type) : ''
            };
        });

        // For host-system: add manually added files with their regex
        if (pluginId === 'host-system' && manuallyAddedFiles.length > 0) {
            for (const filePath of manuallyAddedFiles) {
                try {
                    // Check if file exists and get stats
                    if (fsSync.existsSync(filePath)) {
                        const stats = fsSync.statSync(filePath);
                        const hostSystemConfig = dbConfig?.settings as any;
                        const logFile = hostSystemConfig?.logFiles?.find((f: any) => f.path === filePath);
                        const logType = logFile?.type || 'syslog';
                        
                        // Get regex for this file
                        let customRegex = customRegexes[filePath];
                        let isCustom = false;
                        
                        if (!customRegex) {
                            const baseFilePath = normalizeLogFilePath(filePath);
                            if (baseFilePath !== filePath && customRegexes[baseFilePath]) {
                                customRegex = customRegexes[baseFilePath];
                                isCustom = true;
                            }
                        } else {
                            isCustom = true;
                        }
                        
                        const defaultRegexOverride = (dbConfig?.settings as any)?.defaultRegex?.[logType];
                        let regex: string;
                        let isDefaultOverride = false;
                        
                        if (customRegex) {
                            regex = customRegex.regex;
                        } else if (defaultRegexOverride) {
                            regex = defaultRegexOverride;
                            isDefaultOverride = true;
                        } else if (getDefaultRegex) {
                            regex = getDefaultRegex(logType);
                        } else {
                            regex = '';
                        }
                        
                        result.push({
                            path: filePath,
                            type: logType,
                            size: stats.size,
                            modified: stats.mtime.toISOString(),
                            regex,
                            isCustom,
                            isDefaultOverride,
                            defaultRegex: getDefaultRegex ? getDefaultRegex(logType) : ''
                        });
                    }
                } catch (error) {
                    // Skip files that can't be accessed
                    console.warn(`[LogViewer] Cannot access manually added file ${filePath}:`, error);
                }
            }
        }

        res.json({
            success: true,
            result: {
                pluginId,
                basePath: actualBasePath,
                patterns: actualPatterns,
                files: result
            }
        });
    } catch (error) {
        logger.error('LogViewer', 'Error detecting files:', error);
        res.status(500).json({ 
            error: 'Failed to detect files',
            message: error instanceof Error ? error.message : String(error)
        });
    }
});

export default router;
