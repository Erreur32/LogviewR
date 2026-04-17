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

/** Upper bound on a single log line before regex parsing — prevents pathological ReDoS
 *  input from propagating through downstream patterns. Real mail log lines are well
 *  under this size; anything larger is returned as-is. */
const MAX_LINE_LENGTH = 10_000;

export class MailLogParser {
    /**
     * Parse a mail log line
     * Format: timestamp hostname mail: message
     * Uses Grok patterns for robust parsing
     */
    private static buildEntry(
        timestamp: string,
        parts: { hostname?: string; service?: string; pid?: string; message: string }
    ): ParsedLogEntry {
        const message = parts.message.trim();
        return {
            timestamp: parseTimestamp(timestamp),
            hostname: parts.hostname || undefined,
            service: parts.service,
            level: this.extractLevelFromMessage(message),
            message,
            ipAddress: this.extractIpAddress(message),
            action: this.extractAction(message),
            queueId: this.extractQueueId(message),
            pid: parts.pid ? Number.parseInt(parts.pid, 10) : undefined,
        };
    }

    static parseMailLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) return null;
        // ReDoS guard (S5852): cap input before running the parsing regexes below.
        if (line.length > MAX_LINE_LENGTH) return { message: line.slice(0, MAX_LINE_LENGTH), level: 'info' };

        // Try ISO8601 format first: "2026-01-03T00:16:25.101453+01:00 hostname service: message".
        // Matches any non-space token starting with "YYYY-MM-DDT" then lets parseTimestamp validate.
        const iso8601Match = /^(\d{4}-\d{2}-\d{2}T\S+)\s+(.+)$/.exec(line);
        if (iso8601Match) {
            const [, timestamp, rest] = iso8601Match;
            const withHost = /^(\S+)\s+(\S+)(?:\[(\d+)\])?:\s*(.*)$/.exec(rest);
            if (withHost) {
                return this.buildEntry(timestamp, { hostname: withHost[1], service: withHost[2], pid: withHost[3], message: withHost[4] });
            }
            const noHost = /^(\S+)(?:\[(\d+)\])?:\s*(.*)$/.exec(rest);
            if (noHost) {
                return this.buildEntry(timestamp, { service: noHost[1], pid: noHost[2], message: noHost[3] });
            }
        }

        // Grok syslog pattern
        const match = parseGrokPattern(line, buildSyslogPattern(false));
        if (match?.timestamp && match.program && match.message) {
            return this.buildEntry(match.timestamp, { hostname: match.hostname, service: match.program, pid: match.pid, message: match.message });
        }

        // Simpler fallback regex
        const regexMatch = /^(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(\S+):\s*(.*)$/.exec(line);
        if (regexMatch) {
            return this.buildEntry(regexMatch[1], { hostname: regexMatch[2], service: regexMatch[3], message: regexMatch[4] });
        }

        return { message: line.trim(), level: 'info' };
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
