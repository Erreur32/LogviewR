/**
 * Nginx Parser
 *
 * Parser for Nginx access and error logs
 * Supports: combined, common, main, extended (with upstream)
 * Uses exact regex patterns from NGINX_PARSER_HELP.md
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import { parseAccessLogTimestamp, parseHttpRequest, getLevelFromStatus, parseNginxErrorLine } from '../base/ParserUtils.js';

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
        const extendedRegex = /^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d{3})\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"\s+"([^"]*)"/;
        const extendedMatch = extendedRegex.exec(line);
        if (extendedMatch) {
            const [, ip, , timestamp, request, status, bytes, referer, userAgent, upstream] = extendedMatch;
            const requestParts = parseHttpRequest(request);
            const statusNum = Number.parseInt(status, 10);

            return {
                message: line,
                timestamp: parseAccessLogTimestamp(timestamp) ?? new Date(),
                ip,
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: statusNum,
                size: Number.parseInt(bytes, 10),
                referer: referer || '-',
                userAgent: userAgent || '-',
                upstream: upstream || '-',
                level: getLevelFromStatus(statusNum)
            };
        }

        // 2. Format combined (standard)
        // IP - user [timestamp] "request" status bytes "referer" "user-agent"
        const combinedRegex = /^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d{3})\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/;
        const combinedMatch = combinedRegex.exec(line);
        if (combinedMatch) {
            const [, ip, , timestamp, request, status, bytes, referer, userAgent] = combinedMatch;
            const requestParts = parseHttpRequest(request);
            const statusNum = Number.parseInt(status, 10);

            return {
                message: line,
                timestamp: parseAccessLogTimestamp(timestamp) ?? new Date(),
                ip,
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: statusNum,
                size: Number.parseInt(bytes, 10),
                referer: referer || '-',
                userAgent: userAgent || '-',
                upstream: '-',
                level: getLevelFromStatus(statusNum)
            };
        }

        // 3. Format common (simpler, without referer and user-agent)
        // IP - user [timestamp] "request" status bytes
        const commonRegex = /^(\S+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d{3})\s+(\d+)/;
        const commonMatch = commonRegex.exec(line);
        if (commonMatch) {
            const [, ip, , timestamp, request, status, bytes] = commonMatch;
            const requestParts = parseHttpRequest(request);
            const statusNum = Number.parseInt(status, 10);

            return {
                message: line,
                timestamp: parseAccessLogTimestamp(timestamp) ?? new Date(),
                ip,
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: statusNum,
                size: Number.parseInt(bytes, 10),
                referer: '-',
                userAgent: '-',
                upstream: '-',
                level: getLevelFromStatus(statusNum)
            };
        }

        return null;
    }

    /**
     * Parse Nginx error log line
     * Format: timestamp [level] message or timestamp [level] pid#tid: message
     */
    static parseErrorLine(line: string): ParsedLogEntry | null {
        const parsed = parseNginxErrorLine(line);
        if (!parsed) return null;
        return parsed;
    }
}
