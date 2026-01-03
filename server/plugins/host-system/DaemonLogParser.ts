/**
 * Daemon Log Parser
 * 
 * Parser for daemon logs (daemon.log)
 * Format: timestamp hostname daemon: message
 * Example: Jan 1 12:00:00 hostname systemd: Started service
 * Uses Grok patterns for robust parsing
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import { buildSyslogPattern, parseGrokPattern } from './GrokPatterns.js';
import { parseTimestamp } from './TimestampParser.js';

export class DaemonLogParser {
    /**
     * Parse a daemon log line
     * Format: timestamp hostname daemon: message
     * Uses Grok patterns for robust parsing
     */
    static parseDaemonLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Try ISO8601 format first: 2026-01-03T00:16:25.101453+01:00 hostname service: message
        const iso8601Match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s+(.+)$/);
        if (iso8601Match) {
            const [, timestamp, rest] = iso8601Match;
            // Extract hostname, service and message: "hostname service[pid]: message" or "service[pid]: message"
            // Improved regex to handle cases where message might be empty or contain special characters
            const withHostnameMatch = rest.match(/^(\S+)\s+(\S+)(?:\[(\d+)\])?:\s*(.*)$/);
            if (withHostnameMatch) {
                const [, hostname, service, pid, message] = withHostnameMatch;
                const messageTrimmed = message ? message.trim() : '';
                const level = messageTrimmed ? this.extractLevelFromMessage(messageTrimmed) : 'info';
                const serviceName = messageTrimmed ? this.extractServiceName(service, messageTrimmed) : undefined;

                return {
                    timestamp: parseTimestamp(timestamp),
                    hostname: hostname || undefined,
                    service: serviceName || service,
                    level,
                    message: messageTrimmed || `${service}${pid ? `[${pid}]` : ''}`,
                    pid: pid ? parseInt(pid, 10) : undefined
                };
            }
            // If no hostname, try: "service[pid]: message"
            const noHostnameMatch = rest.match(/^(\S+)(?:\[(\d+)\])?:\s*(.*)$/);
            if (noHostnameMatch) {
                const [, service, pid, message] = noHostnameMatch;
                const messageTrimmed = message ? message.trim() : '';
                const level = messageTrimmed ? this.extractLevelFromMessage(messageTrimmed) : 'info';
                const serviceName = messageTrimmed ? this.extractServiceName(service, messageTrimmed) : undefined;

                return {
                    timestamp: parseTimestamp(timestamp),
                    service: serviceName || service,
                    level,
                    message: messageTrimmed || `${service}${pid ? `[${pid}]` : ''}`,
                    pid: pid ? parseInt(pid, 10) : undefined
                };
            }
        }

        // Daemon log format: timestamp hostname daemon: message
        // Use base syslog pattern which supports PID
        const basePattern = buildSyslogPattern(false);
        const match = parseGrokPattern(line, basePattern);

        if (match && match.timestamp && match.program && match.message) {
            const message = match.message.trim();
            const level = this.extractLevelFromMessage(message);
            const serviceName = this.extractServiceName(match.program, message);

            return {
                timestamp: parseTimestamp(match.timestamp),
                hostname: match.hostname || undefined,
                service: serviceName || match.program,
                level,
                message,
                pid: match.pid ? parseInt(match.pid, 10) : undefined
            };
        }

        // Fallback: try simpler regex pattern for compatibility
        const daemonRegex = /^(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(\S+)(?:\[(\d+)\])?:\s*(.*)$/;
        const regexMatch = line.match(daemonRegex);

        if (regexMatch) {
            const [, timestamp, hostname, service, pid, message] = regexMatch;
            const level = this.extractLevelFromMessage(message);
            const serviceName = this.extractServiceName(service, message);

            return {
                timestamp: parseTimestamp(timestamp),
                hostname: hostname || undefined,
                service: serviceName || service,
                level,
                message: message.trim(),
                pid: pid ? parseInt(pid, 10) : undefined
            };
        }

        // Fallback: return as-is
        return {
            message: line.trim(),
            level: 'info'
        };
    }

    /**
     * Extract log level from message content
     */
    private static extractLevelFromMessage(message: string): string {
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('error') || lowerMessage.includes('failed') || lowerMessage.includes('fatal')) {
            return 'error';
        }
        if (lowerMessage.includes('warning') || lowerMessage.includes('warn')) {
            return 'warning';
        }
        if (lowerMessage.includes('started') || lowerMessage.includes('stopped') || lowerMessage.includes('reloaded')) {
            return 'info';
        }
        if (lowerMessage.includes('debug')) {
            return 'debug';
        }
        
        return 'info';
    }

    /**
     * Extract service name from message
     */
    private static extractServiceName(service: string, message: string): string | undefined {
        // Common systemd service patterns
        const serviceRegex = /(?:Started|Stopped|Reloaded)\s+([\w-]+\.service)/i;
        const match = message.match(serviceRegex);
        return match ? match[1] : undefined;
    }

}
