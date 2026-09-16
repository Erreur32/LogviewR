/**
 * LogAnalyticsPage - LogviewR
 *
 * Full-screen log analytics page for Nginx Proxy Manager, Apache, and Nginx logs.
 * Displays: KPI cards, timeline histogram, top panels (URLs, IPs, status, UA, referrers),
 * and method/status distribution charts.
 */

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
    ChevronLeft,
    RefreshCw,
    BarChart2,
    Archive,
    TrendingUp,
    Shield,
    Trophy,
    CheckCircle2,
    XCircle,
    FileText,
    Zap,
    Loader2
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
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
import { OverviewTab } from './log-analytics/OverviewTab';
import { TopsTab } from './log-analytics/TopsTab';
import { HttpSecurityTab } from './log-analytics/HttpSecurityTab';
import { formatBytes } from './log-analytics/utils';

interface LogAnalyticsPageProps {
    onBack: () => void;
}

/** Web access logs only: NPM and Apache. "all" merges both plugins. */
const LOG_SOURCE_PLUGINS = ['npm', 'apache'] as const;
const PLUGIN_OPTIONS = ['all', ...LOG_SOURCE_PLUGINS] as const;
const DEFAULT_PLUGIN = 'all';

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

/**
 * Window (in days) for the fixed-window widgets (Day of Week / Calendar Heatmap / Hour×Day
 * Heatmap): synced with the global period selector when it's 7d/30d, otherwise falls back to
 * 7 days (1h/24h are too short to show a meaningful calendar/heatmap view; a custom range
 * shorter than 7 days gets the same treatment).
 */
function resolveCalendarWindowDays(timeRange: TimeRangeKey, customFrom: string, customTo: string): number {
    if (timeRange === '7d') return 7;
    if (timeRange === '30d') return 30;
    if (timeRange === 'custom') {
        const rangeDays = Math.round((new Date(customTo).getTime() - new Date(customFrom).getTime()) / (24 * 60 * 60 * 1000));
        return rangeDays >= 7 ? Math.min(rangeDays, 365) : 7;
    }
    return 7;
}


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
    const [topIps, setTopIps] = useState<AnalyticsTopItem[]>([]);
    const [topStatus, setTopStatus] = useState<AnalyticsTopItem[]>([]);
    const [topUserAgents, setTopUserAgents] = useState<AnalyticsTopItem[]>([]);
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
    const [activeTab, setActiveTab] = useState<'overview' | 'httpSecurity' | 'tops'>('overview');
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
        setTopIps([]);
        setTopStatus([]);
        setTopUserAgents([]);
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
        setTopIps(result.top?.ips ?? []);
        setTopStatus(result.top?.status ?? []);
        setTopUserAgents(result.top?.ua ?? []);
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
                    setTopIps(res.result.top.ips);
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
     * Calendar heatmap + day-of-week chart use a window synced with the global period selector
     * when it's 7d/30d (see resolveCalendarWindowDays), falling back to a fixed 7-day window
     * otherwise (1h/24h are too short for a meaningful heatmap). Refetched when the plugin
     * filter or the resolved window changes (or via the main refresh button).
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

    const calendarWindowDays = resolveCalendarWindowDays(timeRange, customFrom, customTo);
    const calendarWindowSynced = timeRange === '7d' || timeRange === '30d';

    const fetchCalendar = useCallback(async (force = false) => {
        const cacheKey = `${pluginId}:${calendarWindowDays}`;

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
            const res = await api.get<CalendarApiResponse>(`/api/log-viewer/analytics/calendar?windowDays=${calendarWindowDays}${pluginParam}${forceParam}`);
            if (!res.success || !res.result || Array.isArray((res.result as unknown as { ok?: false }).ok)) return;
            applyCalendarResult(res.result);
            setCachedCalendar(cacheKey, res.result);
        } catch {
            /* silent, heatmap will just render no-data */
        } finally {
            setIsCalendarLoading(false);
        }
    }, [pluginId, calendarWindowDays, applyCalendarResult]);

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

    const getCurrentBucket = (): 'minute' | 'hour' | 'day' => {
        if (timeRange === '1h') return 'minute';
        if (timeRange === '24h' || timeRange === '7d') return 'hour';
        if (timeRange === 'custom') return bucketForCustomRange(new Date(customTo).getTime() - new Date(customFrom).getTime());
        return 'day';
    };
    const currentBucket = getCurrentBucket();

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

    // Compact progress bar (Refresh/Live) — null pct means no per-file granularity yet
    // (e.g. live scan just started), rendered as an indeterminate pulse instead of 0%.
    const showLoadingProgressBar = (isLoading || isLiveRefreshing) && !(isLoading && overview === null);
    const loadingDoneCount = progressFiles.filter((f) => f.status === 'done' || f.status === 'error').length;
    const loadingPct = progressFiles.length > 0 ? Math.round((loadingDoneCount / progressFiles.length) * 100) : null;
    let loadingProgressLabel: string;
    if (isLiveRefreshing) {
        loadingProgressLabel = t('logAnalytics.liveRefresh');
    } else if (progressPhase === 'aggregating') {
        loadingProgressLabel = t('logAnalytics.aggregatingResults');
    } else {
        loadingProgressLabel = t('logAnalytics.scanningFiles');
    }

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
                        <span className="truncate">{loadingProgressLabel}</span>
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
                        {/* Tab navigation */}
                        <div className="flex items-center gap-1 p-1 bg-[#0a0a0a] rounded-xl border border-gray-800">
                            {([
                                { id: 'overview' as const, icon: TrendingUp, label: t('logAnalytics.tabOverview') },
                                { id: 'httpSecurity' as const, icon: Shield, label: t('logAnalytics.tabHttpSecurity') },
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

                        {activeTab === 'overview' && (
                            <OverviewTab
                                heading={headingCommon}
                                sourceLabel={sourceLabel}
                                isLoading={isLoading}
                                isCalendarLoading={isCalendarLoading}
                                overview={overview}
                                statsKpiVisible={statsKpiVisible}
                                onToggleStatsKpi={() => setStatsKpiVisible((v) => !v)}
                                quickCoverage={quickCoverage}
                                periodLabel={periodLabel}
                                trimmedTimeseries={trimmedTimeseries}
                                timeseriesStats={timeseriesStats}
                                currentBucket={currentBucket}
                                distStatus={distStatus}
                                statusWithVisitors={statusWithVisitors}
                                hourOfDay={hourOfDay}
                                calendarBuckets={calendarBuckets}
                                hourDayGrid={hourDayGrid}
                                live24h={live24h}
                                live7d={live7d}
                                peakHoursLive={peakHoursLive}
                                onTogglePeakHoursLive={() => setPeakHoursLive((v) => !v)}
                                dayOfWeekLive={dayOfWeekLive}
                                onToggleDayOfWeekLive={() => setDayOfWeekLive((v) => !v)}
                                hourDayLive={hourDayLive}
                                onToggleHourDayLive={() => setHourDayLive((v) => !v)}
                                calendarWindowDays={calendarWindowDays}
                                calendarWindowSynced={calendarWindowSynced}
                            />
                        )}

                        {activeTab === 'httpSecurity' && (
                            <HttpSecurityTab
                                heading={headingCommon}
                                isLoading={isLoading}
                                botVsHuman={botVsHuman}
                                distMethods={distMethods}
                                statusByHost={statusByHost}
                                responseTimeDist={responseTimeDist}
                            />
                        )}

                        {activeTab === 'tops' && (
                            <TopsTab
                                heading={headingCommon}
                                isLoading={isLoading}
                                sourceLabel={sourceLabel}
                                sourceColorClass={sourceColorClass}
                                referringSites={referringSites}
                                hostWithVisitors={hostWithVisitors}
                                referrerWithVisitors={referrerWithVisitors}
                                urlsWithExtras={urlsWithExtras}
                                notFoundUrls={notFoundUrls}
                                topIps={topIps}
                                topStatus={topStatus}
                                topBrowsers={topBrowsers}
                                topUserAgents={topUserAgents}
                            />
                        )}
                    </>
                )}
            </div>

        </div>
    );
};
