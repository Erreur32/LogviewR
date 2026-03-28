/**
 * StatusTrendsChart - Stacked area chart showing HTTP status group trends over time.
 *
 * 4 layers: 2xx (green), 3xx (blue), 4xx (amber), 5xx (red).
 * Uses monotone cubic spline interpolation for smooth curves.
 * Includes X-axis time labels and Y-axis value scale.
 * Tooltip shows time label and per-status breakdown with total.
 * Pure SVG + HTML, no external dependencies.
 */

import React, { useMemo, useState, useRef, useId } from 'react';
import type { AnalyticsStatusGroups } from '../../types/analytics';

export interface StatusTrendsBucket {
    label: string;
    statusGroups?: AnalyticsStatusGroups;
}

interface StatusTrendsChartProps {
    data: StatusTrendsBucket[];
    height?: number;
    formatLabel?: (raw: string) => string;
    noDataText?: string;
    labels?: { s2xx: string; s3xx: string; s4xx: string; s5xx: string };
    xAxisTicks?: number;
}

const SERIES_CONFIG = [
    { key: 's5xx' as const, color: '#ef4444', gradient: ['#ef4444', '#991b1b'], label: '5xx' },
    { key: 's4xx' as const, color: '#f59e0b', gradient: ['#f59e0b', '#92400e'], label: '4xx' },
    { key: 's3xx' as const, color: '#3b82f6', gradient: ['#3b82f6', '#1e3a5f'], label: '3xx' },
    { key: 's2xx' as const, color: '#10b981', gradient: ['#10b981', '#064e3b'], label: '2xx' }
];

function buildLinearPath(
    points: { x: number; y: number }[],
    basePoints: { x: number; y: number }[]
): string {
    const n = points.length;
    if (n === 0) return '';
    const top = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const base = [...basePoints].reverse().map((p) => `L ${p.x} ${p.y}`).join(' ');
    return `${top} ${base} Z`;
}

function formatAxisValue(v: number): string {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return String(Math.round(v));
}

export const StatusTrendsChart: React.FC<StatusTrendsChartProps> = ({
    data,
    height = 180,
    formatLabel,
    noDataText = 'No data',
    labels,
    xAxisTicks = 6
}) => {
    const uid = useId().replace(/:/g, '');
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    const hasData = useMemo(
        () => data.some((b) => b.statusGroups && (b.statusGroups.s2xx + b.statusGroups.s3xx + b.statusGroups.s4xx + b.statusGroups.s5xx) > 0),
        [data]
    );

    const W = 1000;
    const PAD = 2;
    const n = data.length;

    const { areas, maxTotal } = useMemo(() => {
        if (n < 2) return { areas: [], maxTotal: 0 };

        const totals = data.map((b) => {
            const g = b.statusGroups;
            return g ? g.s2xx + g.s3xx + g.s4xx + g.s5xx : 0;
        });
        const maxT = Math.max(...totals, 1);

        const baselines = new Array(n).fill(0);
        const renderOrder = [...SERIES_CONFIG].reverse();
        const result: { key: string; color: string; gradient: string[]; d: string }[] = [];

        for (const series of renderOrder) {
            const values = data.map((b) => b.statusGroups?.[series.key] ?? 0);

            const topPts: { x: number; y: number }[] = [];
            const basePts: { x: number; y: number }[] = [];

            for (let i = 0; i < n; i++) {
                const x = PAD + (i / (n - 1)) * (W - PAD * 2);
                const yBase = height - PAD - (baselines[i] / maxT) * (height - PAD * 2);
                const yTop = height - PAD - ((baselines[i] + values[i]) / maxT) * (height - PAD * 2);
                topPts.push({ x, y: yTop });
                basePts.push({ x, y: yBase });
            }

            const d = buildLinearPath(topPts, basePts);
            result.push({ key: series.key, color: series.color, gradient: series.gradient, d });

            for (let i = 0; i < n; i++) {
                baselines[i] += values[i];
            }
        }

        return { areas: result, maxTotal: maxT };
    }, [data, height, n]);

    const xTickIndices = useMemo(() => {
        if (n < 2) return [];
        const ticks: number[] = [];
        const count = Math.min(xAxisTicks, n);
        for (let i = 0; i < count; i++) {
            ticks.push(Math.round((i / (count - 1)) * (n - 1)));
        }
        return ticks;
    }, [n, xAxisTicks]);

    const yTicks = useMemo(() => {
        if (maxTotal <= 0) return [];
        return [0.25, 0.5, 0.75, 1].map((frac) => ({
            frac,
            value: maxTotal * frac,
            y: PAD + (1 - frac) * (height - PAD * 2)
        }));
    }, [maxTotal, height]);

    const seriesLabels: Record<string, string> = {
        s2xx: labels?.s2xx ?? '2xx',
        s3xx: labels?.s3xx ?? '3xx',
        s4xx: labels?.s4xx ?? '4xx',
        s5xx: labels?.s5xx ?? '5xx'
    };

    if (!hasData) {
        return (
            <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                {noDataText}
            </div>
        );
    }

    const hoveredBucket = hoveredIdx != null ? data[hoveredIdx] : null;
    const hoveredTotal = hoveredBucket?.statusGroups
        ? hoveredBucket.statusGroups.s2xx + hoveredBucket.statusGroups.s3xx + hoveredBucket.statusGroups.s4xx + hoveredBucket.statusGroups.s5xx
        : 0;

    return (
        <div>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs mb-3">
                {SERIES_CONFIG.map((s) => (
                    <div key={s.key} className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full ring-1 ring-white/10" style={{ backgroundColor: s.color }} />
                        <span className="text-gray-400">{seriesLabels[s.key]}</span>
                    </div>
                ))}
            </div>

            <div className="relative">
                {/* Y-axis labels (absolute left) */}
                <div className="absolute left-0 top-0 bottom-0 w-10 flex flex-col justify-between pointer-events-none" style={{ height, paddingTop: 2, paddingBottom: 2 }}>
                    {yTicks.slice().reverse().map((tick) => (
                        <div key={tick.frac} className="text-[10px] text-gray-600 font-mono text-right pr-1 leading-none" style={{ position: 'absolute', top: `${(tick.y / height) * 100}%`, transform: 'translateY(-50%)' }}>
                            {formatAxisValue(tick.value)}
                        </div>
                    ))}
                </div>

                <div className="ml-10">
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${W} ${height}`}
                        preserveAspectRatio="none"
                        className="w-full rounded-lg"
                        style={{ height }}
                        onMouseMove={(e) => {
                            if (n < 2) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const relX = (e.clientX - rect.left) / rect.width;
                            const idx = Math.round(relX * (n - 1));
                            setHoveredIdx(Math.max(0, Math.min(n - 1, idx)));
                            setMousePos({ x: e.clientX, y: e.clientY });
                        }}
                        onMouseLeave={() => { setHoveredIdx(null); setMousePos(null); }}
                    >
                        <defs>
                            {SERIES_CONFIG.map((s) => (
                                <linearGradient key={`grad-${s.key}`} id={`statusGrad-${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={s.gradient[0]} stopOpacity={0.85} />
                                    <stop offset="100%" stopColor={s.gradient[1]} stopOpacity={0.4} />
                                </linearGradient>
                            ))}
                        </defs>

                        <rect x="0" y="0" width={W} height={height} fill="#0a0a0a" rx="8" />

                        {yTicks.map((tick) => (
                            <line
                                key={tick.frac}
                                x1={PAD} y1={tick.y}
                                x2={W - PAD} y2={tick.y}
                                stroke="rgba(255,255,255,0.05)"
                                strokeWidth="1"
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}

                        {xTickIndices.map((idx) => (
                            <line
                                key={`xt-${idx}`}
                                x1={PAD + (idx / (n - 1)) * (W - PAD * 2)}
                                y1={0}
                                x2={PAD + (idx / (n - 1)) * (W - PAD * 2)}
                                y2={height}
                                stroke="rgba(255,255,255,0.03)"
                                strokeWidth="1"
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}

                        {areas.map((a) => (
                            <path
                                key={a.key}
                                d={a.d}
                                fill={`url(#statusGrad-${uid}-${a.key})`}
                                stroke={a.color}
                                strokeWidth="1.5"
                                strokeLinejoin="round"
                                vectorEffect="non-scaling-stroke"
                            />
                        ))}

                        {hoveredIdx != null && n > 1 && (
                            <>
                                <line
                                    x1={PAD + (hoveredIdx / (n - 1)) * (W - PAD * 2)}
                                    y1={0}
                                    x2={PAD + (hoveredIdx / (n - 1)) * (W - PAD * 2)}
                                    y2={height}
                                    stroke="rgba(255,255,255,0.5)"
                                    strokeWidth="1"
                                    strokeDasharray="4 3"
                                    vectorEffect="non-scaling-stroke"
                                />
                                <circle
                                    cx={PAD + (hoveredIdx / (n - 1)) * (W - PAD * 2)}
                                    cy={height - PAD - (hoveredTotal / (maxTotal || 1)) * (height - PAD * 2)}
                                    r="4"
                                    fill="white"
                                    stroke="rgba(255,255,255,0.6)"
                                    strokeWidth="2"
                                    vectorEffect="non-scaling-stroke"
                                />
                            </>
                        )}
                    </svg>

                    {/* X-axis time labels */}
                    <div className="flex justify-between mt-1.5 px-0.5">
                        {xTickIndices.map((idx) => (
                            <span key={`xl-${idx}`} className="text-[10px] text-gray-500 font-mono truncate" style={{ maxWidth: `${100 / xTickIndices.length}%`, textAlign: 'center' }}>
                                {formatLabel ? formatLabel(data[idx].label) : data[idx].label}
                            </span>
                        ))}
                    </div>
                </div>

                {hoveredBucket && mousePos && (
                    <div
                        className="fixed px-4 py-3 bg-gray-900/95 border border-gray-700 rounded-xl shadow-2xl text-sm z-[99999] pointer-events-none backdrop-blur-sm"
                        style={{
                            left: Math.max(100, Math.min(mousePos.x, (typeof window !== 'undefined' ? window.innerWidth : 1920) - 100)),
                            top: mousePos.y,
                            transform: 'translate(-50%, -100%) translateY(-12px)'
                        }}
                    >
                        <div className="font-semibold text-white mb-2 pb-1.5 border-b border-gray-700/60 flex items-center gap-2">
                            <span className="text-sky-400">
                                {formatLabel ? formatLabel(hoveredBucket.label) : hoveredBucket.label}
                            </span>
                            <span className="ml-auto text-gray-500 text-xs font-normal">
                                {hoveredTotal.toLocaleString()} total
                            </span>
                        </div>
                        <div className="space-y-1">
                            {hoveredBucket.statusGroups && SERIES_CONFIG.map((s) => {
                                const val = hoveredBucket.statusGroups![s.key];
                                const pct = hoveredTotal > 0 ? ((val / hoveredTotal) * 100).toFixed(1) : '0.0';
                                return (
                                    <div key={s.key} className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                                        <span className="text-gray-400 w-8">{seriesLabels[s.key]}</span>
                                        <span className="text-white font-medium ml-auto tabular-nums">{val.toLocaleString()}</span>
                                        <span className="text-gray-500 text-xs w-12 text-right tabular-nums">{pct}%</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
