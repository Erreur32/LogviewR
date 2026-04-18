/**
 * Dashboard Search Card
 *
 * Global search across all active log files from enabled plugins.
 * Supports plugin filters, case sensitivity, and regex options.
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, ExternalLink, Loader2, Globe, X } from 'lucide-react';
import { api } from '../../api/client';
import { getPluginIcon } from '../../utils/pluginIcons';

// KEEP IN SYNC with server/services/logSearchService.ts (LOG_SOURCE_PLUGINS)
const LOG_SOURCE_PLUGIN_IDS = ['host-system', 'apache', 'npm', 'nginx', 'fail2ban'] as const;

export interface LogSearchMatch {
    pluginId: string;
    filePath: string;
    fileName: string;
    logType: string;
    lineNumber: number;
    content: string;
    /** Domain/vhost extracted server-side (apache vhost, npm host). */
    domain?: string;
}

export interface LogSearchMatchCount {
    pluginId: string;
    filePath: string;
    fileName: string;
    count: number;
}

export interface LogSearchResult {
    matches: LogSearchMatch[];
    totalMatches: number;
    filesSearched: number;
    filesWithMatches: number;
    matchCountPerFile: LogSearchMatchCount[];
    matchesByPlugin: Record<string, LogSearchMatch[]>;
    pluginsSearched: string[];
}

interface DashboardSearchCardProps {
    onOpenFile: (pluginId: string, filePath: string, logType: string) => void;
    osType?: string;
    /** Only show these plugins in the filter (enabled log-source plugins). If empty, show all. */
    enabledPluginIds?: string[];
}

// Small dark toggle switch (no native checkbox styling)
const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string }> = ({ checked, onChange, label }) => (
    <label className="flex items-center gap-2 cursor-pointer select-none group">
        <div
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className={`relative w-8 h-4 rounded-full transition-colors duration-150 shrink-0 ${checked ? 'bg-cyan-500' : 'bg-gray-700 group-hover:bg-gray-600'}`}
        >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform duration-150 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </div>
        <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">{label}</span>
    </label>
);

export const DashboardSearchCard: React.FC<DashboardSearchCardProps> = ({ onOpenFile, osType, enabledPluginIds }) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [useRegex, setUseRegex] = useState(false);
    const [includeCompressed, setIncludeCompressed] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [result, setResult] = useState<LogSearchResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [optionsExpanded, setOptionsExpanded] = useState(false);
    const [resolvedOsType, setResolvedOsType] = useState<string | undefined>(osType);

    useEffect(() => {
        if (osType) { setResolvedOsType(osType); return; }
        api.get<{ type: string }>('/api/log-viewer/os-type')
            .then((res) => { if (res.success && res.result) setResolvedOsType(res.result.type); })
            .catch(() => {});
    }, [osType]);

    const hasContentToShow = optionsExpanded || result || error || isSearching;

    const pluginOrder = enabledPluginIds && enabledPluginIds.length > 0
        ? LOG_SOURCE_PLUGIN_IDS.filter((id) => enabledPluginIds.includes(id))
        : [...LOG_SOURCE_PLUGIN_IDS];

    const handleSearch = useCallback(async () => {
        if (!query.trim()) return;
        setIsSearching(true);
        setError(null);
        setResult(null);
        try {
            const res = await api.post<LogSearchResult>('/api/log-viewer/search-all', {
                query: query.trim(),
                pluginIds: selectedPlugins.length > 0 ? selectedPlugins : undefined,
                caseSensitive,
                useRegex,
                includeCompressed,
                maxResults: 100
            });
            if (res.success && res.result) {
                setResult(res.result);
            } else {
                const errMsg = (res as { error?: string | { message?: string } }).error;
                setError(typeof errMsg === 'string' ? errMsg : errMsg?.message ?? 'Search failed');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Search failed');
        } finally {
            setIsSearching(false);
        }
    }, [query, selectedPlugins, caseSensitive, useRegex, includeCompressed]);

    const togglePlugin = (pluginId: string) => {
        setSelectedPlugins((prev) =>
            prev.includes(pluginId) ? prev.filter((p) => p !== pluginId) : [...prev, pluginId]
        );
    };

    const pluginLabel = (id: string) => {
        if (id === 'host-system') return 'System';
        if (id === 'fail2ban') return 'Fail2ban';
        return id;
    };

    /** Color class for the count number only (low=green, medium=amber, high=red) */
    const getCountColor = (count: number) => {
        if (count <= 3) return 'text-emerald-400';
        if (count <= 10) return 'text-amber-400';
        return 'text-rose-400';
    };

    /** Deduplicate matches by file: keep first match per file as example */
    const getOneMatchPerFile = (matches: LogSearchMatch[]): LogSearchMatch[] => {
        const seen = new Set<string>();
        return matches.filter((m) => {
            const key = `${m.pluginId}:${m.filePath}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };

    const getCountForFile = (pluginId: string, filePath: string): number => {
        const fc = result?.matchCountPerFile?.find((f) => f.pluginId === pluginId && f.filePath === filePath);
        return fc?.count ?? 1;
    };

    return (
        <div className="bg-theme-tertiary rounded-xl border border-theme-border overflow-hidden flex flex-col">
            {/* Barre de recherche uniquement visible par défaut */}
            <div className="p-3 flex flex-col sm:flex-row gap-2 items-stretch">
                <div className="flex items-center gap-2 flex-1 bg-theme-primary border border-theme-border rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-cyan-500/50">
                    <div className="pl-3 flex items-center shrink-0 text-cyan-400">
                        <Search size={20} />
                    </div>
                    <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder={t('dashboard.searchPlaceholder')}
                        className="flex-1 min-w-0 py-2 pr-2 bg-transparent border-0 text-theme-primary placeholder-gray-500 focus:outline-none focus:ring-0"
                        disabled={isSearching}
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => { setQuery(''); setResult(null); setError(null); }}
                            className="pr-3 flex items-center shrink-0 text-gray-500 hover:text-gray-300"
                            title={t('common.clear')}
                            aria-label={t('common.clear')}
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleSearch}
                        disabled={!query.trim() || isSearching}
                        className="flex items-center justify-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
                    >
                        {isSearching ? (
                            <>
                                <Loader2 size={18} className="animate-spin" />
                                {t('dashboard.searching')}
                            </>
                        ) : (
                            <>
                                <Search size={18} />
                                {t('dashboard.searchButton')}
                            </>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={() => setOptionsExpanded((e) => !e)}
                        className="p-2 rounded-lg hover:bg-theme-secondary text-gray-400 hover:text-cyan-400 border border-theme-border"
                        title={t('dashboard.searchFilters')}
                    >
                        <Filter size={18} />
                    </button>
                </div>
            </div>

            {/* Contenu (filtres, résultats, erreur) affiché uniquement quand pertinent */}
            {hasContentToShow && (
                <div className="px-3 pb-3 pt-0 border-t border-theme-border space-y-3">
                    {optionsExpanded && (
                        <div className="pt-3 p-3 rounded-lg bg-theme-primary/50 border border-theme-border space-y-3">
                            <div>
                                <p className="text-xs font-medium text-gray-400 mb-2">{t('dashboard.searchPluginFilter')}</p>
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedPlugins([])}
                                        className={`px-2 py-1 rounded text-xs font-medium ${
                                            selectedPlugins.length === 0
                                                ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-500/50'
                                                : 'bg-theme-secondary text-gray-400 border border-theme-border hover:border-cyan-500/30'
                                        }`}
                                    >
                                        {t('dashboard.searchAllPlugins')}
                                    </button>
                                    {pluginOrder.map((id) => (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => togglePlugin(id)}
                                            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium border ${
                                                selectedPlugins.includes(id)
                                                    ? 'bg-cyan-500/30 text-cyan-300 border-cyan-500/50'
                                                    : 'bg-theme-secondary text-gray-400 border-theme-border hover:border-cyan-500/30'
                                            }`}
                                        >
                                            <img
                                                src={getPluginIcon(id, id === 'host-system' ? resolvedOsType : undefined)}
                                                alt=""
                                                className="w-3.5 h-3.5 opacity-80"
                                            />
                                            {pluginLabel(id)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-4">
                                <Toggle checked={caseSensitive} onChange={setCaseSensitive} label={t('dashboard.searchCaseSensitive')} />
                                <Toggle checked={useRegex} onChange={setUseRegex} label={t('dashboard.searchRegex')} />
                                <Toggle checked={includeCompressed} onChange={setIncludeCompressed} label={t('dashboard.searchIncludeGz')} />
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="py-2 px-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                            {error}
                        </div>
                    )}
                    {result && (
                        <div className="space-y-3 max-h-80 overflow-y-auto">
                            <p className="text-xs text-gray-500">
                                {t('dashboard.searchResultsSummary', {
                                    count: result.totalMatches,
                                    files: result.filesWithMatches ?? result.filesSearched
                                })}
                                {result.filesSearched > 0 && (
                                    <span className="ml-1 text-gray-600">
                                        ({t('dashboard.searchFilesScanned', { count: result.filesSearched })})
                                    </span>
                                )}
                            </p>
                            {result.matchCountPerFile && result.matchCountPerFile.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                    {result.matchCountPerFile.slice(0, 8).map((fc) => (
                                        <span
                                            key={`${fc.pluginId}-${fc.filePath}`}
                                            className="text-xs px-2 py-0.5 rounded bg-theme-primary border border-theme-border text-gray-400"
                                            title={fc.filePath}
                                        >
                                            {pluginLabel(fc.pluginId)} · {fc.fileName}: <span className={`font-semibold ${getCountColor(fc.count)}`}>{fc.count}</span>
                                        </span>
                                    ))}
                                    {result.matchCountPerFile.length > 8 && (
                                        <span className="text-xs text-gray-500">+{result.matchCountPerFile.length - 8}</span>
                                    )}
                                </div>
                            )}
                            <div className="space-y-3">
                                {(result.matchesByPlugin && Object.keys(result.matchesByPlugin).length > 0
                                    ? Object.entries(result.matchesByPlugin)
                                    : result.matches.length > 0
                                        ? [['', result.matches] as [string, LogSearchMatch[]]]
                                        : []
                                ).map(([pluginId, pluginMatches]) => {
                                    const ms = Array.isArray(pluginMatches) ? pluginMatches : [];
                                    if (ms.length === 0) return null;
                                    const pid = pluginId || ms[0]?.pluginId;
                                    const onePerFile = getOneMatchPerFile(ms);
                                    return (
                                        <div key={pid || 'default'} className="space-y-1.5">
                                            {pid && (
                                                <p className="text-xs font-medium text-cyan-400 flex items-center gap-1.5">
                                                    <img
                                                        src={getPluginIcon(pid, pid === 'host-system' ? resolvedOsType : undefined)}
                                                        alt=""
                                                        className="w-3.5 h-3.5 opacity-80"
                                                    />
                                                    {pluginLabel(pid)}
                                                </p>
                                            )}
                                            <div className="space-y-1.5 pl-5">
                                                {onePerFile.map((m) => {
                                                    const count = getCountForFile(m.pluginId, m.filePath);
                                                    return (
                                                        <div
                                                            key={`${m.pluginId}-${m.filePath}`}
                                                            className="rounded border border-theme-border bg-theme-secondary p-2 hover:border-cyan-500/30 transition-colors"
                                                        >
                                                            <div className="flex items-start gap-2">
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 flex-wrap">
                                                                        <img
                                                                            src={getPluginIcon(m.pluginId, m.pluginId === 'host-system' ? resolvedOsType : undefined)}
                                                                            alt=""
                                                                            className="w-3.5 h-3.5 opacity-80 shrink-0"
                                                                        />
                                                                        <span className="text-xs text-gray-400 truncate" title={m.filePath}>
                                                                            {m.fileName}
                                                                        </span>
                                                                        {m.domain && (
                                                                            <span
                                                                                className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 shrink-0"
                                                                                title={m.domain}
                                                                            >
                                                                                <Globe size={10} />
                                                                                <span className="truncate max-w-[160px]">{m.domain}</span>
                                                                            </span>
                                                                        )}
                                                                        <span
                                                                            className="text-xs px-1.5 py-0.5 rounded bg-theme-primary border border-theme-border shrink-0"
                                                                            title={t('dashboard.searchOccurrences', { count })}
                                                                        >
                                                                            <span className={`font-semibold ${getCountColor(count)}`}>{count}</span>
                                                                        </span>
                                                                        <span className="text-xs text-gray-600">L{m.lineNumber}</span>
                                                                    </div>
                                                                    <p className="text-xs font-mono text-gray-300 mt-1 break-all line-clamp-2" title={m.content}>
                                                                        {m.content}
                                                                    </p>
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        if (m.pluginId === 'fail2ban') {
                                                                            window.dispatchEvent(new CustomEvent('open-ip-modal', { detail: { ip: m.filePath } }));
                                                                        } else {
                                                                            onOpenFile(m.pluginId, m.filePath, m.logType);
                                                                        }
                                                                    }}
                                                                    className="p-1.5 rounded hover:bg-cyan-500/20 text-gray-400 hover:text-cyan-400 shrink-0"
                                                                    title={m.pluginId === 'fail2ban' ? 'Voir le détail de l\'IP' : t('dashboard.openInLogViewer')}
                                                                >
                                                                    <ExternalLink size={14} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {isSearching && !result && (
                        <div className="flex items-center gap-2 py-4 text-cyan-400">
                            <Loader2 size={20} className="animate-spin" />
                            <span className="text-sm">{t('dashboard.searching')}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
