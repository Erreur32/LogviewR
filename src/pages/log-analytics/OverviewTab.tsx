/**
 * OverviewTab - LogviewR /log-analytics
 *
 * KPI bar + the rollup-backed, always-instant widgets: one merged
 * "requests over time" widget (bar/curve toggle, optional visitors line —
 * replaces the former 3 duplicate widgets plotting the same timeseries),
 * peak hours, one merged "HTTP codes" widget (snapshot/trend toggle —
 * replaces the former 2 duplicate views of the same status breakdown),
 * day-of-week, calendar heatmap, hour×day heatmap, bandwidth.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    ChevronUp, ChevronDown, Activity, Globe, AlertTriangle, ServerCrash,
    HardDrive, FileText, Zap
} from 'lucide-react';
import { TimelineChart } from '../../components/widgets/TimelineChart';
import { DualLineChart } from '../../components/widgets/DualLineChart';
import { DualBarChart } from '../../components/widgets/DualBarChart';
import { HeatmapChart } from '../../components/widgets/HeatmapChart';
import { PeakHoursChart } from '../../components/widgets/PeakHoursChart';
import { DayOfWeekChart } from '../../components/widgets/DayOfWeekChart';
import { HourDayHeatmap } from '../../components/widgets/HourDayHeatmap';
import { StatusTrendsChart } from '../../components/widgets/StatusTrendsChart';
import type {
    AnalyticsOverview,
    AnalyticsTimeseriesBucket,
    AnalyticsDistribution,
    AnalyticsDistributionWithVisitors
} from '../../types/analytics';
import {
    SectionHeading, NoDataOrLoading, DistributionChart, PeriodBadge, FixedWindowBadge,
    LiveToggle, WindowSwitch, SegmentedToggle, type HeadingCommon
} from './shared';
import { formatBytes, formatTsLabel, formatWindowLabel, getStatusColor, noDataOrLoadingText, type BucketKey, type AnalyticsCoverage } from './utils';

interface TimeseriesStats {
    total: number;
    totalVisitors: number;
    peakDayIdx: number;
    peakHourIdx: number;
    avgPerDay: number;
    avgPerHour: number;
    peakDayCount: number;
    peakHourCount: number;
}

interface OverviewTabProps {
    heading: HeadingCommon;
    sourceLabel: string;
    isLoading: boolean;
    isCalendarLoading: boolean;
    overview: AnalyticsOverview | null;
    statsKpiVisible: boolean;
    onToggleStatsKpi: () => void;
    quickCoverage: AnalyticsCoverage | null;
    periodLabel: string;
    trimmedTimeseries: AnalyticsTimeseriesBucket[];
    timeseriesStats: TimeseriesStats | null;
    currentBucket: BucketKey;
    distStatus: AnalyticsDistribution[];
    statusWithVisitors: AnalyticsDistributionWithVisitors[];
    hourOfDay: number[];
    calendarBuckets: { label: string; count: number; uniqueVisitors: number }[];
    hourDayGrid: number[][];
    live24h: { hourOfDay: number[]; dayOfWeek: number[] } | null;
    live7d: { hourDayGrid: number[][] } | null;
    peakHoursLive: boolean;
    onTogglePeakHoursLive: () => void;
    dayOfWeekLive: boolean;
    onToggleDayOfWeekLive: () => void;
    hourDayLive: boolean;
    onToggleHourDayLive: () => void;
    /** Window (days) for Day of Week / Calendar / Hour×Day heatmap — synced with the global period when it's 7d/30d, else a 7-day fallback. */
    calendarWindowDays: number;
    /** True when calendarWindowDays exactly matches the global period selector (7d/30d), false when it's a fallback (1h/24h/short custom range). */
    calendarWindowSynced: boolean;
}

const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

export const OverviewTab: React.FC<OverviewTabProps> = ({
    heading, sourceLabel, isLoading, isCalendarLoading, overview, statsKpiVisible, onToggleStatsKpi,
    quickCoverage, periodLabel, trimmedTimeseries, timeseriesStats, currentBucket,
    distStatus, statusWithVisitors, hourOfDay, calendarBuckets, hourDayGrid, live24h, live7d,
    peakHoursLive, onTogglePeakHoursLive, dayOfWeekLive, onToggleDayOfWeekLive, hourDayLive, onToggleHourDayLive,
    calendarWindowDays, calendarWindowSynced
}) => {
    const { t } = useTranslation();
    const [showVisitors, setShowVisitors] = useState(false);
    const [codesView, setCodesView] = useState<'snapshot' | 'trend'>('snapshot');
    const dayLabels = WEEKDAY_KEYS.map((k) => t(`logAnalytics.${k}`));
    const calendarWindowLabel = formatWindowLabel(t, calendarWindowDays);

    return (
        <>
            {/* Unified KPI section with source badge */}
            <div id="section-kpi" className="bg-[#121212]/90 rounded-xl border border-gray-800 overflow-hidden backdrop-blur-sm scroll-mt-24">
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800/60">
                    <div className="flex items-center gap-3">
                        <h3 className="text-base font-semibold text-white cursor-help" title={t('logAnalytics.kpiModalIntro')}>
                            {t('logAnalytics.statsKpi')}
                        </h3>
                        {overview && (
                            <button
                                type="button"
                                onClick={onToggleStatsKpi}
                                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
                            >
                                {statsKpiVisible ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                {statsKpiVisible ? t('logAnalytics.statsKpiHide') : t('logAnalytics.statsKpiShow')}
                            </button>
                        )}
                        {isLoading && overview !== null && quickCoverage && (
                            <span
                                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 cursor-help"
                                title={t('logAnalytics.quickPreviewTip', {
                                    rollup: quickCoverage.rollupDates.length,
                                    scanned: quickCoverage.scannedDates.length
                                })}
                            >
                                <Zap size={11} />
                                {t('logAnalytics.quickPreview')}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{t('logAnalytics.source')}</span>
                        <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${heading.sourceColorClass}`}>
                            {sourceLabel}
                        </span>
                        {overview?.dateFrom && overview?.dateTo && (() => {
                            const fmt = (d: string) => {
                                try { return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); }
                                catch { return '—'; }
                            };
                            return (
                                <>
                                    <span className="w-px h-4 bg-gray-700/60" />
                                    <span className="font-mono text-[11px] flex items-center gap-1.5">
                                        <span className="text-sky-400">{fmt(overview.dateFrom)}</span>
                                        <span className="text-gray-600">→</span>
                                        <span className="text-amber-400">{fmt(overview.dateTo)}</span>
                                    </span>
                                </>
                            );
                        })()}
                    </div>
                </div>
                {statsKpiVisible && (
                <div className="px-5 py-4">
                    <div className="flex flex-wrap gap-2">
                        {[
                            { icon: <Activity size={12} className="text-emerald-400" />, label: t('logAnalytics.totalRequests'), value: (overview?.totalRequests ?? 0).toLocaleString(), color: 'text-white', tip: t('logAnalytics.tipTotalRequests') },
                            { icon: <Globe size={12} className="text-blue-400" />, label: t('logAnalytics.uniqueVisitors'), value: (overview?.uniqueIps ?? 0).toLocaleString(), color: 'text-blue-300', tip: t('logAnalytics.tipUniqueVisitors') },
                            { icon: <Activity size={12} className="text-emerald-500" />, label: t('logAnalytics.validRequests'), value: (overview?.validRequests ?? 0).toLocaleString(), color: 'text-emerald-400', tip: t('logAnalytics.tipValidRequests') },
                            { icon: <AlertTriangle size={12} className="text-red-400" />, label: t('logAnalytics.failedRequests'), value: (overview?.failedRequests ?? 0).toLocaleString(), color: 'text-red-400', tip: t('logAnalytics.tipFailedRequests') },
                            { icon: <AlertTriangle size={12} className="text-amber-400" />, label: t('logAnalytics.status4xx'), value: (overview?.status4xx ?? 0).toLocaleString(), color: 'text-amber-400', tip: t('logAnalytics.tipStatus4xx') },
                            { icon: <ServerCrash size={12} className="text-red-400" />, label: t('logAnalytics.status5xx'), value: (overview?.status5xx ?? 0).toLocaleString(), color: 'text-red-400', tip: t('logAnalytics.tipStatus5xx') },
                            { icon: <AlertTriangle size={12} className="text-amber-400" />, label: t('logAnalytics.notFound'), value: (overview?.notFound ?? 0).toLocaleString(), color: 'text-amber-300', tip: t('logAnalytics.tipNotFound') },
                            { icon: <FileText size={12} className="text-cyan-400" />, label: t('logAnalytics.staticFiles'), value: (overview?.staticFiles ?? 0).toLocaleString(), color: 'text-cyan-300', tip: t('logAnalytics.tipStaticFiles') },
                            { icon: <HardDrive size={12} className="text-purple-400" />, label: t('logAnalytics.totalBytes'), value: overview ? formatBytes(overview.totalBytes) : '0 B', color: 'text-purple-300', tip: t('logAnalytics.tipTotalBytes') },
                            { icon: <FileText size={12} className="text-cyan-400" />, label: t('logAnalytics.filesAnalyzed'), value: (overview?.filesAnalyzed ?? 0).toLocaleString(), color: 'text-cyan-300', tip: t('logAnalytics.tipFilesAnalyzed') },
                        ].map((item, i) => (
                            <div key={i} className="flex-1 min-w-[120px] p-2.5 rounded-lg bg-[#0a0a0a] border border-gray-800/50" title={item.tip}>
                                <div className="flex items-center gap-1.5 text-gray-500 text-[11px] mb-1">{item.icon}{item.label}</div>
                                <div className={`text-base font-bold ${item.color}`}>{item.value}</div>
                            </div>
                        ))}
                    </div>
                </div>
                )}
            </div>

            {/* Requests over time — merged widget: bar/curve toggle (TimelineChart) + optional visitors line (DualLineChart) */}
            <div id="section-timeline" className="bg-[#121212] rounded-xl border border-gray-800 p-6 w-full scroll-mt-24">
                <SectionHeading
                    {...heading}
                    extras={
                        <button
                            type="button"
                            onClick={() => setShowVisitors((v) => !v)}
                            className={`text-[.6rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${
                                showVisitors
                                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300'
                                    : 'border-gray-700/50 bg-gray-800/20 text-gray-500 hover:text-gray-300'
                            }`}
                        >
                            {showVisitors ? t('logAnalytics.hideVisitorsLine') : t('logAnalytics.showVisitorsLine')}
                        </button>
                    }
                >
                    {t('logAnalytics.requestsOverTime')}
                </SectionHeading>
                {trimmedTimeseries.length > 0 ? (
                    <div className="w-full min-w-0">
                        {showVisitors ? (
                            <DualLineChart
                                data={trimmedTimeseries.map((b) => ({
                                    label: b.label,
                                    count: b.count,
                                    uniqueVisitors: b.uniqueVisitors ?? 0
                                }))}
                                requestsLabel={t('logAnalytics.requests')}
                                visitorsLabel={t('logAnalytics.visitors')}
                                height={140}
                                formatLabel={(l) => formatTsLabel(l, currentBucket)}
                                xAxisTicks={6}
                                showGrid
                            />
                        ) : (
                            <TimelineChart
                                data={trimmedTimeseries.map((b) => ({ label: b.label, count: b.count }))}
                                color="#10b981"
                                height={140}
                                formatLabel={(l) => formatTsLabel(l, currentBucket)}
                                valueLabel={t('logAnalytics.requests')}
                                xAxisTicks={6}
                                barLabel={t('logAnalytics.viewBars')}
                                curveLabel={t('logAnalytics.viewCurve')}
                            />
                        )}
                    </div>
                ) : (
                    <NoDataOrLoading loading={isLoading} />
                )}
            </div>

            {/* Group A: stats + Peak hours — all filtered by the header's period selector */}
            {trimmedTimeseries.length > 0 && (
                <div id="section-filtered-stats" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24 flex flex-col gap-6">
                    <div className="flex items-center gap-2 text-[.68rem] text-gray-500 uppercase tracking-wider">
                        <span>{t('logAnalytics.filteredGroupLabel')}</span>
                        <PeriodBadge label={periodLabel} />
                    </div>

                    {timeseriesStats && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                            {[
                                { label: t('logAnalytics.totalRequests'), value: timeseriesStats.total.toLocaleString(), color: '#10b981' },
                                { label: t('logAnalytics.uniqueVisitors'), value: timeseriesStats.totalVisitors.toLocaleString(), color: '#60a5fa' },
                                { label: 'Moy. / jour', value: Math.round(timeseriesStats.avgPerDay).toLocaleString(), color: '#34d399' },
                                { label: 'Moy. / heure', value: Math.round(timeseriesStats.avgPerHour).toLocaleString(), color: '#22d3ee' },
                                { label: 'Pic (jour)', value: dayLabels[timeseriesStats.peakDayIdx] ?? '—', sub: timeseriesStats.peakDayCount.toLocaleString() + ' req.', color: '#f59e0b' },
                                { label: 'Pic (heure)', value: `${timeseriesStats.peakHourIdx}h`, sub: timeseriesStats.peakHourCount.toLocaleString() + ' req.', color: '#a78bfa' },
                            ].map((stat) => (
                                <div key={stat.label} style={{ background: '#0a0a0a', border: '1px solid #1f2937', borderRadius: 8, padding: '.5rem .6rem', textAlign: 'center' }}>
                                    <div style={{ fontSize: '.6rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.25rem' }}>{stat.label}</div>
                                    <div style={{ fontSize: '.95rem', fontWeight: 700, color: stat.color, lineHeight: 1 }}>{stat.value}</div>
                                    {'sub' in stat && stat.sub && <div style={{ fontSize: '.6rem', color: '#6b7280', marginTop: '.2rem' }}>{stat.sub}</div>}
                                </div>
                            ))}
                        </div>
                    )}

                    <div>
                        <SectionHeading
                            {...heading}
                            loading={peakHoursLive ? isCalendarLoading : isLoading}
                            extras={<LiveToggle live={peakHoursLive} onToggle={onTogglePeakHoursLive} window="24H" />}
                            hidePeriod={peakHoursLive}
                        >
                            {t('logAnalytics.peakHoursTitle')}
                        </SectionHeading>
                        <PeakHoursChart
                            data={(() => {
                                const src = peakHoursLive && live24h ? live24h.hourOfDay : hourOfDay;
                                const arr = src.length === 24 ? src : new Array(24).fill(0);
                                return arr.map((count, h) => ({
                                    label: `2000-01-01T${String(h).padStart(2, '0')}`,
                                    count
                                }));
                            })()}
                            noDataText={noDataOrLoadingText(t, peakHoursLive ? isCalendarLoading : isLoading)}
                            requestsLabel={t('logAnalytics.requests')}
                        />
                    </div>
                </div>
            )}

            {/* Group B: Day of week + Calendar heatmap + Hour×Day heatmap — window synced with the global
                period when it's 7d/30d, otherwise falls back to a 7-day window (1h/24h are too short). */}
            {trimmedTimeseries.length > 0 && (
                <div id="section-hour-day" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24 flex flex-col gap-6">
                    <div className="flex items-center gap-2 text-[.68rem] text-gray-500 uppercase tracking-wider">
                        <span>
                            {calendarWindowSynced
                                ? t('logAnalytics.fixedWindowGroupLabelSynced', { window: calendarWindowLabel })
                                : t('logAnalytics.fixedWindowGroupLabelFallback', { window: calendarWindowLabel })}
                        </span>
                    </div>

                    <div>
                        <SectionHeading
                            {...heading}
                            loading={isCalendarLoading}
                            hidePeriod
                            extras={<WindowSwitch live={dayOfWeekLive} onToggle={onToggleDayOfWeekLive} window="24H" />}
                        >
                            {t('logAnalytics.dayOfWeekTitle')}
                        </SectionHeading>
                        <DayOfWeekChart
                            data={dayOfWeekLive && live24h
                                ? live24h.dayOfWeek.map((count, dayIdx) => ({
                                    label: `2000-01-0${3 + dayIdx}`,
                                    count
                                }))
                                : calendarBuckets.map((b) => ({ label: b.label, count: b.count }))
                            }
                            noDataText={noDataOrLoadingText(t, isCalendarLoading)}
                            dayLabels={dayLabels}
                            requestsLabel={t('logAnalytics.requests')}
                        />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="min-w-0">
                            <SectionHeading {...heading} loading={isCalendarLoading} hidePeriod extras={<FixedWindowBadge label={calendarWindowLabel} />}>{t('logAnalytics.heatmapTitle')}</SectionHeading>
                            <HeatmapChart
                                data={calendarBuckets.map((b) => ({ label: b.label, count: b.count }))}
                                noDataText={noDataOrLoadingText(t, isCalendarLoading)}
                                dayLabels={dayLabels}
                            />
                        </div>
                        <div>
                            <SectionHeading
                                {...heading}
                                loading={isCalendarLoading}
                                hidePeriod
                                extras={<WindowSwitch live={hourDayLive} onToggle={onToggleHourDayLive} window="SEMAINE" />}
                            >
                                {t('logAnalytics.hourDayHeatmapTitle')}
                            </SectionHeading>
                            <HourDayHeatmap
                                data={(hourDayLive && live7d ? live7d.hourDayGrid : hourDayGrid).flatMap((row, dayIdx) =>
                                    (Array.isArray(row) ? row : []).map((count, hr) => ({
                                        label: `2000-01-0${3 + dayIdx}T${String(hr).padStart(2, '0')}`,
                                        count
                                    }))
                                )}
                                noDataText={noDataOrLoadingText(t, isCalendarLoading)}
                                dayLabels={dayLabels}
                                requestsLabel={t('logAnalytics.requests')}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* HTTP codes — merged widget: snapshot (breakdown + table + distribution) / trend (over time) toggle */}
            <div id="section-http-codes" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                <SectionHeading
                    {...heading}
                    extras={
                        <SegmentedToggle<'snapshot' | 'trend'>
                            value={codesView}
                            onChange={setCodesView}
                            options={[
                                { value: 'snapshot', label: t('logAnalytics.viewSnapshot') },
                                { value: 'trend', label: t('logAnalytics.viewTrend') }
                            ]}
                        />
                    }
                >
                    {t('logAnalytics.httpCodesPanel')}
                </SectionHeading>
                {codesView === 'trend' ? (
                    <StatusTrendsChart
                        data={trimmedTimeseries}
                        height={180}
                        formatLabel={(l) => formatTsLabel(l, currentBucket)}
                        noDataText={noDataOrLoadingText(t, isLoading)}
                        xAxisTicks={6}
                    />
                ) : (
                    <>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div>
                                {statusWithVisitors.length > 0 ? (
                                    <DualBarChart
                                        data={statusWithVisitors}
                                        colorByKey={getStatusColor}
                                        maxKeyLength={8}
                                        hitsLabel={t('logAnalytics.hits')}
                                        visitorsLabel={t('logAnalytics.visitors')}
                                        tableLayout
                                    />
                                ) : (
                                    <NoDataOrLoading loading={isLoading} />
                                )}
                            </div>
                            <div>
                                {statusWithVisitors.length > 0 && (
                                    <table className="w-full text-sm border-separate border-spacing-0">
                                        <thead>
                                            <tr className="text-[11px] text-gray-500 uppercase tracking-wide">
                                                <th className="text-left py-2 font-medium">{t('logAnalytics.total')}</th>
                                                <th className="text-right py-2 font-medium">{t('logAnalytics.hits')}</th>
                                                <th className="text-right py-2 font-medium">{t('logAnalytics.visitors')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {statusWithVisitors.slice(0, 10).map((item, idx) => (
                                                <tr
                                                    key={item.key}
                                                    className={`border-t border-gray-800/60 hover:bg-white/[0.03] transition-colors ${idx % 2 === 1 ? 'bg-white/[0.015]' : ''}`}
                                                >
                                                    <td className="py-1.5">
                                                        <span className="inline-flex items-center gap-1.5">
                                                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: getStatusColor(item.key) }} />
                                                            <span className="font-mono text-gray-300">{item.key}</span>
                                                        </span>
                                                    </td>
                                                    <td className="py-1.5 text-right text-white font-semibold tabular-nums">{item.count.toLocaleString()}</td>
                                                    <td className="py-1.5 text-right text-emerald-400 tabular-nums">{item.uniqueVisitors.toLocaleString()}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                        {distStatus.length > 0 && (
                            <div className="mt-6 pt-6 border-t border-gray-800">
                                <DistributionChart
                                    title={t('logAnalytics.httpStatusDistribution')}
                                    items={distStatus}
                                    labelMinWidth="4rem"
                                    loading={isLoading}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Bandwidth over time */}
            {trimmedTimeseries.length > 0 && trimmedTimeseries.some((b) => (b.totalBytes ?? 0) > 0) && (
                <div id="section-bandwidth" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                    <SectionHeading {...heading}>{t('logAnalytics.bandwidthTitle')}</SectionHeading>
                    <TimelineChart
                        data={trimmedTimeseries.map((b) => ({ label: b.label, count: b.totalBytes ?? 0 }))}
                        color="#a78bfa"
                        height={140}
                        formatLabel={(l) => formatTsLabel(l, currentBucket)}
                        valueLabel="Bytes"
                        xAxisTicks={6}
                        barLabel={t('logAnalytics.viewBars')}
                        curveLabel={t('logAnalytics.viewCurve')}
                    />
                </div>
            )}
        </>
    );
};
