/**
 * DualBarChart - Dual bar chart (hits + visitors) for LogAnalytics panels.
 *
 * Renders two bars per category: one for count (hits), one for unique visitors.
 * Includes legend, axis labels, and hover tooltips.
 * Pure SVG/CSS, no external dependency.
 */

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { RankBadge } from './RankBadge';

/** Blends a 6-digit hex color into a 2-stop gradient string, for a bit more depth than a flat fill. */
function barGradient(hex: string): string {
    const clean = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#6b7280';
    return `linear-gradient(90deg, ${clean}99, ${clean})`;
}

export interface DualBarItem {
    key: string;
    count: number;
    uniqueVisitors: number;
    percent?: number;
}

interface DualBarChartProps {
    data: DualBarItem[];
    /** Max chars before truncation (fallback); use labelWidth for URL/domain panels to maximize visibility. */
    maxKeyLength?: number;
    /** Min width in px for label column (tableLayout); use 400-600 for URLs/domains. */
    labelWidth?: number;
    hitsColor?: string;
    visitorsColor?: string;
    /** Optional color by key (e.g. for HTTP status codes). */
    colorByKey?: (key: string) => string;
    /** Label for hits (legend). */
    hitsLabel?: string;
    /** Label for visitors (legend). */
    visitorsLabel?: string;
    /** Table layout: label left-aligned, bars right-aligned in fixed columns. */
    tableLayout?: boolean;
}

export const DualBarChart: React.FC<DualBarChartProps> = ({
    data,
    maxKeyLength = 50,
    labelWidth,
    hitsColor = '#2563eb',
    visitorsColor = '#059669',
    colorByKey,
    hitsLabel = 'Hits',
    visitorsLabel = 'Visitors',
    tableLayout = false
}) => {
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);

    // Single-pass aggregation — hover re-renders don't rescan the dataset.
    // Auto-switch to sqrt scale when the range is very wide (e.g. 200k hits vs 100),
    // so the smallest non-zero bars don't collapse to 1px and vanish.
    const { scaleMax, totalHits, totalVisitors, useSqrtScale, sqrtScaleMax } = useMemo(() => {
        let maxC = 1;
        let maxV = 1;
        let sumC = 0;
        let sumV = 0;
        let minNonZero = Number.POSITIVE_INFINITY;
        for (const d of data) {
            if (d.count > maxC) maxC = d.count;
            if (d.uniqueVisitors > maxV) maxV = d.uniqueVisitors;
            sumC += d.count;
            sumV += d.uniqueVisitors;
            if (d.count > 0 && d.count < minNonZero) minNonZero = d.count;
            if (d.uniqueVisitors > 0 && d.uniqueVisitors < minNonZero) minNonZero = d.uniqueVisitors;
        }
        const sMax = Math.max(maxC, maxV, 1);
        const mnz = minNonZero === Number.POSITIVE_INFINITY ? 1 : minNonZero;
        return {
            scaleMax: sMax,
            totalHits: sumC,
            totalVisitors: sumV,
            useSqrtScale: sMax / Math.max(mnz, 1) > 100,
            sqrtScaleMax: Math.sqrt(sMax)
        };
    }, [data]);

    const scalePct = (v: number): number => {
        if (v <= 0) return 0;
        if (useSqrtScale) return (Math.sqrt(v) / sqrtScaleMax) * 100;
        return (v / scaleMax) * 100;
    };

    const getColor = (key: string) => {
        if (colorByKey) return colorByKey(key);
        return hitsColor;
    };

    if (!data || data.length === 0) {
        return (
            <div className="text-sm text-gray-500 py-4 text-center">
                No data
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Legend with totals */}
            <div className="flex gap-4 text-xs mb-2">
                <div className="flex items-center gap-2" title={`${hitsLabel}: total ${totalHits}`}>
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: hitsColor }} />
                    <span className="text-gray-400">{hitsLabel}</span>
                    <span className="text-white font-medium">({totalHits})</span>
                </div>
                <div className="flex items-center gap-2" title={`${visitorsLabel}: total ${totalVisitors}`}>
                    <div className="w-3 h-3 rounded" style={{ backgroundColor: visitorsColor }} />
                    <span className="text-gray-400">{visitorsLabel}</span>
                    <span className="text-emerald-600 font-medium">({totalVisitors})</span>
                </div>
            </div>
            {/* Y-axis hint */}
            <div className="text-[10px] text-gray-500 mb-1 flex items-center gap-2" title="Scale: 0 to max value">
                <span>0 ← → {scaleMax.toLocaleString()}</span>
                {useSqrtScale && (
                    <span
                        className="px-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[9px] uppercase tracking-wider"
                        title="Échelle √ (racine carrée) : utilisée quand l'écart max/min est très grand, pour que les petites valeurs restent visibles."
                    >
                        √
                    </span>
                )}
            </div>
            <div>
            {data.slice(0, 15).map((item, idx) => {
                const isHovered = hoveredKey === item.key;
                const countPct = scalePct(item.count);
                const visitorsPct = scalePct(item.uniqueVisitors);
                return (
                    <div
                        key={item.key}
                        className={`flex items-center gap-3 group relative rounded-md px-1.5 py-1 -mx-1.5 border-l-2 border-transparent transition-colors duration-150 ${
                            isHovered ? 'bg-white/[0.03] border-emerald-500/70' : ''
                        } ${tableLayout ? 'table-row-like' : ''}`}
                        onMouseEnter={(e) => {
                            setHoveredKey(item.key);
                            setTooltipRect(e.currentTarget.getBoundingClientRect());
                        }}
                        onMouseLeave={() => {
                            setHoveredKey(null);
                            setTooltipRect(null);
                        }}
                    >
                        <RankBadge rank={idx} />
                        <span
                            className="text-[13px] font-mono text-gray-400 group-hover:text-gray-200 truncate text-left"
                            style={
                                tableLayout
                                    // Fixed `width` (not maxWidth) gives every row the same flex-basis, so
                                    // label columns line up across rows; omitting flex-shrink:0 still lets
                                    // the browser shrink it (down to minWidth) instead of overflowing.
                                    ? { width: labelWidth ?? Math.min(maxKeyLength * 7, 220), minWidth: 60 }
                                    : { maxWidth: labelWidth ?? maxKeyLength * 6, flexShrink: 0 }
                            }
                            title={item.key}
                        >
                            {item.key}
                        </span>
                        <div className={`flex gap-3 flex-1 min-w-0 ${tableLayout ? 'justify-end min-w-0' : ''}`}>
                            {/* hits: bar + external value on the right (value is always fully readable) */}
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div
                                    className="h-4 rounded-full overflow-hidden flex-1 min-w-0 bg-gray-800/50"
                                    title={`${hitsLabel}: ${item.count.toLocaleString()}`}
                                >
                                    <div
                                        className="h-full rounded-full transition-[width,opacity] origin-left"
                                        style={{
                                            width: `${countPct}%`,
                                            minWidth: item.count > 0 ? 3 : 0,
                                            background: barGradient(getColor(item.key)),
                                            opacity: isHovered ? 1 : 0.88,
                                            animation: 'barGrow 0.5s ease-out forwards',
                                            animationDelay: `${idx * 40}ms`
                                        }}
                                    />
                                </div>
                                <span
                                    className="text-xs font-semibold text-white tabular-nums shrink-0 text-right"
                                    style={{ minWidth: 56 }}
                                >
                                    {item.count > 0 ? item.count.toLocaleString() : '—'}
                                </span>
                            </div>
                            {/* visitors: same layout — bar + external value */}
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div
                                    className="h-4 rounded-full overflow-hidden flex-1 min-w-0 bg-gray-800/50"
                                    title={`${visitorsLabel}: ${item.uniqueVisitors.toLocaleString()}`}
                                >
                                    <div
                                        className="h-full rounded-full transition-[width,opacity] origin-left"
                                        style={{
                                            width: `${visitorsPct}%`,
                                            minWidth: item.uniqueVisitors > 0 ? 3 : 0,
                                            background: barGradient(visitorsColor),
                                            opacity: isHovered ? 1 : 0.88,
                                            animation: 'barGrow 0.5s ease-out forwards',
                                            animationDelay: `${idx * 40}ms`
                                        }}
                                    />
                                </div>
                                <span
                                    className="text-xs font-semibold text-emerald-300 tabular-nums shrink-0 text-right"
                                    style={{ minWidth: 48 }}
                                >
                                    {item.uniqueVisitors > 0 ? item.uniqueVisitors.toLocaleString() : '—'}
                                </span>
                            </div>
                        </div>
                        {isHovered && tooltipRect && createPortal(
                            <div
                                className="fixed z-[99999] px-3 py-2.5 border border-gray-700 rounded-lg shadow-xl text-sm pointer-events-none"
                                style={{
                                    left: tooltipRect.left,
                                    top: tooltipRect.bottom + 4,
                                    backgroundColor: 'rgb(17, 24, 39)'
                                }}
                            >
                                <div className="font-medium text-white break-all mb-1.5">{item.key}</div>
                                <div className="text-gray-300">{hitsLabel}: {item.count}</div>
                                <div className="text-emerald-600">{visitorsLabel}: {item.uniqueVisitors}</div>
                            </div>,
                            document.body
                        )}
                    </div>
                );
            })}
            </div>
        </div>
    );
};
