/**
 * Error Summary Service
 *
 * Phase 1 (current): Fast count of error/warn level lines per file.
 *   - Lists error log files (plugin patterns; .gz and .tar.gz always excluded).
 *   - For each file: read last N lines, count lines matching [error]/[warn] (simple regex). No full parsing.
 *   - Produces the list of "files to analyze" with their error count. Fast even on large files.
 *
 * Phase 2 (to be added later): Detailed analysis and "entrées suspectes" (suspect entries) per file.
 *   - Full parsing, dedup, top errors, security hints. Will use the list from phase 1.
 *
 * File selection: plugin.getDefaultFilePatterns(), isErrorLogFile(), exclude .gz and .tar.gz.
 */

import type { LogSourcePlugin } from '../plugins/base/LogSourcePluginInterface.js';
import { pluginManager } from './pluginManager.js';
import { logReaderService } from './logReaderService.js';
import { PluginConfigRepository } from '../database/models/PluginConfig.js';
import { logger } from '../utils/logger.js';
import { getErrorAnalysisConfig, DEPTH_TO_LINES } from '../config/errorAnalysisConfig.js';

function isLogSourcePlugin(plugin: unknown): plugin is LogSourcePlugin {
    return (
        typeof (plugin as LogSourcePlugin).scanLogFiles === 'function' &&
        typeof (plugin as LogSourcePlugin).parseLogLine === 'function' &&
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

/**
 * Result of line-level detection: level and source (tag [error]/[warn] or HTTP status band).
 */
export type LineLevelSource = 'tag' | '4xx' | '5xx' | '3xx';

/**
 * Fast level detection on a raw log line with breakdown (tag vs status code).
 * Used to produce per-file counts for badges: 4xx/5xx (Apache) and error/warn tags (NPM/Nginx).
 */
function countLevelFromRawLineBreakdown(line: string): { level: 'error' | 'warn'; source: LineLevelSource } | null {
    const lower = line.trim();
    if (!lower) return null;
    // Apache/Nginx/NPM style: [error], [warn]
    if (/\s\[(?:error|err|crit|critical|alert|emerg|emergency)\]\s/i.test(lower)) return { level: 'error', source: 'tag' };
    if (/\s\[(?:warn|warning)\]\s/i.test(lower)) return { level: 'warn', source: 'tag' };
    // System logs (syslog, journald, auth): level=error, "error:", "ERR", etc.
    if (/\b(?:error|err|crit|critical|alert|emerg|emergency)\b/i.test(lower)) return { level: 'error', source: 'tag' };
    if (/\b(?:warn|warning)\b/i.test(lower)) return { level: 'warn', source: 'tag' };
    // HTTP status codes (access/error logs)
    const statusMatch = lower.match(/\s(5\d{2}|4\d{2}|3\d{2})(?:\s|"|$)/);
    if (statusMatch) {
        const code = statusMatch[1];
        if (code.startsWith('5')) return { level: 'error', source: '5xx' };
        if (code.startsWith('4')) return { level: 'error', source: '4xx' };
        if (code.startsWith('3')) return { level: 'warn', source: '3xx' };
    }
    return null;
}

export interface UniqueErrorSample {
    message: string;
    level: string;
    count: number;
}

export interface ErrorFileSummary {
    pluginId: string;
    filePath: string;
    fileName: string;
    logType: string;
    /** File size in bytes (from scan) */
    fileSizeBytes?: number;
    errorCount: number;
    /** Counts for badges: HTTP 4xx/5xx (Apache, access logs) and [error]/[warn] tags (NPM, Nginx). */
    count4xx?: number;
    count5xx?: number;
    count3xx?: number;
    countErrorTag?: number;
    countWarnTag?: number;
    uniqueErrorsBySeverity: {
        error: UniqueErrorSample[];
        warn: UniqueErrorSample[];
        info: UniqueErrorSample[];
        debug: UniqueErrorSample[];
    };
    topErrors: UniqueErrorSample[];
}

/** Reported when a file could not be read or parsed (I/O or parse error), distinct from errors found inside the log. */
export interface AnalysisErrorEntry {
    pluginId: string;
    filePath: string;
    fileName: string;
    errorMessage: string;
}

export interface ErrorSummaryResult {
    files: ErrorFileSummary[];
    /** Files that failed to read or parse (separate from errors detected in log content). */
    analysisErrors: AnalysisErrorEntry[];
}

/**
 * Check if a log file is an error log (not access).
 * Covers type=error and path patterns: error*.log, *_error.log, *error*.log.
 */
function isErrorLogFile(file: { path: string; type: string }): boolean {
    const typeLower = file.type.toLowerCase();
    const pathLower = file.path.toLowerCase();
    if (typeLower === 'error') return true;
    if (!pathLower.includes('.log')) return false;
    if (pathLower.includes('error') || pathLower.includes('_error')) return true;
    return false;
}

/**
 * Check if a log file is an access log (HTTP request logs with status codes).
 * Used for Apache, Nginx, NPM: we include access logs to count 3xx/4xx/5xx status codes.
 */
function isAccessLogFile(file: { path: string; type: string }): boolean {
    const typeLower = file.type.toLowerCase();
    const pathLower = file.path.toLowerCase();
    if (typeLower === 'access') return true;
    if (!pathLower.includes('.log')) return false;
    if (pathLower.includes('access') || pathLower.includes('_access')) return true;
    return false;
}

/** Plugins for which we also scan access logs (to count 4xx/5xx/3xx in addition to error logs). */
const PLUGINS_WITH_ACCESS_LOGS = ['apache', 'nginx', 'npm'];

/** Format file size for progress messages (e.g. "1.2 MB"). */
function formatFileSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

/** Exclude compressed/archive paths (.gz, .tar.gz, .tgz) from error summary scan. */
function isCompressedOrArchivePath(path: string): boolean {
    const lower = path.toLowerCase();
    return lower.endsWith('.gz') || lower.endsWith('.tgz');
}

/** In-memory cache for error summary to avoid heavy work on every dashboard load */
const ERROR_SUMMARY_CACHE_TTL_MS = 60 * 1000; // 60 seconds
let errorSummaryCache: { result: ErrorSummaryResult; timestamp: number } | null = null;

/** Progress messages for live UI (last N entries) */
const PROGRESS_MAX = 15;
const errorSummaryProgress: { message: string; pluginId?: string; filePath?: string }[] = [];

function pushProgress(message: string, detail?: { pluginId?: string; filePath?: string }): void {
    errorSummaryProgress.push({ message, ...detail });
    if (errorSummaryProgress.length > PROGRESS_MAX) {
        errorSummaryProgress.shift();
    }
}

/**
 * Get current progress messages for error summary (for polling from frontend).
 */
export function getErrorSummaryProgress(): { message: string; pluginId?: string; filePath?: string }[] {
    return [...errorSummaryProgress];
}

/**
 * Clear progress (call before starting a new computation).
 */
export function clearErrorSummaryProgress(): void {
    errorSummaryProgress.length = 0;
}

/**
 * Invalidate the error summary cache (e.g. after analysis config is updated).
 */
export function invalidateErrorSummaryCache(): void {
    errorSummaryCache = null;
}

export type ErrorSummaryProgressCallback = (message: string, detail?: { pluginId?: string; filePath?: string }) => void;

/**
 * Build error summary for dashboard. Uses in-memory cache (TTL 60s) to avoid re-scanning on every request.
 * Returns result and cache metadata so the UI can show "Résultat en cache (il y a X s)" when applicable.
 */
export async function getErrorSummaryWithMeta(): Promise<{
    result: ErrorSummaryResult;
    fromCache: boolean;
    cacheAgeMs: number;
}> {
    const now = Date.now();
    if (errorSummaryCache && (now - errorSummaryCache.timestamp) < ERROR_SUMMARY_CACHE_TTL_MS) {
        return {
            result: errorSummaryCache.result,
            fromCache: true,
            cacheAgeMs: now - errorSummaryCache.timestamp
        };
    }
    clearErrorSummaryProgress();
    const progressCb: ErrorSummaryProgressCallback = (msg, detail) => {
        pushProgress(msg, detail);
    };
    const result = await computeErrorSummary(progressCb);
    errorSummaryCache = { result, timestamp: now };
    return { result, fromCache: false, cacheAgeMs: 0 };
}

/** Legacy: get result only (no cache metadata). */
export async function getErrorSummary(onProgress?: ErrorSummaryProgressCallback): Promise<ErrorSummaryResult> {
    const { result } = await getErrorSummaryWithMeta();
    return result;
}

async function computeErrorSummary(onProgress?: ErrorSummaryProgressCallback): Promise<ErrorSummaryResult> {
    const config = getErrorAnalysisConfig();
    const linesPerFile = DEPTH_TO_LINES[config.securityCheckDepth];
    const files: ErrorFileSummary[] = [];
    const analysisErrors: AnalysisErrorEntry[] = [];

    for (const pluginId of config.enabledPlugins) {
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin || !isLogSourcePlugin(plugin)) continue;

        const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
        if (!pluginConfig?.enabled) continue;

        onProgress?.(`Plugin: ${pluginId}`, { pluginId });

        let basePath: string;
        let patterns: string[];
        try {
            basePath = getEffectiveBasePath(pluginId, plugin);
            patterns = plugin.getDefaultFilePatterns();
        } catch (e) {
            logger.warn('ErrorSummaryService', `Plugin ${pluginId} base path/patterns: ${e}`);
            continue;
        }

        let allFiles: { path: string; type: string; size: number; modified: Date }[];
        try {
            allFiles = await plugin.scanLogFiles(basePath, patterns);
        } catch (e) {
            logger.warn('ErrorSummaryService', `Plugin ${pluginId} scan failed: ${e}`);
            continue;
        }

        const errorLogCandidates = allFiles
            .filter((f) =>
                isErrorLogFile(f) ||
                (PLUGINS_WITH_ACCESS_LOGS.includes(pluginId) && isAccessLogFile(f)) ||
                (pluginId === 'host-system') // Include all system logs for error/warn tag search (see AUDIT_ERROR_SUMMARY_HOST_SYSTEM.md)
            )
            .filter((f) => !isCompressedOrArchivePath(f.path)); // Skip .gz, .tar.gz, .tgz (slow, not analyzed)
        const skippedLarge = errorLogCandidates.filter((f) => f.size > config.maxFileSizeBytes);
        const errorFiles = errorLogCandidates
            .filter((f) => f.size <= config.maxFileSizeBytes)
            .sort((a, b) => (isErrorLogFile(a) ? 0 : 1) - (isErrorLogFile(b) ? 0 : 1)) // Prefer error logs over access when trimming
            .slice(0, config.maxFilesPerPlugin);
        if (skippedLarge.length > 0) {
            const msg = `Ignorés (trop volumineux): ${skippedLarge.length} fichier(s) pour ${pluginId}`;
            logger.info('ErrorSummaryService', msg);
            onProgress?.(msg, { pluginId });
        }

        // Emit list of files that will be scanned (before reading); skip 0 B so we don't show " (0 B)".
        for (const file of errorFiles) {
            if (file.size === 0) continue;
            const plannedName = file.path.split('/').pop() ?? file.path;
            onProgress?.(`À analyser: ${plannedName} (${formatFileSize(file.size)})`, { pluginId, filePath: file.path });
        }

        const readCompressed = (pluginConfig.settings?.readCompressed as boolean) ?? false;

        for (const file of errorFiles) {
            const fileName = file.path.split('/').pop() ?? file.path;
            onProgress?.(file.size > 0 ? `Lecture: ${fileName} (${formatFileSize(file.size)})` : `Lecture: ${fileName}`, { pluginId, filePath: file.path });
            try {
                const logLines = await logReaderService.readLastLines(file.path, linesPerFile, {
                    encoding: 'utf8',
                    readCompressed
                });

                if (logLines.length === 0) {
                    onProgress?.(`Ignoré (vide): ${fileName}`, { pluginId, filePath: file.path });
                    continue;
                }

                onProgress?.(`Comptage: ${fileName} (${logLines.length} lignes)`, { pluginId, filePath: file.path });

                let count4xx = 0;
                let count5xx = 0;
                let count3xx = 0;
                let countErrorTag = 0;
                let countWarnTag = 0;
                for (const logLine of logLines) {
                    const r = countLevelFromRawLineBreakdown(logLine.line);
                    if (!r) continue;
                    if (r.source === '4xx') count4xx++;
                    else if (r.source === '5xx') count5xx++;
                    else if (r.source === '3xx') count3xx++;
                    else if (r.source === 'tag' && r.level === 'error') countErrorTag++;
                    else if (r.source === 'tag' && r.level === 'warn') countWarnTag++;
                }
                const errorCount = count4xx + count5xx + count3xx + countErrorTag + countWarnTag;

                if (errorCount === 0) {
                    onProgress?.(`Ignoré (0 erreur): ${fileName}`, { pluginId, filePath: file.path });
                    continue;
                }

                files.push({
                    pluginId,
                    filePath: file.path,
                    fileName,
                    logType: file.type,
                    fileSizeBytes: file.size,
                    errorCount,
                    count4xx: count4xx || undefined,
                    count5xx: count5xx || undefined,
                    count3xx: count3xx || undefined,
                    countErrorTag: countErrorTag || undefined,
                    countWarnTag: countWarnTag || undefined,
                    uniqueErrorsBySeverity: {
                        error: [],
                        warn: [],
                        info: [],
                        debug: []
                    },
                    topErrors: []
                });
                onProgress?.(`Lu et validé: ${fileName} (${formatFileSize(file.size)}, ${errorCount} erreurs)`, { pluginId, filePath: file.path });
            } catch (e) {
                const errMsg = e instanceof Error ? e.message : String(e);
                logger.warn('ErrorSummaryService', `Error processing ${file.path}: ${errMsg}`);
                analysisErrors.push({
                    pluginId,
                    filePath: file.path,
                    fileName: file.path.split('/').pop() ?? file.path,
                    errorMessage: errMsg
                });
                onProgress?.(`Erreur lecture/analyse: ${fileName}`, { pluginId, filePath: file.path });
            }
        }
    }

    files.sort((a, b) => b.errorCount - a.errorCount);
    return { files, analysisErrors };
}
