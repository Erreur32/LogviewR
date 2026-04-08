/**
 * Log Search Service
 *
 * Searches across all active log files from enabled plugins.
 * Used by the dashboard "Recherche" card for global log search.
 */

import { pluginManager } from './pluginManager.js';
import { logReaderService } from './logReaderService.js';
import { PluginConfigRepository } from '../database/models/PluginConfig.js';
import { getDatabase } from '../database/connection.js';
import { logger } from '../utils/logger.js';
import type { LogSourcePlugin } from '../plugins/base/LogSourcePluginInterface.js';
import * as path from 'path';
import * as fsSync from 'fs';

const LOG_SOURCE_PLUGINS = ['host-system', 'apache', 'npm', 'nginx', 'fail2ban'] as const;

/** Detect if running in Docker (same logic as BasePlugin). */
function isDocker(): boolean {
    try {
        if (fsSync.readFileSync('/proc/self/cgroup', 'utf8').includes('docker')) return true;
    } catch { /* ignore */ }
    return process.env.DOCKER === 'true' || process.env.DOCKER_CONTAINER === 'true' || false;
}

/** Resolve host path to container path when running in Docker (same logic as BasePlugin). */
function resolvePathForRead(filePath: string): string {
    if (!isDocker()) return filePath;
    const HOST_ROOT = process.env.HOST_ROOT_PATH || '/host';
    const DOCKER_LOGS = '/host/logs';
    const VAR_LOG = '/var/log';
    if (filePath.startsWith(VAR_LOG)) {
        if (fsSync.existsSync(DOCKER_LOGS)) return filePath.replace(VAR_LOG, DOCKER_LOGS);
        return filePath.replace(VAR_LOG, `${HOST_ROOT}/var/log`);
    }
    if (!filePath.startsWith('/host') && filePath.startsWith('/')) {
        return `${HOST_ROOT}${filePath}`;
    }
    return filePath;
}

function isLogSourcePlugin(plugin: unknown): plugin is LogSourcePlugin {
    return (
        typeof (plugin as LogSourcePlugin).scanLogFiles === 'function' &&
        typeof (plugin as LogSourcePlugin).getDefaultBasePath === 'function' &&
        typeof (plugin as LogSourcePlugin).getDefaultFilePatterns === 'function'
    );
}

function getEffectiveBasePath(pluginId: string, plugin: LogSourcePlugin): string {
    const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
    const configured = pluginConfig?.settings?.basePath;
    if (configured && typeof configured === 'string' && configured.trim()) {
        return configured.trim();
    }
    return plugin.getDefaultBasePath();
}

function isCompressedFile(filePath: string): boolean {
    return /\.(gz|bz2|xz)$/i.test(filePath);
}

/**
 * Get declared log file paths for host-system from config (systemBaseFiles, autoDetectedFiles, customFiles).
 * Same paths as used in Log Viewer. Returns empty if no config or no enabled files.
 */
function getHostSystemDeclaredFiles(config: { settings?: Record<string, unknown> } | null): Array<{ path: string; type: string }> {
    if (!config?.settings || typeof config.settings !== 'object') return [];
    const s = config.settings as Record<string, unknown>;
    const result: Array<{ path: string; type: string }> = [];
    const collect = (arr: unknown) => {
        if (!Array.isArray(arr)) return;
        for (const item of arr) {
            if (item && typeof item === 'object' && 'path' in item && typeof (item as { path: unknown }).path === 'string' && (item as { enabled?: boolean }).enabled) {
                const type = (item as { type?: string }).type ?? 'custom';
                result.push({ path: (item as { path: string }).path, type });
            }
        }
    };
    collect(s.systemBaseFiles);
    collect(s.autoDetectedFiles);
    collect(s.customFiles);
    collect(s.logFiles);
    return result;
}

export interface LogSearchMatch {
    pluginId: string;
    filePath: string;
    fileName: string;
    logType: string;
    lineNumber: number;
    content: string;
}

export interface LogSearchOptions {
    query: string;
    pluginIds?: string[];
    caseSensitive?: boolean;
    useRegex?: boolean;
    /** When false (default), exclude .gz/.bz2/.xz files from search. When true, include them if plugin allows. */
    includeCompressed?: boolean;
    maxResults?: number;
    maxLinesPerFile?: number;
}

export interface LogSearchMatchCount {
    pluginId: string;
    filePath: string;
    fileName: string;
    count: number;
}

export interface LogSearchResult {
    matches: LogSearchMatch[];
    totalMatches: number;
    filesSearched: number;
    filesWithMatches: number;
    matchCountPerFile: LogSearchMatchCount[];
    matchesByPlugin: Record<string, LogSearchMatch[]>;
    pluginsSearched: string[];
}

function emptyResult(): LogSearchResult {
    return {
        matches: [],
        totalMatches: 0,
        filesSearched: 0,
        filesWithMatches: 0,
        matchCountPerFile: [],
        matchesByPlugin: {},
        pluginsSearched: []
    };
}

/**
 * Search across all active log files from enabled plugins.
 * Uses same logic as log-viewer: basePath + patterns for apache/npm/nginx; declared paths for host-system.
 */
export async function searchAllLogs(options: LogSearchOptions): Promise<LogSearchResult> {
    const {
        query,
        pluginIds,
        caseSensitive = false,
        useRegex = false,
        includeCompressed = false,
        maxResults = 100,
        maxLinesPerFile = 5000
    } = options;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return emptyResult();
    }

    const trimmedQuery = query.trim();
    const explicitPluginFilter = Boolean(pluginIds && pluginIds.length > 0);
    const targetPlugins = explicitPluginFilter
        ? pluginIds!.filter((id) => LOG_SOURCE_PLUGINS.includes(id as typeof LOG_SOURCE_PLUGINS[number]))
        : [...LOG_SOURCE_PLUGINS];

    const matches: LogSearchMatch[] = [];
    const matchCountByFile = new Map<string, number>();
    let filesSearched = 0;

    let testFn: (line: string) => boolean;
    try {
        if (useRegex) {
            // Reject dangerous patterns: nested quantifiers (ReDoS) and excessive length
            if (trimmedQuery.length > 500 || /([+*])\)?[+*{]/.test(trimmedQuery)) {
                throw new Error('Regex rejected: potential catastrophic backtracking or too long');
            }
            const flags = caseSensitive ? '' : 'i';
            const regex = new RegExp(trimmedQuery, flags);
            testFn = (line) => regex.test(line);
        } else {
            const needle = caseSensitive ? trimmedQuery : trimmedQuery.toLowerCase();
            testFn = (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
        }
    } catch (err) {
        logger.warn('LogSearch', 'Invalid regex pattern, falling back to literal search:', err);
        const needle = caseSensitive ? trimmedQuery : trimmedQuery.toLowerCase();
        testFn = (line) => (caseSensitive ? line : line.toLowerCase()).includes(needle);
    }

    for (const pluginId of targetPlugins) {
        const config = PluginConfigRepository.findByPluginId(pluginId);
        // When user selected "All": only search enabled plugins. When user selected specific plugin(s): search them even if disabled.
        if (!explicitPluginFilter && !config?.enabled) continue;

        // ── Fail2ban: search f2b_events table (ip / jail) ──────────────────────
        if (pluginId === 'fail2ban') {
            try {
                const db = getDatabase();
                const rows = db.prepare(
                    `SELECT id, ip, jail, timeofban, failures FROM f2b_events ORDER BY timeofban DESC LIMIT 50000`
                ).all() as { id: number; ip: string; jail: string; timeofban: number; failures: number | null }[];

                for (const row of rows) {
                    if (matches.length >= maxResults) break;
                    const date = new Date(row.timeofban * 1000).toISOString().replace('T', ' ').slice(0, 16);
                    const line = `[ban] ${row.ip} | jail: ${row.jail} | failures: ${row.failures ?? 0} | ${date}`;
                    if (testFn(line)) {
                        const fileKey = `fail2ban:${row.ip}`;
                        matchCountByFile.set(fileKey, (matchCountByFile.get(fileKey) ?? 0) + 1);
                        matches.push({
                            pluginId: 'fail2ban',
                            filePath: row.ip,
                            fileName: row.jail,
                            logType: 'ban',
                            lineNumber: row.id,
                            content: line
                        });
                    }
                }
                filesSearched++;
            } catch (err) {
                logger.warn('LogSearch', 'fail2ban f2b_events search failed:', err);
            }
            continue;
        }

        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin || !isLogSourcePlugin(plugin)) continue;

        const basePath = getEffectiveBasePath(pluginId, plugin);
        const patterns = plugin.getDefaultFilePatterns();
        const pluginReadCompressed = (config?.settings?.readCompressed as boolean) ?? false;
        const readCompressed = includeCompressed && pluginReadCompressed;

        let files: { path: string; type: string }[];

        if (pluginId === 'host-system') {
            const declared = getHostSystemDeclaredFiles(config);
            const declaredResolved = declared.map((f) => ({ path: resolvePathForRead(f.path), type: f.type }));
            const pathSet = new Set(declaredResolved.map((f) => f.path));
            try {
                const scanned = await plugin.scanLogFiles(basePath, patterns);
                for (const f of scanned) {
                    if (!pathSet.has(f.path)) {
                        declaredResolved.push(f);
                        pathSet.add(f.path);
                    }
                }
            } catch (err) {
                logger.warn('LogSearch', `Failed to scan host-system:`, err);
            }
            files = declaredResolved;
        } else {
            try {
                files = await plugin.scanLogFiles(basePath, patterns);
            } catch (err) {
                logger.warn('LogSearch', `Failed to scan plugin ${pluginId}:`, err);
                continue;
            }
        }

        const filteredFiles = files
            .filter((f) => readCompressed || !isCompressedFile(f.path))
            .slice(0, 50);

        for (const file of filteredFiles) {
            if (matches.length >= maxResults) break;

            try {
                const lines = await logReaderService.readLogFile(file.path, {
                    maxLines: maxLinesPerFile,
                    fromLine: 0,
                    readCompressed: readCompressed && isCompressedFile(file.path)
                });

                filesSearched++;

                for (const logLine of lines) {
                    if (matches.length >= maxResults) break;
                    if (testFn(logLine.line)) {
                        const fileKey = `${pluginId}:${file.path}`;
                        matchCountByFile.set(fileKey, (matchCountByFile.get(fileKey) ?? 0) + 1);
                        matches.push({
                            pluginId,
                            filePath: file.path,
                            fileName: path.basename(file.path),
                            logType: file.type,
                            lineNumber: logLine.lineNumber,
                            content: logLine.line
                        });
                    }
                }
            } catch (err) {
                logger.debug('LogSearch', `Skip file ${file.path}:`, err);
            }
        }
    }

    const matchesByPlugin: Record<string, LogSearchMatch[]> = {};
    for (const m of matches) {
        if (!matchesByPlugin[m.pluginId]) matchesByPlugin[m.pluginId] = [];
        matchesByPlugin[m.pluginId].push(m);
    }

    const matchCountPerFile: Array<{ pluginId: string; filePath: string; fileName: string; count: number }> = [];
    for (const [key, count] of matchCountByFile) {
        const sep = key.indexOf(':');
        const pid = sep >= 0 ? key.slice(0, sep) : key;
        const fp = sep >= 0 ? key.slice(sep + 1) : '';
        matchCountPerFile.push({ pluginId: pid, filePath: fp, fileName: path.basename(fp), count });
    }

    return {
        matches,
        totalMatches: matches.length,
        filesSearched,
        filesWithMatches: matchCountByFile.size,
        matchCountPerFile,
        matchesByPlugin,
        pluginsSearched: targetPlugins.filter((id) => {
            const c = PluginConfigRepository.findByPluginId(id);
            return c?.enabled;
        })
    };
}
