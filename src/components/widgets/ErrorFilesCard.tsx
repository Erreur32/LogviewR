/**
 * Error Files Card (Dashboard)
 *
 * Displays log files with the most errors (error logs only).
 * Fetches GET /api/log-viewer/error-summary and shows file name, path, error count,
 * and unique error samples grouped by severity.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, FileText, RefreshCw, ChevronDown, ChevronRight, ExternalLink, Info } from 'lucide-react';
import { api } from '../../api/client';
import { getPluginIcon } from '../../utils/pluginIcons';
import { getErrorExplanation } from '../../utils/errorExplanations';
import { formatBytes } from '../../utils/constants';

export interface UniqueErrorSample {
    message: string;
    level: string;
    count: number;
}

export interface ErrorFileSummary {
    pluginId: string;
    filePath: string;
    fileName: string;
    fileSizeBytes?: number;
    logType: string;
    errorCount: number;
    count4xx?: number;
    count5xx?: number;
    count3xx?: number;
    countErrorTag?: number;
    countWarnTag?: number;
    uniqueErrorsBySeverity: {
        error: UniqueErrorSample[];
        warn: UniqueErrorSample[];
        info: UniqueErrorSample[];
        debug: UniqueErrorSample[];
    };
    topErrors: UniqueErrorSample[];
}

/** Reported when a file could not be read or parsed (I/O or parse error). */
export interface AnalysisErrorEntry {
    pluginId: string;
    filePath: string;
    fileName: string;
    errorMessage: string;
}

export interface ErrorSummaryResult {
    enabled: boolean;
    files: ErrorFileSummary[];
    analysisErrors?: AnalysisErrorEntry[];
    fromCache?: boolean;
    cacheAgeMs?: number;
}

interface ErrorFilesCardProps {
    onOpenFile: (pluginId: string, filePath: string, logType: string) => void;
    osType?: string;
}

const SEVERITY_ORDER: ('error' | 'warn' | 'info' | 'debug')[] = ['error', 'warn', 'info', 'debug'];
const WEB_PLUGINS = ['apache', 'nginx', 'npm'];
const PLUGIN_ORDER = ['host-system', 'apache', 'npm', 'nginx'];
/** When progress list has more than this many steps, show collapsed with expand toggle (no scroll). */
const PROGRESS_COLLAPSE_THRESHOLD = 5;

export const ErrorFilesCard: React.FC<ErrorFilesCardProps> = ({ onOpenFile, osType }) => {
    const { t } = useTranslation();
    const [data, setData] = useState<ErrorSummaryResult | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const effectRunRef = useRef(0);
    const [progressSteps, setProgressSteps] = useState<{ message: string; pluginId?: string; filePath?: string }[]>([]);
    const [progressListCollapsed, setProgressListCollapsed] = useState(true);
    const [resultsCollapsed, setResultsCollapsed] = useState(true);

    const ERROR_SUMMARY_TIMEOUT_MS = 170000; // 2m50, under proxy 3min

    const fetchSummary = useCallback(async (forceRescan = false) => {
        const isDev = import.meta.env.DEV;
        if (isDev) {
            console.log('[ErrorFilesCard] Fetching GET /api/log-viewer/error-summary...', forceRescan ? '(cache invalidated first)' : '');
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), ERROR_SUMMARY_TIMEOUT_MS);
        try {
            setIsLoading(true);
            setError(null);
            if (forceRescan) {
                await api.post('/api/log-viewer/error-summary/invalidate');
            }
            const response = await api.get<ErrorSummaryResult>('/api/log-viewer/error-summary', { signal: controller.signal });
            if (isDev) {
                console.log('[ErrorFilesCard] Response:', response?.success ? `success, files: ${(response.result?.files?.length ?? 0)}` : response);
            }
            if (response.success && response.result) {
                const res = response.result as ErrorSummaryResult;
                setData({
                enabled: res.enabled !== false,
                files: res.files ?? [],
                analysisErrors: res.analysisErrors ?? [],
                fromCache: res.fromCache,
                cacheAgeMs: res.cacheAgeMs ?? 0
            });
            } else {
                setError(response.error?.message ?? 'Failed to load error summary');
            }
        } catch (err) {
            if (isDev) {
                console.warn('[ErrorFilesCard] Request failed:', err);
            }
            const isAbort = err instanceof Error && err.name === 'AbortError';
            setError(isAbort
                ? (t('dashboard.errorSummaryTimeout') ?? 'Request timed out. Reduce check depth or file count in Settings > Analysis.')
                : (err instanceof Error ? err.message : 'Failed to load error summary'));
        } finally {
            clearTimeout(timeoutId);
            setIsLoading(false);
        }
    }, [t]);

    // Poll progress while loading so user sees which files are being scanned
    useEffect(() => {
        if (!isLoading || data !== null) return;
        setProgressSteps([]);
        const poll = () => {
            api.get<{ steps: { message: string; pluginId?: string; filePath?: string }[] }>('/api/log-viewer/error-summary/progress')
                .then((res) => {
                    if (res.success && res.result?.steps?.length) {
                        setProgressSteps(res.result.steps);
                    }
                })
                .catch(() => {});
        };
        poll();
        const intervalId = setInterval(poll, 800);
        return () => clearInterval(intervalId);
    }, [isLoading, data]);

    // Defer fetch so only the latest effect run actually fetches (avoids double GET in Strict Mode).
    useEffect(() => {
        const run = ++effectRunRef.current;
        const timeoutId = setTimeout(() => {
            if (effectRunRef.current !== run) return;
            fetchSummary();
        }, 0);
        return () => {
            effectRunRef.current = -1;
            clearTimeout(timeoutId);
        };
    }, [fetchSummary]);

    const toggleExpanded = (id: string) => {
        setExpandedId((prev) => (prev === id ? null : id));
    };

    // When scan is disabled in settings, do not show the card at all (options kept in DB).
    if (data && data.enabled === false) {
        return null;
    }

    if (isLoading && !data) {
        return (
            <div className="bg-theme-tertiary rounded-xl border border-theme-border overflow-hidden">
                <div className="p-4 border-b border-theme-border flex items-center gap-3">
                    <div className="p-2 bg-red-500/20 rounded-lg">
                        <AlertTriangle size={22} className="text-red-400" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-theme-primary">{t('dashboard.errorSummaryTitle')}</h3>
                        <p className="text-xs text-gray-500">{t('dashboard.errorSummarySubtitle')}</p>
                    </div>
                </div>
                <div className="p-8 flex flex-col items-center justify-center gap-4">
                    <RefreshCw size={28} className="animate-spin text-cyan-500 shrink-0" />
                    {progressSteps.length > 0 ? (
                        <div className="w-full rounded-lg bg-theme-primary/50 border border-theme-border p-3 text-left">
                            <p className="text-xs text-gray-500 mb-2">{t('dashboard.errorSummaryProgressTitle')}</p>
                            {(() => {
                                const showCollapse = progressSteps.length > PROGRESS_COLLAPSE_THRESHOLD;
                                const visibleSteps = showCollapse && progressListCollapsed
                                    ? progressSteps.slice(0, PROGRESS_COLLAPSE_THRESHOLD)
                                    : progressSteps;
                                const hiddenCount = progressSteps.length - visibleSteps.length;
                                return (
                                    <>
                                        <ul className="space-y-1 text-sm text-gray-300 font-mono">
                                            {visibleSteps.map((step, i) => {
                                                const m = step.message.match(/^(.*?)\s+(\([\d.]+\s*(?:MB|KB|B)(?:, \d+ erreurs)?\))$/);
                                                return (
                                                    <li key={i} className="truncate" title={step.filePath ?? step.message}>
                                                        {m ? (
                                                            <> {m[1]} <span className="text-yellow-400">{m[2]}</span></>
                                                        ) : (
                                                            step.message
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                        {showCollapse && (
                                            <button
                                                type="button"
                                                onClick={() => setProgressListCollapsed((c) => !c)}
                                                className="mt-2 flex items-center gap-1 text-xs text-cyan-500 hover:text-cyan-400"
                                            >
                                                {progressListCollapsed ? (
                                                    <>
                                                        <ChevronRight size={14} />
                                                        {t('dashboard.errorSummaryExpand')}
                                                        {hiddenCount > 0 && ` (${hiddenCount})`}
                                                    </>
                                                ) : (
                                                    <>
                                                        <ChevronDown size={14} />
                                                        {t('dashboard.errorSummaryCollapse')}
                                                    </>
                                                )}
                                            </button>
                                        )}
                                        <p className="text-xs text-gray-500 mt-2">{t('dashboard.errorSummaryProgressHint')}</p>
                            <p className="text-xs text-cyan-400/80 mt-1">{t('dashboard.errorSummaryCountWhenDone')}</p>
                                    </>
                                );
                            })()}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400 text-center animate-pulse">
                            {t('dashboard.errorSummaryLoadingStep1')}
                        </p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-theme-tertiary rounded-xl border border-theme-border overflow-hidden flex flex-col">
            <div className="p-4 border-b border-theme-border flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-500/20 rounded-lg">
                        <AlertTriangle size={22} className="text-red-400" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-theme-primary">{t('dashboard.errorSummaryTitle')}</h3>
                        <p className="text-xs text-gray-500">
                            {data?.files?.length
                                ? t('dashboard.errorSummaryErrorsFound', { count: data.files.reduce((s, f) => s + f.errorCount, 0) })
                                : t('dashboard.errorSummarySubtitle')}
                            {data?.fromCache && data.cacheAgeMs != null && (
                                <span className="ml-2 text-cyan-400/90" title={t('dashboard.errorSummaryCacheHint')}>
                                    ({t('dashboard.errorSummaryFromCache', { seconds: Math.round(data.cacheAgeMs / 1000) })})
                                </span>
                            )}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => fetchSummary(true)}
                    disabled={isLoading}
                    className="p-2 rounded-lg hover:bg-theme-secondary text-gray-400 hover:text-theme-primary transition-colors disabled:opacity-50"
                    title={t('dashboard.refreshErrorSummary')}
                >
                    <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>
            <div className="p-4 flex-1 overflow-y-auto min-h-0">
                {error && (
                    <div className="mb-4 py-2 px-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                        {error}
                    </div>
                )}
                {data?.analysisErrors && data.analysisErrors.length > 0 && (
                    <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                        <p className="text-xs font-semibold text-amber-400 mb-2">{t('dashboard.analysisErrorsTitle')}</p>
                        <ul className="space-y-2">
                            {data.analysisErrors.map((ae, i) => (
                                <li key={`${ae.filePath}-${i}`} className="text-sm">
                                    <span className="font-medium text-amber-300/90">{ae.fileName}</span>
                                    <span className="text-amber-400/80 text-xs block mt-0.5" title={ae.filePath}>{ae.errorMessage}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {data?.files.length === 0 && !error && (
                    <div className="text-center py-8 text-gray-500">
                        <FileText size={40} className="mx-auto mb-3 text-gray-600" />
                        <p className="text-sm">{t('dashboard.errorSummaryEmpty')}</p>
                    </div>
                )}
                {data && data.files.length > 0 && (() => {
                    const byPlugin = new Map<string, ErrorFileSummary[]>();
                    for (const f of data.files) {
                        const list = byPlugin.get(f.pluginId) ?? [];
                        list.push(f);
                        byPlugin.set(f.pluginId, list);
                    }
                    const pluginsWithFiles = PLUGIN_ORDER.filter((id) => byPlugin.has(id));
                    return (
                        <div className="space-y-3">
                            <button
                                type="button"
                                onClick={() => setResultsCollapsed((c) => !c)}
                                className="w-full flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-theme-secondary border border-theme-border text-left"
                                aria-expanded={!resultsCollapsed}
                            >
                                <span className="text-sm font-semibold text-theme-primary flex items-center gap-2">
                                    {resultsCollapsed ? (
                                        <ChevronRight size={18} className="shrink-0" />
                                    ) : (
                                        <ChevronDown size={18} className="shrink-0" />
                                    )}
                                    {t('dashboard.errorSummaryResultsTitle')}
                                    <span className="text-gray-500 font-normal">
                                        ({t('dashboard.errorSummaryByPlugin')}: {pluginsWithFiles.map((id) => id === 'host-system' ? 'Host' : id).join(', ')})
                                    </span>
                                </span>
                                {resultsCollapsed && (
                                    <span className="text-xs text-cyan-400">
                                        {t('dashboard.errorSummaryResultsShow')}
                                    </span>
                                )}
                                {!resultsCollapsed && (
                                    <span className="text-xs text-gray-500">
                                        {t('dashboard.errorSummaryResultsHide')}
                                    </span>
                                )}
                            </button>
                            {!resultsCollapsed && (
                                <div className={`grid gap-4 ${pluginsWithFiles.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'} ${pluginsWithFiles.length >= 3 ? 'lg:grid-cols-3' : ''} ${pluginsWithFiles.length >= 4 ? 'xl:grid-cols-4' : ''}`}>
                                    {pluginsWithFiles.map((pluginId) => {
                                        const files = byPlugin.get(pluginId) ?? [];
                                        const pluginLabel = pluginId === 'host-system' ? 'Host System' : pluginId;
                                        const sum4xx = files.reduce((s, f) => s + (f.count4xx ?? 0), 0);
                                        const sum5xx = files.reduce((s, f) => s + (f.count5xx ?? 0), 0);
                                        const sumErrorTag = files.reduce((s, f) => s + (f.countErrorTag ?? 0), 0);
                                        const sumWarnTag = files.reduce((s, f) => s + (f.countWarnTag ?? 0), 0);
                                        const hasStatusBadges = pluginId === 'apache' || pluginId === 'nginx' || pluginId === 'npm';
                                        const hasLevelBadges = pluginId === 'npm' || pluginId === 'nginx' || pluginId === 'host-system';
                                        return (
                                            <div
                                                key={pluginId}
                                                className="rounded-lg border border-theme-border bg-theme-secondary overflow-hidden flex flex-col min-w-0"
                                            >
                                                <div className="p-2 border-b border-theme-border flex flex-wrap items-center gap-2 shrink-0">
                                                    <img
                                                        src={getPluginIcon(pluginId, pluginId === 'host-system' ? osType : undefined)}
                                                        alt=""
                                                        className="w-5 h-5 opacity-80"
                                                    />
                                                    <span className="text-sm font-semibold text-theme-primary capitalize">{pluginLabel}</span>
                                                    {hasStatusBadges && (sum4xx > 0 || sum5xx > 0) && (
                                                        <span className="flex items-center gap-1.5 flex-wrap">
                                                            {sum4xx > 0 && (
                                                                <span className="text-xs font-medium text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded" title={t('dashboard.badge4xx')}>
                                                                    {t('dashboard.badge4xx')}: {sum4xx}
                                                                </span>
                                                            )}
                                                            {sum5xx > 0 && (
                                                                <span className="text-xs font-medium text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded" title={t('dashboard.badge5xx')}>
                                                                    {t('dashboard.badge5xx')}: {sum5xx}
                                                                </span>
                                                            )}
                                                        </span>
                                                    )}
                                                    {hasLevelBadges && (sumErrorTag > 0 || sumWarnTag > 0) && (
                                                        <span className="flex items-center gap-1.5 flex-wrap">
                                                            {sumErrorTag > 0 && (
                                                                <span className="text-xs font-medium text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded" title={t('dashboard.badgeError')}>
                                                                    {t('dashboard.badgeError')}: {sumErrorTag}
                                                                </span>
                                                            )}
                                                            {sumWarnTag > 0 && (
                                                                <span className="text-xs font-medium text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded" title={t('dashboard.badgeWarn')}>
                                                                    {t('dashboard.badgeWarn')}: {sumWarnTag}
                                                                </span>
                                                            )}
                                                        </span>
                                                    )}
                                                    <span className="text-xs text-gray-500 ml-auto">
                                                        {t('dashboard.errorSummaryFileCount', { count: files.length })} · {files.reduce((s, f) => s + f.errorCount, 0)} {t('dashboard.errorCount')}
                                                    </span>
                                                </div>
                                                <div className="p-2 flex-1 space-y-2 overflow-y-auto min-h-0 max-h-64">
                                                    {files.map((file) => {
                                                        const rowId = `${file.pluginId}:${file.filePath}`;
                                                        const isExpanded = expandedId === rowId;
                                                        return (
                                                            <div
                                                                key={rowId}
                                                                className="rounded border border-theme-border bg-theme-primary/20 overflow-hidden"
                                                            >
                                                                <div className="flex items-center gap-2 p-2">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => toggleExpanded(rowId)}
                                                                        className="p-0.5 rounded hover:bg-theme-primary text-gray-400 hover:text-theme-primary shrink-0"
                                                                        aria-expanded={isExpanded}
                                                                    >
                                                                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                                    </button>
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-xs font-medium text-theme-primary truncate" title={file.filePath}>
                                                                            {file.fileName}
                                                                            {file.fileSizeBytes != null && (
                                                                                <span className="ml-1 text-yellow-400 font-normal">({formatBytes(file.fileSizeBytes)})</span>
                                                                            )}
                                                                        </p>
                                                                    </div>
                                                                    <span className="flex-shrink-0 text-xs font-semibold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                                                                        {file.errorCount}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => onOpenFile(file.pluginId, file.filePath, file.logType)}
                                                                        className="flex-shrink-0 p-1 rounded hover:bg-emerald-500/20 text-gray-400 hover:text-emerald-400"
                                                                        title={t('dashboard.openInLogViewer')}
                                                                    >
                                                                        <ExternalLink size={14} />
                                                                    </button>
                                                                </div>
                                                                {isExpanded && (
                                                                    <div className="border-t border-theme-border p-2 bg-theme-primary/30 space-y-2">
                                                                        <p className="text-xs font-medium text-gray-400 mb-1.5">{t('dashboard.detailsBreakdown')}</p>
                                                                        <div className="flex flex-wrap gap-2 mb-2">
                                                                            {(file.count4xx ?? 0) > 0 && (
                                                                                <span className="text-xs text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded">{t('dashboard.badge4xx')}: {file.count4xx}</span>
                                                                            )}
                                                                            {(file.count5xx ?? 0) > 0 && (
                                                                                <span className="text-xs text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded">{t('dashboard.badge5xx')}: {file.count5xx}</span>
                                                                            )}
                                                                            {(file.count3xx ?? 0) > 0 && (
                                                                                <span className="text-xs text-blue-400 bg-blue-500/20 px-1.5 py-0.5 rounded">{t('dashboard.badge3xx')}: {file.count3xx}</span>
                                                                            )}
                                                                            {(file.countErrorTag ?? 0) > 0 && (
                                                                                <span className="text-xs text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded">{t('dashboard.badgeError')}: {file.countErrorTag}</span>
                                                                            )}
                                                                            {(file.countWarnTag ?? 0) > 0 && (
                                                                                <span className="text-xs text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded">{t('dashboard.badgeWarn')}: {file.countWarnTag}</span>
                                                                            )}
                                                                        </div>
                                                                        {!SEVERITY_ORDER.some((sev) => (file.uniqueErrorsBySeverity[sev]?.length ?? 0) > 0) && (
                                                                            <p className="text-xs text-gray-500 italic">{t('dashboard.errorDetailComingSoon')}</p>
                                                                        )}
                                                                        {SEVERITY_ORDER.map((sev) => {
                                                                            const arr = file.uniqueErrorsBySeverity[sev];
                                                                            if (!arr || arr.length === 0) return null;
                                                                            const label = sev === 'error' ? 'dashboard.severityError' : sev === 'warn' ? 'dashboard.severityWarn' : sev === 'info' ? 'dashboard.severityInfo' : 'dashboard.severityDebug';
                                                                            return (
                                                                                <div key={sev}>
                                                                                    <p className="text-xs font-medium text-gray-400 mb-1">{t(label)} ({arr.length})</p>
                                                                                    <ul className="space-y-0.5">
                                                                                        {arr.slice(0, 5).map((sample, i) => {
                                                                                            const explanation = WEB_PLUGINS.includes(file.pluginId) ? getErrorExplanation(sample.message, sample.level) : null;
                                                                                            return (
                                                                                                <li
                                                                                                    key={`${sev}-${i}-${sample.message.slice(0, 40)}`}
                                                                                                    className="text-xs text-gray-300 font-mono pl-2 border-l-2 border-gray-600"
                                                                                                >
                                                                                                    <span className="flex items-start gap-1">
                                                                                                        <span className="text-gray-500 shrink-0">×{sample.count}</span>
                                                                                                        <span className="truncate flex-1" title={sample.message}>{sample.message}</span>
                                                                                                        {explanation && (
                                                                                                            <span
                                                                                                                className="shrink-0 text-blue-400 cursor-help"
                                                                                                                title={`${t('dashboard.possibleExplanation')}: ${explanation.explanation}\n${t('dashboard.howToFix')}: ${explanation.howToFix}${explanation.possibleIntrusion ? `\n${t('dashboard.suspiciousIntrusion')}` : ''}`}
                                                                                                            >
                                                                                                                <Info size={12} />
                                                                                                            </span>
                                                                                                        )}
                                                                                                    </span>
                                                                                                </li>
                                                                                            );
                                                                                        })}
                                                                                        {arr.length > 5 && (
                                                                                            <li className="text-xs text-gray-500 pl-2">+{arr.length - 5} {t('dashboard.moreErrors')}</li>
                                                                                        )}
                                                                                    </ul>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};
