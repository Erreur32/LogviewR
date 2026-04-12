/**
 * Shared Parser Utilities
 *
 * Common helpers used by NginxParser, NpmParser, and ApacheParser
 * to eliminate cross-parser code duplication.
 */

/** Month abbreviation → zero-based index */
export const MONTH_MAP: Record<string, number> = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
};

/**
 * Parse access-log timestamp: "01/Jan/2024:12:00:00 +0000" or "01/Jan/2024:12:00:00"
 * Returns undefined when the string doesn't match either format.
 */
export function parseAccessLogTimestamp(timestamp: string): Date | undefined {
    // With timezone: "01/Jan/2024:12:00:00 +0000"
    const withTz = timestamp.match(/(\d{2})\/(\w+)\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})/);
    if (withTz) {
        const [, day, month, year, hour, minute, second, timezone] = withTz;
        const tzSign = timezone[0] === '+' ? 1 : -1;
        const tzHours = Number.parseInt(timezone.slice(1, 3), 10);
        const tzMinutes = Number.parseInt(timezone.slice(3, 5), 10);
        const tzOffsetMinutes = tzSign * (tzHours * 60 + tzMinutes);

        const date = new Date(Date.UTC(
            Number.parseInt(year, 10),
            MONTH_MAP[month] ?? 0,
            Number.parseInt(day, 10),
            Number.parseInt(hour, 10),
            Number.parseInt(minute, 10),
            Number.parseInt(second, 10)
        ));
        date.setUTCMinutes(date.getUTCMinutes() - tzOffsetMinutes);
        return date;
    }

    // Without timezone: "01/Jan/2024:12:00:00"
    const noTz = timestamp.match(/(\d{2})\/(\w+)\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
    if (noTz) {
        const [, day, month, year, hour, minute, second] = noTz;
        return new Date(
            Number.parseInt(year, 10),
            MONTH_MAP[month] ?? 0,
            Number.parseInt(day, 10),
            Number.parseInt(hour, 10),
            Number.parseInt(minute, 10),
            Number.parseInt(second, 10)
        );
    }

    return undefined;
}

/**
 * Parse Nginx/NPM error-log timestamp: "2024/01/01 12:00:00"
 * Returns undefined when the string doesn't match.
 */
export function parseSlashTimestamp(timestamp: string): Date | undefined {
    const m = timestamp.match(/(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!m) return undefined;
    const [, year, month, day, hour, minute, second] = m;
    return new Date(
        Number.parseInt(year, 10),
        Number.parseInt(month, 10) - 1,
        Number.parseInt(day, 10),
        Number.parseInt(hour, 10),
        Number.parseInt(minute, 10),
        Number.parseInt(second, 10)
    );
}

/**
 * Parse HTTP request string: "METHOD URI PROTOCOL"
 * Handles URIs containing spaces and missing protocol.
 */
export function parseHttpRequest(request: string): { method: string; url: string; protocol: string } {
    const parts = request.match(/^(\S+)\s+(.+?)\s+(\S+)$/);
    if (parts) {
        return { method: parts[1], url: parts[2], protocol: parts[3] };
    }

    const fallback = request.match(/^(\S+)\s+(.+)$/);
    if (fallback) {
        const urlAndProtocol = fallback[2];
        const proto = urlAndProtocol.match(/\s+(HTTP\/[\d.]+)$/);
        if (proto) {
            return {
                method: fallback[1],
                url: urlAndProtocol.substring(0, urlAndProtocol.length - proto[0].length).trim(),
                protocol: proto[1]
            };
        }
        return { method: fallback[1], url: urlAndProtocol, protocol: 'HTTP/1.1' };
    }

    return { method: 'UNKNOWN', url: request, protocol: 'HTTP/1.1' };
}

/**
 * Parse size string to number, treating "-" and falsy values as 0.
 */
export function parseSize(size: string): number {
    if (size === '-' || !size) return 0;
    return Number.parseInt(size, 10) || 0;
}

/**
 * Map HTTP status code to log level.
 */
export function getLevelFromStatus(status: number): string {
    if (status >= 500) return 'error';
    if (status >= 400) return 'warning';
    return 'info';
}

/**
 * Parse Nginx-style error log line (shared by Nginx & NPM parsers).
 * Supports:
 *   1. With PID/TID: "2026/02/08 12:50:46 [warn] 497#497: message"
 *   2. Standard:      "2026/02/08 12:50:46 [error] message"
 */
export function parseNginxErrorLine(line: string): { timestamp: Date; level: string; pid?: number; tid?: number; message: string } | null {
    if (!line || line.trim().length === 0) return null;

    // With PID/TID
    const pidMatch = line.match(/^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(\d+)#(\d+):\s+(.+)$/);
    if (pidMatch) {
        const [, ts, level, pid, tid, message] = pidMatch;
        return {
            timestamp: parseSlashTimestamp(ts) ?? new Date(),
            level: level.toLowerCase(),
            pid: Number.parseInt(pid, 10),
            tid: Number.parseInt(tid, 10),
            message: message.trim()
        };
    }

    // Standard
    const stdMatch = line.match(/^(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(\w+)\]\s+(.+)$/);
    if (stdMatch) {
        const [, ts, level, message] = stdMatch;
        return {
            timestamp: parseSlashTimestamp(ts) ?? new Date(),
            level: level.toLowerCase(),
            message: message.trim()
        };
    }

    return null;
}
