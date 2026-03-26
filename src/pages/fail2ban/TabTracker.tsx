import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api } from '../../api/client';
import { card, cardH, PERIODS as SHARED_PERIODS, F2bTooltip } from './helpers';
import { List, MapPin } from 'lucide-react';
import type { TrackerEntry } from './types';
import { IpModal, GeoInfo, toFlag } from './IpModal';

type SortCol = 'ip' | 'bans' | 'unbans' | 'failures' | 'jails' | 'last';
type SortDir = 'asc' | 'desc';

const PERIODS = SHARED_PERIODS;


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

export const TabTracker: React.FC = () => {
    const [ips, setIps]         = useState<TrackerEntry[]>([]);
    const [total, setTotal]     = useState(0);
    const [loading, setLoading] = useState(true);
    const [days, setDays]       = useState(30);
    const [filter, setFilter]   = useState('');
    const [perPage, setPerPage] = useState(32);
    const [page, setPage]       = useState(1);
    const [sortCol, setSortCol] = useState<SortCol>('last');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [modalIp, setModalIp] = useState<string | null>(null);

    // Geo cache: ip → GeoInfo (or null on error)
    const geoCache = useRef<Map<string, GeoInfo | null>>(new Map());
    const [geoData, setGeoData] = useState<Map<string, GeoInfo | null>>(new Map());
    const [geoLoading, setGeoLoading] = useState<Set<string>>(new Set());

    const fetchData = useCallback(() => {
        setLoading(true);
        const param = days < 0 ? '' : `?days=${days}`;
        api.get<{ ok: boolean; total: number; ips: TrackerEntry[] }>(`/api/plugins/fail2ban/tracker${param}`).then(res => {
            if (res.success && res.result?.ok) { setIps(res.result.ips); setTotal(res.result.total); }
            setLoading(false);
        });
    }, [days]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const fetchGeo = useCallback((ip: string) => {
        if (geoCache.current.has(ip)) return;
        setGeoLoading(prev => new Set([...prev, ip]));
        api.get<{ ok: boolean; geo: GeoInfo }>(`/api/plugins/fail2ban/geo/${encodeURIComponent(ip)}`).then(res => {
            const info = res.success && res.result?.ok ? res.result.geo : null;
            geoCache.current.set(ip, info);
            setGeoData(prev => new Map([...prev, [ip, info]]));
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

    const filtered = useMemo(() => {
        const q = filter.trim().toLowerCase();
        return q ? ips.filter(e =>
            e.ip.includes(q) ||
            e.jails.some(j => j.includes(q)) ||
            (e.hostname ?? '').toLowerCase().includes(q) ||
            (geoData.get(e.ip)?.country ?? '').toLowerCase().includes(q) ||
            (geoData.get(e.ip)?.city ?? '').toLowerCase().includes(q)
        ) : ips;
    }, [ips, filter, geoData]);

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

    const ppBtn = (pp: number, label: string) => (
        <button key={pp} onClick={() => { setPerPage(pp); setPage(1); }}
            style={{ padding: '.1rem .4rem', fontSize: '.68rem', borderRadius: 4, background: perPage === pp ? 'rgba(88,166,255,.15)' : 'transparent', border: `1px solid ${perPage === pp ? 'rgba(88,166,255,.4)' : '#30363d'}`, color: perPage === pp ? '#58a6ff' : '#8b949e', cursor: 'pointer' }}>
            {label}
        </button>
    );

    const thStyle: React.CSSProperties = { padding: '.4rem .65rem', borderBottom: '1px solid #30363d', fontSize: '.67rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8b949e', textAlign: 'left', whiteSpace: 'nowrap' };

    const modalEntry = modalIp ? ips.find(e => e.ip === modalIp) : null;
    const modalGeo   = modalIp ? (geoData.get(modalIp) ?? null) : null;

    return (
        <>
        <div style={card}>
            {/* ── Top bar ── */}
            <div style={{ ...cardH, flexWrap: 'wrap', gap: '.5rem', alignItems: 'center' }}>
                {/* Title */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontWeight: 600, fontSize: '.9rem' }}>
                    <List style={{ width: 14, height: 14, color: '#e3b341' }} />
                    <strong style={{ color: '#e86a65' }}>{total}</strong>
                    <span style={{ color: '#e6edf3' }}>IP{total !== 1 ? 's' : ''} suivie{total !== 1 ? 's' : ''}</span>
                </div>
                {/* Period selector */}
                <div style={{ display: 'flex', gap: '.25rem', flexWrap: 'wrap' }}>
                    {PERIODS.map(p => (
                        <F2bTooltip key={p.days} title={p.label} body={p.title} color="blue">
                            <button onClick={() => { setDays(p.days); setPage(1); }}
                                style={{ padding: '.12rem .5rem', fontSize: '.7rem', borderRadius: 4, border: `1px solid ${days === p.days ? 'rgba(88,166,255,.4)' : '#30363d'}`, background: days === p.days ? 'rgba(88,166,255,.15)' : 'transparent', color: days === p.days ? '#58a6ff' : '#8b949e', cursor: 'pointer' }}>
                                {p.label}
                            </button>
                        </F2bTooltip>
                    ))}
                </div>
                {/* Search — centré */}
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ position: 'relative', width: 220 }}>
                        <span style={{ position: 'absolute', left: '.6rem', top: '50%', transform: 'translateY(-50%)', color: '#8b949e', fontSize: '.72rem', pointerEvents: 'none' }}>🔍</span>
                        <input type="search" value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}
                            placeholder="Rechercher…"
                            style={{ width: '100%', padding: '.38rem .75rem .38rem 1.8rem', fontSize: '.82rem', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', outline: 'none', boxSizing: 'border-box' }} />
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
                        {ppBtn(0, 'Tous')}
                    </div>
                </div>
            </div>

            {/* ── Table ── */}
            {loading
                ? <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e' }}>Chargement…</div>
                : filtered.length === 0
                ? <div style={{ textAlign: 'center', padding: '3rem', color: '#3fb950' }}>✓ Aucune IP trouvée</div>
                : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 750 }}>
                            <thead>
                                <tr>
                                    <th style={{ ...thStyle, width: 32 }}>#</th>
                                    <SortTh col="last" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={thStyle}>Dernier vu</SortTh>
                                    <SortTh col="ip"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={thStyle}>IP</SortTh>
                                    <th style={thStyle}>Géoloc</th>
                                    <SortTh col="failures" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={{ ...thStyle, textAlign: 'center' }}>Tentatives</SortTh>
                                    <SortTh col="bans"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={{ ...thStyle, textAlign: 'center' }}><span style={{ color: '#e86a65' }}>Bans</span></SortTh>
                                    <SortTh col="unbans" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={{ ...thStyle, textAlign: 'center' }}><span style={{ color: '#3fb950' }}>Débans</span></SortTh>
                                    <SortTh col="jails"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} style={thStyle}>Jail(s)</SortTh>
                                    <th style={thStyle}>IPSet(s)</th>
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
                                    return (
                                        <tr key={e.ip} style={{ borderBottom: '1px solid rgba(48,54,61,.6)' }}
                                            onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                            onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'transparent'}>
                                            <td style={{ padding: '.4rem .65rem', fontSize: '.75rem', color: '#8b949e' }}>{globalIdx}</td>
                                            <td style={{ padding: '.4rem .65rem', fontSize: '.75rem' }}>
                                                {e.lastSeen ? <LastSeenBadge ts={e.lastSeen} /> : <span style={{ color: '#8b949e' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '.4rem .65rem', whiteSpace: 'nowrap' }}>
                                                {inRecidive && <span title="Récidive" style={{ color: '#e3b341', fontSize: '.72rem', marginRight: '.35rem' }}>⚠</span>}
                                                <button onClick={() => setModalIp(e.ip)}
                                                    title="Voir historique détaillé"
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: '.85rem', color: '#e6edf3', fontWeight: 600 }}>
                                                    {e.ip}
                                                </button>
                                            </td>
                                            <td style={{ padding: '.35rem .65rem', whiteSpace: 'nowrap' }}>
                                                {geoFetched && geo
                                                    ? (
                                                        <span title={`${geo.org} · ${geo.isp}`} style={{ fontSize: '.78rem', color: '#8b949e' }}>
                                                            <span style={{ marginRight: '.3rem' }}>{toFlag(geo.countryCode)}</span>
                                                            <span style={{ color: '#e6edf3' }}>{geo.city}</span>
                                                            <span style={{ color: '#8b949e', fontSize: '.7rem', marginLeft: '.25rem' }}>({geo.countryCode})</span>
                                                        </span>
                                                    )
                                                    : geoFetching
                                                    ? <span style={{ color: '#8b949e', fontSize: '.72rem' }}>…</span>
                                                    : (
                                                        <button onClick={() => fetchGeo(e.ip)}
                                                            title="Géolocaliser cette IP"
                                                            style={{ background: 'none', border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer', padding: '.1rem .35rem', display: 'inline-flex', alignItems: 'center', gap: '.25rem', color: '#8b949e' }}>
                                                            <MapPin style={{ width: 11, height: 11 }} />
                                                            <span style={{ fontSize: '.68rem' }}>Géoloc</span>
                                                        </button>
                                                    )
                                                }
                                            </td>
                                            <td style={{ padding: '.4rem .65rem', textAlign: 'center', fontSize: '.78rem' }}>
                                                {e.failures !== undefined ? <span style={{ color: '#e3b341', fontWeight: 700 }}>{e.failures}</span> : <span style={{ color: '#8b949e' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '.4rem .65rem', textAlign: 'center', fontSize: '.78rem' }}>
                                                {e.bans !== undefined ? <span style={{ color: e.bans >= 5 ? '#e86a65' : e.bans >= 2 ? '#e3b341' : '#58a6ff', fontWeight: 700 }}>{e.bans}</span> : <span style={{ color: '#8b949e' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '.4rem .65rem', textAlign: 'center', fontSize: '.78rem' }}>
                                                {e.unbans !== undefined ? <span style={{ color: '#3fb950', fontWeight: 600 }}>{e.unbans}</span> : <span style={{ color: '#8b949e' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '.4rem .65rem' }}>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                                                    {e.jails.map(j => (
                                                        <span key={j} style={{ padding: '.18rem .5rem', borderRadius: 4, fontSize: '.75rem', fontWeight: 600, ...(j === 'recidive' ? { background: 'rgba(232,106,101,.08)', color: '#e86a65', border: '1px solid rgba(232,106,101,.2)' } : { background: 'rgba(63,185,80,.1)', color: '#3fb950', border: '1px solid rgba(63,185,80,.25)' }) }}>
                                                            {j === 'recidive' && <span style={{ color: '#e3b341' }}>⚠ </span>}{j}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                            <td style={{ padding: '.4rem .65rem' }}>
                                                {e.ipsets && e.ipsets.length > 0 ? (
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem' }}>
                                                        {e.ipsets.map(s => (
                                                            <span key={s} style={{ padding: '.12rem .4rem', borderRadius: 4, fontSize: '.68rem', fontWeight: 600, background: 'rgba(188,140,255,.1)', color: '#bc8cff', border: '1px solid rgba(188,140,255,.25)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{s}</span>
                                                        ))}
                                                    </div>
                                                ) : <span style={{ color: '#8b949e', fontSize: '.75rem' }}>—</span>}
                                            </td>
                                            <td style={{ padding: '.4rem .65rem', fontSize: '.78rem', color: e.hostname ? '#c9d1d9' : '#8b949e', fontFamily: 'monospace' }}>{e.hostname ?? '—'}</td>
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

        {/* ── IP Details Modal ── */}
        {modalIp && (
            <IpModal
                ip={modalIp}
                geo={modalGeo}
                jails={modalEntry?.jails}
                onClose={() => setModalIp(null)}
            />
        )}
        </>
    );
};
