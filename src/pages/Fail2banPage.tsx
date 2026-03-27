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
    Archive,
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
import { PERIODS, F2bTooltip, type F2bTtColor } from './fail2ban/helpers';
import { TabAide }           from './fail2ban/TabAide';
import { TabBackup }         from './fail2ban/TabBackup';
import { TabNetworkRaw }     from './fail2ban/TabNetworkRaw';
import { TabIPSet }          from './fail2ban/TabIPSet';
import { TabIPTables }       from './fail2ban/TabIPTables';
import { TabNFTables }       from './fail2ban/TabNFTables';
import { TabFileList }       from './fail2ban/TabFileList';
import { BanHistoryChart }   from './fail2ban/BanHistoryChart';
import type { StatusResponse, HistoryEntry, TabId } from './fail2ban/types';
import { IpModal } from './fail2ban/IpModal';
import { SyncProgressBanner } from './fail2ban/SyncProgressBanner';

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
            { id: 'config'  as TabId, label: 'Config',  icon: Settings,      color: '#8b949e' },
            { id: 'audit'   as TabId, label: 'Audit',   icon: ClipboardList, color: '#8b949e' },
            { id: 'backup'  as TabId, label: 'Backup',  icon: Archive,       color: '#58a6ff' },
            { id: 'aide'    as TabId, label: 'Aide',    icon: HelpCircle,    color: '#8b949e' },
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: '.18rem .6rem', borderRadius: 4, fontSize: '.73rem', fontWeight: 600, border: `1px solid ${c.border}`, color: c.color, background: 'transparent', whiteSpace: 'nowrap' }}>
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

export const Fail2banPage: React.FC<{ onBack?: () => void; initialTab?: TabId }> = ({ initialTab }) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const [tab, setTab]           = useState<TabId>(initialTab ?? 'jails');
    const [selectedIp, setSelectedIp] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [status, setStatus]     = useState<StatusResponse | null>(null);
    const [history, setHistory]   = useState<HistoryEntry[]>([]);
    const [trackerTotal, setTrackerTotal] = useState<number | null>(null);
    const [trackerFilter, setTrackerFilter] = useState<string>('');
    const [byJail, setByJail]     = useState<Record<string, Record<string, number>>>({});
    const [jailNames, setJailNames] = useState<string[]>([]);
    const [granularity, setGranularity] = useState<'hour' | 'day'>('day');
    const [slotBase, setSlotBase]       = useState<number | undefined>(undefined);
    const [loading, setLoading]   = useState(true);
    const hasDataRef = useRef(false);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [actionMsg, setActionMsg]         = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
    const [statsDays, setStatsDays]         = useState(1);
    const [lastRefreshed, setLastRefreshed] = useState<number>(0);
    const [dbFragPct, setDbFragPct] = useState<number | null>(null);
    const [npmDataPath, setNpmDataPath] = useState<string>('');
    interface BanToast { id: number; ip: string; jail: string; timeofban: number; failures: number | null }
    const [toasts, setToasts] = useState<BanToast[]>([]);
    const toastIdRef   = useRef(0);
    const lastRowidRef = useRef<number>(-1); // -1 = not bootstrapped yet
    // ticker: re-render every 5s so "il y a Xs" stays fresh
    const [, setTick] = useState(0);
    const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => {
        tickRef.current = setInterval(() => setTick(t => t + 1), 5000);
        return () => { if (tickRef.current) clearInterval(tickRef.current); };
    }, []);

    // ── Config warnings check — auto on mount + every 5 min, drives Config tab badge ──
    const checkConfigWarnings = useCallback(() => {
        api.get<{ dbInfo: { fragPct: number; integrity: string } | null; appDbInfo: { fragPct: number } | null }>('/api/plugins/fail2ban/config/parsed')
            .then(res => {
                if (!res.success || !res.result) return;
                let warns = 0;
                const { dbInfo, appDbInfo } = res.result;
                if (dbInfo?.fragPct   && dbInfo.fragPct   > 20) warns++;
                if (dbInfo?.integrity && dbInfo.integrity !== 'ok') warns++;
                if (appDbInfo?.fragPct && appDbInfo.fragPct > 20) warns++;
                setDbFragPct(warns);
            })
            .catch(() => {});
    }, []);
    useEffect(() => {
        checkConfigWarnings();
        const timer = setInterval(checkConfigWarnings, 5 * 60_000);
        return () => clearInterval(timer);
    }, [checkConfigWarnings]);

    // Load npmDataPath from plugin config on mount
    useEffect(() => {
        api.get<{ settings?: { npmDataPath?: string } }>('/api/plugins/fail2ban')
            .then(res => { if (res.success) setNpmDataPath(res.result?.settings?.npmDataPath ?? ''); })
            .catch(() => {});
    }, []);

    // ── URL hash sync — update hash on tab change for bookmarkable deep links ──
    useEffect(() => {
        window.history.replaceState(null, '', `#fail2ban/${tab}`);
    }, [tab]);

    // ── Ban notification polling ───────────────────────────────────────────────
    // Bootstrap: get current max rowid so we only notify about future bans
    useEffect(() => {
        interface SinceResult { ok: boolean; events: []; maxRowid: number }
        api.get<SinceResult>('/api/plugins/fail2ban/events/since?rowid=0').then(res => {
            if (res.success && res.result?.ok) lastRowidRef.current = res.result.maxRowid;
        });
    }, []);

    // Poll every 30s — each new event gets its own toast
    useEffect(() => {
        interface BanEvent { rowid: number; ip: string; jail: string; timeofban: number; bantime: number | null; failures: number | null }
        interface SinceResult { ok: boolean; events: BanEvent[]; maxRowid: number }

        const poll = () => {
            if (lastRowidRef.current < 0) return; // not bootstrapped yet
            api.get<SinceResult>(`/api/plugins/fail2ban/events/since?rowid=${lastRowidRef.current}`).then(res => {
                if (!res.success || !res.result?.ok) return;
                const { events, maxRowid } = res.result;
                lastRowidRef.current = maxRowid;
                for (const ev of events) {
                    const id = ++toastIdRef.current;
                    setToasts(t => [...t, { id, ip: ev.ip, jail: ev.jail, timeofban: ev.timeofban, failures: ev.failures }]);
                    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 15000);
                }
            });
        };

        const timer = setInterval(poll, 30_000);
        return () => clearInterval(timer);
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
            }
            if (hRes.success && hRes.result?.history && Array.isArray(hRes.result.history)) {
                setHistory(hRes.result.history);
                setByJail(hRes.result.byJail ?? {});
                setJailNames(hRes.result.jailNames ?? []);
                const r = hRes.result as { granularity?: 'hour' | 'day'; slotBase?: number };
                setGranularity(r.granularity ?? 'day');
                setSlotBase(r.slotBase);
            } else {
                setHistory([]); setByJail({}); setJailNames([]); setGranularity('day'); setSlotBase(undefined);
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
    const totalBanned     = new Set(jails.flatMap(j => j.bannedIps ?? [])).size;
    const totalFailed     = jails.reduce((s, j) => s + j.currentlyFailed, 0);
    const totalAllTime    = jails.reduce((s, j) => s + (j.totalBannedSqlite ?? j.totalBanned), 0);
    const activeJails     = jails.filter(j => j.currentlyBanned > 0 || j.currentlyFailed > 0).length;
    const uniqueIpsTotal  = status?.uniqueIpsTotal ?? 0;
    const uniqueIpsPeriod = status?.uniqueIpsPeriod ?? 0;
    const expiredLast24h  = status?.expiredLast24h ?? 0;
    const firstEventAt    = status?.firstEventAt ?? null;
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

    // ── Rich stat-box tooltip body — matches PHP stats-tt-stat-val/desc/meta style ──
    const statTtBody = (value: number, unit: string, color: string, desc: string, meta?: React.ReactNode) => (
        <div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, color, lineHeight: 1.1, marginBottom: '.22rem', letterSpacing: '-.01em' }}>
                {value.toLocaleString()}
                <span style={{ fontSize: '.68rem', fontWeight: 600, opacity: .7, marginLeft: '.25rem', letterSpacing: 0, verticalAlign: 'middle' }}>{unit}</span>
            </div>
            <div style={{ fontSize: '.75rem', color: '#e6edf3', opacity: .88, lineHeight: 1.45 }}>{desc}</div>
            {meta && <div style={{ fontSize: '.69rem', color: '#8b949e', marginTop: '.28rem', paddingTop: '.28rem', borderTop: '1px solid rgba(255,255,255,.06)' }}>{meta}</div>}
        </div>
    );

    const MINI_CARD_TT = [
        { ttTitle: 'Jails actifs',
          ttBody: 'Jails avec au moins une règle active (enabled=true)',
          ttColor: 'blue' as const },
        { ttTitle: 'IPs bannies (BDD)',
          ttBodyNode: statTtBody(uniqueIpsTotal, 'IPs uniques', '#e86a65',
              'Total IPs distinctes bannies dans f2b_events (base de données locale) — depuis l\'installation.',
              <span>
                  {prevStats?.uniqueIpsTotal !== undefined && trend(uniqueIpsTotal, prevStats.uniqueIpsTotal) &&
                      <span>Dernier refresh : {prevStats.uniqueIpsTotal} → <strong style={{ color: '#e86a65' }}>{uniqueIpsTotal}</strong> {trend(uniqueIpsTotal, prevStats.uniqueIpsTotal)}<br/></span>}
                  <span style={{ color: '#8b949e' }}>Inclut bans expirés · bans actifs : {totalBanned}</span>
              </span>),
          ttColor: 'red' as const },
        { ttTitle: `Bans (${periodLabel})`,
          ttBodyNode: statTtBody(periodBans, 'bans', '#39c5cf',
              `Total bans enregistrés sur la fenêtre ${periodLabel} (données du graphique).`),
          ttColor: 'cyan' as const },
        { ttTitle: 'Échecs actifs',
          ttBodyNode: statTtBody(totalFailed, 'tentatives', '#e3b341',
              'Tentatives échouées en cours (fenêtre findtime) — pas encore bannies.'),
          ttColor: 'orange' as const },
        { ttTitle: `IPs uniques (${periodLabel})`,
          ttBodyNode: statTtBody(uniqueIpsPeriod, 'IPs distinctes', '#bc8cff',
              `IPs distinctes ayant déclenché au moins un ban sur la période ${periodLabel} (f2b_events).`),
          ttColor: 'purple' as const },
        { ttTitle: 'Expirés (24h)',
          ttBodyNode: statTtBody(expiredLast24h, 'unbans', '#3fb950',
              'Bans levés automatiquement dans les dernières 24 heures.',
              prevStats?.expiredLast24h !== undefined && trend(expiredLast24h, prevStats.expiredLast24h)
                  ? <span>Dernier refresh : {prevStats.expiredLast24h} → <strong style={{ color: '#3fb950' }}>{expiredLast24h}</strong> {trend(expiredLast24h, prevStats.expiredLast24h)}</span>
                  : undefined),
          ttColor: 'green' as const },
    ];

    const miniStatCards = (
        <div style={{ padding: '.85rem 1rem .65rem', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '.6rem', borderBottom: '1px solid #30363d', width: '100%', boxSizing: 'border-box' }}>
            {([
                { label: 'Jails actifs',            value: jails.length,   icon: <Shield style={{ width: 14, height: 14 }} />,       color: '#58a6ff', spark: false, trendVal: null },
                { label: 'IPs bannies (BDD)',        value: uniqueIpsTotal, icon: <Ban style={{ width: 14, height: 14 }} />,           color: '#e86a65', spark: true,  trendVal: trend(uniqueIpsTotal, prevStats?.uniqueIpsTotal), trendCol: trendColor(uniqueIpsTotal, prevStats?.uniqueIpsTotal, true) },
                { label: `Bans (${periodLabel})`,   value: periodBans,     icon: <Activity style={{ width: 14, height: 14 }} />,      color: '#39c5cf', spark: true,  trendVal: null },
                { label: 'Échecs actifs',           value: totalFailed,    icon: <AlertTriangle style={{ width: 14, height: 14 }} />, color: '#e3b341', spark: true,  trendVal: null },
                { label: `IPs uniques (${periodLabel})`, value: uniqueIpsPeriod, icon: <Shield style={{ width: 14, height: 14 }} />,   color: '#bc8cff', spark: true,  trendVal: null },
                { label: 'Expirés (24h)',           value: expiredLast24h, icon: <CheckCircle style={{ width: 14, height: 14 }} />,   color: '#3fb950', spark: true,  trendVal: trend(expiredLast24h, prevStats?.expiredLast24h), trendCol: trendColor(expiredLast24h, prevStats?.expiredLast24h, false) },
            ] as { label: string; value: number; icon: React.ReactNode; color: string; spark: boolean; trendVal: string | null; trendCol?: string }[]).map(({ label, value, icon, color, spark, trendVal, trendCol }, idx) => (
                <F2bTooltip key={label} block title={MINI_CARD_TT[idx].ttTitle} body={(MINI_CARD_TT[idx] as { ttBody?: string }).ttBody} bodyNode={(MINI_CARD_TT[idx] as { ttBodyNode?: React.ReactNode }).ttBodyNode} color={MINI_CARD_TT[idx].ttColor}>
                    <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 7, padding: '.65rem .8rem', minWidth: 0 }}>
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
                </F2bTooltip>
            ))}
        </div>
    );

    // ── Nav tooltips — F2bTooltip style par tab ──────────────────────────────
    const npmMissing = npmDataPath === '';
    const configBadge = (dbFragPct ?? 0) + (npmMissing ? 1 : 0);
    const C = { muted: '#8b949e', blue: '#58a6ff', red: '#e86a65', orange: '#e3b341', green: '#3fb950', cyan: '#39c5cf', purple: '#bc8cff' };
    const ttVal = (v: number | string, color: string) => <span style={{ fontWeight: 700, color }}>{v}</span>;
    const ttRow = (val: number | string, color: string, label: string) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>{ttVal(val, color)}<span style={{ color: C.muted }}>{label}</span></div>
    );
    const navTt: Partial<Record<TabId, { title: string; bodyNode: React.ReactNode; color: F2bTtColor }>> = {
        jails: {
            title: 'Jails fail2ban',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                {ttRow(jails.length, C.blue, `jail${jails.length > 1 ? 's' : ''} configurée${jails.length > 1 ? 's' : ''}`)}
                {ttRow(activeJails, C.green, 'avec activité')}
                {ttRow(totalBanned, C.red, 'bans actifs (IPs uniques)')}
                {totalFailed > 0 && ttRow(totalFailed, C.orange, 'tentatives en cours')}
            </div>,
            color: 'blue',
        },
        filtres: {
            title: 'Filtres',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <div style={{ color: C.muted }}>Règles de détection par jail</div>
                <div style={{ color: C.muted }}>failregex · ignoreregex · maxretry</div>
            </div>,
            color: 'green',
        },
        actions: {
            title: 'Actions',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <div style={{ color: C.muted }}>Scripts ban / unban par jail</div>
                <div style={{ color: C.muted }}>iptables-multiport · sendmail…</div>
            </div>,
            color: 'orange',
        },
        tracker: {
            title: 'Tracker IPs',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                {ttRow(trackerTotal ?? uniqueIpsTotal, C.orange, 'IPs uniques (historique f2b_events)')}
                {ttRow(totalBanned, C.red, 'actuellement actives')}
                <div style={{ color: C.muted, fontSize: '.75rem' }}>Inclut les bans expirés</div>
            </div>,
            color: 'orange',
        },
        carte: {
            title: 'Carte mondiale',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <div style={{ color: C.muted }}>Distribution géographique des bans</div>
                <div style={{ color: C.muted }}>Géoloc. ip-api.com · cache 30 jours</div>
            </div>,
            color: 'cyan',
        },
        ban: {
            title: 'Ban Manager',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <div style={{ color: C.muted }}>Bannir / débannir manuellement</div>
                <div style={{ color: C.muted }}>Par IP · par jail · ou global</div>
            </div>,
            color: 'red',
        },
        stats: {
            title: 'Statistiques',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                {ttRow(totalAllTime, C.blue, 'bans en base (f2b_events)')}
                <div style={{ color: C.muted }}>Top IPs · jails · heatmaps · historique</div>
                {npmMissing && <div style={{ color: C.orange, fontSize: '.75rem', marginTop: '.15rem' }}>⚠ Chemin données NPM non configuré — Top Domaines inactif</div>}
            </div>,
            color: npmMissing ? 'orange' : 'blue',
        },
        iptables: {
            title: 'IPTables',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <div style={{ color: C.muted }}>Règles netfilter du host</div>
                <div style={{ color: C.orange, fontSize: '.75rem' }}>Requiert NET_ADMIN + network_mode: host</div>
            </div>,
            color: 'cyan',
        },
        ipset: {
            title: 'IPSet',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <div style={{ color: C.muted }}>Sets d'IPs actifs (f2b-*, blacklist…)</div>
                <div style={{ color: C.orange, fontSize: '.75rem' }}>Requiert NET_ADMIN + network_mode: host</div>
            </div>,
            color: 'purple',
        },
        nftables: {
            title: 'NFTables',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <div style={{ color: C.muted }}>Ruleset nftables du host</div>
                <div style={{ color: C.orange, fontSize: '.75rem' }}>Requiert NET_ADMIN + network_mode: host</div>
            </div>,
            color: 'orange',
        },
        config: {
            title: 'Configuration',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                {configBadge > 0
                    ? <div style={{ color: C.orange, fontWeight: 600 }}>⚠ {configBadge} avertissement{configBadge > 1 ? 's' : ''}</div>
                    : <div style={{ color: C.muted }}>Paramètres fail2ban · DB · maintenance</div>}
                {(dbFragPct ?? 0) > 0 && <div style={{ color: C.muted, fontSize: '.75rem' }}>· Fragmentation base de données</div>}
                {npmMissing && <div style={{ color: C.muted, fontSize: '.75rem' }}>· Chemin données NPM non configuré</div>}
                <div style={{ color: C.muted }}>Sync f2b_events toutes les 60s</div>
            </div>,
            color: configBadge > 0 ? 'orange' : 'muted',
        },
        audit: {
            title: 'Audit système',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <div style={{ color: C.muted }}>Socket · daemon · SQLite · drop-in</div>
                <div style={{ color: C.muted }}>Pare-feu : IPTables · IPSet · NFTables</div>
            </div>,
            color: 'muted',
        },
        backup: {
            title: 'Backup',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <div style={{ color: C.muted }}>Export jails actifs et configs fail2ban</div>
                <div style={{ color: C.muted }}>fail2ban.conf · jail.conf · jail.local</div>
            </div>,
            color: 'blue',
        },
        aide: {
            title: 'Aide',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <div style={{ color: C.muted }}>Documentation · prérequis Docker</div>
                <div style={{ color: C.muted }}>Guide de configuration fail2ban</div>
            </div>,
            color: 'muted',
        },
    };

    const badges: Partial<Record<TabId, number>> = {
        jails:   jails.length,
        tracker: trackerTotal ?? uniqueIpsTotal,
        ...(configBadge > 0 ? { config: configBadge } : {}),
    };

    const allNavItems = ([] as { id: TabId; label: string; color: string }[]).concat(...NAV_GROUPS.map(g => g.items as unknown as { id: TabId; label: string; color: string }[]));
    const activeColor = allNavItems.find(i => i.id === tab)?.color ?? '#58a6ff';

    return (
        <div className="flex h-full overflow-hidden" style={{ background: '#0d1117', color: '#e6edf3' }}>
            <SyncProgressBanner />

            {/* ── Left sidebar ── */}
            <aside style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#161b22', borderRight: '1px solid #30363d', transition: 'width .2s ease', overflow: 'hidden', width: collapsed ? 46 : 220 }}>
                {/* Brand */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.75rem .75rem', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
                    <img src={fail2banIcon} alt="fail2ban" style={{ width: 18, height: 18, flexShrink: 0 }} />
                    {!collapsed && <span style={{ fontWeight: 700, fontSize: '.9rem', color: '#e6edf3', whiteSpace: 'nowrap' }}>Fail2ban</span>}
                    {!collapsed && status && (
                        <span style={{ fontSize: '.68rem', padding: '.1rem .45rem', borderRadius: 999, fontWeight: 600, background: status.ok ? 'rgba(63,185,80,.15)' : 'rgba(232,106,101,.15)', color: status.ok ? '#3fb950' : '#e86a65' }}>
                            {status.ok ? '✓' : '✗'}
                        </span>
                    )}
                    <button onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Développer' : 'Réduire'}
                        style={{ marginLeft: 'auto', flexShrink: 0, background: 'transparent', border: '1px solid #30363d', borderRadius: 4, color: '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, fontSize: '.8rem', transition: 'background .12s, color .12s' }}
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
                                const tt = navTt[id];
                                return (
                                    <F2bTooltip key={id} title={tt?.title ?? label} bodyNode={tt?.bodyNode} color={tt?.color ?? 'blue'} block placement="bottom">
                                    <button onClick={() => setTab(id)}
                                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '.55rem', padding: collapsed ? '.52rem 0' : '.45rem 1rem', justifyContent: collapsed ? 'center' : undefined, fontSize: '.84rem', fontWeight: 500, border: 'none', borderLeft: `3px solid ${active ? color : 'transparent'}`, background: active ? `${color}18` : 'transparent', color: active ? color : '#8b949e', cursor: 'pointer', transition: 'background .12s, border-color .12s', whiteSpace: 'nowrap', overflow: 'hidden', position: 'relative' }}
                                        onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = '#21262d'; } }}
                                        onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; } }}
                                    >
                                        {/* Icon always in its color */}
                                        <Icon style={{ width: 15, height: 15, flexShrink: 0, color }} />
                                        {!collapsed && <span style={{ flex: 1, textAlign: 'left', color: active ? color : '#c9d1d9' }}>{label}</span>}
                                        {!collapsed && badge !== undefined && badge > 0 && (
                                            <span title={
                                                id === 'config'  ? `${badge} warning${badge > 1 ? 's' : ''} — voir onglet Config` :
                                                id === 'tracker' ? `${badge} IPs uniques (historique f2b_events — bans actifs : ${totalBanned})` :
                                                id === 'jails'   ? `${badge} jail${badge > 1 ? 's' : ''} configuré${badge > 1 ? 's' : ''}` :
                                                String(badge)
                                            } style={{ background: id === 'config' ? '#e3b341' : id === 'jails' ? '#58a6ff' : '#e86a65', color: id === 'config' ? '#0d1117' : '#fff', fontSize: '.65rem', borderRadius: 999, padding: '.05rem .45rem', fontWeight: 700 }}>
                                                {id === 'config' ? '!' : badge}
                                            </span>
                                        )}
                                        {collapsed && badge !== undefined && badge > 0 && (
                                            <span title={
                                                id === 'config'  ? `${badge} warning${badge > 1 ? 's' : ''} — voir Config` :
                                                id === 'tracker' ? `${badge} IPs uniques (f2b_events · actifs : ${totalBanned})` :
                                                id === 'jails'   ? `${badge} jails` :
                                                String(badge)
                                            } style={{ position: 'absolute', top: 3, right: 3, background: id === 'config' ? '#e3b341' : id === 'jails' ? '#58a6ff' : '#e86a65', color: id === 'config' ? '#0d1117' : '#fff', fontSize: '.55rem', borderRadius: 6, padding: '0 .25rem', lineHeight: 1.6, zIndex: 1 }}>
                                                {id === 'config' ? '!' : badge > 9 ? '9+' : badge}
                                            </span>
                                        )}
                                    </button>
                                    </F2bTooltip>
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
                            <Chip color="red"><Ban style={{ width: 11, height: 11 }} /> <strong>{uniqueIpsTotal}</strong><span style={{ fontWeight: 400, color: '#8b949e' }}> bannis (BDD)</span></Chip>
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
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: '.15rem .5rem', borderRadius: 5, border: '1px solid #30363d', background: '#161b22', fontSize: '.67rem', color: '#8b949e', whiteSpace: 'nowrap', cursor: 'default', width: '11.5rem', flexShrink: 0, overflow: 'hidden' }}>
                                ↻
                                <span style={{ fontFamily: 'monospace', color: '#c9d1d9', flexShrink: 0 }}>{new Date(lastRefreshed).toLocaleTimeString('fr-FR')}</span>
                                <span style={{ color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis' }}>({fmtAge(lastRefreshed)})</span>
                            </span>
                        )}
                    </div>
                </div>
                {/* Ban toast notifications */}
                {toasts.length > 0 && (
                    <div style={{ position: 'fixed', bottom: '1.5rem', right: '1.5rem', display: 'flex', flexDirection: 'column-reverse', gap: '.45rem', zIndex: 9999, alignItems: 'flex-end' }}>
                        {toasts.map(t => {
                            const secsAgo = Math.floor(Date.now() / 1000 - t.timeofban);
                            const age = secsAgo < 60 ? `${secsAgo}s` : secsAgo < 3600 ? `${Math.floor(secsAgo / 60)}min` : `${Math.floor(secsAgo / 3600)}h`;
                            const isRecidive = t.jail === 'recidive';
                            return (
                                <div key={t.id} style={{ display: 'flex', alignItems: 'stretch', background: '#161b22', border: `1px solid ${isRecidive ? 'rgba(227,179,65,.5)' : 'rgba(232,106,101,.4)'}`, borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,.6)', width: 300, overflow: 'hidden', animation: 'slideIn .2s ease-out' }}>
                                    {/* Colored left stripe */}
                                    <div style={{ width: 4, flexShrink: 0, background: isRecidive ? '#e3b341' : '#e86a65' }} />
                                    {/* Main content — clickable */}
                                    <button onClick={() => { setSelectedIp(t.ip); setToasts(ts => ts.filter(x => x.id !== t.id)); }}
                                        style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '.6rem .75rem', textAlign: 'left', minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.25rem' }}>
                                            <Ban style={{ width: 12, height: 12, color: isRecidive ? '#e3b341' : '#e86a65', flexShrink: 0 }} />
                                            <span style={{ fontWeight: 700, fontSize: '.78rem', color: isRecidive ? '#e3b341' : '#e86a65' }}>
                                                {isRecidive ? '⚠ Récidiviste banni' : 'Nouveau ban'}
                                            </span>
                                            <span style={{ marginLeft: 'auto', fontSize: '.65rem', color: '#555d69' }}>il y a {age}</span>
                                        </div>
                                        <div style={{ fontFamily: 'monospace', fontSize: '.85rem', fontWeight: 600, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.ip}</div>
                                        <div style={{ display: 'flex', gap: '.4rem', marginTop: '.2rem', alignItems: 'center' }}>
                                            <span style={{ fontSize: '.68rem', padding: '.05rem .35rem', borderRadius: 3, background: isRecidive ? 'rgba(227,179,65,.12)' : 'rgba(63,185,80,.1)', color: isRecidive ? '#e3b341' : '#3fb950', border: `1px solid ${isRecidive ? 'rgba(227,179,65,.25)' : 'rgba(63,185,80,.2)'}`, fontFamily: 'monospace' }}>{t.jail}</span>
                                            {t.failures !== null && t.failures > 0 && <span style={{ fontSize: '.68rem', color: '#8b949e' }}>{t.failures} tentative{t.failures > 1 ? 's' : ''}</span>}
                                        </div>
                                    </button>
                                    {/* Dismiss */}
                                    <button onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))}
                                        style={{ background: 'none', border: 'none', borderLeft: '1px solid #21262d', color: '#555d69', cursor: 'pointer', padding: '0 .6rem', fontSize: '.8rem', flexShrink: 0 }}>✕</button>
                                </div>
                            );
                        })}
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
                <div ref={contentRef} style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.25rem 5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Shared stats card: shown for jails + stats tabs */}
                    {(tab === 'jails' || tab === 'stats') && (
                        <BanHistoryChart history={history} histMax={histMax} days={statsDays} onDaysChange={setStatsDays}
                            loading={loading} card headerExtra={miniStatCards}
                            byJail={byJail} jailNames={jailNames} granularity={granularity} slotBase={slotBase} />
                    )}
                    {tab === 'jails' && (
                        <TabJails jails={jails} inactiveJails={inactiveJails} loading={loading} statusOk={status?.ok} statusError={status?.error}
                            actionLoading={actionLoading} days={statsDays}
                            onUnban={(jail, ip) => doAction('/api/plugins/fail2ban/unban', { jail, ip }, `unban-${jail}-${ip}`)}
                            onBan={(jail, ip)   => doAction('/api/plugins/fail2ban/ban',   { jail, ip }, `ban-${jail}-${ip}`)}
                            onReload={(jail)    => doAction('/api/plugins/fail2ban/reload', { jail },    `reload-${jail}`)}
                            onIpClick={(ip) => setSelectedIp(ip)} />
                    )}
                    {tab === 'filtres' && <TabFiltres jails={jails} />}
                    {tab === 'actions' && <TabActions jails={jails} />}
                    {tab === 'tracker' && <TabTracker onIpClick={(ip) => setSelectedIp(ip)} onTotalChange={setTrackerTotal} initialFilter={trackerFilter} />}
                    {tab === 'carte'   && <TabMap onGoToTracker={ip => { setTrackerFilter(ip); setTab('tracker'); }} onIpClick={ip => setSelectedIp(ip)} refreshKey={lastRefreshed} />}
                    {tab === 'ban' && (
                        <TabBanManager jails={jails} actionLoading={actionLoading}
                            onBan={(jail, ip)   => doAction('/api/plugins/fail2ban/ban',   { jail, ip }, `ban-${jail}-${ip}`)}
                            onUnban={(jail, ip) => doAction('/api/plugins/fail2ban/unban', { jail, ip }, `unban-${jail}-${ip}`)}
                            onIpClick={(ip) => setSelectedIp(ip)} />
                    )}
                    {tab === 'stats' && (
                        <TabStats jails={jails} loading={loading}
                            totalBanned={totalBanned} totalFailed={totalFailed} totalAllTime={totalAllTime} uniqueIpsTotal={uniqueIpsTotal} firstEventAt={firstEventAt} activeJails={activeJails}
                            days={statsDays} onDaysChange={setStatsDays}
                            onIpClick={(ip) => setSelectedIp(ip)} />
                    )}
                    {tab === 'iptables' && <TabIPTables />}
                    {tab === 'ipset'    && <TabIPSet onIpClick={ip => setSelectedIp(ip)} />}
                    {tab === 'nftables' && <TabNFTables />}
                    {tab === 'config'   && <TabConfig onWarningsChange={setDbFragPct} npmDataPath={npmDataPath} onNpmDataPathChange={setNpmDataPath} />}
                    {tab === 'audit'    && <TabAudit />}
                    {tab === 'backup'   && <TabBackup />}
                    {tab === 'aide'     && <TabAide />}
                </div>
            </div>
            {selectedIp && <IpModal ip={selectedIp} onClose={() => setSelectedIp(null)} />}
            <style>{`@keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }`}</style>
        </div>
    );
};
