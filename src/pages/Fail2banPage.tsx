/**
 * Fail2ban Monitoring Page — orchestrateur principal.
 * Chaque onglet est dans src/pages/fail2ban/.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
import { TabBlocklists }     from './fail2ban/TabBlocklists';
import { TabFileList }       from './fail2ban/TabFileList';
import { BanHistoryChart }   from './fail2ban/BanHistoryChart';
import { fetchTopsPrevTotalBans } from './fail2ban/fail2banTopsPrevFlight';
import { startTabTimer, dispatchTabLoaded } from '../utils/tabTimer';
import { useNotificationStore } from '../stores/notificationStore';
import type { StatusResponse, HistoryEntry, TabId } from './fail2ban/types';
import { IpModal } from './fail2ban/IpModal';
import { SyncProgressBanner } from './fail2ban/SyncProgressBanner';

// ── Nav groups ────────────────────────────────────────────────────────────────

const NAV_GROUPS = [
    {
        labelKey: 'Fail2ban',
        items: [
            { id: 'jails'   as TabId, labelKey: 'fail2ban.tabs.jails',      icon: Shield,       color: '#58a6ff' },
            { id: 'filtres' as TabId, labelKey: 'fail2ban.tabs.filters',    icon: Filter,       color: '#3fb950' },
            { id: 'actions' as TabId, labelKey: 'fail2ban.tabs.actions',    icon: Zap,          color: '#e3b341' },
            { id: 'tracker' as TabId, labelKey: 'fail2ban.tabs.tracker',    icon: List,         color: '#e3b341' },
            { id: 'carte'   as TabId, labelKey: 'fail2ban.tabs.map',        icon: MapIcon,      color: '#39c5cf' },
            { id: 'ban'     as TabId, labelKey: 'fail2ban.tabs.banManager', icon: Ban,          color: '#e86a65' },
            { id: 'stats'   as TabId, labelKey: 'fail2ban.tabs.stats',      icon: Activity,     color: '#58a6ff' },
        ],
    },
    {
        labelKey: 'fail2ban.tabs.firewall',
        items: [
            { id: 'iptables' as TabId, labelKey: 'fail2ban.tabs.iptables', icon: Network,  color: '#39c5cf' },
            { id: 'ipset'    as TabId, labelKey: 'fail2ban.tabs.ipset',    icon: Database, color: '#bc8cff' },
            { id: 'nftables'   as TabId, labelKey: 'fail2ban.tabs.nftables',   icon: Server,   color: '#e3b341' },
            { id: 'blocklists' as TabId, labelKey: 'fail2ban.tabs.blocklists', icon: Shield,   color: '#e86a65' },
        ],
    },
    {
        labelKey: 'fail2ban.tabs.tools',
        items: [
            { id: 'config'  as TabId, labelKey: 'fail2ban.tabs.config',  icon: Settings,      color: '#8b949e' },
            { id: 'audit'   as TabId, labelKey: 'fail2ban.tabs.audit',   icon: ClipboardList, color: '#8b949e' },
            { id: 'backup'  as TabId, labelKey: 'fail2ban.tabs.backup',  icon: Archive,       color: '#58a6ff' },
            { id: 'aide'    as TabId, labelKey: 'fail2ban.tabs.aide',    icon: HelpCircle,    color: '#8b949e' },
        ],
    },
];

// ── Age formatter — defined inside component to capture t() ──────────────────

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
    const { t } = useTranslation();

    const fmtAge = (ts: number): string => {
        const secs = Math.floor((Date.now() - ts) / 1000);
        if (secs < 5)  return t('fail2ban.timeAgo.now');
        if (secs < 60) return t('fail2ban.timeAgo.secondsAgo', { count: secs });
        const mins = Math.floor(secs / 60);
        if (mins < 60) return t('fail2ban.timeAgo.minutesAgo', { count: mins });
        return t('fail2ban.timeAgo.hoursAgo', { count: Math.floor(mins / 60) });
    };

    const contentRef = useRef<HTMLDivElement>(null);
    const timedTabRef = useRef(false);
    const [tab, setTab]           = useState<TabId>(initialTab ?? 'jails');
    const [selectedIp, setSelectedIp] = useState<string | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [status, setStatus]     = useState<StatusResponse | null>(null);
    const [history, setHistory]   = useState<HistoryEntry[]>([]);
    const [trackerTotal, setTrackerTotal] = useState<number | null>(null);
    const [trackerActive, setTrackerActive] = useState<number | null>(null);
    // Fetch active count from /tracker on mount so badge is correct before tab opens
    useEffect(() => {
        api.get<{ ok: boolean; total: number; ips: { currentlyBanned: boolean }[] }>('/api/plugins/fail2ban/tracker')
            .then(res => {
                if (!res.success || !res.result?.ok) return;
                setTrackerTotal(res.result.total);
                setTrackerActive(res.result.ips.filter(e => e.currentlyBanned).length);
            })
            .catch(() => {});
    }, []);
    const [trackerFilter, setTrackerFilter] = useState<string>('');
    const [byJail, setByJail]     = useState<Record<string, Record<string, number>>>({});
    const [jailNames, setJailNames] = useState<string[]>([]);
    const [granularity, setGranularity] = useState<'hour' | 'day'>('day');
    const [slotBase, setSlotBase]       = useState<number | undefined>(undefined);
    /** True until the first /status request settles (success or error). Unblocks TabJails without waiting for /history. */
    const [statusHydrated, setStatusHydrated] = useState(false);
    /** True until the first /history request settles; drives BanHistoryChart skeleton only. */
    const [historyLoading, setHistoryLoading] = useState(true);
    /** True while either /status or /history request is in flight (topbar refresh hint). */
    const [refreshBusy, setRefreshBusy] = useState(false);
    const hasBootstrappedRef = useRef(false);
    const fetchStatusAbortRef = useRef<AbortController | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [actionMsg, setActionMsg]         = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
    const [statsDays, setStatsDays]         = useState(1);
    const [lastRefreshed, setLastRefreshed] = useState<number>(0);
    const [dbFragPct, setDbFragPct] = useState<number | null>(null);
    const [bansToday, setBansToday] = useState<{ count: number; uniqIps: number } | null>(null);
    const [npmDataPath, setNpmDataPath] = useState<string>('');
    const [npmMysqlConfigured, setNpmMysqlConfigured] = useState(false);
    const [blocklistsStatus, setBlocklistsStatus] = useState<{ id: string; name: string; enabled: boolean; lastUpdate: string | null; count: number }[]>([]);
    const { addBan, addAttempt } = useNotificationStore();
    const lastRowidRef = useRef<number>(-1); // -1 = not bootstrapped yet
    const prevFailedRef = useRef<Record<string, number>>({}); // jail → currentlyFailed snapshot
    const jailDomainsRef = useRef<Record<string, string>>({}); // jail → domain (lazy-loaded once)
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
        // Delay initial call by 4s so /config/parsed (integrity_check, ~6s) does not compete
        // with /status and /history during the critical first-load wave.
        const delay = setTimeout(() => {
            checkConfigWarnings();
        }, 4_000);
        const timer = setInterval(checkConfigWarnings, 5 * 60_000);
        return () => { clearTimeout(delay); clearInterval(timer); };
    }, [checkConfigWarnings]);

    // Bans du jour (depuis minuit) — refresh toutes les 60s
    const fetchBansToday = useCallback(() => {
        api.get<{ ok: boolean; count: number; uniqIps: number }>('/api/plugins/fail2ban/bans-today')
            .then(res => { if (res.success && res.result?.ok) setBansToday({ count: res.result.count, uniqIps: res.result.uniqIps }); })
            .catch(() => {});
    }, []);
    useEffect(() => {
        fetchBansToday();
        const t = setInterval(fetchBansToday, 60_000);
        return () => clearInterval(t);
    }, [fetchBansToday]);

    // Load path settings from plugin config on mount
    useEffect(() => {
        api.get<{ settings?: { npmDataPath?: string; npmDbType?: string; npmMysqlHost?: string; npmMysqlUser?: string; npmMysqlDb?: string } }>('/api/plugins/fail2ban')
            .then(res => {
                if (res.success) {
                    const s = res.result?.settings ?? {};
                    setNpmDataPath(s.npmDataPath ?? '');
                    setNpmMysqlConfigured(s.npmDbType === 'mysql' && !!s.npmMysqlHost && !!s.npmMysqlUser && !!s.npmMysqlDb);
                }
            })
            .catch(() => {});
    }, []);

    // Load blocklist status for nav tooltip
    useEffect(() => {
        api.get<{ lists: { id: string; name: string; enabled: boolean; lastUpdate: string | null; count: number }[] }>('/api/plugins/fail2ban/blocklists/status')
            .then(res => { if (res.success && res.result?.lists) setBlocklistsStatus(res.result.lists); })
            .catch(() => {});
    }, []);

    // ── URL hash sync — update hash on tab change for bookmarkable deep links ──
    useEffect(() => {
        window.history.replaceState(null, '', `#fail2ban/${tab}`);
    }, [tab]);

    // ── Tab load timer — dispatch after render (fast tabs report immediately) ──
    useEffect(() => {
        if (!timedTabRef.current) return;
        timedTabRef.current = false;
        const id = requestAnimationFrame(() => dispatchTabLoaded());
        return () => cancelAnimationFrame(id);
    }, [tab]);

    // Ensure timer is running even when fail2ban is the default page (handlePageChange not called).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { startTabTimer(); }, []);

    // Dispatch once the initial /status fetch settles — meaningful for default-page load.
    const initialHydrateDispatchedRef = useRef(false);
    useEffect(() => {
        if (!statusHydrated || initialHydrateDispatchedRef.current) return;
        initialHydrateDispatchedRef.current = true;
        dispatchTabLoaded();
    }, [statusHydrated]);

    // ── IP modal opener — triggered by header notification zone click ─────────
    useEffect(() => {
        const handler = (e: Event) => {
            const ip = (e as CustomEvent<{ ip: string }>).detail?.ip;
            if (ip) setSelectedIp(ip);
        };
        window.addEventListener('open-ip-modal', handler);
        return () => window.removeEventListener('open-ip-modal', handler);
    }, []);

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
                    addBan({ ip: ev.ip, jail: ev.jail, timeofban: ev.timeofban, failures: ev.failures });
                }
            });
        };

        const timer = setInterval(poll, 30_000);
        return () => clearInterval(timer);
    }, []);

    const fetchStatus = useCallback(() => {
        // Cancel any previous in-flight wave before starting a new one
        fetchStatusAbortRef.current?.abort();
        const ac = new AbortController();
        fetchStatusAbortRef.current = ac;

        const firstWave = !hasBootstrappedRef.current;
        if (firstWave) {
            setHistoryLoading(true);
        }
        setRefreshBusy(true);

        let pending = 2;
        const waveDone = () => {
            if (ac.signal.aborted) return; // stale wave — don't touch shared state
            pending -= 1;
            if (pending === 0) {
                setRefreshBusy(false);
                hasBootstrappedRef.current = true;
                setLastRefreshed(Date.now());
            }
        };

        api.get<StatusResponse>(`/api/plugins/fail2ban/status?days=${statsDays}`, { signal: ac.signal })
            .then(sRes => {
                if (sRes.success && sRes.result) {
                    setStatus(sRes.result);
                    // Lazy-load jail→domain map once (non-blocking)
                    if (Object.keys(jailDomainsRef.current).length === 0) {
                        api.get<{ ok: boolean; jail_domains?: Record<string, string> }>('/api/plugins/fail2ban/jails/enrichment')
                            .then(r => { if (r.success && r.result?.jail_domains) jailDomainsRef.current = r.result.jail_domains; })
                            .catch(() => {});
                    }
                    // Detect attempt spikes: compare currentlyFailed per jail vs last snapshot
                    const prev = prevFailedRef.current;
                    const isBootstrap = Object.keys(prev).length === 0;
                    for (const j of (sRes.result.jails ?? [])) {
                        const cur = j.currentlyFailed ?? 0;
                        const old = prev[j.jail] ?? 0;
                        const delta = cur - old;
                        // Only notify on subsequent polls (not on first load) and if delta > 0
                        if (!isBootstrap && delta > 0 && cur > 0) {
                            const domain = jailDomainsRef.current[j.jail];
                            addAttempt({ jail: j.jail, delta, total: cur, domain });
                        }
                        prev[j.jail] = cur;
                    }
                    prevFailedRef.current = prev;
                }
            })
            .catch(() => { /* keep prior status on transient errors */ })
            .finally(() => {
                setStatusHydrated(true);
                waveDone();
            });

        api.get<{ ok?: boolean; history?: HistoryEntry[]; byJail?: Record<string, Record<string, number>>; jailNames?: string[] }>(`/api/plugins/fail2ban/history?days=${statsDays}`, { signal: ac.signal })
            .then(hRes => {
                if (hRes.success && hRes.result?.history && Array.isArray(hRes.result.history)) {
                    setHistory(hRes.result.history);
                    setByJail(hRes.result.byJail ?? {});
                    setJailNames(hRes.result.jailNames ?? []);
                    const r = hRes.result as { granularity?: 'hour' | 'day'; slotBase?: number };
                    setGranularity(r.granularity ?? 'day');
                    setSlotBase(r.slotBase);
                } else {
                    setHistory([]);
                    setByJail({});
                    setJailNames([]);
                    setGranularity('day');
                    setSlotBase(undefined);
                }
            })
            .catch(() => {
                setHistory([]);
                setByJail({});
                setJailNames([]);
                setGranularity('day');
                setSlotBase(undefined);
            })
            .finally(() => {
                setHistoryLoading(false);
                waveDone();
            });
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
    const activeJailsList = jails.filter(j => j.currentlyBanned > 0 || j.currentlyFailed > 0);
    const activeJails     = activeJailsList.length;
    const topActiveJail   = [...jails].filter(j => j.currentlyBanned > 0).sort((a, b) => b.currentlyBanned - a.currentlyBanned)[0]?.jail ?? null;
    const topJailByPeriod = [...jails].sort((a, b) => (b.bansInPeriod ?? 0) - (a.bansInPeriod ?? 0))[0];
    const uniqueIpsTotal  = status?.uniqueIpsTotal ?? 0;
    const uniqueIpsPeriod = status?.uniqueIpsPeriod ?? 0;
    const expiredLast24h  = status?.expiredLast24h ?? 0;
    const firstEventAt    = status?.firstEventAt ?? null;
    const histMax         = history.length ? Math.max(...history.map(h => h.count), 1) : 1;
    const sparkData       = history.slice(-14).map(h => h.count);

    // Trend tracking (compare with previous poll for ↑ / ↓ indicators)
    const prevStatsRef = useRef<{ totalBanned: number; uniqueIpsTotal: number; expiredLast24h: number; totalFailed: number } | null>(null);
    const prevStats = prevStatsRef.current;
    const trend = (curr: number, prev: number | undefined) =>
        prev === undefined ? null : curr > prev ? '↑' : curr < prev ? '↓' : null;
    const trendColor = (curr: number, prev: number | undefined, upBad = true) => {
        const t = trend(curr, prev);
        if (!t) return '#8b949e';
        return t === '↑' ? (upBad ? '#e86a65' : '#3fb950') : (upBad ? '#3fb950' : '#e86a65');
    };

    // Persistent trend for Échecs actifs — keeps last arrow visible until next change
    const [failedTrend, setFailedTrend] = useState<{ val: string; col: string } | null>(null);

    // Update prevStats after render (do NOT during render to avoid loops — use ref directly)
    useEffect(() => {
        if (status) {
            const prev = prevStatsRef.current;
            if (prev !== null && prev.totalFailed !== totalFailed) {
                setFailedTrend({
                    val: totalFailed > prev.totalFailed ? '↑' : '↓',
                    col: totalFailed > prev.totalFailed ? '#e86a65' : '#3fb950',
                });
            }
            prevStatsRef.current = { totalBanned, uniqueIpsTotal, expiredLast24h, totalFailed };
        }
    }, [status, totalBanned, uniqueIpsTotal, expiredLast24h, totalFailed]);

    const periodBans = history.reduce((s, h) => s + h.count, 0);
    const _periodEntry = PERIODS.find(p => p.days === statsDays);
    const periodLabel = _periodEntry ? t(_periodEntry.labelKey) : `${statsDays}j`;

    // Period summary for trend badges (current + prev period stats from /tops)
    type PeriodSummary = { totalBans: number; uniqueIps: number; totalFailures: number; expiredInPeriod: number };
    const [periodSummary,     setPeriodSummary]     = useState<PeriodSummary | null>(null);
    const [prevPeriodSummary, setPrevPeriodSummary] = useState<PeriodSummary | null>(null);
    useEffect(() => {
        setPeriodSummary(null);
        setPrevPeriodSummary(null);
        if (statsDays === -1) return;
        let cancelled = false;
        api.get<{ ok: boolean; summary?: PeriodSummary; prevSummary?: PeriodSummary | null }>(
            `/api/plugins/fail2ban/tops?days=${statsDays}&compare=1&limit=1`
        ).then(res => {
            if (!cancelled && res.success && res.result?.ok) {
                setPeriodSummary(res.result.summary ?? null);
                setPrevPeriodSummary(res.result.prevSummary ?? null);
            }
        });
        return () => { cancelled = true; };
    }, [statsDays]);
    const prevPeriodBans = prevPeriodSummary?.totalBans ?? null;

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
          ttBodyNode: (() => {
              const topBanned = [...jails].filter(j => j.currentlyBanned > 0).sort((a, b) => b.currentlyBanned - a.currentlyBanned).slice(0, 5);
              return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                      <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#58a6ff', lineHeight: 1.1 }}>{jails.length} jail{jails.length !== 1 ? 's' : ''}</div>
                      <div style={{ fontSize: '.75rem', color: '#e6edf3', lineHeight: 1.5 }}>
                          Jails déclarés dans la config fail2ban.
                      </div>
                      <div style={{ fontSize: '.69rem', color: '#8b949e', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: '.28rem', display: 'flex', flexDirection: 'column', gap: '.18rem' }}>
                          <div><span style={{ color: '#3fb950', fontWeight: 700 }}>{activeJails}</span> jail{activeJails !== 1 ? 's' : ''} avec activité (bans ou échecs actifs)</div>
                          <div><span style={{ color: '#8b949e' }}>{jails.length - activeJails}</span> jail{(jails.length - activeJails) !== 1 ? 's' : ''} inactifs</div>
                          {topBanned.length > 0 && (
                              <div style={{ marginTop: '.18rem', borderTop: '1px solid rgba(255,255,255,.04)', paddingTop: '.18rem' }}>
                                  <div style={{ color: '#8b949e', marginBottom: '.12rem' }}>Top bans actifs :</div>
                                  {topBanned.map(j => (
                                      <div key={j.jail} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                                          <span style={{ fontFamily: 'monospace', color: '#e6edf3' }}>{j.jail}</span>
                                          <span style={{ color: '#e86a65', fontWeight: 700 }}>{j.currentlyBanned} ban{j.currentlyBanned !== 1 ? 's' : ''}</span>
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
                  </div>
              );
          })(),
          ttColor: 'blue' as const },
        { ttTitle: `Bans (${periodLabel})`,
          ttBodyNode: statTtBody(periodBans, 'bans', '#39c5cf',
              `Total bans enregistrés sur la fenêtre ${periodLabel} (données du graphique).`,
              prevPeriodBans !== null
                  ? <span>Période précédente : <strong style={{ color: '#8b949e' }}>{prevPeriodBans}</strong> bans{periodBans !== prevPeriodBans ? <> → <strong style={{ color: periodBans > prevPeriodBans ? '#e86a65' : '#3fb950' }}>{periodBans}</strong></> : ' (stable)'}</span>
                  : undefined),
          ttColor: 'cyan' as const },
        { ttTitle: 'Échecs actifs',
          ttBodyNode: statTtBody(totalFailed, 'tentatives', '#e3b341',
              'Tentatives échouées en cours (fenêtre findtime) — IPs pas encore bannies.'),
          ttColor: 'orange' as const },
        { ttTitle: `Tot. échecs (${periodLabel})`,
          ttBodyNode: statTtBody(periodSummary?.totalFailures ?? 0, 'tentatives', '#e3b341',
              `Somme des échecs enregistrés lors des bans sur la période ${periodLabel} (colonne failures dans f2b_events).`,
              prevPeriodSummary !== null && periodSummary !== null
                  ? <span>Période précédente : <strong style={{ color: '#8b949e' }}>{prevPeriodSummary.totalFailures}</strong> échecs{periodSummary.totalFailures !== prevPeriodSummary.totalFailures ? <> → <strong style={{ color: periodSummary.totalFailures > prevPeriodSummary.totalFailures ? '#e86a65' : '#3fb950' }}>{periodSummary.totalFailures}</strong></> : ' (stable)'}</span>
                  : undefined),
          ttColor: 'orange' as const },
        { ttTitle: `IPs uniques (${periodLabel})`,
          ttBodyNode: statTtBody(uniqueIpsPeriod, 'IPs distinctes', '#bc8cff',
              `IPs distinctes ayant déclenché au moins un ban sur la période ${periodLabel} (f2b_events).`,
              prevPeriodSummary !== null && periodSummary !== null
                  ? <span>Période précédente : <strong style={{ color: '#8b949e' }}>{prevPeriodSummary.uniqueIps}</strong> IPs{periodSummary.uniqueIps !== prevPeriodSummary.uniqueIps ? <> → <strong style={{ color: periodSummary.uniqueIps > prevPeriodSummary.uniqueIps ? '#e86a65' : '#3fb950' }}>{periodSummary.uniqueIps}</strong></> : ' (stable)'}</span>
                  : undefined),
          ttColor: 'purple' as const },
        { ttTitle: `Expirés (${periodLabel})`,
          ttBodyNode: statTtBody(periodSummary?.expiredInPeriod ?? expiredLast24h, 'unbans', '#3fb950',
              `Bans dont la durée a expiré sur la période ${periodLabel} (calculé via timeofban+bantime).`,
              prevPeriodSummary !== null && periodSummary !== null
                  ? <span>Période précédente : <strong style={{ color: '#8b949e' }}>{prevPeriodSummary.expiredInPeriod}</strong> expirés{periodSummary.expiredInPeriod !== prevPeriodSummary.expiredInPeriod ? <> → <strong style={{ color: '#3fb950' }}>{periodSummary.expiredInPeriod}</strong></> : ' (stable)'}</span>
                  : undefined),
          ttColor: 'green' as const },
        { ttTitle: 'IPs bannies (BDD)',
          ttBodyNode: statTtBody(uniqueIpsTotal, 'IPs uniques', '#e86a65',
              'Total IPs distinctes bannies dans f2b_events (base de données locale) — depuis l\'installation.',
              <span>
                  {prevStats?.uniqueIpsTotal !== undefined && trend(uniqueIpsTotal, prevStats.uniqueIpsTotal) &&
                      <span>Dernier refresh : {prevStats.uniqueIpsTotal} → <strong style={{ color: '#e86a65' }}>{uniqueIpsTotal}</strong> {trend(uniqueIpsTotal, prevStats.uniqueIpsTotal)}<br/></span>}
                  <span style={{ color: '#8b949e' }}>Inclut bans expirés · bans actifs : {totalBanned}</span>
              </span>),
          ttColor: 'red' as const },
    ];

    const miniStatCards = (
        <div style={{ padding: '.85rem 1rem .65rem', display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '.6rem', borderBottom: '1px solid #30363d', width: '100%', boxSizing: 'border-box' }}>
            {([
                { label: 'Jails actifs', value: jails.length, icon: <Shield style={{ width: 14, height: 14 }} />, color: '#58a6ff', spark: false, trendVal: null,
                  valueSub: topActiveJail ? <span style={{ fontSize: '.62rem', fontWeight: 500, color: '#8b949e', marginLeft: '.35rem', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>{topActiveJail}</span> : undefined,
                  sub: firstEventAt ? <span style={{ fontSize: '.6rem', color: '#555d69', display: 'block', marginTop: '.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>BDD depuis {new Date(firstEventAt * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</span> : null },
                { label: `Bans (${periodLabel})`,           value: periodBans,                                      icon: <Activity style={{ width: 14, height: 14 }} />,      color: '#39c5cf', spark: true,  trendVal: prevPeriodBans === null ? null : periodBans > prevPeriodBans ? `▲ +${periodBans - prevPeriodBans}` : periodBans < prevPeriodBans ? `▼ ${periodBans - prevPeriodBans}` : null, trendCol: prevPeriodBans === null ? undefined : periodBans > prevPeriodBans ? '#e86a65' : '#3fb950' },
                { label: 'Échecs actifs',                   value: totalFailed,                                     icon: <AlertTriangle style={{ width: 14, height: 14 }} />, color: '#e3b341', spark: true,  trendVal: failedTrend?.val ?? null, trendCol: failedTrend?.col },
                { label: `Tot. échecs (${periodLabel})`,    value: periodSummary?.totalFailures ?? 0,               icon: <AlertTriangle style={{ width: 14, height: 14 }} />, color: '#e3b341', spark: true,  trendVal: prevPeriodSummary && periodSummary ? periodSummary.totalFailures > prevPeriodSummary.totalFailures ? `▲ +${periodSummary.totalFailures - prevPeriodSummary.totalFailures}` : periodSummary.totalFailures < prevPeriodSummary.totalFailures ? `▼ ${periodSummary.totalFailures - prevPeriodSummary.totalFailures}` : null : null, trendCol: prevPeriodSummary && periodSummary ? periodSummary.totalFailures > prevPeriodSummary.totalFailures ? '#e86a65' : '#3fb950' : undefined },
                { label: `IPs uniques (${periodLabel})`,    value: uniqueIpsPeriod,                                 icon: <Shield style={{ width: 14, height: 14 }} />,       color: '#bc8cff', spark: true,  trendVal: prevPeriodSummary && periodSummary ? periodSummary.uniqueIps > prevPeriodSummary.uniqueIps ? `▲ +${periodSummary.uniqueIps - prevPeriodSummary.uniqueIps}` : periodSummary.uniqueIps < prevPeriodSummary.uniqueIps ? `▼ ${periodSummary.uniqueIps - prevPeriodSummary.uniqueIps}` : null : null, trendCol: prevPeriodSummary && periodSummary ? periodSummary.uniqueIps > prevPeriodSummary.uniqueIps ? '#e86a65' : '#3fb950' : undefined },
                { label: `Expirés (${periodLabel})`,        value: periodSummary?.expiredInPeriod ?? expiredLast24h, icon: <CheckCircle style={{ width: 14, height: 14 }} />,  color: '#3fb950', spark: true,  trendVal: prevPeriodSummary && periodSummary ? periodSummary.expiredInPeriod > prevPeriodSummary.expiredInPeriod ? `▲ +${periodSummary.expiredInPeriod - prevPeriodSummary.expiredInPeriod}` : periodSummary.expiredInPeriod < prevPeriodSummary.expiredInPeriod ? `▼ ${periodSummary.expiredInPeriod - prevPeriodSummary.expiredInPeriod}` : null : null, trendCol: '#3fb950' },
                { label: 'IPs bannies (BDD)',                value: uniqueIpsTotal,                                  icon: <Ban style={{ width: 14, height: 14 }} />,           color: '#e86a65', spark: true,  trendVal: trend(uniqueIpsTotal, prevStats?.uniqueIpsTotal), trendCol: trendColor(uniqueIpsTotal, prevStats?.uniqueIpsTotal, true) },
            ] as { label: string; value: number; icon: React.ReactNode; color: string; spark: boolean; trendVal: string | null; trendCol?: string; sub?: React.ReactNode; valueSub?: React.ReactNode }[]).map(({ label, value, icon, color, spark, trendVal, trendCol, sub, valueSub }, idx) => (
                <F2bTooltip key={label} block title={MINI_CARD_TT[idx].ttTitle} body={(MINI_CARD_TT[idx] as { ttBody?: string }).ttBody} bodyNode={(MINI_CARD_TT[idx] as { ttBodyNode?: React.ReactNode }).ttBodyNode} color={MINI_CARD_TT[idx].ttColor}>
                    <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 7, padding: '.65rem .8rem', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '.68rem', color: '#8b949e' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                            <span style={{ color, flexShrink: 0 }}>{icon}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '.3rem', marginTop: '.15rem', minWidth: 0 }}>
                            <span style={{ fontSize: '1.45rem', fontWeight: 700, color, lineHeight: 1.15, flexShrink: 0 }}>{value}</span>
                            {trendVal && <span style={{ fontSize: '.78rem', fontWeight: 700, color: trendCol }}>{trendVal}</span>}
                            {valueSub}
                        </div>
                        {spark && <Sparkline data={sparkData} color={color} />}
                        {sub}
                    </div>
                </F2bTooltip>
            ))}
        </div>
    );

    // ── Nav tooltips — F2bTooltip style par tab ──────────────────────────────
    const npmMissing = npmDataPath === '' && !npmMysqlConfigured;
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
        blocklists: {
            title: 'Blocklists IP',
            bodyNode: <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                {blocklistsStatus.length === 0
                    ? <div style={{ color: C.muted }}>Listes d'IPs bloquées (ipset + iptables)</div>
                    : blocklistsStatus.map(bl => {
                        const fmtDate = bl.lastUpdate
                            ? (() => {
                                const diffMs = Date.now() - new Date(bl.lastUpdate).getTime();
                                const h = Math.floor(diffMs / 3_600_000);
                                const m = Math.floor((diffMs % 3_600_000) / 60_000);
                                return h > 0 ? `il y a ${h}h${m > 0 ? m + 'm' : ''}` : `il y a ${m}m`;
                            })()
                            : 'Jamais';
                        return (
                            <div key={bl.id} style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                <span style={{ color: bl.enabled ? C.green : C.muted, fontSize: '.8rem' }}>{bl.enabled ? '●' : '○'}</span>
                                <span style={{ color: C.muted }}>{bl.name}</span>
                                <span style={{ color: bl.enabled ? C.blue : C.muted, fontSize: '.72rem', marginLeft: 'auto' }}>{fmtDate}</span>
                            </div>
                        );
                    })
                }
            </div>,
            color: 'red',
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
        tracker: totalBanned,
        ...(configBadge > 0 ? { config: configBadge } : {}),
    };

    const allNavItems = ([] as { id: TabId; labelKey: string; color: string }[]).concat(...NAV_GROUPS.map(g => g.items as unknown as { id: TabId; labelKey: string; color: string }[]));
    const activeColor = allNavItems.find(i => i.id === tab)?.color ?? '#58a6ff';

    return (
        <div className="flex h-full overflow-hidden" style={{ background: '#0d1117', color: '#e6edf3' }}>
            <SyncProgressBanner />

            {/* ── Left sidebar ── */}
            <aside style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#161b22', borderRight: '1px solid #30363d', transition: 'width .2s ease', overflow: 'hidden', width: collapsed ? 54 : 185 }}>
                {/* Brand */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.75rem .75rem', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
                    <img src={fail2banIcon} alt="fail2ban" style={{ width: 18, height: 18, flexShrink: 0 }} />
                    {!collapsed && <span style={{ fontWeight: 700, fontSize: '.9rem', color: '#e6edf3', whiteSpace: 'nowrap' }}>Fail2ban</span>}
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
                        <div key={group.labelKey} style={{ marginBottom: '.1rem' }}>
                            {!collapsed && (
                                <div style={{ padding: '.35rem 1rem .1rem', fontSize: '.63rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8b949e', opacity: .6 }}>
                                    {group.labelKey.startsWith('fail2ban.') ? t(group.labelKey) : group.labelKey}
                                </div>
                            )}
                            {collapsed && <div style={{ height: 1, margin: '.25rem .45rem', background: '#30363d' }} />}
                            {group.items.map(({ id, labelKey, icon: Icon, color }) => {
                                const label = t(labelKey);
                                const badge = badges[id];
                                const active = tab === id;
                                const tt = navTt[id];
                                return (
                                    <F2bTooltip key={id} title={tt?.title ?? label} bodyNode={tt?.bodyNode} color={tt?.color ?? 'blue'} block placement="bottom">
                                    <button onClick={() => { startTabTimer(); timedTabRef.current = true; setTab(id); }}
                                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '.55rem', padding: collapsed ? '.52rem 0' : '.45rem 1rem', justifyContent: collapsed ? 'center' : undefined, fontSize: '.84rem', fontWeight: 500, border: 'none', borderLeft: `3px solid ${active ? color : 'transparent'}`, background: active ? `${color}18` : 'transparent', color: active ? color : '#8b949e', cursor: 'pointer', transition: 'background .12s, border-color .12s', whiteSpace: 'nowrap', overflow: 'hidden', position: 'relative' }}
                                        onMouseEnter={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = '#21262d'; } }}
                                        onMouseLeave={e => { if (!active) { (e.currentTarget as HTMLElement).style.background = 'transparent'; } }}
                                    >
                                        {/* Icon always in its color */}
                                        <Icon style={{ width: 15, height: 15, flexShrink: 0, color }} />
                                        {!collapsed && <span style={{ flex: 1, textAlign: 'left', color: active ? color : '#c9d1d9' }}>{label}</span>}
                                        {!collapsed && badge !== undefined && badge > 0 && (
                                            id === 'tracker'
                                            ? <span title={`${trackerActive ?? totalBanned} bannis actifs (BDD) · ${trackerTotal ?? uniqueIpsTotal} total historique`}
                                                style={{ display: 'inline-flex', alignItems: 'baseline', fontSize: '.65rem', fontWeight: 700, borderRadius: 999, padding: '.05rem .4rem', background: 'rgba(232,106,101,.15)', border: '1px solid rgba(232,106,101,.25)', whiteSpace: 'nowrap' }}>
                                                <span style={{ color: '#e86a65' }}>{trackerActive ?? totalBanned}</span>
                                                <span style={{ color: '#484f58', fontSize: '.6rem', margin: '0 .1rem' }}>/</span>
                                                <span style={{ color: '#8b949e' }}>{trackerTotal ?? uniqueIpsTotal}</span>
                                              </span>
                                            : <span title={
                                                id === 'config' ? `${badge} warning${badge > 1 ? 's' : ''} — voir onglet Config` :
                                                id === 'jails'  ? `${badge} jail${badge > 1 ? 's' : ''} configuré${badge > 1 ? 's' : ''}` :
                                                String(badge)
                                              } style={{ background: id === 'config' ? '#e3b341' : id === 'jails' ? '#58a6ff' : '#e86a65', color: id === 'config' ? '#0d1117' : '#fff', fontSize: '.65rem', borderRadius: 999, padding: '.05rem .45rem', fontWeight: 700 }}>
                                                {id === 'config' ? '!' : badge}
                                              </span>
                                        )}
                                        {collapsed && badge !== undefined && badge > 0 && (
                                            <span title={
                                                id === 'config'  ? `${badge} warning${badge > 1 ? 's' : ''} — voir Config` :
                                                id === 'tracker' ? `${totalBanned} bannis actifs · ${trackerTotal ?? uniqueIpsTotal} total historique` :
                                                id === 'jails'   ? `${badge} jails` :
                                                String(badge)
                                            } style={{ position: 'absolute', top: 3, right: 3, background: id === 'config' ? '#e3b341' : id === 'jails' ? '#58a6ff' : '#e86a65', color: id === 'config' ? '#0d1117' : '#fff', fontSize: '.55rem', borderRadius: 6, padding: '0 .25rem', lineHeight: 1.6, zIndex: 1 }}>
                                                {id === 'config' ? '!' : badge}
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
                            {/* 1. Échecs actifs */}
                            <F2bTooltip title="Échecs actifs" bodyNode={statTtBody(totalFailed, 'tentatives', '#e3b341', 'Tentatives échouées en cours dans la fenêtre findtime — pas encore bannies. Seuil maxretry pas atteint.')} color="orange" placement="bottom">
                                <Chip color={totalFailed > 0 ? 'orange' : 'muted'}>
                                    <AlertTriangle style={{ width: 11, height: 11 }} />
                                    {' '}<strong>{totalFailed}</strong><span style={{ fontWeight: 400, color: '#8b949e' }}> échecs</span>
                                </Chip>
                            </F2bTooltip>
                            {/* 2. Bans du jour */}
                            {bansToday !== null && (
                                <F2bTooltip title="Bans du jour" bodyNode={
                                    <div style={{ fontSize: '.78rem', lineHeight: 1.6 }}>
                                        <div><span style={{ color: '#e86a65', fontWeight: 700 }}>{bansToday.count}</span> ban{bansToday.count !== 1 ? 's' : ''} depuis minuit</div>
                                        <div><span style={{ color: '#58a6ff', fontWeight: 700 }}>{bansToday.uniqIps}</span> IP{bansToday.uniqIps !== 1 ? 's' : ''} unique{bansToday.uniqIps !== 1 ? 's' : ''}</div>
                                        <div style={{ marginTop: '.25rem', paddingTop: '.25rem', borderTop: '1px solid #30363d' }}><span style={{ color: '#e86a65', fontWeight: 700 }}>{totalBanned}</span> IP{totalBanned !== 1 ? 's' : ''} actuellement bannie{totalBanned !== 1 ? 's' : ''}</div>
                                        <div style={{ color: '#8b949e', fontSize: '.7rem', marginTop: '.15rem' }}>↻ refresh toutes les 60s</div>
                                    </div>
                                } color="red" placement="bottom">
                                    <Chip color="red">
                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: bansToday.count > 0 ? '#e86a65' : '#3fb950', display: 'inline-block', flexShrink: 0 }} />
                                        {' '}<strong>{bansToday.count}</strong><span style={{ fontWeight: 400, color: '#8b949e' }}> bans/jour</span>
                                    </Chip>
                                </F2bTooltip>
                            )}
                            {/* 3. Jail le plus actif sur la période */}
                            {topJailByPeriod && (topJailByPeriod.bansInPeriod ?? 0) > 0 && (
                                <F2bTooltip title={`Top jail (${periodLabel})`} bodyNode={
                                    <div>
                                        <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '.88rem', color: '#e3b341', marginBottom: '.2rem' }}>{topJailByPeriod.jail}</div>
                                        <div style={{ fontSize: '.72rem', color: '#e6edf3' }}><strong style={{ color: '#e3b341' }}>{topJailByPeriod.bansInPeriod}</strong> bans sur la période {periodLabel}</div>
                                        {topJailByPeriod.currentlyBanned > 0 && <div style={{ fontSize: '.7rem', color: '#e86a65', marginTop: '.15rem' }}>{topJailByPeriod.currentlyBanned} IP{topJailByPeriod.currentlyBanned > 1 ? 's' : ''} actuellement bannie{topJailByPeriod.currentlyBanned > 1 ? 's' : ''}</div>}
                                    </div>
                                } color="orange" placement="bottom">
                                    <Chip color="orange">
                                        <Shield style={{ width: 11, height: 11 }} />
                                        {' '}<span style={{ fontFamily: 'monospace', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', verticalAlign: 'bottom' }}>{topJailByPeriod.jail}</span>
                                        <span style={{ fontWeight: 400, color: '#8b949e' }}> ×{topJailByPeriod.bansInPeriod}</span>
                                    </Chip>
                                </F2bTooltip>
                            )}
                            {/* 4. Jails actifs — tooltip liste les jails avec activité */}
                            <F2bTooltip title="Jails actifs" bodyNode={
                                <div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#3fb950', lineHeight: 1.1, marginBottom: '.3rem' }}>
                                        {activeJails} <span style={{ fontSize: '.68rem', fontWeight: 600, opacity: .7 }}>jail{activeJails !== 1 ? 's' : ''}</span>
                                    </div>
                                    {activeJailsList.length > 0 ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.18rem', marginTop: '.25rem' }}>
                                            {activeJailsList.map(j => (
                                                <div key={j.jail} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.72rem' }}>
                                                    <span style={{ fontFamily: 'monospace', color: '#e6edf3', flex: 1 }}>{j.jail}</span>
                                                    {j.currentlyBanned > 0 && <span style={{ color: '#e86a65', fontWeight: 700 }}>{j.currentlyBanned} bannis</span>}
                                                    {j.currentlyFailed > 0 && <span style={{ color: '#e3b341' }}>{j.currentlyFailed} échecs</span>}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: '.72rem', color: '#8b949e', marginTop: '.2rem' }}>Aucun jail avec activité</div>
                                    )}
                                </div>
                            } color="green" placement="bottom">
                                <Chip color={activeJails > 0 ? 'green' : 'muted'}>
                                    <Activity style={{ width: 11, height: 11 }} />
                                    {' '}<strong>{activeJails}</strong><span style={{ fontWeight: 400, color: '#8b949e' }}> jails actifs</span>
                                </Chip>
                            </F2bTooltip>
                            {/* 5. Bans actifs + BDD */}
                            {(() => { const bddTotal = trackerTotal ?? uniqueIpsTotal; return (
                            <F2bTooltip title="IPs bannies (BDD)" bodyNode={statTtBody(bddTotal, 'IPs', '#e86a65', 'Total IPs distinctes bannies dans f2b_events depuis l\'installation. Inclut les bans expirés.', <span>Bans actifs en ce moment : <strong style={{ color: '#e86a65' }}>{totalBanned}</strong></span>)} color="red" placement="bottom">
                                <Chip color="red">
                                    <strong style={{ color: totalBanned > 0 ? '#e86a65' : '#8b949e' }}>{totalBanned}</strong><span style={{ fontWeight: 400, color: '#8b949e' }}> actifs</span>
                                    <span style={{ color: '#484f58', margin: '0 .2rem', fontWeight: 400 }}>·</span>
                                    <Database style={{ width: 11, height: 11 }} />{' '}<strong>{bddTotal}</strong><span style={{ fontWeight: 400, color: '#8b949e' }}> BDD</span>
                                </Chip>
                            </F2bTooltip>
                            ); })()}
                        </>)}
                        {actionMsg && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.78rem', padding: '.2rem .65rem', borderRadius: 6, background: actionMsg.type === 'ok' ? 'rgba(63,185,80,.1)' : 'rgba(232,106,101,.1)', color: actionMsg.type === 'ok' ? '#3fb950' : '#e86a65', border: `1px solid ${actionMsg.type === 'ok' ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}` }}>
                                {actionMsg.type === 'ok' ? <CheckCircle style={{ width: 12, height: 12, flexShrink: 0 }} /> : <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />}
                                <span style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>{actionMsg.text}</span>
                                <button onClick={() => setActionMsg(null)} style={{ flexShrink: 0, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: .6, lineHeight: 1, padding: 0 }}>✕</button>
                            </div>
                        )}
                    </div>
                    {/* Right: refresh badge — fixed width to prevent center badges from shifting */}
                    <div style={{ flexShrink: 0, width: '11.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                        <span title="Auto-refresh actif toutes les 30s"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: '.15rem .5rem', borderRadius: 5, border: '1px solid #30363d', background: '#161b22', fontSize: '.67rem', color: '#8b949e', whiteSpace: 'nowrap', cursor: 'default', width: '100%', overflow: 'hidden' }}>
                            <span style={{ flexShrink: 0 }}>{refreshBusy ? '↻' : '↻'}</span>
                            {refreshBusy ? (
                                <span style={{ fontFamily: 'monospace', color: '#555d69' }}>refresh…</span>
                            ) : lastRefreshed > 0 ? (<>
                                <span style={{ fontFamily: 'monospace', color: '#c9d1d9', flexShrink: 0 }}>{new Date(lastRefreshed).toLocaleTimeString('fr-FR')}</span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>({fmtAge(lastRefreshed)})</span>
                            </>) : (
                                <span style={{ color: '#555d69' }}>—</span>
                            )}
                        </span>
                    </div>
                </div>
                {/* Error banner */}
                {statusHydrated && status && !status.ok && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', padding: '.6rem 1rem', background: 'rgba(227,179,65,.07)', borderBottom: '1px solid rgba(227,179,65,.25)', fontSize: '.78rem', color: '#e3b341', flexShrink: 0 }}>
                        <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0, marginTop: 2 }} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <strong>Source indisponible</strong>
                            {' — '}{status.error ?? 'fail2ban-client et SQLite inaccessibles'}{'. '}
                            <code style={{ fontFamily: 'monospace', fontSize: '.75rem' }}>sudo chmod 660 /var/run/fail2ban/fail2ban.sock</code>
                        </div>
                        <button
                            onClick={fetchStatus}
                            style={{ flexShrink: 0, padding: '.15rem .6rem', fontSize: '.72rem', borderRadius: 4, cursor: 'pointer', border: '1px solid rgba(227,179,65,.4)', background: 'rgba(227,179,65,.12)', color: '#e3b341' }}
                        >
                            Réessayer
                        </button>
                    </div>
                )}

                {/* Content */}
                <div ref={contentRef} style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.25rem 5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Shared stats card: shown for jails + stats tabs */}
                    {(tab === 'jails' || tab === 'stats') && (
                        <BanHistoryChart history={history} histMax={histMax} days={statsDays} onDaysChange={setStatsDays}
                            loading={historyLoading} card headerExtra={miniStatCards}
                            byJail={byJail} jailNames={jailNames} granularity={granularity} slotBase={slotBase} />
                    )}
                    {tab === 'jails' && (
                        <TabJails jails={jails} inactiveJails={inactiveJails} statusHydrated={statusHydrated} statusOk={status?.ok} statusError={status?.error}
                            actionLoading={actionLoading} days={statsDays}
                            onUnban={(jail, ip) => doAction('/api/plugins/fail2ban/unban', { jail, ip }, `unban-${jail}-${ip}`)}
                            onBan={(jail, ip)   => doAction('/api/plugins/fail2ban/ban',   { jail, ip }, `ban-${jail}-${ip}`)}
                            onReload={(jail)    => doAction('/api/plugins/fail2ban/reload', { jail },    `reload-${jail}`)}
                            onIpClick={(ip) => setSelectedIp(ip)} />
                    )}
                    {tab === 'filtres' && <TabFiltres jails={jails} />}
                    {tab === 'actions' && <TabActions jails={jails} />}
                    {tab === 'tracker' && <TabTracker onIpClick={(ip) => setSelectedIp(ip)} onTotalChange={setTrackerTotal} onActiveChange={setTrackerActive} initialFilter={trackerFilter} />}
                    {tab === 'carte'   && <TabMap onGoToTracker={ip => { setTrackerFilter(ip); setTab('tracker'); }} onIpClick={ip => setSelectedIp(ip)} refreshKey={lastRefreshed} />}
                    {tab === 'ban' && (
                        <TabBanManager jails={jails} actionLoading={actionLoading}
                            onBan={(jail, ip)   => doAction('/api/plugins/fail2ban/ban',   { jail, ip }, `ban-${jail}-${ip}`)}
                            onUnban={(jail, ip) => doAction('/api/plugins/fail2ban/unban', { jail, ip }, `unban-${jail}-${ip}`)}
                            onIpClick={(ip) => setSelectedIp(ip)} />
                    )}
                    {tab === 'stats' && (
                        <TabStats jails={jails} statusHydrated={statusHydrated}
                            totalBanned={totalBanned} totalFailed={totalFailed} totalAllTime={totalAllTime} uniqueIpsTotal={uniqueIpsTotal} firstEventAt={firstEventAt} activeJails={activeJails}
                            days={statsDays} onDaysChange={setStatsDays}
                            onIpClick={(ip) => setSelectedIp(ip)} />
                    )}
                    {tab === 'iptables' && <TabIPTables />}
                    {tab === 'ipset'    && <TabIPSet onIpClick={ip => setSelectedIp(ip)} />}
                    {tab === 'nftables'   && <TabNFTables />}
                    {tab === 'blocklists' && <TabBlocklists />}
                    {tab === 'config'   && <TabConfig onWarningsChange={setDbFragPct} npmDataPath={npmDataPath} onNpmDataPathChange={v => {
                        setNpmDataPath(v);
                        api.get<{ settings?: { npmDataPath?: string; npmDbType?: string; npmMysqlHost?: string; npmMysqlUser?: string; npmMysqlDb?: string } }>('/api/plugins/fail2ban')
                            .then(res => {
                                if (res.success) {
                                    const s = res.result?.settings ?? {};
                                    setNpmDataPath(s.npmDataPath ?? '');
                                    setNpmMysqlConfigured(s.npmDbType === 'mysql' && !!s.npmMysqlHost && !!s.npmMysqlUser && !!s.npmMysqlDb);
                                }
                            }).catch(() => {});
                    }} />}
                    {tab === 'audit'    && <TabAudit />}
                    {tab === 'backup'   && <TabBackup />}
                    {tab === 'aide'     && <TabAide />}
                </div>
            </div>
            {selectedIp && <IpModal ip={selectedIp} onClose={() => setSelectedIp(null)} />}
            <style>{`@keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } } @keyframes f2b-shimmer { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.65; } }`}</style>
        </div>
    );
};
