/**
 * Shared building blocks for HeatmapChart and HourDayHeatmap: the "Moins → Plus" intensity
 * legend and the follow-mouse tooltip portal, both parameterized by the heatmap's RGB accent.
 */

import React from 'react';
import { createPortal } from 'react-dom';

interface HeatmapLegendProps {
    cellRgb: string;
}

export const HeatmapLegend: React.FC<HeatmapLegendProps> = ({ cellRgb }) => (
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
);

export interface HeatmapTip {
    x: number;
    y: number;
    content: React.ReactNode;
}

interface HeatmapTooltipProps {
    tip: HeatmapTip | null;
    cellRgb: string;
}

export const HeatmapTooltip: React.FC<HeatmapTooltipProps> = ({ tip, cellRgb }) => {
    if (!tip) return null;
    return createPortal(
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
    );
};
