/**
 * Log Search Service
 *
 * Searches across all active log files from enabled plugins.
 * Used by the dashboard "Recherche" card for global log search.
 */

import { pluginManager } from './pluginManager.js';
import { logReaderService } from './logReaderService.js';
import { PluginConfigRepository } from '../database/models/PluginConfig.js';
import { logger } from '../utils/logger.js';
import type { LogSourcePlugin } from '../plugins/base/LogSourcePluginInterface.js';
import * as path from 'path';

const LOG_SOURCE_PLUGINS = ['host-system', 'apache', 'npm', 'nginx'] as const;

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
    maxResults?: number;
    maxLinesPerFile?: number;
}

export interface LogSearchResult {
    matches: LogSearchMatch[];
    totalMatches: number;
    filesSearched: number;
    pluginsSearched: string[];
}

/**
 * Search across all active log files from enabled plugins.
 */
export async function searchAllLogs(options: LogSearchOptions): Promise<LogSearchResult> {
    const {
        query,
        pluginIds,
        caseSensitive = false,
        useRegex = false,
        maxResults = 100,
        maxLinesPerFile = 5000
    } = options;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
        return { matches: [], totalMatches: 0, filesSearched: 0, pluginsSearched: [] };
    }

    const trimmedQuery = query.trim();
    const targetPlugins = pluginIds && pluginIds.length > 0
        ? pluginIds.filter((id) => LOG_SOURCE_PLUGINS.includes(id as typeof LOG_SOURCE_PLUGINS[number]))
        : [...LOG_SOURCE_PLUGINS];

    const matches: LogSearchMatch[] = [];
    let filesSearched = 0;

    let testFn: (line: string) => boolean;
    try {
        if (useRegex) {
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
        if (!config?.enabled) continue;

        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin || !isLogSourcePlugin(plugin)) continue;

        const basePath = getEffectiveBasePath(pluginId, plugin);
        const patterns = plugin.getDefaultFilePatterns();

        let files: { path: string; type: string }[];
        try {
            files = await plugin.scanLogFiles(basePath, patterns);
        } catch (err) {
            logger.warn('LogSearch', `Failed to scan plugin ${pluginId}:`, err);
            continue;
        }

        const readCompressed = (config.settings?.readCompressed as boolean) ?? false;
        const filteredFiles = files.filter((f) => {
            if (!readCompressed && isCompressedFile(f.path)) return false;
            return true;
        }).slice(0, 30);

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

    return {
        matches,
        totalMatches: matches.length,
        filesSearched,
        pluginsSearched: targetPlugins.filter((id) => {
            const c = PluginConfigRepository.findByPluginId(id);
            return c?.enabled;
        })
    };
}
