/**
 * Apache Parser
 * 
 * Parser for Apache access and error logs
 * Supports: VHost formats, IPv6, improved timezone parsing
 * Uses exact regex patterns matching Apache log formats
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';

// IPv4 or IPv6 pattern (supports both)
const IP_PATTERN = '(?:[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}|[0-9a-fA-F:]+(?:::[0-9a-fA-F:]*)?)';

/**
 * Default regex patterns for Apache logs
 * These are used as fallback when no custom regex is configured
 */
export const APACHE_DEFAULT_REGEX = {
    // Access log formats (in order of specificity)
    access: {
        // VHost Combined: vhost:port IP - user [timestamp] "request" status size "referer" "user-agent"
        vhostCombined: `^([^:]+):(\\d+)\\s+${IP_PATTERN}\\s+-\\s+(\\S+)\\s+\\[([^\\]]+)\\]\\s+"([^"]+)"\\s+(\\d{3})\\s+(\\d+)\\s+"([^"]*)"\\s+"([^"]*)"`,
        // VHost Common: vhost:port IP - user [timestamp] "request" status size
        vhostCommon: `^([^:]+):(\\d+)\\s+${IP_PATTERN}\\s+-\\s+(\\S+)\\s+\\[([^\\]]+)\\]\\s+"([^"]+)"\\s+(\\d{3})\\s+(\\d+)`,
        // VHost Simple: vhost IP - user [timestamp] "request" status size
        vhostSimple: `^([^\\s]+)\\s+${IP_PATTERN}\\s+-\\s+(\\S+)\\s+\\[([^\\]]+)\\]\\s+"([^"]+)"\\s+(\\d{3})\\s+(\\d+)`,
        // Apache Combined Log Format (standard)
        combined: `^${IP_PATTERN}\\s+-\\s+(\\S+)\\s+\\[([^\\]]+)\\]\\s+"([^"]+)"\\s+(\\d{3})\\s+(\\d+)\\s+"([^"]*)"\\s+"([^"]*)"`,
        // Apache Common Log Format (standard) - most common fallback
        common: `^${IP_PATTERN}\\s+-\\s+(\\S+)\\s+\\[([^\\]]+)\\]\\s+"([^"]+)"\\s+(\\d{3})\\s+(\\d+)`
    },
    // Error log formats
    error: {
        // Standard format: [timestamp] [level] [module] message
        standard: '^\\[([^\\]]+)\\]\\s+\\[(\\w+)\\]\\s+(?:\\[([^\\]]+)\\]\\s+)?(.+)$',
        // Format with module:level: [timestamp] [module:level] [pid pid:tid tid] [client IP:port] message
        // Also handles: [timestamp] [module:level] message (without pid/tid/client)
        withModuleLevel: '^\\[([^\\]]+)\\]\\s+\\[([^:]+):(\\w+)\\]\\s+(?:\\[pid\\s+(\\d+)(?::tid\\s+(\\d+))?\\]\\s+)?(?:\\[client\\s+([^\\]]+)\\]\\s+)?(.+)$',
        // Format with client IP: [timestamp] [level] [client IP:port] message
        withClient: '^\\[([^\\]]+)\\]\\s+\\[(\\w+)\\]\\s+\\[client\\s+([^\\]]+)\\]\\s+(.+)$',
        // Format with pid/tid: [timestamp] [level] [pid pid:tid tid] message
        withPid: '^\\[([^\\]]+)\\]\\s+\\[(\\w+)\\]\\s+\\[pid\\s+(\\d+):tid\\s+(\\d+)\\]\\s+(?:\\[([^\\]]+)\\]\\s+)?(.+)$'
    }
};

/**
 * Get default regex pattern for Apache logs
 * Returns the most common format as default (common for access, standard for error)
 */
export function getApacheDefaultRegex(logType: 'access' | 'error'): string {
    if (logType === 'access') {
        // Return combined format as default (most complete)
        return APACHE_DEFAULT_REGEX.access.combined;
    } else {
        // Return standard error format
        return APACHE_DEFAULT_REGEX.error.standard;
    }
}

export class ApacheParser {
    /**
     * Parse Apache access log line with automatic format detection
     * Supports: VHost Combined, VHost Common, VHost Simple, Combined, Common
     * Format detection order: VHost Combined > VHost Common > VHost Simple > Combined > Common
     * Also supports IPv6 and improved timezone parsing
     */
    static parseAccessLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Debug: log first few characters to help diagnose
        if (process.env.DEBUG_PARSER === 'true') {
            console.log('[ApacheParser] Parsing line:', line.substring(0, 100));
        }

        // Try formats in order of specificity (most specific first)
        
        // 0. Custom format: [timestamp] client_ip forwarded_for user_id user vhost "request" status size "referer" "user-agent"
        // Example: [03/Jan/2026:00:00:04 +0100] 82.66.14.92 82.66.14.92 - - l.myoueb.fr "GET /2/server.json HTTP/1.1" 404 357 "-" "curl/7.88.1"
        // This format has timestamp first, then two IPs (client and forwarded), then user_id, user, vhost
        const customFormatRegex = new RegExp(
            `^\\[([^\\]]+)\\]\\s+` + // [timestamp]
            `${IP_PATTERN}\\s+` + // client_ip
            `${IP_PATTERN}\\s+` + // forwarded_for
            `([^\\s]+)\\s+` + // user_id (can be "-")
            `([^\\s]+)\\s+` + // user (can be "-" or username)
            `([^\\s]+)\\s+` + // vhost
            `"([^"]+)"\\s+` + // request
            `(\\d{3})\\s+` + // status
            `(\\d+)\\s+` + // size
            `"([^"]*)"\\s+` + // referer
            `"([^"]*)"` // user-agent
        );
        const customFormatMatch = line.match(customFormatRegex);
        if (customFormatMatch) {
            const [, timestamp, clientIp, forwardedFor, userId, user, vhost, request, status, size, referer, userAgent] = customFormatMatch;
            
            // Parse request: "METHOD URI PROTOCOL"
            const requestParts = this.parseRequest(request);
            
            return {
                timestamp: this.parseTimestamp(timestamp),
                ip: clientIp,
                vhost: vhost !== '-' ? vhost : undefined,
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: parseInt(status, 10),
                size: parseInt(size, 10),
                referer: referer && referer !== '-' ? referer : undefined,
                userAgent: userAgent && userAgent !== '-' ? userAgent : undefined,
                level: this.getLevelFromStatus(parseInt(status, 10)),
                message: line
            };
        }
        
        // 1. VHost Combined: vhost:port IP - user [timestamp] "request" status size "referer" "user-agent"
        // Example: example.com:443 192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0"
        const vhostCombinedRegex = new RegExp(APACHE_DEFAULT_REGEX.access.vhostCombined);
        const vhostCombinedMatch = line.match(vhostCombinedRegex);
        if (vhostCombinedMatch) {
            const [, vhost, port, ip, user, timestamp, request, status, size, referer, userAgent] = vhostCombinedMatch;
            
            // Parse request: "METHOD URI PROTOCOL"
            const requestParts = this.parseRequest(request);
            
            return {
                timestamp: this.parseTimestamp(timestamp),
                ip,
                vhost,
                port: parseInt(port, 10),
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: parseInt(status, 10),
                size: parseInt(size, 10),
                referer: referer || '-',
                userAgent: userAgent || '-',
                level: this.getLevelFromStatus(parseInt(status, 10)),
                message: line
            };
        }

        // 2. VHost Common: vhost:port IP - user [timestamp] "request" status size
        // Example: example.com:80 192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234
        const vhostCommonRegex = new RegExp(APACHE_DEFAULT_REGEX.access.vhostCommon);
        const vhostCommonMatch = line.match(vhostCommonRegex);
        if (vhostCommonMatch) {
            const [, vhost, port, ip, user, timestamp, request, status, size] = vhostCommonMatch;
            
            // Parse request: "METHOD URI PROTOCOL"
            const requestParts = this.parseRequest(request);
            
            return {
                timestamp: this.parseTimestamp(timestamp),
                ip,
                vhost,
                port: parseInt(port, 10),
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: parseInt(status, 10),
                size: parseInt(size, 10),
                referer: '-',
                userAgent: '-',
                level: this.getLevelFromStatus(parseInt(status, 10)),
                message: line
            };
        }

        // 3. VHost Simple: vhost IP - user [timestamp] "request" status size
        // Example: example.com 192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234
        const vhostSimpleRegex = new RegExp(APACHE_DEFAULT_REGEX.access.vhostSimple);
        const vhostSimpleMatch = line.match(vhostSimpleRegex);
        if (vhostSimpleMatch) {
            const [, vhost, ip, user, timestamp, request, status, size] = vhostSimpleMatch;
            // Check if vhost doesn't look like an IP (to avoid false positives)
            if (!/^\d+\.\d+\.\d+\.\d+$/.test(vhost) && !vhost.includes(':')) {
                // Parse request: "METHOD URI PROTOCOL"
                const requestParts = this.parseRequest(request);
                
                return {
                    timestamp: this.parseTimestamp(timestamp),
                    ip,
                    vhost,
                    method: requestParts.method,
                    url: requestParts.url,
                    protocol: requestParts.protocol,
                    status: parseInt(status, 10),
                    size: parseInt(size, 10),
                    referer: '-',
                    userAgent: '-',
                    level: this.getLevelFromStatus(parseInt(status, 10)),
                    message: line
                };
            }
        }

        // 4. Apache Combined Log Format (standard)
        // IP - user [timestamp] "request" status size "referer" "user-agent"
        const combinedRegex = new RegExp(APACHE_DEFAULT_REGEX.access.combined);
        const combinedMatch = line.match(combinedRegex);
        if (combinedMatch) {
            const [, ip, user, timestamp, request, status, size, referer, userAgent] = combinedMatch;
            
            // Parse request: "METHOD URI PROTOCOL"
            const requestParts = this.parseRequest(request);
            
            return {
                timestamp: this.parseTimestamp(timestamp),
                ip,
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: parseInt(status, 10),
                size: parseInt(size, 10),
                referer: referer || '-',
                userAgent: userAgent || '-',
                level: this.getLevelFromStatus(parseInt(status, 10)),
                message: line
            };
        }

        // 5. Apache Common Log Format (standard)
        // IP - user [timestamp] "request" status size
        const commonRegex = new RegExp(APACHE_DEFAULT_REGEX.access.common);
        const commonMatch = line.match(commonRegex);
        if (commonMatch) {
            const [, ip, user, timestamp, request, status, size] = commonMatch;
            
            // Parse request: "METHOD URI PROTOCOL"
            const requestParts = this.parseRequest(request);
            
            return {
                timestamp: this.parseTimestamp(timestamp),
                ip,
                method: requestParts.method,
                url: requestParts.url,
                protocol: requestParts.protocol,
                status: parseInt(status, 10),
                size: parseInt(size, 10),
                referer: '-',
                userAgent: '-',
                level: this.getLevelFromStatus(parseInt(status, 10)),
                message: line
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
     * Parse Apache error log line
     * Supports multiple formats:
     * - [timestamp] [module:level] [pid pid:tid tid] [client IP:port] message
     * - [timestamp] [level] [client IP] message
     * - [timestamp] [level] [module] message
     * - [timestamp] [level] [pid pid:tid tid] message
     * Example: [Fri Jan 02 14:52:58.123456 2026] [authz_core:error] [pid 12345:tid 123456] [client 192.168.1.1:12345] message
     */
    static parseErrorLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        // Debug: log first few characters to help diagnose
        if (process.env.DEBUG_PARSER === 'true') {
            console.log('[ApacheParser] Parsing error line:', line.substring(0, 100));
        }

        // Try format with module:level first (most common modern format)
        // Format: [timestamp] [module:level] [pid pid:tid tid] [client IP:port] message
        // Example: [Fri Jan 02 14:52:58.123456 2026] [authz_core:error] [pid 12345:tid 123456] [client 192.168.1.1:12345] AH01630: message
        const moduleLevelRegex = new RegExp(APACHE_DEFAULT_REGEX.error.withModuleLevel);
        const moduleLevelMatch = line.match(moduleLevelRegex);

        if (moduleLevelMatch) {
            const [, timestamp, module, level, pid, tid, clientIp, message] = moduleLevelMatch;

            const result: ParsedLogEntry = {
                timestamp: this.parseTimestamp(timestamp),
                level: level.toLowerCase(),
                module: module || '',
                message: message.trim()
            };

            if (pid) {
                (result as any).pid = parseInt(pid, 10);
            }
            if (tid) {
                (result as any).tid = parseInt(tid, 10);
            }
            if (clientIp) {
                // Extract IP and port from "IP:port" format
                const clientMatch = clientIp.match(/^([^:]+)(?::(\d+))?$/);
                if (clientMatch) {
                    result.clientIp = clientMatch[1];
                    if (clientMatch[2]) {
                        (result as any).clientPort = parseInt(clientMatch[2], 10);
                    }
                } else {
                    result.clientIp = clientIp;
                }
            }

            return result;
        }

        // Try format with client IP: [timestamp] [level] [client IP:port] message
        const clientRegex = new RegExp(APACHE_DEFAULT_REGEX.error.withClient);
        const clientMatch = line.match(clientRegex);

        if (clientMatch) {
            const [, timestamp, level, clientInfo, message] = clientMatch;

            const result: ParsedLogEntry = {
                timestamp: this.parseTimestamp(timestamp),
                level: level.toLowerCase(),
                message: message.trim()
            };

            // Extract IP and port from "IP:port" format
            const clientMatch2 = clientInfo.match(/^([^:]+)(?::(\d+))?$/);
            if (clientMatch2) {
                result.clientIp = clientMatch2[1];
                if (clientMatch2[2]) {
                    (result as any).clientPort = parseInt(clientMatch2[2], 10);
                }
            } else {
                result.clientIp = clientInfo;
            }

            return result;
        }

        // Try format with pid/tid: [timestamp] [level] [pid pid:tid tid] [module] message
        const pidRegex = new RegExp(APACHE_DEFAULT_REGEX.error.withPid);
        const pidMatch = line.match(pidRegex);

        if (pidMatch) {
            const [, timestamp, level, pid, tid, module, message] = pidMatch;

            const result: ParsedLogEntry = {
                timestamp: this.parseTimestamp(timestamp),
                level: level.toLowerCase(),
                module: module || '',
                message: message.trim()
            };

            if (pid) {
                (result as any).pid = parseInt(pid, 10);
            }
            if (tid) {
                (result as any).tid = parseInt(tid, 10);
            }

            return result;
        }

        // Try standard format: [timestamp] [level] [module] message
        const errorRegex = new RegExp(APACHE_DEFAULT_REGEX.error.standard);
        const match = line.match(errorRegex);

        if (match) {
            const [, timestamp, level, module, message] = match;

            return {
                timestamp: this.parseTimestamp(timestamp),
                level: level.toLowerCase(),
                module: module || '',
                message: message.trim()
            };
        }

        // Last resort: try to extract at least timestamp and message
        // Format: [timestamp] ... message
        const fallbackRegex = /^\[([^\]]+)\]\s+(.+)$/;
        const fallbackMatch = line.match(fallbackRegex);

        if (fallbackMatch) {
            const [, timestamp, rest] = fallbackMatch;
            
            // Try to extract level and module from common patterns
            let level = 'info';
            let module = '';
            
            // Try format [module:level] first
            const moduleLevelMatch = rest.match(/\[([^:]+):(\w+)\]/);
            if (moduleLevelMatch) {
                module = moduleLevelMatch[1];
                const levelStr = moduleLevelMatch[2].toLowerCase();
                if (['error', 'warn', 'warning', 'crit', 'critical', 'alert', 'emerg', 'emergency'].includes(levelStr)) {
                    level = 'error';
                } else if (['notice', 'info'].includes(levelStr)) {
                    level = 'info';
                } else if (['debug'].includes(levelStr)) {
                    level = 'debug';
                } else {
                    level = levelStr;
                }
            } else {
                // Try format [level] only
                const levelMatch = rest.match(/\[(\w+)\]/);
                if (levelMatch) {
                    const levelStr = levelMatch[1].toLowerCase();
                    if (['error', 'warn', 'warning', 'crit', 'critical', 'alert', 'emerg', 'emergency'].includes(levelStr)) {
                        level = 'error';
                    } else if (['notice', 'info'].includes(levelStr)) {
                        level = 'info';
                    } else if (['debug'].includes(levelStr)) {
                        level = 'debug';
                    } else {
                        level = levelStr;
                    }
                }
            }
            
            // Try to extract client IP
            let clientIp: string | undefined;
            const clientMatch = rest.match(/\[client\s+([^\]]+)\]/);
            if (clientMatch) {
                const clientInfo = clientMatch[1];
                const ipMatch = clientInfo.match(/^([^:]+)/);
                if (ipMatch) {
                    clientIp = ipMatch[1];
                }
            }

            const result: ParsedLogEntry = {
                timestamp: this.parseTimestamp(timestamp),
                level,
                message: rest.trim()
            };
            
            if (module) {
                result.module = module;
            }
            if (clientIp) {
                result.clientIp = clientIp;
            }

            return result;
        }

        return null;
    }

    /**
     * Parse timestamp string to Date with timezone support
     * Format: "01/Jan/2024:12:00:00 +0000" or "Mon Jan 01 12:00:00.123456 2024"
     */
    private static parseTimestamp(timestamp: string): Date {
        // Try Apache access log format: "01/Jan/2024:12:00:00 +0000" (with timezone)
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

        // Try Apache access log format without timezone: "01/Jan/2024:12:00:00"
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

        // Try Apache error log format: "Mon Jan 01 12:00:00.123456 2024"
        const errorMatch = timestamp.match(/(\w+)\s+(\w+)\s+(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s+(\d{4})/);
        if (errorMatch) {
            const [, , month, day, hour, minute, second, year] = errorMatch;
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

        // Fallback to current date
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
