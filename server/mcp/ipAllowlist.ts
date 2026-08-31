/**
 * Minimal IPv4/IPv6 allowlist matcher (single IPs or CIDR ranges)
 *
 * No new dependency: LogviewR's convention is to avoid adding npm packages
 * for something this small. Supports exact IPv4/IPv6 matches and IPv4/IPv6
 * CIDR ranges, which covers every realistic allowlist entry for the MCP HTTP
 * transport (a handful of admin/agent hosts, not a full routing table).
 */

function ipv4ToInt(ip: string): number | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let result = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const n = Number(part);
        if (n < 0 || n > 255) return null;
        result = (result << 8) | n;
    }
    return result >>> 0;
}

function ipv6ToBigInt(ip: string): bigint | null {
    // Normalize ::ffff:a.b.c.d style mapped addresses to plain IPv6 hextets.
    const v4Match = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    if (v4Match) {
        const v4 = ipv4ToInt(v4Match[1]);
        if (v4 === null) return null;
        return (0xffffn << 32n) | BigInt(v4);
    }

    if (!ip.includes(':')) return null;

    const [head, tail] = ip.split('::');
    const headParts = head ? head.split(':').filter(Boolean) : [];
    const tailParts = tail ? tail.split(':').filter(Boolean) : [];

    let groups: string[];
    if (ip.includes('::')) {
        const missing = 8 - headParts.length - tailParts.length;
        if (missing < 0) return null;
        groups = [...headParts, ...Array(missing).fill('0'), ...tailParts];
    } else {
        groups = ip.split(':');
    }
    if (groups.length !== 8) return null;

    let result = 0n;
    for (const g of groups) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        result = (result << 16n) | BigInt(parseInt(g, 16));
    }
    return result;
}

function normalize(ip: string): string {
    return ip.trim().replace(/^::ffff:/i, '');
}

/** Returns true if `ip` matches `entry`, where entry is a bare IP or a CIDR range (IPv4 or IPv6). */
export function ipMatchesEntry(ip: string, entry: string): boolean {
    const cleanIp = normalize(ip);
    const cleanEntry = entry.trim();
    const [entryAddr, prefixStr] = cleanEntry.split('/');

    if (cleanIp.includes(':') || entryAddr.includes(':')) {
        const ipBig = ipv6ToBigInt(cleanIp) ?? (ipv4ToInt(cleanIp) !== null ? BigInt(ipv4ToInt(cleanIp)!) : null);
        const entryBig = ipv6ToBigInt(entryAddr);
        if (ipBig === null || entryBig === null) return false;
        if (prefixStr === undefined) return ipBig === entryBig;
        const prefix = Number.parseInt(prefixStr, 10);
        if (Number.isNaN(prefix) || prefix < 0 || prefix > 128) return false;
        if (prefix === 0) return true;
        const mask = prefix === 128 ? (1n << 128n) - 1n : ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
        return (ipBig & mask) === (entryBig & mask);
    }

    const ipInt = ipv4ToInt(cleanIp);
    const entryInt = ipv4ToInt(entryAddr);
    if (ipInt === null || entryInt === null) return false;
    if (prefixStr === undefined) return ipInt === entryInt;
    const prefix = Number.parseInt(prefixStr, 10);
    if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return false;
    if (prefix === 0) return true;
    const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipInt & mask) === (entryInt & mask);
}

export function isIpAllowed(ip: string, allowlist: string[]): boolean {
    if (allowlist.length === 0) return true;
    return allowlist.some((entry) => ipMatchesEntry(ip, entry));
}
