/**
 * TimelineChart - Requests over time with bar/curve toggle and X-axis date/time labels.
 *
 * Displays time-series data as bars or curve, with spaced date/time labels for readability.
 */

import React, { useMemo, useState } from 'react';
import { BarChart2, TrendingUp } from 'lucide-react';
import { MiniBarChart } from './BarChart';

export interface TimelineChartPoint {
    label: string;
    count: number;
}

interface TimelineChartProps {
    data: TimelineChartPoint[];
    color?: string;
    height?: number;
    /** Format raw ISO label to display string */
    formatLabel?: (raw: string) => string;
    valueLabel?: string;
    /** Number of X-axis tick labels (default 5) */
    xAxisTicks?: number;
    barLabel?: string;
    curveLabel?: string;
}

interface CurveChartWithTooltipProps {
    data: TimelineChartPoint[];
    values: number[];
    width: number;
    padding: number;
    curvePath: string;
    areaPath: string;
    gradientId: string;
    color: string;
    formatLabel?: (raw: string) => string;
    valueLabel: string;
    chartHeight: number;
    xAxisLabels: { idx: number; label: string }[];
}

/** Curve mode with hover tooltips showing date/time and value. */
const CurveChartWithTooltip: React.FC<CurveChartWithTooltipProps> = ({
    data,
    values,
    width,
    padding,
    curvePath,
    areaPath,
    gradientId,
    color,
    formatLabel,
    valueLabel,
    chartHeight,
    xAxisLabels
}) => {
    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
    const hoveredPoint = hoveredIdx != null ? data[hoveredIdx] : null;

    const handleMouseLeave = () => {
        setHoveredIdx(null);
        setMousePos(null);
    };

    return (
        <div className="relative">
            <svg
                viewBox={`0 0 ${width} 100`}
                preserveAspectRatio="none"
                className="w-full"
                style={{ height: chartHeight }}
                onMouseMove={(e) => hoveredIdx != null && setMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={handleMouseLeave}
            >
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                </defs>
                <path d={areaPath} fill={`url(#${gradientId})`} />
                <path
                    d={curvePath}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
                {/* Vertical grid lines */}
                {data.length > 1 && xAxisLabels.slice(1, -1).map((x, i) => {
                    const xPos = padding + (x.idx / (data.length - 1)) * (width - padding * 2);
                    return (
                        <line
                            key={i}
                            x1={xPos}
                            y1={padding}
                            x2={xPos}
                            y2={100 - padding}
                            stroke="rgba(255,255,255,0.08)"
                            strokeWidth="0.5"
                            strokeDasharray="2,2"
                        />
                    );
                })}
                {/* Invisible hover zones for tooltips */}
                {data.length > 1 && data.map((_, idx) => {
                    const x = padding + (idx / (data.length - 1)) * (width - padding * 2);
                    const zoneWidth = (width - padding * 2) / Math.max(data.length - 1, 1) * 0.8;
                    return (
                        <rect
                            key={idx}
                            x={x - zoneWidth / 2}
                            y={0}
                            width={zoneWidth}
                            height={100}
                            fill="transparent"
                            onMouseEnter={(e) => {
                                setHoveredIdx(idx);
                                setMousePos({ x: e.clientX, y: e.clientY });
                            }}
                        />
                    );
                })}
            </svg>
            {/* Hover tooltip - follows mouse cursor */}
            {hoveredPoint && mousePos && (
                <div
                    className="fixed px-3 py-2.5 bg-gray-900/95 border border-gray-700 rounded-lg shadow-xl text-sm z-[9999] pointer-events-none max-w-[calc(100vw-2rem)] max-h-[50vh] overflow-y-auto"
                    style={{
                        minWidth: 160,
                        left: Math.max(80, Math.min(mousePos.x, (typeof window !== 'undefined' ? window.innerWidth : 1920) - 80)),
                        top: mousePos.y,
                        transform: 'translate(-50%, -100%) translateY(-8px)'
                    }}
                >
                    <div className="font-medium text-white mb-1 break-all">
                        {formatLabel ? formatLabel(hoveredPoint.label) : hoveredPoint.label}
                    </div>
                    <div className="text-gray-300">{valueLabel}: {values[hoveredIdx]}</div>
                </div>
            )}
        </div>
    );
};

function generateCurvePath(values: number[], width: number, height: number, padding: number): string {
    if (values.length < 2) return '';
    const maxVal = Math.max(...values, 1);
    const points = values.map((value, index) => {
        const x = padding + (index / (values.length - 1)) * (width - padding * 2);
        const y = height - padding - ((value / maxVal) * (height - padding * 2));
        return { x, y };
    });
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const cpX = (prev.x + curr.x) / 2;
        path += ` Q ${prev.x + (curr.x - prev.x) / 4} ${prev.y}, ${cpX} ${(prev.y + curr.y) / 2}`;
        path += ` Q ${curr.x - (curr.x - prev.x) / 4} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return path;
}

export const TimelineChart: React.FC<TimelineChartProps> = ({
    data,
    color = '#10b981',
    height = 140,
    formatLabel,
    valueLabel = 'Requests',
    xAxisTicks = 5,
    barLabel = 'Barres',
    curveLabel = 'Courbe'
}) => {
    const [mode, setMode] = useState<'bar' | 'curve'>('bar');
    const width = 100;
    const padding = 4;

    const xAxisLabels = useMemo(() => {
        if (!data || data.length < 2 || xAxisTicks < 2) {
            return data?.length ? [{ idx: 0, label: data[0].label }, { idx: data.length - 1, label: data[data.length - 1]?.label ?? '' }] : [];
        }
        const step = (data.length - 1) / (xAxisTicks - 1);
        return Array.from({ length: xAxisTicks }, (_, i) => {
            const idx = Math.round(i * step);
            return { idx, label: data[idx]?.label ?? '' };
        });
    }, [data, xAxisTicks]);

    const values = data.map((d) => d.count);
    const maxVal = Math.max(...values, 1);
    const curvePath = useMemo(
        () => generateCurvePath(values, width, 100, padding),
        [values]
    );
    const areaPath = curvePath ? `${curvePath} L ${width - padding} ${100 - padding} L ${padding} ${100 - padding} Z` : '';

    if (!data || data.length === 0) {
        return (
            <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                No data
            </div>
        );
    }

    const gradientId = 'timeline-grad-' + Math.random().toString(36).slice(2);

    return (
        <div className="w-full">
            {/* Toggle bar / curve */}
            <div className="flex gap-2 mb-3">
                <button
                    type="button"
                    onClick={() => setMode('bar')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        mode === 'bar' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                >
                    <BarChart2 size={14} />
                    {barLabel}
                </button>
                <button
                    type="button"
                    onClick={() => setMode('curve')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        mode === 'curve' ? 'bg-emerald-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    }`}
                >
                    <TrendingUp size={14} />
                    {curveLabel}
                </button>
            </div>

            {/* Chart area - full width */}
            <div className="w-full min-w-0">
                {mode === 'bar' ? (
                    <MiniBarChart
                        data={values}
                        color={color}
                        height={height - 28}
                        labels={data.map((d) => (formatLabel ? formatLabel(d.label) : d.label))}
                        valueLabel={valueLabel}
                        fadeFromBottom
                    />
                ) : (
                    <CurveChartWithTooltip
                        data={data}
                        values={values}
                        width={width}
                        padding={padding}
                        curvePath={curvePath}
                        areaPath={areaPath}
                        gradientId={gradientId}
                        color={color}
                        formatLabel={formatLabel}
                        valueLabel={valueLabel}
                        chartHeight={height - 28}
                        xAxisLabels={xAxisLabels}
                    />
                )}

                {/* X-axis date/time labels */}
                <div className="relative w-full h-5 mt-1">
                    {xAxisLabels.map((x, i) => {
                        const pct = data.length > 1 ? (x.idx / (data.length - 1)) * 100 : 0;
                        const display = formatLabel ? formatLabel(x.label) : x.label;
                        return (
                            <span
                                key={i}
                                className="absolute text-[10px] text-gray-500 -translate-x-1/2 whitespace-nowrap max-w-[4rem] truncate"
                                style={{ left: `${pct}%` }}
                                title={x.label}
                            >
                                {display}
                            </span>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
