/**
 * Fail2ban Monitoring Page — orchestrateur principal.
 * Chaque onglet est dans src/pages/fail2ban/.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { usePolling } from '../hooks/usePolling';
import {
    Shield, AlertTriangle, CheckCircle,
    Ban, Activity,
    List, Filter, Zap, Settings,
    Network, Server, ClipboardList, HelpCircle, Database, Map as MapIcon,
} from 'lucide-react';
import { api } from '../api/client';
import fail2banIcon from '../icons/fail2ban.svg';

// ── Sub-tabs ──────────────────────────────────────────────────────────────────
import { TabJails }      from './fail2ban/TabJails';
import { TabStats }      from './fail2ban/TabStats';
import { TabTracker }    from './fail2ban/TabTracker';
import { TabBanManager } from './fail2ban/TabBanManager';
import { TabFiltres }    from './fail2ban/TabFiltres';
import { TabActions }    from './fail2ban/TabActions';
import { TabMap }        from './fail2ban/TabMap';
import { TabConfig }     from './fail2ban/TabConfig';
import { TabAudit }      from './fail2ban/TabAudit';
import { PERIODS }       from './fail2ban/helpers';
import { TabAide }           from './fail2ban/TabAide';
import { TabNetworkRaw }     from './fail2ban/TabNetworkRaw';
import { TabFileList }       from './fail2ban/TabFileList';
import { BanHistoryChart }   from './fail2ban/BanHistoryChart';
import type { StatusResponse, HistoryEntry, TabId } from './fail2ban/types';

// ── Nav groups ────────────────────────────────────────────────────────────────

const NAV_GROUPS = [
    {
        label: 'Fail2ban',
        items: [
            { id: 'jails'   as TabId, label: 'Jails',      icon: Shield,       color: '#58a6ff' },
            { id: 'filtres' as TabId, label: 'Filtres',     icon: Filter,       color: '#3fb950' },
            { id: 'actions' as TabId, label: 'Actions',     icon: Zap,          color: '#e3b341' },
            { id: 'tracker' as TabId, label: 'Tracker IPs', icon: List,         color: '#e3b341' },
            { id: 'carte'   as TabId, label: 'Carte',       icon: MapIcon,      color: '#39c5cf' },
            { id: 'ban'     as TabId, label: 'Ban Manager', icon: Ban,          color: '#e86a65' },
            { id: 'stats'   as TabId, label: 'Stats',       icon: Activity,     color: '#58a6ff' },
        ],
    },
    {
        label: 'Pare-feu',
        items: [
            { id: 'iptables' as TabId, label: 'IPTables', icon: Network,  color: '#39c5cf' },
            { id: 'ipset'    as TabId, label: 'IPSet',    icon: Database, color: '#bc8cff' },
            { id: 'nftables' as TabId, label: 'NFTables', icon: Server,   color: '#e3b341' },
        ],
    },
    {
        label: 'Outils',
        items: [
            { id: 'config' as TabId, label: 'Config', icon: Settings,      color: '#8b949e' },
            { id: 'audit'  as TabId, label: 'Audit',  icon: ClipboardList, color: '#8b949e' },
            { id: 'aide'   as TabId, label: 'Aide',   icon: HelpCircle,    color: '#8b949e' },
        ],
    },
] as const;

// ── Age formatter ─────────────────────────────────────────────────────────────

function fmtAge(ts: number): string {
    const secs = Math.floor((Date.now() - ts) / 1000);
    if (secs < 5)   return 'à l\'instant';
    if (secs < 60)  return `il y a ${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60)  return `il y a ${mins}min`;
    return `il y a ${Math.floor(mins / 60)}h`;
}

// ── Topbar chip (PHP .chip style) ─────────────────────────────────────────────

const CHIP_COLORS: Record<string, { color: string; border: string }> = {
    blue:   { color: '#58a6ff', border: 'rgba(88,166,255,.45)'  },
    red:    { color: '#e86a65', border: 'rgba(232,106,101,.45)' },
    orange: { color: '#e3b341', border: 'rgba(227,179,65,.45)'  },
    green:  { color: '#3fb950', border: 'rgba(63,185,80,.45)'   },
};

const Chip: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => {
    const c = CHIP_COLORS[color] ?? CHIP_COLORS.blue;
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: '.18rem .6rem', borderRadius: 20, fontSize: '.73rem', fontWeight: 600, border: `1px solid ${c.border}`, color: c.color, background: 'transparent', whiteSpace: 'nowrap' }}>
            {children}
        </span>
    );
};

// ── Sparkline ─────────────────────────────────────────────────────────────────

const Sparkline: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
    if (data.length < 2) return null;
    const W = 60, H = 22, PAD = 2;
    const max = Math.max(...data, 1);
    const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - PAD - (v / max) * (H - PAD * 2)}`).join(' ');
    const area = `${pts} ${W},${H} 0,${H}`;
    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block', marginTop: '.3rem' }} preserveAspectRatio="none">
            <polygon points={area} fill={color} opacity={0.15} />
            <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
};

// ── Main page ─────────────────────────────────────────────────────────────────

export const Fail2banPage: React.FC<{ onBack?: () => void }> = () => {
    const contentRef = useRef<HTMLDivElement>(null);
    const [tab, setTab]           = useState<TabId>('jails');
    const [collapsed, setCollapsed] = useState(false);
    const [status, setStatus]     = useState<StatusResponse | null>(null);
    const [history, setHistory]   = useState<HistoryEntry[]>([]);
    const [byJail, setByJail]     = useState<Record<string, Record<string, number>>>({});
    const [jailNames, setJailNames] = useState<string[]>([]);
    const [loading, setLoading]   = useState(true);
    const hasDataRef = useRef(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [actionMsg, setActionMsg]         = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
    const [statsDays, setStatsDays]         = useState(1);
    const [lastRefreshed, setLastRefreshed] = useState<number>(0);
    const [toasts, setToasts]               = useState<{ id: number; title: string; detail: string }[]>([]);
    const prevBannedRef = useRef<Record<string, number>>({});
    const toastIdRef    = useRef(0);
    // ticker: re-render every 5s so "il y a Xs" stays fresh
    const [, setTick] = useState(0);
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => {
        tickRef.current = setInterval(() => setTick(t => t + 1), 5000);
        return () => { if (tickRef.current) clearInterval(tickRef.current); };
    }, []);

    const fetchStatus = useCallback(async () => {
        // Only show full-page spinner on initial load — background refreshes update data silently
        if (!hasDataRef.current) setLoading(true);
        try {
            const [sRes, hRes] = await Promise.all([
                api.get<StatusResponse>(`/api/plugins/fail2ban/status?days=${statsDays}`),
                api.get<{ ok?: boolean; history?: HistoryEntry[]; byJail?: Record<string, Record<string, number>>; jailNames?: string[] }>(`/api/plugins/fail2ban/history?days=${statsDays}`),
            ]);
            if (sRes.success && sRes.result) {
                setStatus(sRes.result);
                // Detect new bans (skip on initial load)
                if (hasDataRef.current && sRes.result.jails) {
                    const prev = prevBannedRef.current;
                    const newBansPerJail: string[] = [];
                    let delta = 0;
                    for (const j of sRes.result.jails) {
                        const d = j.currentlyBanned - (prev[j.jail] ?? 0);
                        if (d > 0) { newBansPerJail.push(`${j.jail} (+${d})`); delta += d; }
                    }
                    if (delta > 0) {
                        const id = ++toastIdRef.current;
                        const detail = newBansPerJail.join(', ');
                        setToasts(t => [...t, { id, title: `+${delta} ban${delta > 1 ? 's' : ''} détecté${delta > 1 ? 's' : ''}`, detail }]);
                        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 12000);
                    }
                    prevBannedRef.current = Object.fromEntries(sRes.result.jails.map(j => [j.jail, j.currentlyBanned]));
                }
            }
            if (hRes.success && hRes.result?.history && Array.isArray(hRes.result.history)) {
                setHistory(hRes.result.history);
                setByJail(hRes.result.byJail ?? {});
                setJailNames(hRes.result.jailNames ?? []);
            } else {
                setHistory([]); setByJail({}); setJailNames([]);
            }
        } finally {
            hasDataRef.current = true;
            setLoading(false);
            setLastRefreshed(Date.now());
        }
    }, [statsDays]);

    useEffect(() => { fetchStatus(); }, [fetchStatus]);

    // Scroll to top of content area on tab change so BanHistoryChart stays visible
    useEffect(() => { if (contentRef.current) contentRef.current.scrollTop = 0; }, [tab]);

    // Auto-refresh every 30s — pauses when tab is hidden (handled by usePolling)
    usePolling(fetchStatus, { interval: 30_000, immediate: false });

    const doAction = async (endpoint: string, body: object, key: string) => {
        setActionLoading(key); setActionMsg(null);
        try {
            const res = await api.post<{ ok: boolean; output?: string; error?: string }>(endpoint, body);
            if (res.success && res.result?.ok) { setActionMsg({ type: 'ok', text: res.result.output || 'OK' }); fetchStatus(); }
            else setActionMsg({ type: 'err', text: res.result?.error || res.error?.message || 'Erreur' });
        } catch (err) { setActionMsg({ type: 'err', text: String(err) }); }
        finally { setActionLoading(null); }
    };

    const jails           = status?.jails ?? [];
    const inactiveJails   = status?.inactiveJails ?? [];
    const totalBanned     = jails.reduce((s, j) => s + j.currentlyBanned, 0);
    const totalFailed     = jails.reduce((s, j) => s + j.currentlyFailed, 0);
    const totalAllTime    = jails.reduce((s, j) => s + (j.totalBannedSqlite ?? j.totalBanned), 0);
    const activeJails     = jails.filter(j => j.currentlyBanned > 0 || j.currentlyFailed > 0).length;
    const uniqueIpsTotal  = status?.uniqueIpsTotal ?? 0;
    const expiredLast24h  = status?.expiredLast24h ?? 0;
    const histMax         = history.length ? Math.max(...history.map(h => h.count), 1) : 1;
    const sparkData       = history.slice(-14).map(h => h.count);

    // Trend tracking (compare with previous poll for ↑ / ↓ indicators)
    const prevStatsRef = useRef<{ totalBanned: number; uniqueIpsTotal: number; expiredLast24h: number } | null>(null);
    const prevStats = prevStatsRef.current;
    const trend = (curr: number, prev: number | undefined) =>
        prev === undefined ? null : curr > prev ? '↑' : curr < prev ? '↓' : null;
    const trendColor = (curr: number, prev: number | undefined, upBad = true) => {
        const t = trend(curr, prev);
        if (!t) return '#8b949e';
        return t === '↑' ? (upBad ? '#e86a65' : '#3fb950') : (upBad ? '#3fb950' : '#e86a65');
    };

    // Update prevStats after render (do NOT during render to avoid loops — use ref directly)
    useEffect(() => {
        if (status) {
            prevStatsRef.current = { totalBanned, uniqueIpsTotal, expiredLast24h };
        }
    }, [status, totalBanned, uniqueIpsTotal, expiredLast24h]);

    const periodBans = history.reduce((s, h) => s + h.count, 0);
    const periodLabel = PERIODS.find(p => p.days === statsDays)?.label ?? `${statsDays}j`;

    const miniStatCards = (
        <div style={{ padding: '.85rem 1rem .65rem', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '.6rem', borderBottom: '1px solid #30363d', width: '100%', boxSizing: 'border-box' }}>
            {([
                { label: 'Jails actifs',            value: jails.length,   icon: <Shield style={{ width: 14, height: 14 }} />,       color: '#58a6ff', spark: false, trendVal: null },
                { label: 'Bans actifs',             value: totalBanned,    icon: <Ban style={{ width: 14, height: 14 }} />,           color: '#e86a65', spark: true,  trendVal: trend(totalBanned, prevStats?.totalBanned), trendCol: trendColor(totalBanned, prevStats?.totalBanned, true) },
                { label: `Bans (${periodLabel})`,   value: periodBans,     icon: <Activity style={{ width: 14, height: 14 }} />,      color: '#39c5cf', spark: false, trendVal: null },
                { label: 'Échecs actifs',           value: totalFailed,    icon: <AlertTriangle style={{ width: 14, height: 14 }} />, color: '#e3b341', spark: false, trendVal: null },
                { label: 'Total bans cumul',        value: totalAllTime,   icon: <Shield style={{ width: 14, height: 14 }} />,        color: '#bc8cff', spark: true,  trendVal: null },
                { label: 'Expirés (24h)',           value: expiredLast24h, icon: <CheckCircle style={{ width: 14, height: 14 }} />,   color: '#3fb950', spark: false, trendVal: trend(expiredLast24h, prevStats?.expiredLast24h), trendCol: trendColor(expiredLast24h, prevStats?.expiredLast24h, false) },
            ] as { label: string; value: number; icon: React.ReactNode; color: string; spark: boolean; trendVal: string | null; trendCol?: string }[]).map(({ label, value, icon, color, spark, trendVal, trendCol }) => (
                <div key={label} style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 7, padding: '.65rem .8rem', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '.68rem', color: '#8b949e' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                        <span style={{ color, flexShrink: 0 }}>{icon}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '.3rem', marginTop: '.15rem' }}>
                        <span style={{ fontSize: '1.45rem', fontWeight: 700, color, lineHeight: 1.15 }}>{value}</span>
                        {trendVal && <span style={{ fontSize: '.78rem', fontWeight: 700, color: trendCol, marginBottom: '.1rem' }}>{trendVal}</span>}
                    </div>
                    {spark && <Sparkline data={sparkData} color={color} />}
                </div>
            ))}
        </div>
    );

    const badges: Partial<Record<TabId, number>> = { jails: jails.length, tracker: totalBanned };

    const allNavItems = ([] as { id: TabId; label: string; color: string }[]).concat(...NAV_GROUPS.map(g => g.items as unknown as { id: TabId; label: string; color: string }[]));
    const activeColor = allNavItems.find(i => i.id === tab)?.color ?? '#58a6ff';

    return (
        <div className="flex h-full overflow-hidden" style={{ background: '#0d1117', color: '#e6edf3' }}>

            {/* ── Left sidebar ── */}
            <aside style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#161b22', borderRight: '1px solid #30363d', transition: 'width .2s ease', overflow: 'hidden', width: collapsed ? 46 : 196 }}>
                {/* Brand */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: collapsed ? '.75rem 0' : '.75rem .75rem', borderBottom: '1px solid #30363d', flexShrink: 0, justifyContent: collapsed ? 'center' : undefined }}>
                    <img src={fail2banIcon} alt="fail2ban" style={{ width: 18, height: 18, flexShrink: 0 }} />
                    {!collapsed && <span style={{ fontWeight: 700, fontSize: '.9rem', color: '#e6edf3', whiteSpace: 'nowrap' }}>Fail2ban</span>}
                    {!collapsed && status && (
                        <span style={{ fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 999, fontWeight: 600, background: status.ok ? 'rgba(63,185,80,.15)' : 'rgba(232,106,101,.15)', color: status.ok ? '#3fb950' : '#e86a65' }}>
                            {status.ok ? '✓' : '✗'}
                        </span>
                    )}
                    <button onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Développer' : 'Réduire'}
                        style={{ marginLeft: collapsed ? undefined : 'auto', flexShrink: 0, background: 'transparent', border: '1px solid #30363d', borderRadius: 4, color: '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, fontSize: '.8rem', transition: 'background .12s, color .12s' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#30363d'; (e.currentTarget as HTMLElement).style.color = '#e6edf3'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#8b949e'; }}>
                        {collapsed ? '›' : '‹'}
                    </button>
                </div>

                {/* Nav */}
                <nav style={{ flex: 1, overflowY: 'auto', padding: '.35rem 0' }}>
                    {NAV_GROUPS.map(group => (
                        <div key={group.label} style={{ marginBottom: '.1rem' }}>
                            {!collapsed && (
                                <div style={{ padding: '.35rem 1rem .1rem', fontSize: '.63rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8b949e', opacity: .6 }}>
                                    {group.label}
                                </div>
                            )}
                            {collapsed && <div style={{ height: 1, margin: '.25rem .45rem', background: '#30363d' }} />}
                            {group.items.map(({ id, label, icon: Icon, color }) => {
                                const badge = badges[id];
                                const active = tab === id;
                                return (
                                    <button key={id} onClick={() => setTab(id)} title={label}
                                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '.55rem', padding: collapsed ? '.52rem 0' : '.45rem 1rem', justifyContent: collapsed ? 'center' : undefined, fontSize: '.84rem', fontWeight: 500, border: 'none', borderLeft: `3px solid ${active ? color : 'transparent'}`, background: active ? `${color}18` : 'transparent', color: active ? color : '#8b949e', cursor: 'pointer', transition: 'background .12s, border-color .12s', whiteSpace: 'nowrap', overflow: 'hidden', position: 'relative' }}
                                        onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = '#21262d'; } }}
                                        onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; } }}
                                    >
                                        {/* Icon always in its color */}
                                        <Icon style={{ width: 15, height: 15, flexShrink: 0, color }} />
                                        {!collapsed && <span style={{ flex: 1, textAlign: 'left', color: active ? color : '#c9d1d9' }}>{label}</span>}
                                        {!collapsed && badge !== undefined && badge > 0 && (
                                            <span style={{ background: '#e86a65', color: '#fff', fontSize: '.65rem', borderRadius: 999, padding: '.05rem .45rem', fontWeight: 700 }}>{badge}</span>
                                        )}
                                        {collapsed && badge !== undefined && badge > 0 && (
                                            <span style={{ position: 'absolute', top: 3, right: 3, background: '#e86a65', color: '#fff', fontSize: '.55rem', borderRadius: 6, padding: '0 .25rem', lineHeight: 1.6, zIndex: 1 }}>{badge > 9 ? '9+' : badge}</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </nav>

                {/* Collapse toggle */}
                <button onClick={() => setCollapsed(c => !c)}
                    style={{ flexShrink: 0, padding: '.45rem', background: 'transparent', border: 'none', borderTop: '1px solid #30363d', color: '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-end', paddingRight: collapsed ? undefined : '1rem', gap: '.35rem', transition: 'background .12s' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#21262d'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                    <span style={{ fontSize: '.72rem', color: '#8b949e' }}>{collapsed ? '›' : '‹'}</span>
                    {!collapsed && <span style={{ fontSize: '.75rem', color: '#8b949e' }}>Réduire</span>}
                </button>
            </aside>

            {/* ── Main content ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

                {/* Topbar */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '.45rem .85rem', borderBottom: '1px solid #30363d', background: '#0d1117', flexShrink: 0 }}>
                    {/* Left: tab name */}
                    <span style={{ fontWeight: 600, fontSize: '.88rem', color: activeColor, textTransform: 'capitalize', flexShrink: 0, minWidth: 70 }}>{tab}</span>
                    {/* Center: chips */}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                        {status?.ok && (<>
                            <Chip color="blue"><Ban style={{ width: 11, height: 11 }} /> <strong>{jails.length}</strong><span style={{ fontWeight: 400, color: '#8b949e' }}> jails</span></Chip>
                            <Chip color="red"><Ban style={{ width: 11, height: 11 }} /> <strong>{totalBanned}</strong><span style={{ fontWeight: 400, color: '#8b949e' }}> bannis</span></Chip>
                            {totalFailed > 0 && <Chip color="orange"><AlertTriangle style={{ width: 11, height: 11 }} /> <strong>{totalFailed}</strong><span style={{ fontWeight: 400, color: '#8b949e' }}> échecs</span></Chip>}
                            {activeJails > 0 && <Chip color="green"><Activity style={{ width: 11, height: 11 }} /> <strong>{activeJails}</strong><span style={{ fontWeight: 400, color: '#8b949e' }}> actifs</span></Chip>}
                        </>)}
                        {actionMsg && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.78rem', padding: '.2rem .65rem', borderRadius: 6, background: actionMsg.type === 'ok' ? 'rgba(63,185,80,.1)' : 'rgba(232,106,101,.1)', color: actionMsg.type === 'ok' ? '#3fb950' : '#e86a65', border: `1px solid ${actionMsg.type === 'ok' ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}` }}>
                                {actionMsg.type === 'ok' ? <CheckCircle style={{ width: 12, height: 12, flexShrink: 0 }} /> : <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />}
                                <span style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{actionMsg.text}</span>
                                <button onClick={() => setActionMsg(null)} style={{ flexShrink: 0, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: .6, lineHeight: 1, padding: 0 }}>✕</button>
                            </div>
                        )}
                    </div>
                    {/* Right: refresh badge */}
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '.4rem', justifyContent: 'flex-end' }}>
                        {loading && (
                            <span style={{ fontSize: '.67rem', color: '#8b949e', whiteSpace: 'nowrap' }}>↻ …</span>
                        )}
                        {lastRefreshed > 0 && !loading && (
                            <span title="Auto-refresh actif toutes les 30s"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: '.15rem .5rem', borderRadius: 5, border: '1px solid #30363d', background: '#161b22', fontSize: '.67rem', color: '#8b949e', whiteSpace: 'nowrap', cursor: 'default' }}>
                                ↻
                                <span style={{ fontFamily: 'monospace', color: '#c9d1d9' }}>{new Date(lastRefreshed).toLocaleTimeString('fr-FR')}</span>
                                <span style={{ color: '#8b949e' }}>({fmtAge(lastRefreshed)})</span>
                            </span>
                        )}
                    </div>
                </div>
                {/* Toast notifications */}
                {toasts.length > 0 && (
                    <div style={{ position: 'fixed', bottom: '1.25rem', right: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.5rem', zIndex: 9999, pointerEvents: 'none' }}>
                        {toasts.map(t => (
                            <div key={t.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem', padding: '.65rem .85rem', background: '#161b22', border: '1px solid rgba(232,106,101,.4)', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,.5)', minWidth: 240, maxWidth: 340, pointerEvents: 'all' }}>
                                <Ban style={{ width: 14, height: 14, color: '#e86a65', flexShrink: 0, marginTop: 2 }} />
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: '.82rem', color: '#e86a65' }}>{t.title}</div>
                                    {t.detail && <div style={{ fontSize: '.73rem', color: '#8b949e', marginTop: '.15rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.detail}</div>}
                                </div>
                                <button onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))} style={{ marginLeft: 'auto', flexShrink: 0, background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '.8rem', lineHeight: 1, padding: 0 }}>✕</button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Error banner */}
                {!loading && status && !status.ok && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', padding: '.6rem 1rem', background: 'rgba(227,179,65,.07)', borderBottom: '1px solid rgba(227,179,65,.25)', fontSize: '.78rem', color: '#e3b341', flexShrink: 0 }}>
                        <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0, marginTop: 2 }} />
                        <div style={{ minWidth: 0 }}>
                            <strong>Source indisponible</strong>
                            {' — '}{status.error ?? 'fail2ban-client et SQLite inaccessibles'}{'. '}
                            <code style={{ fontFamily: 'monospace', fontSize: '.75rem' }}>sudo chmod 660 /var/run/fail2ban/fail2ban.sock</code>
                        </div>
                    </div>
                )}

                {/* Content */}
                <div ref={contentRef} style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Shared stats card: shown for jails + stats tabs */}
                    {(tab === 'jails' || tab === 'stats') && (
                        <BanHistoryChart history={history} histMax={histMax} days={statsDays} onDaysChange={setStatsDays}
                            loading={loading} card headerExtra={miniStatCards}
                            byJail={byJail} jailNames={jailNames} />
                    )}
                    {tab === 'jails' && (
                        <TabJails jails={jails} inactiveJails={inactiveJails} loading={loading} statusOk={status?.ok} statusError={status?.error}
                            actionLoading={actionLoading} days={statsDays}
                            onUnban={(jail, ip) => doAction('/api/plugins/fail2ban/unban', { jail, ip }, `unban-${jail}-${ip}`)}
                            onBan={(jail, ip)   => doAction('/api/plugins/fail2ban/ban',   { jail, ip }, `ban-${jail}-${ip}`)}
                            onReload={(jail)    => doAction('/api/plugins/fail2ban/reload', { jail },    `reload-${jail}`)} />
                    )}
                    {tab === 'filtres' && <TabFiltres jails={jails} />}
                    {tab === 'actions' && <TabActions jails={jails} />}
                    {tab === 'tracker' && <TabTracker />}
                    {tab === 'carte'   && <TabMap onGoToTracker={ip => { void ip; setTab('tracker'); }} />}
                    {tab === 'ban' && (
                        <TabBanManager jails={jails} actionLoading={actionLoading}
                            onBan={(jail, ip)   => doAction('/api/plugins/fail2ban/ban',   { jail, ip }, `ban-${jail}-${ip}`)}
                            onUnban={(jail, ip) => doAction('/api/plugins/fail2ban/unban', { jail, ip }, `unban-${jail}-${ip}`)} />
                    )}
                    {tab === 'stats' && (
                        <TabStats jails={jails} loading={loading}
                            totalBanned={totalBanned} totalFailed={totalFailed} totalAllTime={totalAllTime} activeJails={activeJails}
                            days={statsDays} onDaysChange={setStatsDays} />
                    )}
                    {tab === 'iptables' && <TabNetworkRaw title="IPTables" endpoint="/api/plugins/fail2ban/iptables" icon={<Network style={{ width: 14, height: 14 }} />} />}
                    {tab === 'ipset'    && <TabNetworkRaw title="IPSet"    endpoint="/api/plugins/fail2ban/ipset"    icon={<Database style={{ width: 14, height: 14 }} />} />}
                    {tab === 'nftables' && <TabNetworkRaw title="NFTables" endpoint="/api/plugins/fail2ban/nftables" icon={<Server style={{ width: 14, height: 14 }} />} />}
                    {tab === 'config'   && <TabConfig />}
                    {tab === 'audit'    && <TabAudit />}
                    {tab === 'aide'     && <TabAide />}
                </div>
            </div>
        </div>
    );
};
