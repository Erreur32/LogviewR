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
                    // Use CustomLogParser with custom regex
                    const customParserConfig: CustomParserConfig = {
                        regex: customRegexConfig.regex
                    };
                    parsed = CustomLogParser.parseCustomLine(logLine.line, customParserConfig);
                } else {
                    // Use default plugin parser
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
                        // Use CustomLogParser with custom regex
                        const customParserConfig: CustomParserConfig = {
                            regex: customRegexConfig.regex
                        };
                        parsed = CustomLogParser.parseCustomLine(logLine.line, customParserConfig);
                    } else {
                        // Use default plugin parser
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
                    // Use CustomLogParser with custom regex
                    const customParserConfig: CustomParserConfig = {
                        regex: customRegexConfig.regex
                    };
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
