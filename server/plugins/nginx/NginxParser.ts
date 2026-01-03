/**
 * Nginx Parser
 * 
 * Parser for Nginx access and error logs
 * Supports: combined, common, main, extended (with upstream)
 * Uses exact regex patterns from NGINX_PARSER_HELP.md
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';

export class NginxParser {
    /**
     * Parse Nginx access log line with automatic format detection
     * Supports: combined, common, main, extended (with upstream)
     * Format detection order: extended > combined > common
     */
    static parseAccessLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Debug: log first few characters to help diagnose
        if (process.env.DEBUG_PARSER === 'true') {
            console.log('[NginxParser] Parsing line:', line.substring(0, 100));
        }

        // Try formats in order of specificity (most specific first)

        // 1. Format with upstream (extended)
        // IP - user [timestamp] "request" status bytes "referer" "user-agent" "upstream"
        // Regex exacte: ^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d{3})\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"\s+"([^"]*)"
        const extendedRegex = /^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d{3})\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"\s+"([^"]*)"/;
        const extendedMatch = line.match(extendedRegex);
        if (extendedMatch) {
            const [, ip, user, timestamp, request, status, bytes, referer, userAgent, upstream] = extendedMatch;
            
            // Parse request: "METHOD URI PROTOCOL"
            const requestParts = this.parseRequest(request);
            
            return {
                timestamp: this.parseTimestamp(timestamp),
                ip,
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: parseInt(status, 10),
                size: parseInt(bytes, 10),
                referer: referer || '-',
                userAgent: userAgent || '-',
                upstream: upstream || '-',
                level: this.getLevelFromStatus(parseInt(status, 10))
            };
        }

        // 2. Format combined (standard)
        // IP - user [timestamp] "request" status bytes "referer" "user-agent"
        // Regex exacte: ^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d{3})\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"
        const combinedRegex = /^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d{3})\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/;
        const combinedMatch = line.match(combinedRegex);
        if (combinedMatch) {
            const [, ip, user, timestamp, request, status, bytes, referer, userAgent] = combinedMatch;
            
            // Parse request: "METHOD URI PROTOCOL"
            const requestParts = this.parseRequest(request);

            return {
                timestamp: this.parseTimestamp(timestamp),
                ip,
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: parseInt(status, 10),
                size: parseInt(bytes, 10),
                referer: referer || '-',
                userAgent: userAgent || '-',
                upstream: '-',
                level: this.getLevelFromStatus(parseInt(status, 10))
            };
        }

        // 3. Format common (simpler, without referer and user-agent)
        // IP - user [timestamp] "request" status bytes
        // Regex exacte: ^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d{3})\s+(\d+)
        const commonRegex = /^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d{3})\s+(\d+)/;
        const commonMatch = line.match(commonRegex);
        if (commonMatch) {
            const [, ip, user, timestamp, request, status, bytes] = commonMatch;
            
            // Parse request: "METHOD URI PROTOCOL"
            const requestParts = this.parseRequest(request);

            return {
                timestamp: this.parseTimestamp(timestamp),
                ip,
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: parseInt(status, 10),
                size: parseInt(bytes, 10),
                referer: '-',
                userAgent: '-',
                upstream: '-',
                level: this.getLevelFromStatus(parseInt(status, 10))
            };
        }

        return null;
    }

    /**
     * Parse HTTP request string into method, url, and protocol
     * Format: "METHOD URI PROTOCOL"
     * Example: "GET /api/test HTTP/1.1" or "GET /api/test?param=value HTTP/1.1"
     * URL may contain spaces if URL-encoded, so we need to be careful
     */
    private static parseRequest(request: string): { method: string; url: string; protocol: string } {
        // Try standard format: "METHOD URI PROTOCOL"
        // URI can contain spaces if URL-encoded, so we match everything between method and protocol
        const requestMatch = request.match(/^(\S+)\s+(.+?)\s+(\S+)$/);
        if (requestMatch) {
            return {
                method: requestMatch[1],
                url: requestMatch[2],
                protocol: requestMatch[3]
            };
        }
        
        // Fallback: try to extract at least method and url (protocol might be missing)
        const fallbackMatch = request.match(/^(\S+)\s+(.+)$/);
        if (fallbackMatch) {
            // Try to extract protocol from the end if present
            const urlAndProtocol = fallbackMatch[2];
            const protocolMatch = urlAndProtocol.match(/\s+(HTTP\/[\d.]+)$/);
            if (protocolMatch) {
                return {
                    method: fallbackMatch[1],
                    url: urlAndProtocol.substring(0, urlAndProtocol.length - protocolMatch[0].length).trim(),
                    protocol: protocolMatch[1]
                };
            }
            return {
                method: fallbackMatch[1],
                url: urlAndProtocol,
                protocol: 'HTTP/1.1'
            };
        }
        
        // Last resort
        return {
            method: 'UNKNOWN',
            url: request,
            protocol: 'HTTP/1.1'
        };
    }

    /**
     * Parse Nginx error log line
     * Format: timestamp [level] message or timestamp [level] pid#tid: message
     */
    static parseErrorLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Try format with PID/TID first: timestamp [level] pid#tid: message
        const pidRegex = /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(\d+)#(\d+):\s+(.+)$/;
        const pidMatch = line.match(pidRegex);
        if (pidMatch) {
            const [, timestamp, level, pid, tid, message] = pidMatch;

            return {
                timestamp: this.parseTimestamp(timestamp),
                level: level.toLowerCase(),
                pid: parseInt(pid, 10),
                tid: parseInt(tid, 10),
                message: message.trim()
            };
        }

        // Try standard format: timestamp [level] message
        const errorRegex = /^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(.+)$/;
        const match = line.match(errorRegex);
        if (match) {
            const [, timestamp, level, message] = match;

            return {
                timestamp: this.parseTimestamp(timestamp),
                level: level.toLowerCase(),
                message: message.trim()
            };
        }

        return null;
    }

    /**
     * Parse timestamp string to Date with timezone support
     * Format: "01/Jan/2024:12:00:00 +0000" or "2024/01/01 12:00:00"
     */
    private static parseTimestamp(timestamp: string): Date {
        // Try Nginx access log format: "01/Jan/2024:12:00:00 +0000" (with timezone)
        const accessMatch = timestamp.match(/(\d{2})\/(\w+)\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})/);
        if (accessMatch) {
            const [, day, month, year, hour, minute, second, timezone] = accessMatch;
            const monthMap: Record<string, number> = {
                'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
            };
            
            // Parse timezone offset (e.g., +0000, -0500)
            const tzSign = timezone[0] === '+' ? 1 : -1;
            const tzHours = parseInt(timezone.slice(1, 3), 10);
            const tzMinutes = parseInt(timezone.slice(3, 5), 10);
            const tzOffsetMinutes = tzSign * (tzHours * 60 + tzMinutes);
            
            // Create date in UTC, then adjust for timezone
            const date = new Date(Date.UTC(
                parseInt(year, 10),
                monthMap[month] ?? 0,
                parseInt(day, 10),
                parseInt(hour, 10),
                parseInt(minute, 10),
                parseInt(second, 10)
            ));
            
            // Adjust for timezone offset (subtract offset to get local time)
            date.setUTCMinutes(date.getUTCMinutes() - tzOffsetMinutes);
            
            return date;
        }

        // Try access log format without timezone: "01/Jan/2024:12:00:00"
        const accessMatchNoTz = timestamp.match(/(\d{2})\/(\w+)\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
        if (accessMatchNoTz) {
            const [, day, month, year, hour, minute, second] = accessMatchNoTz;
            const monthMap: Record<string, number> = {
                'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
                'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
            };
            
            return new Date(
                parseInt(year, 10),
                monthMap[month] ?? 0,
                parseInt(day, 10),
                parseInt(hour, 10),
                parseInt(minute, 10),
                parseInt(second, 10)
            );
        }

        // Try Nginx error log format: "2024/01/01 12:00:00"
        const errorMatch = timestamp.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (errorMatch) {
            const [, year, month, day, hour, minute, second] = errorMatch;
            
            return new Date(
                parseInt(year, 10),
                parseInt(month, 10) - 1,
                parseInt(day, 10),
                parseInt(hour, 10),
                parseInt(minute, 10),
                parseInt(second, 10)
            );
        }

        // Fallback to current date
        return new Date();
    }

    /**
     * Parse size string to number
     * Handles "-" for no size
     */
    private static parseSize(size: string): number {
        if (size === '-' || !size) {
            return 0;
        }
        return parseInt(size, 10) || 0;
    }

    /**
     * Get log level from HTTP status code
     */
    private static getLevelFromStatus(status: number): string {
        if (status >= 500) return 'error';
        if (status >= 400) return 'warning';
        if (status >= 300) return 'info';
        return 'info';
    }
}
