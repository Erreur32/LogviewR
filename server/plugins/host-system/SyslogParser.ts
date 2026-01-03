/**
 * Syslog Parser
 * 
 * Parser for syslog and journald log formats
 * Uses Grok patterns for robust parsing
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import { grokToRegex, parseGrokPattern, buildSyslogPattern } from './GrokPatterns.js';
import { parseTimestamp } from './TimestampParser.js';

export class SyslogParser {
    /**
     * Parse a syslog line
     * Format: <priority>timestamp hostname tag: message
     * Example: <30>Jan 1 12:00:00 hostname app: message
     * Uses Grok patterns for robust parsing
     */
    static parseSyslogLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Try ISO 8601 format first (Debian 12, systemd): 2025-12-28T00:00:02.098394+01:00 hostname tag[pid]: message
        // Example: 2025-12-28T00:00:02.098394+01:00 Home32-Cloud CRON[2175971]: message
        const iso8601Regex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s+(\S+)\s+(\S+)(?:\[(\d+)\])?:\s*(.*)$/;
        const iso8601Match = line.match(iso8601Regex);
        
        if (iso8601Match) {
            const [, timestampStr, hostname, tag, pid, message] = iso8601Match;
            
            return {
                timestamp: parseTimestamp(timestampStr),
                hostname,
                tag,
                message: message.trim(),
                level: this.extractLevelFromMessage(message),
                pid: pid ? parseInt(pid, 10) : undefined
            };
        }

        // Try pattern with priority first: <priority>timestamp hostname tag[pid]: message
        const priorityPattern = buildSyslogPattern(true);
        const priorityMatch = parseGrokPattern(line, priorityPattern);
        
        if (priorityMatch && priorityMatch.priority && priorityMatch.timestamp && 
            priorityMatch.hostname && priorityMatch.program && priorityMatch.message) {
            const priority = parseInt(priorityMatch.priority, 10);
            const level = this.getLevelFromPriority(priority);

            return {
                timestamp: parseTimestamp(priorityMatch.timestamp),
                level,
                hostname: priorityMatch.hostname,
                tag: priorityMatch.program,
                message: priorityMatch.message.trim(),
                priority,
                pid: priorityMatch.pid ? parseInt(priorityMatch.pid, 10) : undefined
            };
        }

        // Try pattern without priority: timestamp hostname tag[pid]: message
        const basePattern = buildSyslogPattern(false);
        const baseMatch = parseGrokPattern(line, basePattern);
        
        if (baseMatch && baseMatch.timestamp && baseMatch.hostname && 
            baseMatch.program && baseMatch.message) {
            return {
                timestamp: parseTimestamp(baseMatch.timestamp),
                hostname: baseMatch.hostname,
                tag: baseMatch.program,
                message: baseMatch.message.trim(),
                level: this.extractLevelFromMessage(baseMatch.message),
                pid: baseMatch.pid ? parseInt(baseMatch.pid, 10) : undefined
            };
        }
        
        // Try pattern with optional hostname: timestamp [hostname] tag[pid]: message
        // Some logs may have hostname in brackets or missing
        if (baseMatch && baseMatch.timestamp && baseMatch.program && baseMatch.message) {
            return {
                timestamp: parseTimestamp(baseMatch.timestamp),
                hostname: baseMatch.hostname || undefined, // Optional hostname
                tag: baseMatch.program,
                message: baseMatch.message.trim(),
                level: this.extractLevelFromMessage(baseMatch.message),
                pid: baseMatch.pid ? parseInt(baseMatch.pid, 10) : undefined
            };
        }
        
        // Try pattern without hostname (optional hostname): timestamp tag[pid]: message
        // Some logs may not have hostname
        if (baseMatch && baseMatch.timestamp && baseMatch.program && baseMatch.message) {
            return {
                timestamp: parseTimestamp(baseMatch.timestamp),
                hostname: baseMatch.hostname || undefined, // Optional hostname
                tag: baseMatch.program,
                message: baseMatch.message.trim(),
                level: this.extractLevelFromMessage(baseMatch.message),
                pid: baseMatch.pid ? parseInt(baseMatch.pid, 10) : undefined
            };
        }

        // Fallback: try simpler regex patterns for compatibility
        const syslogRegex = /^<(\d+)>(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(\S+):\s*(.*)$/;
        const match = line.match(syslogRegex);

        if (match) {
            const [, priority, timestamp, hostname, tag, message] = match;
            const level = this.getLevelFromPriority(parseInt(priority, 10));

            return {
                timestamp: parseTimestamp(timestamp),
                level,
                hostname,
                tag,
                message: message.trim(),
                priority: parseInt(priority, 10)
            };
        }

        // Try simpler format: timestamp hostname tag: message
        const simpleRegex = /^(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(\S+):\s*(.*)$/;
        const simpleMatch = line.match(simpleRegex);

        if (simpleMatch) {
            const [, timestamp, hostname, tag, message] = simpleMatch;

            return {
                timestamp: parseTimestamp(timestamp),
                hostname,
                tag,
                message: message.trim(),
                level: 'info'
            };
        }
        
        // Try format without hostname: timestamp tag: message
        // Some logs may not have hostname field (e.g., cron.log custom format)
        const noHostnameRegex = /^(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+):\s*(.*)$/;
        const noHostnameMatch = line.match(noHostnameRegex);
        
        if (noHostnameMatch) {
            const [, timestamp, tag, message] = noHostnameMatch;
            
            return {
                timestamp: parseTimestamp(timestamp),
                hostname: undefined, // No hostname in this format
                tag,
                message: message.trim(),
                level: 'info'
            };
        }

        // Try custom format: [YYYY-MM-DD HH:MM:SS] [level] message
        // Example: [2025-09-16 04:45:22] [info] Unified version check completed successfully
        const customFormatRegex = /^\[(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\]\s+\[(\w+)\]\s+(.*)$/;
        const customMatch = line.match(customFormatRegex);
        
        if (customMatch) {
            const [, datePart, timePart, level, message] = customMatch;
            const timestampStr = `${datePart}T${timePart}`;
            const timestamp = parseTimestamp(timestampStr);
            
            return {
                timestamp,
                level: level.toLowerCase(),
                message: message.trim()
            };
        }

        // Try format with ISO timestamp at start: 2025-09-16T04:45:22 message
        const isoStartRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s+(.*)$/;
        const isoStartMatch = line.match(isoStartRegex);
        
        if (isoStartMatch) {
            const [, timestampStr, message] = isoStartMatch;
            const timestamp = parseTimestamp(timestampStr);
            
            return {
                timestamp,
                message: message.trim(),
                level: this.extractLevelFromMessage(message)
            };
        }

        // Fallback: return as-is
        return {
            message: line.trim(),
            level: 'info'
        };
    }

    /**
     * Parse journald format (via journalctl output)
     * Format: timestamp hostname tag[pid]: message
     * Uses Grok patterns for robust parsing
     */
    static parseJournaldLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Journald format: timestamp hostname tag[pid]: message
        // Use base syslog pattern which supports PID
        const basePattern = buildSyslogPattern(false);
        const match = parseGrokPattern(line, basePattern);

        if (match && match.timestamp && match.hostname && match.program && match.message) {
            return {
                timestamp: parseTimestamp(match.timestamp),
                hostname: match.hostname,
                tag: match.program,
                pid: match.pid ? parseInt(match.pid, 10) : undefined,
                message: match.message.trim(),
                level: this.extractLevelFromMessage(match.message)
            };
        }

        // Fallback: try simpler regex pattern
        const journaldRegex = /^(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(\S+)\[(\d+)\]:\s*(.*)$/;
        const regexMatch = line.match(journaldRegex);

        if (regexMatch) {
            const [, timestamp, hostname, tag, pid, message] = regexMatch;

            return {
                timestamp: parseTimestamp(timestamp),
                hostname,
                tag,
                pid: parseInt(pid, 10),
                message: message.trim(),
                level: this.extractLevelFromMessage(message)
            };
        }

        // Fallback to syslog parser
        return this.parseSyslogLine(line);
    }

    /**
     * Get log level from syslog priority
     */
    private static getLevelFromPriority(priority: number): string {
        const severity = priority % 8;
        
        if (severity <= 2) return 'error';      // Emergency, Alert, Critical
        if (severity === 3) return 'warning';   // Error
        if (severity === 4) return 'warning';   // Warning
        if (severity <= 6) return 'info';       // Notice, Informational, Debug
        
        return 'info';
    }

    /**
     * Extract level from message content
     */
    private static extractLevelFromMessage(message: string): string {
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('error') || lowerMessage.includes('err')) {
            return 'error';
        }
        if (lowerMessage.includes('warn') || lowerMessage.includes('warning')) {
            return 'warning';
        }
        if (lowerMessage.includes('debug')) {
            return 'debug';
        }
        
        return 'info';
    }
}
