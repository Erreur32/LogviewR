/**
 * BanHistoryChart — shared between TabJails stats strip and TabStats.
 * Multi-series per jail with toggle legend, matching PHP fail2ban-web style.
 */
import React, { useState, useMemo } from 'react';
import { Activity } from 'lucide-react';
import { PERIODS } from './helpers';
import type { HistoryEntry } from './types';

// ── Palette (same as PHP JAIL_COLORS) ─────────────────────────────────────────
const JAIL_COLORS = ['#58a6ff','#3fb950','#bc8cff','#e3b341','#79c0ff','#56d364','#f28a84','#e86a65','#39c5cf','#d2a8ff'];

function jailColor(jail: string, jailNames: string[]): string {
    const i = jailNames.indexOf(jail);
    if (/^recidive/i.test(jail)) return '#e86a65';
    return JAIL_COLORS[i % JAIL_COLORS.length] ?? '#58a6ff';
}

// ── Y-axis ticks ──────────────────────────────────────────────────────────────
function yTicks(max: number): { val: number; frac: number }[] {
    return [0, 0.25, 0.5, 0.75, 1].map(f => ({ val: Math.round(f * max), frac: f }));
}

function xLabelIndices(len: number, count: number): number[] {
    if (len <= 0) return [];
    const c = Math.min(count, len);
    if (c === 1) return [0];
    return [...new Set(Array.from({ length: c }, (_, k) => Math.round(k * (len - 1) / (c - 1))))];
}

function labelCountForDays(days: number, isHourly: boolean): number {
    if (isHourly) return 24;
    if (days === 7)   return 7;
    if (days === 30)  return 10;
    if (days === 180) return 12;
    if (days === 365) return 13;
    return 8;  // Tous / fallback
}

// ── Collect all dates from history ───────────────────────────────────────────
function allDates(history: HistoryEntry[]): string[] {
    return history.map(h => h.date);
}

// ── Multi-series Line chart ───────────────────────────────────────────────────
const LineChart: React.FC<{
    history: HistoryEntry[];
    histMax: number;
    byJail: Record<string, Record<string, number>>;
    jailNames: string[];
    hidden: Set<string>;
    isHourly?: boolean;
    days?: number;
}> = ({ history, histMax, byJail, jailNames, hidden, isHourly = false, days = 30 }) => {
    if (history.length === 0) return null;
    const W = 700; const H = 170;
    const padL = 32; const padR = 8; const padT = 8; const padB = 20;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const dates = allDates(history);
    const n = Math.max(dates.length - 1, 1);
    const visibleJails = jailNames.filter(j => !hidden.has(j));

    // Compute per-date totals for hidden mode fallback
    const maxVal = Math.max(histMax, 1);
    const xOf = (i: number) => padL + (i / n) * innerW;
    const yOf = (v: number) => padT + innerH - Math.min((v / maxVal) * innerH, innerH);

    const ticks = yTicks(maxVal);
    const xIdxs = xLabelIndices(dates.length, labelCountForDays(days, isHourly));

    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }} preserveAspectRatio="none">
            {/* Grid lines + Y labels */}
            {ticks.map(({ val, frac }) => {
                const y = padT + innerH * (1 - frac);
                return (
                    <g key={val}>
                        <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="rgba(128,128,128,.13)" strokeWidth={frac === 0 ? 1 : 0.5} />
                        {frac > 0 && <text x={padL - 3} y={y - 2} fontSize={8} fill="rgba(128,128,128,.45)" textAnchor="end">{val}</text>}
                    </g>
                );
            })}

            {/* Per-jail area + line */}
            {visibleJails.map(jail => {
                const color = jailColor(jail, jailNames);
                const pts = dates.map((dt, i) => `${xOf(i)},${yOf((byJail[jail]?.[dt]) ?? 0)}`);
                const areaPts = [...pts, `${xOf(dates.length - 1)},${yOf(0)}`, `${xOf(0)},${yOf(0)}`].join(' ');
                return (
                    <g key={jail}>
                        <polygon points={areaPts} fill={color} opacity={0.07} />
                        <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
                        {dates.map((dt, i) => {
                            const v = (byJail[jail]?.[dt]) ?? 0;
                            return v > 0 ? (
                                <circle key={i} cx={xOf(i)} cy={yOf(v)} r={2.5} fill={color} stroke="#0d1117" strokeWidth={1} opacity={0.95}>
                                    <title>{dt} · {jail} : {v} ban{v > 1 ? 's' : ''}</title>
                                </circle>
                            ) : null;
                        })}
                    </g>
                );
            })}

            {/* Fallback: single total line when no jail data */}
            {visibleJails.length === 0 && (
                <polyline
                    points={dates.map((_, i) => `${xOf(i)},${yOf(history[i]?.count ?? 0)}`).join(' ')}
                    fill="none" stroke="#e86a65" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
            )}

            {/* X-axis labels */}
            {xIdxs.map(i => {
                const anchor = i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle';
                const label = isHourly ? `${dates[i]}h` : (dates[i]?.slice(5) ?? '');
                return (
                    <text key={i} x={xOf(i)} y={H - 3} fontSize={8} fill="rgba(128,128,128,.55)" textAnchor={anchor}>
                        {label}
                    </text>
                );
            })}
        </svg>
    );
};

// ── Multi-series Bar chart ────────────────────────────────────────────────────
const BarChart: React.FC<{
    history: HistoryEntry[];
    histMax: number;
    byJail: Record<string, Record<string, number>>;
    jailNames: string[];
    hidden: Set<string>;
    isHourly?: boolean;
    days?: number;
}> = ({ history, histMax, byJail, jailNames, hidden, isHourly = false, days = 30 }) => {
    const dates = allDates(history.slice(-60));
    const W = 700; const H = 170;
    const padL = 32; const padR = 8; const padT = 8; const padB = 20;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const max = Math.max(histMax, 1);
    const nDates = Math.max(dates.length, 1);
    const barGap = 1;
    const barW = Math.max(2, (innerW - (nDates - 1) * barGap) / nDates - barGap);
    const visibleJails = jailNames.filter(j => !hidden.has(j));
    const ticks = yTicks(max);
    const xIdxs = xLabelIndices(dates.length, labelCountForDays(days, isHourly));

    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }} preserveAspectRatio="none">
            <defs>
                <linearGradient id="f2bBarG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e86a65" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#e86a65" stopOpacity={0.3} />
                </linearGradient>
            </defs>
            {ticks.map(({ val, frac }) => {
                const y = padT + innerH * (1 - frac);
                return (
                    <g key={val}>
                        <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="rgba(128,128,128,.13)" strokeWidth={frac === 0 ? 1 : 0.5} />
                        {frac > 0 && <text x={padL - 3} y={y - 2} fontSize={8} fill="rgba(128,128,128,.45)" textAnchor="end">{val}</text>}
                    </g>
                );
            })}

            {/* Stacked bars per jail */}
            {dates.map((dt, i) => {
                const x = padL + i * (barW + barGap);
                let yBase = padT + innerH;
                return (
                    <g key={dt}>
                        {visibleJails.map(jail => {
                            const v = (byJail[jail]?.[dt]) ?? 0;
                            if (v === 0) return null;
                            const bh = (v / max) * innerH;
                            yBase -= bh;
                            const color = jailColor(jail, jailNames);
                            return (
                                <rect key={jail} x={x} y={Math.max(yBase, padT)} width={barW} height={Math.max(bh, 1)} fill={color} opacity={0.85} rx={1}>
                                    <title>{dt} · {jail} : {v} ban{v > 1 ? 's' : ''}</title>
                                </rect>
                            );
                        })}
                        {/* Fallback: total bar when no jail data */}
                        {visibleJails.length === 0 && (() => {
                            const v = history[i]?.count ?? 0;
                            const bh = (v / max) * innerH;
                            return v > 0 ? (
                                <rect x={x} y={padT + innerH - bh} width={barW} height={Math.max(bh, 1)} fill="url(#f2bBarG)" rx={1}>
                                    <title>{dt} : {v}</title>
                                </rect>
                            ) : null;
                        })()}
                    </g>
                );
            })}

            {xIdxs.map(i => {
                const x = padL + i * (barW + barGap) + barW / 2;
                const label = isHourly ? `${dates[i]}h` : (dates[i]?.slice(5) ?? '');
                return (
                    <text key={i} x={x} y={H - 3} fontSize={8} fill="rgba(128,128,128,.55)" textAnchor="middle">
                        {label}
                    </text>
                );
            })}
        </svg>
    );
};

// ── Period + mode button helpers ──────────────────────────────────────────────
const periodBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '.12rem .5rem', fontSize: '.7rem', borderRadius: 4, cursor: 'pointer',
    border: `1px solid ${active ? 'rgba(88,166,255,.4)' : '#30363d'}`,
    background: active ? 'rgba(88,166,255,.15)' : 'transparent',
    color: active ? '#58a6ff' : '#8b949e',
});

// ── Main component ────────────────────────────────────────────────────────────
interface BanHistoryChartProps {
    history: HistoryEntry[];
    histMax: number;
    days: number;
    onDaysChange: (d: number) => void;
    /** Extra content rendered inside the card body, before the chart */
    headerExtra?: React.ReactNode;
    /** Per-jail data from /history endpoint */
    byJail?: Record<string, Record<string, number>>;
    jailNames?: string[];
    granularity?: 'hour' | 'day';
    card?: boolean;
    loading?: boolean;
}

// Build 24 hourly slots "00".."23", filling from history data
function buildHourlySlots(history: HistoryEntry[]): HistoryEntry[] {
    const map: Record<string, number> = {};
    for (const h of history) map[h.date] = h.count;
    return Array.from({ length: 24 }, (_, i) => {
        const slot = String(i).padStart(2, '0');
        return { date: slot, count: map[slot] ?? 0 };
    });
}

export const BanHistoryChart: React.FC<BanHistoryChartProps> = ({
    history, histMax, days, onDaysChange, headerExtra,
    byJail = {}, jailNames = [], granularity = 'day',
    card: showCard = true, loading = false,
}) => {
    const [mode, setMode]       = useState<'bar' | 'line'>('line');
    const [collapsed, setCollapsed] = useState(false);
    const [hidden, setHidden]   = useState<Set<string>>(new Set());

    const isHourly    = granularity === 'hour';
    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;
    // For 24h mode: always 24 slots; otherwise last 60 days
    const histSlice   = isHourly ? buildHourlySlots(history) : history.slice(-60);

    // Recompute max from visible jails only so Y-axis adapts when a jail is hidden
    const effectiveMax = useMemo(() => {
        const visibleJails = jailNames.filter(j => !hidden.has(j));
        if (visibleJails.length === 0) return Math.max(histMax, 1);
        // For stacked bars: max of per-day sum; for lines: max of any single value
        const dates = histSlice.map(h => h.date);
        let max = 0;
        for (const dt of dates) {
            let daySum = 0;
            for (const jail of visibleJails) {
                const v = byJail[jail]?.[dt] ?? 0;
                max = Math.max(max, v);
                daySum += v;
            }
            max = Math.max(max, daySum);
        }
        return Math.max(max, 1);
    }, [jailNames, hidden, byJail, histMax, histSlice]);

    const toggleJail = (jail: string) => {
        setHidden(prev => {
            const next = new Set(prev);
            if (next.has(jail)) next.delete(jail); else next.add(jail);
            return next;
        });
    };

    // Jail totals for legend count
    const jailTotals = (jail: string) =>
        Object.values(byJail[jail] ?? {}).reduce((s, v) => s + v, 0);

    const controls = (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '.2rem' }}>
                {PERIODS.map(p => (
                    <button key={p.days} title={p.title} onClick={() => onDaysChange(p.days)} style={periodBtnStyle(days === p.days)}>
                        {p.label}
                    </button>
                ))}
            </div>
            <div style={{ width: 1, height: 14, background: '#30363d', flexShrink: 0 }} />
            <div style={{ display: 'flex', gap: '.2rem' }}>
                <button onClick={() => setMode('line')} style={periodBtnStyle(mode === 'line')}>∿ Courbe</button>
                <button onClick={() => setMode('bar')}  style={periodBtnStyle(mode === 'bar')}>▐▌ Barres</button>
            </div>
        </div>
    );

    const legend = jailNames.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem .5rem', padding: '.4rem .75rem .5rem', borderTop: '1px solid #21262d' }}>
            {jailNames.map(jail => {
                const color = jailColor(jail, jailNames);
                const isHidden = hidden.has(jail);
                const total = jailTotals(jail);
                return (
                    <button key={jail} onClick={() => toggleJail(jail)} title={isHidden ? 'Afficher dans le graphique' : 'Masquer du graphique'}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: '.15rem .45rem', borderRadius: 4, border: `1px solid ${isHidden ? '#30363d' : color + '55'}`, background: isHidden ? 'transparent' : color + '12', cursor: 'pointer', opacity: isHidden ? 0.4 : 1, transition: 'opacity .15s, border-color .15s' }}>
                        <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0, opacity: isHidden ? 0.3 : 1 }} />
                        <span style={{ fontSize: '.7rem', color: isHidden ? '#8b949e' : '#c9d1d9', fontFamily: 'monospace' }}>{jail}</span>
                        <span style={{ fontSize: '.68rem', color, fontWeight: 600 }}>{total.toLocaleString()}</span>
                    </button>
                );
            })}
        </div>
    );

    const chartContent = (
        <div style={{ padding: '.5rem .75rem 0' }}>
            {loading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#8b949e', fontSize: '.85rem' }}>Chargement…</div>
            ) : history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1.5rem', color: '#8b949e', fontSize: '.85rem', border: '1px dashed #30363d', borderRadius: 6 }}>
                    Aucun ban enregistré sur la période
                </div>
            ) : mode === 'bar' ? (
                <BarChart history={histSlice} histMax={effectiveMax} byJail={byJail} jailNames={jailNames} hidden={hidden} isHourly={isHourly} days={days} />
            ) : (
                <LineChart history={histSlice} histMax={effectiveMax} byJail={byJail} jailNames={jailNames} hidden={hidden} isHourly={isHourly} days={days} />
            )}
        </div>
    );

    if (!showCard) return <>{controls}{chartContent}{legend}</>;

    return (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, marginBottom: '1.25rem' }}>
            <div style={{ background: '#21262d', padding: '.55rem .85rem', borderBottom: collapsed ? 'none' : '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <Activity style={{ width: 13, height: 13, color: '#bc8cff', flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: '.85rem' }}>
                    Statistiques de bans
                    <span style={{ fontWeight: 400, fontSize: '.7rem', color: '#8b949e', marginLeft: '.5rem' }}>({periodLabel})</span>
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    {controls}
                    <button onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Développer' : 'Réduire'}
                        style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: 4, color: '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, fontSize: '.75rem', transition: 'background .12s', flexShrink: 0 }}>
                        {collapsed ? '▸' : '▾'}
                    </button>
                </div>
            </div>
            {!collapsed && <>{headerExtra}{chartContent}{legend}</>}
        </div>
    );
};
