/**
 * Custom Log Parser
 * 
 * Parser for custom logs with user-defined regex patterns
 * Allows users to define their own parsing rules
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';

export interface CustomParserConfig {
    regex: string;
    groups?: {
        timestamp?: number;
        level?: number;
        message?: number;
        [key: string]: number | undefined;
    };
    levelMapping?: Record<string, string>;
}

export class CustomLogParser {
    /**
     * Parse a custom log line using user-defined regex
     * @param line Line to parse
     * @param config Custom parser configuration
     * @returns Parsed log entry or null if parsing fails
     */
    static parseCustomLine(line: string, config: CustomParserConfig): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        if (!config.regex) {
            // No regex provided, return raw message
            return {
                message: line.trim(),
                level: 'info'
            };
        }

        try {
            const regex = new RegExp(config.regex);
            const match = line.match(regex);

            if (!match) {
                // Regex doesn't match, return raw message
                return {
                    message: line.trim(),
                    level: 'info'
                };
            }

            const result: ParsedLogEntry = {
                message: line.trim(),
                level: 'info'
            };

            // Extract groups based on configuration
            if (config.groups) {
                // Extract timestamp if configured
                if (config.groups.timestamp !== undefined && match[config.groups.timestamp]) {
                    result.timestamp = this.parseTimestamp(match[config.groups.timestamp]);
                }

                // Extract level if configured
                if (config.groups.level !== undefined && match[config.groups.level]) {
                    const rawLevel = match[config.groups.level];
                    result.level = config.levelMapping?.[rawLevel] || this.normalizeLevel(rawLevel);
                }

                // Extract message if configured
                if (config.groups.message !== undefined && match[config.groups.message]) {
                    result.message = match[config.groups.message].trim();
                }

                // Extract custom fields
                for (const [fieldName, groupIndex] of Object.entries(config.groups)) {
                    if (fieldName !== 'timestamp' && fieldName !== 'level' && fieldName !== 'message') {
                        if (groupIndex !== undefined && match[groupIndex]) {
                            result[fieldName] = match[groupIndex];
                        }
                    }
                }
            } else {
                // No groups configured, try to extract common patterns
                result.timestamp = this.tryExtractTimestamp(line);
                result.level = this.extractLevelFromMessage(line);
            }

            return result;
        } catch (error) {
            // Invalid regex, return raw message
            console.error(`[CustomLogParser] Invalid regex: ${config.regex}`, error);
            return {
                message: line.trim(),
                level: 'info'
            };
        }
    }

    /**
     * Try to extract timestamp from line
     */
    private static tryExtractTimestamp(line: string): Date | undefined {
        // Try common timestamp formats
        const timestampPatterns = [
            // ISO 8601
            /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            // Syslog format
            /\w+\s+\d+\s+\d+:\d+:\d+/,
            // Unix timestamp
            /\d{10,13}/
        ];

        for (const pattern of timestampPatterns) {
            const match = line.match(pattern);
            if (match) {
                const timestamp = match[0];
                // Try to parse as ISO 8601
                const isoDate = new Date(timestamp);
                if (!isNaN(isoDate.getTime())) {
                    return isoDate;
                }
                // Try to parse as syslog format
                return this.parseTimestamp(timestamp);
            }
        }

        return undefined;
    }

    /**
     * Extract level from message content
     */
    private static extractLevelFromMessage(message: string): string {
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('error') || lowerMessage.includes('err') || lowerMessage.includes('fatal')) {
            return 'error';
        }
        if (lowerMessage.includes('warning') || lowerMessage.includes('warn')) {
            return 'warning';
        }
        if (lowerMessage.includes('debug')) {
            return 'debug';
        }
        
        return 'info';
    }

    /**
     * Normalize level string
     */
    private static normalizeLevel(level: string): string {
        const lowerLevel = level.toLowerCase();
        
        if (lowerLevel.includes('error') || lowerLevel.includes('err') || lowerLevel.includes('fatal') || lowerLevel.includes('critical')) {
            return 'error';
        }
        if (lowerLevel.includes('warning') || lowerLevel.includes('warn')) {
            return 'warning';
        }
        if (lowerLevel.includes('debug') || lowerLevel.includes('trace')) {
            return 'debug';
        }
        if (lowerLevel.includes('info') || lowerLevel.includes('information')) {
            return 'info';
        }
        
        return 'info';
    }

    /**
     * Parse timestamp string to Date
     * Format: "Jan 1 12:00:00" or "Jan 01 12:00:00"
     */
    private static parseTimestamp(timestamp: string): Date {
        const now = new Date();
        const currentYear = now.getFullYear();
        
        // Try to parse: "Jan 1 12:00:00"
        const dateMatch = timestamp.match(/(\w+)\s+(\d+)\s+(\d+):(\d+):(\d+)/);
        
        if (dateMatch) {
            const [, month, day, hour, minute, second] = dateMatch;
            const monthMap: Record<string, number> = {
                'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
            };
            
            const monthIndex = monthMap[month] ?? 0;
            const date = new Date(
                currentYear,
                monthIndex,
                parseInt(day, 10),
                parseInt(hour, 10),
                parseInt(minute, 10),
                parseInt(second, 10)
            );
            
            return date;
        }
        
        // Try Unix timestamp
        const unixTimestamp = parseInt(timestamp, 10);
        if (!isNaN(unixTimestamp)) {
            // If timestamp is in seconds, convert to milliseconds
            const timestampMs = unixTimestamp < 10000000000 ? unixTimestamp * 1000 : unixTimestamp;
            return new Date(timestampMs);
        }
        
        // Fallback to current date
        return new Date();
    }
}
