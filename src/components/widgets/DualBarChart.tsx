/**
 * DualBarChart - Dual bar chart (hits + visitors) for GoAccess-style panels.
 *
 * Renders two bars per category: one for count (hits), one for unique visitors.
 * Includes legend, axis labels, and hover tooltips.
 * Pure SVG/CSS, no external dependency.
 */

import React, { useState } from 'react';
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
    const maxCount = Math.max(...data.map((d) => d.count), 1);
    const maxVisitors = Math.max(...data.map((d) => d.uniqueVisitors), 1);
    const scaleMax = Math.max(maxCount, maxVisitors, 1);
    const totalHits = data.reduce((s, d) => s + d.count, 0);
    const totalVisitors = data.reduce((s, d) => s + d.uniqueVisitors, 0);
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);

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
            <div className="text-[10px] text-gray-500 mb-1" title="Scale: 0 to max value">
                0 ← → {scaleMax}
            </div>
            <div className={tableLayout ? 'overflow-x-auto' : ''}>
            {data.slice(0, 15).map((item, idx) => {
                const isHovered = hoveredKey === item.key;
                const countPct = (item.count / scaleMax) * 100;
                const visitorsPct = (item.uniqueVisitors / scaleMax) * 100;
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
                            <div
                                className="h-6 rounded overflow-hidden border border-gray-600/40 flex-1 min-w-0 flex items-center justify-end pr-2"
                                style={{ minWidth: 48 }}
                            >
                                <div
                                    className="h-full rounded-l flex items-center justify-end pr-1 text-xs font-medium text-white/95 transition-opacity origin-left"
                                    style={{
                                        width: `${countPct}%`,
                                        minWidth: item.count > 0 ? 28 : 0,
                                        backgroundColor: getColor(item.key),
                                        opacity: isHovered ? 1 : 0.92,
                                        animation: 'barGrow 0.5s ease-out forwards',
                                        animationDelay: `${idx * 40}ms`
                                    }}
                                    title={`${hitsLabel}: ${item.count}`}
                                >
                                    {item.count > 0 ? item.count : ''}
                                </div>
                            </div>
                            <div
                                className="h-6 rounded overflow-hidden border border-gray-600/40 flex-1 min-w-0 flex items-center justify-end pr-2"
                                style={{ minWidth: 48 }}
                            >
                                <div
                                    className="h-full rounded-l flex items-center justify-end pr-1 text-xs font-medium text-white/95 transition-opacity origin-left"
                                    style={{
                                        width: `${visitorsPct}%`,
                                        minWidth: item.uniqueVisitors > 0 ? 28 : 0,
                                        backgroundColor: visitorsColor,
                                        opacity: isHovered ? 1 : 0.92,
                                        animation: 'barGrow 0.5s ease-out forwards',
                                        animationDelay: `${idx * 40}ms`
                                    }}
                                    title={`${visitorsLabel}: ${item.uniqueVisitors}`}
                                >
                                    {item.uniqueVisitors > 0 ? item.uniqueVisitors : ''}
                                </div>
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
