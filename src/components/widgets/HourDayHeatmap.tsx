/**
 * HourDayHeatmap - 7x24 heatmap grid (day-of-week rows x hour-of-day columns).
 *
 * Intensity = request count for each (weekday, hour) combination.
 * RGBA alpha-based coloring, scale(1.4) hover, follow-mouse tooltip, legend.
 * Modelled after fail2ban TabStats HeatmapSection.
 */

import React, { useMemo, useState } from 'react';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import { fitHeatmapCellSize } from './heatmapCellSize';
import { HeatmapLegend, HeatmapTooltip } from './HeatmapShared';

export interface HourDayDataPoint {
    label: string;
    count: number;
}

interface HourDayHeatmapProps {
    data: HourDayDataPoint[];
    noDataText?: string;
    dayLabels?: string[];
    requestsLabel?: string;
    /** RGB triplet for cell color, e.g. '16, 185, 129' (emerald) */
    cellRgb?: string;
    accentColor?: string;
}

const DEFAULT_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_RGB        = '16, 185, 129'; // emerald-500
const DEFAULT_COLOR      = '#10b981';

export const HourDayHeatmap: React.FC<HourDayHeatmapProps> = ({
    data,
    noDataText    = 'No data',
    dayLabels     = DEFAULT_DAY_LABELS,
    requestsLabel = 'Requests',
    cellRgb       = DEFAULT_RGB,
    accentColor   = DEFAULT_COLOR,
}) => {
    const [tip, setTip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

    // Row height is derived the same way the calendar heatmap (HeatmapChart) sizes its cells from
    // container width, using its ~52-week column count as the reference divisor — this keeps both
    // heatmaps the same overall height in the 2×2 dashboard grid regardless of viewport width.
    const [containerRef, containerWidth] = useContainerWidth<HTMLDivElement>();
    const REF_WEEK_COLUMNS = 52;
    const { cellSize: rowHeight, cellGap: rowGap } = fitHeatmapCellSize(containerWidth, REF_WEEK_COLUMNS);

    const { grid, maxCount } = useMemo(() => {
        const g: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
        for (const d of data) {
            try {
                let s = d.label;
                if (s.length === 10) s += 'T00:00:00';
                else if (s.length === 13) s += ':00:00';
                else if (s.length === 16) s += ':00';
                const date = new Date(s);
                if (Number.isNaN(date.getTime())) continue;
                const jsDay = date.getDay();
                const dayIdx = jsDay === 0 ? 6 : jsDay - 1;
                g[dayIdx][date.getHours()] += d.count;
            } catch { /* skip */ }
        }
        return { grid: g, maxCount: Math.max(...g.flat(), 1) };
    }, [data]);

    if (!data.length) {
        return <div className="h-32 flex items-center justify-center text-gray-500 text-sm">{noDataText}</div>;
    }

    return (
        <div ref={containerRef}>
            <div style={{ display: 'inline-grid', gridTemplateColumns: '32px repeat(24, 1fr)', gap: rowGap, width: '100%' }}>
                {/* header: hour labels */}
                <div />
                {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} style={{ fontSize: '.58rem', color: '#6b7280', textAlign: 'center', lineHeight: 1 }}>
                        {h % 6 === 0 ? `${h}h` : ''}
                    </div>
                ))}

                {/* day rows */}
                {dayLabels.map((day, di) => (
                    <React.Fragment key={day}>
                        <div style={{
                            fontSize: '.68rem', color: '#6b7280',
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'flex-end', paddingRight: 6, whiteSpace: 'nowrap',
                        }}>
                            {day}
                        </div>
                        {Array.from({ length: 24 }, (_, hr) => {
                            const cnt   = grid[di][hr] ?? 0;
                            const ratio = cnt / maxCount;
                            const bg    = cnt === 0 ? '#1f2937' : `rgba(${cellRgb},${(0.12 + ratio * 0.88).toFixed(2)})`;
                            const bord  = cnt > 0
                                ? `1px solid rgba(${cellRgb},${(ratio * 0.4).toFixed(2)})`
                                : '1px solid transparent';
                            return (
                                <div
                                    key={hr}
                                    style={{
                                        height: rowHeight,
                                        background: bg, border: bord,
                                        borderRadius: 3,
                                        transition: 'transform .1s',
                                        cursor: cnt > 0 ? 'default' : undefined,
                                    }}
                                    onMouseMove={e => {
                                        (e.currentTarget as HTMLElement).style.transform = 'scale(1.4)';
                                        (e.currentTarget as HTMLElement).style.zIndex = '2';
                                        setTip({ x: e.clientX, y: e.clientY, content: (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '.18rem' }}>
                                                <div style={{ fontWeight: 700, color: accentColor, fontSize: '.85rem' }}>
                                                    {day} · {hr}h — {hr + 1}h
                                                </div>
                                                <div style={{ fontSize: '.78rem', color: '#e6edf3' }}>
                                                    {cnt} {requestsLabel.toLowerCase()}
                                                </div>
                                                {cnt > 0 && (
                                                    <div style={{ fontSize: '.7rem', color: '#6b7280' }}>
                                                        {Math.round(ratio * 100)}% du maximum
                                                    </div>
                                                )}
                                                {cnt === 0 && (
                                                    <div style={{ fontSize: '.7rem', color: '#6b7280' }}>Aucune requête</div>
                                                )}
                                            </div>
                                        )});
                                    }}
                                    onMouseLeave={e => {
                                        (e.currentTarget as HTMLElement).style.transform = '';
                                        (e.currentTarget as HTMLElement).style.zIndex = '';
                                        setTip(null);
                                    }}
                                />
                            );
                        })}
                    </React.Fragment>
                ))}
            </div>

            <HeatmapLegend cellRgb={cellRgb} />
            <HeatmapTooltip tip={tip} cellRgb={cellRgb} />
        </div>
    );
};
