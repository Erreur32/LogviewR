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

    let offset = 0;
    const arcs = segments.map((seg) => {
        const pct = seg.value / total;
        const dashLen = pct * circumference;
        const dashGap = circumference - dashLen;
        const arc = {
            ...seg,
            pct,
            dashArray: `${dashLen} ${dashGap}`,
            dashOffset: -offset
        };
        offset += dashLen;
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
                            strokeLinecap="butt"
                            transform={`rotate(-90 ${cx} ${cy})`}
                            className="transition-all duration-500"
                        />
                    ))}
                </svg>
                {(centerLabel || centerValue) && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        {centerValue && <span className="text-lg font-bold text-white">{centerValue}</span>}
                        {centerLabel && <span className="text-[10px] text-gray-400">{centerLabel}</span>}
                    </div>
                )}
            </div>
            <div className="space-y-2">
                {arcs.map((arc, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: arc.color }} />
                        <span className="text-sm text-gray-300">{arc.label}</span>
                        <span className="text-sm font-medium text-white">{arc.value}</span>
                        <span className="text-xs text-gray-500">({Math.round(arc.pct * 100)}%)</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
