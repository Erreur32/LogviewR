/**
 * HourDayHeatmap - 7x24 heatmap grid (day-of-week rows x hour-of-day columns).
 *
 * Intensity = request count for each (weekday, hour) combination.
 * Requires hour or minute bucket granularity for meaningful data.
 * Pure SVG, no external dependencies.
 */

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export interface HourDayDataPoint {
    label: string;
    count: number;
}

interface HourDayHeatmapProps {
    data: HourDayDataPoint[];
    noDataText?: string;
    dayLabels?: string[];
    requestsLabel?: string;
}

const DEFAULT_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const COLOR_SCALE = [
    'rgb(22, 27, 34)',
    'rgb(14, 68, 41)',
    'rgb(0, 109, 50)',
    'rgb(38, 166, 65)',
    'rgb(57, 211, 83)'
];

function getCellColor(count: number, maxCount: number): string {
    if (count === 0 || maxCount === 0) return COLOR_SCALE[0];
    const ratio = count / maxCount;
    if (ratio <= 0.25) return COLOR_SCALE[1];
    if (ratio <= 0.50) return COLOR_SCALE[2];
    if (ratio <= 0.75) return COLOR_SCALE[3];
    return COLOR_SCALE[4];
}

export const HourDayHeatmap: React.FC<HourDayHeatmapProps> = ({
    data,
    noDataText = 'No data',
    dayLabels = DEFAULT_DAY_LABELS,
    requestsLabel = 'Requests'
}) => {
    const [tooltip, setTooltip] = useState<{ day: number; hour: number; count: number; rect: DOMRect } | null>(null);

    const { grid, maxCount } = useMemo(() => {
        const g: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
        for (const d of data) {
            try {
                let s = d.label;
                if (s.length === 10) s += 'T00:00:00';
                else if (s.length === 13) s += ':00:00';
                else if (s.length === 16) s += ':00';
                const date = new Date(s);
                if (isNaN(date.getTime())) continue;
                const jsDay = date.getDay();
                const dayIdx = jsDay === 0 ? 6 : jsDay - 1;
                const hour = date.getHours();
                g[dayIdx][hour] += d.count;
            } catch { /* skip */ }
        }
        const max = Math.max(...g.flat(), 0);
        return { grid: g, maxCount: max };
    }, [data]);

    if (!data.length) {
        return (
            <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                {noDataText}
            </div>
        );
    }

    const cellSize = 18;
    const cellGap = 2;
    const step = cellSize + cellGap;
    const labelWidth = 36;
    const topPadding = 20;
    const svgWidth = labelWidth + 24 * step + 4;
    const svgHeight = topPadding + 7 * step + 4;

    return (
        <div className="overflow-x-auto">
            <svg width={svgWidth} height={svgHeight} className="block">
                {Array.from({ length: 24 }, (_, h) => (
                    h % 3 === 0 ? (
                        <text
                            key={`h-${h}`}
                            x={labelWidth + h * step + cellSize / 2}
                            y={14}
                            className="fill-gray-500"
                            fontSize={9}
                            textAnchor="middle"
                        >
                            {h}h
                        </text>
                    ) : null
                ))}

                {dayLabels.map((label, i) => (
                    <text
                        key={`d-${i}`}
                        x={labelWidth - 4}
                        y={topPadding + i * step + cellSize / 2 + 3}
                        className="fill-gray-500"
                        fontSize={10}
                        textAnchor="end"
                    >
                        {label}
                    </text>
                ))}

                {grid.map((row, dayIdx) =>
                    row.map((count, hour) => (
                        <rect
                            key={`${dayIdx}-${hour}`}
                            x={labelWidth + hour * step}
                            y={topPadding + dayIdx * step}
                            width={cellSize}
                            height={cellSize}
                            rx={3}
                            fill={getCellColor(count, maxCount)}
                            className="transition-opacity hover:opacity-80 cursor-pointer"
                            onMouseEnter={(e) => {
                                setTooltip({
                                    day: dayIdx,
                                    hour,
                                    count,
                                    rect: (e.target as SVGRectElement).getBoundingClientRect()
                                });
                            }}
                            onMouseLeave={() => setTooltip(null)}
                        />
                    ))
                )}
            </svg>

            <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-500">
                <span>Less</span>
                {COLOR_SCALE.map((color, i) => (
                    <div key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                ))}
                <span>More</span>
            </div>

            {tooltip && createPortal(
                <div
                    className="fixed z-[99999] px-3 py-2 border border-gray-700 rounded-lg shadow-xl text-sm pointer-events-none"
                    style={{
                        left: tooltip.rect.left + tooltip.rect.width / 2,
                        top: tooltip.rect.top - 8,
                        transform: 'translate(-50%, -100%)',
                        backgroundColor: 'rgb(17, 24, 39)'
                    }}
                >
                    <div className="font-medium text-white">
                        {dayLabels[tooltip.day]} {tooltip.hour}h - {tooltip.hour + 1}h
                    </div>
                    <div className="text-emerald-400">
                        {tooltip.count} {requestsLabel.toLowerCase()}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};
