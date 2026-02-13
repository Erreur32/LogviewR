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
    Info,
    Maximize2,
    Minimize2,
    Archive,
    List,
    X
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { TimelineChart } from '../components/widgets/TimelineChart';
import { DualLineChart } from '../components/widgets/DualLineChart';
import { DualBarChart } from '../components/widgets/DualBarChart';
import type {
    AnalyticsOverview,
    AnalyticsTimeseriesBucket,
    AnalyticsTopItem,
    AnalyticsDistribution,
    AnalyticsDistributionWithVisitors,
    AnalyticsTopItemWithVisitors,
    AnalyticsTopUrlItem,
    AnalyticsStatusByHostItem
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

/** localStorage key for help section visibility (used when not authenticated or API unavailable) */
const STATS_HELP_SECTION_STORAGE_KEY = 'logviewr_stats_help_section_visible';

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
    /** Display items in 2 columns (e.g. for User-Agents). */
    twoColumns?: boolean;
}> = ({ title, items, maxKeyLength = 40, showBar = true, maxVisibleWithoutScroll, scrollWhenCollapsed = true, twoColumns = false }) => {
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
                <h4 className="truncate min-w-0">{title}</h4>
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

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    /** Help section "Comprendre les chiffres": persisted in localStorage and DB; when hidden, a small icon is shown to expand again. */
    const [helpSectionVisible, setHelpSectionVisible] = useState(() => {
        if (typeof window === 'undefined') return true;
        const stored = localStorage.getItem(STATS_HELP_SECTION_STORAGE_KEY);
        return stored !== 'false';
    });

    /** Load help section preference on mount: from API if authenticated (overrides localStorage), else keep localStorage value. */
    useEffect(() => {
        const loadPreference = async () => {
            if (token) {
                try {
                    const res = await api.get<{ statsHelpSectionVisible: boolean }>('/api/settings/stats-ui');
                    if (res.success && res.result) {
                        setHelpSectionVisible(res.result.statsHelpSectionVisible);
                        return;
                    }
                } catch {
                    /* fallback to localStorage */
                }
            }
            const stored = localStorage.getItem(STATS_HELP_SECTION_STORAGE_KEY);
            if (stored === 'false') setHelpSectionVisible(false);
        };
        loadPreference();
    }, [token]);

    /** Persist help section visibility: localStorage always, API if authenticated. */
    const persistHelpSectionVisible = useCallback((visible: boolean) => {
        localStorage.setItem(STATS_HELP_SECTION_STORAGE_KEY, String(visible));
        if (token) {
            api.post('/api/settings/stats-ui', { statsHelpSectionVisible: visible }).catch(() => {});
        }
    }, [token]);

    /** Stats KPI block: collapsible, visible by default. */
    const [statsKpiVisible, setStatsKpiVisible] = useState(true);
    const [kpiModalOpen, setKpiModalOpen] = useState(false);
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
        } finally {
            setIsLoading(false);
        }
    }, [pluginId, enabledLogPlugins, timeRange, customFrom, customTo, fileScope, includeCompressed, t]);

    useEffect(() => {
        fetchAnalytics();
    }, [fetchAnalytics]);

    useEffect(() => {
        if (!kpiModalOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setKpiModalOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [kpiModalOpen]);

    const getPluginLabel = (id: string): string => {
        const names: Record<string, string> = {
            all: t('goaccessStats.pluginAll'),
            npm: 'NPM',
            apache: 'Apache'
        };
        return names[id] || id;
    };

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
                        {/* Help section - understand the numbers: visible by default, click on frame to hide; when hidden, show small icon to expand */}
                        {helpSectionVisible ? (
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                    setHelpSectionVisible(false);
                                    persistHelpSectionVisible(false);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        setHelpSectionVisible(false);
                                        persistHelpSectionVisible(false);
                                    }
                                }}
                                className="bg-[#0f0f0f] rounded-xl border border-gray-800 p-4 flex items-start gap-3 cursor-pointer hover:border-gray-600 transition-colors"
                                title={t('goaccessStats.helpSectionHide')}
                            >
                                <Info size={20} className="text-emerald-500 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-sm font-semibold text-white mb-1">
                                        {t('goaccessStats.helpSectionTitle')}
                                    </h4>
                                    <p className="text-sm text-gray-400">
                                        {t('goaccessStats.helpSectionDesc')}
                                    </p>
                                </div>
                                <ChevronUp size={18} className="text-gray-500 shrink-0 mt-0.5" aria-hidden />
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    setHelpSectionVisible(true);
                                    persistHelpSectionVisible(true);
                                }}
                                className="flex items-center justify-center w-10 h-10 rounded-xl border border-gray-800 bg-[#0f0f0f] text-emerald-500 hover:border-gray-600 hover:bg-[#141414] transition-colors"
                                title={t('goaccessStats.helpSectionShow')}
                            >
                                <Info size={20} />
                            </button>
                        )}

                        {/* KPI row */}
                        <div id="section-kpi" className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 scroll-mt-24">
                            <div
                                className="bg-[#121212] rounded-xl border border-gray-800 p-4 group relative"
                                title={t('goaccessStats.tipTotalRequests')}
                            >
                                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                                    <Activity size={16} className="text-emerald-400" />
                                    {t('goaccessStats.totalRequests')}
                                    <Info size={12} className="text-gray-600 group-hover:text-gray-400" />
                                </div>
                                <div className="text-2xl font-bold text-white">
                                    {overview?.totalRequests ?? 0}
                                </div>
                            </div>
                            <div
                                className="bg-[#121212] rounded-xl border border-gray-800 p-4 group relative"
                                title={t('goaccessStats.tipUniqueVisitors')}
                            >
                                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                                    <Globe size={16} className="text-blue-400" />
                                    {t('goaccessStats.uniqueVisitors')}
                                    <Info size={12} className="text-gray-600 group-hover:text-gray-400" />
                                </div>
                                <div className="text-2xl font-bold text-white">
                                    {overview?.uniqueIps ?? 0}
                                </div>
                            </div>
                            <div
                                className="bg-[#121212] rounded-xl border border-gray-800 p-4 group relative"
                                title={t('goaccessStats.tipStatus4xx')}
                            >
                                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                                    <AlertTriangle size={16} className="text-amber-400" />
                                    {t('goaccessStats.status4xx')}
                                    <Info size={12} className="text-gray-600 group-hover:text-gray-400" />
                                </div>
                                <div className="text-2xl font-bold text-amber-400">
                                    {overview?.status4xx ?? 0}
                                </div>
                            </div>
                            <div
                                className="bg-[#121212] rounded-xl border border-gray-800 p-4 group relative"
                                title={t('goaccessStats.tipStatus5xx')}
                            >
                                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                                    <ServerCrash size={16} className="text-red-400" />
                                    {t('goaccessStats.status5xx')}
                                    <Info size={12} className="text-gray-600 group-hover:text-gray-400" />
                                </div>
                                <div className="text-2xl font-bold text-red-400">
                                    {overview?.status5xx ?? 0}
                                </div>
                            </div>
                            <div
                                className="bg-[#121212] rounded-xl border border-gray-800 p-4 group relative"
                                title={t('goaccessStats.tipTotalBytes')}
                            >
                                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                                    <HardDrive size={16} className="text-purple-400" />
                                    {t('goaccessStats.totalBytes')}
                                    <Info size={12} className="text-gray-600 group-hover:text-gray-400" />
                                </div>
                                <div className="text-2xl font-bold text-purple-300">
                                    {overview ? formatBytes(overview.totalBytes) : '0 B'}
                                </div>
                            </div>
                            <div
                                className="bg-[#121212] rounded-xl border border-gray-800 p-4 group relative"
                                title={t('goaccessStats.tipFilesAnalyzed')}
                            >
                                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                                    <FileText size={16} className="text-cyan-400" />
                                    {t('goaccessStats.filesAnalyzed')}
                                    <Info size={12} className="text-gray-600 group-hover:text-gray-400" />
                                </div>
                                <div className="text-2xl font-bold text-cyan-300">
                                    {overview?.filesAnalyzed ?? 0}
                                </div>
                            </div>
                        </div>

                        {/* Stats KPI (extended overview) - collapsible with chevron */}
                        {overview && (
                            statsKpiVisible ? (
                                <div className="bg-[#121212]/90 rounded-xl border border-gray-800 overflow-hidden backdrop-blur-sm">
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => setStatsKpiVisible(false)}
                                        onKeyDown={(e) => e.key === 'Enter' && setStatsKpiVisible(false)}
                                        className="flex items-center justify-between px-6 py-4 cursor-pointer hover:bg-[#1a1a1a]/80 transition-colors"
                                        title={t('goaccessStats.statsKpiHide')}
                                    >
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-lg font-semibold text-white">
                                                {t('goaccessStats.statsKpi')}
                                            </h3>
                                            <button
                                                type="button"
                                                onClick={(e) => { e.stopPropagation(); setKpiModalOpen(true); }}
                                                className="p-1 rounded hover:bg-gray-700/50 text-gray-400 hover:text-emerald-400 transition-colors"
                                                title={t('goaccessStats.kpiModalTitle')}
                                                aria-label={t('goaccessStats.kpiModalTitle')}
                                            >
                                                <Info size={18} />
                                            </button>
                                        </div>
                                        <ChevronUp size={20} className="text-gray-500 shrink-0" aria-hidden />
                                    </div>
                                    <div className="px-6 pb-6 pt-0">
                                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 text-sm">
                                            <div className="p-3 rounded-lg bg-[#0f0f0f]/80 border border-gray-800/60" title={t('goaccessStats.tipTotalRequests')}>
                                                <div className="flex items-center gap-2 text-gray-500 mb-1">
                                                    <Activity size={14} className="text-emerald-400" />
                                                    {t('goaccessStats.totalRequests')}
                                                </div>
                                                <div className="font-bold text-white text-lg">{overview.totalRequests}</div>
                                            </div>
                                            <div className="p-3 rounded-lg bg-[#0f0f0f]/80 border border-gray-800/60" title={t('goaccessStats.tipValidRequests')}>
                                                <div className="flex items-center gap-2 text-gray-500 mb-1">
                                                    <Activity size={14} className="text-emerald-500" />
                                                    {t('goaccessStats.validRequests')}
                                                </div>
                                                <div className="font-bold text-emerald-400 text-lg">{overview.validRequests ?? 0}</div>
                                            </div>
                                            <div className="p-3 rounded-lg bg-[#0f0f0f]/80 border border-gray-800/60" title={t('goaccessStats.tipFailedRequests')}>
                                                <div className="flex items-center gap-2 text-gray-500 mb-1">
                                                    <AlertTriangle size={14} className="text-red-400" />
                                                    {t('goaccessStats.failedRequests')}
                                                </div>
                                                <div className="font-bold text-red-400 text-lg">{overview.failedRequests ?? 0}</div>
                                            </div>
                                            <div className="p-3 rounded-lg bg-[#0f0f0f]/80 border border-gray-800/60" title={t('goaccessStats.tipUniqueVisitors')}>
                                                <div className="flex items-center gap-2 text-gray-500 mb-1">
                                                    <Globe size={14} className="text-blue-400" />
                                                    {t('goaccessStats.uniqueVisitors')}
                                                </div>
                                                <div className="font-bold text-white text-lg">{overview.uniqueIps}</div>
                                            </div>
                                            <div className="p-3 rounded-lg bg-[#0f0f0f]/80 border border-gray-800/60" title={t('goaccessStats.tipNotFound')}>
                                                <div className="flex items-center gap-2 text-gray-500 mb-1">
                                                    <AlertTriangle size={14} className="text-amber-400" />
                                                    {t('goaccessStats.notFound')}
                                                </div>
                                                <div className="font-bold text-amber-400 text-lg">{overview.notFound ?? 0}</div>
                                            </div>
                                            <div className="p-3 rounded-lg bg-[#0f0f0f]/80 border border-gray-800/60" title={t('goaccessStats.tipStaticFiles')}>
                                                <div className="flex items-center gap-2 text-gray-500 mb-1">
                                                    <FileText size={14} className="text-cyan-400" />
                                                    {t('goaccessStats.staticFiles')}
                                                </div>
                                                <div className="font-bold text-cyan-300 text-lg">{overview.staticFiles ?? 0}</div>
                                            </div>
                                            <div className="p-3 rounded-lg bg-[#0f0f0f]/80 border border-gray-800/60" title={t('goaccessStats.tipTotalBytes')}>
                                                <div className="flex items-center gap-2 text-gray-500 mb-1">
                                                    <HardDrive size={14} className="text-purple-400" />
                                                    {t('goaccessStats.totalBytes')}
                                                </div>
                                                <div className="font-bold text-purple-300 text-lg">{formatBytes(overview.totalBytes)}</div>
                                            </div>
                                            <div className="p-3 rounded-lg bg-[#0f0f0f]/80 border border-gray-800/60" title={t('goaccessStats.tipFilesAnalyzed')}>
                                                <div className="flex items-center gap-2 text-gray-500 mb-1">
                                                    <FileText size={14} className="text-cyan-500" />
                                                    {t('goaccessStats.filesAnalyzed')}
                                                </div>
                                                <div className="font-bold text-cyan-300 text-lg">{overview.filesAnalyzed}</div>
                                            </div>
                                            <div className="p-3 rounded-lg bg-[#0f0f0f]/80 border border-gray-800/60 col-span-2 lg:col-span-1">
                                                <div className="flex items-center gap-2 text-gray-500 mb-1">
                                                    <Activity size={14} className="text-gray-400" />
                                                    {t('goaccessStats.dateRange')}
                                                </div>
                                                <div className="font-mono text-xs text-gray-300 truncate">
                                                    {formatDateRange(overview.dateFrom, overview.dateTo)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setStatsKpiVisible(true)}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-800 bg-[#121212]/90 text-gray-400 hover:border-gray-600 hover:bg-[#1a1a1a] transition-colors backdrop-blur-sm"
                                    title={t('goaccessStats.statsKpiShow')}
                                >
                                    <ChevronDown size={18} />
                                    <span className="text-sm font-medium">{t('goaccessStats.statsKpi')}</span>
                                </button>
                            )
                        )}

                        {/* KPI explanatory modal */}
                        {kpiModalOpen && createPortal(
                            <div
                                className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                                onClick={() => setKpiModalOpen(false)}
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="kpi-modal-title"
                            >
                                <div
                                    className="bg-[#121212] border border-gray-700 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
                                        <h2 id="kpi-modal-title" className="text-lg font-semibold text-white flex items-center gap-2">
                                            <BarChart2 size={22} className="text-emerald-400" />
                                            {t('goaccessStats.kpiModalTitle')}
                                        </h2>
                                        <button
                                            type="button"
                                            onClick={() => setKpiModalOpen(false)}
                                            className="p-2 rounded-lg hover:bg-gray-700/50 text-gray-400 hover:text-white transition-colors"
                                            aria-label={t('goaccessStats.kpiModalClose')}
                                        >
                                            <X size={20} />
                                        </button>
                                    </div>
                                    <div className="p-6 space-y-4 text-sm text-gray-300">
                                        <p className="leading-relaxed">{t('goaccessStats.kpiModalIntro')}</p>
                                        <p className="leading-relaxed">{t('goaccessStats.kpiModalLogs')}</p>
                                        <p className="leading-relaxed">{t('goaccessStats.kpiModalUse')}</p>
                                    </div>
                                    <div className="px-6 pb-6">
                                        <button
                                            type="button"
                                            onClick={() => setKpiModalOpen(false)}
                                            className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
                                        >
                                            {t('goaccessStats.kpiModalClose')}
                                        </button>
                                    </div>
                                </div>
                            </div>,
                            document.body
                        )}

                        {/* Timeline - Requêtes dans le temps (bar/curve + date/time axis) */}
                        <div id="section-timeline" className="bg-[#121212] rounded-xl border border-gray-800 p-6 w-full scroll-mt-24">
                            <h3 className="text-lg font-semibold text-white mb-4">
                                {t('goaccessStats.requestsOverTime')}
                            </h3>
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

                        {/* Time Distribution & Unique Visitors (dual-line charts) */}
                        <div id="section-time-dist" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-24">
                            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <h3 className="text-lg font-semibold text-white mb-4">
                                    {t('goaccessStats.timeDistribution')}
                                </h3>
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
                                <h3 className="text-lg font-semibold text-white mb-4">
                                    {t('goaccessStats.uniqueVisitorsChart')}
                                </h3>
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

                        {/* HTTP Status Codes: dual bar + table min/max/avg/total */}
                        <div id="section-http-status" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                            <h3 className="text-lg font-semibold text-white mb-4">
                                {t('goaccessStats.httpStatusCodes')}
                            </h3>
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
                        </div>

                        {/* HTTP Status by Domain (host + status) */}
                        {statusByHost.length > 0 && (
                            <div id="section-status-by-host" className="bg-[#121212] rounded-xl border border-gray-800 p-6 scroll-mt-24">
                                <h3 className="text-lg font-semibold text-white mb-4">
                                    {t('goaccessStats.statusByHost')}
                                </h3>
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

                        {/* Referring Sites & Virtual Hosts */}
                        <div id="section-referring" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-24">
                            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <h3 className="text-lg font-semibold text-white mb-4">
                                    {t('goaccessStats.referringSites')}
                                </h3>
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
                                <h3 className="text-lg font-semibold text-white mb-4">
                                    {t('goaccessStats.virtualHosts')}
                                </h3>
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
                            <h3 className="text-lg font-semibold text-white mb-4">
                                {t('goaccessStats.referrerUrls')}
                            </h3>
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
                            <h3 className="text-lg font-semibold text-white mb-4">
                                {t('goaccessStats.requestedFiles')}
                            </h3>
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

                        {/* Distribution charts: HTTP Status & Methods */}
                        <div id="section-distribution" className="grid grid-cols-1 lg:grid-cols-2 gap-6 scroll-mt-24">
                            <DistributionChart
                                title={t('goaccessStats.httpStatusDistribution')}
                                items={distStatus}
                                labelMinWidth="4rem"
                            />
                            <DistributionChart
                                title={t('goaccessStats.httpMethodsDistribution')}
                                items={distMethods}
                                labelMinWidth="7rem"
                            />
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
                                />
                                <TopPanel
                                    title={t('goaccessStats.topReferrers')}
                                    items={topReferrers}
                                    maxKeyLength={80}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                <TopPanel
                                    title={t('goaccessStats.topIps')}
                                    items={topIps}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                />
                                <TopPanel
                                    title={t('goaccessStats.topStatus')}
                                    items={topStatus}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                />
                                <TopPanel
                                    title={t('goaccessStats.topBrowsers')}
                                    items={topBrowsers}
                                    maxKeyLength={25}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                />
                            </div>
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                <TopPanel
                                    title={t('goaccessStats.topUserAgents')}
                                    items={topUserAgents}
                                    maxKeyLength={50}
                                    maxVisibleWithoutScroll={5}
                                    scrollWhenCollapsed={false}
                                />
                            </div>
                        </div>
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
                                    { id: 'section-timeline', label: t('goaccessStats.navMenuTimeline') },
                                    { id: 'section-time-dist', label: t('goaccessStats.navMenuTimeDist') },
                                    { id: 'section-unique-visitors', label: t('goaccessStats.navMenuUniqueVisitors') },
                                    { id: 'section-http-status', label: t('goaccessStats.navMenuHttpStatus') },
                                    ...(statusByHost.length > 0 ? [{ id: 'section-status-by-host', label: t('goaccessStats.navMenuStatusByHost') }] : []),
                                    { id: 'section-referring', label: t('goaccessStats.navMenuReferringSites') },
                                    { id: 'section-referrer-urls', label: t('goaccessStats.navMenuReferrerUrls') },
                                    { id: 'section-requested-files', label: t('goaccessStats.navMenuRequestedFiles') },
                                    { id: 'section-distribution', label: t('goaccessStats.navMenuDistribution') },
                                    { id: 'section-top-panels', label: t('goaccessStats.navMenuTopPanels') }
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
