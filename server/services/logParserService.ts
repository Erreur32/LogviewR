/**
 * Log Parser Service
 * 
 * Service that uses plugin parsers to parse log lines
 * Coordinates between logReaderService and plugin parsers
 * Supports custom regex patterns for log parsing
 */

import type { LogSourcePlugin, ParsedLogEntry } from '../plugins/base/LogSourcePluginInterface.js';
import { pluginManager } from './pluginManager.js';
import { logReaderService, type LogLine } from './logReaderService.js';
import { logger } from '../utils/logger.js';
import { PluginConfigRepository } from '../database/models/PluginConfig.js';
import { CustomLogParser, type CustomParserConfig } from '../plugins/host-system/CustomLogParser.js';
import { ApacheParser } from '../plugins/apache/ApacheParser.js';

export interface ParsedLogResult {
    parsed: ParsedLogEntry;
    raw: LogLine;
    pluginId: string;
    logType: string;
}

export interface ParseLogFileOptions {
    pluginId: string;
    filePath: string;
    logType: string;
    maxLines?: number;
    fromLine?: number;
    readCompressed?: boolean;
}

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

/** Apache generic regex keys for "Files detected with regex" (one regex per category) */
export const APACHE_REGEX_KEYS = {
    ACCESS: 'access.log',
    ERROR: 'error.log',
    ACCESS_VHOST: 'access_*.log'
} as const;

/**
 * Get Apache generic regex key for a file path (for resolving stored regex by pattern).
 * Returns 'access.log', 'error.log', 'access_*.log' or null if not an Apache generic pattern.
 * Covers: access.log, error.log, access_<name>.log, access.<domain>.log (e.g. access.home32.myoueb.fr.log).
 */
export function getApacheRegexKeyForPath(filePath: string): string | null {
    const base = normalizeLogFilePath(filePath);
    const basename = base.split('/').pop() || base;
    if (basename === 'access.log') return APACHE_REGEX_KEYS.ACCESS;
    if (basename === 'error.log') return APACHE_REGEX_KEYS.ERROR;
    // access_*.log (access_vhost.log) or access.<domain>.log (access.home32.myoueb.fr.log, access.ip.myoueb.fr.log)
    if (/^access_.*\.log$/.test(basename) || /^access\..+\.log$/.test(basename)) return APACHE_REGEX_KEYS.ACCESS_VHOST;
    return null;
}

/** NPM generic regex keys for "Files detected with regex" (one regex per pattern) */
export const NPM_REGEX_KEYS = [
    'proxy-host-*_access.log',
    'proxy-host-*_error.log',
    'dead-host-*_access.log',
    'dead-host-*_error.log',
    'default-host_access.log',
    'default-host_error.log',
    'fallback_access.log',
    'fallback_error.log',
    'letsencrypt-requests_access.log',
    'letsencrypt-requests_error.log'
] as const;

/**
 * Get NPM generic regex key for a file path (for resolving stored regex by pattern).
 * Returns one of NPM_REGEX_KEYS or null.
 */
export function getNpmRegexKeyForPath(filePath: string): (typeof NPM_REGEX_KEYS)[number] | null {
    const base = normalizeLogFilePath(filePath);
    const basename = base.split('/').pop() || base;
    if (/^proxy-host-[^_]+_access\.log$/.test(basename)) return 'proxy-host-*_access.log';
    if (/^proxy-host-[^_]+_error\.log$/.test(basename)) return 'proxy-host-*_error.log';
    if (/^dead-host-[^_]+_access\.log$/.test(basename)) return 'dead-host-*_access.log';
    if (/^dead-host-[^_]+_error\.log$/.test(basename)) return 'dead-host-*_error.log';
    if (basename === 'default-host_access.log') return 'default-host_access.log';
    if (basename === 'default-host_error.log') return 'default-host_error.log';
    if (basename === 'fallback_access.log') return 'fallback_access.log';
    if (basename === 'fallback_error.log') return 'fallback_error.log';
    if (basename === 'letsencrypt-requests_access.log') return 'letsencrypt-requests_access.log';
    if (basename === 'letsencrypt-requests_error.log') return 'letsencrypt-requests_error.log';
    return null;
}

/** Nginx generic regex keys: one for access, one for error */
export const NGINX_REGEX_KEYS = ['access.log', 'error.log'] as const;

/**
 * Get Nginx generic regex key for a file path (access vs error by filename).
 */
export function getNginxRegexKeyForPath(filePath: string): (typeof NGINX_REGEX_KEYS)[number] | null {
    const base = normalizeLogFilePath(filePath);
    const basename = (base.split('/').pop() || base).toLowerCase();
    if (basename.includes('error')) return 'error.log';
    if (basename.includes('access')) return 'access.log';
    return null;
}

/**
 * Get custom regex configuration for a file
 * @param pluginId Plugin ID
 * @param filePath File path (will be normalized)
 * @returns Custom regex config or null if not found
 */
function getCustomRegexConfig(pluginId: string, filePath: string): { regex: string; logType: string } | null {
    try {
        // Get plugin config from database
        const dbConfig = PluginConfigRepository.findByPluginId(pluginId);
        if (!dbConfig || !dbConfig.settings) {
            return null;
        }

        // Check for custom regex in plugin settings
        // Format: { customRegex: { [filePath]: { regex: string, logType: string } } }
        const customRegex = (dbConfig.settings as any).customRegex;
        if (!customRegex || typeof customRegex !== 'object') {
            return null;
        }

        // First, try to find regex for the exact file path
        if (customRegex[filePath]) {
            return {
                regex: customRegex[filePath].regex,
                logType: customRegex[filePath].logType || 'custom'
            };
        }

        // If not found, try to find regex for the base log file (without rotation/compression)
        // Example: access.log.1.gz -> access.log
        const baseFilePath = normalizeLogFilePath(filePath);
        if (baseFilePath !== filePath && customRegex[baseFilePath]) {
            return {
                regex: customRegex[baseFilePath].regex,
                logType: customRegex[baseFilePath].logType || 'custom'
            };
        }

        // Apache: resolve by generic pattern (access.log, error.log, access_*.log)
        if (pluginId === 'apache') {
            const apacheKey = getApacheRegexKeyForPath(filePath);
            if (apacheKey && customRegex[apacheKey]) {
                return {
                    regex: customRegex[apacheKey].regex,
                    logType: customRegex[apacheKey].logType || 'access'
                };
            }
        }

        // NPM: resolve by generic pattern (proxy-host-*_access.log, etc.)
        if (pluginId === 'npm') {
            const npmKey = getNpmRegexKeyForPath(filePath);
            if (npmKey && customRegex[npmKey]) {
                return {
                    regex: customRegex[npmKey].regex,
                    logType: customRegex[npmKey].logType || 'access'
                };
            }
        }

        // Nginx: resolve by type (access.log or error.log)
        if (pluginId === 'nginx') {
            const nginxKey = getNginxRegexKeyForPath(filePath);
            if (nginxKey && customRegex[nginxKey]) {
                return {
                    regex: customRegex[nginxKey].regex,
                    logType: customRegex[nginxKey].logType || 'access'
                };
            }
        }

        return null;
    } catch (error) {
        logger.error('LogParserService', `Error getting custom regex config for ${filePath}:`, error);
        return null;
    }
}

/**
 * Service for parsing log files using plugin parsers
 */
export class LogParserService {
    /**
     * Parse log file using the appropriate plugin parser
     */
    async parseLogFile(options: ParseLogFileOptions): Promise<ParsedLogResult[]> {
        const { pluginId, filePath, logType, maxLines = 0, fromLine = 0, readCompressed = false } = options; // 0 = no limit (was 1000)

        try {
            // Get plugin
            const plugin = pluginManager.getPlugin(pluginId);
            if (!plugin) {
                throw new Error(`Plugin not found: ${pluginId}`);
            }

            // Check if plugin implements LogSourcePlugin
            if (!this.isLogSourcePlugin(plugin)) {
                throw new Error(`Plugin ${pluginId} does not implement LogSourcePlugin`);
            }

            // Read log lines
            const logLines = await logReaderService.readLogFile(filePath, {
                maxLines,
                fromLine,
                encoding: 'utf8',
                readCompressed
            });

            // Check if custom regex exists for this file
            const customRegexConfig = getCustomRegexConfig(pluginId, filePath);
            const useCustomParser = customRegexConfig !== null;

            // Parse each line using the appropriate parser
            const results: ParsedLogResult[] = [];

            for (const logLine of logLines) {
                let parsed: ParsedLogEntry | null = null;

                if (useCustomParser && customRegexConfig) {
                    // Apache access: use ApacheParser with custom regex so columns (ip, vhost, method, url, status, etc.) are filled
                    const isApacheAccess = pluginId === 'apache' && (customRegexConfig.logType === 'access' || logType === 'access');
                    if (isApacheAccess) {
                        parsed = ApacheParser.parseAccessLineWithCustomRegex(logLine.line, customRegexConfig.regex);
                    } else {
                        const customParserConfig: CustomParserConfig = { regex: customRegexConfig.regex };
                        parsed = CustomLogParser.parseCustomLine(logLine.line, customParserConfig);
                    }
                } else {
                    parsed = plugin.parseLogLine(logLine.line, logType);
                }

                if (parsed) {
                    // Serialize Date objects to ISO strings for JSON transport
                    const serializedParsed: any = { ...parsed };
                    if (serializedParsed.timestamp instanceof Date) {
                        serializedParsed.timestamp = serializedParsed.timestamp.toISOString();
                    }
                    
                    // Mark as successfully parsed
                    results.push({
                        parsed: {
                            ...serializedParsed,
                            isParsed: true
                        },
                        raw: logLine,
                        pluginId,
                        logType: useCustomParser && customRegexConfig ? customRegexConfig.logType : logType
                    });
                } else {
                    // If parsing fails, include raw line with default structure and mark as unparsed
                    results.push({
                        parsed: {
                            message: logLine.line,
                            level: 'info',
                            isParsed: false
                        },
                        raw: logLine,
                        pluginId,
                        logType: useCustomParser && customRegexConfig ? customRegexConfig.logType : logType
                    });
                }
            }

            return results;
        } catch (error) {
            logger.error('LogParserService', `Error parsing log file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Stream and parse log file
     */
    async streamAndParseLogFile(
        options: ParseLogFileOptions & { follow?: boolean },
        callback: (result: ParsedLogResult) => void
    ): Promise<void> {
        const { pluginId, filePath, logType, follow = false, fromLine = 0, readCompressed = false } = options;

        try {
            // Get plugin
            const plugin = pluginManager.getPlugin(pluginId);
            if (!plugin) {
                throw new Error(`Plugin not found: ${pluginId}`);
            }

            // Check if plugin implements LogSourcePlugin
            if (!this.isLogSourcePlugin(plugin)) {
                throw new Error(`Plugin ${pluginId} does not implement LogSourcePlugin`);
            }

            // Check if custom regex exists for this file
            const customRegexConfig = getCustomRegexConfig(pluginId, filePath);
            const useCustomParser = customRegexConfig !== null;

            // Stream log lines
            await logReaderService.streamLogFile(
                filePath,
                (logLine: LogLine) => {
                    let parsed: ParsedLogEntry | null = null;

                    if (useCustomParser && customRegexConfig) {
                        const isApacheAccess = pluginId === 'apache' && (customRegexConfig.logType === 'access' || logType === 'access');
                        if (isApacheAccess) {
                            parsed = ApacheParser.parseAccessLineWithCustomRegex(logLine.line, customRegexConfig.regex);
                        } else {
                            const customParserConfig: CustomParserConfig = { regex: customRegexConfig.regex };
                            parsed = CustomLogParser.parseCustomLine(logLine.line, customParserConfig);
                        }
                    } else {
                        parsed = plugin.parseLogLine(logLine.line, logType);
                    }

                    if (parsed) {
                        callback({
                            parsed: {
                                ...parsed,
                                isParsed: true
                            },
                            raw: logLine,
                            pluginId,
                            logType: useCustomParser && customRegexConfig ? customRegexConfig.logType : logType
                        });
                    } else {
                        // If parsing fails, include raw line with default structure and mark as unparsed
                        callback({
                            parsed: {
                                message: logLine.line,
                                level: 'info',
                                isParsed: false
                            },
                            raw: logLine,
                            pluginId,
                            logType: useCustomParser && customRegexConfig ? customRegexConfig.logType : logType
                        });
                    }
                },
                {
                    follow,
                    fromLine,
                    encoding: 'utf8',
                    readCompressed
                }
            );
        } catch (error) {
            logger.error('LogParserService', `Error streaming log file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Parse a single log line
     * @param pluginId Plugin ID
     * @param line Log line to parse
     * @param logType Log type
     * @param filePath Optional file path to check for custom regex
     */
    parseLogLine(pluginId: string, line: string, logType: string, filePath?: string): ParsedLogEntry | null {
        try {
            const plugin = pluginManager.getPlugin(pluginId);
            if (!plugin) {
                return null;
            }

            if (!this.isLogSourcePlugin(plugin)) {
                return null;
            }

            // Check if custom regex exists for this file (if filePath is provided)
            if (filePath) {
                const customRegexConfig = getCustomRegexConfig(pluginId, filePath);
                if (customRegexConfig) {
                    const isApacheAccess = pluginId === 'apache' && (customRegexConfig.logType === 'access' || logType === 'access');
                    if (isApacheAccess) {
                        return ApacheParser.parseAccessLineWithCustomRegex(line, customRegexConfig.regex);
                    }
                    const customParserConfig: CustomParserConfig = { regex: customRegexConfig.regex };
                    return CustomLogParser.parseCustomLine(line, customParserConfig);
                }
            }

            // Use default plugin parser
            return plugin.parseLogLine(line, logType);
        } catch (error) {
            logger.error('LogParserService', `Error parsing log line:`, error);
            return null;
        }
    }

    /**
     * Get columns for a log type
     */
    getColumns(pluginId: string, logType: string): string[] {
        try {
            const plugin = pluginManager.getPlugin(pluginId);
            if (!plugin) {
                return ['timestamp', 'level', 'message'];
            }

            if (!this.isLogSourcePlugin(plugin)) {
                return ['timestamp', 'level', 'message'];
            }

            return plugin.getColumns(logType);
        } catch (error) {
            logger.error('LogParserService', `Error getting columns:`, error);
            return ['timestamp', 'level', 'message'];
        }
    }

    /**
     * Type guard to check if plugin implements LogSourcePlugin
     */
    private isLogSourcePlugin(plugin: any): plugin is LogSourcePlugin {
        return (
            typeof plugin.scanLogFiles === 'function' &&
            typeof plugin.parseLogLine === 'function' &&
            typeof plugin.getColumns === 'function' &&
            typeof plugin.validateConfig === 'function'
        );
    }
}

// Export singleton instance
export const logParserService = new LogParserService();
