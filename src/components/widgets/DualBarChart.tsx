/**
 * DualBarChart - Dual bar chart (hits + visitors) for GoAccess-style panels.
 *
 * Renders two bars per category: one for count (hits), one for unique visitors.
 * Includes legend, axis labels, and hover tooltips.
 * Pure SVG/CSS, no external dependency.
 */

import React, { useState } from 'react';

export interface DualBarItem {
    key: string;
    count: number;
    uniqueVisitors: number;
    percent?: number;
}

interface DualBarChartProps {
    data: DualBarItem[];
    maxKeyLength?: number;
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
    hitsColor = '#3b82f6',
    visitorsColor = '#10b981',
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
        <div className="space-y-2">
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
                    <span className="text-emerald-400 font-medium">({totalVisitors})</span>
                </div>
            </div>
            {/* Y-axis hint */}
            <div className="text-[10px] text-gray-500 mb-1" title="Scale: 0 to max value">
                0 ← → {scaleMax}
            </div>
            <div className={tableLayout ? 'overflow-x-auto' : ''}>
            {data.slice(0, 15).map((item) => {
                const isHovered = hoveredKey === item.key;
                return (
                    <div
                        key={item.key}
                        className={`flex items-center gap-3 group relative ${tableLayout ? 'table-row-like' : ''}`}
                        onMouseEnter={() => setHoveredKey(item.key)}
                        onMouseLeave={() => setHoveredKey(null)}
                    >
                        <span
                            className={`text-sm text-gray-400 truncate text-left shrink-0`}
                            style={tableLayout ? { width: `${Math.min(maxKeyLength * 7, 220)}px` } : { maxWidth: maxKeyLength * 6 }}
                            title={item.key}
                        >
                            {item.key.length > maxKeyLength
                                ? item.key.slice(0, maxKeyLength) + '…'
                                : item.key}
                        </span>
                        <div className={`flex gap-2 flex-1 min-w-0 ${tableLayout ? 'justify-end min-w-[120px]' : ''}`}>
                            <div
                                className="h-5 rounded flex items-center justify-end pr-1 text-xs font-medium text-white transition-opacity"
                                style={{
                                    width: `${(item.count / scaleMax) * 100}%`,
                                    minWidth: item.count > 0 ? 24 : 0,
                                    backgroundColor: getColor(item.key),
                                    opacity: isHovered ? 1 : 0.9
                                }}
                                title={`${hitsLabel}: ${item.count}`}
                            >
                                {item.count > 0 ? item.count : ''}
                            </div>
                            <div
                                className="h-5 rounded flex items-center justify-end pr-1 text-xs font-medium text-white transition-opacity"
                                style={{
                                    width: `${(item.uniqueVisitors / scaleMax) * 100}%`,
                                    minWidth: item.uniqueVisitors > 0 ? 24 : 0,
                                    backgroundColor: visitorsColor,
                                    opacity: isHovered ? 1 : 0.9
                                }}
                                title={`${visitorsLabel}: ${item.uniqueVisitors}`}
                            >
                                {item.uniqueVisitors > 0 ? item.uniqueVisitors : ''}
                            </div>
                        </div>
                        {isHovered && (
                            <div className="absolute left-0 top-full mt-1 px-2 py-1.5 bg-gray-900/95 border border-gray-700 rounded shadow-xl text-xs z-50 pointer-events-none whitespace-pre-line">
                                <div className="font-medium text-white">{item.key}</div>
                                <div className="text-gray-300">{hitsLabel}: {item.count}</div>
                                <div className="text-emerald-400">{visitorsLabel}: {item.uniqueVisitors}</div>
                            </div>
                        )}
                    </div>
                );
            })}
            </div>
        </div>
    );
};
