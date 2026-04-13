/**
 * IpModal — Modal détail IP (plein écran).
 * Sections: Bot/Provider · Stats · Jails actifs · IPSets · Whois · Géoloc · Actions · Historique · Logs source
 */
import React, { useState, useEffect } from 'react';
import { X, Clock, Shield, MapPin, Activity, FileText, AlertTriangle, Info } from 'lucide-react';
import { api } from '../../api/client';
import { GeoInfo, fmtBantime } from './types';
import { FlagImg } from './FlagImg';

// ── Types ──────────────────────────────────────────────────────────────────────

interface IpHistEntry {
    ip: string; jail: string; timeofban: number;
    bantime: number | null; failures: number | null;
}

interface WhoisInfo {
    org: string; country: string; asn: string; netname: string; cidr: string;
}

interface LogFileEntry {
    jail:     string;
    filepath: string;
    domain:   string | null;
    type:     string; // 'access' | 'error' | 'other'
    lines:    string[];
}

interface IpDetails {
    activeJails:    string[];
    ipsets:         string[];
    allIpsets:      string[];
    hostname:       string | null;
    whois:          WhoisInfo | null;
    knownProvider:  { name: string; cidr: string } | null;
    logEntries:     LogFileEntry[];
    logFilesTotal:  number;
    logFilesShown:  number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtDate = (ts: number) => {
    const d = new Date(ts * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const dateColor = (ts: number): string => {
    const age = Date.now() / 1000 - ts;
    if (age < 3600)  return '#e86a65';
    if (age < 21600) return '#e3b341';
    if (age < 86400) return '#58a6ff';
    return '#8b949e';
};

/** Infer attack category i18n key from jail name */
const attackCategoryKey = (jail: string): string => {
    const j = jail.toLowerCase();
    if (/ssh|sshd/.test(j))                    return 'fail2ban.attackCategories.sshBruteforce';
    if (/recidive/.test(j))                    return 'fail2ban.attackCategories.recidivist';
    if (/apache|http-auth|nginx.*auth/.test(j)) return 'fail2ban.attackCategories.httpBruteforce';
    if (/nginx|npm|proxy/.test(j))             return 'fail2ban.attackCategories.httpBruteforce';
    if (/badbots?|crawler/.test(j))            return 'fail2ban.attackCategories.bot';
    if (/wp|wordpress/.test(j))                return 'fail2ban.attackCategories.wordpress';
    if (/mail|postfix|dovecot|smtp/.test(j))   return 'fail2ban.attackCategories.smtpBruteforce';
    if (/ftp/.test(j))                         return 'fail2ban.attackCategories.ftpBruteforce';
    if (/scan|portscan/.test(j))               return 'fail2ban.attackCategories.portscan';
    if (/ddos|flood/.test(j))                  return 'fail2ban.attackCategories.ddos';
    return 'fail2ban.attackCategories.other';
};

/** Tokenizes a log line into colored segments for React rendering (no dangerouslySetInnerHTML) */
type LogToken = { text: string; color?: string; weight?: string };
type LogType = 'access' | 'error' | 'other';

// Colors
const C_IP       = '#e86a65'; // IP addresses (red)
const C_TS       = '#e3b341'; // timestamps (yellow)
const C_PATH     = '#79c0ff'; // URL/filesystem paths (light blue)
const C_METHOD   = '#3fb950'; // HTTP methods (green)
const C_STATUS_E = '#e86a65'; // 4xx/5xx
const C_STATUS_R = '#58a6ff'; // 3xx
const C_STATUS_O = '#3fb950'; // 2xx
const C_WARN     = '#e3b341'; // warnings/modules
const C_MUTED    = '#8b949e'; // muted info
const C_DIM      = '#555d69'; // user-agent / noise

const isPlausibleIPv4 = (s: string) => {
    const p = s.split('.');
    return p.length === 4 && p.every(n => /^\d{1,3}$/.test(n) && Number(n) <= 255);
};

function tokenizeLogLine(raw: string, logType: LogType = 'other'): LogToken[] {
    if (!raw) return [];
    const tokens: LogToken[] = [];

    // ── Patterns shared by all log types ─────────────────────────────────────
    const COMMON: [RegExp, (m: RegExpMatchArray) => LogToken[]][] = [
        // Apache/NPM access timestamp [22/Mar/2026:17:30:08 +0100]
        [/\[\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}[^\]]*\]/, m => [{ text: m[0], color: C_TS }]],
        // Apache error timestamp [Sat Mar 22 17:30:08.123456 2026]
        [/\[[A-Za-z]{3} [A-Za-z]{3} +\d+ \d{2}:\d{2}:\d{2}[^\]]*\d{4}\]/, m => [{ text: m[0], color: C_TS }]],
        // nginx timestamp 2026/03/20 10:30:45 (line start)
        [/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/, m => [{ text: m[0], color: C_TS }]],
        // ISO timestamp
        [/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.,\d]*Z?/, m => [{ text: m[0], color: C_TS }]],
        // NPM proxy: METHOD http(s) domain "path"  e.g. GET https mysite.fr "/wp-login.php"
        [/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(https?)\s+(\S+)\s+"([^"]*)"/, m => [
            { text: m[1], color: C_METHOD, weight: '600' },
            { text: ' ', color: C_MUTED },
            { text: m[2], color: C_MUTED },
            { text: ' ', color: C_MUTED },
            { text: m[3], color: C_WARN },
            { text: ' "', color: C_MUTED },
            { text: m[4] || '-', color: m[4] ? C_PATH : C_MUTED, weight: '600' },
            { text: '"', color: C_MUTED },
        ]],
        // "METHOD /path HTTP/x.y" or "METHOD /path" (standard access log request line)
        [/"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) (\/[^\s"]*?)(?:\s+(HTTP\/[\d.]+))?"/,  m => [
            { text: '"', color: C_MUTED },
            { text: m[1], color: C_METHOD, weight: '600' },
            { text: ' ', color: C_MUTED },
            { text: m[2], color: C_PATH, weight: '600' },
            ...(m[3] ? [{ text: ' ', color: C_MUTED }, { text: m[3], color: C_MUTED }] : []),
            { text: '"', color: C_MUTED },
        ]],
        // NPM proxy metadata brackets: [Length 166] [Gzip 2.75]
        [/\[(Length|Gzip)\s+([^\]]+)\]/i, m => [
            { text: '[', color: C_MUTED },
            { text: m[1], color: C_DIM },
            { text: ' ' + m[2] + ']', color: C_DIM },
        ]],
        // [client X.X.X.X] Apache error log
        [/\[client (\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?\]/i, m => [
            { text: '[client ', color: C_MUTED },
            { text: m[1], color: C_IP, weight: '600' },
            { text: m[0].slice(m[0].lastIndexOf(m[1]) + m[1].length), color: C_MUTED },
        ]],
        // nginx: client: 1.2.3.4 (error log format — here in COMMON so it fires for all log types)
        [/\bclient:\s*(\d{1,3}(?:\.\d{1,3}){3})/, m => [
            { text: 'client: ', color: C_MUTED },
            { text: m[1], color: C_IP, weight: '600' },
        ]],
        // [Sent-to X.X.X.X] NPM proxy — destination IP (green = internal target)
        [/\[Sent-to (\d{1,3}(?:\.\d{1,3}){3}(?:\/\d+)?)\]/i, m => [
            { text: '[Sent-to ', color: C_METHOD },
            { text: m[1], color: C_METHOD, weight: '600' },
            { text: ']', color: C_METHOD },
        ]],
        // Apache error module:severity [authz_core:error] — before generic [xxx] brackets
        [/\[[a-z_]+:[a-z]+\]/i, m => [{ text: m[0], color: C_WARN }]],
        // Severity brackets [error] [crit] [warn]
        [/\[(error|crit|alert|emerg)\]/i, m => [{ text: m[0], color: C_STATUS_E }]],
        [/\[(warn(?:ing)?|notice)\]/i,    m => [{ text: m[0], color: C_WARN }]],
        // Ban/Unban fail2ban keywords
        [/\b(Ban|Found)\b/,  m => [{ text: m[0], color: C_STATUS_E, weight: '600' }]],
        [/\b(Unban)\b/,      m => [{ text: m[0], color: C_METHOD,   weight: '600' }]],
        // HTTP status codes (lookbehind avoids .257Z / 537.36)
        [/(?<![\d.])([45]\d{2})(?![\d.])/, m => [{ text: m[1], color: C_STATUS_E, weight: '600' }]],
        [/(?<![\d.])(3\d{2})(?![\d.])/,   m => [{ text: m[1], color: C_STATUS_R }]],
        [/(?<![\d.])(2\d{2})(?![\d.])/,   m => [{ text: m[1], color: C_STATUS_O }]],
        // Remaining IPv4
        [/\b(\d{1,3}(?:\.\d{1,3}){3})\b/, m => isPlausibleIPv4(m[0]) ? [{ text: m[0], color: C_IP }] : [{ text: m[0] }]],
        // Error keywords
        [/\b(failed|denied|refused|invalid|blocked|error)\b/i, m => [{ text: m[0], color: C_STATUS_E }]],
        [/\b(warning|warn)\b/i, m => [{ text: m[0], color: C_WARN }]],
    ];

    // ── Access log specific patterns (prepended — highest priority) ───────────
    const ACCESS_EXTRA: [RegExp, (m: RegExpMatchArray) => LogToken[]][] = [
        // Leading "IP - user [" block at line start
        [/^(\d{1,3}(?:\.\d{1,3}){3})( - [^\[]+)/, m => [
            ...(isPlausibleIPv4(m[1]) ? [{ text: m[1], color: C_IP, weight: '600' }] : [{ text: m[1] }]),
            { text: m[2], color: C_MUTED },
        ]],
        // Referer "https://..." — dim
        [/"https?:\/\/[^"]+"/, m => [{ text: m[0], color: C_DIM }]],
        // User-agent (long quoted string, must come AFTER path patterns)
        [/"([^"]{20,})"/, m => [{ text: '"' + m[1] + '"', color: C_DIM }]],
    ];

    // ── Error log specific patterns (prepended) ───────────────────────────────
    const ERROR_EXTRA: [RegExp, (m: RegExpMatchArray) => LogToken[]][] = [
        // nginx: server: hostname, host: "hostname"
        [/\b(server|host):\s*"?([^",\s]+)"?/, m => [
            { text: m[1] + ': ' },
            { text: m[2], color: C_MUTED },
        ]],
        // Filesystem paths in quotes: "/var/www/..." or '/var/www/...'
        [/"(\/[^"]+)"/, m => [{ text: '"' }, { text: m[1], color: C_PATH, weight: '600' }, { text: '"' }]],
        [/'(\/[^']+)'/,  m => [{ text: "'" }, { text: m[1], color: C_PATH, weight: '600' }, { text: "'" }]],
        // Bare filesystem paths (not in quotes): open() /var/www/...
        [/(?<=\s)(\/(?:var|usr|etc|home|srv|www|opt|tmp)[^\s,]+)/, m => [{ text: m[1], color: C_PATH }]],
        // nginx proc id 1234#1234: *567
        [/\d+#\d+: \*\d+/, m => [{ text: m[0], color: C_MUTED }]],
        // Syscall open()/stat()/unlink()
        [/\b(open|stat|unlink|access|lstat)\(\)/, m => [{ text: m[0], color: C_WARN }]],
        // Long quoted strings (user-agent / upstream) — dim, after path patterns
        [/"([^"]{20,})"/, m => [{ text: '"' + m[1] + '"', color: C_DIM }]],
    ];

    const PATTERNS =
        logType === 'access' ? [...ACCESS_EXTRA, ...COMMON] :
        logType === 'error'  ? [...ERROR_EXTRA,  ...COMMON] :
        COMMON;

    let rest = raw;
    while (rest.length > 0) {
        let earliest = rest.length;
        let bestMatch: RegExpMatchArray | null = null;
        let bestTokens: LogToken[] = [];

        for (const [re, fn] of PATTERNS) {
            const m = rest.match(re);
            if (m && m.index !== undefined && m.index < earliest) {
                earliest = m.index;
                bestMatch = m;
                bestTokens = fn(m);
            }
        }

        if (!bestMatch || earliest === rest.length) {
            tokens.push({ text: rest, color: C_MUTED });
            break;
        }
        if (earliest > 0) tokens.push({ text: rest.slice(0, earliest), color: C_MUTED });
        tokens.push(...bestTokens);
        rest = rest.slice(earliest + bestMatch[0].length);
    }
    return tokens;
}

const ColorizedLine: React.FC<{ line: string; logType?: LogType }> = ({ line, logType }) => (
    <span>
        {tokenizeLogLine(line, logType).map((tok, i) => (
            <span key={i} style={{ color: tok.color, fontWeight: tok.weight as React.CSSProperties['fontWeight'] }}>
                {tok.text}
            </span>
        ))}
    </span>
);

/** Infer service from log file path */
const detectService = (filepath: string): 'npm' | 'apache' | 'nginx' | 'system' => {
    const p = filepath.toLowerCase();
    if (p.includes('proxy-host') || p.includes('/npm/')) return 'npm';
    if (p.includes('apache'))  return 'apache';
    if (p.includes('nginx'))   return 'nginx';
    return 'system';
};

const SVC_ICONS: Record<string, [string, string]> = {
    npm:    ['nginx-proxy-manager.svg', 'Nginx Proxy Manager'],
    apache: ['apache.svg',              'Apache'],
    nginx:  ['nginx.svg',               'Nginx'],
    system: ['terminal.svg',            'System'],
};

const ServiceIcon: React.FC<{ filepath: string }> = ({ filepath }) => {
    const info = SVC_ICONS[detectService(filepath)];
    return (
        <img src={`/icons/services/${info[0]}`} width={14} height={14}
            style={{ borderRadius: 2, flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
            title={info[1]} alt={info[1]} loading="lazy"
        />
    );
};

/** Extract unique HTTP request paths from log lines (access logs) */
const extractPaths = (lines: string[]): string[] => {
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const line of lines) {
        const m = line.match(/"(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) (\/[^"\s?]*)/);
        if (m && !seen.has(m[1])) {
            seen.add(m[1]);
            paths.push(m[1]);
            if (paths.length >= 5) break;
        }
    }
    return paths;
};

import { DomainInitial } from './DomainInitial';
import { useTranslation } from 'react-i18next';

const isKnownBotHostname = (hostname: string | null): string | null => {
    if (!hostname) return null;
    const h = hostname.toLowerCase();
    if (h.includes('googlebot') || h.includes('crawl.google'))  return 'Googlebot';
    if (h.includes('bingbot') || h.endsWith('.msn.com') || h === 'msn.com') return 'Bingbot';
    if (h.includes('crawl.yahoo'))                               return 'Yahoo Crawler';
    if (h.includes('semrush'))                                   return 'SEMrush Bot';
    if (h.includes('ahrefs'))                                    return 'Ahrefs Bot';
    if (h.includes('majestic'))                                  return 'Majestic Bot';
    if (h.includes('mj12bot'))                                   return 'Majestic Bot';
    if (h.includes('duckduckbot'))                               return 'DuckDuckBot';
    if (h.includes('facebookexternalhit'))                       return 'Facebook Crawler';
    if (h.includes('scan') || h.includes('scanner'))             return 'Scanner connu';
    if (h.includes('bot') || h.includes('crawl') || h.includes('spider')) return 'Bot/Crawler';
    return null;
};

// ── UI atoms ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties  = { background: '#161b22', border: '1px solid #30363d', borderRadius: 7, overflow: 'hidden' };
const cardH: React.CSSProperties = { background: '#21262d', padding: '.45rem .75rem', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.4rem' };
const cardB: React.CSSProperties = { padding: '.55rem .75rem', display: 'flex', flexDirection: 'column', gap: '.25rem' };

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '.4rem', fontSize: '.79rem' }}>
        <span style={{ color: '#8b949e', flexShrink: 0, minWidth: 88, fontSize: '.73rem' }}>{label}</span>
        <span style={{ color: '#e6edf3' }}>{children}</span>
    </div>
);

const JailPill: React.FC<{ jail: string }> = ({ jail }) => {
    const isRecidive = /recidive/i.test(jail);
    return (
        <span style={{ padding: '.07rem .38rem', borderRadius: 4, fontSize: '.7rem', fontWeight: 600,
            background: isRecidive ? 'rgba(232,106,101,.15)' : 'rgba(63,185,80,.1)',
            color: isRecidive ? '#e86a65' : '#3fb950',
            border: `1px solid ${isRecidive ? 'rgba(232,106,101,.35)' : 'rgba(63,185,80,.25)'}`,
            marginRight: '.2rem', display: 'inline-block' }}>
            {jail}
        </span>
    );
};

// ── Data fetching hook ────────────────────────────────────────────────────────

type BlocklistHit = { id: string; name: string; direction: string; present: boolean };

function useIpLookup(ip: string, geoProp: GeoInfo | null | undefined, mode: 'fail2ban' | 'logviewer') {
    const [history,       setHistory]       = useState<IpHistEntry[]>([]);
    const [loading,       setLoading]       = useState(true);
    const [fetchError,    setFetchError]    = useState(false);
    const [geo,           setGeo]           = useState<GeoInfo | null>(geoProp ?? null);
    const [details,       setDetails]       = useState<IpDetails | null>(null);
    const [blocklistHits, setBlocklistHits] = useState<BlocklistHit[] | null>(null);
    const [f2bAvailable,  setF2bAvailable]  = useState(mode === 'fail2ban');
    const [selIpset,      setSelIpset]      = useState('');
    const [selUnbanJail,  setSelUnbanJail]  = useState('');

    useEffect(() => {
        setHistory([]); setLoading(true); setFetchError(false); setDetails(null);
        setBlocklistHits(null); setSelUnbanJail('');
        if (!geoProp) setGeo(null);
        if (mode === 'fail2ban') setF2bAvailable(true);

        const ipEnc = encodeURIComponent(ip);

        const lookupP = api.get<{ ok: boolean; geo: GeoInfo | null; whois: WhoisInfo | null; hostname: string | null; knownProvider: { name: string; cidr: string } | null }>(
            `/api/ip/${ipEnc}/lookup`
        );
        const histP = api.get<{ ok: boolean; bans: IpHistEntry[] }>(
            `/api/plugins/fail2ban/audit/internal?ip=${ipEnc}&limit=250`
        ).catch(() => null);
        const detP = api.get<{ ok: boolean } & IpDetails>(
            `/api/plugins/fail2ban/ip/${ipEnc}`
        ).catch(() => null);
        const blP = api.get<{ ok: boolean; results: BlocklistHit[] }>(
            `/api/plugins/fail2ban/blocklists/test/${ipEnc}`
        ).catch(() => null);

        Promise.all([lookupP, histP, detP, blP]).then(([lookupRes, histRes, detRes, blRes]) => {
            if (lookupRes.success && lookupRes.result?.ok && !geoProp && lookupRes.result.geo) {
                setGeo(lookupRes.result.geo);
            }

            const f2bOk = !!(detRes?.success && detRes.result?.ok);
            setF2bAvailable(f2bOk);

            if (histRes?.success && histRes.result?.ok) setHistory(histRes.result.bans ?? []);
            if (blRes?.success && blRes.result?.ok) setBlocklistHits(blRes.result.results ?? []);

            if (f2bOk) {
                const r = detRes!.result;
                setDetails({
                    activeJails: r.activeJails ?? [], ipsets: r.ipsets ?? [], allIpsets: r.allIpsets ?? [],
                    hostname: r.hostname ?? null, whois: r.whois ?? null, knownProvider: r.knownProvider ?? null,
                    logEntries: r.logEntries ?? [], logFilesTotal: r.logFilesTotal ?? 0, logFilesShown: r.logFilesShown ?? 0,
                });
                setSelIpset(s => s || (r.allIpsets?.[0] ?? ''));
                setSelUnbanJail(s => s || (r.activeJails?.[0] ?? ''));
            } else {
                setDetails({
                    activeJails: [], ipsets: [], allIpsets: [],
                    hostname: lookupRes.result?.hostname ?? null, whois: lookupRes.result?.whois ?? null,
                    knownProvider: lookupRes.result?.knownProvider ?? null,
                    logEntries: [], logFilesTotal: 0, logFilesShown: 0,
                });
            }
            setLoading(false);
        }).catch(() => { setFetchError(true); setLoading(false); });
    }, [ip, geoProp, mode]);

    return { history, loading, fetchError, geo, details, blocklistHits, f2bAvailable,
        selIpset, setSelIpset, selUnbanJail, setSelUnbanJail, setDetails, setHistory };
}

// ── Main component ─────────────────────────────────────────────────────────────

export const IpModal: React.FC<{
    ip: string;
    onClose: () => void;
    geo?: GeoInfo | null;
    jails?: string[];
    mode?: 'fail2ban' | 'logviewer';
}> = ({ ip, onClose, geo: geoProp, jails: jailsProp, mode = 'fail2ban' }) => {
    const { t } = useTranslation();
    const {
        history, loading, fetchError, geo, details, blocklistHits, f2bAvailable,
        selIpset, setSelIpset, selUnbanJail, setSelUnbanJail, setDetails,
    } = useIpLookup(ip, geoProp, mode);

    const [actionMsg,    setActionMsg]    = useState<{ ok: boolean; text: string } | null>(null);
    const [banning,      setBanning]      = useState(false);
    const [unbanning,    setUnbanning]    = useState(false);
    const [ipsetBanning, setIpsetBanning] = useState<string | null>(null);
    const [ipsetRemoving, setIpsetRemoving] = useState<string | null>(null);
    const [logsOpen,     setLogsOpen]     = useState(true);
    const [expandedLogs, setExpandedLogs] = useState<Set<number>>(new Set());
    const LOG_LINES_DEFAULT = 4;

    const jails = [...new Set([
        ...(jailsProp ?? []),
        ...(details?.activeJails ?? []),
        ...history.map(h => h.jail),
    ])];
    const inRecidive = jails.some(j => /recidive/i.test(j));

    const bans   = history.filter(h => (h.bantime ?? 0) > 0);
    const unbans  = history.filter(h => h.bantime === 0);
    const lastBan  = bans[0] ?? null;
    const firstBan = bans.length > 1 ? bans[bans.length - 1] : null;

    // Attack category distribution from ban history
    const categoryMap: Record<string, number> = {};
    for (const b of bans) {
        const cat = attackCategoryKey(b.jail);
        categoryMap[cat] = (categoryMap[cat] ?? 0) + 1;
    }
    const categories = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);

    // Jail breakdown for historique
    const jailCountMap: Record<string, number> = {};
    for (const b of bans) jailCountMap[b.jail] = (jailCountMap[b.jail] ?? 0) + 1;
    const jailEntries = Object.entries(jailCountMap).sort((a, b) => b[1] - a[1]);

    // Ban frequency
    const freqLabel = (() => {
        if (bans.length < 2) return null;
        const totalSecs = bans[0].timeofban - bans[bans.length - 1].timeofban;
        const avgSecs = totalSecs / (bans.length - 1);
        if (avgSecs < 3600)  return `~${Math.round(avgSecs / 60)} min`;
        if (avgSecs < 86400) return `~${Math.round(avgSecs / 3600)}h`;
        return `~${Math.round(avgSecs / 86400)} jours`;
    })();

    // Bot detection
    const knownBot = isKnownBotHostname(details?.hostname ?? null);
    const isKnownProvider = !!details?.knownProvider;
    const isBotLike = knownBot || isKnownProvider || (bans.length >= 5 && categories.some(([c]) => c.includes('wordpress') || c.includes('bot') || c.includes('ssh')));

    const doAction = async (label: string, endpoint: string, body: Record<string, string>) => {
        setActionMsg(null);
        const res = await api.post<{ ok: boolean; error?: string }>(endpoint, body);
        setActionMsg(res.success && res.result?.ok
            ? { ok: true,  text: `✓ ${label}` }
            : { ok: false, text: '✗ ' + (res.result?.error ?? res.error?.message ?? 'Erreur') }
        );
    };

    const banRecidive = async () => {
        setBanning(true);
        await doAction(`${ip} banni dans recidive`, '/api/plugins/fail2ban/ban', { jail: 'recidive', ip });
        setBanning(false);
    };

    const banIpset = async (setName: string) => {
        setIpsetBanning(setName);
        await doAction(`${ip} ajouté dans ${setName}`, '/api/plugins/fail2ban/ipset/add', { set: setName, entry: ip });
        setIpsetBanning(null);
    };

    const unbanFromJail = async (jail: string) => {
        setUnbanning(true);
        await doAction(`${ip} débanni de ${jail}`, '/api/plugins/fail2ban/unban', { jail, ip });
        setUnbanning(false);
        // Refresh active jails after unban
        api.get<{ ok: boolean } & IpDetails>(`/api/plugins/fail2ban/ip/${encodeURIComponent(ip)}`)
            .then(res => { if (res.success && res.result?.ok) setDetails(d => d ? { ...d, activeJails: res.result.activeJails ?? [] } : d); });
    };

    const removeFromIpset = async (setName: string) => {
        setIpsetRemoving(setName);
        await doAction(`${ip} retiré de ${setName}`, '/api/plugins/fail2ban/ipset/del', { set: setName, entry: ip });
        setIpsetRemoving(null);
        // Refresh ipsets membership after removal
        api.get<{ ok: boolean } & IpDetails>(`/api/plugins/fail2ban/ip/${encodeURIComponent(ip)}`)
            .then(res => { if (res.success && res.result?.ok) setDetails(d => d ? { ...d, ipsets: res.result.ipsets ?? [] } : d); });
    };

    const logEntries = (details?.logEntries ?? []).map(e => ({
        ...e,
        // Filter out internal API calls generated by this modal (avoid self-referencing noise)
        lines: e.lines.filter(l => !l.includes('/api/plugins/fail2ban/')),
    })).filter(e => e.lines.length > 0);
    const totalLogLines  = logEntries.reduce((s, e) => s + e.lines.length, 0);
    const logFilesTotal  = details?.logFilesTotal ?? 0;
    const logFilesShown  = details?.logFilesShown ?? 0;

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.75)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '1rem', overflowY: 'auto' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 10,
                width: '96vw', maxWidth: 2200, marginTop: '1rem', marginBottom: '1rem',
                display: 'flex', flexDirection: 'column' }}>

                {/* ── Header ── */}
                <div style={{ background: '#161b22', padding: '.65rem 1rem',
                    borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center',
                    gap: '.6rem', flexWrap: 'wrap', flexShrink: 0, borderRadius: '10px 10px 0 0' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 700,
                        color: '#e86a65', textShadow: '0 0 14px rgba(232,106,101,.45)' }}>
                        {ip}
                    </span>
                    {inRecidive && (
                        <span style={{ padding: '.1rem .45rem', borderRadius: 4, fontSize: '.72rem', fontWeight: 700,
                            background: 'rgba(232,106,101,.2)', color: '#e86a65', border: '1px solid rgba(232,106,101,.4)' }}>
                            ⚠ récidiviste
                        </span>
                    )}
                    {details?.hostname && (
                        <span style={{ fontFamily: 'monospace', fontSize: '.77rem', color: '#8b949e' }}>
                            {details.hostname}
                        </span>
                    )}
                    {geo && (
                        <span style={{ fontSize: '.8rem', color: '#8b949e', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                            {geo.countryCode && <FlagImg code={geo.countryCode} size={16} />}
                            {[geo.city, geo.country].filter(Boolean).join(', ')}
                            {geo.org && <span style={{ marginLeft: '.5rem', fontSize: '.72rem' }}>· {geo.org}</span>}
                        </span>
                    )}
                    <button onClick={onClose}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                            color: '#8b949e', padding: '.2rem', borderRadius: 4, display: 'flex', flexShrink: 0 }}>
                        <X style={{ width: 16, height: 16 }} />
                    </button>
                </div>

                {/* ── Error banner ── */}
                {fetchError && !loading && !details && history.length === 0 && (
                    <div style={{ padding: '.75rem 1rem', background: 'rgba(232,106,101,.08)',
                        borderBottom: '1px solid rgba(232,106,101,.25)', display: 'flex', gap: '.6rem', alignItems: 'center' }}>
                        <AlertTriangle style={{ width: 14, height: 14, color: '#e86a65', flexShrink: 0 }} />
                        <span style={{ fontSize: '.8rem', color: '#e6edf3' }}>
                            {t('logViewer.ipModal.fetchError')}
                        </span>
                    </div>
                )}

                {/* ── Known Provider / Bot banner ── */}
                {(isKnownProvider || knownBot) && (
                    <div style={{ padding: '.6rem 1rem', background: 'rgba(88,166,255,.06)',
                        borderBottom: '1px solid rgba(88,166,255,.2)', display: 'flex', gap: '.6rem', alignItems: 'flex-start' }}>
                        <Info style={{ width: 14, height: 14, color: '#58a6ff', flexShrink: 0, marginTop: 2 }} />
                        <span style={{ fontSize: '.8rem', color: '#c0d0e0', lineHeight: 1.5 }}>
                            {isKnownProvider && (
                                <>Cette IP appartient à l'espace public <strong style={{ color: '#58a6ff' }}>{details!.knownProvider!.name}</strong> ({details!.knownProvider!.cidr}). {' '}</>
                            )}
                            {knownBot && (
                                <>Hostname identifié comme <strong style={{ color: '#e3b341' }}>{knownBot}</strong>. {' '}</>
                            )}
                            C'est <strong>habituel</strong> d'y voir des bans — scans, bots et instances compromises proviennent souvent de ces plages. Le ban reste légitime si les règles fail2ban se déclenchent sur vos logs.
                        </span>
                    </div>
                )}

                {/* ── INFO STRIP: Geo + Whois ── */}
                <div style={{ padding: '.65rem 1.75rem', borderBottom: '1px solid #30363d',
                    display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap',
                    background: 'rgba(255,255,255,.015)' }}>
                    {geo ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.55rem' }}>
                            {geo.countryCode && <FlagImg code={geo.countryCode} size={22} />}
                            <div>
                                <div style={{ fontSize: '.8rem', color: '#e6edf3', fontWeight: 600 }}>
                                    {[geo.city, geo.country].filter(Boolean).join(', ')}
                                    {geo.countryCode && <span style={{ marginLeft: '.4rem', fontSize: '.68rem', color: '#8b949e', fontFamily: 'monospace' }}>{geo.countryCode}</span>}
                                </div>
                                {geo.org && <div style={{ fontSize: '.7rem', color: '#8b949e', marginTop: '.05rem' }}>{geo.org}</div>}
                            </div>
                        </div>
                    ) : loading ? <span style={{ fontSize: '.73rem', color: '#8b949e', fontStyle: 'italic' }}>{t('fail2ban.tracker.geoloading')}</span> : null}

                    {details?.whois && <div style={{ width: 1, height: 32, background: '#30363d', flexShrink: 0 }} />}
                    {details?.whois ? (
                        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            {details.whois.org && <div><div style={{ fontSize: '.6rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.1rem' }}>{t('fail2ban.labels.organization')}</div><div style={{ fontSize: '.74rem', fontFamily: 'monospace', color: '#e6edf3' }}>{details.whois.org}</div></div>}
                            {details.whois.asn && <div><div style={{ fontSize: '.6rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.1rem' }}>{t('fail2ban.labels.asn')}</div><div style={{ fontSize: '.74rem', fontFamily: 'monospace', color: '#bc8cff' }}>{details.whois.asn}</div></div>}
                            {details.whois.cidr && <div><div style={{ fontSize: '.6rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.1rem' }}>CIDR</div><div style={{ fontSize: '.74rem', fontFamily: 'monospace', color: '#8b949e' }}>{details.whois.cidr}</div></div>}
                            {details.whois.netname && <div><div style={{ fontSize: '.6rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.1rem' }}>Netname</div><div style={{ fontSize: '.74rem', fontFamily: 'monospace', color: '#8b949e' }}>{details.whois.netname}</div></div>}
                        </div>
                    ) : loading ? <span style={{ fontSize: '.73rem', color: '#8b949e', fontStyle: 'italic' }}>{t('common.loading')}</span> : null}

                    {geo?.isp && geo.isp !== geo.org && <><div style={{ width: 1, height: 32, background: '#30363d', flexShrink: 0 }} /><div><div style={{ fontSize: '.6rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.1rem' }}>ISP</div><div style={{ fontSize: '.74rem', fontFamily: 'monospace', color: '#8b949e' }}>{geo.isp}</div></div></>}
                    {details?.hostname && <><div style={{ width: 1, height: 32, background: '#30363d', flexShrink: 0 }} /><div><div style={{ fontSize: '.6rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.1rem' }}>Hostname</div><div style={{ fontSize: '.74rem', fontFamily: 'monospace', color: '#8b949e' }}>{details.hostname}</div></div></>}
                    {details?.knownProvider && <><div style={{ width: 1, height: 32, background: '#30363d', flexShrink: 0 }} /><span style={{ padding: '.2rem .55rem', borderRadius: 5, fontSize: '.7rem', fontWeight: 600, background: 'rgba(88,166,255,.12)', color: '#58a6ff', border: '1px solid rgba(88,166,255,.3)' }}>☁ {details.knownProvider.name} · {details.knownProvider.cidr}</span></>}
                </div>


                {/* ── EN COURS + HISTORIQUE (2 colonnes) — fail2ban only ── */}
                {f2bAvailable && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', padding: '1rem 1.75rem', borderBottom: '1px solid #30363d' }}>

                    {/* ── EN COURS ── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>

                        {/* Live status */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.5rem .85rem',
                            borderRadius: 7, border: `1px solid ${(details?.activeJails ?? []).length > 0 ? 'rgba(232,106,101,.35)' : 'rgba(63,185,80,.25)'}`,
                            background: (details?.activeJails ?? []).length > 0 ? 'rgba(232,106,101,.07)' : 'rgba(63,185,80,.06)' }}>
                            <div style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                                background: (details?.activeJails ?? []).length > 0 ? '#e86a65' : '#3fb950',
                                boxShadow: (details?.activeJails ?? []).length > 0 ? '0 0 8px rgba(232,106,101,.6)' : '0 0 6px rgba(63,185,80,.4)',
                                animation: (details?.activeJails ?? []).length > 0 ? 'pulse 1.2s ease-in-out infinite' : 'none' }} />
                            <span style={{ fontWeight: 700, fontSize: '.83rem',
                                color: (details?.activeJails ?? []).length > 0 ? '#e86a65' : '#3fb950' }}>
                                {(details?.activeJails ?? []).length > 0 ? 'BANNI ACTUELLEMENT' : 'Non banni actuellement'}
                            </span>
                            {lastBan && (
                                <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: '#8b949e', fontFamily: 'monospace' }}>
                                    {fmtDate(lastBan.timeofban)}
                                </span>
                            )}
                        </div>

                        {/* Bot/Scanner badge */}
                        {isBotLike && !isKnownProvider && !knownBot && (
                            <div style={{ background: 'rgba(227,179,65,.07)', border: '1px solid rgba(227,179,65,.3)',
                                borderRadius: 6, padding: '.5rem .75rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                <AlertTriangle style={{ width: 13, height: 13, color: '#e3b341', flexShrink: 0 }} />
                                <span style={{ fontSize: '.77rem', color: '#e3b341' }}>
                                    Comportement de <strong>bot / scanner</strong> détecté
                                </span>
                            </div>
                        )}

                        {/* Jails actifs + IPSets + Actions — même ligne */}
                        <div style={{ display: 'flex', gap: '.75rem', alignItems: 'stretch' }}>
                            <div style={{ ...card, flex: 1, minWidth: 0 }}>
                                <div style={cardH}>
                                    <Shield style={{ width: 12, height: 12, color: (details?.activeJails ?? []).length > 0 ? '#3fb950' : '#8b949e' }} />
                                    <span style={{ fontWeight: 600, fontSize: '.8rem' }}>Jails actifs</span>
                                    {(details?.activeJails ?? []).length > 0 && (
                                        <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: '#3fb950' }}>
                                            {(details?.activeJails ?? []).length} actif{(details?.activeJails ?? []).length > 1 ? 's' : ''}
                                        </span>
                                    )}
                                </div>
                                <div style={{ padding: '.6rem .85rem', display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                                    {(details?.activeJails ?? []).length > 0
                                        ? details!.activeJails.map(j => <JailPill key={j} jail={j} />)
                                        : <span style={{ fontSize: '.73rem', color: '#8b949e', fontStyle: 'italic' }}>aucun jail actif</span>
                                    }
                                </div>
                            </div>
                            {(details?.ipsets ?? []).length > 0 && (
                                <div style={{ ...card, flex: 1, minWidth: 0 }}>
                                    <div style={cardH}>
                                        <Shield style={{ width: 12, height: 12, color: '#bc8cff' }} />
                                        <span style={{ fontWeight: 600, fontSize: '.8rem' }}>IPSets</span>
                                    </div>
                                    <div style={{ padding: '.6rem .85rem', display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                                        {details!.ipsets.map(s => (
                                            <span key={s} style={{ padding: '.08rem .4rem', borderRadius: 4, fontSize: '.68rem', fontWeight: 600,
                                                background: 'rgba(188,140,255,.1)', color: '#bc8cff',
                                                border: '1px solid rgba(188,140,255,.25)', fontFamily: 'monospace' }}>{s}</span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {/* Blocklist membership — ipset test results */}
                            {blocklistHits !== null && blocklistHits.length > 0 && (() => {
                                const hits = blocklistHits.filter(b => b.present);
                                const hasHits = hits.length > 0;
                                return (
                                    <div style={{ ...card, flex: 1, minWidth: 0 }}>
                                        <div style={cardH}>
                                            <Shield style={{ width: 12, height: 12, color: hasHits ? '#e86a65' : '#555d69' }} />
                                            <span style={{ fontWeight: 600, fontSize: '.8rem' }}>Blocklists</span>
                                            {hasHits
                                                ? <>
                                                    <AlertTriangle style={{ width: 11, height: 11, color: '#e3b341', marginLeft: 2 }} />
                                                    <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: '#e86a65', fontWeight: 700 }}>
                                                        {hits.length} liste{hits.length > 1 ? 's' : ''}
                                                    </span>
                                                  </>
                                                : <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: '#555d69', fontStyle: 'italic' }}>
                                                    Non présente dans les blocklists actives
                                                  </span>
                                            }
                                        </div>
                                        {hasHits && (
                                            <div style={{ padding: '.6rem .85rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                                                {blocklistHits.map(b => (
                                                    <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                                        <span style={{ fontSize: '.65rem', fontWeight: 700, minWidth: 16, textAlign: 'center', color: b.present ? '#e86a65' : '#555d69' }}>
                                                            {b.present ? '✓' : '○'}
                                                        </span>
                                                        <span style={{ fontSize: '.75rem', color: b.present ? '#e6edf3' : '#555d69', flex: 1 }}>
                                                            {b.name}
                                                        </span>
                                                        <span style={{
                                                            fontSize: '.65rem', padding: '.04rem .3rem', borderRadius: 3,
                                                            background: b.direction === 'out' ? 'rgba(227,179,65,.1)' : 'rgba(63,185,80,.07)',
                                                            border: `1px solid ${b.direction === 'out' ? 'rgba(227,179,65,.25)' : 'rgba(63,185,80,.2)'}`,
                                                            color: b.direction === 'out' ? '#e3b341' : '#8b949e',
                                                        }}>
                                                            {b.direction === 'in' ? 'IN' : b.direction === 'out' ? 'OUT' : 'IN+OUT'}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                            <div style={{ ...card, flex: 1, minWidth: 0 }}>
                                <div style={cardH}>
                                    <Shield style={{ width: 12, height: 12, color: '#e86a65' }} />
                                    <span style={{ fontWeight: 600, fontSize: '.8rem' }}>Actions rapides</span>
                                </div>
                                <div style={{ ...cardB, gap: '.5rem' }}>

                                    {/* ── Bannir dans recidive ── */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.22rem' }}>
                                        <span style={{ fontSize: '.68rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Recidive</span>
                                        {inRecidive
                                            ? <div style={{ fontSize: '.72rem', color: '#e86a65', fontWeight: 600, padding: '.28rem .6rem', borderRadius: 5, background: 'rgba(232,106,101,.07)', border: '1px solid rgba(232,106,101,.2)' }}>⚠ déjà banni en récidive</div>
                                            : <button onClick={banRecidive} disabled={banning}
                                                style={{ width: '100%', padding: '.3rem .6rem', borderRadius: 5,
                                                    background: 'rgba(232,106,101,.08)', border: '1px solid rgba(232,106,101,.3)',
                                                    color: '#e86a65', cursor: banning ? 'default' : 'pointer',
                                                    fontSize: '.74rem', fontWeight: 600, opacity: banning ? .6 : 1,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.3rem' }}>
                                                <Shield style={{ width: 10, height: 10 }} />
                                                {banning ? 'Bannissement…' : t('fail2ban.actions.banInRecidive')}
                                            </button>
                                        }
                                    </div>

                                    {/* ── Débannir d'un jail ── */}
                                    {(details?.activeJails ?? []).length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.22rem' }}>
                                            <span style={{ fontSize: '.68rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>Débannir</span>
                                            {details!.activeJails.length === 1
                                                ? <button onClick={() => unbanFromJail(details!.activeJails[0])} disabled={unbanning}
                                                    style={{ width: '100%', padding: '.3rem .6rem', borderRadius: 5,
                                                        background: 'rgba(63,185,80,.08)', border: '1px solid rgba(63,185,80,.3)',
                                                        color: '#3fb950', cursor: unbanning ? 'default' : 'pointer',
                                                        fontSize: '.74rem', fontWeight: 600, opacity: unbanning ? .6 : 1,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.3rem' }}>
                                                    {unbanning ? 'Déban…' : `Débannir de ${details!.activeJails[0]}`}
                                                  </button>
                                                : <div style={{ display: 'flex', gap: '.35rem' }}>
                                                    <select value={selUnbanJail} onChange={e => setSelUnbanJail(e.target.value)}
                                                        style={{ flex: 1, minWidth: 0, background: '#21262d', border: '1px solid #30363d', color: '#e6edf3',
                                                            borderRadius: 4, padding: '.28rem .4rem', fontSize: '.74rem', outline: 'none', cursor: 'pointer' }}>
                                                        {details!.activeJails.map(j => <option key={j} value={j} style={{ background: '#21262d' }}>{j}</option>)}
                                                    </select>
                                                    <button onClick={() => selUnbanJail && unbanFromJail(selUnbanJail)} disabled={!selUnbanJail || unbanning}
                                                        style={{ flexShrink: 0, padding: '.28rem .6rem', borderRadius: 5,
                                                            background: 'rgba(63,185,80,.08)', border: '1px solid rgba(63,185,80,.3)',
                                                            color: '#3fb950', cursor: (!selUnbanJail || unbanning) ? 'default' : 'pointer',
                                                            fontSize: '.74rem', fontWeight: 600, opacity: (!selUnbanJail || unbanning) ? .5 : 1 }}>
                                                        {unbanning ? 'Déban…' : 'Débannir'}
                                                    </button>
                                                  </div>
                                            }
                                        </div>
                                    )}

                                    {/* ── IPSet : ajouter + retirer ── */}
                                    {(details?.allIpsets ?? []).length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.22rem' }}>
                                            <span style={{ fontSize: '.68rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>IPSet</span>
                                            <select value={selIpset} onChange={e => setSelIpset(e.target.value)}
                                                style={{ width: '100%', background: '#21262d', border: '1px solid #30363d', color: '#e6edf3',
                                                    borderRadius: 4, padding: '.28rem .4rem', fontSize: '.74rem', outline: 'none', cursor: 'pointer' }}>
                                                {(details?.allIpsets ?? []).map(s => (
                                                    <option key={s} value={s} style={{ background: '#21262d' }}>
                                                        {s}{(details?.ipsets ?? []).includes(s) ? ' ✓' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                            <div style={{ display: 'flex', gap: '.35rem' }}>
                                                <button
                                                    onClick={() => selIpset && banIpset(selIpset)}
                                                    disabled={!selIpset || !!ipsetBanning || (details?.ipsets ?? []).includes(selIpset)}
                                                    title="Ajouter l'IP dans ce set"
                                                    style={{ flex: 1, padding: '.28rem .5rem', borderRadius: 5,
                                                        background: (details?.ipsets ?? []).includes(selIpset) ? 'rgba(188,140,255,.06)' : 'rgba(188,140,255,.1)',
                                                        border: '1px solid rgba(188,140,255,.3)', color: '#bc8cff',
                                                        cursor: (!selIpset || !!ipsetBanning || (details?.ipsets ?? []).includes(selIpset)) ? 'default' : 'pointer',
                                                        fontSize: '.74rem', fontWeight: 600,
                                                        opacity: (!selIpset || !!ipsetBanning) ? .5 : 1 }}>
                                                    {(details?.ipsets ?? []).includes(selIpset)
                                                        ? '✓ présent'
                                                        : ipsetBanning === selIpset ? 'Ajout…' : '+ Ajouter'}
                                                </button>
                                                <button
                                                    onClick={() => selIpset && removeFromIpset(selIpset)}
                                                    disabled={!selIpset || !!ipsetRemoving || !(details?.ipsets ?? []).includes(selIpset)}
                                                    title="Retirer l'IP de ce set"
                                                    style={{ flex: 1, padding: '.28rem .5rem', borderRadius: 5,
                                                        background: !(details?.ipsets ?? []).includes(selIpset) ? 'rgba(232,106,101,.03)' : 'rgba(232,106,101,.08)',
                                                        border: '1px solid rgba(232,106,101,.3)', color: '#e86a65',
                                                        cursor: (!selIpset || !!ipsetRemoving || !(details?.ipsets ?? []).includes(selIpset)) ? 'default' : 'pointer',
                                                        fontSize: '.74rem', fontWeight: 600,
                                                        opacity: (!selIpset || !!ipsetRemoving || !(details?.ipsets ?? []).includes(selIpset)) ? .4 : 1 }}>
                                                    {ipsetRemoving === selIpset ? 'Retrait…' : '− Retirer'}
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {actionMsg && (
                                        <div style={{ fontSize: '.72rem', color: actionMsg.ok ? '#3fb950' : '#e86a65',
                                            padding: '.25rem .5rem', borderRadius: 4,
                                            background: actionMsg.ok ? 'rgba(63,185,80,.07)' : 'rgba(232,106,101,.07)',
                                            border: `1px solid ${actionMsg.ok ? 'rgba(63,185,80,.2)' : 'rgba(232,106,101,.2)'}` }}>
                                            {actionMsg.text}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── HISTORIQUE ── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>

                        {/* Stats globales */}
                        <div style={card}>
                            <div style={cardH}>
                                <Activity style={{ width: 12, height: 12, color: '#e86a65' }} />
                                <span style={{ fontWeight: 600, fontSize: '.8rem' }}>Statistiques</span>
                            </div>
                            <div style={{ ...cardB, gap: '.4rem' }}>
                                <Row label={t('fail2ban.labels.totalBans')}>
                                    <strong style={{ color: bans.length >= 5 ? '#e86a65' : bans.length >= 2 ? '#e3b341' : '#58a6ff', fontSize: '.95rem' }}>
                                        {bans.length}
                                    </strong>
                                    {unbans.length > 0 && (
                                        <span style={{ color: '#3fb950', fontSize: '.72rem', marginLeft: '.4rem' }}>
                                            · {unbans.length} déban{unbans.length > 1 ? 's' : ''}
                                        </span>
                                    )}
                                    <span style={{ color: '#8b949e', fontSize: '.7rem', marginLeft: '.3rem' }}>
                                        ({history.length} évts)
                                    </span>
                                </Row>
                                {freqLabel && (
                                    <Row label="Fréquence">
                                        <span style={{ color: '#e3b341', fontFamily: 'monospace', fontSize: '.77rem' }}>
                                            {freqLabel} entre bans
                                        </span>
                                    </Row>
                                )}
                                {lastBan && (
                                    <Row label={t('fail2ban.labels.lastBan')}>
                                        <span style={{ fontFamily: 'monospace', fontSize: '.73rem', color: dateColor(lastBan.timeofban) }}>
                                            {fmtDate(lastBan.timeofban)}
                                        </span>
                                    </Row>
                                )}
                                {firstBan && (
                                    <Row label={t('fail2ban.labels.firstBan')}>
                                        <span style={{ fontFamily: 'monospace', fontSize: '.73rem', color: '#8b949e' }}>
                                            {fmtDate(firstBan.timeofban)}
                                        </span>
                                    </Row>
                                )}
                                {(lastBan?.failures ?? 0) > 0 && (
                                    <Row label={t('fail2ban.labels.attempts')}>
                                        <strong style={{ color: '#e3b341' }}>{lastBan!.failures}</strong>
                                        <span style={{ color: '#8b949e', fontSize: '.7rem', marginLeft: '.2rem' }}>(dernier ban)</span>
                                    </Row>
                                )}
                            </div>
                        </div>

                        {/* Jails déclencheurs + Types d'attaque — même ligne */}
                        {(jailEntries.length > 0 || categories.length > 0) && (
                            <div style={{ display: 'flex', gap: '.75rem', alignItems: 'stretch' }}>
                                {jailEntries.length > 0 && (
                                    <div style={{ ...card, flex: 1, minWidth: 0 }}>
                                        <div style={cardH}>
                                            <Shield style={{ width: 12, height: 12, color: '#58a6ff' }} />
                                            <span style={{ fontWeight: 600, fontSize: '.8rem' }}>Jails déclencheurs</span>
                                            <span style={{ marginLeft: 'auto', fontSize: '.68rem', color: '#8b949e' }}>
                                                {jailEntries.length} jail{jailEntries.length > 1 ? 's' : ''}
                                            </span>
                                        </div>
                                        <div style={{ padding: '.65rem 1rem', display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                                            {jailEntries.map(([jail, count]) => {
                                                const pct = Math.round(count / bans.length * 100);
                                                return (
                                                    <div key={jail}>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.2rem' }}>
                                                            <JailPill jail={jail} />
                                                            <span style={{ fontSize: '.7rem', color: '#58a6ff', fontWeight: 600 }}>
                                                                {count}× <span style={{ color: '#8b949e', fontWeight: 400 }}>({pct}%)</span>
                                                            </span>
                                                        </div>
                                                        <div style={{ background: '#2d333b', borderRadius: 3, height: 3, overflow: 'hidden' }}>
                                                            <div style={{ width: `${pct}%`, height: '100%', background: '#58a6ff', borderRadius: 3 }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                {categories.length > 0 && (
                                    <div style={{ ...card, flex: 1, minWidth: 0 }}>
                                        <div style={cardH}>
                                            <AlertTriangle style={{ width: 12, height: 12, color: '#e3b341' }} />
                                            <span style={{ fontWeight: 600, fontSize: '.8rem' }}>Types d'attaque</span>
                                        </div>
                                        <div style={{ padding: '.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                                            {categories.map(([cat, count]) => {
                                                const pct = Math.round(count / bans.length * 100);
                                                return (
                                                    <div key={cat}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.2rem' }}>
                                                            <span style={{ fontSize: '.74rem', color: '#e6edf3' }}>{t(cat)}</span>
                                                            <span style={{ fontSize: '.7rem', color: '#e3b341', fontWeight: 600 }}>
                                                                {count}× <span style={{ color: '#8b949e', fontWeight: 400 }}>({pct}%)</span>
                                                            </span>
                                                        </div>
                                                        <div style={{ background: '#2d333b', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                                                            <div style={{ width: `${pct}%`, height: '100%', background: '#e3b341', borderRadius: 3 }} />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>}

                {/* ── Timeline bans — fail2ban only ── */}
                {f2bAvailable && <div style={{ padding: '1rem 1.75rem 0', flexShrink: 0 }}>
                    <div style={{ border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ padding: '.5rem 1rem', background: '#161b22', borderBottom: '1px solid #30363d',
                            fontSize: '.72rem', color: '#8b949e', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                            <Clock style={{ width: 11, height: 11 }} />
                            <span style={{ fontWeight: 600, color: '#e6edf3' }}>Timeline des bans</span>
                            <span style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 3,
                                padding: '0 .35rem', color: '#e6edf3', fontWeight: 600 }}>
                                {history.length}
                            </span>
                            {history.length >= 250 && (
                                <span style={{ color: '#e3b341' }}>· limité à 250 évènements</span>
                            )}
                        </div>
                        {loading ? (
                            <div style={{ textAlign: 'center', padding: '2rem', color: '#8b949e', fontSize: '.85rem' }}>{t('common.loading')}</div>
                        ) : history.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '2rem', color: '#3fb950', fontSize: '.85rem' }}>
                                Aucun historique interne trouvé
                            </div>
                        ) : (
                            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ position: 'sticky', top: 0, background: '#161b22', zIndex: 1 }}>
                                            {[t('fail2ban.labels.date'), t('fail2ban.labels.type'), t('fail2ban.labels.jail'), t('fail2ban.labels.duration'), t('fail2ban.labels.attempts')].map(h => (
                                                <th key={h} style={{ padding: '.4rem .85rem', borderBottom: '1px solid #30363d',
                                                    fontSize: '.67rem', fontWeight: 700, textTransform: 'uppercase',
                                                    letterSpacing: '.05em', color: '#8b949e', textAlign: 'left', whiteSpace: 'nowrap' }}>
                                                    {h}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.map((h, i) => {
                                            const isBan = (h.bantime ?? 0) > 0;
                                            const age = Date.now() / 1000 - h.timeofban;
                                            const ageLabel = age < 3600 ? `${Math.round(age / 60)}m`
                                                : age < 86400 ? `${Math.round(age / 3600)}h`
                                                : `${Math.round(age / 86400)}j`;
                                            const ageColor = dateColor(h.timeofban);
                                            return (
                                                <tr key={i} style={{ borderBottom: '1px solid rgba(48,54,61,.5)' }}
                                                    onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                                    onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'transparent'}>
                                                    <td style={{ padding: '.45rem .85rem', whiteSpace: 'nowrap' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                                            <span style={{ padding: '.05rem .35rem', borderRadius: 3, fontSize: '.66rem', fontWeight: 700,
                                                                background: ageColor + '20', color: ageColor,
                                                                border: `1px solid ${ageColor}55`, flexShrink: 0 }}>
                                                                {ageLabel}
                                                            </span>
                                                            <span style={{ color: '#8b949e', fontFamily: 'monospace', fontSize: '.72rem' }}>
                                                                {fmtDate(h.timeofban)}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '.45rem .85rem' }}>
                                                        <span style={{ padding: '.07rem .4rem', borderRadius: 4, fontSize: '.69rem', fontWeight: 700,
                                                            background: isBan ? 'rgba(232,106,101,.15)' : 'rgba(63,185,80,.12)',
                                                            color: isBan ? '#e86a65' : '#3fb950',
                                                            border: `1px solid ${isBan ? 'rgba(232,106,101,.3)' : 'rgba(63,185,80,.25)'}`}}>
                                                            {isBan ? '⚖ Ban' : '✓ Unban'}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '.45rem .85rem' }}><JailPill jail={h.jail} /></td>
                                                    <td style={{ padding: '.45rem .85rem', fontSize: '.76rem', color: '#58a6ff', fontFamily: 'monospace' }}>
                                                        {fmtBantime(h.bantime)}
                                                    </td>
                                                    <td style={{ padding: '.45rem .85rem', fontSize: '.76rem', color: '#e3b341', fontWeight: 600 }}>
                                                        {h.failures ?? '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>}

                {/* ── Activité dans les logs source — fail2ban only ── */}
                {f2bAvailable && logEntries.length > 0 && (
                    <div style={{ padding: '1.25rem 1.75rem 1.25rem', flexShrink: 0 }}>
                    <div style={{ border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden' }}>
                        <button onClick={() => setLogsOpen(o => !o)}
                            style={{ width: '100%', background: '#161b22', border: 'none', cursor: 'pointer',
                                padding: '.5rem 1rem', display: 'flex', alignItems: 'center', gap: '.45rem',
                                color: '#e3b341', fontSize: '.77rem', textAlign: 'left',
                                borderBottom: logsOpen ? '1px solid #30363d' : 'none' }}>
                            <FileText style={{ width: 12, height: 12, flexShrink: 0 }} />
                            <strong>Activité dans les logs source</strong>
                            <span style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: 3,
                                padding: '0 .35rem', color: '#e6edf3', fontWeight: 600, fontSize: '.7rem' }}>
                                {totalLogLines} lignes
                            </span>
                            <span style={{ color: '#8b949e', fontSize: '.7rem' }}>
                                ({logEntries.length} fichier{logEntries.length > 1 ? 's' : ''})
                            </span>
                            <span style={{ marginLeft: 'auto', color: '#8b949e', fontSize: '.8rem' }}>
                                {logsOpen ? '▲' : '▼'}
                            </span>
                        </button>
                        {logsOpen && (
                            <div style={{ padding: '.65rem 1rem', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                                {logEntries.map((entry, idx) => {
                                    const typeBadgeColor = entry.type === 'access' ? '#3fb950'
                                        : entry.type === 'error' ? '#e86a65' : '#8b949e';
                                    const fname = entry.filepath.split('/').pop() ?? entry.filepath;
                                    const paths = entry.type === 'access' ? extractPaths(entry.lines) : [];
                                    const isExpanded = expandedLogs.has(idx);
                                    const visibleLines = isExpanded ? entry.lines : entry.lines.slice(0, LOG_LINES_DEFAULT);
                                    const hasMore = entry.lines.length > LOG_LINES_DEFAULT;
                                    return (
                                        <div key={idx}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', marginBottom: '.2rem', flexWrap: 'wrap' }}>
                                                <ServiceIcon filepath={entry.filepath} />
                                                {entry.domain ? (
                                                    <>
                                                        <DomainInitial domain={entry.domain} />
                                                        <span style={{ fontWeight: 700, fontSize: '.8rem', color: '#e6edf3' }}>
                                                            {entry.domain}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span style={{ fontFamily: 'monospace', fontSize: '.75rem', color: '#8b949e' }}>
                                                        {fname}
                                                    </span>
                                                )}
                                                <span style={{ padding: '0 .35rem', borderRadius: 3, fontSize: '.65rem',
                                                    fontWeight: 700, background: typeBadgeColor + '22', color: typeBadgeColor,
                                                    border: `1px solid ${typeBadgeColor}55` }}>
                                                    {entry.type}
                                                </span>
                                                <span style={{ fontSize: '.7rem', color: '#8b949e' }}>
                                                    {entry.lines.length} ligne{entry.lines.length > 1 ? 's' : ''}
                                                </span>
                                                {entry.domain && (
                                                    <span style={{ fontFamily: 'monospace', fontSize: '.65rem', color: '#555d69' }}>
                                                        {entry.filepath}
                                                    </span>
                                                )}
                                            </div>
                                            {paths.length > 0 && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', marginBottom: '.3rem', flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: '.64rem', color: '#8b949e', flexShrink: 0 }}>chemins :</span>
                                                    {paths.map((p, pi) => (
                                                        <span key={pi} style={{ fontFamily: 'monospace', fontSize: '.67rem',
                                                            background: 'rgba(88,166,255,.08)', border: '1px solid rgba(88,166,255,.2)',
                                                            color: '#58a6ff', borderRadius: 3, padding: '0 .35rem',
                                                            maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                            display: 'inline-block' }} title={p}>
                                                            {p}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            <pre style={{ margin: 0, padding: '.5rem .75rem', background: '#0d1117',
                                                border: '1px solid #30363d', borderRadius: 5, overflow: 'auto',
                                                fontSize: '.7rem', lineHeight: 1.6, color: '#c9d1d9',
                                                fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                                {visibleLines.map((line, i) => (
                                                    <div key={i}><ColorizedLine line={line} logType={entry.type as LogType} /></div>
                                                ))}
                                            </pre>
                                            {hasMore && (
                                                <button onClick={() => setExpandedLogs(prev => {
                                                    const next = new Set(prev);
                                                    isExpanded ? next.delete(idx) : next.add(idx);
                                                    return next;
                                                })} style={{
                                                    marginTop: '.35rem', background: isExpanded ? 'rgba(88,166,255,.06)' : 'rgba(88,166,255,.08)',
                                                    border: '1px solid rgba(88,166,255,.25)', borderRadius: 5,
                                                    color: '#58a6ff', cursor: 'pointer', fontSize: '.71rem', fontWeight: 600,
                                                    padding: '.3rem .8rem', display: 'inline-flex', alignItems: 'center', gap: '.35rem',
                                                    transition: 'background .15s',
                                                }}>
                                                    {isExpanded
                                                        ? <>▲ Réduire</>
                                                        : <>▼ Voir tout <span style={{ color: '#8b949e', fontWeight: 400 }}>({entry.lines.length - LOG_LINES_DEFAULT} lignes)</span></>}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    </div>
                )}

                {/* ── Footer ── */}
                <div style={{ padding: '.4rem 1rem', borderTop: '1px solid #30363d',
                    fontSize: '.68rem', color: '#8b949e', textAlign: 'right', flexShrink: 0,
                    borderRadius: '0 0 10px 10px', background: '#161b22' }}>
                    {f2bAvailable
                        ? 'Historique long terme · base interne conservée au-delà du dbpurge'
                        : t('logViewer.ipModal.footer')}
                </div>
            </div>
        </div>
    );
};
