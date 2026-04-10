/**
 * DayOfWeekChart - Vertical bar chart showing traffic distribution by day of week (Mon-Sun).
 *
 * Aggregates timeseries data by weekday. RGBA alpha-based coloring, peak bar highlighted,
 * follow-mouse tooltip with %, summary line. Modelled after fail2ban TabStats HeatmapSection.
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
    height?: number;
    /** RGB triplet for bar color, e.g. '16, 185, 129' (emerald) */
    barRgb?: string;
    accentColor?: string;
}

const DEFAULT_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DEFAULT_RGB    = '16, 185, 129'; // emerald-500
const DEFAULT_COLOR  = '#10b981';

export const DayOfWeekChart: React.FC<DayOfWeekChartProps> = ({
    data,
    noDataText    = 'No data',
    dayLabels     = DEFAULT_LABELS,
    requestsLabel = 'Requests',
    height        = 120,
    barRgb        = DEFAULT_RGB,
    accentColor   = DEFAULT_COLOR,
}) => {
    const [tip, setTip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

    const dayData = useMemo(() => {
        const days = new Array(7).fill(0);
        for (const d of data) {
            try {
                let s = d.label;
                if (s.length === 10) s += 'T00:00:00';
                else if (s.length === 13) s += ':00:00';
                else if (s.length === 16) s += ':00';
                const date = new Date(s);
                if (!Number.isNaN(date.getTime())) {
                    const jsDay = date.getDay();
                    days[jsDay === 0 ? 6 : jsDay - 1] += d.count;
                }
            } catch { /* skip */ }
        }
        return days;
    }, [data]);

    const maxVal  = Math.max(...dayData, 1);
    const total   = dayData.reduce((s, c) => s + c, 0);
    const peakIdx = dayData.indexOf(Math.max(...dayData));

    if (!data.length) {
        return <div className="h-32 flex items-center justify-center text-gray-500 text-sm">{noDataText}</div>;
    }

    return (
        <div>
            {/* bars */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, height, alignItems: 'end', width: '100%' }}>
                {dayData.map((cnt, idx) => {
                    const barH   = cnt === 0 ? 4 : Math.max(8, Math.round(cnt / maxVal * height));
                    const alpha  = cnt === 0 ? 0 : 0.2 + (cnt / maxVal) * 0.8;
                    const bg     = cnt === 0 ? '#1f2937' : `rgba(${barRgb},${alpha.toFixed(2)})`;
                    const isPeak = idx === peakIdx && cnt > 0;
                    return (
                        <div
                            key={idx}
                            style={{
                                height: barH,
                                background: bg,
                                borderRadius: '3px 3px 0 0',
                                outline: isPeak ? `1px solid rgba(${barRgb},.7)` : undefined,
                                cursor: cnt > 0 ? 'default' : undefined,
                            }}
                            onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, content: (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '.18rem' }}>
                                    <div style={{ fontWeight: 700, color: accentColor, fontSize: '.85rem' }}>{dayLabels[idx]}</div>
                                    <div style={{ fontSize: '.78rem', color: '#e6edf3' }}>{cnt} {requestsLabel.toLowerCase()}</div>
                                    {total > 0 && cnt > 0 && (
                                        <div style={{ fontSize: '.7rem', color: '#6b7280' }}>
                                            {Math.round(cnt / total * 100)}% du total · {Math.round(cnt / maxVal * 100)}% du pic
                                        </div>
                                    )}
                                    {isPeak && <div style={{ fontSize: '.7rem', color: accentColor, fontWeight: 600 }}>▲ Jour de pic</div>}
                                    {cnt === 0 && <div style={{ fontSize: '.7rem', color: '#6b7280' }}>Aucune requête</div>}
                                </div>
                            )})}
                            onMouseLeave={() => setTip(null)}
                        />
                    );
                })}
            </div>

            {/* day labels */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, paddingTop: '.3rem', width: '100%' }}>
                {dayLabels.map((label, idx) => (
                    <div key={idx} style={{ fontSize: '.65rem', color: idx === peakIdx ? accentColor : '#6b7280', textAlign: 'center', lineHeight: 1, fontWeight: idx === peakIdx ? 600 : undefined }}>
                        {label}
                    </div>
                ))}
            </div>

            {/* peak summary */}
            <div style={{ paddingTop: '.45rem', fontSize: '.78rem', color: '#6b7280' }}>
                Pic&nbsp;: <strong style={{ color: accentColor }}>{dayLabels[peakIdx]}</strong>
                &nbsp;&nbsp;{dayData[peakIdx]} {requestsLabel.toLowerCase()}
            </div>

            {/* follow-mouse tooltip */}
            {tip && createPortal(
                <div style={{
                    position: 'fixed', left: tip.x, top: tip.y - 14,
                    transform: 'translate(-50%, -100%)',
                    zIndex: 10050, pointerEvents: 'none',
                    background: '#161b22',
                    border: `1px solid rgba(${barRgb},.45)`,
                    borderLeft: `4px solid rgba(${barRgb},.9)`,
                    borderRadius: 8, padding: '.5rem .75rem',
                    boxShadow: '0 8px 28px rgba(0,0,0,.6)',
                    minWidth: 130,
                }}>
                    {tip.content}
                </div>,
                document.body
            )}
        </div>
    );
};
