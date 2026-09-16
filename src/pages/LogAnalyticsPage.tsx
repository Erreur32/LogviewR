/**
 * LogAnalyticsPage - LogviewR
 *
 * Full-screen log analytics page for Nginx Proxy Manager, Apache, and Nginx logs.
 * Displays: KPI cards, timeline histogram, top panels (URLs, IPs, status, UA, referrers),
 * and method/status distribution charts.
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    ChevronLeft,
    ChevronUp,
    ChevronDown,
    Activity,
    Globe,
    AlertTriangle,
    ServerCrash,
    HardDrive,
    FileText,
    RefreshCw,
    BarChart2,
    Maximize2,
    Minimize2,
    Archive,
    TrendingUp,
    Shield,
    Trophy,
    CheckCircle2,
    XCircle,
    Zap,
    Loader2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { TimelineChart } from '../components/widgets/TimelineChart';
import { DualLineChart } from '../components/widgets/DualLineChart';
import { DualBarChart } from '../components/widgets/DualBarChart';
import { HeatmapChart } from '../components/widgets/HeatmapChart';
import { PeakHoursChart } from '../components/widgets/PeakHoursChart';
import { DayOfWeekChart } from '../components/widgets/DayOfWeekChart';
import { HourDayHeatmap } from '../components/widgets/HourDayHeatmap';
import { StatusTrendsChart } from '../components/widgets/StatusTrendsChart';
import { DonutChart } from '../components/widgets/DonutChart';
import { ResponseTimeChart } from '../components/widgets/ResponseTimeChart';
import { RankBadge } from '../components/widgets/RankBadge';
import type {
    AnalyticsOverview,
    AnalyticsTimeseriesBucket,
    AnalyticsTopItem,
    AnalyticsDistribution,
    AnalyticsDistributionWithVisitors,
    AnalyticsTopItemWithVisitors,
    AnalyticsTopUrlItem,
    AnalyticsStatusByHostItem,
    AnalyticsBotVsHuman,
    AnalyticsResponseTimeDistribution
} from '../types/analytics';
import { usePluginStore } from '../stores/pluginStore';
import { useUserAuthStore } from '../stores/userAuthStore';
import { usePolling } from '../hooks/usePolling';
import {
    getCachedAnalytics,
    setCachedAnalytics,
    getCachedCalendar,
    setCachedCalendar,
    type AnalyticsApiResponse,
    type CalendarApiResponse
} from '../utils/logAnalyticsCache';

interface LogAnalyticsPageProps {
    onBack: () => void;
}

/** Web access logs only: NPM and Apache. "all" merges both plugins. */
const LOG_SOURCE_PLUGINS = ['npm', 'apache'] as const;
const PLUGIN_OPTIONS = ['all', ...LOG_SOURCE_PLUGINS] as const;
const DEFAULT_PLUGIN = 'all';

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/** Response shape of GET /api/log-viewer/analytics/rollup — see HybridAnalyticsResult server-side. */
interface QuickAnalyticsResult {
    overview: AnalyticsOverview;
    timeseries: AnalyticsTimeseriesBucket[];
    top: { urls: AnalyticsTopItem[]; ips: AnalyticsTopItem[]; referrer: AnalyticsTopItem[]; ua: AnalyticsTopItem[] };
    coverage: { rollupDates: string[]; scannedDates: string[]; liveRefreshed: boolean };
}

interface AnalyticsProgressFile {
    pluginId: string;
    fileName: string;
    sizeBytes: number;
    status: 'pending' | 'reading' | 'done' | 'error';
}
interface AnalyticsProgressResponse {
    files: AnalyticsProgressFile[];
    phase: 'idle' | 'scanning' | 'aggregating';
}

type TimeRangeKey = '1h' | '24h' | '7d' | '30d' | 'custom';
type BucketKey = 'minute' | 'hour' | 'day';

function bucketForCustomRange(rangeMs: number): BucketKey {
    if (rangeMs <= 2 * 60 * 60 * 1000) return 'minute';
    if (rangeMs <= 48 * 60 * 60 * 1000) return 'hour';
    return 'day';
}

function resolveDateRange(timeRange: TimeRangeKey, customFrom: string, customTo: string): { from: Date; to: Date; bucketHour: BucketKey } {
    const to = new Date();
    switch (timeRange) {
        case '1h':
            return { from: new Date(to.getTime() - 60 * 60 * 1000), to, bucketHour: 'minute' };
        case '24h':
            return { from: new Date(to.getTime() - 24 * 60 * 60 * 1000), to, bucketHour: 'hour' };
        case '7d':
            // Hour buckets (168 points) instead of day (7 points) — matches the resolution
            // already used for custom ranges up to 48h, gives smoother curves past 1 day.
            return { from: new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000), to, bucketHour: 'hour' };
        case '30d':
            return { from: new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000), to, bucketHour: 'day' };
        default: {
            const from = new Date(customFrom);
            const toCustom = new Date(customTo);
            return { from, to: toCustom, bucketHour: bucketForCustomRange(toCustom.getTime() - from.getTime()) };
        }
    }
}

/** Plugin source badge (NPM/Apache/all). Module-level to avoid re-creating the component on every render. */
const SourceBadge: React.FC<{ label: string; colorClass: string }> = ({ label, colorClass }) => (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${colorClass}`}>
        {label}
    </span>
);

/** Current selected period badge (1h / 24h / 7j / 30j / custom). */
const PeriodBadge: React.FC<{ label: string }> = ({ label }) => (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-sky-500/10 text-sky-400 border-sky-500/25 font-mono">
        {label}
    </span>
);

/** Info badge marking charts whose window is independent of the timeRange selector. */
const FixedWindowBadge: React.FC<{ label?: string }> = ({ label = '12 mois' }) => (
    <span
        className="text-[.6rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
        title="Fenêtre d'agrégation du graphique — indépendant du sélecteur de période"
    >
        {label}
    </span>
);

type LiveWindow = '24H' | 'SEMAINE';
const LIVE_WINDOW_LONG: Record<LiveWindow, string> = { '24H': '24h', 'SEMAINE': '7 jours' };

/** Toggle between the 12-month aggregate and a shorter "live" window (24h or 7d). */
const LiveToggle: React.FC<{ live: boolean; onToggle: () => void; window: LiveWindow }> = ({ live, onToggle, window }) => {
    const title = live
        ? 'Revenir à la moyenne 12 mois'
        : `Afficher les dernières ${LIVE_WINDOW_LONG[window]} (live)`;
    const cls = live
        ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25'
        : 'border-gray-600/50 bg-gray-800/40 text-gray-400 hover:text-cyan-300 hover:border-cyan-500/40';
    return (
        <button
            type="button"
            onClick={onToggle}
            className={`text-[.6rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${cls}`}
            title={title}
        >
            {live ? `LIVE ${window}` : window}
        </button>
    );
};

/** Exclusive 2-button switch between the 12-month aggregate and a shorter "live" window (24h or 7d). */
const WindowSwitch: React.FC<{ live: boolean; onToggle: () => void; window: LiveWindow; fixedLabel?: string }> = ({ live, onToggle, window, fixedLabel = '12 mois' }) => {
    const base = 'text-[.6rem] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors';
    const activeCls = 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300';
    const inactiveCls = 'border-gray-700/50 bg-gray-800/20 text-gray-600 hover:text-gray-400';
    return (
        <div className="flex items-center gap-1">
            <button
                type="button"
                onClick={() => { if (live) onToggle(); }}
                className={`${base} ${!live ? activeCls : inactiveCls}`}
                title="Moyenne sur 12 mois"
                aria-pressed={!live}
            >
                {fixedLabel}
            </button>
            <button
                type="button"
                onClick={() => { if (!live) onToggle(); }}
                className={`${base} ${live ? activeCls : inactiveCls}`}
                title={`Afficher les dernières ${LIVE_WINDOW_LONG[window]} (live)`}
                aria-pressed={live}
            >
                {window}
            </button>
        </div>
    );
};

interface SectionHeadingProps {
    children: React.ReactNode;
    sourceLabel: string;
    sourceColorClass: string;
    periodLabel: string;
    hidePeriod?: boolean;
    extras?: React.ReactNode;
    /** Shows a small spinner next to the title while this section's data is still being fetched/refreshed. */
    loading?: boolean;
}

const SectionHeading: React.FC<SectionHeadingProps> = ({
    children, sourceLabel, sourceColorClass, periodLabel, hidePeriod, extras, loading
}) => (
    <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2.5">
        <span>{children}</span>
        <SourceBadge label={sourceLabel} colorClass={sourceColorClass} />
        {!hidePeriod && <PeriodBadge label={periodLabel} />}
        {loading && <Loader2 size={14} className="text-emerald-500/70 animate-spin" aria-hidden />}
        {extras}
    </h3>
);

/** TopPanel - extracted to module level so state (showAll) persists across parent re-renders. */
const TopPanel: React.FC<{
    title: string;
    items: AnalyticsTopItem[];
    maxKeyLength?: number;
    showBar?: boolean;
    maxVisibleWithoutScroll?: number;
    scrollWhenCollapsed?: boolean;
    twoColumns?: boolean;
    sourceBadge?: React.ReactNode;
    /** Shown while items is still empty because the underlying fetch hasn't resolved yet (distinct from a genuinely empty result). */
    loading?: boolean;
}> = ({ title, items, maxKeyLength = 40, showBar = true, maxVisibleWithoutScroll, scrollWhenCollapsed = true, twoColumns = false, sourceBadge, loading }) => {
    const { t } = useTranslation();
    const [hoveredItem, setHoveredItem] = useState<AnalyticsTopItem | null>(null);
    const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);
    const [showAll, setShowAll] = useState(false);
    const maxPct = Math.max(...items.map((i) => i.percent ?? 0), 1);
    const limit = maxVisibleWithoutScroll ?? 5;
    const displayItems = showAll ? items : (maxVisibleWithoutScroll != null ? items.slice(0, limit) : items);
    const listMaxHeight = scrollWhenCollapsed && !showAll ? 'max-h-56' : '';
    const canToggle = maxVisibleWithoutScroll != null;
    return (
        <div className="bg-[#0a0a0a] rounded-lg border border-gray-800 overflow-hidden relative">
            <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm font-semibold text-gray-300 border-b border-gray-800 bg-[#0f0f0f]">
                <div className="flex items-center gap-2 min-w-0">
                    <h4 className="truncate min-w-0">{title}</h4>
                    {items.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded-full bg-gray-800/80 text-[10px] text-gray-400 font-normal tabular-nums shrink-0">
                            {items.length}
                        </span>
                    )}
                    {sourceBadge}
                </div>
                {canToggle && (
                    <button
                        type="button"
                        onClick={() => setShowAll((v) => !v)}
                        className="p-1 rounded hover:bg-gray-700/50 text-gray-400 hover:text-emerald-400 transition-colors shrink-0"
                        title={showAll ? t('logAnalytics.showLimitedItems') : t('logAnalytics.showAllItems')}
                        aria-label={showAll ? t('logAnalytics.showLimitedItems') : t('logAnalytics.showAllItems')}
                    >
                        {showAll ? (
                            <Minimize2 size={16} />
                        ) : (
                            <Maximize2 size={16} />
                        )}
                    </button>
                )}
            </div>
            <div className="flex flex-col min-h-0">
                <div className={listMaxHeight ? `${listMaxHeight} overflow-y-auto` : ''}>
                    {items.length === 0 ? (
                        <div className="px-4 py-6 text-sm text-gray-500 text-center flex items-center justify-center gap-2">
                            {loading ? (
                                <>
                                    <Loader2 size={14} className="text-emerald-500/70 animate-spin" />
                                    {t('logAnalytics.loadingData')}
                                </>
                            ) : (
                                t('logAnalytics.noData')
                            )}
                        </div>
                    ) : (
                        <ul className={twoColumns ? 'grid grid-cols-2 gap-x-6' : 'divide-y divide-gray-800/40'}>
                            {displayItems.map((item, idx) => (
                                <li
                                    key={`${item.key}-${idx}`}
                                    className={`group px-3.5 py-2.5 relative border-l-2 border-transparent hover:border-emerald-500/70 hover:bg-emerald-500/[0.04] transition-colors duration-150 ${twoColumns ? 'border-b border-gray-800/40' : ''}`}
                                    onMouseEnter={(e) => {
                                        setHoveredItem(item);
                                        setTooltipRect(e.currentTarget.getBoundingClientRect());
                                    }}
                                    onMouseLeave={() => {
                                        setHoveredItem(null);
                                        setTooltipRect(null);
                                    }}
                                >
                                    <div className="flex items-center justify-between gap-2.5">
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                            <RankBadge rank={idx} />
                                            <span className="text-[13px] font-mono text-gray-300 truncate group-hover:text-gray-100 transition-colors">
                                                {item.key}
                                            </span>
                                        </div>
                                        <span className="text-sm font-semibold text-white shrink-0 tabular-nums">
                                            {item.count.toLocaleString()}
                                            {item.percent != null && (
                                                <span className="text-gray-500 font-normal ml-1">({item.percent}%)</span>
                                            )}
                                        </span>
                                    </div>
                                    {showBar && item.percent != null && (
                                        <div className="mt-1.5 ml-7 h-1.5 bg-gray-800/60 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full origin-left"
                                                style={{
                                                    width: `${(item.percent / maxPct) * 100}%`,
                                                    minWidth: item.percent > 0 ? 3 : 0,
                                                    background: idx === 0
                                                        ? 'linear-gradient(90deg, #059669, #34d399)'
                                                        : 'linear-gradient(90deg, #047857a0, #10b981)',
                                                    animation: 'barGrow 0.4s ease-out forwards',
                                                    animationDelay: `${idx * 30}ms`
                                                }}
                                            />
                                        </div>
                                    )}
                                    {hoveredItem?.key === item.key && tooltipRect && createPortal(
                                        <div
                                            className="fixed z-[99999] px-4 py-3 border border-gray-600 rounded-lg shadow-2xl text-sm pointer-events-none max-w-[min(90vw,480px)]"
                                            style={{ left: tooltipRect.left, top: tooltipRect.bottom + 6, backgroundColor: 'rgb(17, 24, 39)' }}
                                        >
                                            <div className="font-medium text-white break-all leading-relaxed">{item.key}</div>
                                            <div className="mt-2 pt-2 border-t border-gray-600/50 flex gap-4 text-gray-300">
                                                <span>{t('logAnalytics.hits')}: <strong className="text-white">{item.count}</strong></span>
                                                {item.percent != null && (
                                                    <span>{t('logAnalytics.total')}: <strong className="text-emerald-400">{item.percent}%</strong></span>
                                                )}
                                            </div>
                                        </div>,
                                        document.body
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};

// Note: cognitive complexity ≈37 (Sonar threshold 15). Extracting each tab
// (Graphs / HTTP / Tops) into its own component is the planned refactor.
export const LogAnalyticsPage: React.FC<LogAnalyticsPageProps> = ({ onBack }) => {
    const { t, i18n } = useTranslation();
    const { plugins } = usePluginStore();
    const { token } = useUserAuthStore();

    const [pluginId, setPluginId] = useState<string>(DEFAULT_PLUGIN);
    const [timeRange, setTimeRange] = useState<'1h' | '24h' | '7d' | '30d' | 'custom'>('24h');
    const [customFrom, setCustomFrom] = useState<string>(() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 16);
    });
    const [customTo, setCustomTo] = useState<string>(() => new Date().toISOString().slice(0, 16));
    const [fileScope, setFileScope] = useState<'latest' | 'all'>('all');
    const [includeCompressed, setIncludeCompressed] = useState(false);
    const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
    const [timeseries, setTimeseries] = useState<AnalyticsTimeseriesBucket[]>([]);
    const [topUrls, setTopUrls] = useState<AnalyticsTopItem[]>([]);
    const [topIps, setTopIps] = useState<AnalyticsTopItem[]>([]);
    const [topStatus, setTopStatus] = useState<AnalyticsTopItem[]>([]);
    const [topUserAgents, setTopUserAgents] = useState<AnalyticsTopItem[]>([]);
    const [topReferrers, setTopReferrers] = useState<AnalyticsTopItem[]>([]);
    const [topBrowsers, setTopBrowsers] = useState<AnalyticsTopItem[]>([]);
    const [distMethods, setDistMethods] = useState<AnalyticsDistribution[]>([]);
    const [distStatus, setDistStatus] = useState<AnalyticsDistribution[]>([]);
    const [statusWithVisitors, setStatusWithVisitors] = useState<AnalyticsDistributionWithVisitors[]>([]);
    const [referringSites, setReferringSites] = useState<AnalyticsTopItemWithVisitors[]>([]);
    const [hostWithVisitors, setHostWithVisitors] = useState<AnalyticsTopItemWithVisitors[]>([]);
    const [referrerWithVisitors, setReferrerWithVisitors] = useState<AnalyticsTopItemWithVisitors[]>([]);
    const [urlsWithExtras, setUrlsWithExtras] = useState<AnalyticsTopUrlItem[]>([]);
    const [statusByHost, setStatusByHost] = useState<AnalyticsStatusByHostItem[]>([]);
    const [notFoundUrls, setNotFoundUrls] = useState<AnalyticsTopItemWithVisitors[]>([]);
    const [botVsHuman, setBotVsHuman] = useState<AnalyticsBotVsHuman | null>(null);
    const [responseTimeDist, setResponseTimeDist] = useState<AnalyticsResponseTimeDistribution | null>(null);
    /** 24-number array: count per hour-of-day aggregated over the selected period. */
    const [hourOfDay, setHourOfDay] = useState<number[]>([]);

    /** 12-month calendar heatmap data — fetched independently from the timeRange selector. */
    const [calendarBuckets, setCalendarBuckets] = useState<{ label: string; count: number; uniqueVisitors: number }[]>([]);
    /** 7×24 hour-day grid aggregated over the 12-month window. Same fetch as the calendar. */
    const [hourDayGrid, setHourDayGrid] = useState<number[][]>([]);
    /** Last-24h "live" slice for the toggle on Peak Hours and Day-of-Week charts. */
    const [live24h, setLive24h] = useState<{ hourOfDay: number[]; dayOfWeek: number[] } | null>(null);
    /** Last-7d "live week" slice for the Hour×Day heatmap toggle. */
    const [live7d, setLive7d] = useState<{ hourDayGrid: number[][] } | null>(null);
    const [peakHoursLive, setPeakHoursLive] = useState(false);
    const [dayOfWeekLive, setDayOfWeekLive] = useState(false);
    const [hourDayLive, setHourDayLive] = useState(false);

    const [isLoading, setIsLoading] = useState(true);
    const [isCalendarLoading, setIsCalendarLoading] = useState(true);
    /** DB-first preview (log_daily_stats rollup) shown instantly while the full scan below is in flight. */
    const [quickCoverage, setQuickCoverage] = useState<QuickAnalyticsResult['coverage'] | null>(null);
    const [isLiveRefreshing, setIsLiveRefreshing] = useState(false);
    /** True once the current query's full scan result has been applied — guards against a late
     *  quick-fetch response (network jitter) overwriting more complete full-scan data. */
    const fullDataArrivedRef = useRef(false);
    /** True once the full raw-scan fetch has been requested (not necessarily resolved) for the
     *  current filter set — lets the "http"/"tops" tabs defer it until first visited instead of
     *  scanning eagerly for tabs the user may never open. Reset whenever filters change. */
    const hasRequestedFullDataRef = useRef(false);
    /** True until the very first render's effects have run — skips the initial auto-fetch so
     *  landing on the default "Graphes" tab is just as lazy as landing on any other tab would
     *  be. Once false (any later tab switch or filter change), fetches proceed normally. */
    const isInitialMountRef = useRef(true);
    /** Reactive counterpart to fullDataArrivedRef — drives the "Refresh" button's attention
     *  animation while the full scan for the current view hasn't run yet (lazy tabs, or the
     *  default "Graphes" tab's Peak Hours widget before any tab switch/refresh). */
    const [fullDataReady, setFullDataReady] = useState(false);
    const [progressFiles, setProgressFiles] = useState<AnalyticsProgressFile[]>([]);
    const [progressPhase, setProgressPhase] = useState<AnalyticsProgressResponse['phase']>('idle');
    const [error, setError] = useState<string | null>(null);
    /** Stats KPI block: collapsible, visible by default. */
    const [statsKpiVisible, setStatsKpiVisible] = useState(true);
    const [activeTab, setActiveTab] = useState<'graphs' | 'http' | 'tops'>('graphs');
    const enabledLogPlugins = useMemo(
        () =>
            plugins.filter((p) =>
                p.enabled && LOG_SOURCE_PLUGINS.includes(p.id as (typeof LOG_SOURCE_PLUGINS)[number])
            ),
        [plugins]
    );

    // Auto-select a valid plugin when the current one is disabled/missing.
    // "all" stays valid as long as at least one log-source plugin is enabled.
    useEffect(() => {
        if (plugins.length === 0) return; // plugin store not loaded yet
        const isCurrentValid =
            pluginId === 'all'
                ? enabledLogPlugins.length > 0
                : enabledLogPlugins.some((p) => p.id === pluginId);
        if (isCurrentValid) return;
        if (enabledLogPlugins.length > 0) {
            setPluginId(enabledLogPlugins.length === 1 ? enabledLogPlugins[0].id : 'all');
        }
    }, [plugins, enabledLogPlugins, pluginId]);

    // Centralized reset for all analytics-response-derived state.
    // Used on empty-plugin, error responses, and exceptions to avoid drift across branches.
    const resetAnalyticsState = useCallback(() => {
        setOverview(null);
        setTimeseries([]);
        setTopUrls([]);
        setTopIps([]);
        setTopStatus([]);
        setTopUserAgents([]);
        setTopReferrers([]);
        setTopBrowsers([]);
        setDistMethods([]);
        setDistStatus([]);
        setStatusWithVisitors([]);
        setReferringSites([]);
        setHostWithVisitors([]);
        setReferrerWithVisitors([]);
        setUrlsWithExtras([]);
        setStatusByHost([]);
        setNotFoundUrls([]);
        setBotVsHuman(null);
        setResponseTimeDist(null);
        setHourOfDay([]);
    }, []);

    // Populates all analytics-response-derived state from a fetched or cached response.
    const applyAnalyticsResult = useCallback((result: AnalyticsApiResponse) => {
        setOverview(result.overview);
        setTimeseries(result.timeseries?.buckets ?? []);
        setTopUrls(result.top?.urls ?? []);
        setTopIps(result.top?.ips ?? []);
        setTopStatus(result.top?.status ?? []);
        setTopUserAgents(result.top?.ua ?? []);
        setTopReferrers(result.top?.referrer ?? []);
        setTopBrowsers(result.top?.browser ?? []);
        setDistMethods(result.distribution?.methods ?? []);
        setDistStatus(result.distribution?.status ?? []);
        setStatusWithVisitors(result.distribution?.statusWithVisitors ?? []);
        setReferringSites(result.top?.referringSites ?? []);
        setHostWithVisitors(result.top?.hostWithVisitors ?? []);
        setReferrerWithVisitors(result.top?.referrerWithVisitors ?? []);
        setUrlsWithExtras(result.top?.urlsWithExtras ?? []);
        setStatusByHost(result.top?.statusByHost ?? []);
        setNotFoundUrls(result.top?.notFoundUrls ?? []);
        setBotVsHuman(result.distribution?.botVsHuman ?? null);
        setResponseTimeDist(result.distribution?.responseTime ?? null);
        setHourOfDay(Array.isArray(result.hourOfDay) ? result.hourOfDay : []);
    }, []);

    const fetchAnalytics = useCallback(async (force = false) => {
        fullDataArrivedRef.current = false;
        setFullDataReady(false);
        const isPluginEnabled =
            pluginId === 'all'
                ? enabledLogPlugins.length > 0
                : enabledLogPlugins.some((p) => p.id === pluginId);
        if (!isPluginEnabled) {
            resetAnalyticsState();
            setIsLoading(false);
            setError(null);
            setFullDataReady(true);
            return;
        }

        const { from, to, bucketHour } = resolveDateRange(timeRange, customFrom, customTo);
        const fromStr = from.toISOString();
        const toStr = to.toISOString();
        // Relative ranges (1h/24h/7d/30d) resolve "to" as `new Date()`, which differs on every
        // call by definition: keying the cache on fromStr/toStr would make it miss on every
        // remount. Key on the stable timeRange selector instead; only "custom" needs the exact
        // bounds since those don't change between calls.
        const cacheRange = timeRange === 'custom' ? `${fromStr}|${toStr}` : timeRange;
        const cacheKey = JSON.stringify({ cacheRange, bucketHour, pluginId, fileScope, includeCompressed });

        if (!force) {
            const cached = getCachedAnalytics(cacheKey);
            if (cached) {
                applyAnalyticsResult(cached);
                fullDataArrivedRef.current = true;
                setFullDataReady(true);
                setError(null);
                setIsLoading(false);
                return;
            }
        }

        // Stale-while-revalidate: previously loaded data is left in place (not cleared here)
        // while the new fetch is in flight, so the page keeps showing usable content.
        setIsLoading(true);
        setError(null);
        setProgressFiles([]);
        setProgressPhase('idle');

        const pluginParam = `&pluginId=${encodeURIComponent(pluginId)}`;
        const fileScopeParam = `&fileScope=${fileScope}`;
        const compressedParam = includeCompressed ? '&includeCompressed=true' : '';
        const forceParam = force ? '&force=true' : '';

        try {
            const res = await api.get<AnalyticsApiResponse>(
                `/api/log-viewer/analytics?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&bucket=${bucketHour}&topLimit=15${pluginParam}${fileScopeParam}${compressedParam}${forceParam}`
            );

            if (res.success && res.result) {
                applyAnalyticsResult(res.result);
                fullDataArrivedRef.current = true;
                setFullDataReady(true);
                setCachedAnalytics(cacheKey, res.result);
            } else {
                resetAnalyticsState();
            }

            if (
                !res.success &&
                res.error?.code !== 'CLIENT_ERROR' &&
                res.error?.code !== 'NETWORK_ERROR'
            ) {
                setError(res.error?.message || t('logAnalytics.loadError'));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : t('logAnalytics.loadError'));
            resetAnalyticsState();
        } finally {
            setIsLoading(false);
        }
    }, [pluginId, enabledLogPlugins, timeRange, customFrom, customTo, fileScope, includeCompressed, t, resetAnalyticsState, applyAnalyticsResult]);

    /**
     * DB-first preview: reads `log_daily_stats` (instant) instead of re-parsing raw log files.
     * Only covers overview/timeseries/top-urls-ips-referrer-ua (see QuickAnalyticsResult) — the
     * full `fetchAnalytics` above remains the authoritative source and always overwrites this
     * once it lands. `live=true` (the "Live" button) re-scans today instead of trusting its
     * possibly-up-to-15-min-stale rollup row.
     */
    const fetchQuickAnalytics = useCallback(async (live = false) => {
        const isPluginEnabled =
            pluginId === 'all'
                ? enabledLogPlugins.length > 0
                : enabledLogPlugins.some((p) => p.id === pluginId);
        if (!isPluginEnabled) return;

        const { from, to } = resolveDateRange(timeRange, customFrom, customTo);
        const pluginParam = `&pluginId=${encodeURIComponent(pluginId)}`;
        const liveParam = live ? '&live=true' : '';

        if (live) setIsLiveRefreshing(true);
        try {
            const res = await api.get<QuickAnalyticsResult>(
                `/api/log-viewer/analytics/rollup?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}${pluginParam}${liveParam}`
            );
            if (res.success && res.result && Array.isArray(res.result.timeseries)) {
                setQuickCoverage(res.result.coverage);
                // Never clobber a full-scan result that already arrived (e.g. cache hit resolving
                // before this network round-trip does) — this is only a fast preview.
                if (!fullDataArrivedRef.current) {
                    setOverview(res.result.overview);
                    setTimeseries(res.result.timeseries);
                    setTopUrls(res.result.top.urls);
                    setTopIps(res.result.top.ips);
                    setTopReferrers(res.result.top.referrer);
                    setTopUserAgents(res.result.top.ua);
                }
            }
        } catch {
            /* silent — fetchAnalytics is the authoritative source, this is just a fast preview */
        } finally {
            if (live) setIsLiveRefreshing(false);
        }
    }, [pluginId, enabledLogPlugins, timeRange, customFrom, customTo]);

    // Lazy loading, same rule for all 3 tabs: the DB-first quick preview + calendar fetch
    // already cover almost everything ("Graphes": overview/timeseries/bandwidth/status trends;
    // "HTTP"/"Tops": only their small top-4 panels). The full raw-scan fetch is deferred until
    // the user actually lands on a tab that needs it, instead of firing on every page load
    // regardless of what's viewed — including the default "Graphes" tab, whose only full-scan
    // dependent widget is "Heures de pointe" (non-live mode; its "Live" toggle uses the
    // calendar fetch instead and stays instant either way).
    useEffect(() => {
        hasRequestedFullDataRef.current = false;
        fetchQuickAnalytics();
    }, [fetchQuickAnalytics]);

    useEffect(() => {
        if (isInitialMountRef.current) {
            isInitialMountRef.current = false;
            return;
        }
        if (!hasRequestedFullDataRef.current) {
            hasRequestedFullDataRef.current = true;
            fetchAnalytics();
        }
    }, [activeTab, fetchAnalytics]);

    // Poll progress while the main section is doing its first-ever load, so the user
    // sees which files are being scanned instead of a bare spinner.
    const pollProgress = useCallback(() => {
        api.get<AnalyticsProgressResponse>('/api/log-viewer/analytics/progress')
            .then((res) => {
                if (res.success && res.result?.files?.length) {
                    setProgressFiles(res.result.files);
                    setProgressPhase(res.result.phase);
                }
            })
            .catch(() => {});
    }, []);
    // Also polled (not just on the very first load) so the compact progress bar can reflect
    // "Refresh" and "Live" button activity too — collectParsedEntries() updates the same
    // server-side progress tracker regardless of which endpoint triggered the scan.
    usePolling(pollProgress, { enabled: isLoading || isLiveRefreshing, interval: 800 });

    /**
     * Calendar heatmap + day-of-week chart use a fixed 12-month sliding window,
     * independent of the timeRange selector above. Refetched only when the plugin filter changes
     * (or via the main refresh button).
     */
    const applyCalendarResult = useCallback((r: CalendarApiResponse) => {
        if (Array.isArray(r.buckets)) setCalendarBuckets(r.buckets);
        if (Array.isArray(r.hourDayGrid)) setHourDayGrid(r.hourDayGrid);
        if (r.live24h && Array.isArray(r.live24h.hourOfDay) && Array.isArray(r.live24h.dayOfWeek)) {
            setLive24h({ hourOfDay: r.live24h.hourOfDay, dayOfWeek: r.live24h.dayOfWeek });
        }
        if (r.live7d && Array.isArray(r.live7d.hourDayGrid)) {
            setLive7d({ hourDayGrid: r.live7d.hourDayGrid });
        }
    }, []);

    const fetchCalendar = useCallback(async (force = false) => {
        const cacheKey = pluginId;

        if (!force) {
            const cached = getCachedCalendar(cacheKey);
            if (cached) {
                applyCalendarResult(cached);
                setIsCalendarLoading(false);
                return;
            }
        }

        setIsCalendarLoading(true);
        try {
            const pluginParam = pluginId && pluginId !== 'all' ? `&pluginId=${encodeURIComponent(pluginId)}` : '';
            const forceParam = force ? '&force=true' : '';
            const res = await api.get<CalendarApiResponse>(`/api/log-viewer/analytics/calendar?windowDays=365${pluginParam}${forceParam}`);
            if (!res.success || !res.result || Array.isArray((res.result as unknown as { ok?: false }).ok)) return;
            applyCalendarResult(res.result);
            setCachedCalendar(cacheKey, res.result);
        } catch {
            /* silent, heatmap will just render no-data */
        } finally {
            setIsCalendarLoading(false);
        }
    }, [pluginId, applyCalendarResult]);

    useEffect(() => {
        fetchCalendar();
    }, [fetchCalendar]);


    const getPluginLabel = (id: string): string => {
        const names: Record<string, string> = {
            npm: 'NPM',
            apache: 'Apache'
        };
        if (id === 'all') {
            const activeNames = enabledLogPlugins.map((p) => names[p.id] ?? p.id).join(' + ');
            return activeNames ? `${t('logAnalytics.pluginAll')} (${activeNames})` : t('logAnalytics.pluginAll');
        }
        return names[id] || id;
    };

    const pluginColorMap: Record<string, string> = {
        apache: 'bg-red-500/15 text-red-400 border-red-500/30',
        npm: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        all: 'bg-sky-500/15 text-sky-400 border-sky-500/30'
    };

    const getPeriodLabel = (): string => {
        if (timeRange === 'custom') {
            if (!customFrom || !customTo) return '—';
            try {
                const f = new Date(customFrom);
                const t2 = new Date(customTo);
                const fmt = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
                return `${fmt(f)} → ${fmt(t2)}`;
            } catch { return '—'; }
        }
        const labels: Record<string, string> = { '1h': '1h', '24h': '1 j', '7d': '7 j', '30d': '30 j' };
        return labels[timeRange] ?? timeRange;
    };

    // Precomputed props shared by every <SectionHeading {...headingCommon}>. Spread with {...headingCommon}.
    const sourceLabel = getPluginLabel(pluginId);
    const sourceColorClass = pluginColorMap[pluginId] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30';
    const periodLabel = getPeriodLabel();
    const headingCommon = { sourceLabel, sourceColorClass, periodLabel, loading: isLoading };

    /**
     * Format timeseries axis labels: no year, "h" for hour (instead of "T").
     * Compact format to avoid overflow. Handles ISO-like strings (2026-02-12T18, 2026-02-12T18:00, etc.).
     */
    const formatTsLabel = useCallback((raw: string, bucket: 'minute' | 'hour' | 'day') => {
        try {
            let d = new Date(raw);
            if (Number.isNaN(d.getTime())) {
                const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?/);
                if (m) d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +(m[5] ?? 0), +(m[6] ?? 0));
                else return raw;
            }
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const hour = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            if (bucket === 'minute') return `${day}/${month} ${hour}:${min}`;
            if (bucket === 'hour') return `${day}/${month} ${hour}h`;
            return `${day}/${month}`;
        } catch {
            return raw;
        }
    }, []);

    const getCurrentBucket = (): 'minute' | 'hour' | 'day' => {
        if (timeRange === '1h') return 'minute';
        if (timeRange === '24h' || timeRange === '7d') return 'hour';
        if (timeRange === 'custom') return bucketForCustomRange(new Date(customTo).getTime() - new Date(customFrom).getTime());
        return 'day';
    };

    /**
     * Trim leading and trailing empty buckets so curves fill the full chart width.
     * Removes buckets where both count and uniqueVisitors are 0.
     */
    const trimmedTimeseries = useMemo(() => {
        if (!timeseries.length) return [];
        let first = 0;
        let last = timeseries.length - 1;
        for (let i = 0; i < timeseries.length; i++) {
            const b = timeseries[i];
            if ((b.count > 0) || ((b.uniqueVisitors ?? 0) > 0)) {
                first = i;
                break;
            }
        }
        for (let i = timeseries.length - 1; i >= 0; i--) {
            const b = timeseries[i];
            if ((b.count > 0) || ((b.uniqueVisitors ?? 0) > 0)) {
                last = i;
                break;
            }
        }
        if (first > last) return timeseries;
        return timeseries.slice(first, last + 1);
    }, [timeseries]);

    // ── Stats summary computed from timeseries ─────────────────────────────────
    const timeseriesStats = useMemo(() => {
        if (!timeseries.length) return null;
        const total = timeseries.reduce((s, b) => s + b.count, 0);
        const totalVisitors = timeseries.reduce((s, b) => s + (b.uniqueVisitors ?? 0), 0);

        // Peak day of week
        const byDay = new Array(7).fill(0);
        // Peak hour of day
        const byHour = new Array(24).fill(0);
        // Distinct days for avg/day
        const distinctDays = new Set<string>();

        for (const b of timeseries) {
            if (b.count === 0) continue;
            try {
                const d = new Date(b.label);
                if (Number.isNaN(d.getTime())) continue;
                const jsDay = d.getDay();
                byDay[jsDay === 0 ? 6 : jsDay - 1] += b.count;
                byHour[d.getHours()] += b.count;
                distinctDays.add(b.label.slice(0, 10));
            } catch { /* skip */ }
        }

        const peakDayIdx  = byDay.indexOf(Math.max(...byDay));
        const peakHourIdx = byHour.indexOf(Math.max(...byHour));
        const nDays       = Math.max(distinctDays.size, 1);
        const avgPerDay   = total / nDays;
        const avgPerHour  = total / 24;

        return { total, totalVisitors, peakDayIdx, peakHourIdx, avgPerDay, avgPerHour, peakDayCount: byDay[peakDayIdx], peakHourCount: byHour[peakHourIdx] };
    }, [timeseries]);

    const formatDateRange = (from?: string, to?: string): string => {
        if (!from || !to) return '—';
        try {
            const f = new Date(from);
            const t = new Date(to);
            return `${f.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} → ${t.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}`;
        } catch {
            return '—';
        }
    };

    /** Badge color by HTTP method — matches the palette used for status codes elsewhere on the page. */
    const getMethodColor = (method: string): string => {
        switch (method.toUpperCase()) {
            case 'GET': return 'text-sky-300 bg-sky-500/10 border-sky-500/30';
            case 'POST': return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
            case 'PUT':
            case 'PATCH': return 'text-amber-300 bg-amber-500/10 border-amber-500/30';
            case 'DELETE': return 'text-red-300 bg-red-500/10 border-red-500/30';
            default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
        }
    };

    const RequestedFileTableRow: React.FC<{
        item: AnalyticsTopUrlItem;
        formatBytes: (bytes: number) => string;
        idx: number;
    }> = ({ item, formatBytes, idx }) => {
        const [hovered, setHovered] = useState(false);
        const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);
        return (
            <tr
                className={`border-t border-gray-800/60 hover:bg-white/[0.03] transition-colors ${idx % 2 === 1 ? 'bg-white/[0.015]' : ''}`}
                onMouseEnter={(e) => {
                    setHovered(true);
                    setTooltipRect(e.currentTarget.getBoundingClientRect());
                }}
                onMouseLeave={() => {
                    setHovered(false);
                    setTooltipRect(null);
                }}
            >
                <td className="py-1.5 min-w-[200px] max-w-[500px] relative">
                    <div className="flex items-center gap-2 min-w-0">
                        <RankBadge rank={idx} />
                        <div className="font-mono text-[13px] text-gray-300 truncate">{item.key}</div>
                    </div>
                    {hovered && tooltipRect && createPortal(
                        <div
                            className="fixed z-[99999] px-3 py-2.5 border border-gray-700 rounded-lg shadow-xl text-sm pointer-events-none"
                            style={{
                                left: tooltipRect.left,
                                top: tooltipRect.bottom + 4,
                                backgroundColor: 'rgb(17, 24, 39)'
                            }}
                        >
                            <div className="font-medium text-white break-all mb-1.5">{item.key}</div>
                            <div className="text-gray-300">Hits: {item.count}</div>
                            <div className="text-emerald-600">Visitors: {item.uniqueVisitors}</div>
                            {item.txAmount != null && item.txAmount > 0 && (
                                <div className="text-purple-300 mt-0.5">Traffic: {formatBytes(item.txAmount)}</div>
                            )}
                        </div>,
                        document.body
                    )}
                </td>
                <td className="py-1.5 text-right text-white font-semibold tabular-nums">{item.count.toLocaleString()}</td>
                <td className="py-1.5 text-right text-emerald-400 tabular-nums">{item.uniqueVisitors.toLocaleString()}</td>
                <td className="py-1.5 text-right text-purple-300 tabular-nums">{formatBytes(item.txAmount ?? 0)}</td>
                <td className="py-1.5 text-center">
                    {item.method ? (
                        <span className={`inline-block px-1.5 py-0.5 rounded border text-[11px] font-mono font-medium ${getMethodColor(item.method)}`}>
                            {item.method}
                        </span>
                    ) : (
                        <span className="text-gray-600">-</span>
                    )}
                </td>
                <td className="py-1.5 text-center text-gray-400 font-mono text-xs">{item.protocol ?? '-'}</td>
            </tr>
        );
    };

    /** Same "still fetching" vs "genuinely no data" distinction as NoDataOrLoading below, for chart widgets that take a plain `noDataText` string prop instead of a component. */
    const noDataOrLoadingText = (loading: boolean): string => (loading ? t('logAnalytics.loadingData') : t('logAnalytics.noData'));

    /** Empty-state placeholder that distinguishes "still fetching" from "genuinely no data" — avoids a confusing flash of "no data" while the full scan is still in flight (e.g. HTTP/Tops tab sections not covered by the DB-first quick preview). */
    const NoDataOrLoading: React.FC = () => (
        <div className="h-32 flex flex-col items-center justify-center gap-2 text-gray-500 text-sm">
            {isLoading ? (
                <>
                    <Loader2 size={18} className="text-emerald-500/60 animate-spin" />
                    <span>{t('logAnalytics.loadingData')}</span>
                </>
            ) : (
                t('logAnalytics.noData')
            )}
        </div>
    );

    /** Softer, less vivid colors for HTTP status bars. */
    const getStatusColor = (key: string): string => {
        if (/^2\d{2}$/.test(key)) return '#047857';
        if (/^3\d{2}$/.test(key)) return '#1d4ed8';
        if (/^4\d{2}$/.test(key)) return '#b45309';
        if (/^5\d{2}$/.test(key)) return '#b91c1c';
        return '#4b5563';
    };

    const DistributionChart: React.FC<{
        title: string;
        items: AnalyticsDistribution[];
        colorByKey?: (key: string) => string;
        /** Min width for label column (e.g. 5rem for status codes, 6rem for method names like PROPFIND/UNKNOWN). */
        labelMinWidth?: string;
    }> = ({ title, items, colorByKey, labelMinWidth = '6rem' }) => {
        const maxCount = Math.max(...items.map((i) => i.count), 1);
        const getColor = (key: string) => {
            if (colorByKey) return colorByKey(key);
            if (/^2\d{2}$/.test(key)) return '#047857';
            if (/^3\d{2}$/.test(key)) return '#1d4ed8';
            if (/^4\d{2}$/.test(key)) return '#b45309';
            if (/^5\d{2}$/.test(key)) return '#b91c1c';
            return '#4b5563';
        };
        return (
            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
                {items.length === 0 ? (
                    <NoDataOrLoading />
                ) : (
                    <div className="space-y-2.5">
                        {items.slice(0, 12).map((item, idx) => (
                            <div key={item.key} className="flex items-center gap-3 min-h-0 group">
                                <RankBadge rank={idx} />
                                <span
                                    className="text-sm font-mono text-gray-400 group-hover:text-gray-200 shrink-0 whitespace-nowrap transition-colors"
                                    style={{ minWidth: labelMinWidth }}
                                >
                                    {item.key}
                                </span>
                                <div className="flex-1 min-w-0 h-4 bg-gray-800/50 rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full origin-left"
                                        style={{
                                            width: `${(item.count / maxCount) * 100}%`,
                                            minWidth: item.count > 0 ? 3 : 0,
                                            background: `linear-gradient(90deg, ${getColor(item.key)}99, ${getColor(item.key)})`,
                                            animation: 'barGrow 0.5s ease-out forwards',
                                            animationDelay: `${idx * 40}ms`
                                        }}
                                    />
                                </div>
                                <span className="text-sm font-semibold text-white shrink-0 whitespace-nowrap min-w-[5.5rem] text-right tabular-nums">
                                    {item.count.toLocaleString()} <span className="text-gray-500 font-normal">({item.percent}%)</span>
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    // Compact progress bar (Refresh/Live) — null pct means no per-file granularity yet
    // (e.g. live scan just started), rendered as an indeterminate pulse instead of 0%.
    const showLoadingProgressBar = (isLoading || isLiveRefreshing) && !(isLoading && overview === null);
    const loadingDoneCount = progressFiles.filter((f) => f.status === 'done' || f.status === 'error').length;
    const loadingPct = progressFiles.length > 0 ? Math.round((loadingDoneCount / progressFiles.length) * 100) : null;

    return (
        <div className="min-h-screen text-gray-300 overflow-x-hidden">
            <header className="sticky top-0 z-40 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-gray-800/80">
                <div className="max-w-[1920px] mx-auto px-4 py-4">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={onBack}
                                className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
                                aria-label={t('logAnalytics.back')}
                            >
                                <ChevronLeft size={24} />
                            </button>
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-500/20 rounded-lg">
                                    <BarChart2 size={24} className="text-emerald-400" />
                                </div>
                                <div>
                                    <h1 className="text-xl font-bold text-white">
                                        {t('logAnalytics.title')}
                                    </h1>
                                    <p className="text-sm text-gray-500">
                                        {t('logAnalytics.subtitle')}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{t('logAnalytics.statsHeaderPlugin')}</span>
                                <select
                                    value={pluginId}
                                    onChange={(e) => setPluginId(e.target.value)}
                                    className="stats-header-select"
                                    title={t('logAnalytics.pluginFilterTip')}
                                >
                                    {enabledLogPlugins.length > 0 && (
                                        <option value="all">{getPluginLabel('all')}</option>
                                    )}
                                    {enabledLogPlugins
                                        .filter((p) => LOG_SOURCE_PLUGINS.includes(p.id as (typeof LOG_SOURCE_PLUGINS)[number]))
                                        .map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {getPluginLabel(p.id)}
                                            </option>
                                        ))}
                                </select>
                            </div>
                            <div className="h-6 w-px bg-gray-700/60" aria-hidden />
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{t('logAnalytics.timeRange')}</span>
                                <select
                                    value={timeRange}
                                    onChange={(e) => setTimeRange(e.target.value as typeof timeRange)}
                                    className="stats-header-select"
                                    title={t('logAnalytics.timeRange')}
                                >
                                    <option value="1h">{t('logAnalytics.timeRange1h')}</option>
                                    <option value="24h">{t('logAnalytics.timeRange24h')}</option>
                                    <option value="7d">{t('logAnalytics.timeRange7d')}</option>
                                    <option value="30d">{t('logAnalytics.timeRange30d')}</option>
                                    <option value="custom">{t('logAnalytics.timeRangeCustom')}</option>
                                </select>
                            </div>
                            {timeRange === 'custom' && (
                                <>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="datetime-local"
                                            value={customFrom}
                                            onChange={(e) => setCustomFrom(e.target.value)}
                                            className="stats-header-input"
                                        />
                                        <span className="text-gray-500 text-sm">→</span>
                                        <input
                                            type="datetime-local"
                                            value={customTo}
                                            onChange={(e) => setCustomTo(e.target.value)}
                                            className="stats-header-input"
                                        />
                                    </div>
                                    <div className="h-6 w-px bg-gray-700/60" aria-hidden />
                                </>
                            )}
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{t('logAnalytics.fileScope')}</span>
                                <select
                                    value={fileScope}
                                    onChange={(e) => setFileScope(e.target.value as 'latest' | 'all')}
                                    className="stats-header-select"
                                    title={fileScope === 'latest' ? t('logAnalytics.fileScopeLatestTip') : t('logAnalytics.fileScopeAllTip')}
                                >
                                    <option value="latest">{t('logAnalytics.fileScopeLatest')}</option>
                                    <option value="all">{t('logAnalytics.fileScopeAll')}</option>
                                </select>
                            </div>
                            <div className="h-6 w-px bg-gray-700/60" aria-hidden />
                            <label
                                className="flex items-center gap-2.5 cursor-pointer group"
                                title={t('logAnalytics.includeCompressedTip')}
                            >
                                <span className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full bg-gray-700/80 transition-colors duration-200 ease-in-out focus-within:ring-2 focus-within:ring-emerald-500/50 focus-within:ring-offset-2 focus-within:ring-offset-[#0a0a0a] group-hover:bg-gray-600/80">
                                    <input
                                        type="checkbox"
                                        checked={includeCompressed}
                                        onChange={(e) => setIncludeCompressed(e.target.checked)}
                                        className="peer sr-only"
                                    />
                                    <span className="pointer-events-none inline-block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out peer-checked:translate-x-5 peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/50" />
                                </span>
                                <span className="flex items-center gap-1.5 text-sm text-gray-300 group-hover:text-gray-200 transition-colors">
                                    <Archive size={14} className="text-gray-500 group-hover:text-emerald-500/70 transition-colors" />
                                    {t('logAnalytics.includeCompressed')}
                                </span>
                            </label>
                            <div className="h-6 w-px bg-gray-700/60" aria-hidden />
                            <button
                                onClick={() => fetchQuickAnalytics(true)}
                                disabled={isLiveRefreshing}
                                title={t('logAnalytics.liveRefreshTip')}
                                className="flex items-center gap-2 px-3 py-2 bg-[#121212] hover:bg-gray-800 border border-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-amber-300 transition-all duration-200"
                            >
                                <Zap size={16} className={isLiveRefreshing ? 'animate-pulse' : ''} />
                                {t('logAnalytics.liveRefresh')}
                            </button>
                            <button
                                onClick={() => { fetchAnalytics(true); fetchCalendar(true); }}
                                disabled={isLoading || isCalendarLoading}
                                title={!fullDataReady && !isLoading ? t('logAnalytics.refreshNeededTip') : t('logAnalytics.refreshTip')}
                                className={`flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white shadow-lg shadow-emerald-900/20 transition-all duration-200 hover:shadow-emerald-900/30 ${
                                    !fullDataReady && !isLoading ? 'ring-2 ring-emerald-400/70 animate-pulse' : ''
                                }`}
                            >
                                <RefreshCw size={16} className={isLoading || isCalendarLoading ? 'animate-spin' : ''} />
                                {t('logAnalytics.refresh')}
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            {showLoadingProgressBar && (
                <div className="max-w-[1920px] mx-auto px-4 md:px-6 pt-3">
                    <div className="flex items-center gap-2 text-[11px] text-gray-500 mb-1">
                        <Loader2 size={12} className="animate-spin text-emerald-500 shrink-0" />
                        <span className="truncate">
                            {isLiveRefreshing
                                ? t('logAnalytics.liveRefresh')
                                : progressPhase === 'aggregating'
                                    ? t('logAnalytics.aggregatingResults')
                                    : t('logAnalytics.scanningFiles')}
                        </span>
                        {loadingPct != null && <span className="ml-auto tabular-nums shrink-0">{loadingPct}%</span>}
                    </div>
                    <div className="h-1 bg-gray-800/60 rounded-full overflow-hidden">
                        <div
                            className={`h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-[width] duration-300 ${loadingPct == null ? 'animate-pulse w-1/3' : ''}`}
                            style={loadingPct != null ? { width: `${loadingPct}%` } : undefined}
                        />
                    </div>
                </div>
            )}

            <div className="p-4 md:p-6 max-w-[1920px] mx-auto space-y-6">
                {error && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {isLoading && overview === null ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <div className="flex items-center">
                            <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin" />
                            <span className="ml-3 text-gray-400">{t('logAnalytics.loading')}</span>
                        </div>
                        {progressFiles.length > 0 && (
                            <div className="w-full max-w-md space-y-1.5">
                                <div className="text-xs text-gray-500 text-center">
                                    {progressPhase === 'aggregating'
                                        ? t('logAnalytics.aggregatingResults')
                                        : t('logAnalytics.scanningFiles')}
                                </div>
                                {progressFiles.map((file) => {
                                    const barPct = file.status === 'done' || file.status === 'error' ? 100 : file.status === 'reading' ? 60 : 0;
                                    const barColor =
                                        file.status === 'error' ? 'bg-red-500' : file.status === 'done' ? 'bg-emerald-500' : 'bg-sky-500';
                                    const statusLabel =
                                        file.status === 'done'
                                            ? t('logAnalytics.scanStatusDone')
                                            : file.status === 'error'
                                                ? t('logAnalytics.scanStatusError')
                                                : file.status === 'reading'
                                                    ? t('logAnalytics.scanStatusReading')
                                                    : t('logAnalytics.scanStatusPending');
                                    return (
                                        <div key={`${file.pluginId}/${file.fileName}`} className="text-xs">
                                            <div className="flex items-center justify-between gap-2 text-gray-400 mb-0.5">
                                                <span className="flex items-center gap-1.5 truncate">
                                                    {file.status === 'done' ? (
                                                        <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                                                    ) : file.status === 'error' ? (
                                                        <XCircle size={12} className="text-red-500 shrink-0" />
                                                    ) : (
                                                        <FileText size={12} className="text-gray-600 shrink-0" />
                                                    )}
                                                    <span className="truncate">{file.pluginId}/{file.fileName}</span>
                                                </span>
                                                <span className="text-gray-500 shrink-0 flex items-center gap-1.5">
                                                    <span>{statusLabel}</span>
                                                    <span>{formatBytes(file.sizeBytes)}</span>
                                                </span>
                                            </div>
                                            <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all duration-300 ${barColor} ${file.status === 'reading' ? 'animate-pulse' : ''}`}
                                                    style={{ width: `${barPct}%` }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {/* Unified KPI section with source badge */}
                        <div id="section-kpi" className="bg-[#121212]/90 rounded-xl border border-gray-800 overflow-hidden backdrop-blur-sm scroll-mt-24">
                            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800/60">
                                <div className="flex items-center gap-3">
                                    <h3
                                        className="text-base font-semibold text-white cursor-help"
                                        title={t('logAnalytics.kpiModalIntro')}
                                    >
                                        {t('logAnalytics.statsKpi')}
                                    </h3>
                                    {overview && (
                                        <button
                                            type="button"
                                            onClick={() => setStatsKpiVisible((v) => !v)}
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
                                    <span className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${pluginColorMap[pluginId] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'}`}>
                                        {getPluginLabel(pluginId)}
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

                        {/* Tab navigation */}
                        <div className="flex items-center gap-1 p-1 bg-[#0a0a0a] rounded-xl border border-gray-800">
                            {([
                                { id: 'graphs' as const, icon: TrendingUp, label: t('logAnalytics.tabGraphs') },
                                { id: 'http' as const, icon: Shield, label: t('logAnalytics.tabHttp') },
                                { id: 'tops' as const, icon: Trophy, label: t('logAnalytics.tabTops') }
                            ]).map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex-1 justify-center ${
                                        activeTab === tab.id
                                            ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
                                            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                                    }`}
                                >
                                    <tab.icon size={16} />
                                    {tab.label}
                                </button>
                            ))}
                        </div>

                        {/* === TAB: Graphs === */}
                        {activeTab === 'graphs' && (
                        <>
                        {/* Time Distribution & Unique Visitors (dual-line charts) */}
                        <div id="section-time-dist" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-24">
                            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.timeDistribution')}</SectionHeading>
                                {trimmedTimeseries.length > 0 ? (
                                    <DualLineChart
                                        data={trimmedTimeseries.map((b) => ({
                                            label: b.label,
                                            count: b.count,
                                            uniqueVisitors: b.uniqueVisitors ?? 0
                                        }))}
                                        requestsLabel={t('logAnalytics.requests')}
                                        visitorsLabel={t('logAnalytics.visitors')}
                                        height={140}
                                        formatLabel={(l) => formatTsLabel(l, getCurrentBucket())}
                                        xAxisTicks={6}
                                        showGrid
                                    />
                                ) : (
                                    <NoDataOrLoading />
                                )}
                            </div>
                            <div id="section-unique-visitors" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.uniqueVisitorsChart')}</SectionHeading>
                                {trimmedTimeseries.length > 0 ? (
                                    <DualLineChart
                                        data={trimmedTimeseries.map((b) => ({
                                            label: b.label,
                                            count: b.count,
                                            uniqueVisitors: b.uniqueVisitors ?? 0
                                        }))}
                                        requestsLabel={t('logAnalytics.hits')}
                                        visitorsLabel={t('logAnalytics.visitors')}
                                        height={140}
                                        formatLabel={(l) => formatTsLabel(l, getCurrentBucket())}
                                        xAxisTicks={6}
                                        showGrid
                                    />
                                ) : (
                                    <NoDataOrLoading />
                                )}
                            </div>
                        </div>

                        {/* Group A: stats + Peak hours — all filtered by the header's period selector */}
                        {trimmedTimeseries.length > 0 && (
                            <div id="section-filtered-stats" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24 flex flex-col gap-6">
                                <div className="flex items-center gap-2 text-[.68rem] text-gray-500 uppercase tracking-wider">
                                    <span>{t('logAnalytics.filteredGroupLabel')}</span>
                                    <PeriodBadge label={periodLabel} />
                                </div>

                                {/* Stats tiles row — 6 across */}
                                {timeseriesStats && (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                                        {[
                                            { label: t('logAnalytics.totalRequests'), value: timeseriesStats.total.toLocaleString(), color: '#10b981' },
                                            { label: t('logAnalytics.uniqueVisitors'), value: timeseriesStats.totalVisitors.toLocaleString(), color: '#60a5fa' },
                                            { label: 'Moy. / jour', value: Math.round(timeseriesStats.avgPerDay).toLocaleString(), color: '#34d399' },
                                            { label: 'Moy. / heure', value: Math.round(timeseriesStats.avgPerHour).toLocaleString(), color: '#22d3ee' },
                                            { label: 'Pic (jour)', value: [t('logAnalytics.monday'),t('logAnalytics.tuesday'),t('logAnalytics.wednesday'),t('logAnalytics.thursday'),t('logAnalytics.friday'),t('logAnalytics.saturday'),t('logAnalytics.sunday')][timeseriesStats.peakDayIdx] ?? '—', sub: timeseriesStats.peakDayCount.toLocaleString() + ' req.', color: '#f59e0b' },
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

                                {/* Peak hours — default: aggregates hour-of-day over the selected period; toggle: last 24h live */}
                                <div>
                                    <SectionHeading
                                        {...headingCommon}
                                        loading={peakHoursLive ? isCalendarLoading : isLoading}
                                        extras={<LiveToggle live={peakHoursLive} onToggle={() => setPeakHoursLive((v) => !v)} window="24H" />}
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
                                        noDataText={noDataOrLoadingText((peakHoursLive ? isCalendarLoading : isLoading))}
                                        requestsLabel={t('logAnalytics.requests')}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Group B: Day of week + Calendar heatmap + Hour×Day heatmap — fixed 12-month window */}
                        {trimmedTimeseries.length > 0 && (
                            <div id="section-hour-day" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24 flex flex-col gap-6">
                                <div className="flex items-center gap-2 text-[.68rem] text-gray-500 uppercase tracking-wider">
                                    <span>{t('logAnalytics.fixedWindowGroupLabel')}</span>
                                </div>

                                {/* Day of week — full width, optional 24H live toggle */}
                                <div>
                                    <SectionHeading
                                        {...headingCommon}
                                        loading={isCalendarLoading}
                                        hidePeriod
                                        extras={<WindowSwitch live={dayOfWeekLive} onToggle={() => setDayOfWeekLive((v) => !v)} window="24H" />}
                                    >
                                        {t('logAnalytics.dayOfWeekTitle')}
                                    </SectionHeading>
                                    <DayOfWeekChart
                                        data={dayOfWeekLive && live24h
                                            // Live mode: feed 7 synthetic day entries so the chart's date parser maps each bar to a weekday.
                                            ? live24h.dayOfWeek.map((count, dayIdx) => ({
                                                label: `2000-01-0${3 + dayIdx}`,
                                                count
                                            }))
                                            : calendarBuckets.map((b) => ({ label: b.label, count: b.count }))
                                        }
                                        noDataText={noDataOrLoadingText(isCalendarLoading)}
                                        dayLabels={[
                                            t('logAnalytics.monday'), t('logAnalytics.tuesday'), t('logAnalytics.wednesday'),
                                            t('logAnalytics.thursday'), t('logAnalytics.friday'), t('logAnalytics.saturday'), t('logAnalytics.sunday')
                                        ]}
                                        requestsLabel={t('logAnalytics.requests')}
                                    />
                                </div>

                                {/* Calendar heatmap | Hour×Day heatmap — side by side, matched height */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div className="min-w-0">
                                        <SectionHeading {...headingCommon} loading={isCalendarLoading} hidePeriod extras={<FixedWindowBadge />}>{t('logAnalytics.heatmapTitle')}</SectionHeading>
                                        <HeatmapChart
                                            data={calendarBuckets.map((b) => ({ label: b.label, count: b.count }))}
                                            noDataText={noDataOrLoadingText(isCalendarLoading)}
                                            dayLabels={[
                                                t('logAnalytics.monday'), t('logAnalytics.tuesday'), t('logAnalytics.wednesday'),
                                                t('logAnalytics.thursday'), t('logAnalytics.friday'), t('logAnalytics.saturday'), t('logAnalytics.sunday')
                                            ]}
                                        />
                                    </div>
                                    <div>
                                        <SectionHeading
                                            {...headingCommon}
                                            loading={isCalendarLoading}
                                            hidePeriod
                                            extras={<WindowSwitch live={hourDayLive} onToggle={() => setHourDayLive((v) => !v)} window="SEMAINE" />}
                                        >
                                            {t('logAnalytics.hourDayHeatmapTitle')}
                                        </SectionHeading>
                                        <HourDayHeatmap
                                            data={(hourDayLive && live7d ? live7d.hourDayGrid : hourDayGrid).flatMap((row, dayIdx) =>
                                                // Jan 3-9 2000 = Mon-Sun — synthetic labels the chart's day-of-week parser will map back correctly.
                                                (Array.isArray(row) ? row : []).map((count, hr) => ({
                                                    label: `2000-01-0${3 + dayIdx}T${String(hr).padStart(2, '0')}`,
                                                    count
                                                }))
                                            )}
                                            noDataText={noDataOrLoadingText(isCalendarLoading)}
                                            dayLabels={[
                                                t('logAnalytics.monday'), t('logAnalytics.tuesday'), t('logAnalytics.wednesday'),
                                                t('logAnalytics.thursday'), t('logAnalytics.friday'), t('logAnalytics.saturday'), t('logAnalytics.sunday')
                                            ]}
                                            requestsLabel={t('logAnalytics.requests')}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Status Trends over time */}
                        {trimmedTimeseries.length > 0 && (
                            <div id="section-status-trends" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.statusTrendsTitle')}</SectionHeading>
                                <StatusTrendsChart
                                    data={trimmedTimeseries}
                                    height={180}
                                    formatLabel={(l) => formatTsLabel(l, getCurrentBucket())}
                                    noDataText={noDataOrLoadingText(isLoading)}
                                    xAxisTicks={6}
                                />
                            </div>
                        )}

                        {/* Timeline - Requêtes dans le temps (bar/curve + date/time axis) */}
                        <div id="section-timeline" className="bg-[#121212] rounded-xl border border-gray-800 p-6 w-full scroll-mt-24">
                            <SectionHeading {...headingCommon}>{t('logAnalytics.requestsOverTime')}</SectionHeading>
                            {trimmedTimeseries.length > 0 ? (
                                <div className="w-full min-w-0">
                                    <TimelineChart
                                        data={trimmedTimeseries.map((b) => ({ label: b.label, count: b.count }))}
                                        color="#10b981"
                                        height={140}
                                        formatLabel={(l) => formatTsLabel(l, getCurrentBucket())}
                                        valueLabel={t('logAnalytics.requests')}
                                        xAxisTicks={6}
                                        barLabel={t('logAnalytics.viewBars')}
                                        curveLabel={t('logAnalytics.viewCurve')}
                                    />
                                </div>
                            ) : (
                                <NoDataOrLoading />
                            )}
                        </div>

                        {/* Bandwidth over time */}
                        {trimmedTimeseries.length > 0 && trimmedTimeseries.some((b) => (b.totalBytes ?? 0) > 0) && (
                            <div id="section-bandwidth" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.bandwidthTitle')}</SectionHeading>
                                <TimelineChart
                                    data={trimmedTimeseries.map((b) => ({ label: b.label, count: b.totalBytes ?? 0 }))}
                                    color="#a78bfa"
                                    height={140}
                                    formatLabel={(l) => formatTsLabel(l, getCurrentBucket())}
                                    valueLabel="Bytes"
                                    xAxisTicks={6}
                                    barLabel={t('logAnalytics.viewBars')}
                                    curveLabel={t('logAnalytics.viewCurve')}
                                />
                            </div>
                        )}

                        </>
                        )}

                        {/* === TAB: HTTP === */}
                        {activeTab === 'http' && (
                        <>
                        {/* Bot vs Human */}
                        {isLoading && !botVsHuman ? (
                            <div id="section-bot-detection" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.botDetectionTitle')}</SectionHeading>
                                <NoDataOrLoading />
                            </div>
                        ) : botVsHuman && (botVsHuman.bots > 0 || botVsHuman.humans > 0) && (
                            <div id="section-bot-detection" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.botDetectionTitle')}</SectionHeading>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <DonutChart
                                        segments={[
                                            { label: t('logAnalytics.humanLabel'), value: botVsHuman.humans, color: '#059669' },
                                            { label: t('logAnalytics.botLabel'), value: botVsHuman.bots, color: '#4b5563' }
                                        ]}
                                        centerValue={`${botVsHuman.botPercent}%`}
                                        centerLabel={t('logAnalytics.botLabel')}
                                    />
                                    {botVsHuman.topBots.length > 0 && (
                                        <div>
                                            <h4 className="text-sm font-semibold text-gray-400 mb-3">
                                                {t('logAnalytics.topBotsTitle')}
                                            </h4>
                                            <div className="space-y-1 max-h-48 overflow-y-auto -mx-1.5">
                                                {botVsHuman.topBots.map((bot, idx) => (
                                                    <div
                                                        key={idx}
                                                        className="flex items-center gap-2 text-sm px-1.5 py-1 rounded-md border-l-2 border-transparent hover:border-gray-500/70 hover:bg-white/[0.03] transition-colors"
                                                    >
                                                        <RankBadge rank={idx} />
                                                        <span className="font-mono text-[13px] text-gray-400 truncate flex-1 min-w-0" title={bot.key}>{bot.key}</span>
                                                        <span className="text-white font-semibold shrink-0 tabular-nums">{bot.count.toLocaleString()}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Panel 1: HTTP Codes (regrouped) */}
                        <div id="section-http-codes" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                            <SectionHeading {...headingCommon}>{t('logAnalytics.httpCodesPanel')}</SectionHeading>
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
                                        <NoDataOrLoading />
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
                                    />
                                </div>
                            )}
                        </div>

                        {/* Panel 2: HTTP Methods & Codes by domain (regrouped) */}
                        <div id="section-http-methods" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                            <SectionHeading {...headingCommon}>{t('logAnalytics.httpMethodsAndDomainPanel')}</SectionHeading>
                            <DistributionChart
                                title={t('logAnalytics.httpMethodsDistribution')}
                                items={distMethods}
                                labelMinWidth="7rem"
                            />
                            {statusByHost.length > 0 && (
                                <div className="mt-6 pt-6 border-t border-gray-800">
                                    <h4 className="text-base font-semibold text-white mb-4">
                                        {t('logAnalytics.statusByHost')}
                                    </h4>
                                    <DualBarChart
                                        data={statusByHost.map((item) => ({
                                            key: `${item.host} | ${item.status}`,
                                            count: item.count,
                                            uniqueVisitors: item.uniqueVisitors
                                        }))}
                                        colorByKey={(key) => {
                                            const status = key.split(' | ')[1] ?? '';
                                            return getStatusColor(status);
                                        }}
                                        labelWidth={450}
                                        hitsLabel={t('logAnalytics.hits')}
                                        visitorsLabel={t('logAnalytics.visitors')}
                                        tableLayout
                                    />
                                </div>
                            )}
                        </div>

                        {/* Top 404 URLs */}
                        {isLoading && notFoundUrls.length === 0 ? (
                            <div id="section-top404" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.top404Title')}</SectionHeading>
                                <NoDataOrLoading />
                            </div>
                        ) : notFoundUrls.length > 0 && (
                            <div id="section-top404" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.top404Title')}</SectionHeading>
                                <DualBarChart
                                    data={notFoundUrls}
                                    labelWidth={500}
                                    hitsLabel={t('logAnalytics.hits')}
                                    visitorsLabel={t('logAnalytics.visitors')}
                                    tableLayout
                                />
                            </div>
                        )}

                        {/* Response Time Distribution */}
                        {isLoading && !responseTimeDist ? (
                            <div id="section-response-time" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.responseTimeTitle')}</SectionHeading>
                                <NoDataOrLoading />
                            </div>
                        ) : responseTimeDist && (
                            <div id="section-response-time" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.responseTimeTitle')}</SectionHeading>
                                <ResponseTimeChart
                                    avg={responseTimeDist.avg}
                                    p50={responseTimeDist.p50}
                                    p95={responseTimeDist.p95}
                                    p99={responseTimeDist.p99}
                                    max={responseTimeDist.max}
                                    buckets={responseTimeDist.buckets}
                                    noDataText={noDataOrLoadingText(isLoading)}
                                />
                            </div>
                        )}

                        </>
                        )}

                        {/* === TAB: Tops === */}
                        {activeTab === 'tops' && (
                        <>
                        {/* Referring Sites & Virtual Hosts */}
                        <div id="section-referring" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-24">
                            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.referringSites')}</SectionHeading>
                                {referringSites.length > 0 ? (
                                    <DualBarChart
                                        data={referringSites}
                                        labelWidth={500}
                                        hitsLabel={t('logAnalytics.hits')}
                                        visitorsLabel={t('logAnalytics.visitors')}
                                        tableLayout
                                    />
                                ) : (
                                    <NoDataOrLoading />
                                )}
                            </div>
                            <div id="section-virtual-hosts" className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <SectionHeading {...headingCommon}>{t('logAnalytics.virtualHosts')}</SectionHeading>
                                {hostWithVisitors.length > 0 ? (
                                    <DualBarChart
                                        data={hostWithVisitors}
                                        labelWidth={500}
                                        hitsLabel={t('logAnalytics.hits')}
                                        visitorsLabel={t('logAnalytics.visitors')}
                                        tableLayout
                                    />
                                ) : (
                                    <NoDataOrLoading />
                                )}
                            </div>
                        </div>

                        {/* Referrer URLs (with visitors) */}
                        <div id="section-referrer-urls" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                            <SectionHeading {...headingCommon}>{t('logAnalytics.referrerUrls')}</SectionHeading>
                            {referrerWithVisitors.length > 0 ? (
                                <DualBarChart
                                    data={referrerWithVisitors}
                                    labelWidth={600}
                                    hitsLabel={t('logAnalytics.hits')}
                                    visitorsLabel={t('logAnalytics.visitors')}
                                    tableLayout
                                />
                            ) : (
                                <NoDataOrLoading />
                            )}
                        </div>

                        {/* Requested Files (URLs with extras) */}
                        <div id="section-requested-files" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                            <SectionHeading {...headingCommon}>{t('logAnalytics.requestedFiles')}</SectionHeading>
                            {urlsWithExtras.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm border-separate border-spacing-0">
                                        <thead>
                                            <tr className="text-[11px] text-gray-500 uppercase tracking-wide">
                                                <th className="text-left py-2 font-medium">{t('logAnalytics.topUrls')}</th>
                                                <th className="text-right py-2 font-medium">{t('logAnalytics.hits')}</th>
                                                <th className="text-right py-2 font-medium">{t('logAnalytics.visitors')}</th>
                                                <th className="text-right py-2 font-medium">{t('logAnalytics.txAmount')}</th>
                                                <th className="text-center py-2 font-medium">{t('logAnalytics.method')}</th>
                                                <th className="text-center py-2 font-medium">{t('logAnalytics.protocol')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {urlsWithExtras.slice(0, 15).map((item, idx) => (
                                                <RequestedFileTableRow
                                                    key={`${item.key}-${idx}`}
                                                    item={item}
                                                    formatBytes={formatBytes}
                                                    idx={idx}
                                                />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <NoDataOrLoading />
                            )}
                        </div>

                        {/* Top panels: URLs and Referrers on first row (2 cols), rest below */}
                        <div id="section-top-panels" className="space-y-4 scroll-mt-24">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <TopPanel
                                    title={t('logAnalytics.topUrls')}
                                    items={topUrls}
                                    loading={isLoading && topUrls.length === 0}
                                    maxKeyLength={80}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge label={sourceLabel} colorClass={sourceColorClass} />}
                                />
                                <TopPanel
                                    title={t('logAnalytics.topReferrers')}
                                    items={topReferrers}
                                    loading={isLoading && topReferrers.length === 0}
                                    maxKeyLength={80}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge label={sourceLabel} colorClass={sourceColorClass} />}
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                <TopPanel
                                    title={t('logAnalytics.topIps')}
                                    items={topIps}
                                    loading={isLoading && topIps.length === 0}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge label={sourceLabel} colorClass={sourceColorClass} />}
                                />
                                <TopPanel
                                    title={t('logAnalytics.topStatus')}
                                    items={topStatus}
                                    loading={isLoading && topStatus.length === 0}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge label={sourceLabel} colorClass={sourceColorClass} />}
                                />
                                <TopPanel
                                    title={t('logAnalytics.topBrowsers')}
                                    items={topBrowsers}
                                    loading={isLoading && topBrowsers.length === 0}
                                    maxKeyLength={25}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge label={sourceLabel} colorClass={sourceColorClass} />}
                                />
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <TopPanel
                                    title={t('logAnalytics.topUserAgents')}
                                    items={topUserAgents}
                                    loading={isLoading && topUserAgents.length === 0}
                                    maxKeyLength={50}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge label={sourceLabel} colorClass={sourceColorClass} />}
                                />
                            </div>
                        </div>
                        </>
                        )}
                    </>
                )}
            </div>

        </div>
    );
};
