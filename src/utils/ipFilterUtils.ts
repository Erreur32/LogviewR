/**
 * IP filter utilities for log viewer exclusion.
 * Supports single IPs (IPv4/IPv6) and IPv4 CIDR ranges (e.g. 192.168.1.0/24).
 */

const IP_COLUMNS = ['ip', 'ipaddress', 'clientip', 'remoteip', 'client_ip', 'remote_ip'];

/**
 * Normalize excluded IPs from plugin settings (string or array) to array of trimmed non-empty entries.
 */
export function parseExcludedIps(settingsValue: unknown): string[] {
    if (settingsValue == null) return [];
    if (Array.isArray(settingsValue)) {
        return settingsValue
            .map((v) => (typeof v === 'string' ? v.trim() : String(v).trim()))
            .filter(Boolean);
    }
    if (typeof settingsValue === 'string') {
        return settingsValue
            .split(/[\n,;]+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return [];
}

/**
 * Get the first IP value from a log entry (checks common column names).
 */
export function getLogEntryIp(log: Record<string, unknown>): string | null {
    for (const col of IP_COLUMNS) {
        const v = log[col];
        if (v != null && typeof v === 'string' && v.trim()) return v.trim();
    }
    return null;
}

/**
 * Check if an IPv4 address is inside a CIDR range (e.g. 192.168.1.0/24).
 */
function ipv4InCidr(ip: string, cidr: string): boolean {
    const parts = cidr.split('/');
    const base = parts[0].trim();
    const prefixLen = parts.length === 2 ? Number.parseInt(parts[1].trim(), 10) : 32;
    if (prefixLen < 0 || prefixLen > 32 || !Number.isInteger(prefixLen)) return false;
    const octets = base.split('.').map(Number);
    if (octets.length !== 4 || octets.some((n) => n < 0 || n > 255 || !Number.isInteger(n))) return false;
    const ipOctets = ip.split('.').map(Number);
    if (ipOctets.length !== 4 || ipOctets.some((n) => n < 0 || n > 255 || !Number.isInteger(n))) return false;
    const baseNum = (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3];
    const ipNum = (ipOctets[0] << 24) | (ipOctets[1] << 16) | (ipOctets[2] << 8) | ipOctets[3];
    const mask = prefixLen === 0 ? 0 : ~((1 << (32 - prefixLen)) - 1) >>> 0;
    return (baseNum & mask) === (ipNum & mask);
}

/**
 * Check if the given IP matches any entry in the excluded list (exact IP or IPv4 CIDR).
 */
export function isIpInExcludedList(ip: string, excludedList: string[]): boolean {
    if (!ip || excludedList.length === 0) return false;
    const ipTrim = ip.trim();
    for (const entry of excludedList) {
        const e = entry.trim();
        if (!e) continue;
        if (e.includes('/')) {
            if (ipTrim.includes(':')) continue;
            if (ipv4InCidr(ipTrim, e)) return true;
        } else {
            if (ipTrim === e) return true;
        }
    }
    return false;
}

/**
 * Check if a log entry should be hidden by the excluded IP list (any IP column in the list).
 */
export function isLogExcludedByIp(log: Record<string, unknown>, excludedList: string[]): boolean {
    if (excludedList.length === 0) return false;
    const ip = getLogEntryIp(log);
    return ip != null && isIpInExcludedList(ip, excludedList);
}
