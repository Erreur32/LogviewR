/**
 * DayOfWeekChart - Horizontal bar chart showing traffic distribution by day of week (Mon-Sun).
 *
 * Aggregates timeseries data by weekday. Pure CSS/HTML.
 */

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DayOfWeekDataPoint {
    label: string;
    count: number;
}

interface DayOfWeekChartProps {
    data: DayOfWeekDataPoint[];
    noDataText?: string;
    dayLabels?: string[];
    requestsLabel?: string;
}

const DEFAULT_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COLORS = ['#059669', '#047857', '#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5'];

export const DayOfWeekChart: React.FC<DayOfWeekChartProps> = ({
    data,
    noDataText = 'No data',
    dayLabels = DEFAULT_LABELS,
    requestsLabel = 'Requests'
}) => {
    const [hovered, setHovered] = useState<{ day: number; count: number; rect: DOMRect } | null>(null);

    const dayData = useMemo(() => {
        const days = new Array(7).fill(0);
        for (const d of data) {
            try {
                let s = d.label;
                if (s.length === 10) s += 'T00:00:00';
                else if (s.length === 13) s += ':00:00';
                else if (s.length === 16) s += ':00';
                const date = new Date(s);
                if (!isNaN(date.getTime())) {
                    const jsDay = date.getDay();
                    const idx = jsDay === 0 ? 6 : jsDay - 1;
                    days[idx] += d.count;
                }
            } catch { /* skip */ }
        }
        return days;
    }, [data]);

    const maxVal = Math.max(...dayData, 1);

    if (!data.length) {
        return (
            <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                {noDataText}
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {dayData.map((count, idx) => {
                const pct = (count / maxVal) * 100;
                return (
                    <div
                        key={idx}
                        className="flex items-center gap-3 cursor-pointer group"
                        onMouseEnter={(e) => {
                            setHovered({ day: idx, count, rect: e.currentTarget.getBoundingClientRect() });
                        }}
                        onMouseLeave={() => setHovered(null)}
                    >
                        <span className="text-sm text-gray-400 w-10 shrink-0">{dayLabels[idx]}</span>
                        <div className="flex-1 min-w-0 h-5 bg-gray-800/80 rounded overflow-hidden border border-gray-700/30">
                            <div
                                className="h-full rounded-l origin-left"
                                style={{
                                    width: `${pct}%`,
                                    backgroundColor: COLORS[idx % COLORS.length],
                                    animation: 'barGrow 0.4s ease-out forwards',
                                    animationDelay: `${idx * 40}ms`
                                }}
                            />
                        </div>
                        <span className="text-sm font-medium text-white w-16 text-right shrink-0">{count}</span>
                    </div>
                );
            })}

            {hovered && createPortal(
                <div
                    className="fixed z-[99999] px-3 py-2 border border-gray-700 rounded-lg shadow-xl text-sm pointer-events-none"
                    style={{
                        left: hovered.rect.right + 8,
                        top: hovered.rect.top + hovered.rect.height / 2,
                        transform: 'translateY(-50%)',
                        backgroundColor: 'rgb(17, 24, 39)'
                    }}
                >
                    <div className="font-medium text-white">{dayLabels[hovered.day]}</div>
                    <div className="text-emerald-400">{hovered.count} {requestsLabel.toLowerCase()}</div>
                </div>,
                document.body
            )}
        </div>
    );
};
