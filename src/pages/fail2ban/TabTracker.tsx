import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { card, cardH, F2bTooltip } from './helpers';
import { List, Shield } from 'lucide-react';
import type { TrackerEntry } from './types';
import { GeoInfo } from './types';
import { FlagImg } from './FlagImg';

// ── Module-level cache (survives tab navigation) ──────────────────────────────
const _cache: Record<string, { data: unknown; ts: number }> = {};
const CACHE_TTL = 30_000;
function getCached<T>(key: string): T | null { const e = _cache[key]; return (e && Date.now() - e.ts < CACHE_TTL) ? e.data as T : null; }
function setCached(key: string, data: unknown) { _cache[key] = { data, ts: Date.now() }; }

type SortCol = 'ip' | 'bans' | 'unbans' | 'failures' | 'jails' | 'last';
type SortDir = 'asc' | 'desc';


// ── "Dernier vu" badge ─────────────────────────────────────────────────────────

const LastSeenBadge: React.FC<{ ts: number }> = ({ ts }) => {
    const hoursAgo = (Date.now() / 1000 - ts) / 3600;
    const [tColor, tBg, tBorder] =
        hoursAgo < 1   ? ['#e86a65', 'rgba(232,106,101,.15)', 'rgba(232,106,101,.4)']  :
        hoursAgo < 6   ? ['#e3b341', 'rgba(227,179,65,.12)',  'rgba(227,179,65,.35)']  :
        hoursAgo < 24  ? ['#58a6ff', 'rgba(88,166,255,.12)',  'rgba(88,166,255,.35)']  :
                         ['#8b949e', 'rgba(139,148,158,.08)', 'rgba(139,148,158,.2)'];
    const d = new Date(ts * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const shortDate = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
    const time      = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return (
        <span title={d.toLocaleString('fr-FR')} style={{ whiteSpace: 'nowrap' }}>
            <span style={{ color: '#8b949e', fontSize: '.68rem', marginRight: '.3rem' }}>{shortDate}</span>
            <span style={{ display: 'inline-block', padding: '.05rem .35rem', borderRadius: 4, fontSize: '.72rem', fontWeight: 600, background: tBg, color: tColor, border: `1px solid ${tBorder}` }}>{time}</span>
        </span>
    );
};

// ── Sortable column header ─────────────────────────────────────────────────────

const SortTh: React.FC<{
    col: SortCol; sortCol: SortCol; sortDir: SortDir;
    onSort: (c: SortCol) => void; style?: React.CSSProperties; children: React.ReactNode;
}> = ({ col, sortCol, sortDir, onSort, style, children }) => (
    <th onClick={() => onSort(col)} style={{ cursor: 'pointer', userSelect: 'none', ...style }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem' }}>
            {children}
            <span style={{ color: sortCol === col ? '#58a6ff' : '#8b949e', opacity: sortCol === col ? 1 : .4, fontSize: '.75rem' }}>
                {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
        </span>
    </th>
);

// ── Main component ─────────────────────────────────────────────────────────────

export const TabTracker: React.FC<{ onIpClick?: (ip: string) => void; onTotalChange?: (n: number) => void; initialFilter?: string }> = ({ onIpClick, onTotalChange, initialFilter }) => {
    const { t } = useTranslation();
    const [ips, setIps]         = useState<TrackerEntry[]>([]);
    const [total, setTotal]     = useState(0);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter]   = useState(initialFilter ?? '');
    const [perPage, setPerPage] = useState(32);
    const [page, setPage]       = useState(1);
    const [sortCol, setSortCol] = useState<SortCol>('last');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [viewMode, setViewMode] = useState<'active' | 'history'>('active');

    // Geo cache: ip → GeoInfo (or null on error)
    const geoCache = useRef<Map<string, GeoInfo | null>>(new Map());
    const [geoData, setGeoData] = useState<Map<string, GeoInfo | null>>(new Map());
    const [geoLoading, setGeoLoading] = useState<Set<string>>(new Set());

    // Hostname cache: ip → hostname (or '' if none)
    const hostnameCache = useRef<Map<string, string>>(new Map());
    const [hostnameData, setHostnameData] = useState<Map<string, string>>(new Map());

    // IPSet membership: ip → set names[]
    const [ipsetMembership, setIpsetMembership] = useState<Map<string, string[]>>(new Map());

    // Sync status banner
    interface SyncStatus { internalEvents: number; f2bTotalBans: number | null; synced: boolean | null; lastSyncAt: string | null }
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
    useEffect(() => {
        const cached = getCached<SyncStatus>('tracker:sync');
        if (cached) setSyncStatus(cached);
        api.get<SyncStatus & { ok: boolean }>('/api/plugins/fail2ban/sync-state').then(res => {
            if (res.success && res.result?.ok) { setCached('tracker:sync', res.result); setSyncStatus(res.result); }
        });
    }, []);

    // Load all ipset entries on mount and build ip → sets map
    useEffect(() => {
        type IpsetRow = { name: string; entries: string[] }[];
        const buildMap = (rows: IpsetRow) => {
            const map = new Map<string, string[]>();
            for (const { name, entries } of rows) {
                for (const entry of entries) {
                    const ip = entry.replace(/\/\d+$/, '');
                    if (!map.has(ip)) map.set(ip, []);
                    map.get(ip)!.push(name);
                }
            }
            return map;
        };
        const cached = getCached<IpsetRow>('tracker:ipsets');
        if (cached) { setIpsetMembership(buildMap(cached)); }
        api.get<{ ok: boolean; sets: { name: string; entries: number }[] }>('/api/plugins/fail2ban/ipset/sets')
            .then(res => {
                if (!res.success || !res.result?.ok) return;
                const sets = (res.result.sets ?? []).filter(s => s.entries > 0);
                Promise.all(sets.map(s =>
                    api.get<{ ok: boolean; entries: string[] }>(`/api/plugins/fail2ban/ipset/entries/${encodeURIComponent(s.name)}`)
                        .then(r => ({ name: s.name, entries: r.result?.entries ?? [] as string[] }))
                        .catch(() => ({ name: s.name, entries: [] as string[] }))
                )).then(rows => {
                    setCached('tracker:ipsets', rows);
                    setIpsetMembership(buildMap(rows));
                });
            })
            .catch(() => {});
    }, []);

    const [dataLoaded, setDataLoaded] = useState(false);

    const fetchData = useCallback(() => {
        type TrackerResult = { ok: boolean; total: number; ips: TrackerEntry[] };
        const cached = getCached<TrackerResult>('tracker:ips');
        if (cached) { setIps(cached.ips); setTotal(cached.total); onTotalChange?.(cached.total); setDataLoaded(true); setLoading(false); }
        else setLoading(true);
        api.get<TrackerResult>('/api/plugins/fail2ban/tracker')
            .then(res => {
                if (res.success && res.result?.ok) {
                    setCached('tracker:ips', res.result);
                    setIps(res.result.ips);
                    setTotal(res.result.total);
                    onTotalChange?.(res.result.total);
                    setDataLoaded(true);
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [onTotalChange]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const fetchHostnames = useCallback((ipList: string[]) => {
        const toFetch = ipList.filter(ip => !hostnameCache.current.has(ip));
        if (!toFetch.length) return;
        for (const ip of toFetch) hostnameCache.current.set(ip, ''); // mark in-flight
        for (let i = 0; i < toFetch.length; i += 50) {
            const batch = toFetch.slice(i, i + 50);
            api.get<Record<string, string>>(`/api/plugins/fail2ban/dns/batch?ips=${batch.join(',')}`)
                .then(res => {
                    if (res.success && res.result) {
                        setHostnameData(prev => {
                            const next = new Map(prev);
                            for (const [ip, h] of Object.entries(res.result as Record<string, string>)) {
                                hostnameCache.current.set(ip, h);
                                if (h) next.set(ip, h);
                            }
                            return next;
                        });
                    }
                })
                .catch(() => {
                    for (const ip of batch) hostnameCache.current.delete(ip);
                });
        }
    }, []);

    const fetchGeo = useCallback((ip: string) => {
        if (geoCache.current.has(ip)) return;
        // Mark as in-flight immediately (prevents duplicate requests)
        geoCache.current.set(ip, undefined as any);
        setGeoLoading(prev => new Set([...prev, ip]));
        api.get<{ ok: boolean; geo: GeoInfo }>(`/api/plugins/fail2ban/geo/${encodeURIComponent(ip)}`)
            .then(res => {
                const info = res.success && res.result?.ok ? res.result.geo : null;
                geoCache.current.set(ip, info);
                setGeoData(prev => new Map([...prev, [ip, info]]));
            })
            .catch(() => {
                // Network error (server not ready yet) — remove from cache so it can be retried
                geoCache.current.delete(ip);
            })
            .finally(() => {
                setGeoLoading(prev => { const s = new Set(prev); s.delete(ip); return s; });
            });
    }, []);

    const handleSort = useCallback((col: SortCol) => {
        setSortCol(prev => {
            if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return col; }
            setSortDir('desc');
            return col;
        });
    }, []);

    const activeCount  = useMemo(() => ips.filter(e => e.currentlyBanned).length, [ips]);
    const historyCount = total;

    const filtered = useMemo(() => {
        const base = viewMode === 'active' ? ips.filter(e => e.currentlyBanned) : ips;
        const q = filter.trim().toLowerCase();
        return q ? base.filter(e =>
            e.ip.includes(q) ||
            e.jails.some(j => j.includes(q)) ||
            (e.hostname ?? '').toLowerCase().includes(q) ||
            (geoData.get(e.ip)?.country ?? '').toLowerCase().includes(q) ||
            (geoData.get(e.ip)?.city ?? '').toLowerCase().includes(q)
        ) : base;
    }, [ips, filter, geoData, viewMode]);

    const sorted = useMemo(() => {
        return [...filtered].sort((a, b) => {
            let va: number | string, vb: number | string;
            switch (sortCol) {
                case 'ip':
                    va = a.ip.split('.').reduce((acc, n) => acc * 256 + parseInt(n, 10), 0);
                    vb = b.ip.split('.').reduce((acc, n) => acc * 256 + parseInt(n, 10), 0);
                    break;
                case 'bans':     va = a.bans ?? 0;     vb = b.bans ?? 0;     break;
                case 'unbans':   va = a.unbans ?? 0;   vb = b.unbans ?? 0;   break;
                case 'failures': va = a.failures ?? 0; vb = b.failures ?? 0; break;
                case 'jails':    va = a.jails.length;  vb = b.jails.length;  break;
                case 'last':     va = a.lastSeen ?? 0; vb = b.lastSeen ?? 0; break;
                default:         va = 0; vb = 0;
            }
            const cmp = typeof va === 'number' ? (va - vb) : String(va).localeCompare(String(vb));
            return sortDir === 'asc' ? cmp : -cmp;
        });
    }, [filtered, sortCol, sortDir]);

    const totalPages  = perPage === 0 ? 1 : Math.ceil(sorted.length / perPage);
    const currentPage = Math.min(page, Math.max(1, totalPages));
    const paginated   = perPage === 0 ? sorted : sorted.slice((currentPage - 1) * perPage, currentPage * perPage);

    // Auto-fetch geo + hostnames for visible rows — only after tracker data has loaded successfully at least once
    useEffect(() => {
        if (!dataLoaded) return;
        for (const e of paginated) fetchGeo(e.ip);
        fetchHostnames(paginated.map(e => e.ip));
    }, [paginated, fetchGeo, fetchHostnames, dataLoaded]);

    const ppBtn = (pp: number, label: string) => (
        <button key={pp} onClick={() => { setPerPage(pp); setPage(1); }}
            style={{ padding: '.1rem .4rem', fontSize: '.68rem', borderRadius: 4, background: perPage === pp ? 'rgba(88,166,255,.15)' : 'transparent', border: `1px solid ${perPage === pp ? 'rgba(88,166,255,.4)' : '#30363d'}`, color: perPage === pp ? '#58a6ff' : '#8b949e', cursor: 'pointer' }}>
            {label}
        </button>
    );

    const thStyle: React.CSSProperties = { padding: '.4rem .65rem', borderBottom: '1px solid #30363d', fontSize: '.67rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8b949e', textAlign: 'left', whiteSpace: 'nowrap' };

    return (
        <>
        <div style={card}>
            {/* ── Top bar ── */}
            <div style={{ ...cardH, flexWrap: 'wrap', gap: '.5rem', alignItems: 'center' }}>
                {/* Title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontWeight: 600, fontSize: '.9rem', flexShrink: 0 }}>
                    <List style={{ width: 14, height: 14, color: '#e3b341' }} />
                    <strong style={{ color: viewMode === 'active' ? '#e86a65' : '#58a6ff', minWidth: '2.5em', display: 'inline-block', textAlign: 'right' }}>{viewMode === 'active' ? activeCount : historyCount}</strong>
                    <span style={{ color: '#e6edf3' }}>IPs</span>
                </div>
                {/* View mode toggle — fixed-width buttons to prevent layout shift */}
                <div style={{ display: 'flex', flexShrink: 0, borderRadius: 5, border: '1px solid #30363d', overflow: 'hidden' }}>
                    {([['active', t('fail2ban.status.bansActive'), activeCount, '#e86a65', 'rgba(232,106,101,.15)', 'rgba(232,106,101,.2)'], ['history', t('fail2ban.tracker.banHistory'), historyCount, '#58a6ff', 'rgba(88,166,255,.1)', 'rgba(88,166,255,.18)']] as const).map(([mode, label, count, col, bg, countBg]) => (
                        <button key={mode} onClick={() => { setViewMode(mode); setPage(1); }}
                            style={{
                                width: 118, padding: '.2rem .65rem', fontSize: '.72rem', fontWeight: 600, cursor: 'pointer',
                                background: viewMode === mode ? bg : 'transparent',
                                color: viewMode === mode ? col : '#8b949e',
                                border: 'none', borderRight: mode === 'active' ? '1px solid #30363d' : 'none',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.3rem',
                                whiteSpace: 'nowrap',
                            }}>
                            {label}
                            <span style={{ minWidth: '2em', textAlign: 'center', padding: '.0rem .3rem', borderRadius: 3, fontSize: '.65rem', background: viewMode === mode ? countBg : 'rgba(48,54,61,.5)', color: viewMode === mode ? col : '#8b949e', fontWeight: 700 }}>{count}</span>
                        </button>
                    ))}
                </div>
                {/* Search — centré */}
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ position: 'relative', width: 220 }}>
                        <span style={{ position: 'absolute', left: '.6rem', top: '50%', transform: 'translateY(-50%)', color: '#8b949e', fontSize: '.72rem', pointerEvents: 'none' }}>🔍</span>
                        <input type="search" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}
                            placeholder={t('fail2ban.placeholders.filterIps')}
                            style={{ width: '100%', padding: '.38rem .75rem .38rem 1.8rem', fontSize: '.82rem', background: '#161b22', border: '1px solid #30363d', borderBottom: '1px solid #555', borderRadius: 6, color: '#e6edf3', outline: 'none', boxSizing: 'border-box', boxShadow: 'inset 0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(0,0,0,.4), inset 0 -1px 0 rgba(255,255,255,.04)' }} />
                    </div>
                </div>
                {/* Pagination + per-page */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginLeft: 'auto', flexWrap: 'wrap' }}>
                    {totalPages > 1 && (
                        <div style={{ display: 'flex', gap: '.2rem' }}>
                            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                                style={{ padding: '.15rem .4rem', fontSize: '.72rem', borderRadius: 4, background: 'transparent', border: '1px solid #30363d', color: '#8b949e', cursor: currentPage <= 1 ? 'default' : 'pointer', opacity: currentPage <= 1 ? .4 : 1 }}>‹</button>
                            <span style={{ padding: '.15rem .5rem', fontSize: '.72rem', color: '#8b949e' }}>{currentPage}/{totalPages}</span>
                            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                                style={{ padding: '.15rem .4rem', fontSize: '.72rem', borderRadius: 4, background: 'transparent', border: '1px solid #30363d', color: '#8b949e', cursor: currentPage >= totalPages ? 'default' : 'pointer', opacity: currentPage >= totalPages ? .4 : 1 }}>›</button>
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: '.2rem' }}>
                        {[16, 32, 50, 100].map(pp => ppBtn(pp, String(pp)))}
                        {ppBtn(0, t('fail2ban.periods.allShort'))}
                    </div>
                </div>
            </div>

            {/* ── Sync status banner ── */}
            {syncStatus && syncStatus.synced === false && syncStatus.f2bTotalBans !== null && (
                <div style={{ padding: '.45rem 1rem', background: 'rgba(227,179,65,.07)', borderBottom: '1px solid rgba(227,179,65,.2)', display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.78rem' }}>
                    <span style={{ color: '#e3b341', fontWeight: 700 }}>⟳ Import en cours…</span>
                    <span style={{ color: '#8b949e' }}>
                        {syncStatus.internalEvents.toLocaleString()} / {syncStatus.f2bTotalBans.toLocaleString()} événements importés
                    </span>
                    <span style={{ color: '#8b949e', fontSize: '.72rem', marginLeft: '.5rem' }}>
                        — les données affichées sont partielles, rafraîchissez dans quelques secondes
                    </span>
                </div>
            )}

            {/* ── Table ── */}
            {loading
                ? <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e' }}>{t('common.loading')}</div>
                : filtered.length === 0
                ? <div style={{ textAlign: 'center', padding: '3rem', color: viewMode === 'active' ? '#3fb950' : '#8b949e' }}>
                    {viewMode === 'active' ? '✓ Aucune IP actuellement bannie' : 'Aucune IP dans l\'historique'}
                  </div>
                : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 750 }}>
                            <thead>
                                <tr>
                                    <th style={{ ...thStyle, width: 32 }}>#</th>
                                    <SortTh col="last" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={{ ...thStyle, width: 110 }}>Dernier vu</SortTh>
                                    <SortTh col="ip"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={{ ...thStyle, width: 130 }}>IP</SortTh>
                                    <th style={{ ...thStyle, width: 46 }}>{t('fail2ban.labels.country')}</th>
                                    <th style={{ ...thStyle, width: 100 }}>{t('fail2ban.labels.city')}</th>
                                    <SortTh col="failures" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={{ ...thStyle, width: 80, textAlign: 'center' }}>{t('fail2ban.labels.attempts')}</SortTh>
                                    <SortTh col="bans"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={{ ...thStyle, width: 60, textAlign: 'center' }}><span style={{ color: '#e86a65' }}>Bans</span></SortTh>
                                    <SortTh col="unbans" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={{ ...thStyle, width: 60, textAlign: 'center' }}><span style={{ color: '#3fb950' }}>Débans</span></SortTh>
                                    <SortTh col="jails"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={{ ...thStyle, width: 320, paddingLeft: '1.2rem', borderLeft: '1px solid #30363d' }}>Jail(s)</SortTh>
                                    <th style={{ ...thStyle, width: 180 }}>IPSet(s)</th>
                                    <th style={thStyle}>Hostname</th>
                                </tr>
                            </thead>
                            <tbody>
                                {paginated.map((e, idx) => {
                                    const globalIdx  = perPage === 0 ? idx + 1 : (currentPage - 1) * perPage + idx + 1;
                                    const inRecidive = e.jails.includes('recidive');
                                    const geo        = geoData.get(e.ip);
                                    const geoFetched = geoCache.current.has(e.ip);
                                    const geoFetching = geoLoading.has(e.ip);
                                    const hostname   = hostnameData.get(e.ip) ?? e.hostname;
                                    const ipsets     = ipsetMembership.size > 0 ? (ipsetMembership.get(e.ip) ?? []) : (e.ipsets ?? []);
                                    return (
                                        <tr key={e.ip} style={{ borderBottom: '1px solid rgba(48,54,61,.6)' }}
                                            onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                            onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'transparent'}>
                                            <td style={{ padding: '.4rem .65rem', fontSize: '.75rem', color: '#8b949e' }}>{globalIdx}</td>
                                            <td style={{ padding: '.4rem .65rem', fontSize: '.75rem' }}>
                                                {e.lastSeen ? <LastSeenBadge ts={e.lastSeen} /> : <span style={{ color: '#8b949e' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '.4rem .65rem', whiteSpace: 'nowrap' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                                                    {inRecidive && (
                                                        <F2bTooltip title="IP récidiviste" color="orange" placement="bottom"
                                                            bodyNode={<div style={{ fontSize: '.78rem', lineHeight: 1.6 }}>
                                                                <div>Cette IP a été bannie <strong style={{ color: '#e3b341' }}>plusieurs fois</strong> et a déclenché le jail <span style={{ fontFamily: 'monospace', color: '#e86a65' }}>recidive</span>.</div>
                                                                <div style={{ color: '#8b949e', fontSize: '.72rem', marginTop: '.25rem' }}>Le jail recidive applique une durée de ban prolongée aux multi-récidivistes.</div>
                                                            </div>}>
                                                            <span style={{ color: '#e3b341', fontSize: '.72rem', cursor: 'default' }}>⚠</span>
                                                        </F2bTooltip>
                                                    )}
                                                    <button onClick={() => onIpClick?.(e.ip)}
                                                        title="Voir historique détaillé"
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: '.85rem', color: '#e6edf3', fontWeight: 600 }}>
                                                        {e.ip}
                                                    </button>
                                                    {e.currentlyBanned && (
                                                        <F2bTooltip title="IP actuellement bannie" color="red" placement="bottom"
                                                            bodyNode={<div style={{ fontSize: '.78rem', lineHeight: 1.6 }}>
                                                                <div>Cette IP est <strong style={{ color: '#e86a65' }}>activement bannie</strong> par fail2ban en ce moment.</div>
                                                                <div style={{ color: '#8b949e', fontSize: '.72rem', marginTop: '.25rem' }}>Source : <span style={{ fontFamily: 'monospace' }}>fail2ban-client status</span> → Currently banned.</div>
                                                                <div style={{ color: '#8b949e', fontSize: '.72rem' }}>Le bantime n'est pas encore expiré — tout paquet entrant de cette IP est rejeté.</div>
                                                                {e.jails.length > 0 && <div style={{ marginTop: '.35rem' }}>
                                                                    <div style={{ color: '#8b949e', fontSize: '.68rem', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.2rem' }}>Jail(s) actif(s)</div>
                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem' }}>
                                                                        {e.jails.map(j => <span key={j} style={{ fontFamily: 'monospace', fontSize: '.78rem', color: j === 'recidive' ? '#e86a65' : '#3fb950' }}>{j}</span>)}
                                                                    </div>
                                                                </div>}
                                                            </div>}>
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '.05rem .3rem', borderRadius: 3, fontSize: '.6rem', fontWeight: 700, background: 'rgba(232,106,101,.15)', color: '#e86a65', border: '1px solid rgba(232,106,101,.3)', letterSpacing: '.03em', cursor: 'default' }}>
                                                                <Shield style={{ width: 8, height: 8, marginRight: 2 }} />BANNI
                                                            </span>
                                                        </F2bTooltip>
                                                    )}
                                                </div>
                                            </td>
                                            {/* Pays */}
                                            <td style={{ padding: '.35rem .65rem', whiteSpace: 'nowrap' }}>
                                                {geoFetched && geo
                                                    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
                                                        <FlagImg code={geo.countryCode} size={14} />
                                                        <span style={{ fontSize: '.75rem', color: '#e6edf3' }}>{geo.countryCode || '—'}</span>
                                                      </span>
                                                    : geoFetching
                                                    ? <span style={{ color: '#8b949e', fontSize: '.72rem' }}>…</span>
                                                    : <span style={{ color: '#8b949e', fontSize: '.75rem' }}>—</span>
                                                }
                                            </td>
                                            {/* Géoloc */}
                                            <td style={{ padding: '.35rem .65rem', whiteSpace: 'nowrap' }}>
                                                {geoFetched && geo
                                                    ? (
                                                        <span title={geo.org} style={{ fontSize: '.78rem' }}>
                                                            <span style={{ color: '#e6edf3' }}>{geo.city || '—'}</span>
                                                        </span>
                                                    )
                                                    : geoFetching
                                                    ? <span style={{ color: '#8b949e', fontSize: '.72rem' }}>…</span>
                                                    : <span style={{ color: '#8b949e', fontSize: '.75rem' }}>—</span>
                                                }
                                            </td>
                                            <td style={{ padding: '.4rem .65rem', textAlign: 'center', fontSize: '.78rem' }}>
                                                {e.failures !== undefined ? <span style={{ color: '#e3b341', fontWeight: 700 }}>{e.failures}</span> : <span style={{ color: '#8b949e' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '.4rem .65rem', textAlign: 'center', fontSize: '.78rem' }}>
                                                {e.bans !== undefined
                                                    ? <F2bTooltip title="Compteur de bans" placement="bottom"
                                                        color={e.bans >= 5 ? 'red' : e.bans >= 2 ? 'orange' : 'blue'}
                                                        bodyNode={<div style={{ fontSize: '.78rem', lineHeight: 1.6 }}>
                                                            <div>IP bannie <strong style={{ color: e.bans >= 5 ? '#e86a65' : e.bans >= 2 ? '#e3b341' : '#58a6ff' }}>{e.bans} fois</strong> au total.</div>
                                                            <div style={{ marginTop: '.25rem', fontSize: '.72rem', color: '#8b949e' }}>
                                                                {e.bans >= 5 ? '● Récidiviste dangereux — 5 bans ou plus' : e.bans >= 2 ? '● Menace modérée — 2 à 4 bans' : '● Activité faible — moins de 2 bans'}
                                                            </div>
                                                        </div>}>
                                                        <span style={{ color: e.bans >= 5 ? '#e86a65' : e.bans >= 2 ? '#e3b341' : '#58a6ff', fontWeight: 700, cursor: 'default' }}>{e.bans}</span>
                                                    </F2bTooltip>
                                                    : <span style={{ color: '#8b949e' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '.4rem .65rem', textAlign: 'center', fontSize: '.78rem' }}>
                                                {e.unbans !== undefined ? <span style={{ color: '#3fb950', fontWeight: 600 }}>{e.unbans}</span> : <span style={{ color: '#8b949e' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '.4rem .65rem .4rem 1.2rem', maxWidth: 320, borderLeft: '1px solid rgba(48,54,61,.5)' }}>
                                                {e.jails.length === 0
                                                    ? <span style={{ color: '#8b949e', fontSize: '.75rem' }}>—</span>
                                                    : <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: '.2rem', overflow: 'hidden' }}>
                                                        {e.jails.slice(0, 3).map(j => (
                                                            <F2bTooltip key={j}
                                                                title={j === 'recidive' ? 'Jail récidiviste' : `Jail : ${j}`}
                                                                color={j === 'recidive' ? 'red' : 'green'}
                                                                placement="bottom"
                                                                body={j === 'recidive'
                                                                    ? 'Ce jail cible les IP multi-récidivistes. Fail2ban y place les IP déjà bannies plusieurs fois pour leur appliquer un bantime prolongé.'
                                                                    : `Cette IP a déclenché le filtre du jail « ${j} » et a été bannie.`}>
                                                                <span style={{ whiteSpace: 'nowrap', display: 'inline-block', padding: '.15rem .35rem', borderRadius: 4, fontSize: '.7rem', fontWeight: 600, cursor: 'default', flexShrink: 0, ...(j === 'recidive' ? { background: 'rgba(232,106,101,.08)', color: '#e86a65', border: '1px solid rgba(232,106,101,.2)' } : { background: 'rgba(63,185,80,.1)', color: '#3fb950', border: '1px solid rgba(63,185,80,.25)' }) }}>
                                                                    {j === 'recidive' && <span style={{ color: '#e3b341' }}>⚠ </span>}{j}
                                                                </span>
                                                            </F2bTooltip>
                                                        ))}
                                                        {e.jails.length > 3 && (
                                                            <F2bTooltip
                                                                title={`${e.jails.length} jails`}
                                                                color="muted"
                                                                placement="bottom"
                                                                bodyNode={<div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                                                                    {e.jails.map(j => <span key={j} style={{ fontFamily: 'monospace', fontSize: '.78rem', color: j === 'recidive' ? '#e86a65' : '#3fb950' }}>{j}</span>)}
                                                                </div>}>
                                                                <span style={{ padding: '.15rem .35rem', borderRadius: 4, fontSize: '.68rem', fontWeight: 700, background: 'rgba(139,148,158,.1)', color: '#8b949e', border: '1px solid rgba(139,148,158,.2)', cursor: 'default', flexShrink: 0 }}>+{e.jails.length - 3}</span>
                                                            </F2bTooltip>
                                                        )}
                                                    </div>
                                                }
                                            </td>
                                            <td style={{ padding: '.4rem .65rem', maxWidth: 180 }}>
                                                {ipsets.length === 0
                                                    ? <span style={{ color: '#8b949e', fontSize: '.75rem' }}>—</span>
                                                    : <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: '.2rem', overflow: 'hidden' }}>
                                                        {ipsets.slice(0, 2).map(s => (
                                                            <F2bTooltip key={s}
                                                                title={`IPSet : ${s}`}
                                                                color="purple"
                                                                placement="bottom"
                                                                body={`Cette IP est dans l'ipset kernel « ${s} ». Elle est bloquée au niveau netfilter — avant même d'atteindre les règles iptables.`}>
                                                                <span style={{ whiteSpace: 'nowrap', display: 'inline-block', padding: '.12rem .35rem', borderRadius: 4, fontSize: '.68rem', fontWeight: 600, background: 'rgba(188,140,255,.1)', color: '#bc8cff', border: '1px solid rgba(188,140,255,.25)', fontFamily: 'monospace', cursor: 'default', flexShrink: 0 }}>{s}</span>
                                                            </F2bTooltip>
                                                        ))}
                                                        {ipsets.length > 2 && (
                                                            <F2bTooltip
                                                                title={`${ipsets.length} ipsets`}
                                                                color="purple"
                                                                placement="bottom"
                                                                bodyNode={<div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                                                                    {ipsets.map(s => <span key={s} style={{ fontFamily: 'monospace', fontSize: '.78rem', color: '#bc8cff' }}>{s}</span>)}
                                                                </div>}>
                                                                <span style={{ padding: '.12rem .35rem', borderRadius: 4, fontSize: '.68rem', fontWeight: 700, background: 'rgba(188,140,255,.1)', color: '#bc8cff', border: '1px solid rgba(188,140,255,.2)', cursor: 'default', flexShrink: 0 }}>+{ipsets.length - 2}</span>
                                                            </F2bTooltip>
                                                        )}
                                                    </div>
                                                }
                                            </td>
                                            <td style={{ padding: '.4rem .65rem', fontSize: '.78rem', color: hostname ? '#c9d1d9' : '#8b949e', fontFamily: 'monospace' }}>{hostname ?? '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        {filtered.length > 0 && perPage > 0 && (
                            <div style={{ padding: '.5rem 1rem', fontSize: '.75rem', color: '#8b949e', borderTop: '1px solid #30363d' }}>
                                {filtered.length} IP{filtered.length !== 1 ? 's' : ''} — page {currentPage}/{totalPages}
                            </div>
                        )}
                    </div>
                )}
        </div>

        </>
    );
};
