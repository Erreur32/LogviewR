/**
 * GoAccessStyleStatsPage - LogviewR
 *
 * Full-screen log analytics page inspired by GoAccess for Nginx Proxy Manager.
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
    List,
    X,
    TrendingUp,
    Shield,
    Trophy
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

interface GoAccessStyleStatsPageProps {
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
}> = ({ title, items, maxKeyLength = 40, showBar = true, maxVisibleWithoutScroll, scrollWhenCollapsed = true, twoColumns = false, sourceBadge }) => {
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
                    {sourceBadge}
                </div>
                {canToggle && (
                    <button
                        type="button"
                        onClick={() => setShowAll((v) => !v)}
                        className="p-1 rounded hover:bg-gray-700/50 text-gray-400 hover:text-emerald-400 transition-colors shrink-0"
                        title={showAll ? t('goaccessStats.showLimitedItems') : t('goaccessStats.showAllItems')}
                        aria-label={showAll ? t('goaccessStats.showLimitedItems') : t('goaccessStats.showAllItems')}
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
                        <div className="px-4 py-6 text-sm text-gray-500 text-center">
                            {t('goaccessStats.noData')}
                        </div>
                    ) : (
                        <ul className={twoColumns ? 'grid grid-cols-2 gap-x-6' : 'divide-y divide-gray-800/50'}>
                            {displayItems.map((item, idx) => (
                                <li
                                    key={`${item.key}-${idx}`}
                                    className={`px-4 py-2.5 hover:bg-[#121212] relative ${twoColumns ? 'border-b border-gray-800/50' : ''}`}
                                    onMouseEnter={(e) => {
                                        setHoveredItem(item);
                                        setTooltipRect(e.currentTarget.getBoundingClientRect());
                                    }}
                                    onMouseLeave={() => {
                                        setHoveredItem(null);
                                        setTooltipRect(null);
                                    }}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-sm text-gray-300 truncate flex-1 min-w-0">
                                            {item.key}
                                        </span>
                                        <span className="text-sm font-medium text-white shrink-0">
                                            {item.count}
                                            {item.percent != null && (
                                                <span className="text-gray-500 ml-1">({item.percent}%)</span>
                                            )}
                                        </span>
                                    </div>
                                    {showBar && item.percent != null && (
                                        <div className="mt-1.5 h-2 bg-gray-800/80 rounded overflow-hidden border border-gray-700/30">
                                            <div
                                                className="h-full bg-emerald-700/80 rounded-l origin-left"
                                                style={{
                                                    width: `${(item.percent / maxPct) * 100}%`,
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
                                                <span>{t('goaccessStats.hits')}: <strong className="text-white">{item.count}</strong></span>
                                                {item.percent != null && (
                                                    <span>{t('goaccessStats.total')}: <strong className="text-emerald-400">{item.percent}%</strong></span>
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

export const GoAccessStyleStatsPage: React.FC<GoAccessStyleStatsPageProps> = ({ onBack }) => {
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

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    /** Stats KPI block: collapsible, visible by default. */
    const [statsKpiVisible, setStatsKpiVisible] = useState(true);
    const [activeTab, setActiveTab] = useState<'graphs' | 'http' | 'tops'>('graphs');
    const [navMenuOpen, setNavMenuOpen] = useState(false);
    const navButtonRef = useRef<HTMLButtonElement>(null);
    const [navMenuRect, setNavMenuRect] = useState<DOMRect | null>(null);

    const scrollToSection = useCallback((id: string) => {
        setNavMenuOpen(false);
        requestAnimationFrame(() => {
            const el = document.getElementById(id);
            if (!el) return;
            el.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        });
    }, []);

    useEffect(() => {
        if (navMenuOpen && navButtonRef.current) {
            setNavMenuRect(navButtonRef.current.getBoundingClientRect());
        } else {
            setNavMenuRect(null);
        }
    }, [navMenuOpen]);

    useEffect(() => {
        if (!navMenuOpen) return;
        const onDocClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('[data-stats-nav-menu]')) setNavMenuOpen(false);
        };
        document.addEventListener('click', onDocClick, { capture: true });
        return () => document.removeEventListener('click', onDocClick, { capture: true });
    }, [navMenuOpen]);

    const enabledLogPlugins = useMemo(
        () =>
            plugins.filter((p) =>
                p.enabled && LOG_SOURCE_PLUGINS.includes(p.id as (typeof LOG_SOURCE_PLUGINS)[number])
            ),
        [plugins]
    );

    const fetchAnalytics = useCallback(async () => {
        const isPluginEnabled =
            pluginId === 'all'
                ? enabledLogPlugins.length > 0
                : enabledLogPlugins.some((p) => p.id === pluginId);
        if (!isPluginEnabled) {
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
            setIsLoading(false);
            setError(null);
            return;
        }

        setIsLoading(true);
        setError(null);

        const to = new Date();
        let from: Date;
        let bucketHour: 'minute' | 'hour' | 'day' = 'hour';
        let bucketDay: 'day' = 'day';

        if (timeRange === '1h') {
            from = new Date(to.getTime() - 60 * 60 * 1000);
            bucketHour = 'minute';
        } else if (timeRange === '24h') {
            from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
            bucketHour = 'hour';
        } else if (timeRange === '7d') {
            from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
            bucketHour = 'day';
        } else if (timeRange === '30d') {
            from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
            bucketHour = 'day';
        } else {
            from = new Date(customFrom);
            const toCustom = new Date(customTo);
            const rangeMs = toCustom.getTime() - from.getTime();
            bucketHour = rangeMs <= 2 * 60 * 60 * 1000 ? 'minute' : rangeMs <= 48 * 60 * 60 * 1000 ? 'hour' : 'day';
            to.setTime(toCustom.getTime());
        }

        const fromStr = from.toISOString();
        const toStr = to.toISOString();
        const pluginParam = `&pluginId=${encodeURIComponent(pluginId)}`;
        const fileScopeParam = `&fileScope=${fileScope}`;
        const compressedParam = includeCompressed ? '&includeCompressed=true' : '';

        try {
            const res = await api.get<{
                overview: AnalyticsOverview;
                timeseries: { buckets: AnalyticsTimeseriesBucket[] };
                distribution?: {
                    methods: AnalyticsDistribution[];
                    status: AnalyticsDistribution[];
                    statusWithVisitors?: AnalyticsDistributionWithVisitors[];
                    botVsHuman?: AnalyticsBotVsHuman;
                    responseTime?: AnalyticsResponseTimeDistribution | null;
                };
                top: {
                    urls: AnalyticsTopItem[];
                    ips: AnalyticsTopItem[];
                    status: AnalyticsTopItem[];
                    ua: AnalyticsTopItem[];
                    referrer: AnalyticsTopItem[];
                    browser?: AnalyticsTopItem[];
                    host?: AnalyticsTopItem[];
                    referringSites?: AnalyticsTopItemWithVisitors[];
                    referrerWithVisitors?: AnalyticsTopItemWithVisitors[];
                    hostWithVisitors?: AnalyticsTopItemWithVisitors[];
                    urlsWithExtras?: AnalyticsTopUrlItem[];
                    statusByHost?: AnalyticsStatusByHostItem[];
                    notFoundUrls?: AnalyticsTopItemWithVisitors[];
                };
            }>(
                `/api/log-viewer/analytics?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&bucket=${bucketHour}&topLimit=15${pluginParam}${fileScopeParam}${compressedParam}`
            );

            if (res.success && res.result) {
                setOverview(res.result.overview);
                setTimeseries(res.result.timeseries?.buckets ?? []);
                setTopUrls(res.result.top?.urls ?? []);
                setTopIps(res.result.top?.ips ?? []);
                setTopStatus(res.result.top?.status ?? []);
                setTopUserAgents(res.result.top?.ua ?? []);
                setTopReferrers(res.result.top?.referrer ?? []);
                setTopBrowsers(res.result.top?.browser ?? []);
                setDistMethods(res.result.distribution?.methods ?? []);
                setDistStatus(res.result.distribution?.status ?? []);
                setStatusWithVisitors(res.result.distribution?.statusWithVisitors ?? []);
                setReferringSites(res.result.top?.referringSites ?? []);
                setHostWithVisitors(res.result.top?.hostWithVisitors ?? []);
                setReferrerWithVisitors(res.result.top?.referrerWithVisitors ?? []);
                setUrlsWithExtras(res.result.top?.urlsWithExtras ?? []);
                setStatusByHost(res.result.top?.statusByHost ?? []);
                setNotFoundUrls(res.result.top?.notFoundUrls ?? []);
                setBotVsHuman(res.result.distribution?.botVsHuman ?? null);
                setResponseTimeDist(res.result.distribution?.responseTime ?? null);
            } else {
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
            }

            if (
                !res.success &&
                res.error?.code !== 'CLIENT_ERROR' &&
                res.error?.code !== 'NETWORK_ERROR'
            ) {
                setError(res.error?.message || t('goaccessStats.loadError'));
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : t('goaccessStats.loadError'));
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
        } finally {
            setIsLoading(false);
        }
    }, [pluginId, enabledLogPlugins, timeRange, customFrom, customTo, fileScope, includeCompressed, t]);

    useEffect(() => {
        fetchAnalytics();
    }, [fetchAnalytics]);


    const getPluginLabel = (id: string): string => {
        const names: Record<string, string> = {
            all: t('goaccessStats.pluginAll'),
            npm: 'NPM',
            apache: 'Apache'
        };
        return names[id] || id;
    };

    const pluginColorMap: Record<string, string> = {
        apache: 'bg-red-500/15 text-red-400 border-red-500/30',
        npm: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        all: 'bg-sky-500/15 text-sky-400 border-sky-500/30'
    };

    const SourceBadge: React.FC = () => (
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${pluginColorMap[pluginId] ?? 'bg-gray-500/15 text-gray-400 border-gray-500/30'}`}>
            {getPluginLabel(pluginId)}
        </span>
    );

    const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2.5">
            <span>{children}</span>
            <SourceBadge />
        </h3>
    );

    /**
     * Format timeseries axis labels: no year, "h" for hour (instead of "T").
     * Compact format to avoid overflow. Handles ISO-like strings (2026-02-12T18, 2026-02-12T18:00, etc.).
     */
    const formatTsLabel = useCallback((raw: string, bucket: 'minute' | 'hour' | 'day') => {
        try {
            let d = new Date(raw);
            if (isNaN(d.getTime())) {
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
        if (timeRange === '24h') return 'hour';
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

    const RequestedFileTableRow: React.FC<{
        item: AnalyticsTopUrlItem;
        formatBytes: (bytes: number) => string;
    }> = ({ item, formatBytes }) => {
        const [hovered, setHovered] = useState(false);
        const [tooltipRect, setTooltipRect] = useState<DOMRect | null>(null);
        return (
            <tr
                className="border-b border-gray-800/50"
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
                    <div className="text-gray-300 truncate">{item.key}</div>
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
                <td className="py-1.5 text-right text-white">{item.count}</td>
                <td className="py-1.5 text-right text-emerald-400">{item.uniqueVisitors}</td>
                <td className="py-1.5 text-right text-purple-300">{formatBytes(item.txAmount ?? 0)}</td>
                <td className="py-1.5 text-center text-gray-400">{item.method ?? '-'}</td>
                <td className="py-1.5 text-center text-gray-400">{item.protocol ?? '-'}</td>
            </tr>
        );
    };

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
                    <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                        {t('goaccessStats.noData')}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {items.slice(0, 12).map((item, idx) => (
                            <div key={item.key} className="flex items-center gap-3 min-h-0">
                                <span className="text-sm text-gray-400 shrink-0 whitespace-nowrap" style={{ minWidth: labelMinWidth }}>{item.key}</span>
                                <div className="flex-1 min-w-0 h-3 bg-gray-800/80 rounded overflow-hidden border border-gray-600/40">
                                    <div
                                        className="h-full rounded-l origin-left"
                                        style={{
                                            width: `${(item.count / maxCount) * 100}%`,
                                            backgroundColor: getColor(item.key),
                                            animation: 'barGrow 0.5s ease-out forwards',
                                            animationDelay: `${idx * 40}ms`
                                        }}
                                    />
                                </div>
                                <span className="text-sm font-medium text-white shrink-0 whitespace-nowrap min-w-[5.5rem] text-right">
                                    {item.count} ({item.percent}%)
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="min-h-screen text-gray-300 overflow-x-hidden">
            <header className="sticky top-0 z-40 bg-[#0a0a0a]/80 backdrop-blur-md border-b border-gray-800/80">
                <div className="max-w-[1920px] mx-auto px-4 py-4">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={onBack}
                                className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
                                aria-label={t('goaccessStats.back')}
                            >
                                <ChevronLeft size={24} />
                            </button>
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-emerald-500/20 rounded-lg">
                                    <BarChart2 size={24} className="text-emerald-400" />
                                </div>
                                <div>
                                    <h1 className="text-xl font-bold text-white">
                                        {t('goaccessStats.title')}
                                    </h1>
                                    <p className="text-sm text-gray-500">
                                        {t('goaccessStats.subtitle')}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{t('goaccessStats.statsHeaderPlugin')}</span>
                                <select
                                    value={pluginId}
                                    onChange={(e) => setPluginId(e.target.value)}
                                    className="stats-header-select"
                                    title={t('goaccessStats.pluginFilterTip')}
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
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{t('goaccessStats.timeRange')}</span>
                                <select
                                    value={timeRange}
                                    onChange={(e) => setTimeRange(e.target.value as typeof timeRange)}
                                    className="stats-header-select"
                                    title={t('goaccessStats.timeRange')}
                                >
                                    <option value="1h">{t('goaccessStats.timeRange1h')}</option>
                                    <option value="24h">{t('goaccessStats.timeRange24h')}</option>
                                    <option value="7d">{t('goaccessStats.timeRange7d')}</option>
                                    <option value="30d">{t('goaccessStats.timeRange30d')}</option>
                                    <option value="custom">{t('goaccessStats.timeRangeCustom')}</option>
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
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">{t('goaccessStats.fileScope')}</span>
                                <select
                                    value={fileScope}
                                    onChange={(e) => setFileScope(e.target.value as 'latest' | 'all')}
                                    className="stats-header-select"
                                    title={fileScope === 'latest' ? t('goaccessStats.fileScopeLatestTip') : t('goaccessStats.fileScopeAllTip')}
                                >
                                    <option value="latest">{t('goaccessStats.fileScopeLatest')}</option>
                                    <option value="all">{t('goaccessStats.fileScopeAll')}</option>
                                </select>
                            </div>
                            <div className="h-6 w-px bg-gray-700/60" aria-hidden />
                            <label
                                className="flex items-center gap-2.5 cursor-pointer group"
                                title={t('goaccessStats.includeCompressedTip')}
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
                                    {t('goaccessStats.includeCompressed')}
                                </span>
                            </label>
                            <div className="h-6 w-px bg-gray-700/60" aria-hidden />
                            <button
                                onClick={fetchAnalytics}
                                disabled={isLoading}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white shadow-lg shadow-emerald-900/20 transition-all duration-200 hover:shadow-emerald-900/30"
                            >
                                <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                                {t('goaccessStats.refresh')}
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <div className="p-4 md:p-6 max-w-[1920px] mx-auto space-y-6">
                {error && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {isLoading ? (
                    <div className="flex items-center justify-center py-24">
                        <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin" />
                        <span className="ml-3 text-gray-400">{t('goaccessStats.loading')}</span>
                    </div>
                ) : (
                    <>
                        {/* Unified KPI section with source badge */}
                        <div id="section-kpi" className="bg-[#121212]/90 rounded-xl border border-gray-800 overflow-hidden backdrop-blur-sm scroll-mt-24">
                            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800/60">
                                <div className="flex items-center gap-3">
                                    <h3
                                        className="text-base font-semibold text-white cursor-help"
                                        title={t('goaccessStats.kpiModalIntro')}
                                    >
                                        {t('goaccessStats.statsKpi')}
                                    </h3>
                                    {overview && (
                                        <button
                                            type="button"
                                            onClick={() => setStatsKpiVisible((v) => !v)}
                                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-gray-500 hover:text-gray-300 hover:bg-gray-800/50 transition-colors"
                                        >
                                            {statsKpiVisible ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                            {statsKpiVisible ? t('goaccessStats.statsKpiHide') : t('goaccessStats.statsKpiShow')}
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">{t('goaccessStats.source')}</span>
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
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                    <div className="p-3 rounded-lg bg-[#0a0a0a] border border-gray-800/50" title={t('goaccessStats.tipTotalRequests')}>
                                        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1.5">
                                            <Activity size={13} className="text-emerald-400" />
                                            {t('goaccessStats.totalRequests')}
                                        </div>
                                        <div className="text-xl font-bold text-white">{overview?.totalRequests ?? 0}</div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-[#0a0a0a] border border-gray-800/50" title={t('goaccessStats.tipUniqueVisitors')}>
                                        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1.5">
                                            <Globe size={13} className="text-blue-400" />
                                            {t('goaccessStats.uniqueVisitors')}
                                        </div>
                                        <div className="text-xl font-bold text-white">{overview?.uniqueIps ?? 0}</div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-[#0a0a0a] border border-gray-800/50" title={t('goaccessStats.tipStatus4xx')}>
                                        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1.5">
                                            <AlertTriangle size={13} className="text-amber-400" />
                                            {t('goaccessStats.status4xx')}
                                        </div>
                                        <div className="text-xl font-bold text-amber-400">{overview?.status4xx ?? 0}</div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-[#0a0a0a] border border-gray-800/50" title={t('goaccessStats.tipStatus5xx')}>
                                        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1.5">
                                            <ServerCrash size={13} className="text-red-400" />
                                            {t('goaccessStats.status5xx')}
                                        </div>
                                        <div className="text-xl font-bold text-red-400">{overview?.status5xx ?? 0}</div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-[#0a0a0a] border border-gray-800/50" title={t('goaccessStats.tipTotalBytes')}>
                                        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1.5">
                                            <HardDrive size={13} className="text-purple-400" />
                                            {t('goaccessStats.totalBytes')}
                                        </div>
                                        <div className="text-xl font-bold text-purple-300">{overview ? formatBytes(overview.totalBytes) : '0 B'}</div>
                                    </div>
                                    <div className="p-3 rounded-lg bg-[#0a0a0a] border border-gray-800/50" title={t('goaccessStats.tipFilesAnalyzed')}>
                                        <div className="flex items-center gap-2 text-gray-500 text-xs mb-1.5">
                                            <FileText size={13} className="text-cyan-400" />
                                            {t('goaccessStats.filesAnalyzed')}
                                        </div>
                                        <div className="text-xl font-bold text-cyan-300">{overview?.filesAnalyzed ?? 0}</div>
                                    </div>
                                </div>

                                {overview && (
                                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-3 pt-3 border-t border-gray-800/40">
                                        <div className="p-2.5 rounded-lg bg-[#0a0a0a] border border-gray-800/40" title={t('goaccessStats.tipValidRequests')}>
                                            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                                                <Activity size={12} className="text-emerald-500" />
                                                {t('goaccessStats.validRequests')}
                                            </div>
                                            <div className="font-bold text-emerald-400">{overview.validRequests ?? 0}</div>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-[#0a0a0a] border border-gray-800/40" title={t('goaccessStats.tipFailedRequests')}>
                                            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                                                <AlertTriangle size={12} className="text-red-400" />
                                                {t('goaccessStats.failedRequests')}
                                            </div>
                                            <div className="font-bold text-red-400">{overview.failedRequests ?? 0}</div>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-[#0a0a0a] border border-gray-800/40" title={t('goaccessStats.tipNotFound')}>
                                            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                                                <AlertTriangle size={12} className="text-amber-400" />
                                                {t('goaccessStats.notFound')}
                                            </div>
                                            <div className="font-bold text-amber-400">{overview.notFound ?? 0}</div>
                                        </div>
                                        <div className="p-2.5 rounded-lg bg-[#0a0a0a] border border-gray-800/40" title={t('goaccessStats.tipStaticFiles')}>
                                            <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                                                <FileText size={12} className="text-cyan-400" />
                                                {t('goaccessStats.staticFiles')}
                                            </div>
                                            <div className="font-bold text-cyan-300">{overview.staticFiles ?? 0}</div>
                                        </div>
                                    </div>
                                )}
                            </div>
                            )}
                        </div>

                        {/* Tab navigation */}
                        <div className="flex items-center gap-1 p-1 bg-[#0a0a0a] rounded-xl border border-gray-800">
                            {([
                                { id: 'graphs' as const, icon: TrendingUp, label: t('goaccessStats.tabGraphs') },
                                { id: 'http' as const, icon: Shield, label: t('goaccessStats.tabHttp') },
                                { id: 'tops' as const, icon: Trophy, label: t('goaccessStats.tabTops') }
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
                        {/* Timeline - Requêtes dans le temps (bar/curve + date/time axis) */}
                        <div id="section-timeline" className="bg-[#121212] rounded-xl border border-gray-800 p-6 w-full scroll-mt-24">
                            <SectionHeading>{t('goaccessStats.requestsOverTime')}</SectionHeading>
                            {trimmedTimeseries.length > 0 ? (
                                <div className="w-full min-w-0">
                                    <TimelineChart
                                        data={trimmedTimeseries.map((b) => ({ label: b.label, count: b.count }))}
                                        color="#10b981"
                                        height={140}
                                        formatLabel={(l) => formatTsLabel(l, getCurrentBucket())}
                                        valueLabel={t('goaccessStats.requests')}
                                        xAxisTicks={6}
                                        barLabel={t('goaccessStats.viewBars')}
                                        curveLabel={t('goaccessStats.viewCurve')}
                                    />
                                </div>
                            ) : (
                                <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                                    {t('goaccessStats.noData')}
                                </div>
                            )}
                        </div>

                        {/* Calendar Heatmap - only when bucket is day */}
                        {getCurrentBucket() === 'day' && trimmedTimeseries.length > 0 && (
                            <div id="section-heatmap" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading>{t('goaccessStats.heatmapTitle')}</SectionHeading>
                                <HeatmapChart
                                    data={trimmedTimeseries.map((b) => ({ label: b.label, count: b.count }))}
                                    noDataText={t('goaccessStats.noData')}
                                    dayLabels={[
                                        t('goaccessStats.monday'), t('goaccessStats.tuesday'), t('goaccessStats.wednesday'),
                                        t('goaccessStats.thursday'), t('goaccessStats.friday'), t('goaccessStats.saturday'), t('goaccessStats.sunday')
                                    ]}
                                />
                            </div>
                        )}

                        {/* Time Distribution & Unique Visitors (dual-line charts) */}
                        <div id="section-time-dist" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-24">
                            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <SectionHeading>{t('goaccessStats.timeDistribution')}</SectionHeading>
                                {trimmedTimeseries.length > 0 ? (
                                    <DualLineChart
                                        data={trimmedTimeseries.map((b) => ({
                                            label: b.label,
                                            count: b.count,
                                            uniqueVisitors: b.uniqueVisitors ?? 0
                                        }))}
                                        requestsLabel={t('goaccessStats.requests')}
                                        visitorsLabel={t('goaccessStats.visitors')}
                                        height={140}
                                        formatLabel={(l) => formatTsLabel(l, getCurrentBucket())}
                                        xAxisTicks={6}
                                        showGrid
                                    />
                                ) : (
                                    <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                                        {t('goaccessStats.noData')}
                                    </div>
                                )}
                            </div>
                            <div id="section-unique-visitors" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading>{t('goaccessStats.uniqueVisitorsChart')}</SectionHeading>
                                {trimmedTimeseries.length > 0 ? (
                                    <DualLineChart
                                        data={trimmedTimeseries.map((b) => ({
                                            label: b.label,
                                            count: b.count,
                                            uniqueVisitors: b.uniqueVisitors ?? 0
                                        }))}
                                        requestsLabel={t('goaccessStats.hits')}
                                        visitorsLabel={t('goaccessStats.visitors')}
                                        height={140}
                                        formatLabel={(l) => formatTsLabel(l, getCurrentBucket())}
                                        xAxisTicks={6}
                                        showGrid
                                    />
                                ) : (
                                    <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                                        {t('goaccessStats.noData')}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Peak Hours (needs hour/minute granularity) */}
                        {trimmedTimeseries.length > 0 && getCurrentBucket() !== 'day' && (
                            <div id="section-peak-hours" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading>{t('goaccessStats.peakHoursTitle')}</SectionHeading>
                                <PeakHoursChart
                                    data={timeseries.map((b) => ({ label: b.label, count: b.count }))}
                                    noDataText={t('goaccessStats.noData')}
                                    requestsLabel={t('goaccessStats.requests')}
                                />
                            </div>
                        )}

                        {/* Day of Week + Hour x Day Heatmap combined */}
                        {trimmedTimeseries.length > 0 && (
                            <div id="section-hour-day" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <div>
                                        <SectionHeading>{t('goaccessStats.dayOfWeekTitle')}</SectionHeading>
                                        <DayOfWeekChart
                                            data={timeseries.map((b) => ({ label: b.label, count: b.count }))}
                                            noDataText={t('goaccessStats.noData')}
                                            dayLabels={[
                                                t('goaccessStats.monday'), t('goaccessStats.tuesday'), t('goaccessStats.wednesday'),
                                                t('goaccessStats.thursday'), t('goaccessStats.friday'), t('goaccessStats.saturday'), t('goaccessStats.sunday')
                                            ]}
                                            requestsLabel={t('goaccessStats.requests')}
                                        />
                                    </div>
                                    {getCurrentBucket() !== 'day' && (
                                        <div>
                                            <SectionHeading>{t('goaccessStats.hourDayHeatmapTitle')}</SectionHeading>
                                            <HourDayHeatmap
                                                data={timeseries.map((b) => ({ label: b.label, count: b.count }))}
                                                noDataText={t('goaccessStats.noData')}
                                                dayLabels={[
                                                    t('goaccessStats.monday'), t('goaccessStats.tuesday'), t('goaccessStats.wednesday'),
                                                    t('goaccessStats.thursday'), t('goaccessStats.friday'), t('goaccessStats.saturday'), t('goaccessStats.sunday')
                                                ]}
                                                requestsLabel={t('goaccessStats.requests')}
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Status Trends over time */}
                        {trimmedTimeseries.length > 0 && (
                            <div id="section-status-trends" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading>{t('goaccessStats.statusTrendsTitle')}</SectionHeading>
                                <StatusTrendsChart
                                    data={trimmedTimeseries}
                                    height={180}
                                    formatLabel={(l) => formatTsLabel(l, getCurrentBucket())}
                                    noDataText={t('goaccessStats.noData')}
                                    xAxisTicks={6}
                                />
                            </div>
                        )}

                        {/* Bandwidth over time */}
                        {trimmedTimeseries.length > 0 && trimmedTimeseries.some((b) => (b.totalBytes ?? 0) > 0) && (
                            <div id="section-bandwidth" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading>{t('goaccessStats.bandwidthTitle')}</SectionHeading>
                                <TimelineChart
                                    data={trimmedTimeseries.map((b) => ({ label: b.label, count: b.totalBytes ?? 0 }))}
                                    color="#a78bfa"
                                    height={140}
                                    formatLabel={(l) => formatTsLabel(l, getCurrentBucket())}
                                    valueLabel="Bytes"
                                    xAxisTicks={6}
                                    barLabel={t('goaccessStats.viewBars')}
                                    curveLabel={t('goaccessStats.viewCurve')}
                                />
                            </div>
                        )}

                        </>
                        )}

                        {/* === TAB: HTTP === */}
                        {activeTab === 'http' && (
                        <>
                        {/* Bot vs Human */}
                        {botVsHuman && (botVsHuman.bots > 0 || botVsHuman.humans > 0) && (
                            <div id="section-bot-detection" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading>{t('goaccessStats.botDetectionTitle')}</SectionHeading>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    <DonutChart
                                        segments={[
                                            { label: t('goaccessStats.humanLabel'), value: botVsHuman.humans, color: '#059669' },
                                            { label: t('goaccessStats.botLabel'), value: botVsHuman.bots, color: '#4b5563' }
                                        ]}
                                        centerValue={`${botVsHuman.botPercent}%`}
                                        centerLabel={t('goaccessStats.botLabel')}
                                    />
                                    {botVsHuman.topBots.length > 0 && (
                                        <div>
                                            <h4 className="text-sm font-semibold text-gray-400 mb-3">
                                                {t('goaccessStats.topBotsTitle')}
                                            </h4>
                                            <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                                {botVsHuman.topBots.map((bot, idx) => (
                                                    <div key={idx} className="flex items-center gap-2 text-sm">
                                                        <span className="text-gray-400 truncate flex-1 min-w-0" title={bot.key}>{bot.key}</span>
                                                        <span className="text-white font-medium shrink-0">{bot.count}</span>
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
                            <SectionHeading>{t('goaccessStats.httpCodesPanel')}</SectionHeading>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                <div>
                                    {statusWithVisitors.length > 0 ? (
                                        <DualBarChart
                                            data={statusWithVisitors}
                                            colorByKey={getStatusColor}
                                            maxKeyLength={8}
                                            hitsLabel={t('goaccessStats.hits')}
                                            visitorsLabel={t('goaccessStats.visitors')}
                                            tableLayout
                                        />
                                    ) : (
                                        <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                                            {t('goaccessStats.noData')}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    {statusWithVisitors.length > 0 && (
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr className="text-gray-500 border-b border-gray-700">
                                                    <th className="text-left py-2">{t('goaccessStats.total')}</th>
                                                    <th className="text-right py-2">{t('goaccessStats.hits')}</th>
                                                    <th className="text-right py-2">{t('goaccessStats.visitors')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {statusWithVisitors.slice(0, 10).map((item) => (
                                                    <tr key={item.key} className="border-b border-gray-800/50">
                                                        <td className="py-1.5 text-gray-300">{item.key}</td>
                                                        <td className="py-1.5 text-right text-white">{item.count}</td>
                                                        <td className="py-1.5 text-right text-emerald-400">{item.uniqueVisitors}</td>
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
                                        title={t('goaccessStats.httpStatusDistribution')}
                                        items={distStatus}
                                        labelMinWidth="4rem"
                                    />
                                </div>
                            )}
                        </div>

                        {/* Panel 2: HTTP Methods & Codes by domain (regrouped) */}
                        <div id="section-http-methods" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                            <SectionHeading>{t('goaccessStats.httpMethodsAndDomainPanel')}</SectionHeading>
                            <DistributionChart
                                title={t('goaccessStats.httpMethodsDistribution')}
                                items={distMethods}
                                labelMinWidth="7rem"
                            />
                            {statusByHost.length > 0 && (
                                <div className="mt-6 pt-6 border-t border-gray-800">
                                    <h4 className="text-base font-semibold text-white mb-4">
                                        {t('goaccessStats.statusByHost')}
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
                                        hitsLabel={t('goaccessStats.hits')}
                                        visitorsLabel={t('goaccessStats.visitors')}
                                        tableLayout
                                    />
                                </div>
                            )}
                        </div>

                        {/* Top 404 URLs */}
                        {notFoundUrls.length > 0 && (
                            <div id="section-top404" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading>{t('goaccessStats.top404Title')}</SectionHeading>
                                <DualBarChart
                                    data={notFoundUrls}
                                    labelWidth={500}
                                    hitsLabel={t('goaccessStats.hits')}
                                    visitorsLabel={t('goaccessStats.visitors')}
                                    tableLayout
                                />
                            </div>
                        )}

                        {/* Response Time Distribution */}
                        {responseTimeDist && (
                            <div id="section-response-time" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <SectionHeading>{t('goaccessStats.responseTimeTitle')}</SectionHeading>
                                <ResponseTimeChart
                                    avg={responseTimeDist.avg}
                                    p50={responseTimeDist.p50}
                                    p95={responseTimeDist.p95}
                                    p99={responseTimeDist.p99}
                                    max={responseTimeDist.max}
                                    buckets={responseTimeDist.buckets}
                                    noDataText={t('goaccessStats.noData')}
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
                                <SectionHeading>{t('goaccessStats.referringSites')}</SectionHeading>
                                {referringSites.length > 0 ? (
                                    <DualBarChart
                                        data={referringSites}
                                        labelWidth={500}
                                        hitsLabel={t('goaccessStats.hits')}
                                        visitorsLabel={t('goaccessStats.visitors')}
                                        tableLayout
                                    />
                                ) : (
                                    <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                                        {t('goaccessStats.noData')}
                                    </div>
                                )}
                            </div>
                            <div id="section-virtual-hosts" className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <SectionHeading>{t('goaccessStats.virtualHosts')}</SectionHeading>
                                {hostWithVisitors.length > 0 ? (
                                    <DualBarChart
                                        data={hostWithVisitors}
                                        labelWidth={500}
                                        hitsLabel={t('goaccessStats.hits')}
                                        visitorsLabel={t('goaccessStats.visitors')}
                                        tableLayout
                                    />
                                ) : (
                                    <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                                        {t('goaccessStats.noData')}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Referrer URLs (with visitors) */}
                        <div id="section-referrer-urls" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                            <SectionHeading>{t('goaccessStats.referrerUrls')}</SectionHeading>
                            {referrerWithVisitors.length > 0 ? (
                                <DualBarChart
                                    data={referrerWithVisitors}
                                    labelWidth={600}
                                    hitsLabel={t('goaccessStats.hits')}
                                    visitorsLabel={t('goaccessStats.visitors')}
                                    tableLayout
                                />
                            ) : (
                                <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                                    {t('goaccessStats.noData')}
                                </div>
                            )}
                        </div>

                        {/* Requested Files (URLs with extras) */}
                        <div id="section-requested-files" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                            <SectionHeading>{t('goaccessStats.requestedFiles')}</SectionHeading>
                            {urlsWithExtras.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-gray-500 border-b border-gray-700">
                                                <th className="text-left py-2">{t('goaccessStats.topUrls')}</th>
                                                <th className="text-right py-2">{t('goaccessStats.hits')}</th>
                                                <th className="text-right py-2">{t('goaccessStats.visitors')}</th>
                                                <th className="text-right py-2">{t('goaccessStats.txAmount')}</th>
                                                <th className="text-center py-2">{t('goaccessStats.method')}</th>
                                                <th className="text-center py-2">{t('goaccessStats.protocol')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {urlsWithExtras.slice(0, 15).map((item, idx) => (
                                                <RequestedFileTableRow
                                                    key={`${item.key}-${idx}`}
                                                    item={item}
                                                    formatBytes={formatBytes}
                                                />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                                    {t('goaccessStats.noData')}
                                </div>
                            )}
                        </div>

                        {/* Top panels: URLs and Referrers on first row (2 cols), rest below */}
                        <div id="section-top-panels" className="space-y-4 scroll-mt-24">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <TopPanel
                                    title={t('goaccessStats.topUrls')}
                                    items={topUrls}
                                    maxKeyLength={80}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge />}
                                />
                                <TopPanel
                                    title={t('goaccessStats.topReferrers')}
                                    items={topReferrers}
                                    maxKeyLength={80}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge />}
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                <TopPanel
                                    title={t('goaccessStats.topIps')}
                                    items={topIps}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge />}
                                />
                                <TopPanel
                                    title={t('goaccessStats.topStatus')}
                                    items={topStatus}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge />}
                                />
                                <TopPanel
                                    title={t('goaccessStats.topBrowsers')}
                                    items={topBrowsers}
                                    maxKeyLength={25}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge />}
                                />
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <TopPanel
                                    title={t('goaccessStats.topUserAgents')}
                                    items={topUserAgents}
                                    maxKeyLength={50}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                    sourceBadge={<SourceBadge />}
                                />
                            </div>
                        </div>
                        </>
                        )}
                    </>
                )}
            </div>

            {/* Floating nav - left side, follows scroll; on small screens: top to avoid hiding content */}
            {!isLoading && !error && (
                <div data-stats-nav-menu className="fixed left-4 top-24 lg:top-1/2 lg:-translate-y-1/2 z-[99999]">
                    <button
                        ref={navButtonRef}
                        type="button"
                        onClick={() => setNavMenuOpen((v) => !v)}
                        className="flex items-center justify-center w-12 h-12 rounded-xl bg-[#0f0f0f] border border-gray-700/80 shadow-xl text-emerald-400 hover:bg-[#161616] hover:border-emerald-500/50 hover:text-emerald-300 transition-all duration-200"
                        title={t('goaccessStats.navMenuTitle')}
                        aria-expanded={navMenuOpen}
                    >
                        <List size={22} />
                    </button>
                    {navMenuOpen && navMenuRect && createPortal(
                        <div
                            data-stats-nav-menu
                            className="fixed z-[99999] w-72 rounded-2xl border border-gray-600/80 shadow-2xl overflow-hidden"
                            style={{
                                left: navMenuRect.right + 12,
                                top: navMenuRect.top + navMenuRect.height / 2,
                                transform: 'translateY(-50%)',
                                backgroundColor: 'rgb(15, 15, 15)'
                            }}
                        >
                            <div className="px-4 py-3 border-b border-gray-700/80">
                                <h4 className="text-sm font-semibold text-white">{t('goaccessStats.navMenuTitle')}</h4>
                            </div>
                            <div className="max-h-[70vh] overflow-y-auto py-2">
                                {[
                                    { id: 'section-kpi', label: t('goaccessStats.navMenuKpi') },
                                    ...(activeTab === 'graphs' ? [
                                        { id: 'section-timeline', label: t('goaccessStats.navMenuTimeline') },
                                        ...(getCurrentBucket() === 'day' ? [{ id: 'section-heatmap', label: t('goaccessStats.navMenuHeatmap') }] : []),
                                        { id: 'section-time-dist', label: t('goaccessStats.navMenuTimeDist') },
                                        { id: 'section-unique-visitors', label: t('goaccessStats.navMenuUniqueVisitors') },
                                        ...(trimmedTimeseries.length > 0 && getCurrentBucket() !== 'day' ? [{ id: 'section-peak-hours', label: t('goaccessStats.navMenuPeakHours') }] : []),
                                        ...(trimmedTimeseries.length > 0 ? [{ id: 'section-hour-day', label: t('goaccessStats.navMenuHourDay') }] : []),
                                        ...(trimmedTimeseries.length > 0 ? [{ id: 'section-status-trends', label: t('goaccessStats.navMenuStatusTrends') }] : []),
                                        ...(trimmedTimeseries.some((b) => (b.totalBytes ?? 0) > 0) ? [{ id: 'section-bandwidth', label: t('goaccessStats.navMenuBandwidth') }] : [])
                                    ] : []),
                                    ...(activeTab === 'http' ? [
                                        ...(botVsHuman && (botVsHuman.bots > 0 || botVsHuman.humans > 0) ? [{ id: 'section-bot-detection', label: t('goaccessStats.navMenuBotDetection') }] : []),
                                        { id: 'section-http-codes', label: t('goaccessStats.navMenuHttpCodes') },
                                        { id: 'section-http-methods', label: t('goaccessStats.navMenuHttpMethods') },
                                        ...(notFoundUrls.length > 0 ? [{ id: 'section-top404', label: t('goaccessStats.navMenuTop404') }] : []),
                                        ...(responseTimeDist ? [{ id: 'section-response-time', label: t('goaccessStats.navMenuResponseTime') }] : [])
                                    ] : []),
                                    ...(activeTab === 'tops' ? [
                                        { id: 'section-referring', label: t('goaccessStats.navMenuReferringSites') },
                                        { id: 'section-referrer-urls', label: t('goaccessStats.navMenuReferrerUrls') },
                                        { id: 'section-requested-files', label: t('goaccessStats.navMenuRequestedFiles') },
                                        { id: 'section-top-panels', label: t('goaccessStats.navMenuTopPanels') }
                                    ] : [])
                                ].map(({ id, label }) => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => scrollToSection(id)}
                                        className="w-full px-4 py-2.5 text-left text-sm text-gray-300 hover:bg-emerald-500/15 hover:text-emerald-400 transition-colors flex items-center gap-2"
                                    >
                                        <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0" />
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>,
                        document.body
                    )}
                </div>
            )}
        </div>
    );
};
