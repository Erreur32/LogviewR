/**
 * TabStats — Statistiques Fail2ban, aligné sur tabs/stats.php du projet PHP.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    Shield, Ban, AlertTriangle, ShieldOff, Database,
    TrendingUp, Lock, RotateCcw, Clock, Target, BarChart2, Gauge, List, Search, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { card, PERIODS, F2bTooltip } from './helpers';
import { api } from '../../api/client';
import type { JailStatus, BanEntry } from './types';
import { TabJailsEvents } from './TabJails';
import { primeTopsPrevTotalFromFullFetch } from './fail2banTopsPrevFlight';
import { dispatchTabLoaded } from '../../utils/tabTimer';
import { DomainInitial } from './DomainInitial';

// ── Module-level cache (survives tab navigation) ──────────────────────────────
const _cache: Record<string, { data: unknown; ts: number }> = {};
/** Adaptive TTL: recent data expires fast, old data stays cached longer */
function getCacheTtl(days: number): number {
    if (days <= 0)  return 600_000; // all-time: 10min
    if (days <= 2)  return 30_000;  // 24h: 30s
    if (days <= 7)  return 120_000; // 7j: 2min
    return 600_000;                 // 30j, 6m, 1an: 10min
}
function getCached<T>(key: string, days = 7): T | null {
    const e = _cache[key];
    return (e && Date.now() - e.ts < getCacheTtl(days)) ? e.data as T : null;
}
function setCached(key: string, data: unknown) { _cache[key] = { data, ts: Date.now() }; }

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
    bg0: '#0d1117', bg1: '#161b22', bg2: '#21262d', bg3: '#2d333b',
    border: '#30363d', text: '#e6edf3', muted: '#8b949e',
    green: '#3fb950', blue: '#58a6ff', red: '#e86a65',
    orange: '#e3b341', purple: '#bc8cff', cyan: '#39c5cf',
};
const PIE_COLORS = [C.purple, C.green, C.cyan, '#f28a84', C.orange, '#79c0ff', '#56d364', '#ffa657'];

// ── Period button helpers ─────────────────────────────────────────────────────
const btnStyle = (active: boolean, color = C.blue): React.CSSProperties => ({
    padding: '.1rem .4rem', fontSize: '.68rem', borderRadius: 4, cursor: 'pointer',
    border: `1px solid ${active ? `${color}66` : C.border}`,
    background: active ? `${color}1e` : 'transparent',
    color: active ? color : C.muted,
});

/** Returns elapsed seconds since a timestamp, re-renders every 10s */
function useElapsed(ts: number | undefined): number | null {
    const [, setTick] = useState(0);
    useEffect(() => {
        if (!ts) return;
        const id = setInterval(() => setTick(t => t + 1), 10_000);
        return () => clearInterval(id);
    }, [ts]);
    if (!ts) return null;
    return Math.floor((Date.now() - ts) / 1000);
}

const PeriodBtns: React.FC<{ days: number; color?: string; onChange: (d: number) => void }> = ({ days, color, onChange }) => (
    <div style={{ display: 'flex', gap: '.2rem' }}>
        {PERIODS.map(p => (
            <F2bTooltip key={p.days} title={p.label} body={p.title} color="blue">
                <button onClick={() => onChange(p.days)} style={btnStyle(days === p.days, color)}>{p.label}</button>
            </F2bTooltip>
        ))}
    </div>
);

// ── Card wrapper ──────────────────────────────────────────────────────────────
const SCard: React.FC<{
    icon: React.ReactNode; color: string; title: string; sub?: React.ReactNode; children: React.ReactNode;
    right?: React.ReactNode; collapsible?: boolean; defaultOpen?: boolean;
    titleTooltip?: { bodyNode: React.ReactNode; color?: import('./helpers').F2bTtColor };
}> = ({ icon, color, title, sub, children, right, collapsible, defaultOpen = true, titleTooltip }) => {
    const [open, setOpen] = useState(defaultOpen);
    const titleEl = (
        <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{title}
            {sub && <span style={{ fontWeight: 400, fontSize: '.72rem', color: C.muted, marginLeft: '.4rem' }}>{sub}</span>}
        </span>
    );
    return (
        <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ background: C.bg2, padding: '.65rem 1rem', borderBottom: open && !collapsible ? `1px solid ${C.border}` : open ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: '.5rem', cursor: collapsible ? 'pointer' : undefined }}
                onClick={collapsible ? () => setOpen(o => !o) : undefined}>
                <span style={{ color }}>{icon}</span>
                {titleTooltip
                    ? <F2bTooltip title={title} bodyNode={titleTooltip.bodyNode} color={titleTooltip.color ?? 'blue'}>{titleEl}</F2bTooltip>
                    : titleEl}
                {right && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.4rem' }}
                    onClick={e => collapsible && e.stopPropagation()}>{right}</div>}
                {collapsible && <span style={{ color: C.muted, fontSize: '.72rem', marginLeft: right ? '.5rem' : 'auto', transform: open ? undefined : 'rotate(-90deg)', display: 'inline-block', transition: 'transform .15s' }}>▼</span>}
            </div>
            {open && children}
        </div>
    );
};

// ── Domain detail modal ───────────────────────────────────────────────────────
interface DomainDetailBan { ip: string; jail: string; timeofban: number; bantime: number; failures: number }
interface DomainDetailData { ok: boolean; domain: string; jails: string[]; bans: DomainDetailBan[] }

const DomainDetailModal: React.FC<{
    domain: string; days: number;
    onClose: () => void;
    onIpClick?: (ip: string) => void;
}> = ({ domain, days, onClose, onIpClick }) => {
    const { t } = useTranslation();
    const [data, setData]       = useState<DomainDetailData | null>(null);
    const [loading, setLoading] = useState(true);
    const now = Math.floor(Date.now() / 1000);

    useEffect(() => {
        setLoading(true); setData(null);
        api.get<DomainDetailData>(`/api/plugins/fail2ban/tops/domain-detail?domain=${encodeURIComponent(domain)}&days=${days}`)
            .then(res => { if (res.success && res.result?.ok) setData(res.result); })
            .finally(() => setLoading(false));
    }, [domain, days]);

    const fmtDate = (ts: number) => {
        const d = new Date(ts * 1000);
        const p = (n: number) => String(n).padStart(2, '0');
        return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const fmtExpiry = (ban: DomainDetailBan) => {
        if (ban.bantime === -1) return '∞';
        const rem = ban.timeofban + ban.bantime - now;
        if (rem <= 0) return 'expiré';
        if (rem < 3600) return `${Math.round(rem/60)}m`;
        if (rem < 86400) return `${Math.round(rem/3600)}h`;
        return `${Math.round(rem/86400)}j`;
    };

    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;
    const bans = data?.bans ?? [];
    const totalFailures = bans.reduce((s, b) => s + b.failures, 0);

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 10, width: '96vw', maxWidth: 860, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <div style={{ background: C.bg2, padding: '.65rem 1rem', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '.6rem', flexShrink: 0, borderRadius: '10px 10px 0 0' }}>
                    <DomainInitial domain={domain} size={16} />
                    <span style={{ fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700, color: C.cyan }}>{domain}</span>
                    <span style={{ fontSize: '.72rem', color: C.muted }}>· {periodLabel}</span>
                    {!loading && data && (
                        <>
                            <span style={{ fontSize: '.72rem', color: C.cyan, background: `${C.cyan}18`, border: `1px solid ${C.cyan}33`, borderRadius: 4, padding: '.1rem .4rem' }}>{bans.length} IP{bans.length !== 1 ? 's' : ''} bannies</span>
                            <span style={{ fontSize: '.72rem', color: C.orange, background: `${C.orange}18`, border: `1px solid ${C.orange}33`, borderRadius: 4, padding: '.1rem .4rem' }}>{totalFailures} tentatives</span>
                        </>
                    )}
                    <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', padding: '.2rem', borderRadius: 4 }}>
                        <X style={{ width: 15, height: 15 }} />
                    </button>
                </div>

                {/* Jails responsables */}
                {!loading && data && data.jails.length > 0 && (
                    <div style={{ padding: '.5rem 1rem', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '.4rem', flexShrink: 0, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '.68rem', color: C.muted }}>Jails fail2ban responsables :</span>
                        {data.jails.map(j => (
                            <span key={j} style={{ fontFamily: 'monospace', fontSize: '.68rem', background: 'rgba(63,185,80,.08)', color: C.green, border: `1px solid ${C.green}33`, borderRadius: 3, padding: '.05rem .3rem' }}>{j}</span>
                        ))}
                        <span style={{ fontSize: '.65rem', color: C.muted, marginLeft: '.3rem' }}>— seules les IPs bannies par ces jails ET présentes dans le log de ce domaine sont comptées</span>
                    </div>
                )}

                {/* Content */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                    {loading && <div style={{ padding: '2rem', textAlign: 'center', color: C.muted, fontSize: '.85rem' }}>{t('fail2ban.messages.loadingData')}</div>}
                    {!loading && !data && <div style={{ padding: '1.5rem', color: C.orange, fontSize: '.82rem', textAlign: 'center' }}>Données non disponibles (NPM non configuré ?)</div>}
                    {!loading && data && data.jails.length === 0 && (
                        <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '.82rem', color: C.green }}>
                            ✓ Aucun jail fail2ban ne surveille ce domaine — 0 bans attribuables.
                        </div>
                    )}
                    {!loading && data && data.jails.length > 0 && bans.length === 0 && (
                        <div style={{ padding: '1.5rem', textAlign: 'center', fontSize: '.82rem', color: C.green }}>
                            ✓ Aucun IP bannie n'est apparue dans le log de ce domaine sur la période.
                        </div>
                    )}
                    {!loading && data && bans.length > 0 && (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
                            <thead>
                                <tr style={{ background: C.bg2, position: 'sticky', top: 0 }}>
                                    {['IP', 'Jail', 'Ban le', 'Tentatives', 'Expiry'].map(h => (
                                        <th key={h} style={{ padding: '.4rem .75rem', borderBottom: `1px solid ${C.border}`, fontSize: '.65rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.04em', color: C.muted, textAlign: h === 'IP' || h === 'Jail' ? 'left' : 'center', whiteSpace: 'nowrap' as const }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {bans.map((b, i) => (
                                    <tr key={`${b.ip}-${b.timeofban}`} style={{ borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? 'transparent' : `${C.bg1}55` }}>
                                        <td style={{ padding: '.35rem .75rem', whiteSpace: 'nowrap' as const }}>
                                            {onIpClick
                                                ? <button onClick={() => { onIpClick(b.ip); onClose(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: '.78rem', color: C.blue, fontWeight: 600 }}>{b.ip}</button>
                                                : <span style={{ fontFamily: 'monospace', color: C.red, fontWeight: 600 }}>{b.ip}</span>
                                            }
                                        </td>
                                        <td style={{ padding: '.35rem .75rem' }}>
                                            <span style={{ fontFamily: 'monospace', fontSize: '.72rem', color: C.green }}>{b.jail}</span>
                                        </td>
                                        <td style={{ padding: '.35rem .75rem', textAlign: 'center', color: C.muted, whiteSpace: 'nowrap' as const }}>{fmtDate(b.timeofban)}</td>
                                        <td style={{ padding: '.35rem .75rem', textAlign: 'center', fontWeight: 700, color: b.failures >= 20 ? C.red : b.failures >= 5 ? C.orange : C.muted }}>{b.failures}</td>
                                        <td style={{ padding: '.35rem .75rem', textAlign: 'center', fontSize: '.72rem', color: C.muted }}>{fmtExpiry(b)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};

// ── IPSet historical line chart (module-level — prevents React remount on each IpSetsSection render) ──
type IpSetHist = { ipset_names: string[]; ipset_days: Record<string, Record<string, number>> } | null;

const HistChart: React.FC<{ hist: IpSetHist; days: number; onDaysChange: (d: number) => void }> = ({ hist, days, onDaysChange }) => {
    const names = hist?.ipset_names ?? [];
    const days_map = hist?.ipset_days ?? {};
    const rawDates = Object.keys(days_map).sort();
    const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set());
    const toggleLine = (nm: string) => setHiddenLines(prev => { const s = new Set(prev); s.has(nm) ? s.delete(nm) : s.add(nm); return s; });
    const containerRef = useRef<HTMLDivElement>(null);
    const [svgW, setSvgW] = useState(800);
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const measure = () => setSvgW(el.clientWidth || 800);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // 24h mode: expand daily snapshot into hourly slots (0h → current hour)
    const hourly = days === 1;
    let plotDates: string[];
    let plotMap: Record<string, Record<string, number>>;
    if (hourly && rawDates.length > 0) {
        const today = rawDates[rawDates.length - 1];
        const isToday = today === new Date().toISOString().slice(0, 10);
        const maxHour = isToday ? new Date().getHours() : 23;
        plotDates = Array.from({ length: maxHour + 1 }, (_, h) => `${today} ${String(h).padStart(2, '0')}`);
        plotMap = Object.fromEntries(plotDates.map(dt => [dt, days_map[today] ?? {}]));
    } else {
        plotDates = rawDates;
        plotMap = days_map;
    }

    const xLabel = (dt: string) => {
        if (hourly && dt.includes(' ')) return `${parseInt(dt.split(' ')[1], 10)}h`;
        return dt.slice(5);
    };
    const tipText = (dt: string, nm: string, v: number) => {
        if (hourly && dt.includes(' ')) {
            const [datePart, hStr] = dt.split(' ');
            const h = parseInt(hStr, 10);
            const [, mo, d] = datePart.split('-');
            return `${d}/${mo} ${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00 — ${nm}: ${v}`;
        }
        return `${dt} — ${nm}: ${v}`;
    };

    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;

    if (!plotDates.length || !names.length) {
        return (
            <div style={{ padding: '1rem 1rem .5rem', borderBottom: `1px solid ${C.border}` }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem' }}>
                    <span style={{ fontSize: '.72rem', color: C.muted }}>Historique ({periodLabel})</span>
                    <PeriodBtns days={days} color={C.purple} onChange={onDaysChange} />
                </div>
                <div style={{ padding: '.75rem', textAlign: 'center', fontSize: '.78rem', color: C.muted, border: `1px dashed ${C.border}`, borderRadius: 6 }}>
                    Aucune donnée historique — les snapshots sont enregistrés à chaque visite de cet onglet.
                </div>
            </div>
        );
    }
    const VW = svgW, VH = 90, PAD_T = 8, PAD_B = 18;
    const aH = VH - PAD_T - PAD_B;
    const n = plotDates.length;
    const xOf = (i: number) => n > 1 ? (i / (n - 1)) * VW : VW / 2;
    const maxV = Math.max(1, ...names.flatMap(nm => plotDates.map(dt => plotMap[dt]?.[nm] ?? 0)));
    const yOf = (v: number) => PAD_T + aH - (v / maxV) * aH;
    const every = Math.max(1, Math.ceil(n / 14));

    return (
        <div style={{ padding: '1rem 1rem .5rem', borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.5rem' }}>
                <span style={{ fontSize: '.72rem', color: C.muted }}>Historique ({periodLabel})</span>
                <PeriodBtns days={days} color={C.purple} onChange={onDaysChange} />
            </div>
            <div ref={containerRef} style={{ width: '100%' }}>
            <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none" style={{ width: '100%', height: VH, display: 'block', overflow: 'visible' }}>
                {/* Grid lines */}
                {[0, 0.5, 1].map(f => {
                    const y = yOf(f * maxV);
                    return <line key={f} x1={0} y1={y} x2={VW} y2={y} stroke="rgba(128,128,128,.1)" strokeWidth={f === 0 ? 1 : 0.5} />;
                })}
                <text x={3} y={yOf(maxV * 0.5) - 2} fontSize={9} fill="rgba(128,128,128,.4)">{Math.round(maxV * 0.5)}</text>
                {/* Lines per set */}
                {names.map((nm, ni) => {
                    if (hiddenLines.has(nm)) return null;
                    const color = PIE_COLORS[ni % PIE_COLORS.length];
                    const pts = plotDates.map((dt, i) => {
                        const v = plotMap[dt]?.[nm];
                        return v != null ? `${xOf(i)},${yOf(v)}` : null;
                    }).filter(Boolean) as string[];
                    if (!pts.length) return null;
                    const firstX = pts[0].split(',')[0];
                    const lastX  = pts[pts.length - 1].split(',')[0];
                    const lastDtIdx = [...plotDates].map((dt, i) => ({ dt, i, v: plotMap[dt]?.[nm] })).reverse().find(x => x.v != null);
                    return (
                        <g key={nm}>
                            <polygon points={`${pts.join(' ')} ${lastX},${yOf(0)} ${firstX},${yOf(0)}`} fill={color} opacity={0.06} />
                            <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray="5,3" strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
                            {plotDates.map((dt, i) => {
                                const v = plotMap[dt]?.[nm];
                                if (v == null) return null;
                                return <circle key={dt} cx={xOf(i)} cy={yOf(v)} r={4} fill="transparent" stroke="none"><title>{tipText(dt, nm, v)}</title></circle>;
                            })}
                            {lastDtIdx && (
                                <>
                                    <circle cx={xOf(lastDtIdx.i)} cy={yOf(lastDtIdx.v!)} r={3} fill={color} stroke={C.bg1} strokeWidth={1.2} opacity={0.95} />
                                    <text x={xOf(lastDtIdx.i) + (lastDtIdx.i > n * 0.8 ? -6 : 6)} y={yOf(lastDtIdx.v!) - 4} fontSize={9} fill={color} textAnchor={lastDtIdx.i > n * 0.8 ? 'end' : 'start'} fontWeight={600}>{lastDtIdx.v}</text>
                                </>
                            )}
                        </g>
                    );
                })}
                {/* X-axis labels */}
                {plotDates.map((dt, i) => (i % every === 0 || i === n - 1) && (
                    <text key={dt} x={xOf(i)} y={VH - 1} fontSize={8} fill="rgba(128,128,128,.5)" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{xLabel(dt)}</text>
                ))}
            </svg>
            </div>
            {/* Legend — dashed-line icons, clickable to toggle */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.4rem .8rem', marginTop: '.5rem' }}>
                {names.map((nm, ni) => {
                    const hidden = hiddenLines.has(nm);
                    const lineColor = hidden ? C.muted : PIE_COLORS[ni % PIE_COLORS.length];
                    return (
                        <div key={nm} onClick={() => toggleLine(nm)}
                            style={{ display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.72rem', cursor: 'pointer', opacity: hidden ? 0.35 : 1 }}>
                            <svg width={18} height={8} style={{ flexShrink: 0 }}>
                                <line x1={0} y1={4} x2={18} y2={4} stroke={lineColor} strokeWidth={2} strokeDasharray="5,3" />
                            </svg>
                            <span style={{ fontFamily: 'monospace', color: hidden ? C.muted : C.text }}>{nm}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ── IPSets ────────────────────────────────────────────────────────────────────
interface IpSetInfo { name: string; entries: number; type: string }

const IpSetsSection: React.FC<{ days: number; onDaysChange: (d: number) => void }> = ({ days, onDaysChange }) => {
    const { t } = useTranslation();
    const [sets, setSets]       = useState<IpSetInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState<string | null>(null);
    const [hist, setHist]       = useState<IpSetHist>(null);

    // /ipset/info: structured data + triggers daily snapshot
    useEffect(() => {
        const cached = getCached<{ sets: { name: string; entries: number; type: string }[] }>('ipset:info');
        if (cached) { setSets([...cached.sets].filter(s => !s.name.startsWith('docker-')).sort((a, b) => b.entries - a.entries)); setLoading(false); }
        api.get<{ ok: boolean; sets: { name: string; entries: number; type: string }[]; error?: string }>('/api/plugins/fail2ban/ipset/info')
            .then(res => {
                if (res.success && res.result?.ok && res.result.sets.length > 0) {
                    setCached('ipset:info', res.result);
                    setSets([...res.result.sets].filter(s => !s.name.startsWith('docker-')).sort((a, b) => b.entries - a.entries));
                } else if (!cached) {
                    setError(res.result?.error ?? 'IPSet non disponible (NET_ADMIN requis)');
                }
            }).catch(e => { if (!cached) setError(String(e)); }).finally(() => setLoading(false));
    }, []);

    // Historical data for the line chart — synced with global period
    useEffect(() => {
        const ac = new AbortController();
        const key = `ipset:history:${days}`;
        const cached = getCached<IpSetHist>(key, days);
        if (cached) setHist(cached);
        api.get<{ ok: boolean; ipset_names: string[]; ipset_days: Record<string, Record<string, number>> }>(
            `/api/plugins/fail2ban/ipset/history?days=${days}`,
            { signal: ac.signal }
        )
            .then(res => {
                if (!ac.signal.aborted && res.success && res.result?.ok) {
                    setCached(key, res.result);
                    setHist(res.result);
                }
            })
            .catch(() => {});
        return () => ac.abort();
    }, [days]);

    const maxEntries = Math.max(...sets.map(s => s.entries), 1);
    const total = sets.reduce((s, x) => s + x.entries, 0);

    // IPSet pie toggle
    const [hiddenSets, setHiddenSets] = useState<Set<string>>(new Set());
    const toggleSet = (name: string) => setHiddenSets(prev => { const s = new Set(prev); s.has(name) ? s.delete(name) : s.add(name); return s; });
    const visibleSets = sets.filter(s => s.entries > 0 && !hiddenSets.has(s.name));
    const visibleTotal = visibleSets.reduce((s, x) => s + x.entries, 0);
    let acc = -90;
    const slices = sets.filter(s => s.entries > 0).map((s, i) => {
        const hidden = hiddenSets.has(s.name);
        const deg = !hidden && visibleTotal > 0 ? (s.entries / visibleTotal) * 360 : 0;
        const start = (acc * Math.PI) / 180; const end = ((acc + deg) * Math.PI) / 180;
        if (!hidden) acc += deg;
        const [cx, cy, r] = [80, 80, 65];
        const x1 = cx + r * Math.cos(start); const y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end);   const y2 = cy + r * Math.sin(end);
        return { ...s, x1, y1, x2, y2, large: deg >= 180 ? 1 : 0, pct: visibleTotal > 0 ? Math.round((s.entries / visibleTotal) * 100) : 0, color: PIE_COLORS[i % PIE_COLORS.length], hidden, deg };
    });

    return (
        <SCard icon={<Database style={{ width: 14, height: 14 }} />} color={C.purple} title="IPSets" sub={!loading && !error && total > 0 ? <span style={{ color: C.purple, fontWeight: 600 }}>{total} IPs</span> : undefined} collapsible>
            {/* Historical line chart */}
            <HistChart hist={hist} days={days} onDaysChange={onDaysChange} />
            <div style={{ padding: '.5rem 0 .75rem' }}>
                {loading && <div style={{ textAlign: 'center', padding: '1.5rem', color: C.muted, fontSize: '.85rem' }}>{t('fail2ban.messages.loadingData')}</div>}
                {!loading && error && <div style={{ padding: '.75rem 1rem', color: C.orange, fontSize: '.8rem', fontFamily: 'monospace' }}>{error}</div>}
                {!loading && !error && sets.length === 0 && <div style={{ padding: '1.5rem 1rem', color: C.muted, fontSize: '.85rem', textAlign: 'center' }}>Aucun IPSet fail2ban à afficher</div>}
                {!loading && !error && sets.length > 0 && (
                    <div style={{ padding: '0 1rem .75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                        {/* Bar list — constrained width so bars don't stretch the full card */}
                        <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '.1rem', paddingTop: '.5rem' }}>
                            {sets.map(s => (
                                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.28rem 0' }}>
                                    <span style={{ fontSize: '.78rem', color: C.purple, width: 120, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{s.name}</span>
                                    {s.type && <span style={{ fontSize: '.63rem', color: C.muted, width: 65, whiteSpace: 'nowrap', flexShrink: 0 }}>{s.type}</span>}
                                    <div style={{ width: 80, background: C.bg3, borderRadius: 3, height: 5, overflow: 'hidden', flexShrink: 0 }}>
                                        <div style={{ width: `${s.entries > 0 ? Math.max(2, (s.entries / maxEntries) * 100) : 0}%`, height: '100%', background: C.purple, borderRadius: 3 }} />
                                    </div>
                                    <span style={{ fontSize: '.78rem', fontWeight: 700, color: C.purple, minWidth: 36, textAlign: 'right' }}>{s.entries}</span>
                                    <span style={{ fontSize: '.67rem', color: C.muted }}>IP{s.entries !== 1 ? 's' : ''}</span>
                                </div>
                            ))}
                        </div>
                        {/* Pie + legend side by side */}
                        {total > 0 && (
                            <div style={{ flexShrink: 0, display: 'flex', gap: '1rem', alignItems: 'center', paddingTop: '.5rem' }}>
                                <svg viewBox="0 0 160 160" style={{ width: 130, height: 130, flexShrink: 0 }}>
                                    {slices.filter(s => !s.hidden && s.deg > 0).map(s => (
                                        <path key={s.name} d={`M 80 80 L ${s.x1} ${s.y1} A 65 65 0 ${s.large} 1 ${s.x2} ${s.y2} Z`}
                                            fill={s.color} stroke={C.bg1} strokeWidth={1.5} opacity={0.9}
                                            style={{ cursor: 'pointer' }} onClick={() => toggleSet(s.name)}>
                                            <title>{s.name}: {s.entries} IPs ({s.pct}%) — cliquer pour masquer</title>
                                        </path>
                                    ))}
                                    <circle cx={80} cy={80} r={22.75} fill={C.bg1} stroke={C.border} />
                                    <text x={80} y={85} fontSize={12} fontWeight={700} fill={C.text} textAnchor="middle">{visibleTotal}</text>
                                </svg>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                                    {slices.map(s => (
                                        <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', opacity: s.hidden ? 0.35 : 1 }}
                                            onClick={() => toggleSet(s.name)}>
                                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.hidden ? C.muted : s.color, flexShrink: 0 }} />
                                            <span style={{ fontSize: '.72rem', fontFamily: 'monospace', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: s.hidden ? C.muted : s.color }}>{s.name}</span>
                                            <span style={{ fontSize: '.72rem', fontWeight: 700, color: s.hidden ? C.muted : s.color, flexShrink: 0 }}>{s.entries}</span>
                                            <span style={{ fontSize: '.68rem', color: C.muted, flexShrink: 0, minWidth: 30, textAlign: 'right' }}>{s.hidden ? '—' : `${s.pct}%`}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </SCard>
    );
};

// ── Tops section ──────────────────────────────────────────────────────────────
interface TopEntry { ip?: string; jail?: string; count: number; secondary?: number }
interface TopsData {
    ok: boolean;
    topIps: { ip: string; count: number }[];
    topJails: { jail: string; count: number }[];
    topRecidivists: { ip: string; count: number }[];
    topDomains: { domain: string; count: number; failures?: number }[];
    heatmap: { hour: number; count: number }[];
    heatmapFailed: { hour: number; count: number }[];
    heatmapWeek: number[][];
    heatmapFailedWeek: number[][];
    summary: { totalBans: number; uniqueIps: number; topJail: string | null; topJailCount: number; totalFailures: number; expiredInPeriod: number };
    prevSummary?: { totalBans: number; uniqueIps: number; topJail: string | null; topJailCount: number; totalFailures: number; expiredInPeriod: number } | null;
}

const TopCard: React.FC<{ icon: React.ReactNode; title: string; color: string; periodLabel?: string; entries: TopEntry[]; loading: boolean; labelKey: 'ip' | 'jail'; viewMode: 'bar' | 'pie'; limit: number; rowPrefix?: (label: string) => React.ReactNode; emptyMsg?: string; secondaryLabel?: string; onIpClick?: (ip: string) => void; onLabelClick?: (label: string) => void }> = ({ icon, title, color, periodLabel, entries, loading, labelKey, viewMode, limit, rowPrefix, emptyMsg, secondaryLabel, onIpClick, onLabelClick }) => {
    const displayed = limit === 0 ? entries : entries.slice(0, limit);
    const hasMore   = limit > 0 && entries.length > limit;
    const max   = Math.max(...entries.map(e => e.count), 1);
    const rgb   = color === C.red ? '232,106,101' : color === C.orange ? '227,179,65' : color === C.cyan ? '57,197,207' : '88,166,255';

    // Pie toggle state
    const [hiddenPie, setHiddenPie] = useState<Set<string>>(new Set());
    const togglePie = (label: string) => setHiddenPie(prev => { const s = new Set(prev); s.has(label) ? s.delete(label) : s.add(label); return s; });

    // Pie slices (up to 8 entries) — only visible ones consume arc space
    const pieEntries = entries.slice(0, 8);
    const visibleTotal = pieEntries.filter(e => !hiddenPie.has(labelKey === 'ip' ? e.ip! : e.jail!)).reduce((s, e) => s + e.count, 0);
    let pieAcc = -90;
    const pieSlices = pieEntries.map((e, i) => {
        const label = labelKey === 'ip' ? e.ip! : e.jail!;
        const hidden = hiddenPie.has(label);
        const deg = !hidden && visibleTotal > 0 ? (e.count / visibleTotal) * 360 : 0;
        const start = (pieAcc * Math.PI) / 180;
        const end   = ((pieAcc + deg) * Math.PI) / 180;
        if (!hidden) pieAcc += deg;
        const [cx, cy, r] = [70, 70, 58];
        const x1 = cx + r * Math.cos(start); const y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end);   const y2 = cy + r * Math.sin(end);
        return { label, count: e.count, pct: visibleTotal > 0 ? Math.round((e.count / visibleTotal) * 100) : 0, color: PIE_COLORS[i % PIE_COLORS.length], x1, y1, x2, y2, large: deg >= 180 ? 1 : 0, hidden, deg };
    });

    return (
        <div style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ background: C.bg2, padding: '.5rem .75rem', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '.4rem', flexShrink: 0 }}>
                <span style={{ color }}>{icon}</span>
                <span style={{ fontWeight: 600, fontSize: '.82rem' }}>{title}</span>
                {periodLabel && <span style={{ fontSize: '.65rem', color: C.muted, fontWeight: 400 }}>({periodLabel})</span>}
                {!loading && <span style={{ marginLeft: 'auto', fontSize: '.68rem', background: `rgba(${rgb},.1)`, color, border: `1px solid ${color}40`, borderRadius: 4, padding: '.08rem .4rem' }}>{entries.length}</span>}
            </div>
            {secondaryLabel && viewMode === 'bar' && entries.length > 0 && !loading && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, padding: '.2rem .75rem .0rem', borderBottom: `1px solid ${C.border}20`, flexShrink: 0 }}>
                    <span style={{ fontSize: '.62rem', color, fontWeight: 600 }}>bans</span>
                    <span style={{ fontSize: '.62rem', color: C.border }}>|</span>
                    <span style={{ fontSize: '.62rem', color: C.orange, fontWeight: 600 }}>{secondaryLabel}</span>
                </div>
            )}
            {/* Body */}
            <div style={{ flex: 1, padding: viewMode === 'pie' ? '1rem' : '0', position: 'relative' }}>
                {loading ? (
                    <div style={{ padding: '.35rem 0 .5rem' }}>
                        {Array.from({ length: 7 }, (_, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.32rem .65rem' }}>
                                <span style={{ color: C.muted, fontSize: '.68rem', minWidth: 14, textAlign: 'right', opacity: .4 }}>{i + 1}</span>
                                <div style={{ flex: 1, height: 9, background: C.bg3, borderRadius: 3, animation: `f2b-shimmer 1.6s ease-in-out ${(i * 0.12).toFixed(2)}s infinite` }} />
                                <div style={{ width: 28, height: 9, background: C.bg3, borderRadius: 3, animation: `f2b-shimmer 1.6s ease-in-out ${(i * 0.12).toFixed(2)}s infinite` }} />
                            </div>
                        ))}
                    </div>
                )
                : entries.length === 0 ? <div style={{ textAlign: 'center', padding: '1rem', color: C.muted, fontSize: '.78rem' }}>{emptyMsg ?? 'Aucune donnée'}</div>
                : viewMode === 'pie' ? (
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <svg viewBox="0 0 140 140" style={{ width: 120, height: 120, flexShrink: 0 }}>
                            {pieSlices.filter(s => !s.hidden && s.deg > 0).map(s => (
                                <path key={s.label} d={`M 70 70 L ${s.x1} ${s.y1} A 58 58 0 ${s.large} 1 ${s.x2} ${s.y2} Z`}
                                    fill={s.color} stroke={C.bg1} strokeWidth={1.5} opacity={0.9}
                                    style={{ cursor: 'pointer' }} onClick={() => togglePie(s.label)}>
                                    <title>{s.label}: {s.count} ({s.pct}%) — cliquer pour masquer</title>
                                </path>
                            ))}
                            <circle cx={70} cy={70} r={20} fill={C.bg1} stroke={C.border} />
                            <text x={70} y={73} fontSize={10} fontWeight={700} fill={C.text} textAnchor="middle">{visibleTotal}</text>
                        </svg>
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                            {pieSlices.map((s, i) => {
                                const clickable = labelKey === 'ip' && !!onIpClick && !s.hidden;
                                return (
                                    <div key={s.label} style={{ display: 'flex', alignItems: 'flex-start', gap: '.35rem', cursor: 'pointer', opacity: s.hidden ? 0.35 : 1 }}
                                        onClick={() => togglePie(s.label)}>
                                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.hidden ? C.muted : PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0, marginTop: 3 }} />
                                        {clickable ? (
                                            <button onClick={(ev) => { ev.stopPropagation(); onIpClick!(s.label); }} style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: '.72rem', color: '#e6edf3', fontWeight: 600, wordBreak: 'break-all', textAlign: 'left', lineHeight: 1.3 }}>{s.label}</button>
                                        ) : (
                                            <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '.72rem', color: s.hidden ? C.muted : PIE_COLORS[i % PIE_COLORS.length], wordBreak: 'break-all', lineHeight: 1.3 }}>{s.label}</span>
                                        )}
                                        <span style={{ fontSize: '.7rem', fontWeight: 700, color: s.hidden ? C.muted : PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }}>{s.count}</span>
                                        <span style={{ fontSize: '.65rem', color: C.muted, flexShrink: 0, minWidth: 28, textAlign: 'right' }}>{s.hidden ? '—' : `${s.pct}%`}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    <div style={{ position: 'relative', paddingTop: '.4rem', paddingBottom: '.5rem' }}>
                        {displayed.map((e, i) => {
                            const label = labelKey === 'ip' ? e.ip! : e.jail!;
                            const clickable = !!onLabelClick || (labelKey === 'ip' && !!onIpClick);
                            const handleLabelClick = onLabelClick ? () => onLabelClick(label) : (onIpClick ? () => onIpClick(label) : undefined);
                            const ratio = e.count / max;
                            // Gravity gradient: full color → 55% opacity, dimmer for lower ranks
                            const rankOpacity = Math.max(0.45, 1 - (i / Math.max(displayed.length - 1, 1)) * 0.5);
                            return (
                                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.22rem .75rem' }}>
                                    <span style={{ width: 18, fontSize: '.65rem', color: C.muted, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                                    {rowPrefix && <span style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>{rowPrefix(label)}</span>}
                                    {clickable ? (
                                        <button onClick={handleLabelClick}
                                            style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: '.75rem', color: '#e6edf3', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                                            {label}
                                        </button>
                                    ) : (
                                        <span style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: '.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color }}>
                                            {label}
                                        </span>
                                    )}
                                    <div style={{ width: 60, background: C.bg3, borderRadius: 2, height: 4, overflow: 'hidden', flexShrink: 0 }}>
                                        <div style={{ width: `${Math.max(4, ratio * 100)}%`, height: '100%', borderRadius: 2, background: `linear-gradient(to right, ${color}, ${color}${Math.round(rankOpacity * 255).toString(16).padStart(2, '0')})` }} />
                                    </div>
                                    <span style={{ width: 32, textAlign: 'right', fontWeight: 700, fontSize: '.75rem', color, flexShrink: 0, opacity: rankOpacity }}>{e.count}</span>
                                    {secondaryLabel !== undefined && e.secondary !== undefined && (
                                        <span style={{ width: 38, textAlign: 'right', fontSize: '.72rem', fontWeight: 600, color: C.orange, flexShrink: 0, opacity: rankOpacity }}>{e.secondary}</span>
                                    )}
                                </div>
                            );
                        })}
                        {/* Bottom gravity fade — if list is truncated */}
                        {hasMore && (
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 36, background: `linear-gradient(to bottom, transparent, ${C.bg0})`, pointerEvents: 'none', borderRadius: '0 0 8px 8px' }} />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Trend marker ──────────────────────────────────────────────────────────────
type SummaryKey = 'totalBans' | 'uniqueIps' | 'topJailCount';
const TrendBadge: React.FC<{ curr: number; prev: number | null }> = ({ curr, prev }) => {
    if (prev === null) return <span style={{ fontSize: '.7rem', color: '#555d69', marginLeft: '.3rem' }}>…</span>;
    const delta = curr - prev;
    const pct   = prev > 0 ? Math.abs(Math.round((delta / prev) * 100)) : null;
    if (delta > 0) return <span title={`+${delta} vs période précédente`} style={{ fontSize: '.72rem', color: '#e86a65', marginLeft: '.3rem', fontWeight: 700, whiteSpace: 'nowrap' }}>▲ {pct != null ? `${pct}%` : `+${delta}`}</span>;
    if (delta < 0) return <span title={`${delta} vs période précédente`}  style={{ fontSize: '.72rem', color: '#3bc4cf', marginLeft: '.3rem', fontWeight: 700, whiteSpace: 'nowrap' }}>▼ {pct != null ? `${pct}%` : `${delta}`}</span>;
    return <span title="Stable vs période précédente" style={{ fontSize: '.72rem', color: '#8b949e', marginLeft: '.3rem', fontWeight: 600 }}>= stable</span>;
};

// ── Résumé période ────────────────────────────────────────────────────────────
const ResumePeriodeSection: React.FC<{
    days: number; onDaysChange: (d: number) => void;
    data: TopsData['summary'] | null;
    prev: { totalBans: number; uniqueIps: number; topJail: string | null; topJailCount: number } | null;
    loading: boolean;
}> = ({ days, onDaysChange, data, prev, loading }) => {
    const { t } = useTranslation();

    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;
    const prevLabel   = days === 1 ? 'hier' : `${days}j précédents`;

    return (
        <SCard icon={<Gauge style={{ width: 14, height: 14 }} />} color={C.green} title={t('fail2ban.stats.periodSummary')}
            sub={`(${periodLabel})`}
            right={<PeriodBtns days={days} color={C.green} onChange={onDaysChange} />}
            collapsible>
            <div style={{ padding: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: '.75rem' }}>
                {([
                    { l: t('fail2ban.status.totalBans'),      k: 'totalBans'    as SummaryKey | null, v: data?.totalBans    ?? 0,    c: C.red,    small: false, icon: <Ban    style={{ width: 14, height: 14 }} /> },
                    { l: t('fail2ban.status.uniqueIps'),     k: 'uniqueIps'    as SummaryKey | null, v: data?.uniqueIps    ?? 0,    c: C.blue,   small: false, icon: <Shield style={{ width: 14, height: 14 }} /> },
                    { l: 'Jail le + actif', k: null                                , v: data?.topJail     ?? '—',  c: C.orange, small: true,  icon: <Lock   style={{ width: 14, height: 14 }} /> },
                    { l: 'Bans jail #1',    k: 'topJailCount' as SummaryKey | null, v: data?.topJailCount ?? 0,    c: C.orange, small: false, icon: <Target style={{ width: 14, height: 14 }} /> },
                ]).map(s => (
                    <div key={s.l} style={{ background: C.bg2, borderRadius: 7, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '.72rem', color: C.muted }}>
                            <span>{s.l}</span><span style={{ color: s.c }}>{s.icon}</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 0 }}>
                            <span style={{ fontSize: s.small ? '1rem' : '1.6rem', fontWeight: 700, color: s.c, lineHeight: 1.1, fontFamily: s.small ? 'monospace' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {loading ? '…' : s.v}
                            </span>
                            {!loading && s.k && <TrendBadge curr={s.v as number} prev={prev?.[s.k]} />}
                        </div>
                        {!loading && s.k && prev != null && (
                            <div style={{ fontSize: '.65rem', color: C.muted }}>vs {prevLabel}: {prev[s.k]}</div>
                        )}
                    </div>
                ))}
            </div>
        </SCard>
    );
};

// ── Types d'attaque ───────────────────────────────────────────────────────────
const TypesAttaqueSection: React.FC<{ days: number; onDaysChange: (d: number) => void; data: TopsData | null; loading: boolean }> = ({ days, onDaysChange, data, loading }) => {
    const { t } = useTranslation();
    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;
    const jails = data?.topJails ?? [];
    const total = jails.reduce((s, j) => s + j.count, 0);
    let pieAcc = -90;
    const slices = jails.slice(0, 8).map((j, i) => {
        const deg = (j.count / Math.max(total, 1)) * 360;
        const start = (pieAcc * Math.PI) / 180; const end = ((pieAcc + deg) * Math.PI) / 180; pieAcc += deg;
        const [cx, cy, r] = [80, 80, 65];
        const x1 = cx + r * Math.cos(start); const y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end);   const y2 = cy + r * Math.sin(end);
        return { ...j, x1, y1, x2, y2, large: deg >= 180 ? 1 : 0, pct: Math.round((j.count / total) * 100), color: PIE_COLORS[i % PIE_COLORS.length] };
    });

    return (
        <SCard icon={<Target style={{ width: 14, height: 14 }} />} color={C.red} title="Types d'attaque"
            sub={`(${periodLabel})`}
            right={<PeriodBtns days={days} color={C.red} onChange={onDaysChange} />}
            collapsible>
            <div style={{ padding: '1rem' }}>
                {loading && <div style={{ textAlign: 'center', padding: '1.5rem', color: C.muted, fontSize: '.85rem' }}>{t('fail2ban.messages.loadingData')}</div>}
                {!loading && jails.length === 0 && <div style={{ textAlign: 'center', padding: '1.5rem', color: C.muted, fontSize: '.85rem' }}>{t('fail2ban.status.noData')}</div>}
                {!loading && jails.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', alignItems: 'flex-start' }}>
                        {total > 0 && <svg viewBox="0 0 160 160" style={{ width: 160, height: 160, flexShrink: 0 }}>
                            {slices.map(s => <path key={s.jail} d={`M 80 80 L ${s.x1} ${s.y1} A 65 65 0 ${s.large} 1 ${s.x2} ${s.y2} Z`} fill={s.color} stroke={C.bg1} strokeWidth={1.5} opacity={0.9}><title>{s.jail}: {s.count} bans ({s.pct}%)</title></path>)}
                            <circle cx={80} cy={80} r={22.75} fill={C.bg1} stroke={C.border} />
                            <text x={80} y={82} fontSize={11} fontWeight={700} fill={C.text} textAnchor="middle">{total}</text>
                            <text x={80} y={95} fontSize={8} fill={C.muted} textAnchor="middle">bans</text>
                        </svg>}
                        <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                            {jails.map((j, i) => (
                                <div key={j.jail} style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                    <span style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                                    <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.jail}</span>
                                    <div style={{ width: 80, background: C.bg3, borderRadius: 2, height: 4, overflow: 'hidden' }}>
                                        <div style={{ width: `${Math.max(2, (j.count / Math.max(...jails.map(x => x.count), 1)) * 100)}%`, height: '100%', background: PIE_COLORS[i % PIE_COLORS.length], borderRadius: 2 }} />
                                    </div>
                                    <span style={{ fontSize: '.78rem', fontWeight: 700, color: PIE_COLORS[i % PIE_COLORS.length], minWidth: 36, textAlign: 'right' }}>{j.count}</span>
                                    <span style={{ fontSize: '.65rem', color: C.muted, minWidth: 30, textAlign: 'right' }}>{Math.round((j.count / total) * 100)}%</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </SCard>
    );
};

// ── Heatmap (bans or failures) — peak-hours bars + 7×24 week grid ─────────────
const DAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const HeatmapSection: React.FC<{
    days: number; onDaysChange: (d: number) => void;
    dataKey: 'heatmap' | 'heatmapFailed'; weekKey: 'heatmapWeek' | 'heatmapFailedWeek';
    title: string; icon: React.ReactNode; color: string; barRgb: string; cellRgb: string; label: string;
    data: TopsData | null; loading: boolean;
}> = ({ days, onDaysChange, dataKey, weekKey, title, icon, color, barRgb, cellRgb, label, data, loading }) => {

    const hours = useMemo(() => {
        const raw = data?.[dataKey] ?? [];
        const map = new Map((raw as { hour: number; count: number }[]).map(h => [h.hour, h.count]));
        return Array.from({ length: 24 }, (_, i) => map.get(i) ?? 0);
    }, [data, dataKey]);

    const week: number[][] = useMemo(() => {
        const raw = data?.[weekKey];
        if (Array.isArray(raw) && raw.length === 7) return raw as number[][];
        return Array.from({ length: 7 }, () => new Array(24).fill(0));
    }, [data, weekKey]);

    const maxH        = Math.max(...hours, 1);
    const maxW        = Math.max(...week.flat(), 1);
    const peakHIdx    = hours.indexOf(Math.max(...hours));
    const total       = hours.reduce((s, c) => s + c, 0);
    const avg         = total > 0 ? total / 24 : 0;
    const dayTotals   = week.map(row => row.reduce((s, c) => s + c, 0));
    const peakDayIdx  = dayTotals.indexOf(Math.max(...dayTotals));
    const quietH      = hours.map((c, h) => ({ c, h })).filter(x => x.c > 0).sort((a, b) => a.c - b.c)[0];
    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;

    // ── Single hover tooltip state (shared by bars + cells) ───────────────────
    const [tip, setTip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

    const titleTooltipBody = total === 0 ? (
        <div style={{ fontSize: '.78rem', color: C.muted }}>Aucune donnée sur la période {periodLabel}.</div>
    ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 800, color, lineHeight: 1.1 }}>
                {total.toLocaleString()} <span style={{ fontSize: '.72rem', fontWeight: 600, opacity: .75 }}>{label}s</span>
            </div>
            <div style={{ fontSize: '.75rem', color: '#e6edf3', lineHeight: 1.5 }}>
                Répartition sur la période {periodLabel}.
            </div>
            <div style={{ fontSize: '.69rem', color: '#8b949e', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: '.28rem', display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                <div>Heure de pic&nbsp;: <strong style={{ color }}>{peakHIdx}h</strong> — {hours[peakHIdx]} {label}s
                    {total > 0 && <span style={{ color: '#555d69' }}> ({Math.round(hours[peakHIdx] / total * 100)}% du total)</span>}
                </div>
                <div>Moyenne horaire&nbsp;: <strong style={{ color: '#8b949e' }}>{avg.toFixed(1)}</strong> {label}s/h</div>
                {quietH && (
                    <div>Heure la plus calme&nbsp;: <strong style={{ color: C.green }}>{quietH.h}h</strong> — {quietH.c} {label}{quietH.c > 1 ? 's' : ''}</div>
                )}
                {dayTotals[peakDayIdx] > 0 && (
                    <div>Jour le plus actif&nbsp;: <strong style={{ color }}>{DAYS_FR[peakDayIdx]}</strong> — {dayTotals[peakDayIdx]} {label}s</div>
                )}
                <div style={{ display: 'flex', gap: '.5rem', marginTop: '.1rem' }}>
                    {dayTotals.map((d, i) => (
                        <span key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.1rem' }}>
                            <span style={{ fontSize: '.62rem', color: C.muted }}>{DAYS_FR[i]}</span>
                            <span style={{ fontSize: '.68rem', fontWeight: 600, color: d === dayTotals[peakDayIdx] ? color : '#e6edf3' }}>{d}</span>
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );

    return (
        <>
        <SCard icon={icon} color={color} title={title} sub={`(${periodLabel})`}
            titleTooltip={{ bodyNode: titleTooltipBody, color: color === C.red ? 'red' : color === C.orange ? 'orange' : 'blue' }}
            right={<PeriodBtns days={days} color={color} onChange={onDaysChange} />}
            collapsible>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', padding: '1rem 1.25rem 1.25rem' }}>
                {loading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        {/* Skeleton bar chart */}
                        <div>
                            <div style={{ display: 'grid', gridTemplateColumns: '32px repeat(24, 1fr)', gap: 3, height: 120, alignItems: 'end', width: '100%' }}>
                                <div />
                                {[20,35,55,80,60,45,100,90,70,55,35,45,65,55,75,95,85,65,45,35,55,45,35,20].map((h, i) => (
                                    <div key={i} style={{ height: h, background: C.bg3, borderRadius: '3px 3px 0 0', animation: `f2b-shimmer 1.6s ease-in-out ${(i * 0.04).toFixed(2)}s infinite` }} />
                                ))}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '32px repeat(24, 1fr)', gap: 3, width: '100%', paddingTop: '.25rem' }}>
                                <div />
                                {Array.from({ length: 24 }, (_, h) => (
                                    <div key={h} style={{ fontSize: '.58rem', color: C.muted, textAlign: 'center', lineHeight: 1, opacity: .4 }}>
                                        {h % 6 === 0 ? `${h}h` : ''}
                                    </div>
                                ))}
                            </div>
                        </div>
                        {/* Skeleton week heatmap */}
                        <div>
                            <div style={{ display: 'inline-grid', gridTemplateColumns: '32px repeat(24, 1fr)', gap: 3, width: '100%' }}>
                                <div />
                                {Array.from({ length: 24 }, (_, hr) => (
                                    <div key={hr} style={{ fontSize: '.58rem', color: C.muted, textAlign: 'center', lineHeight: 1, opacity: .4 }}>
                                        {hr % 6 === 0 ? `${hr}h` : ''}
                                    </div>
                                ))}
                                {DAYS_FR.map((day, di) => (
                                    <React.Fragment key={day}>
                                        <div style={{ fontSize: '.68rem', color: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6, whiteSpace: 'nowrap', opacity: .5 }}>{day}</div>
                                        {Array.from({ length: 24 }, (_, hr) => (
                                            <div key={hr} style={{ aspectRatio: '1', minHeight: 18, background: C.bg3, borderRadius: 3, animation: `f2b-shimmer 1.8s ease-in-out ${((di * 24 + hr) * 0.005).toFixed(3)}s infinite` }} />
                                        ))}
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : <>
                    {/* ── Peak-hours bar chart ── */}
                    <div>
                        {/* bars */}
                        <div style={{ display: 'grid', gridTemplateColumns: '32px repeat(24, 1fr)', gap: 3, height: 120, alignItems: 'end', width: '100%' }}>
                            <div />
                            {hours.map((cnt, h) => {
                                const barH = cnt === 0 ? 5 : Math.max(8, Math.round(cnt / maxH * 120));
                                const alpha = cnt === 0 ? 0 : 0.2 + (cnt / maxH) * 0.8;
                                const bg = cnt === 0 ? C.bg3 : `rgba(${barRgb},${alpha.toFixed(2)})`;
                                const isPeak = h === peakHIdx && cnt > 0;
                                return (
                                    <div key={h}
                                        style={{ height: barH, background: bg, borderRadius: '3px 3px 0 0', cursor: cnt > 0 ? 'default' : undefined, outline: isPeak ? `1px solid rgba(${barRgb},.7)` : undefined }}
                                        onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, content: (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '.18rem' }}>
                                                <div style={{ fontWeight: 700, color, fontSize: '.85rem' }}>{h}h — {h + 1}h</div>
                                                <div style={{ fontSize: '.78rem', color: '#e6edf3' }}>{cnt} {label}{cnt > 1 ? 's' : ''}</div>
                                                {total > 0 && cnt > 0 && <div style={{ fontSize: '.7rem', color: C.muted }}>{Math.round(cnt / total * 100)}% du total · {Math.round(cnt / maxH * 100)}% du pic</div>}
                                                {isPeak && <div style={{ fontSize: '.7rem', color, fontWeight: 600 }}>▲ Heure de pic</div>}
                                                {cnt === 0 && <div style={{ fontSize: '.7rem', color: C.muted }}>Aucun {label}</div>}
                                            </div>
                                        )})}
                                        onMouseLeave={() => setTip(null)}
                                    />
                                );
                            })}
                        </div>
                        {/* hour labels */}
                        <div style={{ display: 'grid', gridTemplateColumns: '32px repeat(24, 1fr)', gap: 3, width: '100%', paddingTop: '.25rem' }}>
                            <div />
                            {hours.map((_, h) => (
                                <div key={h} style={{ fontSize: '.58rem', color: C.muted, textAlign: 'center', lineHeight: 1 }}>
                                    {h % 6 === 0 ? `${h}h` : ''}
                                </div>
                            ))}
                        </div>
                        <div style={{ paddingTop: '.45rem', fontSize: '.78rem', color: C.muted }}>
                            Pic&nbsp;: <strong style={{ color }}>{peakHIdx}h</strong>&nbsp;&nbsp;{hours[peakHIdx]} {label}
                        </div>
                    </div>

                    {/* ── 7×24 week heatmap grid ── */}
                    <div>
                        <div style={{ display: 'inline-grid', gridTemplateColumns: '32px repeat(24, 1fr)', gap: 3, width: '100%' }}>
                            {/* header row */}
                            <div />
                            {Array.from({ length: 24 }, (_, hr) => (
                                <div key={hr} style={{ fontSize: '.58rem', color: C.muted, textAlign: 'center', lineHeight: 1 }}>
                                    {hr % 6 === 0 ? `${hr}h` : ''}
                                </div>
                            ))}
                            {/* day rows */}
                            {DAYS_FR.map((day, di) => (
                                <React.Fragment key={day}>
                                    <div style={{ fontSize: '.68rem', color: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6, whiteSpace: 'nowrap' }}>{day}</div>
                                    {Array.from({ length: 24 }, (_, hr) => {
                                        const cnt   = week[di][hr] ?? 0;
                                        const ratio = cnt / maxW;
                                        const bg    = cnt === 0 ? C.bg3 : `rgba(${cellRgb},${(0.12 + ratio * 0.88).toFixed(2)})`;
                                        const bord  = cnt > 0 ? `1px solid rgba(${cellRgb},${(ratio * 0.4).toFixed(2)})` : '1px solid transparent';
                                        return (
                                            <div key={hr}
                                                style={{ aspectRatio: '1', minHeight: 18, background: bg, border: bord, borderRadius: 3, transition: 'transform .1s', cursor: cnt > 0 ? 'default' : undefined }}
                                                onMouseMove={e => {
                                                    (e.currentTarget as HTMLElement).style.transform = 'scale(1.4)';
                                                    (e.currentTarget as HTMLElement).style.zIndex = '2';
                                                    setTip({ x: e.clientX, y: e.clientY, content: (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.18rem' }}>
                                                            <div style={{ fontWeight: 700, color, fontSize: '.85rem' }}>{day} · {hr}h — {hr + 1}h</div>
                                                            <div style={{ fontSize: '.78rem', color: '#e6edf3' }}>{cnt} {label}{cnt > 1 ? 's' : ''}</div>
                                                            {cnt > 0 && <div style={{ fontSize: '.7rem', color: C.muted }}>{Math.round(ratio * 100)}% du maximum</div>}
                                                            {cnt === 0 && <div style={{ fontSize: '.7rem', color: C.muted }}>Aucun {label}</div>}
                                                        </div>
                                                    )});
                                                }}
                                                onMouseLeave={e => {
                                                    (e.currentTarget as HTMLElement).style.transform = '';
                                                    (e.currentTarget as HTMLElement).style.zIndex = '';
                                                    setTip(null);
                                                }}
                                            />
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </div>
                        {/* legend */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginTop: '.6rem', fontSize: '.68rem', color: C.muted }}>
                            <span>Moins</span>
                            {[0, 0.25, 0.5, 0.75, 1].map(v => (
                                <div key={v} style={{ width: 14, height: 14, background: v === 0 ? C.bg3 : `rgba(${cellRgb},${(0.12 + v * 0.88).toFixed(2)})`, borderRadius: 3, flexShrink: 0 }} />
                            ))}
                            <span>Plus</span>
                        </div>
                    </div>
                </>}
            </div>
        </SCard>
        {/* Single floating tooltip for bars + cells */}
        {tip && createPortal(
            <div style={{
                position: 'fixed', left: tip.x, top: tip.y - 14,
                transform: 'translate(-50%, -100%)',
                zIndex: 10050, pointerEvents: 'none',
                background: '#161b22',
                border: `1px solid rgba(${barRgb},.45)`,
                borderLeft: `4px solid rgba(${barRgb},.9)`,
                borderRadius: 8, padding: '.5rem .75rem',
                boxShadow: '0 8px 28px rgba(0,0,0,.6)',
                minWidth: 130,
            }}>
                {tip.content}
            </div>,
            document.body
        )}
        </>
    );
};

// ── Tops section ──────────────────────────────────────────────────────────────
const TOP_LIMITS = [15, 25, 50, 0];

const TopsSection: React.FC<{ days: number; onDaysChange: (d: number) => void; onIpClick?: (ip: string) => void; onDomainClick?: (domain: string) => void; jails: JailStatus[]; data: TopsData | null; loading: boolean; refreshing?: boolean; lastFetchTs?: number }> = ({ days, onDaysChange, onIpClick, onDomainClick, jails, data, loading, refreshing, lastFetchTs }) => {
    const { t } = useTranslation();
    const [viewMode, setViewMode] = useState<'bar' | 'pie'>('bar');
    const [topLimit, setTopLimit] = useState(15);
    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;
    const elapsed = useElapsed(lastFetchTs);
    const elapsedLabel = elapsed === null
        ? 'actualisation…'
        : elapsed < 60 ? `il y a ${elapsed}s` : `il y a ${Math.floor(elapsed / 60)}min`;

    const topCards = [
        { icon: <Ban style={{ width: 12, height: 12 }} />, title: t('fail2ban.stats.topIps'), color: C.red, entries: (data?.topIps ?? []).map(e => ({ ...e })) as TopEntry[], labelKey: 'ip' as const },
        { icon: <RotateCcw style={{ width: 12, height: 12 }} />, title: t('fail2ban.attackCategories.recidivist'), color: C.red, entries: (data?.topRecidivists ?? []).map(e => ({ ...e })) as TopEntry[], labelKey: 'ip' as const },
        { icon: <Lock style={{ width: 12, height: 12 }} />, title: t('fail2ban.stats.topJails'), color: C.orange, entries: (data?.topJails ?? []).map(e => ({ ip: undefined, jail: e.jail, count: e.count })) as TopEntry[], labelKey: 'jail' as const },
    ];
    const domainBanEntries: TopEntry[] = (data?.topDomains ?? []).map(e => ({ ip: e.domain, count: e.count }));
    const domainFailEntries: TopEntry[] = [...(data?.topDomains ?? [])]
        .sort((a, b) => (b.failures ?? 0) - (a.failures ?? 0))
        .map(e => ({ ip: e.domain, count: e.failures ?? 0 }));

    const jailRows = [...jails].sort((a, b) => (b.totalBannedSqlite ?? b.totalBanned) - (a.totalBannedSqlite ?? a.totalBanned)).slice(0, 12);
    const jailMax  = Math.max(...jailRows.map(j => j.totalBannedSqlite ?? j.totalBanned), 1);

    return (
        <SCard icon={<TrendingUp style={{ width: 14, height: 14 }} />} color={C.blue} title="Tops" sub={`(${periodLabel})`}
            right={
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    {refreshing && (
                        <span style={{ fontSize: '.65rem', color: C.muted, fontStyle: 'italic' }}>
                            {elapsedLabel}
                        </span>
                    )}
                    <PeriodBtns days={days} onChange={onDaysChange} />
                    <div style={{ width: 1, height: 14, background: C.border }} />
                    {TOP_LIMITS.map(l => (
                        <button key={l} onClick={() => setTopLimit(l)} style={btnStyle(topLimit === l)}>{l === 0 ? 'Tous' : l}</button>
                    ))}
                    <div style={{ width: 1, height: 14, background: C.border }} />
                    <button onClick={() => setViewMode('bar')} style={btnStyle(viewMode === 'bar')}>▐▌ Barres</button>
                    <button onClick={() => setViewMode('pie')} style={btnStyle(viewMode === 'pie')}>◑ Camembert</button>
                </div>
            }
            collapsible>
            <div style={{ padding: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '1rem', alignItems: 'start' }}>
                {topCards.map(c => <TopCard key={c.title} {...c} loading={loading} viewMode={viewMode} limit={topLimit} periodLabel={periodLabel} onIpClick={onIpClick} />)}
                {/* Top Domaines (bans) */}
                <TopCard
                    icon={<TrendingUp style={{ width: 12, height: 12 }} />}
                    title="Top Domaines — bans"
                    color={C.cyan}
                    periodLabel={periodLabel}
                    entries={domainBanEntries}
                    loading={loading}
                    labelKey="ip"
                    viewMode={viewMode}
                    limit={topLimit}
                    emptyMsg="NPM uniquement — configurez le chemin données NPM dans l'onglet Config › Intégrations"
                    onLabelClick={onDomainClick}
                    rowPrefix={(domain) => (
                        <>
                            <img src="/icons/services/nginx-proxy-manager.svg" width={13} height={13} style={{ borderRadius: 2, objectFit: 'contain' }} alt="NPM" />
                            <DomainInitial domain={domain} size={13} />
                        </>
                    )}
                />
                {/* Top Domaines (tentatives) */}
                <TopCard
                    icon={<TrendingUp style={{ width: 12, height: 12 }} />}
                    title="Top Domaines — tentatives"
                    color={C.orange}
                    periodLabel={periodLabel}
                    entries={domainFailEntries}
                    loading={loading}
                    labelKey="ip"
                    viewMode={viewMode}
                    limit={topLimit}
                    emptyMsg="NPM uniquement — configurez le chemin données NPM dans l'onglet Config › Intégrations"
                    onLabelClick={onDomainClick}
                    rowPrefix={(domain) => (
                        <>
                            <img src="/icons/services/nginx-proxy-manager.svg" width={13} height={13} style={{ borderRadius: 2, objectFit: 'contain' }} alt="NPM" />
                            <DomainInitial domain={domain} size={13} />
                        </>
                    )}
                />
                {/* Répartition des bans par jail — dans le même cadre Tops */}
                {jailRows.length > 0 && (() => {
                    const rTotal = jailRows.reduce((s, j) => s + (j.totalBannedSqlite ?? j.totalBanned), 0);
                    let rAcc = -90;
                    const rSlices = jailRows.slice(0, 8).map((j, i) => {
                        const v = j.totalBannedSqlite ?? j.totalBanned;
                        const deg = rTotal > 0 ? (v / rTotal) * 360 : 0;
                        const start = (rAcc * Math.PI) / 180; const end = ((rAcc + deg) * Math.PI) / 180; rAcc += deg;
                        const [cx, cy, r] = [70, 70, 58];
                        const x1 = cx + r * Math.cos(start); const y1 = cy + r * Math.sin(start);
                        const x2 = cx + r * Math.cos(end);   const y2 = cy + r * Math.sin(end);
                        return { jail: j.jail, v, pct: rTotal > 0 ? Math.round((v / rTotal) * 100) : 0, color: PIE_COLORS[i % PIE_COLORS.length], x1, y1, x2, y2, large: deg >= 180 ? 1 : 0 };
                    });
                    return (
                        <div style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                            <div style={{ background: C.bg2, padding: '.5rem .75rem', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                <span style={{ color: C.blue }}><BarChart2 style={{ width: 12, height: 12 }} /></span>
                                <span style={{ fontWeight: 600, fontSize: '.82rem' }}>Répartition des bans</span>
                                <span style={{ marginLeft: 'auto', fontSize: '.68rem', background: 'rgba(88,166,255,.1)', color: C.blue, border: `1px solid ${C.blue}40`, borderRadius: 4, padding: '.08rem .4rem' }}>total</span>
                            </div>
                            {viewMode === 'pie' ? (
                                <div style={{ padding: '1rem', display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                                    {rTotal > 0 && <svg viewBox="0 0 140 140" style={{ width: 120, height: 120, flexShrink: 0 }}>
                                        {rSlices.map(s => (
                                            <path key={s.jail} d={`M 70 70 L ${s.x1} ${s.y1} A 58 58 0 ${s.large} 1 ${s.x2} ${s.y2} Z`}
                                                fill={s.color} stroke={C.bg1} strokeWidth={1.5} opacity={0.9}>
                                                <title>{s.jail}: {s.v} ({s.pct}%)</title>
                                            </path>
                                        ))}
                                        <circle cx={70} cy={70} r={20} fill={C.bg1} stroke={C.border} />
                                        <text x={70} y={73} fontSize={10} fontWeight={700} fill={C.text} textAnchor="middle">{rTotal}</text>
                                    </svg>}
                                    <div style={{ flex: 1, minWidth: 100, display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                                        {rSlices.map((s, i) => (
                                            <div key={s.jail} style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }} />
                                                <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: PIE_COLORS[i % PIE_COLORS.length] }}>{s.jail}</span>
                                                <span style={{ fontSize: '.7rem', fontWeight: 700, color: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0 }}>{s.v}</span>
                                                <span style={{ fontSize: '.65rem', color: C.muted, flexShrink: 0 }}>{s.pct}%</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div style={{ padding: '.4rem 0 .5rem' }}>
                                    {jailRows.map(j => {
                                        const v = j.totalBannedSqlite ?? j.totalBanned;
                                        return (
                                            <div key={j.jail} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.22rem .75rem' }}>
                                                <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.purple }} title={j.jail}>{j.jail}</span>
                                                <div style={{ width: 60, background: C.bg3, borderRadius: 2, height: 4, overflow: 'hidden', flexShrink: 0 }}>
                                                    <div style={{ width: `${Math.max(4, (v / jailMax) * 100)}%`, height: '100%', background: C.purple, borderRadius: 2 }} />
                                                </div>
                                                <span style={{ width: 36, textAlign: 'right', fontWeight: 700, fontSize: '.75rem', color: C.purple, flexShrink: 0, fontFamily: 'monospace' }}>{v}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        </SCard>
    );
};


// ── Whitelist stats ───────────────────────────────────────────────────────────
interface WhitelistData { ok: boolean; globalIps: string[]; perJail: { jail: string; ips: string[]; extra: string[]; missing: string[] }[] }

const WhitelistStatsSection: React.FC = () => {
    const { t } = useTranslation();
    const [data, setData]       = useState<WhitelistData | null>(() => getCached<WhitelistData>('whitelist:stats'));
    const [loading, setLoading] = useState(() => !getCached<WhitelistData>('whitelist:stats'));
    const [error, setError]     = useState<string | null>(null);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    useEffect(() => {
        const cached = getCached<WhitelistData>('whitelist:stats');
        if (cached) { setData(cached); setLoading(false); }
        api.get<WhitelistData>('/api/plugins/fail2ban/whitelist/stats')
            .then(res => {
                if (res.success && res.result?.ok) { setCached('whitelist:stats', res.result); setData(res.result); }
                else if (!cached) setError(res.result?.ok === false ? t('fail2ban.status.noData') : t('fail2ban.errors.unknown'));
            })
            .catch(e => { if (!cached) setError(String(e)); })
            .finally(() => setLoading(false));
    }, [t]);

    const toggleJail = (jail: string) => setExpanded(prev => {
        const s = new Set(prev); s.has(jail) ? s.delete(jail) : s.add(jail); return s;
    });

    const global = data?.globalIps ?? [];
    const perJail = data?.perJail ?? [];

    const IpChip: React.FC<{ ip: string; color?: string }> = ({ ip, color = C.green }) => (
        <span style={{ fontFamily: 'monospace', fontSize: '.72rem', background: `${color}18`, color, border: `1px solid ${color}33`, borderRadius: 4, padding: '.1rem .35rem', whiteSpace: 'nowrap' as const }}>{ip}</span>
    );

    return (
        <SCard
            icon={<ShieldOff style={{ width: 14, height: 14 }} />}
            color={C.green}
            title="IPs whitelistées (ignoreip)"
            sub={!loading && !error ? <span style={{ color: C.green, fontWeight: 600 }}>{global.length} global{perJail.length > 0 ? ` · ${perJail.length} jail${perJail.length > 1 ? 's' : ''} avec override` : ''}</span> : undefined}
            collapsible
        >
            {loading && <div style={{ padding: '1.25rem 1rem', textAlign: 'center', fontSize: '.85rem', color: C.muted }}>{t('fail2ban.messages.loadingData')}</div>}
            {!loading && error && <div style={{ padding: '.75rem 1rem', color: C.orange, fontSize: '.8rem', fontFamily: 'monospace' }}>{error}</div>}
            {!loading && !error && (
                <div style={{ padding: '.75rem 1rem 1rem', display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
                    {/* Global section */}
                    <div>
                        <div style={{ fontSize: '.72rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.5rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block' }} />
                            Global [DEFAULT] — {global.length} IP{global.length !== 1 ? 's' : ''}
                        </div>
                        {global.length === 0
                            ? <span style={{ fontSize: '.78rem', color: C.muted, fontStyle: 'italic' }}>Aucune IP whitelistée globalement</span>
                            : <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem' }}>{global.map(ip => <IpChip key={ip} ip={ip} />)}</div>
                        }
                    </div>

                    {/* Per-jail overrides */}
                    {perJail.length > 0 && (
                        <div>
                            <div style={{ fontSize: '.72rem', fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '.5rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.orange, display: 'inline-block' }} />
                                Overrides par jail
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                                {perJail.map(j => {
                                    const open = expanded.has(j.jail);
                                    return (
                                        <div key={j.jail} style={{ background: C.bg2, borderRadius: 6, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                                            <div onClick={() => toggleJail(j.jail)} style={{ cursor: 'pointer', padding: '.45rem .75rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                                <span style={{ fontFamily: 'monospace', fontSize: '.8rem', flex: 1, color: C.text }}>{j.jail}</span>
                                                {j.extra.length > 0 && <span style={{ fontSize: '.67rem', color: C.green, background: `${C.green}18`, border: `1px solid ${C.green}33`, borderRadius: 3, padding: '.05rem .3rem' }}>+{j.extra.length} extra</span>}
                                                {j.missing.length > 0 && <span style={{ fontSize: '.67rem', color: C.red, background: `${C.red}18`, border: `1px solid ${C.red}33`, borderRadius: 3, padding: '.05rem .3rem' }}>-{j.missing.length} absent</span>}
                                                <span style={{ color: C.muted, fontSize: '.65rem', transform: open ? undefined : 'rotate(-90deg)', display: 'inline-block', transition: 'transform .15s' }}>▼</span>
                                            </div>
                                            {open && (
                                                <div style={{ padding: '.5rem .75rem .75rem', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                                                    {j.extra.length > 0 && (
                                                        <div>
                                                            <div style={{ fontSize: '.67rem', color: C.green, marginBottom: '.3rem' }}>Uniquement dans ce jail :</div>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>{j.extra.map(ip => <IpChip key={ip} ip={ip} color={C.green} />)}</div>
                                                        </div>
                                                    )}
                                                    {j.missing.length > 0 && (
                                                        <div>
                                                            <div style={{ fontSize: '.67rem', color: C.red, marginBottom: '.3rem' }}>Absents du global (ignorés dans ce jail) :</div>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>{j.missing.map(ip => <IpChip key={ip} ip={ip} color={C.red} />)}</div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {global.length === 0 && perJail.length === 0 && (
                        <div style={{ padding: '.5rem 0', fontSize: '.8rem', color: C.muted, textAlign: 'center' }}>
                            Aucune IP whitelistée configurée (ignoreip vide dans jail.conf/jail.local)
                        </div>
                    )}
                </div>
            )}
        </SCard>
    );
};

// ── Safe-IP ban check ─────────────────────────────────────────────────────────
interface SafeHit { ip: string; jail: string; timeofban: number; bantime: number; provider: string; cidr: string; color: string }
interface SafeBannedData { ok: boolean; hits: SafeHit[]; providers: Record<string, { color: string; desc: string }> }

const SafeBannedSection: React.FC<{ onIpClick?: (ip: string) => void }> = ({ onIpClick }) => {
    const { t } = useTranslation();
    const [data, setData]       = useState<SafeBannedData | null>(() => getCached<SafeBannedData>('whitelist:safe-banned'));
    const [loading, setLoading] = useState(() => !getCached<SafeBannedData>('whitelist:safe-banned'));
    const [error, setError]     = useState<string | null>(null);

    useEffect(() => {
        const cached = getCached<SafeBannedData>('whitelist:safe-banned');
        if (cached) { setData(cached); setLoading(false); }
        api.get<SafeBannedData>('/api/plugins/fail2ban/whitelist/safe-banned')
            .then(res => {
                if (res.success && res.result?.ok) { setCached('whitelist:safe-banned', res.result); setData(res.result); }
                else if (!cached) setError(t('fail2ban.status.noData'));
            })
            .catch(e => { if (!cached) setError(String(e)); })
            .finally(() => setLoading(false));
    }, [t]);

    const hits = data?.hits ?? [];
    const allClear = !loading && !error && hits.length === 0;
    const now = Math.floor(Date.now() / 1000);

    const fmtExpiry = (ban: SafeHit) => {
        if (ban.bantime === -1) return '∞ permanent';
        const remaining = ban.timeofban + ban.bantime - now;
        if (remaining <= 0) return 'expiré';
        if (remaining < 3600) return `${Math.round(remaining / 60)}m`;
        if (remaining < 86400) return `${Math.round(remaining / 3600)}h`;
        return `${Math.round(remaining / 86400)}j`;
    };

    const titleSub = !loading && !error
        ? allClear
            ? <span style={{ color: C.green, fontWeight: 600 }}>OK</span>
            : <span style={{ color: C.red, fontWeight: 600 }}>{hits.length} IP{hits.length > 1 ? 's' : ''} à risque</span>
        : undefined;

    return (
        <SCard
            icon={<AlertTriangle style={{ width: 14, height: 14 }} />}
            color={allClear ? C.green : C.red}
            title="Bans à vérifier"
            sub={titleSub}
            collapsible
            defaultOpen={false}
        >
            {loading && <div style={{ padding: '1.25rem 1rem', textAlign: 'center', fontSize: '.85rem', color: C.muted }}>{t('fail2ban.messages.loadingData')}</div>}
            {!loading && error && <div style={{ padding: '.75rem 1rem', color: C.orange, fontSize: '.8rem', fontFamily: 'monospace' }}>{error}</div>}
            {!loading && !error && allClear && (
                <div style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.82rem', color: C.green }}>
                    <span style={{ fontSize: '1rem' }}>✓</span>
                    Aucune IP légitime connue n'est actuellement bannie.
                </div>
            )}
            {!loading && !error && hits.length > 0 && (
                <div style={{ padding: '.5rem 0 .75rem' }}>
                    <div style={{ padding: '.4rem 1rem .6rem', fontSize: '.72rem', color: C.orange, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                        <AlertTriangle style={{ width: 11, height: 11 }} />
                        Ces IPs sont connues comme légitimes (proxy, DNS, monitoring, SEO) — vérifier et débannir si nécessaire.
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        {hits.map((h, i) => (
                            <div key={`${h.ip}-${h.jail}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem 1rem', borderBottom: i < hits.length - 1 ? `1px solid ${C.border}` : undefined, fontSize: '.78rem' }}>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: h.color, flexShrink: 0 }} />
                                <span
                                    style={{ fontFamily: 'monospace', color: onIpClick ? C.blue : C.text, cursor: onIpClick ? 'pointer' : undefined, flexShrink: 0, minWidth: 120 }}
                                    onClick={() => onIpClick?.(h.ip)}
                                >{h.ip}</span>
                                <span style={{ fontSize: '.7rem', color: h.color, background: `${h.color}18`, border: `1px solid ${h.color}33`, borderRadius: 3, padding: '.05rem .3rem', flexShrink: 0, whiteSpace: 'nowrap' as const }}>{h.provider}</span>
                                <span style={{ fontSize: '.67rem', color: C.muted, fontFamily: 'monospace', flexShrink: 0 }}>{h.cidr}</span>
                                <span style={{ flex: 1 }} />
                                <span style={{ fontSize: '.7rem', color: C.muted, flexShrink: 0 }}>jail: <span style={{ color: C.purple, fontFamily: 'monospace' }}>{h.jail}</span></span>
                                <span style={{ fontSize: '.7rem', color: C.orange, flexShrink: 0 }}>{fmtExpiry(h)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </SCard>
    );
};

// ── Jail ban share bars ────────────────────────────────────────────────────────
const JailBanShareBars: React.FC<{ jails: JailStatus[] }> = ({ jails }) => {
    const { t } = useTranslation();
    const rows = [...jails].sort((a, b) => (b.totalBannedSqlite ?? b.totalBanned) - (a.totalBannedSqlite ?? a.totalBanned)).slice(0, 12);
    const max  = Math.max(...rows.map(j => j.totalBannedSqlite ?? j.totalBanned), 1);
    if (rows.length === 0) return null;
    return (
        <SCard icon={<BarChart2 style={{ width: 14, height: 14 }} />} color={C.blue} title={t('fail2ban.stats.byJail')}>
            <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {rows.map(j => {
                    const total = j.totalBannedSqlite ?? j.totalBanned;
                    return (
                        <div key={j.jail} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', fontSize: '.8rem' }}>
                            <span style={{ width: 130, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', color: C.purple }} title={j.jail}>{j.jail}</span>
                            <div style={{ flex: 1, background: C.bg3, borderRadius: 3, height: 5, overflow: 'hidden' }}>
                                <div style={{ width: `${Math.max(4, (total / max) * 100)}%`, height: '100%', background: C.purple, borderRadius: 3, transition: 'width .3s' }} />
                            </div>
                            <span style={{ width: 36, textAlign: 'right', fontWeight: 700, color: C.purple, fontFamily: 'monospace' }}>{total}</span>
                        </div>
                    );
                })}
            </div>
        </SCard>
    );
};

// ── Main component ────────────────────────────────────────────────────────────
interface TabStatsProps {
    jails: JailStatus[];
    /** True after first /status completes; jail-based stat cards do not wait on /history. */
    statusHydrated: boolean;
    totalBanned: number;
    totalFailed: number;
    totalAllTime: number;
    uniqueIpsTotal: number;
    firstEventAt: number | null;
    activeJails: number;
    days: number;
    onDaysChange: (d: number) => void;
    onIpClick?: (ip: string) => void;
}

export const TabStats: React.FC<TabStatsProps> = ({
    jails, statusHydrated,
    totalBanned, totalFailed, totalAllTime, uniqueIpsTotal, firstEventAt, activeJails,
    days, onDaysChange, onIpClick,
}) => {
    const { t } = useTranslation();
    // ── Domain detail modal ───────────────────────────────────────────────────
    const [domainDetail, setDomainDetail] = useState<string | null>(null);

    // ── Single unified /tops fetch (replaces 5 independent section fetches) ────
    const [topsData, setTopsData] = useState<TopsData | null>(() => getCached<TopsData>(`tops:all:${days}`, days));
    const [topsLoading, setTopsLoading] = useState(() => !getCached<TopsData>(`tops:all:${days}`, days));
    // Track whether the fetch was triggered as a loading (vs. background refresh)
    const topsWasLoadingRef = useRef(false);
    const topsAbortRef = useRef<AbortController | null>(null);
    const [topsRefreshing, setTopsRefreshing] = useState(false);
    const topsLastFetchRef = useRef<Partial<Record<number, number>>>({});
    const prewarmDoneRef = useRef<Set<number>>(new Set());

    const fetchTops = useCallback(() => {
        topsAbortRef.current?.abort();
        const ac = new AbortController();
        topsAbortRef.current = ac;

        // Phase 1: fast — summary + heatmaps (~150ms, skips heavy list queries)
        // Skip if full data is already cached
        const fullCached = getCached<TopsData>(`tops:all:${days}`, days);
        if (!fullCached) {
            api.get<TopsData>(`/api/plugins/fail2ban/tops?days=${days}&phase=fast`, { signal: ac.signal })
                .then(res => {
                    if (ac.signal.aborted) return;
                    if (res.success && res.result?.ok) {
                        setTopsData(prev => {
                            const base = prev ?? ({} as TopsData);
                            return {
                                ...base,
                                ...res.result,
                                // Keep existing tops lists from stale data if available
                                topIps:         base.topIps?.length         ? base.topIps         : res.result.topIps,
                                topJails:       base.topJails?.length        ? base.topJails        : res.result.topJails,
                                topRecidivists: base.topRecidivists?.length  ? base.topRecidivists  : res.result.topRecidivists,
                            };
                        });
                        setTopsLoading(false);
                    }
                })
                .catch(() => {});
        }

        // Phase 2: full — all data including tops lists
        api.get<TopsData>(`/api/plugins/fail2ban/tops?days=${days}&limit=100&compare=1`, { signal: ac.signal })
            .then(res => {
                if (ac.signal.aborted) return;
                if (res.success && res.result?.ok) {
                    setCached(`tops:all:${days}`, res.result);
                    setTopsData(res.result);
                    topsLastFetchRef.current = { ...topsLastFetchRef.current, [days]: Date.now() };
                    primeTopsPrevTotalFromFullFetch(days, res.result.prevSummary?.totalBans ?? null);
                }
            })
            .catch(() => {})
            .finally(() => {
                if (ac.signal.aborted) return;
                setTopsLoading(false);
                setTopsRefreshing(false);
                if (topsWasLoadingRef.current) {
                    topsWasLoadingRef.current = false;
                    dispatchTabLoaded();
                }
            });
    }, [days]);

    useEffect(() => {
        const cached = getCached<TopsData>(`tops:all:${days}`, days);
        if (cached) {
            setTopsData(cached);
            setTopsLoading(false);
            setTopsRefreshing(false);
            primeTopsPrevTotalFromFullFetch(days, cached.prevSummary?.totalBans ?? null);
        } else if (topsData !== null) {
            // Keep showing stale data, just indicate background refresh
            setTopsLoading(false);
            setTopsRefreshing(true);
            topsWasLoadingRef.current = false;
        } else {
            // No data at all — full loading state
            setTopsLoading(true);
            setTopsRefreshing(false);
            topsWasLoadingRef.current = true;
        }
        fetchTops();
        const id = setInterval(fetchTops, 60_000);
        return () => {
            clearInterval(id);
            topsAbortRef.current?.abort();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days, fetchTops]);

    // Silently prewarm adjacent periods 2s after initial load
    useEffect(() => {
        if (!topsData || topsRefreshing || topsLoading) return;
        const allDays = [1, 7, 30, 180, 365];
        const toPrewarm = allDays.filter(
            d => d !== days && !prewarmDoneRef.current.has(d) && !getCached<TopsData>(`tops:all:${d}`, d)
        );
        if (toPrewarm.length === 0) return;
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        if (typeof document !== 'undefined' && document.hidden) return;

        const prewarmAcs: AbortController[] = [];
        const timer = setTimeout(() => {
            for (const d of toPrewarm.slice(0, 2)) {
                prewarmDoneRef.current.add(d);
                const ac = new AbortController();
                prewarmAcs.push(ac);
                api.get<TopsData>(`/api/plugins/fail2ban/tops?days=${d}&limit=100&compare=1`, { signal: ac.signal })
                    .then(res => {
                        if (res.success && res.result?.ok) setCached(`tops:all:${d}`, res.result);
                    })
                    .catch(() => {});
            }
        }, 2000);
        return () => { clearTimeout(timer); prewarmAcs.forEach(ac => ac.abort()); };
    }, [topsData, topsRefreshing, topsLoading, days]);

    const topActiveJail = jails
        .filter(j => j.currentlyBanned > 0)
        .sort((a, b) => b.currentlyBanned - a.currentlyBanned)[0]?.jail ?? null;

    const statCards: { label: string; value: number; icon: React.ReactNode; color: string; tt?: React.ReactNode; valueSub?: React.ReactNode }[] = [
        { label: t('fail2ban.status.activeJails'), value: activeJails, icon: <Shield style={{ width: 14, height: 14 }} />, color: C.blue,
          valueSub: topActiveJail ? (
              <span style={{ fontSize: '.68rem', fontWeight: 500, color: C.muted, marginLeft: '.45rem', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>{topActiveJail}</span>
          ) : undefined,
        },
        { label: t('fail2ban.status.bansActive'),      value: totalBanned,  icon: <Ban style={{ width: 14, height: 14 }} />,           color: C.red,
          tt: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: C.red, lineHeight: 1.1 }}>{totalBanned} IPs</div>
                <div style={{ fontSize: '.75rem', color: '#e6edf3', lineHeight: 1.5 }}>
                    IPs <strong>actuellement</strong> en jail — snapshot en temps réel de fail2ban.
                </div>
                <div style={{ fontSize: '.69rem', color: C.muted, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: '.28rem', lineHeight: 1.5 }}>
                    <div>Source : <code style={{ color: '#58a6ff' }}>fail2ban-client status &lt;jail&gt;</code> → <em>Currently banned</em>, sommé sur tous les jails actifs.</div>
                    <div style={{ marginTop: '.2rem' }}>Période : <strong style={{ color: '#e6edf3' }}>maintenant</strong> — une IP est comptée tant que son <code style={{ color: '#e3b341' }}>bantime</code> n'a pas expiré et qu'elle n'a pas été débannie manuellement.</div>
                    <div style={{ marginTop: '.2rem' }}>≠ total cumulé BDD — ce chiffre baisse quand les bans expirent.</div>
                </div>
            </div>
          )
        },
        { label: t('fail2ban.status.failuresCurrent'),    value: totalFailed,  icon: <AlertTriangle style={{ width: 14, height: 14 }} />, color: C.orange },
        { label: t('fail2ban.stats.totalBansCumul'), value: totalAllTime, icon: <ShieldOff style={{ width: 14, height: 14 }} />,     color: C.purple },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Topbar */}
            <h2 style={{ fontSize: '.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: C.muted, margin: 0 }}>
                {t('fail2ban.tabs.stats')}
            </h2>

            {/* IPSets */}
            <IpSetsSection days={days} onDaysChange={onDaysChange} />

            {/* Whitelist + Safe-ban check — 2 colonnes */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
                <WhitelistStatsSection />
                <SafeBannedSection onIpClick={onIpClick} />
            </div>

            {/* Tops section */}
            <TopsSection
                    days={days}
                    onDaysChange={onDaysChange}
                    onIpClick={onIpClick}
                    onDomainClick={setDomainDetail}
                    jails={jails}
                    data={topsData}
                    loading={topsLoading}
                    refreshing={topsRefreshing}
                    lastFetchTs={topsLastFetchRef.current[days]}
                />

            {/* Types d'attaque | 4 stat cards | Résumé période — 3 colonnes */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
                <TypesAttaqueSection days={days} onDaysChange={onDaysChange} data={topsData} loading={topsLoading} />
                <SCard icon={<Shield style={{ width: 14, height: 14 }} />} color={C.blue} title="État actuel">
                    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '.75rem' }}>
                            {statCards.map(({ label, value, icon, color, tt, valueSub }) => {
                                const inner = (
                                    <div key={label} style={{ background: C.bg2, borderRadius: 7, padding: '1rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.35rem', fontSize: '.72rem', color: C.muted }}>
                                            <span>{label}</span><span style={{ color }}>{icon}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'baseline', minWidth: 0 }}>
                                            <span style={{ fontSize: '1.75rem', fontWeight: 700, color, lineHeight: 1.1, flexShrink: 0 }}>
                                                {!statusHydrated ? '…' : value}
                                            </span>
                                            {statusHydrated && valueSub}
                                        </div>
                                    </div>
                                );
                                return tt
                                    ? <F2bTooltip key={label} title={label} bodyNode={tt} color="red">{inner}</F2bTooltip>
                                    : inner;
                            })}
                        </div>
                        {firstEventAt && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.45rem .65rem', background: C.bg2, borderRadius: 6, fontSize: '.72rem', color: C.muted, borderTop: `1px solid ${C.border}` }}>
                                <Database style={{ width: 12, height: 12, color: '#58a6ff', flexShrink: 0 }} />
                                <span>Données BDD depuis le</span>
                                <span style={{ fontWeight: 600, color: '#e6edf3' }}>
                                    {new Date(firstEventAt * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}
                                </span>
                                <span style={{ color: '#555d69' }}>·</span>
                                <span style={{ fontFamily: 'monospace', color: '#58a6ff' }}>
                                    {new Date(firstEventAt * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        )}
                    </div>
                </SCard>
                <ResumePeriodeSection days={days} onDaysChange={onDaysChange} data={topsData?.summary ?? null} prev={topsData?.prevSummary ?? null} loading={topsLoading} />
            </div>

            {/* Bans par heure | Tentatives par heure | Synthèse par jail — 3 colonnes */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
                <HeatmapSection dataKey="heatmap" weekKey="heatmapWeek" title="Bans par heure" icon={<Clock style={{ width: 14, height: 14 }} />} color={C.red} barRgb="232,106,101" cellRgb="232,106,101" label="ban" days={days} onDaysChange={onDaysChange} data={topsData} loading={topsLoading} />
                <HeatmapSection dataKey="heatmapFailed" weekKey="heatmapFailedWeek" title="Tentatives par heure" icon={<AlertTriangle style={{ width: 14, height: 14 }} />} color={C.orange} barRgb="227,179,65" cellRgb="227,179,65" label="tentative" days={days} onDaysChange={onDaysChange} data={topsData} loading={topsLoading} />
                <SCard icon={<Shield style={{ width: 14, height: 14 }} />} color={C.blue} title={t('fail2ban.stats.jailSummary')} collapsible>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.83rem' }}>
                            <thead>
                                <tr style={{ background: C.bg2 }}>
                                    {[t('fail2ban.labels.jail'), t('fail2ban.status.bansActive'), 'Total', t('fail2ban.status.expired24h'), t('fail2ban.status.failuresCurrent'), t('fail2ban.labels.failures')].map(h => (
                                        <th key={h} style={{ padding: '.4rem .55rem', borderBottom: `1px solid ${C.border}`, fontSize: '.65rem', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '.04em', color: C.muted, textAlign: h === t('fail2ban.labels.jail') ? 'left' : 'center', whiteSpace: 'nowrap' as const }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {jails.length === 0 ? (
                                    <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: C.muted, fontSize: '.85rem' }}>{t('fail2ban.messages.noActiveJails')}</td></tr>
                                ) : jails.map(j => {
                                    const total = j.totalBannedSqlite ?? j.totalBanned;
                                    return (
                                        <tr key={j.jail} style={{ borderBottom: `1px solid ${C.border}` }}
                                            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                                            <td style={{ padding: '.38rem .55rem', fontFamily: 'monospace', fontSize: '.75rem', color: C.text, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.jail}</td>
                                            <td style={{ padding: '.38rem .55rem', textAlign: 'center', fontWeight: 700, color: C.red, fontSize: '.78rem' }}>{j.currentlyBanned}</td>
                                            <td style={{ padding: '.38rem .55rem', textAlign: 'center', color: C.blue, fontSize: '.78rem' }}>{total}</td>
                                            <td style={{ padding: '.38rem .55rem', textAlign: 'center', color: j.bansInPeriod !== undefined ? C.cyan : C.muted, fontSize: '.78rem' }}>
                                                {j.bansInPeriod !== undefined ? j.bansInPeriod : '—'}
                                            </td>
                                            <td style={{ padding: '.38rem .55rem', textAlign: 'center', color: C.orange, fontSize: '.78rem' }}>{j.currentlyFailed}</td>
                                            <td style={{ padding: '.38rem .55rem', textAlign: 'center', color: C.muted, fontSize: '.78rem' }}>{j.totalFailed}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </SCard>
            </div>

            {/* Derniers événements — pleine largeur */}
            <TabJailsEvents onIpClick={onIpClick} days={days} />

            {/* Domain detail modal */}
            {domainDetail && (
                <DomainDetailModal
                    domain={domainDetail}
                    days={days}
                    onClose={() => setDomainDetail(null)}
                    onIpClick={onIpClick}
                />
            )}
        </div>
    );
};
