/**
 * TabStats — Statistiques Fail2ban, aligné sur tabs/stats.php du projet PHP.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
    Shield, Ban, AlertTriangle, ShieldOff, Database,
    TrendingUp, Lock, RotateCcw, Clock, Target, BarChart2, Gauge, List, Search,
} from 'lucide-react';
import { card, PERIODS } from './helpers';
import { api } from '../../api/client';
import type { JailStatus } from './types';

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

const PeriodBtns: React.FC<{ days: number; color?: string; onChange: (d: number) => void }> = ({ days, color, onChange }) => (
    <div style={{ display: 'flex', gap: '.2rem' }}>
        {PERIODS.map(p => <button key={p.days} onClick={() => onChange(p.days)} style={btnStyle(days === p.days, color)}>{p.label}</button>)}
    </div>
);

// ── Card wrapper ──────────────────────────────────────────────────────────────
const SCard: React.FC<{
    icon: React.ReactNode; color: string; title: string; sub?: string; children: React.ReactNode;
    right?: React.ReactNode; collapsible?: boolean;
}> = ({ icon, color, title, sub, children, right, collapsible }) => {
    const [open, setOpen] = useState(true);
    return (
        <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ background: C.bg2, padding: '.65rem 1rem', borderBottom: open && !collapsible ? `1px solid ${C.border}` : open ? `1px solid ${C.border}` : 'none', display: 'flex', alignItems: 'center', gap: '.5rem', cursor: collapsible ? 'pointer' : undefined }}
                onClick={collapsible ? () => setOpen(o => !o) : undefined}>
                <span style={{ color }}>{icon}</span>
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{title}
                    {sub && <span style={{ fontWeight: 400, fontSize: '.72rem', color: C.muted, marginLeft: '.4rem' }}>{sub}</span>}
                </span>
                {right && <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.4rem' }}
                    onClick={e => collapsible && e.stopPropagation()}>{right}</div>}
                {collapsible && <span style={{ color: C.muted, fontSize: '.72rem', marginLeft: right ? '.5rem' : 'auto', transform: open ? undefined : 'rotate(-90deg)', display: 'inline-block', transition: 'transform .15s' }}>▼</span>}
            </div>
            {open && children}
        </div>
    );
};

// ── IPSets ────────────────────────────────────────────────────────────────────
interface IpSetInfo { name: string; entries: number; type: string }

function parseIpsets(raw: string): IpSetInfo[] {
    const sets: IpSetInfo[] = [];
    for (const block of raw.split(/\n(?=Name:)/)) {
        const nm = block.match(/^Name:\s*(.+)/m); if (!nm) continue;
        const name = nm[1].trim(); if (name.startsWith('docker-')) continue;
        const type = block.match(/^Type:\s*(.+)/m)?.[1].trim() ?? '';
        const entries = parseInt(block.match(/Number of entries:\s*(\d+)/m)?.[1] ?? '0', 10);
        sets.push({ name, type, entries });
    }
    return sets.sort((a, b) => b.entries - a.entries);
}

const IpSetsSection: React.FC = () => {
    const [sets, setSets]   = useState<IpSetInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [view, setView]   = useState<'bar' | 'pie'>('bar');

    useEffect(() => {
        api.get<{ ok: boolean; output: string; error?: string }>('/api/plugins/fail2ban/ipset')
            .then(res => {
                if (res.success && res.result?.ok) setSets(parseIpsets(res.result.output));
                else setError(res.result?.error ?? 'IPSet non disponible (NET_ADMIN requis)');
            }).catch(e => setError(String(e))).finally(() => setLoading(false));
    }, []);

    const maxEntries = Math.max(...sets.map(s => s.entries), 1);
    const total = sets.reduce((s, x) => s + x.entries, 0);
    let acc = -90;
    const slices = sets.filter(s => s.entries > 0).map((s, i) => {
        const deg = (s.entries / Math.max(total, 1)) * 360;
        const start = (acc * Math.PI) / 180; const end = ((acc + deg) * Math.PI) / 180; acc += deg;
        const [cx, cy, r] = [80, 80, 65];
        const x1 = cx + r * Math.cos(start); const y1 = cy + r * Math.sin(start);
        const x2 = cx + r * Math.cos(end);   const y2 = cy + r * Math.sin(end);
        return { ...s, x1, y1, x2, y2, large: deg >= 180 ? 1 : 0, pct: Math.round((s.entries / total) * 100), color: PIE_COLORS[i % PIE_COLORS.length] };
    });

    const vBtn = (v: 'bar' | 'pie', label: string) => (
        <button onClick={() => setView(v)} style={{ padding: '.12rem .5rem', fontSize: '.7rem', borderRadius: 4, cursor: 'pointer', border: `1px solid ${view === v ? 'rgba(188,140,255,.4)' : C.border}`, background: view === v ? 'rgba(188,140,255,.15)' : 'transparent', color: view === v ? C.purple : C.muted }}>{label}</button>
    );

    return (
        <SCard icon={<Database style={{ width: 14, height: 14 }} />} color={C.purple} title="IPSets" sub="sets actifs (docker-* exclus)"
            right={<>{vBtn('bar', '▐▌ Barres')}{vBtn('pie', '◑ Camembert')}</>}>
            <div style={{ padding: '.5rem 0 .75rem' }}>
                {loading && <div style={{ textAlign: 'center', padding: '1.5rem', color: C.muted, fontSize: '.85rem' }}>Chargement…</div>}
                {!loading && error && <div style={{ padding: '.75rem 1rem', color: C.orange, fontSize: '.8rem', fontFamily: 'monospace' }}>{error}</div>}
                {!loading && !error && sets.length === 0 && <div style={{ padding: '1.5rem 1rem', color: C.muted, fontSize: '.85rem', textAlign: 'center' }}>Aucun IPSet fail2ban à afficher</div>}
                {!loading && !error && sets.length > 0 && view === 'bar' && sets.map(s => (
                    <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.35rem 1rem' }}>
                        <span style={{ fontSize: '.8rem', color: C.purple, minWidth: 130, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                        {s.type && <span style={{ fontSize: '.65rem', color: C.muted, minWidth: 70, whiteSpace: 'nowrap' }}>{s.type}</span>}
                        <div style={{ flex: 1, background: C.bg3, borderRadius: 3, height: 5, overflow: 'hidden' }}>
                            <div style={{ width: `${s.entries > 0 ? Math.max(2, (s.entries / maxEntries) * 100) : 0}%`, height: '100%', background: C.purple, borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: '.78rem', fontWeight: 700, color: C.purple, minWidth: 36, textAlign: 'right' }}>{s.entries}</span>
                        <span style={{ fontSize: '.68rem', color: C.muted }}>IP{s.entries !== 1 ? 's' : ''}</span>
                    </div>
                ))}
                {!loading && !error && sets.length > 0 && view === 'pie' && (
                    <div style={{ padding: '0 1rem', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: '1.5rem' }}>
                        {total > 0 ? <>
                            <svg viewBox="0 0 160 160" style={{ width: 160, height: 160, flexShrink: 0 }}>
                                {slices.map(s => <path key={s.name} d={`M 80 80 L ${s.x1} ${s.y1} A 65 65 0 ${s.large} 1 ${s.x2} ${s.y2} Z`} fill={s.color} stroke={C.bg1} strokeWidth={1.5} opacity={0.9}><title>{s.name}: {s.entries} IPs ({s.pct}%)</title></path>)}
                                <circle cx={80} cy={80} r={22.75} fill={C.bg1} stroke={C.border} />
                                <text x={80} y={85} fontSize={12} fontWeight={700} fill={C.text} textAnchor="middle">{total}</text>
                            </svg>
                            <div style={{ flex: 1, minWidth: 180, marginTop: '.5rem' }}>
                                {slices.map(s => (
                                    <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.35rem' }}>
                                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                                        <span style={{ fontSize: '.8rem', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                                        <span style={{ fontSize: '.78rem', fontWeight: 700, color: C.purple }}>{s.entries}</span>
                                        <span style={{ fontSize: '.7rem', color: C.muted }}>({s.pct}%)</span>
                                    </div>
                                ))}
                            </div>
                        </> : <div style={{ padding: '1.5rem', color: C.muted, fontSize: '.85rem' }}>Aucune entrée IPSet.</div>}
                    </div>
                )}
            </div>
        </SCard>
    );
};

// ── Tops section ──────────────────────────────────────────────────────────────
interface TopEntry { ip?: string; jail?: string; count: number }
interface TopsData {
    ok: boolean;
    topIps: { ip: string; count: number }[];
    topJails: { jail: string; count: number }[];
    topRecidivists: { ip: string; count: number }[];
    heatmap: { hour: number; count: number }[];
    heatmapFailed: { hour: number; count: number }[];
    summary: { totalBans: number; uniqueIps: number; topJail: string | null; topJailCount: number };
}

const TopCard: React.FC<{ icon: React.ReactNode; title: string; color: string; entries: TopEntry[]; loading: boolean; labelKey: 'ip' | 'jail' }> = ({ icon, title, color, entries, loading, labelKey }) => {
    const max = Math.max(...entries.map(e => e.count), 1);
    const rgb = color === C.red ? '232,106,101' : color === C.orange ? '227,179,65' : color === C.cyan ? '57,197,207' : '88,166,255';
    return (
        <div style={{ background: C.bg0, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ background: C.bg2, padding: '.5rem .75rem', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                <span style={{ color }}>{icon}</span>
                <span style={{ fontWeight: 600, fontSize: '.82rem' }}>{title}</span>
                {!loading && <span style={{ marginLeft: 'auto', fontSize: '.68rem', background: `rgba(${rgb},.1)`, color, border: `1px solid ${color}40`, borderRadius: 4, padding: '.08rem .4rem' }}>{entries.length}</span>}
            </div>
            <div style={{ padding: '.4rem 0 .5rem' }}>
                {loading ? <div style={{ textAlign: 'center', padding: '1rem', color: C.muted, fontSize: '.78rem' }}>Chargement…</div>
                : entries.length === 0 ? <div style={{ textAlign: 'center', padding: '1rem', color: C.muted, fontSize: '.78rem' }}>Aucune donnée</div>
                : entries.map((e, i) => {
                    const label = labelKey === 'ip' ? e.ip! : e.jail!;
                    return (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.22rem .75rem' }}>
                            <span style={{ width: 18, fontSize: '.65rem', color: C.muted, textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                            <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color }}>{label}</span>
                            <div style={{ width: 60, background: C.bg3, borderRadius: 2, height: 4, overflow: 'hidden', flexShrink: 0 }}>
                                <div style={{ width: `${Math.max(4, (e.count / max) * 100)}%`, height: '100%', background: color, borderRadius: 2 }} />
                            </div>
                            <span style={{ width: 32, textAlign: 'right', fontWeight: 700, fontSize: '.75rem', color, flexShrink: 0 }}>{e.count}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ── Résumé période ────────────────────────────────────────────────────────────
const ResumePeriodeSection: React.FC<{ days: number; onDaysChange: (d: number) => void }> = ({ days, onDaysChange }) => {
    const [data, setData]   = useState<TopsData['summary'] | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        api.get<TopsData>(`/api/plugins/fail2ban/tops?days=${days}&limit=1`)
            .then(res => { if (res.success && res.result?.ok) setData(res.result.summary); })
            .catch(() => {}).finally(() => setLoading(false));
    }, [days]);

    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;

    return (
        <SCard icon={<Gauge style={{ width: 14, height: 14 }} />} color={C.green} title="Résumé période"
            sub={`(${periodLabel})`}
            right={<PeriodBtns days={days} color={C.green} onChange={onDaysChange} />}
            collapsible>
            <div style={{ padding: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: '.75rem' }}>
                {[
                    { l: 'Total bans', v: data?.totalBans ?? 0, c: C.red, icon: <Ban style={{ width: 14, height: 14 }} /> },
                    { l: 'IPs uniques', v: data?.uniqueIps ?? 0, c: C.blue, icon: <Shield style={{ width: 14, height: 14 }} /> },
                    { l: 'Jail le + actif', v: data?.topJail ?? '—', c: C.orange, icon: <Lock style={{ width: 14, height: 14 }} />, small: true },
                    { l: 'Bans jail #1', v: data?.topJailCount ?? 0, c: C.orange, icon: <Target style={{ width: 14, height: 14 }} /> },
                ].map(s => (
                    <div key={s.l} style={{ background: C.bg2, borderRadius: 7, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '.72rem', color: C.muted }}>
                            <span>{s.l}</span><span style={{ color: s.c }}>{s.icon}</span>
                        </div>
                        <div style={{ fontSize: s.small ? '1rem' : '1.6rem', fontWeight: 700, color: s.c, lineHeight: 1.1, fontFamily: s.small ? 'monospace' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {loading ? '…' : s.v}
                        </div>
                    </div>
                ))}
            </div>
        </SCard>
    );
};

// ── Types d'attaque ───────────────────────────────────────────────────────────
const TypesAttaqueSection: React.FC<{ days: number; onDaysChange: (d: number) => void }> = ({ days, onDaysChange }) => {
    const [data, setData]   = useState<TopsData | null>(null);
    const [loading, setLoading] = useState(true);
    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;

    useEffect(() => {
        setLoading(true);
        api.get<TopsData>(`/api/plugins/fail2ban/tops?days=${days}&limit=50`)
            .then(res => { if (res.success && res.result?.ok) setData(res.result); })
            .catch(() => {}).finally(() => setLoading(false));
    }, [days]);

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
                {loading && <div style={{ textAlign: 'center', padding: '1.5rem', color: C.muted, fontSize: '.85rem' }}>Chargement…</div>}
                {!loading && jails.length === 0 && <div style={{ textAlign: 'center', padding: '1.5rem', color: C.muted, fontSize: '.85rem' }}>Aucune donnée</div>}
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

// ── Heatmap (bans or failures) ────────────────────────────────────────────────
const HeatmapSection: React.FC<{
    days: number; onDaysChange: (d: number) => void;
    dataKey: 'heatmap' | 'heatmapFailed'; title: string; color: string;
}> = ({ days, onDaysChange, dataKey, title, color }) => {
    const [raw, setRaw]     = useState<{ hour: number; count: number }[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setLoading(true);
        api.get<TopsData>(`/api/plugins/fail2ban/tops?days=${days}&limit=1`)
            .then(res => { if (res.success && res.result?.ok) setRaw(res.result[dataKey] ?? []); })
            .catch(() => {}).finally(() => setLoading(false));
    }, [days, dataKey]);

    const hours = useMemo(() => {
        const map = new Map(raw.map(h => [h.hour, h.count]));
        return Array.from({ length: 24 }, (_, i) => ({ hour: i, count: map.get(i) ?? 0 }));
    }, [raw]);

    const maxCount = Math.max(...hours.map(h => h.count), 1);
    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;

    return (
        <SCard icon={<Clock style={{ width: 14, height: 14 }} />} color={color}
            title={title} sub={`(${periodLabel})`}
            right={<PeriodBtns days={days} color={color} onChange={onDaysChange} />}
            collapsible>
            <div style={{ padding: '1rem' }}>
                {loading ? <div style={{ textAlign: 'center', padding: '1.5rem', color: C.muted, fontSize: '.85rem' }}>Chargement…</div> : (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
                        {hours.map(({ hour, count }) => {
                            const ratio = count / maxCount;
                            const pct   = Math.round(ratio * 100);
                            const barColor = ratio < .33 ? C.green : ratio < .66 ? C.orange : C.red;
                            return (
                                <div key={hour} title={`${String(hour).padStart(2, '0')}h : ${count}`}
                                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, cursor: 'default' }}>
                                    <div style={{ width: '100%', background: `${barColor}22`, borderRadius: 2, display: 'flex', alignItems: 'flex-end', height: 56 }}>
                                        <div style={{ width: '100%', background: barColor, borderRadius: 2, height: `${Math.max(count > 0 ? 6 : 2, pct * 0.56)}%`, minHeight: count > 0 ? 3 : 1, transition: 'height .2s' }} />
                                    </div>
                                    {count > 0 && <span style={{ fontSize: '.55rem', color: C.muted, lineHeight: 1 }}>{count}</span>}
                                    {count === 0 && <span style={{ fontSize: '.55rem', color: 'transparent', lineHeight: 1 }}>0</span>}
                                    <span style={{ fontSize: '.55rem', color: C.muted, lineHeight: 1 }}>{String(hour).padStart(2, '0')}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </SCard>
    );
};

// ── Tops section ──────────────────────────────────────────────────────────────
const TopsSection: React.FC<{ days: number; onDaysChange: (d: number) => void }> = ({ days, onDaysChange }) => {
    const [data, setData]   = useState<TopsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [limit, setLimit] = useState(10);
    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;

    useEffect(() => {
        setLoading(true);
        api.get<TopsData>(`/api/plugins/fail2ban/tops?days=${days}&limit=100`)
            .then(res => { if (res.success && res.result?.ok) setData(res.result); })
            .catch(() => {}).finally(() => setLoading(false));
    }, [days]);

    const slice = <T,>(arr: T[]) => arr.slice(0, limit === 0 ? undefined : limit);

    const topCards = [
        { icon: <Ban style={{ width: 12, height: 12 }} />, title: 'Top IPs', color: C.red, entries: slice(data?.topIps ?? []).map(e => ({ ...e })) as TopEntry[], labelKey: 'ip' as const },
        { icon: <Lock style={{ width: 12, height: 12 }} />, title: 'Top Jails', color: C.orange, entries: slice(data?.topJails ?? []).map(e => ({ ip: undefined, jail: e.jail, count: e.count })) as TopEntry[], labelKey: 'jail' as const },
        { icon: <TrendingUp style={{ width: 12, height: 12 }} />, title: 'Top Domaines NPM', color: C.cyan, entries: [], labelKey: 'ip' as const },
        { icon: <RotateCcw style={{ width: 12, height: 12 }} />, title: 'Top Récidivistes', color: C.red, entries: slice(data?.topRecidivists ?? []).map(e => ({ ...e })) as TopEntry[], labelKey: 'ip' as const },
    ];

    return (
        <SCard icon={<TrendingUp style={{ width: 14, height: 14 }} />} color={C.blue} title="Tops" sub={`(${periodLabel})`}
            right={
                <>
                    <PeriodBtns days={days} onChange={onDaysChange} />
                    <div style={{ width: 1, height: 14, background: C.border }} />
                    <div style={{ display: 'flex', gap: '.2rem' }}>
                        {[10, 25, 50, 0].map(l => <button key={l} onClick={() => setLimit(l)} style={btnStyle(limit === l)}>{l === 0 ? 'Tous' : l}</button>)}
                    </div>
                </>
            }
            collapsible>
            <div style={{ padding: '1rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '1rem' }}>
                {topCards.map(c => <TopCard key={c.title} {...c} loading={loading} />)}
            </div>
        </SCard>
    );
};

// ── Derniers événements ────────────────────────────────────────────────────────
interface AuditEvent { ip: string; jail: string; timeofban: number; bantime: number | null; failures: number | null }

const LIMITS = [25, 50, 100, 200, 0];

const DerniersEventsSection: React.FC<{ days: number; onDaysChange: (d: number) => void }> = ({ days, onDaysChange }) => {
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [limit, setLimit]   = useState(50);
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<'timeofban' | 'ip' | 'jail' | 'failures'>('timeofban');
    const [sortAsc, setSortAsc] = useState(false);
    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;

    useEffect(() => {
        setLoading(true);
        const l = limit === 0 ? 2000 : limit;
        api.get<{ ok: boolean; bans: AuditEvent[] }>(`/api/plugins/fail2ban/audit/internal?days=${days}&limit=${l}`)
            .then(res => { if (res.success && res.result?.ok) setEvents(res.result.bans); })
            .catch(() => {}).finally(() => setLoading(false));
    }, [days, limit]);

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        const rows = q ? events.filter(e => e.ip.includes(q) || e.jail.toLowerCase().includes(q)) : events;
        return [...rows].sort((a, b) => {
            let diff = 0;
            if (sortKey === 'timeofban') diff = a.timeofban - b.timeofban;
            else if (sortKey === 'ip') diff = a.ip.localeCompare(b.ip);
            else if (sortKey === 'jail') diff = a.jail.localeCompare(b.jail);
            else if (sortKey === 'failures') diff = (a.failures ?? 0) - (b.failures ?? 0);
            return sortAsc ? diff : -diff;
        });
    }, [events, search, sortKey, sortAsc]);

    const handleSort = (key: typeof sortKey) => {
        if (sortKey === key) setSortAsc(a => !a);
        else { setSortKey(key); setSortAsc(false); }
    };

    const sortIcon = (key: typeof sortKey) => {
        if (sortKey !== key) return <span style={{ opacity: .3, fontSize: '.7rem' }}>↕</span>;
        return <span style={{ fontSize: '.7rem', color: C.blue }}>{sortAsc ? '↑' : '↓'}</span>;
    };

    const fmtTime = (ts: number) => {
        const d = new Date(ts * 1000);
        return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const fmtDuration = (secs: number | null) => {
        if (secs === null || secs <= 0) return '—';
        if (secs >= 86400) return `${Math.round(secs / 86400)}j`;
        if (secs >= 3600)  return `${Math.round(secs / 3600)}h`;
        if (secs >= 60)    return `${Math.round(secs / 60)}m`;
        return `${secs}s`;
    };

    const thSt = (key: typeof sortKey): React.CSSProperties => ({
        padding: '.4rem .75rem', borderBottom: `1px solid ${C.border}`,
        fontSize: '.67rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '.05em', color: sortKey === key ? C.blue : C.muted,
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
    });

    return (
        <SCard icon={<List style={{ width: 14, height: 14 }} />} color={C.cyan} title="Derniers événements"
            sub={`(${periodLabel} — ${filtered.length} entrée${filtered.length !== 1 ? 's' : ''})`}
            right={<PeriodBtns days={days} color={C.cyan} onChange={onDaysChange} />}
            collapsible>
            {/* Toolbar */}
            <div style={{ padding: '.6rem 1rem', borderBottom: `1px solid ${C.border}`, display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ position: 'relative', width: 220 }}>
                        <Search style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 12, height: 12, color: C.muted, pointerEvents: 'none' }} />
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filtrer IP ou jail…"
                            style={{ width: '100%', padding: '.3rem .5rem .3rem 1.75rem', background: C.bg3, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, fontSize: '.8rem', outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '.2rem', alignItems: 'center', fontSize: '.68rem', color: C.muted }}>
                    <span>Limite :</span>
                    {LIMITS.map(l => (
                        <button key={l} onClick={() => setLimit(l)} style={btnStyle(limit === l, C.cyan)}>{l === 0 ? 'Tous' : l}</button>
                    ))}
                </div>
            </div>
            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                    <thead>
                        <tr style={{ background: C.bg2 }}>
                            <th style={{ ...thSt('timeofban'), textAlign: 'left' }} onClick={() => handleSort('timeofban')}>Horodatage {sortIcon('timeofban')}</th>
                            <th style={{ ...thSt('ip'), textAlign: 'left' }} onClick={() => handleSort('ip')}>IP {sortIcon('ip')}</th>
                            <th style={{ ...thSt('jail'), textAlign: 'left' }} onClick={() => handleSort('jail')}>Jail {sortIcon('jail')}</th>
                            <th style={{ ...thSt('failures'), textAlign: 'center' }} onClick={() => handleSort('failures')}>Échecs {sortIcon('failures')}</th>
                            <th style={{ padding: '.4rem .75rem', borderBottom: `1px solid ${C.border}`, fontSize: '.67rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted, textAlign: 'center', whiteSpace: 'nowrap' }}>Durée ban</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading && (
                            <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: C.muted, fontSize: '.85rem' }}>Chargement…</td></tr>
                        )}
                        {!loading && filtered.length === 0 && (
                            <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: C.muted, fontSize: '.85rem' }}>Aucun événement</td></tr>
                        )}
                        {!loading && filtered.map((ev, i) => (
                            <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                                <td style={{ padding: '.38rem .75rem', fontFamily: 'monospace', fontSize: '.75rem', color: C.muted, whiteSpace: 'nowrap' }}>{fmtTime(ev.timeofban)}</td>
                                <td style={{ padding: '.38rem .75rem', fontFamily: 'monospace', fontSize: '.8rem', color: C.red }}>{ev.ip}</td>
                                <td style={{ padding: '.38rem .75rem', fontSize: '.78rem' }}>
                                    <span style={{ background: 'rgba(57,197,207,.1)', color: C.cyan, border: `1px solid rgba(57,197,207,.25)`, borderRadius: 4, padding: '.08rem .4rem', fontSize: '.72rem', fontFamily: 'monospace' }}>{ev.jail}</span>
                                </td>
                                <td style={{ padding: '.38rem .75rem', textAlign: 'center', color: C.orange, fontWeight: 600 }}>{ev.failures ?? '—'}</td>
                                <td style={{ padding: '.38rem .75rem', textAlign: 'center', color: C.muted, fontSize: '.78rem' }}>{fmtDuration(ev.bantime)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </SCard>
    );
};

// ── Jail ban share bars ────────────────────────────────────────────────────────
const JailBanShareBars: React.FC<{ jails: JailStatus[] }> = ({ jails }) => {
    const rows = [...jails].sort((a, b) => (b.totalBannedSqlite ?? b.totalBanned) - (a.totalBannedSqlite ?? a.totalBanned)).slice(0, 12);
    const max  = Math.max(...rows.map(j => j.totalBannedSqlite ?? j.totalBanned), 1);
    if (rows.length === 0) return null;
    return (
        <SCard icon={<BarChart2 style={{ width: 14, height: 14 }} />} color={C.blue} title="Répartition des bans (total par jail)">
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
    loading: boolean;
    totalBanned: number;
    totalFailed: number;
    totalAllTime: number;
    activeJails: number;
    days: number;
    onDaysChange: (d: number) => void;
}

export const TabStats: React.FC<TabStatsProps> = ({
    jails, loading,
    totalBanned, totalFailed, totalAllTime, activeJails,
    days, onDaysChange,
}) => {
    const statCards = [
        { label: 'Jails actifs',     value: activeJails,  icon: <Shield style={{ width: 14, height: 14 }} />,       color: C.blue },
        { label: 'Bans actifs',      value: totalBanned,  icon: <Ban style={{ width: 14, height: 14 }} />,           color: C.red },
        { label: 'Échecs actifs',    value: totalFailed,  icon: <AlertTriangle style={{ width: 14, height: 14 }} />, color: C.orange },
        { label: 'Total bans cumul', value: totalAllTime, icon: <ShieldOff style={{ width: 14, height: 14 }} />,     color: C.purple },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Topbar */}
            <h2 style={{ fontSize: '.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: C.muted, margin: 0 }}>
                Statistiques fail2ban
            </h2>

            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: '.75rem' }}>
                {statCards.map(({ label, value, icon, color }) => (
                    <div key={label} style={{ ...card, padding: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.35rem', fontSize: '.72rem', color: C.muted }}>
                            <span>{label}</span><span style={{ color }}>{icon}</span>
                        </div>
                        <div style={{ fontSize: '1.75rem', fontWeight: 700, color, lineHeight: 1.1 }}>
                            {loading ? '…' : value}
                        </div>
                    </div>
                ))}
            </div>

            {/* Résumé période */}
            <ResumePeriodeSection days={days} onDaysChange={onDaysChange} />

            {/* Types d'attaque */}
            <TypesAttaqueSection days={days} onDaysChange={onDaysChange} />

            {/* Tops section */}
            <TopsSection days={days} onDaysChange={onDaysChange} />

            {/* Derniers événements */}
            <DerniersEventsSection days={days} onDaysChange={onDaysChange} />

            {/* Bans par heure */}
            <HeatmapSection dataKey="heatmap" title="Bans par heure" color={C.orange} days={days} onDaysChange={onDaysChange} />

            {/* Tentatives par heure */}
            <HeatmapSection dataKey="heatmapFailed" title="Tentatives par heure" color={C.orange} days={days} onDaysChange={onDaysChange} />

            {/* IPSets */}
            <IpSetsSection />

            {/* Répartition par jail */}
            <JailBanShareBars jails={jails} />

            {/* Synthèse par jail */}
            <SCard icon={<Shield style={{ width: 14, height: 14 }} />} color={C.blue} title="Synthèse par jail">
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.83rem' }}>
                        <thead>
                            <tr style={{ background: C.bg2 }}>
                                {['Jail', 'Bannis', 'Total bans', 'Bans période', 'Échecs', 'Tot. échecs'].map(h => (
                                    <th key={h} style={{ padding: '.45rem .75rem', borderBottom: `1px solid ${C.border}`, fontSize: '.67rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: C.muted, textAlign: h === 'Jail' ? 'left' : 'center' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {jails.length === 0 ? (
                                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: C.muted, fontSize: '.85rem' }}>Aucun jail</td></tr>
                            ) : jails.map(j => {
                                const total = j.totalBannedSqlite ?? j.totalBanned;
                                return (
                                    <tr key={j.jail} style={{ borderBottom: `1px solid ${C.border}` }}
                                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                                        <td style={{ padding: '.45rem .75rem', fontFamily: 'monospace', fontSize: '.8rem', color: C.text }}>{j.jail}</td>
                                        <td style={{ padding: '.45rem .75rem', textAlign: 'center', fontWeight: 700, color: C.red }}>{j.currentlyBanned}</td>
                                        <td style={{ padding: '.45rem .75rem', textAlign: 'center', color: C.blue }}>{total}</td>
                                        <td style={{ padding: '.45rem .75rem', textAlign: 'center', color: j.bansInPeriod !== undefined ? C.cyan : C.muted }}>
                                            {j.bansInPeriod !== undefined ? j.bansInPeriod : '—'}
                                        </td>
                                        <td style={{ padding: '.45rem .75rem', textAlign: 'center', color: C.orange }}>{j.currentlyFailed}</td>
                                        <td style={{ padding: '.45rem .75rem', textAlign: 'center', color: C.muted }}>{j.totalFailed}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </SCard>
        </div>
    );
};
