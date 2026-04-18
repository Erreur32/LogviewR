/**
 * DualBarChart - Dual bar chart (hits + visitors) for LogAnalytics panels.
 *
 * Renders two bars per category: one for count (hits), one for unique visitors.
 * Includes legend, axis labels, and hover tooltips.
 * Pure SVG/CSS, no external dependency.
 */

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

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
            <div className={tableLayout ? 'overflow-x-auto' : ''}>
            {data.slice(0, 15).map((item, idx) => {
                const isHovered = hoveredKey === item.key;
                const countPct = scalePct(item.count);
                const visitorsPct = scalePct(item.uniqueVisitors);
                return (
                    <div
                        key={item.key}
                        className={`flex items-center gap-4 group relative ${tableLayout ? 'table-row-like' : ''}`}
                        onMouseEnter={(e) => {
                            setHoveredKey(item.key);
                            setTooltipRect(e.currentTarget.getBoundingClientRect());
                        }}
                        onMouseLeave={() => {
                            setHoveredKey(null);
                            setTooltipRect(null);
                        }}
                    >
                        <span
                            className="text-sm text-gray-400 truncate text-left shrink-0"
                            style={
                                tableLayout
                                    ? { width: labelWidth ?? Math.min(maxKeyLength * 7, 220) }
                                    : { maxWidth: labelWidth ?? maxKeyLength * 6 }
                            }
                            title={item.key}
                        >
                            {item.key}
                        </span>
                        <div className={`flex gap-3 flex-1 min-w-0 ${tableLayout ? 'justify-end min-w-[120px]' : ''}`}>
                            {/* hits: bar + external value on the right (value is always fully readable) */}
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div
                                    className="h-5 rounded overflow-hidden border border-gray-700/40 flex-1 min-w-0 bg-gray-800/30"
                                    title={`${hitsLabel}: ${item.count.toLocaleString()}`}
                                >
                                    <div
                                        className="h-full rounded-l transition-opacity origin-left"
                                        style={{
                                            width: `${countPct}%`,
                                            minWidth: item.count > 0 ? 3 : 0,
                                            backgroundColor: getColor(item.key),
                                            opacity: isHovered ? 1 : 0.9,
                                            animation: 'barGrow 0.5s ease-out forwards',
                                            animationDelay: `${idx * 40}ms`
                                        }}
                                    />
                                </div>
                                <span
                                    className="text-xs font-medium text-white tabular-nums shrink-0 text-right"
                                    style={{ minWidth: 56 }}
                                >
                                    {item.count > 0 ? item.count.toLocaleString() : '—'}
                                </span>
                            </div>
                            {/* visitors: same layout — bar + external value */}
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div
                                    className="h-5 rounded overflow-hidden border border-gray-700/40 flex-1 min-w-0 bg-gray-800/30"
                                    title={`${visitorsLabel}: ${item.uniqueVisitors.toLocaleString()}`}
                                >
                                    <div
                                        className="h-full rounded-l transition-opacity origin-left"
                                        style={{
                                            width: `${visitorsPct}%`,
                                            minWidth: item.uniqueVisitors > 0 ? 3 : 0,
                                            backgroundColor: visitorsColor,
                                            opacity: isHovered ? 1 : 0.9,
                                            animation: 'barGrow 0.5s ease-out forwards',
                                            animationDelay: `${idx * 40}ms`
                                        }}
                                    />
                                </div>
                                <span
                                    className="text-xs font-medium text-emerald-300 tabular-nums shrink-0 text-right"
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
