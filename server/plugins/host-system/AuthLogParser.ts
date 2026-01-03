/**
 * Auth Log Parser
 * 
 * Parser for authentication logs (auth.log, secure)
 * Format: timestamp hostname service: message
 * Example: Jan 1 12:00:00 hostname sshd: Accepted password for user from 192.168.1.1
 * Uses Grok patterns for robust parsing with IPv6 support
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import { buildSyslogPattern, parseGrokPattern } from './GrokPatterns.js';
import { parseTimestamp } from './TimestampParser.js';

export class AuthLogParser {
    /**
     * Parse an auth log line
     * Format: timestamp hostname service: message
     * Uses Grok patterns for robust parsing
     */
    static parseAuthLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Try ISO 8601 format first (Debian 12, systemd): 2025-12-28T00:00:02.098394+01:00 hostname service[pid]: message
        // Example: 2025-12-28T00:00:02.098394+01:00 Home32-Cloud CRON[2175971]: pam_unix(cron:session): session closed for user root
        const iso8601Regex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s+(\S+)\s+(\S+)(?:\[(\d+)\])?:\s*(.*)$/;
        const iso8601Match = line.match(iso8601Regex);
        
        if (iso8601Match) {
            const [, timestampStr, hostname, service, pid, message] = iso8601Match;
            const messageTrimmed = message.trim();
            const level = this.extractLevelFromMessage(messageTrimmed);
            const ipAddress = this.extractIpAddress(messageTrimmed);
            const user = this.extractUser(messageTrimmed);
            const action = this.extractAction(messageTrimmed);

            return {
                timestamp: parseTimestamp(timestampStr),
                hostname,
                service,
                level,
                message: messageTrimmed,
                ipAddress,
                user,
                action,
                pid: pid ? parseInt(pid, 10) : undefined
            };
        }

        // Try syslog format: timestamp hostname service: message (traditional syslog)
        // Use base syslog pattern
        const basePattern = buildSyslogPattern(false);
        const match = parseGrokPattern(line, basePattern);

        if (match && match.timestamp && match.hostname && match.program && match.message) {
            const message = match.message.trim();
            const level = this.extractLevelFromMessage(message);
            const ipAddress = this.extractIpAddress(message);
            const user = this.extractUser(message);
            const action = this.extractAction(message);

            return {
                timestamp: parseTimestamp(match.timestamp),
                hostname: match.hostname,
                service: match.program,
                level,
                message,
                ipAddress,
                user,
                action,
                pid: match.pid ? parseInt(match.pid, 10) : undefined
            };
        }

        // Fallback: try simpler regex pattern for compatibility
        const authRegex = /^(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(\S+):\s*(.*)$/;
        const regexMatch = line.match(authRegex);

        if (regexMatch) {
            const [, timestamp, hostname, service, message] = regexMatch;
            const level = this.extractLevelFromMessage(message);
            const ipAddress = this.extractIpAddress(message);
            const user = this.extractUser(message);
            const action = this.extractAction(message);

            return {
                timestamp: parseTimestamp(timestamp),
                hostname,
                service,
                level,
                message: message.trim(),
                ipAddress,
                user,
                action
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
        
        if (lowerMessage.includes('failed') || lowerMessage.includes('error') || lowerMessage.includes('denied')) {
            return 'error';
        }
        if (lowerMessage.includes('warning') || lowerMessage.includes('invalid')) {
            return 'warning';
        }
        if (lowerMessage.includes('accepted') || lowerMessage.includes('success')) {
            return 'info';
        }
        
        return 'info';
    }

    /**
     * Extract IP address from message (IPv4 and IPv6)
     * Supports formats: from 192.168.1.1, IP 192.168.1.1, [2001:db8::1], etc.
     * Validates that extracted values are real IP addresses
     */
    private static extractIpAddress(message: string): string | undefined {
        // Try IPv4 first (more common): 192.168.1.1
        // Must be preceded by "from", "IP", or standalone word boundary
        const ipv4Regex = /\b(?:from|IP|ip)\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b|\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
        const ipv4Match = message.match(ipv4Regex);
        if (ipv4Match) {
            const ip = ipv4Match[1] || ipv4Match[2];
            // Validate IPv4: each octet must be 0-255
            if (ip) {
                const octets = ip.split('.');
                if (octets.length === 4 && octets.every(oct => {
                    const num = parseInt(oct, 10);
                    return !isNaN(num) && num >= 0 && num <= 255;
                })) {
                    return ip;
                }
            }
        }
        
        // Try IPv6: [2001:db8::1] or 2001:db8::1
        // Must be preceded by "from", "IP", or in brackets
        const ipv6Regex = /(?:\[([0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,7}|::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}|[0-9a-fA-F]{1,4}::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,5}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}::[0-9a-fA-F]{1,4}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,5}::[0-9a-fA-F]{1,4}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,4}::[0-9a-fA-F]{1,4}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,3}::[0-9a-fA-F]{1,4}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,2}::[0-9a-fA-F]{1,4}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})?::[0-9a-fA-F]{1,4}|[0-9a-fA-F]{1,4}::)\]|(?:from|IP|ip)\s+([0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,7}|::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}|[0-9a-fA-F]{1,4}::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,5}|[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}::[0-9a-fA-F]{1,4}))/i;
        const ipv6Match = message.match(ipv6Regex);
        if (ipv6Match && (ipv6Match[1] || ipv6Match[2])) {
            const ip = ipv6Match[1] || ipv6Match[2];
            // Basic IPv6 validation: must contain colons and be a valid format
            if (ip && ip.includes(':') && ip.length >= 2) {
                return ip;
            }
        }
        
        return undefined;
    }

    /**
     * Extract username from message
     * Supports multiple patterns: for user root, user=username, user username, etc.
     */
    private static extractUser(message: string): string | undefined {
        // Pattern 1: "for user root" or "for user username" - capture the username after "for user"
        const forUserPattern = /for\s+user\s+([a-z_][a-z0-9_\-]*)/i;
        const forUserMatch = message.match(forUserPattern);
        if (forUserMatch) {
            return forUserMatch[1];
        }
        
        // Pattern 2: "Accepted password for username" (without "user" keyword)
        const acceptedPattern = /accepted\s+(?:password|publickey)\s+for\s+([a-z_][a-z0-9_\-]*)/i;
        const acceptedMatch = message.match(acceptedPattern);
        if (acceptedMatch) {
            return acceptedMatch[1];
        }
        
        // Pattern 3: "user=username" or "user = username"
        const userEqualsPattern = /user\s*=\s*([a-z_][a-z0-9_\-]*)/i;
        const userEqualsMatch = message.match(userEqualsPattern);
        if (userEqualsMatch) {
            return userEqualsMatch[1];
        }
        
        // Pattern 4: "user username" (space separated, but not "for user")
        // Check if "user" appears without "for" before it
        const userSpacePattern = /user\s+([a-z_][a-z0-9_\-]*)/i;
        const userSpaceMatch = message.match(userSpacePattern);
        if (userSpaceMatch) {
            // Check if this match is NOT part of "for user"
            const matchIndex = userSpaceMatch.index || 0;
            const beforeMatch = message.substring(Math.max(0, matchIndex - 5), matchIndex);
            if (!beforeMatch.toLowerCase().includes('for ')) {
                return userSpaceMatch[1];
            }
        }
        
        return undefined;
    }

    /**
     * Extract action from message
     */
    private static extractAction(message: string): string | undefined {
        // Common auth actions
        const actions = ['accepted', 'failed', 'disconnected', 'opened', 'closed', 'authentication failure'];
        const lowerMessage = message.toLowerCase();
        
        for (const action of actions) {
            if (lowerMessage.includes(action)) {
                return action;
            }
        }
        
        return undefined;
    }

}
