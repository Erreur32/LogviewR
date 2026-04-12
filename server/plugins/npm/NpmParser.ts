/**
 * Nginx Proxy Manager (NPM) Parser
 *
 * Parser for NPM access logs with multiple format support
 * Supports: NPM standard (with cache), NPM standard (without cache), Custom combined, Nginx standard
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import { parseAccessLogTimestamp, parseHttpRequest, parseSize, getLevelFromStatus, parseNginxErrorLine } from '../base/ParserUtils.js';

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
        const npmWithCacheRegex = /^\[([^\]]+)\]\s+(\S+)\s+(\S+)\s+(\d+)\s+-\s+(\S+)\s+(\S+)\s+(\S+)\s+"([^"]+)"\s+\[Client\s+([\d\.]+)\]\s+\[Length\s+(\d+)\]\s+\[Gzip\s+([^\]]+)\]\s+\[Sent-to\s+([^\]]+)\]\s+"([^"]*)"\s+"([^"]*)"/;
        const npmWithCacheMatch = line.match(npmWithCacheRegex);
        if (npmWithCacheMatch) {
            const [, time, cache, upstreamStatus, status, method, scheme, host, uri, ip, bytes, gzip, server, ua, ref] = npmWithCacheMatch;
            const statusNum = Number.parseInt(status, 10);

            return {
                message: line,
                timestamp: parseAccessLogTimestamp(time) ?? new Date(),
                ip,
                method,
                url: uri,
                protocol: scheme,
                host,
                status: statusNum,
                size: Number.parseInt(bytes, 10),
                referer: ref || '-',
                userAgent: ua || '-',
                cache: cache,
                upstreamStatus: upstreamStatus,
                gzip: gzip,
                upstream: server,
                level: getLevelFromStatus(statusNum)
            };
        }

        // 2. NPM standard format without cache
        const npmStandardRegex = /^\[([^\]]+)\]\s+(\d+)\s+-\s+(\S+)\s+(\S+)\s+(\S+)\s+"([^"]+)"\s+\[Client\s+([\d\.]+)\]\s+\[Length\s+(\d+)\]\s+\[Gzip\s+([^\]]+)\]\s+"([^"]*)"\s+"([^"]*)"/;
        const npmStandardMatch = line.match(npmStandardRegex);
        if (npmStandardMatch) {
            const [, time, status, method, scheme, host, uri, ip, bytes, gzip, ua, ref] = npmStandardMatch;
            const statusNum = Number.parseInt(status, 10);

            return {
                message: line,
                timestamp: parseAccessLogTimestamp(time) ?? new Date(),
                ip,
                method,
                url: uri,
                protocol: scheme,
                host,
                status: statusNum,
                size: Number.parseInt(bytes, 10),
                referer: ref || '-',
                userAgent: ua || '-',
                gzip: gzip,
                level: getLevelFromStatus(statusNum)
            };
        }

        // 3. Custom combined format
        // IP - host [time] "request" status bytes "Referer" "UA"
        const customCombinedRegex = /^([\d\.]+)\s+-\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"/;
        const customCombinedMatch = line.match(customCombinedRegex);
        if (customCombinedMatch) {
            const [, ip, host, time, request, status, bytes, ref, ua] = customCombinedMatch;
            const requestMatch = request.match(/^(\S+)\s+(\S+)\s+(\S+)$/);
            const method = requestMatch ? requestMatch[1] : 'UNKNOWN';
            const url = requestMatch ? requestMatch[2] : request;
            const protocol = requestMatch ? requestMatch[3] : 'HTTP/1.1';
            const statusNum = Number.parseInt(status, 10);

            return {
                message: line,
                timestamp: parseAccessLogTimestamp(time) ?? new Date(),
                ip,
                method,
                url,
                protocol,
                host,
                status: statusNum,
                size: Number.parseInt(bytes, 10),
                referer: ref || '-',
                userAgent: ua || '-',
                level: getLevelFromStatus(statusNum)
            };
        }

        // 4. NPM extended Nginx format (existing format)
        // IP - - [timestamp] "request" status size "referer" "user-agent" "host" "upstream" "response-time"
        const npmExtendedRegex = /^(\S+)\s+-\s+-\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?/;
        const npmExtendedMatch = line.match(npmExtendedRegex);
        if (npmExtendedMatch) {
            const [, ip, timestamp, request, status, size, referer, userAgent, host, upstream, responseTime] = npmExtendedMatch;
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
                size: parseSize(size),
                referer: referer || '-',
                userAgent: userAgent || '-',
                host: host || '-',
                upstream: upstream || '-',
                responseTime: responseTime ? Number.parseFloat(responseTime) : undefined,
                level: getLevelFromStatus(statusNum)
            };
        }

        // 5. Standard Nginx format (fallback)
        // IP - - [timestamp] "request" status size "referer" "user-agent"
        const nginxRegex = /^(\S+)\s+-\s+-\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"/;
        const nginxMatch = line.match(nginxRegex);
        if (nginxMatch) {
            const [, ip, timestamp, request, status, size, referer, userAgent] = nginxMatch;
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
                size: parseSize(size),
                referer: referer || '-',
                userAgent: userAgent || '-',
                host: '-',
                upstream: '-',
                level: getLevelFromStatus(statusNum)
            };
        }

        return null;
    }

    /**
     * Parse NPM error log line (same format as Nginx error logs)
     */
    static parseErrorLine(line: string): ParsedLogEntry | null {
        const parsed = parseNginxErrorLine(line);
        if (!parsed) return null;
        return parsed;
    }
}
