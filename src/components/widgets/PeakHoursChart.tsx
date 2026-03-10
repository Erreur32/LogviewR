/**
 * PeakHoursChart - Vertical bar chart showing request distribution by hour of day (0-23h).
 *
 * Aggregates timeseries data by hour. Color gradient from dark blue (low) to emerald (peak).
 * Pure CSS/HTML, no external dependencies.
 */

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export interface PeakHoursDataPoint {
    label: string;
    count: number;
}

interface PeakHoursChartProps {
    data: PeakHoursDataPoint[];
    noDataText?: string;
    height?: number;
    requestsLabel?: string;
}

function getBarColor(ratio: number): string {
    if (ratio <= 0.2) return '#1e3a5f';
    if (ratio <= 0.4) return '#1e5a4a';
    if (ratio <= 0.6) return '#047857';
    if (ratio <= 0.8) return '#059669';
    return '#10b981';
}

export const PeakHoursChart: React.FC<PeakHoursChartProps> = ({
    data,
    noDataText = 'No data',
    height = 120,
    requestsLabel = 'Requests'
}) => {
    const [hovered, setHovered] = useState<{ hour: number; count: number; rect: DOMRect } | null>(null);

    const hourData = useMemo(() => {
        const hours = new Array(24).fill(0);
        for (const d of data) {
            try {
                let s = d.label;
                if (s.length === 10) s += 'T00:00:00';
                else if (s.length === 13) s += ':00:00';
                else if (s.length === 16) s += ':00';
                const date = new Date(s);
                if (!isNaN(date.getTime())) {
                    hours[date.getHours()] += d.count;
                }
            } catch { /* skip */ }
        }
        return hours;
    }, [data]);

    const maxVal = Math.max(...hourData, 1);

    if (!data.length) {
        return (
            <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                {noDataText}
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-end gap-[2px]" style={{ height }}>
                {hourData.map((count, hour) => {
                    const ratio = count / maxVal;
                    const barHeight = Math.max(count > 0 ? 4 : 1, ratio * height);
                    return (
                        <div
                            key={hour}
                            className="flex-1 min-w-0 rounded-t cursor-pointer transition-opacity hover:opacity-80"
                            style={{
                                height: barHeight,
                                backgroundColor: count > 0 ? getBarColor(ratio) : 'rgb(31, 41, 55)',
                                animation: 'barGrow 0.4s ease-out forwards',
                                animationDelay: `${hour * 20}ms`
                            }}
                            onMouseEnter={(e) => {
                                setHovered({ hour, count, rect: e.currentTarget.getBoundingClientRect() });
                            }}
                            onMouseLeave={() => setHovered(null)}
                        />
                    );
                })}
            </div>
            <div className="flex gap-[2px] mt-1">
                {hourData.map((_, hour) => (
                    <div key={hour} className="flex-1 min-w-0 text-center">
                        {hour % 3 === 0 && (
                            <span className="text-[9px] text-gray-500">{hour}h</span>
                        )}
                    </div>
                ))}
            </div>

            {hovered && createPortal(
                <div
                    className="fixed z-[99999] px-3 py-2 border border-gray-700 rounded-lg shadow-xl text-sm pointer-events-none"
                    style={{
                        left: hovered.rect.left + hovered.rect.width / 2,
                        top: hovered.rect.top - 8,
                        transform: 'translate(-50%, -100%)',
                        backgroundColor: 'rgb(17, 24, 39)'
                    }}
                >
                    <div className="font-medium text-white">{hovered.hour}h - {hovered.hour + 1}h</div>
                    <div className="text-emerald-400">{hovered.count} {requestsLabel.toLowerCase()}</div>
                </div>,
                document.body
            )}
        </div>
    );
};
