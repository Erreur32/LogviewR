/**
 * Plugin management routes
 * 
 * Handles plugin configuration, enabling/disabling, and stats retrieval
 */

import { Router } from 'express';
import expressRateLimit from 'express-rate-limit';
import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { pluginManager } from '../services/pluginManager.js';
import { PluginConfigRepository } from '../database/models/PluginConfig.js';
import { loggingService } from '../services/loggingService.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { autoLog } from '../middleware/loggingMiddleware.js';
import { logger } from '../utils/logger.js';
import type { PluginConfig } from '../plugins/base/PluginInterface.js';

const router = Router();

// Shared rate limiter for NPM detection + domain-map routes (read-only filesystem probes).
// 30 req/min per IP is ample for the admin-panel flows and caps CodeQL "Missing rate limiting".
const npmRouteRateLimit = expressRateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
});

// ─── NPM path helpers (shared by /npm/detect-db, /npm/detect-layout, /npm/domain-map) ───

const HOST_ROOT_PATH = process.env.HOST_ROOT_PATH || '/host';

/**
 * Detect whether the server is running inside a Docker container.
 * Cached after first call — the answer is effectively static at runtime.
 */
let _isDockerCached: boolean | null = null;
function detectDocker(): boolean {
    if (_isDockerCached !== null) return _isDockerCached;
    let result = false;
    try { fs.accessSync('/.dockerenv'); result = true; } catch { /* noop */ }
    if (!result && (process.env.DOCKER === 'true' || process.env.DOCKER_CONTAINER === 'true')) {
        result = true;
    }
    if (!result) {
        try {
            const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
            if (cgroup.includes('docker') || cgroup.includes('containerd')) result = true;
        } catch { /* noop */ }
    }
    _isDockerCached = result;
    return result;
}

/**
 * Resolve a host path for Docker container access: prefixes absolute host paths
 * with HOST_ROOT_PATH so the container can read them via the mount.
 * In non-Docker mode, returns the path unchanged.
 */
function resolveHostPath(p: string): string {
    if (!detectDocker()) return p;
    if (p.startsWith(HOST_ROOT_PATH + '/') || p === HOST_ROOT_PATH) return p;
    if (p.startsWith('/')) return HOST_ROOT_PATH + p;
    return p;
}

// Allowed top-level prefixes for non-Docker runs — NPM installs typically live under these.
// Docker runs are bounded by HOST_ROOT_PATH instead.
const NON_DOCKER_ALLOWED_PREFIXES = ['/home', '/var', '/opt', '/srv', '/data', '/mnt'];

/**
 * Read-access check on a user-supplied host path.
 * The path.resolve + startsWith containment check is inlined (not factored
 * into a helper) so CodeQL js/path-injection recognizes it as a sanitizer
 * directly on the fs.accessSync call.
 */
function pathExistsResolved(p: string): boolean {
    const target = path.resolve(resolveHostPath(p));
    if (detectDocker()) {
        const base = path.resolve(HOST_ROOT_PATH);
        if (target !== base && !target.startsWith(base + path.sep)) return false;
    } else {
        const allowed = NON_DOCKER_ALLOWED_PREFIXES.some(
            prefix => target === prefix || target.startsWith(prefix + path.sep),
        );
        if (!allowed) return false;
    }
    try { fs.accessSync(target, fs.constants.R_OK); return true; } catch { return false; }
}

/**
 * Strip trailing '/' characters without regex (avoids S5852 ReDoS alert on `\/+$`).
 * Preserves a single '/' root: '/' stays '/'.
 */
const SLASH_CODE_POINT = 0x2f; // '/' = U+002F (ASCII)
function stripTrailingSlashes(p: string): string {
    let end = p.length;
    while (end > 1 && p.codePointAt(end - 1) === SLASH_CODE_POINT) end--;
    return end === p.length ? p : p.slice(0, end);
}

/**
 * Validate a user-supplied filesystem path at the request boundary.
 * Rejects non-strings, null bytes, and relative paths — required to break
 * the CodeQL "Uncontrolled data used in path expression" taint flow before
 * the value reaches fs.accessSync / path.join.
 */
function sanitizeInputPath(p: unknown): string {
    if (typeof p !== 'string' || p.length === 0) {
        throw createError('chemin invalide', 400, 'INVALID_PATH');
    }
    if (p.includes('\0')) {
        throw createError('chemin invalide (null byte)', 400, 'INVALID_PATH');
    }
    if (!path.isAbsolute(p)) {
        throw createError('chemin absolu requis', 400, 'INVALID_PATH');
    }
    return p;
}

// GET /api/plugins - Get all plugins with their status
// Optimized: Lightweight connection status check without heavy API calls
router.get('/', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const plugins = pluginManager.getAllPlugins();
    
    const pluginsWithStatus = plugins.map((plugin) => {
        const dbConfig = PluginConfigRepository.findByPluginId(plugin.getId());
        const isEnabled = plugin.isEnabled();
        const pluginId = plugin.getId();
        
        // Lightweight connection status check (no API calls)
        let connectionStatus = false;
        if (isEnabled) {
            // For plugins, check if configured
                connectionStatus = dbConfig !== null;
        }
        
        // Basic plugin info without heavy API calls
        const pluginData = {
            id: pluginId,
            name: plugin.getName(),
            version: plugin.getVersion(),
            enabled: isEnabled,
            configured: dbConfig !== null,
            connectionStatus,
            settings: dbConfig?.settings || {}
        };

        // Validate plugin data structure
        if (!pluginData.id || !pluginData.name || typeof pluginData.enabled !== 'boolean') {
            logger.warn('Plugin', `Invalid plugin data structure for plugin ${pluginId}`);
        }

        return pluginData;
    });

    // Validate response structure
    if (!Array.isArray(pluginsWithStatus)) {
        throw createError('Invalid plugins data format', 500, 'INVALID_PLUGINS_FORMAT');
    }

    res.json({
        success: true,
        result: pluginsWithStatus
    });
}), autoLog('plugin.list', 'plugin'));

// GET /api/plugins/:id - Get plugin details
router.get('/:id', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const pluginId = req.params.id;
    const plugin = pluginManager.getPlugin(pluginId);
    
    if (!plugin) {
        throw createError('Plugin not found', 404, 'PLUGIN_NOT_FOUND');
    }

    const dbConfig = PluginConfigRepository.findByPluginId(pluginId);
    const isEnabled = plugin.isEnabled();
    
    let connectionStatus = false;
    if (isEnabled) {
        try {
            const testResult = await pluginManager.testPluginConnection(pluginId);
            connectionStatus = testResult.success;
        } catch {
            connectionStatus = false;
        }
    }

    res.json({
        success: true,
        result: {
            id: plugin.getId(),
            name: plugin.getName(),
            version: plugin.getVersion(),
            enabled: isEnabled,
            configured: dbConfig !== null,
            connectionStatus,
            settings: dbConfig?.settings || {}
        }
    });
}), autoLog('plugin.get', 'plugin', (req) => req.params.id));

// GET /api/plugins/:id/stats - Get plugin statistics
router.get('/:id/stats', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const pluginId = req.params.id;
    const startTime = Date.now();
    
    try {
        const stats = await pluginManager.getPluginStats(pluginId);
        const executionTime = Date.now() - startTime;
        
        res.json({
            success: true,
            result: stats,
            data: stats, // Also include as 'data' for compatibility with LogviewR format
            source: `plugin_${pluginId}_stats`,
            timestamp: new Date().toISOString(),
            timing: {
                execution_ms: executionTime,
                total_execution: executionTime
            },
            endpoint: 'stats',
            plugin_id: pluginId
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get plugin stats';
        throw createError(message, 500, 'PLUGIN_STATS_ERROR');
    }
}), autoLog('plugin.getStats', 'plugin', (req) => req.params.id));

// GET /api/plugins/stats/all - Get statistics from all enabled plugins
router.get('/stats/all', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const startTime = Date.now();
    
    try {
        const allStatsResult = await pluginManager.getAllStatsWithTiming();
        const totalExecutionTime = Date.now() - startTime;
        
        // Count successful plugins
        const successfulPlugins = Object.values(allStatsResult.stats).filter(stats => stats !== null).length;
        const totalPlugins = Object.keys(allStatsResult.stats).length;
        
        res.json({
            success: true,
            result: allStatsResult.stats,
            data: allStatsResult.stats, // Also include as 'data' for compatibility with LogviewR format
            source: 'plugin_stats_api',
            timestamp: new Date().toISOString(),
            timing: {
                ...allStatsResult.timing,
                total_execution: totalExecutionTime,
                execution_ms: totalExecutionTime
            },
            endpoint: 'stats/all',
            modules_loaded: successfulPlugins,
            total_plugins: totalPlugins
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to get all stats';
        throw createError(message, 500, 'PLUGIN_STATS_ERROR');
    }
}), autoLog('plugin.getAllStats', 'plugin'));

// POST /api/plugins/:id/config - Configure plugin (admin only)
router.post('/:id/config', requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const pluginId = req.params.id;
    const plugin = pluginManager.getPlugin(pluginId);
    
    if (!plugin) {
        throw createError('Plugin not found', 404, 'PLUGIN_NOT_FOUND');
    }

    const { enabled, settings } = req.body;

    if (enabled === undefined && !settings) {
        throw createError('Either enabled or settings must be provided', 400, 'MISSING_FIELDS');
    }

    // Get current config
    const currentConfig = PluginConfigRepository.findByPluginId(pluginId);
    
    // Merge settings: new settings override old ones, but keep sensitive fields if not provided
    const mergedSettings = { ...(currentConfig?.settings || {}) };
    if (settings) {
        // Merge new settings, but only update fields that are explicitly provided
        // This ensures password/apiKey are not lost if not provided in update
        for (const [key, value] of Object.entries(settings)) {
            // Only update if value is provided (not empty string for password/apiKey)
            if (value !== undefined && value !== null) {
                // For password and apiKey, allow empty string to clear them, but don't overwrite with undefined
                if (key === 'password' || key === 'apiKey') {
                    if (value !== '') {
                        mergedSettings[key] = value;
                    } else {
                        // Empty string means clear the password
                        delete mergedSettings[key];
                    }
                } else {
                    mergedSettings[key] = value;
                }
            }
        }
    }
    
    const newConfig: PluginConfig = {
        id: pluginId,
        enabled: enabled !== undefined ? enabled : (currentConfig?.enabled || false),
        settings: mergedSettings
    };
    

    // Update plugin configuration
    await pluginManager.updatePluginConfig(pluginId, newConfig);

    await loggingService.logUserAction(
        req.user!.userId,
        req.user!.username,
        'plugin.configure',
        'plugin',
        {
            resourceId: pluginId,
            details: { enabled: newConfig.enabled, settingsKeys: Object.keys(newConfig.settings) }
        }
    );

    res.json({
        success: true,
        result: {
            message: 'Plugin configuration updated',
            config: newConfig
        }
    });
}), autoLog('plugin.configure', 'plugin', (req) => req.params.id));

// POST /api/plugins/:id/test - Test plugin connection (admin only)
router.post('/:id/test', requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const pluginId = req.params.id;
    const plugin = pluginManager.getPlugin(pluginId);
    
    if (!plugin) {
        throw createError('Plugin not found', 404, 'PLUGIN_NOT_FOUND');
    }

    // If test settings are provided in request body, use them temporarily
    // Otherwise use current plugin configuration
    const testSettings = req.body.settings;
    let connectionStatus = false;
    let errorMessage: string | null = null;

    try {
        if (testSettings && Object.keys(testSettings).length > 0) {
            // Temporarily configure plugin with test settings
            const dbConfig = PluginConfigRepository.findByPluginId(pluginId);
            const currentConfig: PluginConfig | null = dbConfig ? {
                id: dbConfig.pluginId,
                enabled: dbConfig.enabled,
                settings: dbConfig.settings
            } : null;
            
            const testConfig: PluginConfig = {
                id: pluginId,
                enabled: currentConfig?.enabled || false,
                settings: { ...(currentConfig?.settings || {}), ...testSettings }
            };
            
            // Reinitialize plugin with test config
            await plugin.stop();
            await plugin.initialize(testConfig);
            
            // Test connection
            connectionStatus = await plugin.testConnection();
            
            // Restore original config
            if (currentConfig) {
                await plugin.stop();
                await plugin.initialize(currentConfig);
                if (currentConfig.enabled) {
                    await plugin.start();
                }
            } else {
                // If no original config, just stop the plugin
                await plugin.stop();
            }
        } else {
            // Use current plugin configuration
            const testResult = await pluginManager.testPluginConnection(pluginId);
            connectionStatus = testResult.success;
            if (!testResult.success && testResult.error) {
                errorMessage = testResult.error;
            }
        }
    } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[PluginTest] Error testing ${pluginId}:`, error);
        connectionStatus = false;
    }

    // Build a more informative message
    let message: string;
    if (connectionStatus) {
        message = 'Connection successful';
    } else {
        if (errorMessage) {
            // Include error details in the message
            message = `Connection failed: ${errorMessage}`;
        } else {
            // Fallback message
                message = 'Connection failed: Unable to connect. Check backend logs for details.';
        }
    }

    res.json({
        success: true,
        result: {
            connected: connectionStatus,
            message,
            error: errorMessage || undefined
        }
    });
}), autoLog('plugin.test', 'plugin', (req) => req.params.id));

// POST /api/plugins/npm/detect-db — auto-detect database.sqlite from NPM basePath
router.post('/npm/detect-db', npmRouteRateLimit, requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { basePath } = req.body as { basePath?: string };
    if (!basePath) throw createError('basePath manquant', 400, 'MISSING_PARAM');

    const normalizedBase = stripTrailingSlashes(sanitizeInputPath(basePath));
    const candidates: string[] = [
        path.join(normalizedBase, '..', 'database.sqlite'),       // /data/logs → /data/database.sqlite
        path.join(normalizedBase, '..', '..', 'database.sqlite'), // /data/logs/proxy → /data/database.sqlite
        path.join(normalizedBase, 'database.sqlite'),             // /data (no trailing /logs) → /data/database.sqlite
    ];

    for (const candidate of candidates) {
        if (pathExistsResolved(candidate)) {
            return res.json({ success: true, result: { found: true, path: candidate, resolvedPath: resolveHostPath(candidate) } });
        }
    }

    // Include resolved paths in the error payload for debugging
    res.json({ success: true, result: {
        found: false,
        candidates,
        resolved: candidates.map(resolveHostPath),
        isDocker: detectDocker(),
        message: 'database.sqlite non trouvée dans les chemins candidats',
    } });
}));

// POST /api/plugins/npm/detect-layout — detect full NPM layout from any anchor path
// Accepts NPM root (e.g. /home/docker/nginx_proxy), data dir, or logs dir.
// Returns: { found, dataPath, logsPath, dbPath, anchor }
router.post('/npm/detect-layout', npmRouteRateLimit, requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
    const { path: inputPath } = req.body as { path?: string };
    if (!inputPath) throw createError('path manquant', 400, 'MISSING_PARAM');

    const normalized = stripTrailingSlashes(sanitizeInputPath(inputPath)) || '/';

    // Candidate data paths — try the input, its child data/, and its parent
    // Standard NPM layouts:
    //   /home/docker/nginx_proxy/            → data/ is child
    //   /home/docker/nginx_proxy/data/       → input is data/
    //   /home/docker/nginx_proxy/data/logs/  → data/ is parent
    const dataCandidates: string[] = [
        path.join(normalized, 'data'),        // input is NPM root
        normalized,                            // input is data/
        path.join(normalized, '..'),          // input is logs/ → parent is data/
    ];

    for (const dataPath of dataCandidates) {
        const logsPath = path.join(dataPath, 'logs');
        const dbPath = path.join(dataPath, 'database.sqlite');
        const dbFound = pathExistsResolved(dbPath);
        const logsFound = pathExistsResolved(logsPath);
        if (dbFound && logsFound) {
            return res.json({ success: true, result: {
                found: true,
                dataPath, logsPath, dbPath,
                resolvedDataPath: resolveHostPath(dataPath),
                resolvedLogsPath: resolveHostPath(logsPath),
                resolvedDbPath: resolveHostPath(dbPath),
                dbFound, logsFound,
                isDocker: detectDocker(),
            } });
        }
    }

    // Fallback: partial match — report what was found (if anything)
    const partial = dataCandidates.map(dp => ({
        dataPath: dp,
        logsPath: path.join(dp, 'logs'),
        dbPath: path.join(dp, 'database.sqlite'),
        logsFound: pathExistsResolved(path.join(dp, 'logs')),
        dbFound: pathExistsResolved(path.join(dp, 'database.sqlite')),
    }));
    const best = partial.find(p => p.logsFound || p.dbFound) ?? partial[0];

    res.json({ success: true, result: {
        found: false,
        dataPath: best.dataPath,
        logsPath: best.logsPath,
        dbPath: best.dbPath,
        logsFound: best.logsFound,
        dbFound: best.dbFound,
        candidates: partial,
        isDocker: detectDocker(),
        message: best.logsFound || best.dbFound
            ? 'Layout NPM partiel — vérifiez le chemin'
            : 'Aucun layout NPM détecté à cet emplacement',
    } });
}));

// GET /api/plugins/npm/domain-map — proxy_host id → primary domain for NPM log viewer
// Uses NPM plugin's basePath to locate database.sqlite (basePath = /data/logs → /data/database.sqlite).
// Returns: { map: { "1": "example.com", ... }, source: 'sqlite' | 'none' }
router.get('/npm/domain-map', npmRouteRateLimit, requireAuth, asyncHandler(async (_req: AuthenticatedRequest, res) => {
    const npmPlugin = pluginManager.getPlugin('npm');
    const cfg = npmPlugin ? PluginConfigRepository.findByPluginId('npm') : null;
    const basePath = (cfg?.settings as { basePath?: string } | undefined)?.basePath ?? '';

    if (!basePath) {
        return res.json({ success: true, result: { map: {}, source: 'none', reason: 'NPM basePath non configuré' } });
    }

    // basePath comes from admin-written plugin config, but re-validate defensively
    // to break the CodeQL taint flow at this read boundary too.
    let normalizedBase: string;
    try {
        normalizedBase = stripTrailingSlashes(sanitizeInputPath(basePath));
    } catch {
        return res.json({ success: true, result: { map: {}, source: 'none', reason: 'NPM basePath invalide' } });
    }
    const dbCandidates = [
        path.join(normalizedBase, '..', 'database.sqlite'),
        path.join(normalizedBase, 'database.sqlite'),
        path.join(normalizedBase, '..', '..', 'database.sqlite'),
    ];
    // Inline the canonicalize + containment check so CodeQL js/path-injection
    // recognizes the sanitizer directly on both fs.accessSync and new Database sinks.
    let dbPath: string | null = null;
    for (const c of dbCandidates) {
        const target = path.resolve(resolveHostPath(c));
        if (detectDocker()) {
            const base = path.resolve(HOST_ROOT_PATH);
            if (target !== base && !target.startsWith(base + path.sep)) continue;
        } else {
            const allowed = NON_DOCKER_ALLOWED_PREFIXES.some(
                prefix => target === prefix || target.startsWith(prefix + path.sep),
            );
            if (!allowed) continue;
        }
        try { fs.accessSync(target, fs.constants.R_OK); dbPath = target; break; } catch { /* not accessible */ }
    }

    if (!dbPath) {
        return res.json({ success: true, result: { map: {}, source: 'none', reason: 'database.sqlite introuvable' } });
    }

    try {
        const db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const rows = db.prepare('SELECT id, domain_names FROM proxy_host WHERE is_deleted=0').all() as { id: number; domain_names: string }[];
        db.close();
        const map: Record<string, string> = {};
        for (const row of rows) {
            try {
                const ns: string[] = JSON.parse(row.domain_names);
                if (ns.length) map[String(row.id)] = ns[0].replace(/^www\./, '').toLowerCase();
            } catch { /* bad JSON — skip */ }
        }
        res.json({ success: true, result: { map, source: 'sqlite' } });
    } catch (err) {
        res.json({ success: true, result: { map: {}, source: 'none', reason: `Erreur lecture DB : ${err instanceof Error ? err.message : 'unknown'}` } });
    }
}));

export default router;

