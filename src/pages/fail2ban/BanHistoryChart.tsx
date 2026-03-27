/**
 * BanHistoryChart — shared between TabJails stats strip and TabStats.
 * Multi-series per jail with toggle legend, matching PHP fail2ban-web style.
 */
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Activity } from 'lucide-react';
import { PERIODS, F2bTooltip } from './helpers';
import type { F2bTtColor } from './helpers';
import type { HistoryEntry } from './types';
import { api } from '../../api/client';

// ── Palette (same as PHP JAIL_COLORS) ─────────────────────────────────────────
const JAIL_COLORS = ['#58a6ff','#3fb950','#bc8cff','#e3b341','#79c0ff','#56d364','#f28a84','#e86a65','#39c5cf','#d2a8ff'];

function jailColor(jail: string, jailNames: string[]): string {
    const i = jailNames.indexOf(jail);
    if (/^recidive/i.test(jail)) return '#e86a65';
    return JAIL_COLORS[i % JAIL_COLORS.length] ?? '#58a6ff';
}

// ── colorToTt helper ──────────────────────────────────────────────────────────
const COLOR_TO_TT: Record<string, F2bTtColor> = {
    '#58a6ff': 'blue',  '#79c0ff': 'blue',
    '#3fb950': 'green', '#56d364': 'green',
    '#bc8cff': 'purple','#d2a8ff': 'purple',
    '#e3b341': 'orange',
    '#f28a84': 'red',   '#e86a65': 'red',
    '#39c5cf': 'cyan',
};
function colorToTt(color: string): F2bTtColor {
    return COLOR_TO_TT[color] ?? 'blue';
}

// ── TooltipData type ──────────────────────────────────────────────────────────
type TooltipData = {
    x: number;   // px relative to wrapper div
    y: number;   // px relative to wrapper div
    jail: string;
    date: string;
    value: number;
    color: string;
} | null;

// ── ChartTooltip component (stats-tt PHP style, inline styles only) ───────────
const ChartTooltip: React.FC<{ data: TooltipData; isHourly?: boolean }> = ({ data, isHourly = false }) => {
    if (!data) return null;
    const { x, y, jail, date, value, color } = data;
    // For 30-min slots the date is already "HH:MM"; for daily it's "MM-DD"
    const dateLabel = isHourly
        ? (() => {
            if (!date.includes(':')) return `${date}h00`;
            const h = parseInt(date.slice(0, 2), 10);
            const m = parseInt(date.slice(3), 10);
            const endM = m + 30;
            const endH = (h + Math.floor(endM / 60)) % 24;
            const endMin = endM % 60;
            return `${date}–${String(endH).padStart(2,'0')}:${String(endMin).padStart(2,'0')}`;
        })()
        : date;
    return (
        <div style={{
            position: 'absolute',
            left: x,
            top: y - 8,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'none',
            zIndex: 9999,
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 10px 36px rgba(0,0,0,.65), 0 2px 8px rgba(0,0,0,.35)',
            border: `1px solid ${color}`,
            borderLeftWidth: 4,
            minWidth: 140,
        }}>
            {/* Title area */}
            <div style={{
                background: '#161b22',
                padding: '.45rem .9rem .35rem',
                borderBottom: '1px solid rgba(255,255,255,.07)',
                fontWeight: 700,
                fontSize: '.85rem',
                fontFamily: 'monospace',
                color,
            }}>
                {jail}
            </div>
            {/* Body area */}
            <div style={{
                background: '#21262d',
                padding: '.4rem .9rem .5rem',
            }}>
                <div style={{ color: '#bc8cff', fontWeight: 600, fontSize: '.73rem' }}>{dateLabel}</div>
                <div style={{ marginTop: '.15rem' }}>
                    <span style={{ color, fontWeight: 700, fontSize: '.95rem' }}>{value}</span>
                    <span style={{ color: '#8b949e', fontSize: '.8rem' }}> ban{value !== 1 ? 's' : ''}</span>
                </div>
            </div>
            {/* Downward arrow */}
            <div style={{
                position: 'absolute',
                left: '50%',
                bottom: -7,
                transform: 'translateX(-50%)',
                width: 0,
                height: 0,
                borderLeft: '7px solid transparent',
                borderRight: '7px solid transparent',
                borderTop: '7px solid #21262d',
            }} />
        </div>
    );
};

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
    // 30-min slots for 24h: show one label per hour = 25 labels (0h..24h)
    if (isHourly) return 25;
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
    nowSlotFrac?: number; // fractional position of "now" within the last slot
}> = ({ history, histMax, byJail, jailNames, hidden, isHourly = false, days = 30, nowSlotFrac = 0 }) => {
    if (history.length === 0) return null;
    const H = 170;
    const padL = 4; const padR = 4; const padT = 12; const padB = 20;

    const [tip, setTip] = useState<TooltipData>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const [W, setW] = useState(700);
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setW(el.clientWidth || 700);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const innerW = W - padL - padR;
    const innerH = H - padT - padB;

    const dates = allDates(history);
    const n = Math.max(dates.length - 1, 1);
    const visibleJails = jailNames.filter(j => !hidden.has(j));

    const maxVal = Math.max(histMax, 1);
    const xOf = (i: number) => padL + (i / n) * innerW;
    const yOf = (v: number) => padT + innerH - Math.min((v / maxVal) * innerH, innerH);

    const ticks = yTicks(maxVal);
    const xIdxs = xLabelIndices(dates.length, labelCountForDays(days, isHourly));

    const handleEnter = useCallback((svgX: number, svgY: number, jail: string, date: string, value: number, color: string) => {
        if (!wrapRef.current) return;
        const rect = wrapRef.current.getBoundingClientRect();
        setTip({
            x: (svgX / W) * rect.width,
            y: (svgY / H) * rect.height,
            jail,
            date,
            value,
            color,
        });
    }, []);

    return (
        <div ref={wrapRef} style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, display: 'block' }} preserveAspectRatio="none">
                {/* Grid lines + Y labels */}
                {ticks.map(({ val, frac }) => {
                    const y = padT + innerH * (1 - frac);
                    return (
                        <g key={val}>
                            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="rgba(128,128,128,.13)" strokeWidth={frac === 0 ? 1 : 0.5} />
                            {frac > 0 && (
                                <g>
                                    <rect x={padL + 1} y={y - 10} width={22} height={10} fill="rgba(13,17,23,.6)" rx={2} />
                                    <text x={padL + 12} y={y - 2} fontSize={8} fontFamily="'ui-monospace','SFMono-Regular','Menlo',monospace" fill="rgba(139,148,158,.85)" textAnchor="middle">{val}</text>
                                </g>
                            )}
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
                                const cx = xOf(i);
                                const cy = yOf(v);
                                return v > 0 ? (
                                    <g key={i}>
                                        <circle cx={cx} cy={cy} r={2.5} fill={color} stroke="#0d1117" strokeWidth={1} opacity={0.95} />
                                        <circle
                                            cx={cx} cy={cy} r={8} fill="transparent"
                                            style={{ cursor: 'crosshair' }}
                                            onMouseEnter={() => handleEnter(cx, cy, jail, dt, v, color)}
                                        />
                                    </g>
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

                {/* X-axis labels — hourly mode: every 2 hours, format "Xh" */}
                {isHourly
                    ? dates.map((d, i) => {
                        if (!d.endsWith(':00')) return null;
                        const hour = parseInt(d.slice(0, 2), 10);
                        if (hour % 2 !== 0) return null;
                        const anchor = i === 0 ? 'start' : 'middle';
                        return (
                            <text key={i} x={xOf(i)} y={H - 3} fontSize={8} fontFamily="'ui-monospace','SFMono-Regular','Menlo',monospace" fill="rgba(139,148,158,.7)" textAnchor={anchor}>
                                {`${hour}h`}
                            </text>
                        );
                    })
                    : xIdxs.map(i => {
                        const anchor = i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle';
                        return (
                            <text key={i} x={xOf(i)} y={H - 3} fontSize={8} fontFamily="'ui-monospace','SFMono-Regular','Menlo',monospace" fill="rgba(139,148,158,.7)" textAnchor={anchor}>
                                {dates[i]?.slice(5) ?? ''}
                            </text>
                        );
                    })
                }
            </svg>
            <ChartTooltip data={tip} isHourly={isHourly} />
        </div>
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
    nowSlotFrac?: number;
}> = ({ history, histMax, byJail, jailNames, hidden, isHourly = false, days = 30, nowSlotFrac = 0 }) => {
    const H = 170;
    const padL = 4; const padR = 4; const padT = 12; const padB = 20;

    const [tip, setTip] = useState<TooltipData>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const [W, setW] = useState(700);
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setW(el.clientWidth || 700);
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const dates = allDates(history.slice(-60));
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const max = Math.max(histMax, 1);
    const nDates = Math.max(dates.length, 1);
    const barGap = 1;
    const barW = Math.max(2, (innerW - (nDates - 1) * barGap) / nDates - barGap);
    const visibleJails = jailNames.filter(j => !hidden.has(j));
    const ticks = yTicks(max);
    const xIdxs = xLabelIndices(dates.length, labelCountForDays(days, isHourly));

    const handleEnter = useCallback((svgX: number, svgY: number, jail: string, date: string, value: number, color: string) => {
        if (!wrapRef.current) return;
        const rect = wrapRef.current.getBoundingClientRect();
        setTip({
            x: (svgX / W) * rect.width,
            y: (svgY / H) * rect.height,
            jail,
            date,
            value,
            color,
        });
    }, [W]);

    return (
        <div ref={wrapRef} style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
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
                            {frac > 0 && (
                                <g>
                                    <rect x={padL + 1} y={y - 10} width={22} height={10} fill="rgba(13,17,23,.6)" rx={2} />
                                    <text x={padL + 12} y={y - 2} fontSize={8} fontFamily="'ui-monospace','SFMono-Regular','Menlo',monospace" fill="rgba(139,148,158,.85)" textAnchor="middle">{val}</text>
                                </g>
                            )}
                        </g>
                    );
                })}

                {/* Stacked bars per jail */}
                {dates.map((dt, i) => {
                    const x = padL + i * (barW + barGap);
                    let yBase = padT + innerH;

                    // Compute total for this date (for the column overlay tooltip)
                    const colTotal = visibleJails.reduce((s, jail) => s + ((byJail[jail]?.[dt]) ?? 0), 0);
                    const colMidX = x + barW / 2;
                    const colTopY = colTotal > 0 ? padT + innerH - (colTotal / max) * innerH : padT;

                    return (
                        <g key={dt}>
                            {visibleJails.map(jail => {
                                const v = (byJail[jail]?.[dt]) ?? 0;
                                if (v === 0) return null;
                                const bh = (v / max) * innerH;
                                yBase -= bh;
                                const color = jailColor(jail, jailNames);
                                const barMidY = yBase + bh / 2;
                                return (
                                    <rect
                                        key={jail}
                                        x={x} y={Math.max(yBase, padT)} width={barW} height={Math.max(bh, 1)}
                                        fill={color} opacity={0.85} rx={1}
                                        style={{ cursor: 'crosshair' }}
                                        onMouseEnter={() => handleEnter(colMidX, barMidY, jail, dt, v, color)}
                                    />
                                );
                            })}
                            {/* Fallback: total bar when no jail data */}
                            {visibleJails.length === 0 && (() => {
                                const v = history[i]?.count ?? 0;
                                const bh = (v / max) * innerH;
                                return v > 0 ? (
                                    <rect x={x} y={padT + innerH - bh} width={barW} height={Math.max(bh, 1)} fill="url(#f2bBarG)" rx={1} />
                                ) : null;
                            })()}
                            {/* Transparent full-column overlay — shows total on hover */}
                            {visibleJails.length > 0 && colTotal > 0 && (
                                <rect
                                    x={x} y={padT} width={barW} height={innerH}
                                    fill="transparent"
                                    style={{ cursor: 'crosshair' }}
                                    onMouseEnter={() => handleEnter(colMidX, colTopY, 'Total', dt, colTotal, '#8b949e')}
                                />
                            )}
                        </g>
                    );
                })}

                {/* X-axis labels — hourly mode: every 2 hours, format "Xh" */}
                {isHourly
                    ? dates.map((d, i) => {
                        if (!d.endsWith(':00')) return null;
                        const hour = parseInt(d.slice(0, 2), 10);
                        if (hour % 2 !== 0) return null;
                        const x = padL + i * (barW + barGap) + barW / 2;
                        return (
                            <text key={i} x={x} y={H - 3} fontSize={8} fontFamily="'ui-monospace','SFMono-Regular','Menlo',monospace" fill="rgba(139,148,158,.7)" textAnchor="middle">
                                {`${hour}h`}
                            </text>
                        );
                    })
                    : xIdxs.map(i => {
                        const x = padL + i * (barW + barGap) + barW / 2;
                        return (
                            <text key={i} x={x} y={H - 3} fontSize={8} fontFamily="'ui-monospace','SFMono-Regular','Menlo',monospace" fill="rgba(139,148,158,.7)" textAnchor="middle">
                                {dates[i]?.slice(5) ?? ''}
                            </text>
                        );
                    })
                }
            </svg>
            <ChartTooltip data={tip} isHourly={isHourly} />
        </div>
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
    /** Unix timestamp (seconds) of the start of the 24h rolling window — for slot alignment */
    slotBase?: number;
    card?: boolean;
    loading?: boolean;
}

const SLOT_SECS = 1800; // 30-min slots for 24h mode

/**
 * Build 48 rolling 30-min slots anchored to slotBase (or now-24h).
 * Slots are labeled "HH:MM" and run from oldest (left) to newest (right).
 * Also returns nowFrac: fractional position of current time within the last slot (0-1).
 */
function buildRollingSlots(
    history: HistoryEntry[],
    slotBase?: number,
): { slots: HistoryEntry[]; nowSlotFrac: number } {
    const nowSecs = Math.floor(Date.now() / 1000);
    const rawBase = slotBase ?? (nowSecs - 86400);
    // Align to 30-min boundary so slot labels always land on HH:00 / HH:30
    const base = Math.floor(rawBase / SLOT_SECS) * SLOT_SECS;
    const totalSlots = Math.ceil((nowSecs - base) / SLOT_SECS);
    const map: Record<string, number> = {};
    for (const h of history) map[h.date] = h.count;
    const slots = Array.from({ length: totalSlots }, (_, i) => {
        const ts = new Date((base + i * SLOT_SECS) * 1000);
        const label = `${String(ts.getHours()).padStart(2, '0')}:${String(ts.getMinutes()).padStart(2, '0')}`;
        return { date: label, count: map[label] ?? 0 };
    });
    // How far into the last slot are we? (0 = start, 1 = full)
    const elapsed = (nowSecs - base) % SLOT_SECS;
    const nowSlotFrac = elapsed / SLOT_SECS;
    return { slots, nowSlotFrac };
}

export const BanHistoryChart: React.FC<BanHistoryChartProps> = ({
    history, histMax, days, onDaysChange, headerExtra,
    byJail = {}, jailNames = [], granularity = 'day', slotBase,
    card: showCard = true, loading = false,
}) => {
    const [mode, setMode]       = useState<'bar' | 'line'>('line');
    const [collapsed, setCollapsed] = useState(false);
    const [hidden, setHidden]   = useState<Set<string>>(new Set());

    // ── Previous period total (for trend badge) ────────────────────────────────
    const [prevTotal, setPrevTotal] = useState<number | null>(null);
    useEffect(() => {
        if (days === -1) { setPrevTotal(null); return; }
        api.get<{ ok: boolean; prevSummary?: { totalBans: number } | null }>(
            `/api/plugins/fail2ban/tops?days=${days}&compare=1&limit=1`
        ).then(res => {
            if (res.success && res.result?.ok) setPrevTotal(res.result.prevSummary?.totalBans ?? null);
        }).catch(() => {});
    }, [days]);

    const isHourly    = granularity === 'hour';
    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;
    // For 24h: rolling 30-min slots ending at "now"; otherwise last 60 days
    const { slots: rollingSlots, nowSlotFrac } = isHourly
        ? buildRollingSlots(history, slotBase)
        : { slots: [], nowSlotFrac: 0 };
    const histSlice = isHourly ? rollingSlots : history.slice(-60);

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
                    <F2bTooltip key={p.days} title={p.label} body={p.title} color="blue">
                        <button onClick={() => onDaysChange(p.days)} style={periodBtnStyle(days === p.days)}>
                            {p.label}
                        </button>
                    </F2bTooltip>
                ))}
            </div>
            <div style={{ width: 1, height: 14, background: '#30363d', flexShrink: 0 }} />
            <div style={{ display: 'flex', gap: '.2rem' }}>
                <F2bTooltip title="Courbe" body="Représentation en lignes continues — idéal pour voir les tendances" color="blue">
                    <button onClick={() => setMode('line')} style={periodBtnStyle(mode === 'line')}>∿ Courbe</button>
                </F2bTooltip>
                <F2bTooltip title="Barres" body="Colonnes verticales empilées par jail — idéal pour comparer les volumes" color="blue">
                    <button onClick={() => setMode('bar')}  style={periodBtnStyle(mode === 'bar')}>▐▌ Barres</button>
                </F2bTooltip>
            </div>
        </div>
    );

    const legend = jailNames.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem .5rem', padding: '.4rem .75rem .5rem', borderTop: '1px solid #21262d' }}>
            {jailNames.map(jail => {
                const color = jailColor(jail, jailNames);
                const isHidden = hidden.has(jail);
                const total = jailTotals(jail);
                const ttBody = `${total} ban${total !== 1 ? 's' : ''} sur la période\n${isHidden ? 'Cliquer pour afficher' : 'Cliquer pour masquer'}`;
                return (
                    <F2bTooltip key={jail} title={jail} body={ttBody} color={colorToTt(jailColor(jail, jailNames))}>
                        <button onClick={() => toggleJail(jail)} title={isHidden ? 'Afficher dans le graphique' : 'Masquer du graphique'}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: '.15rem .45rem', borderRadius: 4, border: `1px solid ${isHidden ? '#30363d' : color + '55'}`, background: isHidden ? 'transparent' : color + '12', cursor: 'pointer', opacity: isHidden ? 0.4 : 1, transition: 'opacity .15s, border-color .15s' }}>
                            <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0, opacity: isHidden ? 0.3 : 1 }} />
                            <span style={{ fontSize: '.7rem', color: isHidden ? '#8b949e' : '#c9d1d9', fontFamily: 'monospace' }}>{jail}</span>
                            <span style={{ fontSize: '.68rem', color, fontWeight: 600 }}>{total.toLocaleString()}</span>
                        </button>
                    </F2bTooltip>
                );
            })}
        </div>
    );

    const currentTotal = history.reduce((s, h) => s + h.count, 0);

    const chartContent = (
        <div style={{ padding: '.5rem 0 0' }}>
            {loading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#8b949e', fontSize: '.85rem' }}>Chargement…</div>
            ) : history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1.5rem', color: '#8b949e', fontSize: '.85rem', border: '1px dashed #30363d', borderRadius: 6 }}>
                    Aucun ban enregistré sur la période
                </div>
            ) : mode === 'bar' ? (
                <BarChart history={histSlice} histMax={effectiveMax} byJail={byJail} jailNames={jailNames} hidden={hidden} isHourly={isHourly} days={days} nowSlotFrac={nowSlotFrac} />
            ) : (
                <LineChart history={histSlice} histMax={effectiveMax} byJail={byJail} jailNames={jailNames} hidden={hidden} isHourly={isHourly} days={days} nowSlotFrac={nowSlotFrac} />
            )}
        </div>
    );

    if (!showCard) return <>{controls}{chartContent}{legend}</>;

    // Trend badge: compare current period total vs previous period
    const trendBadge = days !== -1 ? (() => {
        if (prevTotal === null) return <span style={{ fontSize: '.7rem', color: '#555d69', marginLeft: '.4rem' }}>…</span>;
        const delta = currentTotal - prevTotal;
        if (delta > 0) return <span style={{ fontSize: '.7rem', color: '#e86a65', marginLeft: '.4rem', fontWeight: 600 }}>▲ +{delta > 9999 ? `${(delta/1000).toFixed(1)}k` : delta}</span>;
        if (delta < 0) return <span style={{ fontSize: '.7rem', color: '#3fb950', marginLeft: '.4rem', fontWeight: 600 }}>▼ {delta > -9999 ? delta : `-${(Math.abs(delta)/1000).toFixed(1)}k`}</span>;
        return <span style={{ fontSize: '.7rem', color: '#8b949e', marginLeft: '.4rem' }}>= stable</span>;
    })() : null;

    return (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, marginBottom: '1.25rem' }}>
            <div style={{ background: '#21262d', padding: '.55rem .85rem', borderBottom: collapsed ? 'none' : '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <Activity style={{ width: 13, height: 13, color: '#bc8cff', flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: '.85rem' }}>
                    Statistiques de bans
                    <span style={{ fontWeight: 400, fontSize: '.7rem', color: '#8b949e', marginLeft: '.5rem' }}>({periodLabel})</span>
                    {trendBadge}
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
