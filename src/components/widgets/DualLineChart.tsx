/**
 * DualLineChart - Pure SVG dual-line chart for GoAccess-style stats.
 *
 * Renders two curves: requests (hits) and unique visitors, with optional area fills.
 * Includes Y-axis labels, X-axis labels, legend with totals, and hover tooltips.
 * No external chart library dependency.
 */

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export interface DualLineChartPoint {
    label: string;
    count: number;
    uniqueVisitors?: number;
}

interface DualLineChartProps {
    /** Data points (e.g. timeseries buckets). */
    data: DualLineChartPoint[];
    /** Color for requests/hits line. */
    requestsColor?: string;
    /** Color for visitors line. */
    visitorsColor?: string;
    /** Chart height in pixels. */
    height?: number;
    /** Show area fill under lines. */
    showArea?: boolean;
    /** Label for requests series (legend). */
    requestsLabel?: string;
    /** Label for visitors series (legend). */
    visitorsLabel?: string;
    /** Optional formatter for X-axis labels (raw ISO string -> display string). */
    formatLabel?: (raw: string) => string;
    /** Number of X-axis tick labels for time reference (default 5). */
    xAxisTicks?: number;
    /** Show vertical grid lines for time reference. */
    showGrid?: boolean;
}

/**
 * Generate smooth SVG path from points using quadratic bezier curves.
 * Uses shared maxVal so both series share the same Y scale.
 * paddingX=0 so curves fill full width; paddingY for vertical margins.
 */
function generatePath(
    values: number[],
    width: number,
    height: number,
    paddingX: number,
    paddingY: number,
    sharedMax: number
): string {
    if (values.length < 2) return '';

    const range = sharedMax || 1;

    const points = values.map((value, index) => {
        const x = paddingX + (index / (values.length - 1)) * (width - paddingX * 2);
        const y = height - paddingY - ((value / range) * (height - paddingY * 2));
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

/**
 * Generate area path (line + bottom edge) for fill.
 */
function generateAreaPath(
    linePath: string,
    width: number,
    height: number,
    paddingX: number,
    paddingY: number
): string {
    if (!linePath) return '';
    return `${linePath} L ${width - paddingX} ${height - paddingY} L ${paddingX} ${height - paddingY} Z`;
}

export const DualLineChart: React.FC<DualLineChartProps> = ({
    data,
    requestsColor = '#3b82f6',
    visitorsColor = '#10b981',
    height = 120,
    showArea = true,
    requestsLabel = 'Requests',
    visitorsLabel = 'Visitors',
    formatLabel,
    xAxisTicks = 5,
    showGrid = true
}) => {
    const width = 100; // viewBox width
    const paddingX = 0; // no horizontal padding: curves fill full width
    const paddingY = 4; // vertical padding for top/bottom margins

    const { requestsPath, visitorsPath, requestsAreaPath, visitorsAreaPath, maxVal } = useMemo(() => {
        if (!data || data.length < 2) {
            return {
                requestsPath: '',
                visitorsPath: '',
                requestsAreaPath: '',
                visitorsAreaPath: '',
                maxVal: 1
            };
        }

        const requests = data.map((d) => d.count);
        const visitors = data.map((d) => d.uniqueVisitors ?? 0);
        const maxVal = Math.max(...requests, ...visitors, 1);

        const reqPath = generatePath(requests, width, 100, paddingX, paddingY, maxVal);
        const visPath = generatePath(visitors, width, 100, paddingX, paddingY, maxVal);

        return {
            requestsPath: reqPath,
            visitorsPath: visPath,
            requestsAreaPath: generateAreaPath(reqPath, width, 100, paddingX, paddingY),
            visitorsAreaPath: generateAreaPath(visPath, width, 100, paddingX, paddingY),
            maxVal
        };
    }, [data]);

    if (!data || data.length === 0) {
        return (
            <div
                className="flex items-center justify-center rounded-lg border border-gray-800/50 bg-[#151515] text-gray-500 text-sm"
                style={{ height }}
            >
                No data
            </div>
        );
    }

    const gradientIdReq = 'dual-req-' + Math.random().toString(36).slice(2);
    const gradientIdVis = 'dual-vis-' + Math.random().toString(36).slice(2);

    const totalRequests = data.reduce((s, d) => s + d.count, 0);
    const totalVisitors = data.reduce((s, d) => s + (d.uniqueVisitors ?? 0), 0);
    const firstLabel = data[0]?.label ?? '';
    const lastLabel = data[data.length - 1]?.label ?? '';

    const xAxisLabels = useMemo(() => {
        if (data.length < 2 || xAxisTicks < 2) return [{ idx: 0, label: firstLabel }, { idx: data.length - 1, label: lastLabel }];
        const step = (data.length - 1) / (xAxisTicks - 1);
        return Array.from({ length: xAxisTicks }, (_, i) => {
            const idx = Math.round(i * step);
            return { idx, label: data[idx]?.label ?? '' };
        });
    }, [data, firstLabel, lastLabel, xAxisTicks]);

    const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
    const hoveredPoint = hoveredIdx != null ? data[hoveredIdx] : null;

    const handleMouseLeave = () => {
        setHoveredIdx(null);
        setMousePos(null);
    };

    return (
        <div className="rounded-lg border border-gray-800/50 bg-[#151515] overflow-hidden">
            {/* Legend with totals */}
            <div className="flex flex-wrap gap-4 px-3 pt-2 pb-1">
                <div className="flex items-center gap-2" title={`${requestsLabel}: ${totalRequests} total`}>
                    <div
                        className="w-3 h-0.5 rounded"
                        style={{ backgroundColor: requestsColor }}
                    />
                    <span className="text-xs text-gray-400">{requestsLabel}</span>
                    <span className="text-xs font-medium text-white">({totalRequests})</span>
                </div>
                <div className="flex items-center gap-2" title={`${visitorsLabel}: ${totalVisitors} total`}>
                    <div
                        className="w-3 h-0.5 rounded"
                        style={{ backgroundColor: visitorsColor }}
                    />
                    <span className="text-xs text-gray-400">{visitorsLabel}</span>
                    <span className="text-xs font-medium text-emerald-400">({totalVisitors})</span>
                </div>
            </div>
            {/* Chart area with Y-axis and SVG - gap-1 to keep Y-axis close to curves */}
            <div className="flex items-stretch gap-1">
                <div className="flex flex-col justify-between text-[10px] text-gray-500 shrink-0 py-1" style={{ height: height - 36 }}>
                    <span title="Maximum value">{maxVal}</span>
                    <span title="Zero">0</span>
                </div>
            <div className="flex-1 relative min-w-0">
            <svg
                viewBox={`0 0 ${width} 100`}
                preserveAspectRatio="none"
                className="w-full"
                style={{ height: height - 32 }}
                onMouseMove={(e) => hoveredIdx != null && setMousePos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={handleMouseLeave}
            >
                <defs>
                    <linearGradient id={gradientIdReq} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={requestsColor} stopOpacity="0.25" />
                        <stop offset="100%" stopColor={requestsColor} stopOpacity="0" />
                    </linearGradient>
                    <linearGradient id={gradientIdVis} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={visitorsColor} stopOpacity="0.25" />
                        <stop offset="100%" stopColor={visitorsColor} stopOpacity="0" />
                    </linearGradient>
                </defs>

                {showArea && requestsAreaPath && (
                    <path
                        d={requestsAreaPath}
                        fill={`url(#${gradientIdReq})`}
                    />
                )}
                {showArea && visitorsAreaPath && (
                    <path
                        d={visitorsAreaPath}
                        fill={`url(#${gradientIdVis})`}
                    />
                )}
                {/* Vertical grid lines for time reference */}
                {showGrid && data.length > 1 && xAxisLabels.slice(1, -1).map((x, i) => {
                    const xPos = paddingX + (x.idx / (data.length - 1)) * (width - paddingX * 2);
                    return (
                        <line
                            key={i}
                            x1={xPos}
                            y1={paddingY}
                            x2={xPos}
                            y2={100 - paddingY}
                            stroke="rgba(255,255,255,0.08)"
                            strokeWidth="0.5"
                            strokeDasharray="2,2"
                        />
                    );
                })}
                {requestsPath && (
                    <path
                        d={requestsPath}
                        fill="none"
                        stroke={requestsColor}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                    />
                )}
                {visitorsPath && (
                    <path
                        d={visitorsPath}
                        fill="none"
                        stroke={visitorsColor}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                    />
                )}
                {/* Invisible hover zones for tooltips - overlap slightly for easier hover */}
                {data.length > 1 && data.map((_, idx) => {
                    const x = paddingX + (idx / (data.length - 1)) * (width - paddingX * 2);
                    const zoneWidth = Math.max((width - paddingX * 2) / Math.max(data.length - 1, 1) * 1.2, 3);
                    return (
                        <rect
                            key={idx}
                            x={x - zoneWidth / 2}
                            y={0}
                            width={zoneWidth}
                            height={100}
                            fill="transparent"
                            style={{ cursor: 'crosshair' }}
                            onMouseEnter={(e) => {
                                setHoveredIdx(idx);
                                setMousePos({ x: e.clientX, y: e.clientY });
                            }}
                        />
                    );
                })}
            </svg>
            {/* X-axis labels - spaced for time reference */}
            <div className="relative w-full h-5 mt-0.5">
                {xAxisLabels.map((x, i) => {
                    const pct = data.length > 1 ? (x.idx / (data.length - 1)) * 100 : 0;
                    const display = formatLabel ? formatLabel(x.label) : (x.label.length > 12 ? x.label.slice(0, 10) + '…' : x.label);
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
            {/* Hover tooltip - follows mouse cursor, rendered in body to avoid overflow clipping */}
            {hoveredPoint && mousePos && createPortal(
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
                    <div className="text-gray-300">{requestsLabel}: {hoveredPoint.count}</div>
                    <div className="text-emerald-600">{visitorsLabel}: {hoveredPoint.uniqueVisitors ?? 0}</div>
                </div>,
                document.body
            )}
            </div>
            </div>
        </div>
    );
};
