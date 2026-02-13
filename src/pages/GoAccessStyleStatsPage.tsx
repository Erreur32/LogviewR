/**
 * GoAccessStyleStatsPage - LogviewR
 *
 * Full-screen log analytics page inspired by GoAccess for Nginx Proxy Manager.
 * Displays: KPI cards, timeline histogram, top panels (URLs, IPs, status, UA, referrers),
 * and method/status distribution charts.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
    ChevronLeft,
    Activity,
    Globe,
    AlertTriangle,
    ServerCrash,
    HardDrive,
    FileText,
    RefreshCw,
    BarChart2,
    Info
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

export const GoAccessStyleStatsPage: React.FC<GoAccessStyleStatsPageProps> = ({ onBack }) => {
    const { t, i18n } = useTranslation();
    const { plugins } = usePluginStore();

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
    const [timeseriesDay, setTimeseriesDay] = useState<AnalyticsTimeseriesBucket[]>([]);
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
            setTimeseriesDay([]);
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
            const [resHour, resDay] = await Promise.all([
                api.get<{
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
                ),
                api.get<{ timeseries: { buckets: AnalyticsTimeseriesBucket[] } }>(
                    `/api/log-viewer/analytics?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}&bucket=day&topLimit=15${pluginParam}${fileScopeParam}${compressedParam}`
                )
            ]);

            const res = resHour;
            if (res.success && res.result) {
                setOverview(res.result.overview);
                setTimeseries(res.result.timeseries?.buckets ?? []);
                setTimeseriesDay(resDay.success && resDay.result ? (resDay.result.timeseries?.buckets ?? []) : []);
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
                setTimeseriesDay([]);
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
            setTimeseriesDay([]);
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

    const getPluginLabel = (id: string): string => {
        const names: Record<string, string> = {
            all: t('goaccessStats.pluginAll'),
            npm: 'NPM',
            apache: 'Apache'
        };
        return names[id] || id;
    };

    const formatTsLabel = useCallback((raw: string, bucket: 'minute' | 'hour' | 'day') => {
        try {
            const d = new Date(raw);
            if (isNaN(d.getTime())) return raw;
            const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
            if (bucket === 'minute') {
                return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
            }
            if (bucket === 'hour') {
                return d.toLocaleTimeString(locale, { hour: '2-digit' }) + 'h';
            }
            return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
        } catch {
            return raw;
        }
    }, [i18n.language]);

    const getCurrentBucket = (): 'minute' | 'hour' | 'day' => {
        if (timeRange === '1h') return 'minute';
        if (timeRange === '24h') return 'hour';
        return 'day';
    };

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

    const TopPanel: React.FC<{
        title: string;
        items: AnalyticsTopItem[];
        maxKeyLength?: number;
        showBar?: boolean;
    }> = ({ title, items, maxKeyLength = 40, showBar = true }) => {
        const maxPct = Math.max(...items.map((i) => i.percent ?? 0), 1);
        return (
            <div className="bg-[#0a0a0a] rounded-lg border border-gray-800 overflow-hidden">
                <h4 className="px-4 py-2 text-sm font-semibold text-gray-300 border-b border-gray-800 bg-[#0f0f0f]">
                    {title}
                </h4>
                <div className="max-h-56 overflow-y-auto">
                    {items.length === 0 ? (
                        <div className="px-4 py-6 text-sm text-gray-500 text-center">
                            {t('goaccessStats.noData')}
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-800/50">
                            {items.map((item, idx) => (
                                <li
                                    key={`${item.key}-${idx}`}
                                    className="px-4 py-2 hover:bg-[#121212]"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span
                                            className="text-sm text-gray-300 truncate flex-1 min-w-0"
                                            title={item.key}
                                        >
                                            {item.key.length > maxKeyLength
                                                ? item.key.slice(0, maxKeyLength) + '…'
                                                : item.key}
                                        </span>
                                        <span className="text-sm font-medium text-white shrink-0">
                                            {item.count}
                                            {item.percent != null && (
                                                <span className="text-gray-500 ml-1">
                                                    ({item.percent}%)
                                                </span>
                                            )}
                                        </span>
                                    </div>
                                    {showBar && item.percent != null && (
                                        <div className="mt-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-500/70 rounded-full transition-all"
                                                style={{
                                                    width: `${(item.percent / maxPct) * 100}%`
                                                }}
                                            />
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        );
    };

    const getStatusColor = (key: string): string => {
        if (/^2\d{2}$/.test(key)) return '#10b981';
        if (/^3\d{2}$/.test(key)) return '#3b82f6';
        if (/^4\d{2}$/.test(key)) return '#f59e0b';
        if (/^5\d{2}$/.test(key)) return '#ef4444';
        return '#6b7280';
    };

    const DistributionChart: React.FC<{
        title: string;
        items: AnalyticsDistribution[];
        colorByKey?: (key: string) => string;
    }> = ({ title, items, colorByKey }) => {
        const maxCount = Math.max(...items.map((i) => i.count), 1);
        const getColor = (key: string) => {
            if (colorByKey) return colorByKey(key);
            if (/^2\d{2}$/.test(key)) return '#10b981';
            if (/^3\d{2}$/.test(key)) return '#3b82f6';
            if (/^4\d{2}$/.test(key)) return '#f59e0b';
            if (/^5\d{2}$/.test(key)) return '#ef4444';
            return '#6b7280';
        };
        return (
            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                <h3 className="text-lg font-semibold text-white mb-4">{title}</h3>
                {items.length === 0 ? (
                    <div className="h-32 flex items-center justify-center text-gray-500 text-sm">
                        {t('goaccessStats.noData')}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {items.slice(0, 12).map((item) => (
                            <div key={item.key} className="flex items-center gap-3">
                                <span className="text-sm text-gray-400 w-16 shrink-0">{item.key}</span>
                                <div className="flex-1 h-6 bg-gray-800 rounded overflow-hidden">
                                    <div
                                        className="h-full rounded transition-all"
                                        style={{
                                            width: `${(item.count / maxCount) * 100}%`,
                                            backgroundColor: getColor(item.key)
                                        }}
                                    />
                                </div>
                                <span className="text-sm font-medium text-white w-16 text-right">
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
        <div className="min-h-screen bg-[#050505] text-gray-300">
            <header className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-sm border-b border-gray-800">
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

                        <div className="flex flex-wrap items-center gap-2">
                            <select
                                value={pluginId}
                                onChange={(e) => setPluginId(e.target.value)}
                                className="bg-[#121212] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500"
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
                            <select
                                value={timeRange}
                                onChange={(e) => setTimeRange(e.target.value as typeof timeRange)}
                                className="bg-[#121212] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                                title={t('goaccessStats.timeRange')}
                            >
                                <option value="1h">{t('goaccessStats.timeRange1h')}</option>
                                <option value="24h">{t('goaccessStats.timeRange24h')}</option>
                                <option value="7d">{t('goaccessStats.timeRange7d')}</option>
                                <option value="30d">{t('goaccessStats.timeRange30d')}</option>
                                <option value="custom">{t('goaccessStats.timeRangeCustom')}</option>
                            </select>
                            {timeRange === 'custom' && (
                                <>
                                    <input
                                        type="datetime-local"
                                        value={customFrom}
                                        onChange={(e) => setCustomFrom(e.target.value)}
                                        className="bg-[#121212] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                                    />
                                    <span className="text-gray-500">→</span>
                                    <input
                                        type="datetime-local"
                                        value={customTo}
                                        onChange={(e) => setCustomTo(e.target.value)}
                                        className="bg-[#121212] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                                    />
                                </>
                            )}
                            <select
                                value={fileScope}
                                onChange={(e) => setFileScope(e.target.value as 'latest' | 'all')}
                                className="bg-[#121212] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                                title={fileScope === 'latest' ? t('goaccessStats.fileScopeLatestTip') : t('goaccessStats.fileScopeAllTip')}
                            >
                                <option value="latest">{t('goaccessStats.fileScopeLatest')}</option>
                                <option value="all">{t('goaccessStats.fileScopeAll')}</option>
                            </select>
                            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer" title={t('goaccessStats.includeCompressedTip')}>
                                <input
                                    type="checkbox"
                                    checked={includeCompressed}
                                    onChange={(e) => setIncludeCompressed(e.target.checked)}
                                />
                                {t('goaccessStats.includeCompressed')}
                            </label>
                            <button
                                onClick={fetchAnalytics}
                                disabled={isLoading}
                                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors"
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
                        {/* Help section - understand the numbers */}
                        <div className="bg-[#0f0f0f] rounded-xl border border-gray-800 p-4 flex items-start gap-3">
                            <Info size={20} className="text-emerald-500 shrink-0 mt-0.5" />
                            <div>
                                <h4 className="text-sm font-semibold text-white mb-1">
                                    {t('goaccessStats.helpSectionTitle')}
                                </h4>
                                <p className="text-sm text-gray-400">
                                    {t('goaccessStats.helpSectionDesc')}
                                </p>
                            </div>
                        </div>

                        {/* KPI row */}
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
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

                        {/* Stats KPI (extended overview) */}
                        {overview && (
                            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <h3 className="text-lg font-semibold text-white mb-4">
                                    {t('goaccessStats.statsKpi')}
                                </h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                                    <div title={t('goaccessStats.tipTotalRequests')}>
                                        <span className="text-gray-500">{t('goaccessStats.totalRequests')}</span>
                                        <div className="font-semibold text-white">{overview.totalRequests}</div>
                                    </div>
                                    <div title={t('goaccessStats.tipValidRequests')}>
                                        <span className="text-gray-500">{t('goaccessStats.validRequests')}</span>
                                        <div className="font-semibold text-emerald-400">{overview.validRequests ?? 0}</div>
                                    </div>
                                    <div title={t('goaccessStats.tipFailedRequests')}>
                                        <span className="text-gray-500">{t('goaccessStats.failedRequests')}</span>
                                        <div className="font-semibold text-red-400">{overview.failedRequests ?? 0}</div>
                                    </div>
                                    <div title={t('goaccessStats.tipUniqueVisitors')}>
                                        <span className="text-gray-500">{t('goaccessStats.uniqueVisitors')}</span>
                                        <div className="font-semibold text-white">{overview.uniqueIps}</div>
                                    </div>
                                    <div title={t('goaccessStats.tipNotFound')}>
                                        <span className="text-gray-500">{t('goaccessStats.notFound')}</span>
                                        <div className="font-semibold text-amber-400">{overview.notFound ?? 0}</div>
                                    </div>
                                    <div title={t('goaccessStats.tipStaticFiles')}>
                                        <span className="text-gray-500">{t('goaccessStats.staticFiles')}</span>
                                        <div className="font-semibold text-white">{overview.staticFiles ?? 0}</div>
                                    </div>
                                    <div title={t('goaccessStats.tipTotalBytes')}>
                                        <span className="text-gray-500">{t('goaccessStats.totalBytes')}</span>
                                        <div className="font-semibold text-purple-300">
                                            {formatBytes(overview.totalBytes)}
                                        </div>
                                    </div>
                                    <div title={t('goaccessStats.tipFilesAnalyzed')}>
                                        <span className="text-gray-500">{t('goaccessStats.filesAnalyzed')}</span>
                                        <div className="font-semibold text-cyan-300">{overview.filesAnalyzed}</div>
                                    </div>
                                    <div className="col-span-2">
                                        <span className="text-gray-500">{t('goaccessStats.dateRange')}</span>
                                        <div className="font-mono text-xs text-gray-300 truncate">
                                            {formatDateRange(overview.dateFrom, overview.dateTo)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Timeline - Requêtes dans le temps (bar/curve + date/time axis) */}
                        <div className="bg-[#121212] rounded-xl border border-gray-800 p-6 w-full">
                            <h3 className="text-lg font-semibold text-white mb-4">
                                {t('goaccessStats.requestsOverTime')}
                            </h3>
                            {timeseries.length > 0 ? (
                                <div className="w-full min-w-0">
                                    <TimelineChart
                                        data={timeseries.map((b) => ({ label: b.label, count: b.count }))}
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
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <h3 className="text-lg font-semibold text-white mb-4">
                                    {t('goaccessStats.timeDistribution')}
                                </h3>
                                {timeseries.length > 0 ? (
                                    <DualLineChart
                                        data={timeseries.map((b) => ({
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
                            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <h3 className="text-lg font-semibold text-white mb-4">
                                    {t('goaccessStats.uniqueVisitorsChart')}
                                </h3>
                                {timeseriesDay.length > 0 ? (
                                    <DualLineChart
                                        data={timeseriesDay.map((b) => ({
                                            label: b.label,
                                            count: b.count,
                                            uniqueVisitors: b.uniqueVisitors ?? 0
                                        }))}
                                        requestsLabel={t('goaccessStats.hits')}
                                        visitorsLabel={t('goaccessStats.visitors')}
                                        height={140}
                                        formatLabel={(l) => formatTsLabel(l, 'day')}
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
                        <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
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
                            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
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
                                    maxKeyLength={45}
                                    hitsLabel={t('goaccessStats.hits')}
                                    visitorsLabel={t('goaccessStats.visitors')}
                                    tableLayout
                                />
                            </div>
                        )}

                        {/* Referring Sites & Virtual Hosts */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <h3 className="text-lg font-semibold text-white mb-4">
                                    {t('goaccessStats.referringSites')}
                                </h3>
                                {referringSites.length > 0 ? (
                                    <DualBarChart
                                        data={referringSites}
                                        maxKeyLength={35}
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
                            <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                                <h3 className="text-lg font-semibold text-white mb-4">
                                    {t('goaccessStats.virtualHosts')}
                                </h3>
                                {hostWithVisitors.length > 0 ? (
                                    <DualBarChart
                                        data={hostWithVisitors}
                                        maxKeyLength={35}
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
                        <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
                            <h3 className="text-lg font-semibold text-white mb-4">
                                {t('goaccessStats.referrerUrls')}
                            </h3>
                            {referrerWithVisitors.length > 0 ? (
                                <DualBarChart
                                    data={referrerWithVisitors}
                                    maxKeyLength={50}
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
                        <div className="bg-[#121212] rounded-xl border border-gray-800 p-6">
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
                                                <tr key={`${item.key}-${idx}`} className="border-b border-gray-800/50">
                                                    <td className="py-1.5 text-gray-300 truncate max-w-[200px]" title={item.key}>
                                                        {item.key}
                                                    </td>
                                                    <td className="py-1.5 text-right text-white">{item.count}</td>
                                                    <td className="py-1.5 text-right text-emerald-400">{item.uniqueVisitors}</td>
                                                    <td className="py-1.5 text-right text-purple-300">{formatBytes(item.txAmount ?? 0)}</td>
                                                    <td className="py-1.5 text-center text-gray-400">{item.method ?? '-'}</td>
                                                    <td className="py-1.5 text-center text-gray-400">{item.protocol ?? '-'}</td>
                                                </tr>
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
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <DistributionChart
                                title={t('goaccessStats.httpStatusDistribution')}
                                items={distStatus}
                            />
                            <DistributionChart
                                title={t('goaccessStats.httpMethodsDistribution')}
                                items={distMethods}
                            />
                        </div>

                        {/* Top panels grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                            <TopPanel title={t('goaccessStats.topUrls')} items={topUrls} />
                            <TopPanel title={t('goaccessStats.topIps')} items={topIps} />
                            <TopPanel title={t('goaccessStats.topStatus')} items={topStatus} />
                            <TopPanel
                                title={t('goaccessStats.topBrowsers')}
                                items={topBrowsers}
                                maxKeyLength={25}
                            />
                            <TopPanel
                                title={t('goaccessStats.topUserAgents')}
                                items={topUserAgents}
                                maxKeyLength={35}
                            />
                            <TopPanel
                                title={t('goaccessStats.topReferrers')}
                                items={topReferrers}
                                maxKeyLength={35}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
