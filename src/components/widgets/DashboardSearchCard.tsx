/**
 * Dashboard Search Card
 *
 * Global search across all active log files from enabled plugins.
 * Supports plugin filters, case sensitivity, and regex options.
 */

import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Filter, ExternalLink, Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import { getPluginIcon } from '../../utils/pluginIcons';

const PLUGIN_ORDER = ['host-system', 'apache', 'npm', 'nginx'];

export interface LogSearchMatch {
    pluginId: string;
    filePath: string;
    fileName: string;
    logType: string;
    lineNumber: number;
    content: string;
}

export interface LogSearchResult {
    matches: LogSearchMatch[];
    totalMatches: number;
    filesSearched: number;
    pluginsSearched: string[];
}

interface DashboardSearchCardProps {
    onOpenFile: (pluginId: string, filePath: string, logType: string) => void;
    osType?: string;
}

export const DashboardSearchCard: React.FC<DashboardSearchCardProps> = ({ onOpenFile, osType }) => {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [useRegex, setUseRegex] = useState(false);
    const [isSearching, setIsSearching] = useState(false);
    const [result, setResult] = useState<LogSearchResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [optionsExpanded, setOptionsExpanded] = useState(false);

    const hasContentToShow = optionsExpanded || result || error || isSearching;

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
    }, [query, selectedPlugins, caseSensitive, useRegex]);

    const togglePlugin = (pluginId: string) => {
        setSelectedPlugins((prev) =>
            prev.includes(pluginId) ? prev.filter((p) => p !== pluginId) : [...prev, pluginId]
        );
    };

    const pluginLabel = (id: string) => (id === 'host-system' ? 'Host System' : id);

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
                        className="flex-1 min-w-0 py-2 pr-3 bg-transparent border-0 text-theme-primary placeholder-gray-500 focus:outline-none focus:ring-0"
                        disabled={isSearching}
                    />
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
                                    {PLUGIN_ORDER.map((id) => (
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
                                                src={getPluginIcon(id, id === 'host-system' ? osType : undefined)}
                                                alt=""
                                                className="w-3.5 h-3.5 opacity-80"
                                            />
                                            {pluginLabel(id)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-4">
                                <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400">
                                    <input
                                        type="checkbox"
                                        checked={caseSensitive}
                                        onChange={(e) => setCaseSensitive(e.target.checked)}
                                        className="rounded border-gray-600 bg-theme-primary text-cyan-500 focus:ring-cyan-500/50"
                                    />
                                    {t('dashboard.searchCaseSensitive')}
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer text-xs text-gray-400">
                                    <input
                                        type="checkbox"
                                        checked={useRegex}
                                        onChange={(e) => setUseRegex(e.target.checked)}
                                        className="rounded border-gray-600 bg-theme-primary text-cyan-500 focus:ring-cyan-500/50"
                                    />
                                    {t('dashboard.searchRegex')}
                                </label>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="py-2 px-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                            {error}
                        </div>
                    )}
                    {result && (
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            <p className="text-xs text-gray-500">
                                {t('dashboard.searchResultsSummary', {
                                    count: result.totalMatches,
                                    files: result.filesSearched
                                })}
                            </p>
                            <div className="space-y-2">
                                {result.matches.map((m, i) => (
                                    <div
                                        key={`${m.filePath}-${m.lineNumber}-${i}`}
                                        className="rounded border border-theme-border bg-theme-secondary p-2 hover:border-cyan-500/30 transition-colors"
                                    >
                                        <div className="flex items-start gap-2">
                                            <img
                                                src={getPluginIcon(m.pluginId, m.pluginId === 'host-system' ? osType : undefined)}
                                                alt=""
                                                className="w-4 h-4 mt-0.5 opacity-80 shrink-0"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="text-xs font-medium text-cyan-400">{pluginLabel(m.pluginId)}</span>
                                                    <span className="text-xs text-gray-500">·</span>
                                                    <span className="text-xs text-gray-400 truncate" title={m.filePath}>
                                                        {m.fileName}
                                                    </span>
                                                    <span className="text-xs text-gray-600">L{m.lineNumber}</span>
                                                </div>
                                                <p className="text-xs font-mono text-gray-300 mt-1 break-all line-clamp-2" title={m.content}>
                                                    {m.content}
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => onOpenFile(m.pluginId, m.filePath, m.logType)}
                                                className="p-1.5 rounded hover:bg-cyan-500/20 text-gray-400 hover:text-cyan-400 shrink-0"
                                                title={t('dashboard.openInLogViewer')}
                                            >
                                                <ExternalLink size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
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
