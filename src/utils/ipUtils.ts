/**
 * IP address display utilities for log tables.
 * Truncates long IPv6 addresses to fit in table cells while showing full IP in tooltip.
 */

/** Max length before truncating (IPv4 max ~15, IPv6 can be 39+ chars) */
const IPV6_TRUNCATE_THRESHOLD = 20;

/**
 * Check if a string looks like an IPv6 address (contains colons, longer than IPv4).
 */
export function isIPv6(ip: string): boolean {
    if (!ip || typeof ip !== 'string') return false;
    const trimmed = ip.trim();
    return trimmed.includes(':') && trimmed.length > IPV6_TRUNCATE_THRESHOLD;
}

/**
 * Truncate IPv6 for table display: show start + "…" + end.
 * Returns original string if not IPv6 or short enough.
 *
 * @param ip - IP address string
 * @param prefixLen - chars to show at start (default 10)
 * @param suffixLen - chars to show at end (default 10)
 */
export function truncateIPv6ForDisplay(
    ip: string,
    prefixLen = 10,
    suffixLen = 10
): string {
    if (!ip || typeof ip !== 'string') return ip;
    const trimmed = ip.trim();
    if (!isIPv6(trimmed)) return trimmed;
    if (trimmed.length <= prefixLen + suffixLen + 3) return trimmed;
    const start = trimmed.slice(0, prefixLen);
    const end = trimmed.slice(-suffixLen);
    return `${start}…${end}`;
}
