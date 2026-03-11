/**
 * HeatmapChart - GitHub-contributions-style calendar heatmap.
 *
 * Renders a grid: columns = weeks, rows = days of the week (Mon-Sun).
 * Cell intensity is proportional to the request count for that day.
 * Pure SVG, no external dependencies.
 */

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export interface HeatmapDataPoint {
    label: string;
    count: number;
}

interface HeatmapChartProps {
    data: HeatmapDataPoint[];
    noDataText?: string;
    dayLabels?: string[];
}

const DEFAULT_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const COLOR_SCALE = [
    'rgb(22, 27, 34)',
    'rgb(14, 68, 41)',
    'rgb(0, 109, 50)',
    'rgb(38, 166, 65)',
    'rgb(57, 211, 83)'
];

function getColorForCount(count: number, maxCount: number): string {
    if (count === 0 || maxCount === 0) return COLOR_SCALE[0];
    const ratio = count / maxCount;
    if (ratio <= 0.25) return COLOR_SCALE[1];
    if (ratio <= 0.50) return COLOR_SCALE[2];
    if (ratio <= 0.75) return COLOR_SCALE[3];
    return COLOR_SCALE[4];
}

interface WeekCell {
    date: Date;
    count: number;
    dayOfWeek: number;
    weekIdx: number;
}

export const HeatmapChart: React.FC<HeatmapChartProps> = ({
    data,
    noDataText = 'No data',
    dayLabels = DEFAULT_DAY_LABELS
}) => {
    const [tooltip, setTooltip] = useState<{ cell: WeekCell; rect: DOMRect } | null>(null);

    const { cells, weeks, maxCount, monthLabels } = useMemo(() => {
        if (!data.length) return { cells: [], weeks: 0, maxCount: 0, monthLabels: [] };

        const dateMap = new Map<string, number>();
        for (const d of data) {
            const key = d.label.slice(0, 10);
            dateMap.set(key, (dateMap.get(key) ?? 0) + d.count);
        }

        const dates = Array.from(dateMap.keys()).sort();
        const firstDate = new Date(dates[0] + 'T00:00:00');
        const lastDate = new Date(dates[dates.length - 1] + 'T00:00:00');

        const startDay = firstDate.getDay();
        const mondayOffset = startDay === 0 ? -6 : 1 - startDay;
        const gridStart = new Date(firstDate);
        gridStart.setDate(gridStart.getDate() + mondayOffset);

        const result: WeekCell[] = [];
        let weekIdx = 0;
        const current = new Date(gridStart);

        const months: { label: string; weekIdx: number }[] = [];
        let lastMonth = -1;

        while (current <= lastDate || current.getDay() !== 1) {
            if (current > lastDate && current.getDay() === 1) break;

            const dayOfWeek = current.getDay() === 0 ? 6 : current.getDay() - 1;
            const key = current.toISOString().slice(0, 10);
            const count = dateMap.get(key) ?? 0;

            const m = current.getMonth();
            if (m !== lastMonth) {
                months.push({
                    label: current.toLocaleString('default', { month: 'short' }),
                    weekIdx
                });
                lastMonth = m;
            }

            result.push({ date: new Date(current), count, dayOfWeek, weekIdx });

            current.setDate(current.getDate() + 1);
            if (current.getDay() === 1) weekIdx++;
        }

        const maxC = Math.max(...result.map((c) => c.count), 0);
        return { cells: result, weeks: weekIdx + 1, maxCount: maxC, monthLabels: months };
    }, [data]);

    if (!data.length || cells.length === 0) {
        return (
            <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                {noDataText}
            </div>
        );
    }

    const cellSize = 14;
    const cellGap = 3;
    const step = cellSize + cellGap;
    const labelWidth = 32;
    const topPadding = 20;
    const svgWidth = labelWidth + weeks * step + 4;
    const svgHeight = topPadding + 7 * step + 4;

    return (
        <div className="overflow-x-auto">
            <svg width={svgWidth} height={svgHeight} className="block">
                {monthLabels.map((m, i) => (
                    <text
                        key={`month-${i}`}
                        x={labelWidth + m.weekIdx * step + step / 2}
                        y={12}
                        className="fill-gray-500"
                        fontSize={10}
                        textAnchor="start"
                    >
                        {m.label}
                    </text>
                ))}

                {dayLabels.map((label, i) => (
                    i % 2 === 0 ? (
                        <text
                            key={`day-${i}`}
                            x={labelWidth - 6}
                            y={topPadding + i * step + cellSize / 2 + 4}
                            className="fill-gray-500"
                            fontSize={10}
                            textAnchor="end"
                        >
                            {label}
                        </text>
                    ) : null
                ))}

                {cells.map((cell, i) => (
                    <rect
                        key={i}
                        x={labelWidth + cell.weekIdx * step}
                        y={topPadding + cell.dayOfWeek * step}
                        width={cellSize}
                        height={cellSize}
                        rx={2}
                        fill={getColorForCount(cell.count, maxCount)}
                        className="transition-opacity hover:opacity-80 cursor-pointer"
                        onMouseEnter={(e) => {
                            setTooltip({ cell, rect: (e.target as SVGRectElement).getBoundingClientRect() });
                        }}
                        onMouseLeave={() => setTooltip(null)}
                    />
                ))}
            </svg>

            {/* Legend */}
            <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-500">
                <span>Less</span>
                {COLOR_SCALE.map((color, i) => (
                    <div
                        key={i}
                        className="w-3 h-3 rounded-sm"
                        style={{ backgroundColor: color }}
                    />
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
                        {tooltip.cell.date.toLocaleDateString('default', {
                            weekday: 'short',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric'
                        })}
                    </div>
                    <div className="text-emerald-400">
                        {tooltip.cell.count} {tooltip.cell.count === 1 ? 'request' : 'requests'}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};
