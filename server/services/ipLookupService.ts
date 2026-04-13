/**
 * IP Lookup Service
 *
 * Shared geo, WHOIS, reverse DNS and known-provider lookups.
 * Used by both the generic /api/ip route and the Fail2ban plugin.
 */

import * as dns from 'node:dns';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WhoisInfo {
    org: string;
    country: string;
    asn: string;
    netname: string;
    cidr: string;
}

export interface KnownProvider {
    name: string;
    cidr: string;
}

export interface GeoInfo {
    status: string;
    country: string;
    countryCode: string;
    city: string;
    org: string;
    isp: string;
    as: string;
    query: string;
}

export interface IpLookupResult {
    geo: GeoInfo | null;
    whois: WhoisInfo | null;
    hostname: string | null;
    knownProvider: KnownProvider | null;
}

// ── DNS cache ─────────────────────────────────────────────────────────────────

const dnsCache = new Map<string, { hostname: string; ts: number }>();
const DNS_TTL  = 10 * 60 * 1000; // 10 min

// ── Reverse DNS ───────────────────────────────────────────────────────────────

export async function reverseDns(ip: string): Promise<string | null> {
    const cached = dnsCache.get(ip);
    if (cached && Date.now() - cached.ts < DNS_TTL) return cached.hostname || null;
    try {
        const names = await Promise.race([
            dns.promises.reverse(ip),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
        ]);
        const hostname = (names as string[])[0] ?? null;
        if (hostname) dnsCache.set(ip, { hostname, ts: Date.now() });
        return hostname;
    } catch {
        dnsCache.set(ip, { hostname: '', ts: Date.now() }); // cache negative
        return null;
    }
}

// ── WHOIS ─────────────────────────────────────────────────────────────────────

const WHOIS_FIELDS: Array<{ key: keyof WhoisInfo; re: RegExp; extract: (line: string) => string }> = [
    { key: 'org',     re: /^org(?:name)?:\s*(.+)/i,          extract: l => l.replace(/^org(?:name)?:\s*/i, '').trim() },
    { key: 'country', re: /^country:\s*(.+)/i,               extract: l => l.replace(/^country:\s*/i, '').trim().toUpperCase() },
    { key: 'asn',     re: /^(?:origin|aut-num):\s*(AS\d+)/i, extract: l => l.match(/AS\d+/i)![0] },
    { key: 'netname', re: /^netname:\s*(.+)/i,               extract: l => l.replace(/^netname:\s*/i, '').trim() },
    { key: 'cidr',    re: /^(?:cidr|route):\s*(.+)/i,        extract: l => l.replace(/^(?:cidr|route):\s*/i, '').trim() },
];

export async function runWhois(ip: string): Promise<WhoisInfo | null> {
    try {
        const { stdout } = await execFileAsync('whois', [ip], { timeout: 6000 });
        const info: WhoisInfo = { org: '', country: '', asn: '', netname: '', cidr: '' };
        for (const raw of stdout.split('\n')) {
            const line = raw.trim();
            if (!line || line.startsWith('#') || line.startsWith('%')) continue;
            for (const f of WHOIS_FIELDS) {
                if (!info[f.key] && f.re.test(line)) info[f.key] = f.extract(line);
            }
        }
        return (info.org || info.country || info.asn || info.netname) ? info : null;
    } catch { return null; }
}

// ── Known provider ────────────────────────────────────────────────────────────

let knownRangesCache: Record<string, string[]> | null = null;

function ipv4ToLong(ipStr: string): number | null {
    const parts = ipStr.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => Number.isNaN(p) || p < 0 || p > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function cidrContains(ipLong: number, cidr: string): boolean {
    const [subnet, bits] = cidr.split('/');
    const b = Number.parseInt(bits, 10);
    if (!subnet || Number.isNaN(b) || b < 1 || b > 32) return false;
    const subnetLong = ipv4ToLong(subnet);
    if (subnetLong === null) return false;
    const mask = b === 32 ? 0xFFFFFFFF : (~(0xFFFFFFFF >>> b)) >>> 0;
    return (ipLong & mask) === (subnetLong & mask);
}

export function checkKnownProvider(ip: string): KnownProvider | null {
    if (!ip || ip.includes(':')) return null;
    const ipLong = ipv4ToLong(ip);
    if (ipLong === null) return null;

    if (!knownRangesCache) {
        try {
            knownRangesCache = JSON.parse(
                fs.readFileSync(path.join(__dirname, '..', 'plugins', 'fail2ban', 'known-ip-ranges.json'), 'utf8')
            );
        } catch { return null; }
    }

    for (const [provider, cidrs] of Object.entries(knownRangesCache!)) {
        for (const cidr of cidrs) {
            if (cidrContains(ipLong, cidr)) return { name: provider, cidr };
        }
    }
    return null;
}

// ── Geo lookup (ip-api.com) ───────────────────────────────────────────────────

export async function fetchGeo(ip: string): Promise<GeoInfo | null> {
    try {
        const r = await globalThis.fetch(
            `http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,org,isp,as,query`,
            { signal: AbortSignal.timeout(5000) }
        );
        const data = await r.json() as Record<string, unknown>;
        if (data.status !== 'success') return null;
        return data as unknown as GeoInfo;
    } catch { return null; }
}

// ── Combined lookup ───────────────────────────────────────────────────────────

export async function lookupIp(ip: string): Promise<IpLookupResult> {
    const [geo, whois, hostname] = await Promise.all([
        fetchGeo(ip),
        runWhois(ip),
        reverseDns(ip),
    ]);
    const knownProvider = checkKnownProvider(ip);
    return { geo, whois, hostname, knownProvider };
}
