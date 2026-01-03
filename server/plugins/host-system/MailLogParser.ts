/**
 * Mail Log Parser
 * 
 * Parser for mail logs (mail.log, mail.err)
 * Format: timestamp hostname mail: message
 * Example: Jan 1 12:00:00 hostname postfix/smtpd: connect from unknown[192.168.1.1]
 * Uses Grok patterns for robust parsing with IPv6 support
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import { buildSyslogPattern, parseGrokPattern } from './GrokPatterns.js';
import { parseTimestamp } from './TimestampParser.js';

export class MailLogParser {
    /**
     * Parse a mail log line
     * Format: timestamp hostname mail: message
     * Uses Grok patterns for robust parsing
     */
    static parseMailLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Try ISO8601 format first: 2026-01-03T00:16:25.101453+01:00 hostname service: message
        const iso8601Match = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s+(.+)$/);
        if (iso8601Match) {
            const [, timestamp, rest] = iso8601Match;
            // Extract hostname, service and message: "hostname service[pid]: message" or "service[pid]: message"
            const withHostnameMatch = rest.match(/^(\S+)\s+(\S+)(?:\[(\d+)\])?:\s*(.*)$/);
            if (withHostnameMatch) {
                const [, hostname, service, pid, message] = withHostnameMatch;
                const level = this.extractLevelFromMessage(message);
                const ipAddress = this.extractIpAddress(message);
                const action = this.extractAction(message);
                const queueId = this.extractQueueId(message);

                return {
                    timestamp: parseTimestamp(timestamp),
                    hostname: hostname || undefined,
                    service,
                    level,
                    message: message.trim(),
                    ipAddress,
                    action,
                    queueId,
                    pid: pid ? parseInt(pid, 10) : undefined
                };
            }
            // If no hostname, try: "service[pid]: message"
            const noHostnameMatch = rest.match(/^(\S+)(?:\[(\d+)\])?:\s*(.*)$/);
            if (noHostnameMatch) {
                const [, service, pid, message] = noHostnameMatch;
                const level = this.extractLevelFromMessage(message);
                const ipAddress = this.extractIpAddress(message);
                const action = this.extractAction(message);
                const queueId = this.extractQueueId(message);

                return {
                    timestamp: parseTimestamp(timestamp),
                    service,
                    level,
                    message: message.trim(),
                    ipAddress,
                    action,
                    queueId,
                    pid: pid ? parseInt(pid, 10) : undefined
                };
            }
        }

        // Mail log format: timestamp hostname service: message
        // Use base syslog pattern
        const basePattern = buildSyslogPattern(false);
        const match = parseGrokPattern(line, basePattern);

        if (match && match.timestamp && match.program && match.message) {
            const message = match.message.trim();
            const level = this.extractLevelFromMessage(message);
            const ipAddress = this.extractIpAddress(message);
            const action = this.extractAction(message);
            const queueId = this.extractQueueId(message);

            return {
                timestamp: parseTimestamp(match.timestamp),
                hostname: match.hostname || undefined,
                service: match.program,
                level,
                message,
                ipAddress,
                action,
                queueId,
                pid: match.pid ? parseInt(match.pid, 10) : undefined
            };
        }

        // Fallback: try simpler regex pattern for compatibility
        const mailRegex = /^(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(\S+):\s*(.*)$/;
        const regexMatch = line.match(mailRegex);

        if (regexMatch) {
            const [, timestamp, hostname, service, message] = regexMatch;
            const level = this.extractLevelFromMessage(message);
            const ipAddress = this.extractIpAddress(message);
            const action = this.extractAction(message);
            const queueId = this.extractQueueId(message);

            return {
                timestamp: parseTimestamp(timestamp),
                hostname: hostname || undefined,
                service,
                level,
                message: message.trim(),
                ipAddress,
                action,
                queueId
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
        
        if (lowerMessage.includes('error') || lowerMessage.includes('fatal') || lowerMessage.includes('reject')) {
            return 'error';
        }
        if (lowerMessage.includes('warning') || lowerMessage.includes('warn')) {
            return 'warning';
        }
        if (lowerMessage.includes('info') || lowerMessage.includes('connect') || lowerMessage.includes('disconnect')) {
            return 'info';
        }
        if (lowerMessage.includes('debug')) {
            return 'debug';
        }
        
        return 'info';
    }

    /**
     * Extract IP address from message (IPv4 and IPv6)
     * Supports formats: [192.168.1.1], [2001:db8::1], etc.
     */
    private static extractIpAddress(message: string): string | undefined {
        // Try IPv6 first: [2001:db8::1]
        const ipv6Regex = /\[([0-9a-fA-F:]+(?:::[0-9a-fA-F:]*)?)\]/;
        const ipv6Match = message.match(ipv6Regex);
        if (ipv6Match) {
            return ipv6Match[1];
        }
        
        // Try IPv4: [192.168.1.1]
        const ipv4Regex = /\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/;
        const ipv4Match = message.match(ipv4Regex);
        if (ipv4Match) {
            return ipv4Match[1];
        }
        
        // Try IPv4 without brackets: 192.168.1.1
        const ipv4NoBracketsRegex = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
        const ipv4NoBracketsMatch = message.match(ipv4NoBracketsRegex);
        if (ipv4NoBracketsMatch) {
            return ipv4NoBracketsMatch[1];
        }
        
        return undefined;
    }

    /**
     * Extract action from message
     */
    private static extractAction(message: string): string | undefined {
        // Common mail actions
        const actions = ['connect', 'disconnect', 'send', 'receive', 'reject', 'bounce', 'defer', 'deliver'];
        const lowerMessage = message.toLowerCase();
        
        for (const action of actions) {
            if (lowerMessage.includes(action)) {
                return action;
            }
        }
        
        return undefined;
    }

    /**
     * Extract queue ID from message (Postfix format)
     */
    private static extractQueueId(message: string): string | undefined {
        // Postfix queue ID format: ABC1234567
        const queueIdRegex = /\b([A-Z0-9]{6,12})\b/;
        const match = message.match(queueIdRegex);
        return match ? match[1] : undefined;
    }

}
