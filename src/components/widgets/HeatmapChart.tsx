/**
 * HeatmapChart - GitHub-contributions-style calendar heatmap.
 *
 * Renders a grid: columns = weeks, rows = days of the week (Mon-Sun).
 * RGBA alpha-based coloring, follow-mouse tooltip with rich content, legend.
 * Modelled after fail2ban TabStats HeatmapSection.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface HeatmapDataPoint {
    label: string;
    count: number;
}

interface HeatmapChartProps {
    data: HeatmapDataPoint[];
    noDataText?: string;
    dayLabels?: string[];
    /** RGB triplet for cell color, e.g. '16, 185, 129' (emerald) */
    cellRgb?: string;
    accentColor?: string;
    requestsLabel?: string;
}

const DEFAULT_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_RGB        = '16, 185, 129'; // emerald-500
const DEFAULT_COLOR      = '#10b981';

interface WeekCell {
    date: Date;
    count: number;
    dayOfWeek: number;
    weekIdx: number;
}

export const HeatmapChart: React.FC<HeatmapChartProps> = ({
    data,
    noDataText    = 'No data',
    dayLabels     = DEFAULT_DAY_LABELS,
    cellRgb       = DEFAULT_RGB,
    accentColor   = DEFAULT_COLOR,
    requestsLabel = 'Requests',
}) => {
    const [tip, setTip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

    const { cells, weeks, maxCount, monthLabels } = useMemo(() => {
        if (!data.length) return { cells: [], weeks: 0, maxCount: 0, monthLabels: [] };

        const dateMap = new Map<string, number>();
        for (const d of data) {
            const key = d.label.slice(0, 10);
            dateMap.set(key, (dateMap.get(key) ?? 0) + d.count);
        }

        const dates = Array.from(dateMap.keys()).sort();
        const firstDate = new Date(dates[0] + 'T00:00:00');
        const lastDate  = new Date(dates[dates.length - 1] + 'T00:00:00');

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
                months.push({ label: current.toLocaleString('default', { month: 'short' }), weekIdx });
                lastMonth = m;
            }
            result.push({ date: new Date(current), count, dayOfWeek, weekIdx });
            current.setDate(current.getDate() + 1);
            if (current.getDay() === 1) weekIdx++;
        }

        const maxC = Math.max(...result.map(c => c.count), 0);
        return { cells: result, weeks: weekIdx + 1, maxCount: maxC, monthLabels: months };
    }, [data]);

    const total = useMemo(() => cells.reduce((s, c) => s + c.count, 0), [cells]);

    // Responsive: compute cell size from container width so the heatmap fits without horizontal scroll.
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        let rafId = 0;
        const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width ?? 0;
            // rAF-coalesce bursts during window drag: only one state update per paint.
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                setContainerWidth((prev) => (Math.abs(prev - w) >= 2 ? w : prev));
            });
        });
        ro.observe(el);
        return () => {
            if (rafId) cancelAnimationFrame(rafId);
            ro.disconnect();
        };
    }, []);

    if (!data.length || cells.length === 0) {
        return <div ref={containerRef} className="h-32 flex items-center justify-center text-gray-500 text-sm">{noDataText}</div>;
    }

    const labelW   = 32;
    const topPad   = 20;
    const padRight = 4;

    // Fit weeks into the available width; clamp cell size to [4..14] to stay readable.
    const { cellSize, cellGap } = (() => {
        if (containerWidth <= 0 || weeks <= 0) return { cellSize: 14, cellGap: 3 };
        const available = Math.max(0, containerWidth - labelW - padRight);
        const stepF = available / weeks;
        const cs = Math.max(4, Math.min(14, Math.floor(stepF * 0.82)));
        const gap = Math.max(1, Math.min(3, Math.floor(stepF - cs)));
        return { cellSize: cs, cellGap: gap };
    })();

    const step      = cellSize + cellGap;
    const svgWidth  = labelW + weeks * step + padRight;
    const svgHeight = topPad + 7 * step + 4;

    const cellFill = (cell: WeekCell, ratio: number): string =>
        cell.count === 0 ? '#1f2937' : `rgba(${cellRgb},${(0.15 + ratio * 0.85).toFixed(2)})`;

    const buildCellTooltip = (cell: WeekCell, ratio: number): React.ReactNode => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.18rem' }}>
            <div style={{ fontWeight: 700, color: accentColor, fontSize: '.85rem' }}>
                {cell.date.toLocaleDateString('default', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
            <div style={{ fontSize: '.78rem', color: '#e6edf3' }}>
                {cell.count} {requestsLabel.toLowerCase()}
            </div>
            {cell.count > 0 && total > 0 && (
                <div style={{ fontSize: '.7rem', color: '#6b7280' }}>
                    {Math.round(ratio * 100)}% du maximum
                </div>
            )}
            {cell.count === 0 && (
                <div style={{ fontSize: '.7rem', color: '#6b7280' }}>Aucune activité</div>
            )}
        </div>
    );

    const renderCell = (cell: WeekCell, i: number) => {
        const ratio = maxCount > 0 ? cell.count / maxCount : 0;
        const content = buildCellTooltip(cell, ratio);
        return (
            <rect key={i}
                x={labelW + cell.weekIdx * step}
                y={topPad + cell.dayOfWeek * step}
                width={cellSize} height={cellSize} rx={2}
                fill={cellFill(cell, ratio)}
                style={{ cursor: cell.count > 0 ? 'default' : undefined }}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, content })}
                onMouseLeave={() => setTip(null)}
            />
        );
    };

    return (
        <div ref={containerRef}>
            <svg width={svgWidth} height={svgHeight} className="block">
                {monthLabels.map((m, i) => (
                    <text key={`month-${i}`}
                        x={labelW + m.weekIdx * step + step / 2} y={12}
                        className="fill-gray-500" fontSize={10} textAnchor="start">
                        {m.label}
                    </text>
                ))}
                {dayLabels.map((label, i) =>
                    i % 2 === 0 ? (
                        <text key={`day-${i}`}
                            x={labelW - 6} y={topPad + i * step + cellSize / 2 + 4}
                            className="fill-gray-500" fontSize={10} textAnchor="end">
                            {label}
                        </text>
                    ) : null
                )}
                {cells.map((cell, i) => renderCell(cell, i))}
            </svg>

            {/* legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginTop: '.5rem', fontSize: '.68rem', color: '#6b7280' }}>
                <span>Moins</span>
                {[0, 0.25, 0.5, 0.75, 1].map(v => (
                    <div key={v} style={{
                        width: 13, height: 13,
                        background: v === 0 ? '#1f2937' : `rgba(${cellRgb},${(0.15 + v * 0.85).toFixed(2)})`,
                        borderRadius: 2, flexShrink: 0,
                    }} />
                ))}
                <span>Plus</span>
            </div>

            {/* follow-mouse tooltip */}
            {tip && createPortal(
                <div style={{
                    position: 'fixed', left: tip.x, top: tip.y - 14,
                    transform: 'translate(-50%, -100%)',
                    zIndex: 10050, pointerEvents: 'none',
                    background: '#161b22',
                    border: `1px solid rgba(${cellRgb},.45)`,
                    borderLeft: `4px solid rgba(${cellRgb},.9)`,
                    borderRadius: 8, padding: '.5rem .75rem',
                    boxShadow: '0 8px 28px rgba(0,0,0,.6)',
                    minWidth: 150,
                }}>
                    {tip.content}
                </div>,
                document.body
            )}
        </div>
    );
};
