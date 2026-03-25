/**
 * BanHistoryChart — shared between TabJails stats strip and TabStats.
 * Matches the PHP #stats-card / stats-body pattern.
 */
import React, { useState } from 'react';
import { Activity } from 'lucide-react';
import { PERIODS } from './helpers';
import type { HistoryEntry } from './types';

// ── Y-axis tick helper ─────────────────────────────────────────────────────────

function yTicks(max: number): { val: number; frac: number }[] {
    return [0, 0.25, 0.5, 0.75, 1].map(f => ({ val: Math.round(f * max), frac: f }));
}

// ── X-axis label helper ────────────────────────────────────────────────────────

function xLabelIndices(len: number, count: number): number[] {
    if (len <= 0) return [];
    const c = Math.min(count, len);
    return [...new Set(
        Array.from({ length: c }, (_, k) => Math.round(k * (len - 1) / Math.max(c - 1, 1)))
    )];
}

// ── SVG Bar chart ─────────────────────────────────────────────────────────────

const BarChart: React.FC<{ history: HistoryEntry[]; histMax: number }> = ({ history, histMax }) => {
    const slice = history.slice(-60);
    const W = 700; const H = 200;
    const padL = 42; const padR = 8; const padT = 10; const padB = 28;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const max = Math.max(histMax, 1);
    const n = Math.max(slice.length, 1);
    const barGap = 1;
    const barW = Math.max(2, (innerW - (n - 1) * barGap) / n - barGap);

    const ticks = yTicks(max);
    const xIdxs = xLabelIndices(slice.length, 6);

    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', minHeight: 160 }} preserveAspectRatio="xMidYMid meet">
            <defs>
                <linearGradient id="f2bBarG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#e86a65" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#e86a65" stopOpacity={0.3} />
                </linearGradient>
            </defs>
            {/* Y-axis grid lines + labels */}
            {ticks.map(({ val, frac }) => {
                const y = padT + innerH * (1 - frac);
                return (
                    <g key={val}>
                        <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#30363d" strokeWidth={1} />
                        <text x={padL - 5} y={y + 3} fontSize={9} fill="#8b949e" textAnchor="end">{val}</text>
                    </g>
                );
            })}
            {/* Bars */}
            {slice.map((h, i) => {
                const bh = (h.count / max) * innerH;
                const x = padL + i * (barW + barGap) + barGap / 2;
                const y = padT + innerH - bh;
                return (
                    <rect key={`${h.date}-${i}`} x={x} y={Math.max(y, padT)}
                        width={barW} height={Math.max(bh, h.count > 0 ? 2 : 1)}
                        fill="url(#f2bBarG)" rx={2}>
                        <title>{h.date} : {h.count} ban{h.count > 1 ? 's' : ''}</title>
                    </rect>
                );
            })}
            {/* X-axis date labels */}
            {xIdxs.map(i => {
                const x = padL + i * (barW + barGap) + barW / 2;
                return (
                    <text key={i} x={x} y={H - 6} fontSize={9} fill="#8b949e" textAnchor="middle">
                        {slice[i]?.date?.slice(5) ?? ''}
                    </text>
                );
            })}
        </svg>
    );
};

// ── SVG Line chart ────────────────────────────────────────────────────────────

const LineChart: React.FC<{ history: HistoryEntry[]; histMax: number }> = ({ history, histMax }) => {
    if (history.length === 0) return null;
    const W = 700; const H = 180;
    const padL = 42; const padR = 8; const padT = 10; const padB = 28;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const max = Math.max(histMax, 1);
    const denom = Math.max(history.length - 1, 1);

    const pts = history.map((h, i) => ({
        x: padL + (i / denom) * innerW,
        y: padT + innerH - (h.count / max) * innerH,
        h,
    }));
    const polyline = pts.map(p => `${p.x},${p.y}`).join(' ');
    const areaClose = `${padL + innerW},${padT + innerH} ${padL},${padT + innerH}`;

    const ticks = yTicks(max);
    const xIdxs = xLabelIndices(history.length, 6);

    return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', minHeight: 140 }}>
            <defs>
                <linearGradient id="f2bLineG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#e86a65" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#e86a65" stopOpacity={0.03} />
                </linearGradient>
            </defs>
            {/* Y-axis grid lines + labels */}
            {ticks.map(({ val, frac }) => {
                const y = padT + innerH * (1 - frac);
                return (
                    <g key={val}>
                        <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#30363d" strokeWidth={1} />
                        <text x={padL - 5} y={y + 3} fontSize={9} fill="#8b949e" textAnchor="end">{val}</text>
                    </g>
                );
            })}
            {/* Area fill */}
            <polygon points={`${pts[0].x},${pts[0].y} ${polyline} ${areaClose}`} fill="url(#f2bLineG)" />
            {/* Line */}
            <polyline points={polyline} fill="none" stroke="#e86a65" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {/* Dots */}
            {pts.map(({ x, y, h }, i) => (
                <circle key={i} cx={x} cy={y} r={h.count > 0 ? 3.5 : 2} fill="#e86a65" opacity={h.count > 0 ? 1 : 0.35}>
                    <title>{h.date} : {h.count} ban{h.count > 1 ? 's' : ''}</title>
                </circle>
            ))}
            {/* X-axis date labels */}
            {xIdxs.map(i => (
                <text key={i} x={pts[i].x} y={H - 6} fontSize={9} fill="#8b949e" textAnchor="middle">
                    {history[i].date.slice(5)}
                </text>
            ))}
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
    /** Whether to show the collapsible card wrapper (false = bare chart for embedding) */
    card?: boolean;
    loading?: boolean;
    /** Extra content rendered inside the card body, before the chart */
    headerExtra?: React.ReactNode;
}

export const BanHistoryChart: React.FC<BanHistoryChartProps> = ({
    history, histMax, days, onDaysChange, card: showCard = true, loading = false, headerExtra,
}) => {
    const [mode, setMode] = useState<'bar' | 'line'>('line');
    const [collapsed, setCollapsed] = useState(false);

    const periodLabel = PERIODS.find(p => p.days === days)?.label ?? `${days}j`;
    const histSlice = history.slice(-60);

    const controls = (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '.2rem' }}>
                {PERIODS.map(p => (
                    <button key={p.days} title={p.title} onClick={() => onDaysChange(p.days)}
                        style={periodBtnStyle(days === p.days)}>
                        {p.label}
                    </button>
                ))}
            </div>
            <div style={{ width: 1, height: 14, background: '#30363d', flexShrink: 0 }} />
            <div style={{ display: 'flex', gap: '.2rem' }}>
                <button onClick={() => setMode('bar')}  style={periodBtnStyle(mode === 'bar')}>▐▌ Barres</button>
                <button onClick={() => setMode('line')} style={periodBtnStyle(mode === 'line')}>∿ Courbe</button>
            </div>
        </div>
    );

    const chartContent = (
        <div style={{ padding: '1rem' }}>
            {loading ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#8b949e', fontSize: '.85rem' }}>
                    Chargement…
                </div>
            ) : history.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#8b949e', fontSize: '.85rem', border: '1px dashed #30363d', borderRadius: 6 }}>
                    Aucun ban enregistré sur la période (base fail2ban.sqlite3)
                </div>
            ) : mode === 'bar' ? (
                <BarChart history={histSlice} histMax={histMax} />
            ) : (
                <LineChart history={histSlice} histMax={histMax} />
            )}
        </div>
    );

    if (!showCard) return <>{controls}{chartContent}</>;

    return (
        <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'visible', marginBottom: '1.25rem' }}>
            <div style={{
                background: '#21262d', padding: '.65rem 1rem', borderBottom: collapsed ? 'none' : '1px solid #30363d',
                display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer',
            }} onClick={() => setCollapsed(c => !c)}>
                <Activity style={{ width: 14, height: 14, color: '#bc8cff', flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>
                    Statistiques de bans
                    <span style={{ fontWeight: 400, fontSize: '.72rem', color: '#8b949e', marginLeft: '.5rem' }}>({periodLabel})</span>
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}
                    onClick={e => e.stopPropagation()}>
                    {controls}
                </div>
                <span style={{ color: '#8b949e', fontSize: '.72rem', marginLeft: '.5rem', transition: 'transform .15s', transform: collapsed ? 'rotate(-90deg)' : undefined }}>▼</span>
            </div>
            {!collapsed && <>{headerExtra}{chartContent}</>}
        </div>
    );
};
