/**
 * Nginx Proxy Manager (NPM) Parser
 * 
 * Parser for NPM access logs with multiple format support
 * Supports: NPM standard (with cache), NPM standard (without cache), Custom combined, Nginx standard
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';

export class NpmParser {
    /**
     * Parse NPM access log line with automatic format detection
     * Supports multiple NPM log formats:
     * 1. NPM standard with cache: [time] cache upstream status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] [Sent-to server] "UA" "Referer"
     * 2. NPM standard without cache: [time] status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] "UA" "Referer"
     * 3. Custom combined: IP - host [time] "request" status bytes "Referer" "UA"
     * 4. Nginx standard (fallback)
     */
    static parseAccessLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Try formats in order of specificity (most specific first)

        // 1. NPM standard format with cache and upstream
        // Format: [time] cache upstream status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] [Sent-to server] "UA" "Referer"
        // Example: [01/Jan/2024:12:00:00 +0000] HIT 200 200 - GET https example.com "/api/test" [Client 192.168.1.1] [Length 1234] [Gzip 75%] [Sent-to 10.0.0.1:8080] "Mozilla/5.0" "https://example.com"
        const npmWithCacheRegex = /^\[([^\]]+)\]\s+(\S+)\s+(\S+)\s+(\d+)\s+-\s+(\S+)\s+(\S+)\s+(\S+)\s+"([^"]+)"\s+\[Client\s+([\d\.]+)\]\s+\[Length\s+(\d+)\]\s+\[Gzip\s+([^\]]+)\]\s+\[Sent-to\s+([^\]]+)\]\s+"([^"]*)"\s+"([^"]*)"/;
        const npmWithCacheMatch = line.match(npmWithCacheRegex);
        if (npmWithCacheMatch) {
            const [, time, cache, upstreamStatus, status, method, scheme, host, uri, ip, bytes, gzip, server, ua, ref] = npmWithCacheMatch;
            
            // Parse request from method, scheme, host, uri
            const request = `${method} ${scheme}://${host}${uri}`;
            
            return {
                timestamp: this.parseTimestamp(time),
                ip,
                method,
                url: uri,
                protocol: scheme,
                host,
                status: parseInt(status, 10),
                size: parseInt(bytes, 10),
                referer: ref || '-',
                userAgent: ua || '-',
                cache: cache,
                upstreamStatus: upstreamStatus,
                gzip: gzip,
                upstream: server,
                level: this.getLevelFromStatus(parseInt(status, 10))
            };
        }

        // 2. NPM standard format without cache
        // Format: [time] status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] "UA" "Referer"
        // Example: [01/Jan/2024:12:00:00 +0000] 200 - GET https example.com "/api/test" [Client 192.168.1.1] [Length 1234] [Gzip 75%] "Mozilla/5.0" "https://example.com"
        const npmStandardRegex = /^\[([^\]]+)\]\s+(\d+)\s+-\s+(\S+)\s+(\S+)\s+(\S+)\s+"([^"]+)"\s+\[Client\s+([\d\.]+)\]\s+\[Length\s+(\d+)\]\s+\[Gzip\s+([^\]]+)\]\s+"([^"]*)"\s+"([^"]*)"/;
        const npmStandardMatch = line.match(npmStandardRegex);
        if (npmStandardMatch) {
            const [, time, status, method, scheme, host, uri, ip, bytes, gzip, ua, ref] = npmStandardMatch;
            
            return {
                timestamp: this.parseTimestamp(time),
                ip,
                method,
                url: uri,
                protocol: scheme,
                host,
                status: parseInt(status, 10),
                size: parseInt(bytes, 10),
                referer: ref || '-',
                userAgent: ua || '-',
                gzip: gzip,
                level: this.getLevelFromStatus(parseInt(status, 10))
            };
        }

        // 3. Custom combined format
        // Format: IP - host [time] "request" status bytes "Referer" "UA"
        // Example: 192.168.1.1 - example.com [01/Jan/2024:12:00:00 +0000] "GET /api/test HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0"
        const customCombinedRegex = /^([\d\.]+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/;
        const customCombinedMatch = line.match(customCombinedRegex);
        if (customCombinedMatch) {
            const [, ip, host, time, request, status, bytes, ref, ua] = customCombinedMatch;
            
            // Parse request: "METHOD URI PROTOCOL"
            const requestMatch = request.match(/^(\S+)\s+(\S+)\s+(\S+)$/);
            const method = requestMatch ? requestMatch[1] : 'UNKNOWN';
            const url = requestMatch ? requestMatch[2] : request;
            const protocol = requestMatch ? requestMatch[3] : 'HTTP/1.1';
            
            return {
                timestamp: this.parseTimestamp(time),
                ip,
                method,
                url,
                protocol,
                host,
                status: parseInt(status, 10),
                size: parseInt(bytes, 10),
                referer: ref || '-',
                userAgent: ua || '-',
                level: this.getLevelFromStatus(parseInt(status, 10))
            };
        }

        // 4. NPM extended Nginx format (existing format)
        // IP - - [timestamp] "request" status size "referer" "user-agent" "host" "upstream" "response-time"
        const npmExtendedRegex = /^(\S+)\s+-\s+-\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?/;
        const npmExtendedMatch = line.match(npmExtendedRegex);
        if (npmExtendedMatch) {
            const [, ip, timestamp, request, status, size, referer, userAgent, host, upstream, responseTime] = npmExtendedMatch;
            
            // Parse request: "METHOD URI PROTOCOL"
            const requestParts = this.parseRequest(request);

            return {
                timestamp: this.parseTimestamp(timestamp),
                ip,
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: parseInt(status, 10),
                size: this.parseSize(size),
                referer: referer || '-',
                userAgent: userAgent || '-',
                host: host || '-',
                upstream: upstream || '-',
                responseTime: responseTime ? parseFloat(responseTime) : undefined,
                level: this.getLevelFromStatus(parseInt(status, 10))
            };
        }

        // 5. Standard Nginx format (fallback)
        // IP - - [timestamp] "request" status size "referer" "user-agent"
        const nginxRegex = /^(\S+)\s+-\s+-\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"/;
        const nginxMatch = line.match(nginxRegex);
        if (nginxMatch) {
            const [, ip, timestamp, request, status, size, referer, userAgent] = nginxMatch;
            
            // Parse request: "METHOD URI PROTOCOL"
            const requestParts = this.parseRequest(request);

            return {
                timestamp: this.parseTimestamp(timestamp),
                ip,
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: parseInt(status, 10),
                size: this.parseSize(size),
                referer: referer || '-',
                userAgent: userAgent || '-',
                host: '-',
                upstream: '-',
                level: this.getLevelFromStatus(parseInt(status, 10))
            };
        }

        return null;
    }

    /**
     * Parse NPM error log line (same as Nginx)
     */
    static parseErrorLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // NPM error log format is same as Nginx
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
     * Parse HTTP request string into method, url, and protocol
     * Format: "METHOD URI PROTOCOL"
     * Example: "GET /api/test HTTP/1.1"
     */
    private static parseRequest(request: string): { method: string; url: string; protocol: string } {
        const requestMatch = request.match(/^(\S+)\s+(\S+)\s+(\S+)$/);
        if (requestMatch) {
            return {
                method: requestMatch[1],
                url: requestMatch[2],
                protocol: requestMatch[3]
            };
        }
        
        // Fallback: try to extract at least method and url
        const fallbackMatch = request.match(/^(\S+)\s+(.+)$/);
        if (fallbackMatch) {
            return {
                method: fallbackMatch[1],
                url: fallbackMatch[2],
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
     * Parse timestamp string to Date with timezone support
     * Format: "01/Jan/2024:12:00:00 +0000" or "2024/01/01 12:00:00"
     */
    private static parseTimestamp(timestamp: string): Date {
        // Try NPM access log format: "01/Jan/2024:12:00:00 +0000" (with timezone)
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

        // Try error log format: "2024/01/01 12:00:00"
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

        return new Date();
    }

    /**
     * Parse size string to number
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
