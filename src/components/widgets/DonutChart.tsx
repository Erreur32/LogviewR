/**
 * DonutChart - Simple SVG donut chart for binary data (e.g. Bot vs Human).
 *
 * Pure SVG, no external dependencies. Displays two segments with legend.
 */

import React from 'react';

interface DonutSegment {
    label: string;
    value: number;
    color: string;
}

interface DonutChartProps {
    segments: DonutSegment[];
    size?: number;
    strokeWidth?: number;
    centerLabel?: string;
    centerValue?: string;
}

export const DonutChart: React.FC<DonutChartProps> = ({
    segments,
    size = 140,
    strokeWidth = 24,
    centerLabel,
    centerValue
}) => {
    const total = segments.reduce((s, seg) => s + seg.value, 0);
    if (total === 0) {
        return (
            <div className="flex items-center justify-center text-gray-500 text-sm" style={{ width: size, height: size }}>
                No data
            </div>
        );
    }

    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const cx = size / 2;
    const cy = size / 2;
    // Small visual gap between segments (in px along the circumference), only when there's more than one.
    const gap = segments.length > 1 ? 3 : 0;

    let offset = 0;
    const arcs = segments.map((seg) => {
        const pct = seg.value / total;
        const rawLen = pct * circumference;
        const dashLen = Math.max(0, rawLen - gap);
        const dashGap = circumference - dashLen;
        const arc = {
            ...seg,
            pct,
            dashArray: `${dashLen} ${dashGap}`,
            dashOffset: -offset
        };
        offset += rawLen;
        return arc;
    });

    return (
        <div className="flex items-center gap-6">
            <div className="relative shrink-0" style={{ width: size, height: size }}>
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    <circle
                        cx={cx}
                        cy={cy}
                        r={radius}
                        fill="none"
                        stroke="rgb(31, 41, 55)"
                        strokeWidth={strokeWidth}
                    />
                    {arcs.map((arc, i) => (
                        <circle
                            key={i}
                            cx={cx}
                            cy={cy}
                            r={radius}
                            fill="none"
                            stroke={arc.color}
                            strokeWidth={strokeWidth}
                            strokeDasharray={arc.dashArray}
                            strokeDashoffset={arc.dashOffset}
                            strokeLinecap="round"
                            transform={`rotate(-90 ${cx} ${cy})`}
                            className="transition-all duration-500"
                            style={{ filter: `drop-shadow(0 0 4px ${arc.color}55)` }}
                        />
                    ))}
                </svg>
                {(centerLabel || centerValue) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        {centerValue && <span className="text-xl font-bold text-white tabular-nums">{centerValue}</span>}
                        {centerLabel && <span className="text-[10px] text-gray-400 uppercase tracking-wide mt-0.5">{centerLabel}</span>}
                    </div>
                )}
            </div>
            <div className="space-y-3 flex-1 min-w-0">
                {arcs.map((arc) => (
                    <div key={arc.label} className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: arc.color, boxShadow: `0 0 6px ${arc.color}80` }} />
                            <span className="text-sm text-gray-300 truncate">{arc.label}</span>
                            <span className="text-sm font-semibold text-white ml-auto tabular-nums shrink-0">{arc.value.toLocaleString()}</span>
                            <span className="text-xs text-gray-500 tabular-nums shrink-0">({Math.round(arc.pct * 100)}%)</span>
                        </div>
                        <div className="h-1.5 bg-gray-800/60 rounded-full overflow-hidden">
                            <div
                                className="h-full rounded-full transition-all duration-500"
                                style={{ width: `${arc.pct * 100}%`, backgroundColor: arc.color }}
                            />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
