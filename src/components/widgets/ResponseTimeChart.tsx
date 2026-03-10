/**
 * ResponseTimeChart - Response time distribution histogram with KPI cards (avg, p50, p95, p99).
 *
 * Pure CSS/HTML, no external dependencies.
 */

import React from 'react';
import type { AnalyticsResponseTimeBucket } from '../../types/analytics';

interface ResponseTimeChartProps {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    buckets: AnalyticsResponseTimeBucket[];
    noDataText?: string;
}

function formatMs(ms: number): string {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function getBarColor(range: string): string {
    if (range.startsWith('0')) return '#047857';
    if (range.startsWith('100')) return '#059669';
    if (range.startsWith('500')) return '#b45309';
    if (range.startsWith('1')) return '#d97706';
    if (range.startsWith('2')) return '#dc2626';
    return '#b91c1c';
}

export const ResponseTimeChart: React.FC<ResponseTimeChartProps> = ({
    avg,
    p50,
    p95,
    p99,
    max,
    buckets,
    noDataText = 'No data'
}) => {
    const maxCount = Math.max(...buckets.map((b) => b.count), 1);
    const hasData = buckets.some((b) => b.count > 0);

    if (!hasData) {
        return (
            <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                {noDataText}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                    { label: 'Avg', value: avg, color: 'text-white' },
                    { label: 'P50', value: p50, color: 'text-emerald-400' },
                    { label: 'P95', value: p95, color: 'text-amber-400' },
                    { label: 'P99', value: p99, color: 'text-red-400' },
                    { label: 'Max', value: max, color: 'text-red-500' }
                ].map((kpi) => (
                    <div key={kpi.label} className="p-2.5 rounded-lg bg-[#0f0f0f] border border-gray-800/60 text-center">
                        <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{kpi.label}</div>
                        <div className={`text-sm font-bold ${kpi.color}`}>{formatMs(kpi.value)}</div>
                    </div>
                ))}
            </div>

            <div className="space-y-2">
                {buckets.map((bucket, idx) => (
                    <div key={bucket.range} className="flex items-center gap-3">
                        <span className="text-sm text-gray-400 w-28 shrink-0 text-right">{bucket.range}</span>
                        <div className="flex-1 min-w-0 h-5 bg-gray-800/80 rounded overflow-hidden border border-gray-700/30">
                            <div
                                className="h-full rounded-l origin-left"
                                style={{
                                    width: `${(bucket.count / maxCount) * 100}%`,
                                    backgroundColor: getBarColor(bucket.range),
                                    animation: 'barGrow 0.4s ease-out forwards',
                                    animationDelay: `${idx * 40}ms`
                                }}
                            />
                        </div>
                        <span className="text-sm font-medium text-white w-20 text-right shrink-0">
                            {bucket.count} ({bucket.percent}%)
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};
