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
import { compileSafeRegex } from '../utils/safeRegex.js';
import type { LogSourcePlugin } from '../plugins/base/LogSourcePluginInterface.js';
import * as path from 'node:path';
import * as fsSync from 'node:fs';

// KEEP IN SYNC with src/components/widgets/DashboardSearchCard.tsx (LOG_SOURCE_PLUGIN_IDS)
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

type PluginConfig = { settings?: Record<string, unknown>; enabled?: boolean } | null;

function getEffectiveBasePath(plugin: LogSourcePlugin, config: PluginConfig): string {
    const configured = config?.settings?.basePath;
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
    /** Domain/vhost extracted from parsed line, when the plugin exposes one (apache vhost, npm host). */
    domain?: string;
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

type TestFn = (line: string) => boolean;

interface PluginSearchResult {
    matches: LogSearchMatch[];
    filesSearched: number;
    matchCountByFile: Map<string, number>;
}

const MAX_FILES_PER_PLUGIN = 50;
const FAIL2BAN_MAX_ROWS = 50000;

function buildTestFn(query: string, caseSensitive: boolean, useRegex: boolean): TestFn {
    if (useRegex) {
        try {
            const regex = compileSafeRegex(query, caseSensitive ? '' : 'i');
            return (line) => regex.test(line);
        } catch (err) {
            logger.warn('LogSearch', 'Invalid regex pattern, falling back to literal search:', err);
        }
    }
    const needle = caseSensitive ? query : query.toLowerCase();
    return caseSensitive
        ? (line) => line.includes(needle)
        : (line) => line.toLowerCase().includes(needle);
}

const PLUGINS_WITH_DOMAIN = new Set(['apache', 'npm', 'nginx']);

function extractDomain(pluginId: string, plugin: LogSourcePlugin, line: string, logType: string): string | undefined {
    if (!PLUGINS_WITH_DOMAIN.has(pluginId)) return undefined;
    try {
        const parsed = plugin.parseLogLine(line, logType);
        const candidate = parsed?.vhost ?? parsed?.host;
        if (typeof candidate === 'string' && candidate && candidate !== '-') {
            return candidate;
        }
    } catch { /* parser may throw on malformed lines */ }
    return undefined;
}

function formatFail2banLine(row: { ip: string; jail: string; timeofban: number; failures: number | null }): string {
    const date = new Date(row.timeofban * 1000).toISOString().replace('T', ' ').slice(0, 16);
    return `[ban] ${row.ip} | jail: ${row.jail} | failures: ${row.failures ?? 0} | ${date}`;
}

/**
 * Search fail2ban bans. For literal queries, narrows rows via indexed LIKE on ip/jail
 * before JS verification — avoids scanning 50k rows when the user types an IP or jail name.
 */
function searchFail2ban(query: string, useRegex: boolean, testFn: TestFn, maxResults: number): PluginSearchResult {
    const matches: LogSearchMatch[] = [];
    const matchCountByFile = new Map<string, number>();

    try {
        const db = getDatabase();
        const rows = useRegex
            ? db.prepare(
                `SELECT id, ip, jail, timeofban, failures FROM f2b_events ORDER BY timeofban DESC LIMIT ?`
            ).all(FAIL2BAN_MAX_ROWS)
            : db.prepare(
                `SELECT id, ip, jail, timeofban, failures FROM f2b_events
                 WHERE ip LIKE ? OR jail LIKE ?
                 ORDER BY timeofban DESC LIMIT ?`
            ).all(`%${query}%`, `%${query}%`, FAIL2BAN_MAX_ROWS);

        const typed = rows as { id: number; ip: string; jail: string; timeofban: number; failures: number | null }[];
        for (const row of typed) {
            if (matches.length >= maxResults) break;
            const line = formatFail2banLine(row);
            if (!testFn(line)) continue;
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
        return { matches, filesSearched: 1, matchCountByFile };
    } catch (err) {
        logger.warn('LogSearch', 'fail2ban f2b_events search failed:', err);
        return { matches, filesSearched: 0, matchCountByFile };
    }
}

async function resolveFilesForPlugin(
    pluginId: string,
    plugin: LogSourcePlugin,
    config: PluginConfig
): Promise<{ path: string; type: string }[]> {
    const basePath = getEffectiveBasePath(plugin, config);
    const patterns = plugin.getDefaultFilePatterns();

    if (pluginId !== 'host-system') {
        try {
            return await plugin.scanLogFiles(basePath, patterns);
        } catch (err) {
            logger.warn('LogSearch', `Failed to scan plugin ${pluginId}:`, err);
            return [];
        }
    }

    // host-system: merge declared paths with auto-scanned (dedup by path)
    const declared = getHostSystemDeclaredFiles(config).map((f) => ({
        path: resolvePathForRead(f.path),
        type: f.type
    }));
    const pathSet = new Set(declared.map((f) => f.path));
    try {
        const scanned = await plugin.scanLogFiles(basePath, patterns);
        for (const f of scanned) {
            if (!pathSet.has(f.path)) {
                declared.push(f);
                pathSet.add(f.path);
            }
        }
    } catch (err) {
        logger.warn('LogSearch', 'Failed to scan host-system:', err);
    }
    return declared;
}

interface SearchContext {
    testFn: TestFn;
    maxResults: number;
    maxLinesPerFile: number;
    includeCompressed: boolean;
}

interface FileSearchAccumulator {
    matches: LogSearchMatch[];
    matchCountByFile: Map<string, number>;
}

async function searchOneFile(
    pluginId: string,
    plugin: LogSourcePlugin,
    file: { path: string; type: string },
    readCompressed: boolean,
    ctx: SearchContext,
    acc: FileSearchAccumulator
): Promise<boolean> {
    try {
        const lines = await logReaderService.readLastLines(file.path, ctx.maxLinesPerFile, {
            readCompressed: readCompressed && isCompressedFile(file.path)
        });
        for (const logLine of lines) {
            if (acc.matches.length >= ctx.maxResults) break;
            if (!ctx.testFn(logLine.line)) continue;
            const fileKey = `${pluginId}:${file.path}`;
            acc.matchCountByFile.set(fileKey, (acc.matchCountByFile.get(fileKey) ?? 0) + 1);
            acc.matches.push({
                pluginId,
                filePath: file.path,
                fileName: path.basename(file.path),
                logType: file.type,
                lineNumber: logLine.lineNumber,
                content: logLine.line,
                domain: extractDomain(pluginId, plugin, logLine.line, file.type)
            });
        }
        return true;
    } catch (err) {
        logger.debug('LogSearch', `Skip file ${file.path}:`, err);
        return false;
    }
}

async function searchLogSourcePlugin(
    pluginId: string,
    config: PluginConfig,
    ctx: SearchContext
): Promise<PluginSearchResult> {
    const plugin = pluginManager.getPlugin(pluginId);
    const empty: PluginSearchResult = { matches: [], filesSearched: 0, matchCountByFile: new Map() };
    if (!plugin || !isLogSourcePlugin(plugin)) return empty;

    const pluginReadCompressed = (config?.settings?.readCompressed as boolean) ?? false;
    const readCompressed = ctx.includeCompressed && pluginReadCompressed;

    const allFiles = await resolveFilesForPlugin(pluginId, plugin, config);
    const files = allFiles
        .filter((f) => readCompressed || !isCompressedFile(f.path))
        .slice(0, MAX_FILES_PER_PLUGIN);

    const acc: FileSearchAccumulator = { matches: [], matchCountByFile: new Map() };
    let filesSearched = 0;
    for (const file of files) {
        if (acc.matches.length >= ctx.maxResults) break;
        const searched = await searchOneFile(pluginId, plugin, file, readCompressed, ctx, acc);
        if (searched) filesSearched++;
    }
    return { matches: acc.matches, filesSearched, matchCountByFile: acc.matchCountByFile };
}

function resolveTargetPlugins(pluginIds: string[] | undefined): string[] {
    if (pluginIds && pluginIds.length > 0) {
        return pluginIds.filter((id) => LOG_SOURCE_PLUGINS.includes(id as typeof LOG_SOURCE_PLUGINS[number]));
    }
    return [...LOG_SOURCE_PLUGINS];
}

function buildMatchesByPlugin(matches: LogSearchMatch[]): Record<string, LogSearchMatch[]> {
    const out: Record<string, LogSearchMatch[]> = {};
    for (const m of matches) {
        if (!out[m.pluginId]) out[m.pluginId] = [];
        out[m.pluginId].push(m);
    }
    return out;
}

function buildMatchCountPerFile(matchCountByFile: Map<string, number>): LogSearchMatchCount[] {
    const out: LogSearchMatchCount[] = [];
    for (const [key, count] of matchCountByFile) {
        const sep = key.indexOf(':');
        const pid = sep >= 0 ? key.slice(0, sep) : key;
        const fp = sep >= 0 ? key.slice(sep + 1) : '';
        out.push({ pluginId: pid, filePath: fp, fileName: path.basename(fp), count });
    }
    return out;
}

/**
 * Search across all active log files from enabled plugins.
 * Plugins run in parallel; within each plugin, files are processed serially to cap peak memory.
 * Fail2ban uses an indexed SQL filter for literal queries (avoids scanning 50k rows in JS).
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
    const targetPlugins = resolveTargetPlugins(pluginIds);
    const ctx: SearchContext = {
        testFn: buildTestFn(trimmedQuery, caseSensitive, useRegex),
        maxResults,
        maxLinesPerFile,
        includeCompressed
    };

    // Fetch each plugin config once; reused for enabled-check, basePath, readCompressed, and pluginsSearched.
    const configByPlugin = new Map<string, PluginConfig>();
    for (const id of targetPlugins) configByPlugin.set(id, PluginConfigRepository.findByPluginId(id));

    const active = targetPlugins.filter((id) =>
        explicitPluginFilter || (configByPlugin.get(id)?.enabled ?? false)
    );

    const perPluginResults = await Promise.all(
        active.map((pluginId) => {
            if (pluginId === 'fail2ban') {
                return Promise.resolve(searchFail2ban(trimmedQuery, useRegex, ctx.testFn, maxResults));
            }
            return searchLogSourcePlugin(pluginId, configByPlugin.get(pluginId) ?? null, ctx);
        })
    );

    const mergedMatches: LogSearchMatch[] = [];
    const mergedCounts = new Map<string, number>();
    let filesSearched = 0;
    for (const r of perPluginResults) {
        filesSearched += r.filesSearched;
        for (const [k, v] of r.matchCountByFile) mergedCounts.set(k, (mergedCounts.get(k) ?? 0) + v);
        for (const m of r.matches) {
            if (mergedMatches.length >= maxResults) break;
            mergedMatches.push(m);
        }
    }

    return {
        matches: mergedMatches,
        totalMatches: mergedMatches.length,
        filesSearched,
        filesWithMatches: mergedCounts.size,
        matchCountPerFile: buildMatchCountPerFile(mergedCounts),
        matchesByPlugin: buildMatchesByPlugin(mergedMatches),
        pluginsSearched: active.filter((id) => configByPlugin.get(id)?.enabled)
    };
}
