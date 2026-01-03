/**
 * Log Plugin Stats Card Component
 * 
 * Displays statistics for log source plugins with modern badges
 */

import React, { useState, useCallback, useEffect } from 'react';
import { CheckCircle, AlertCircle, XCircle, FileText, RefreshCw, ExternalLink, Code } from 'lucide-react';
import { api } from '../../api/client';
import type { LogPluginStats } from '../../types/logViewer';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { usePolling } from '../../hooks/usePolling';
import { POLLING_INTERVALS } from '../../utils/constants';
import { getPluginIcon } from '../../utils/pluginIcons';

interface LogPluginStatsCardProps {
    pluginId: string;
    pluginName: string;
    onViewLogs?: () => void;
}

export const LogPluginStatsCard: React.FC<LogPluginStatsCardProps> = ({ 
    pluginId, 
    pluginName,
    onViewLogs 
}) => {
    const [stats, setStats] = useState<LogPluginStats | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingCompressed, setIsLoadingCompressed] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [customRegexCount, setCustomRegexCount] = useState<number>(0);
    const [osType, setOsType] = useState<string | undefined>(undefined);

    // Fetch stats quickly (without compressed files)
    const fetchStatsQuick = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);
            const response = await api.get<LogPluginStats>(`/api/log-viewer/plugins/${pluginId}/stats?quick=true`);
            
            if (response.success && response.result) {
                setStats(response.result);
                setIsLoading(false);
            } else {
                setError(response.error?.message || 'Failed to load stats');
                setIsLoading(false);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load stats');
            setIsLoading(false);
        }
    }, [pluginId]);

    // Fetch complete stats (including compressed files if enabled)
    const fetchStatsComplete = useCallback(async () => {
        try {
            setIsLoadingCompressed(true);
            const response = await api.get<LogPluginStats>(`/api/log-viewer/plugins/${pluginId}/stats`);
            
            if (response.success && response.result) {
                setStats(response.result);
            }
        } catch (err) {
            console.warn('[LogPluginStatsCard] Failed to fetch complete stats:', err);
        } finally {
            setIsLoadingCompressed(false);
        }
    }, [pluginId]);

    // Fetch stats (legacy - for polling)
    const fetchStats = useCallback(async () => {
        // Use complete stats for polling updates
        await fetchStatsComplete();
    }, [fetchStatsComplete]);

    const fetchCustomRegexCount = useCallback(async () => {
        try {
            const response = await api.get<{ count: number }>(`/api/log-viewer/plugins/${pluginId}/custom-regex-count`);
            if (response.success && response.result) {
                setCustomRegexCount(response.result.count);
            }
        } catch (err) {
            // Silently fail - regex count is optional
            console.warn('[LogPluginStatsCard] Failed to fetch custom regex count:', err);
        }
    }, [pluginId]);

    const fetchAllData = useCallback(async () => {
        await Promise.all([
            fetchStats(),
            fetchCustomRegexCount()
        ]);
    }, [fetchStats, fetchCustomRegexCount]);

    // Load OS type for host-system plugin icon
    useEffect(() => {
        if (pluginId === 'host-system') {
            api.get<{ type: string }>('/api/log-viewer/os-type')
                .then(response => {
                    if (response.success && response.result) {
                        setOsType(response.result.type);
                    }
                })
                .catch(err => {
                    console.warn('[LogPluginStatsCard] Failed to get OS type:', err);
                });
        }
    }, [pluginId]);

    // Initial fetch: quick first, then complete
    React.useEffect(() => {
        const loadData = async () => {
            // First: fetch quick stats (non-compressed files only)
            await fetchStatsQuick();
            // Then: fetch custom regex count
            await fetchCustomRegexCount();
            // Finally: fetch complete stats (including compressed files) in background
            // Only if readCompressed is enabled (we'll check this from plugin settings)
            fetchStatsComplete();
        };
        loadData();
    }, [pluginId, fetchStatsQuick, fetchCustomRegexCount, fetchStatsComplete]);

    // Polling with usePolling hook
    usePolling(fetchAllData, {
        enabled: true,
        interval: POLLING_INTERVALS.pluginStats,
        immediate: false // Already fetched on mount
    });

    const getStatusIcon = () => {
        if (!stats) return null;
        
        switch (stats.status) {
            case 'ok':
                return <CheckCircle size={24} className="text-green-400" />;
            case 'warning':
                return <AlertCircle size={24} className="text-yellow-400" />;
            case 'error':
                return <XCircle size={24} className="text-red-400" />;
            default:
                return null;
        }
    };

    const getStatusBadgeColor = () => {
        if (!stats) return 'gray';
        
        switch (stats.status) {
            case 'ok':
                return 'green';
            case 'warning':
                return 'yellow';
            case 'error':
                return 'red';
            default:
                return 'gray';
        }
    };

    const getStatusText = () => {
        if (!stats) return 'Chargement...';
        
        switch (stats.status) {
            case 'ok':
                return 'Tout est OK';
            case 'warning':
                return 'Avertissement';
            case 'error':
                return 'Erreur';
            default:
                return 'Inconnu';
        }
    };

    if (isLoading && !stats) {
        return (
            <div className="bg-[#1a1a1a] border border-gray-700 rounded-lg p-6">
                <div className="flex items-center justify-center py-8">
                    <RefreshCw size={24} className="text-gray-400 animate-spin" />
                    <span className="ml-3 text-gray-400">Chargement des statistiques...</span>
                </div>
            </div>
        );
    }

    if (error && !stats) {
        return (
            <div className="bg-[#1a1a1a] border border-red-700 rounded-lg p-6">
                <div className="flex items-center gap-2 text-red-400">
                    <AlertCircle size={20} />
                    <span>Erreur : {error}</span>
                </div>
                <Button
                    onClick={fetchStats}
                    variant="secondary"
                    className="mt-4"
                    size="sm"
                >
                    <RefreshCw size={16} />
                    Réessayer
                </Button>
            </div>
        );
    }

    if (!stats) return null;

    return (
        <div className="bg-[#1a1a1a] border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors flex flex-col">
            {/* Header - Compact */}
            <div className="flex items-center justify-between mb-4">
                <button
                    onClick={onViewLogs}
                    disabled={!onViewLogs}
                    className={`flex items-center gap-2 ${onViewLogs ? 'cursor-pointer hover:opacity-80 transition-opacity' : 'cursor-default'}`}
                >
                    <div className="p-2 bg-cyan-500/20 rounded-lg flex items-center justify-center">
                        <img 
                            src={getPluginIcon(pluginId, pluginId === 'host-system' ? osType : undefined)} 
                            alt={pluginName}
                            className="w-6 h-6 object-contain"
                        />
                    </div>
                    <div>
                        <h3 className={`text-sm font-semibold ${onViewLogs ? 'text-white hover:text-cyan-300 transition-colors' : 'text-white'}`}>{pluginName}</h3>
                        {isLoadingCompressed && (
                            <div className="flex items-center gap-1 mt-0.5">
                                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
                                <span className="text-[10px] text-gray-400">Mise à jour...</span>
                            </div>
                        )}
                    </div>
                </button>
                <Tooltip content={
                    stats.status === 'ok' ? 'Tous les fichiers sont accessibles et lisibles' :
                    stats.status === 'warning' ? 'Certains fichiers présentent des problèmes' :
                    stats.status === 'error' ? 'Des erreurs empêchent la lecture des fichiers' :
                    'Statut inconnu'
                }>
                    <div className="flex items-center gap-1.5 cursor-help">
                        {getStatusIcon()}
                        <Badge variant={getStatusBadgeColor() as any} size="sm">
                            {getStatusText()}
                        </Badge>
                    </div>
                </Tooltip>
            </div>

            {/* Stats Grid - Compact - Single Row */}
            <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 flex-1">
                    <Tooltip content="Nombre total de fichiers de logs détectés pour ce plugin">
                        <div className="bg-[#0f0f0f] rounded-lg px-2 py-1.5 border border-gray-800 cursor-help flex-1">
                            <div className="text-base font-bold text-white leading-tight">
                                {stats.totalFiles}
                            </div>
                            <div className="text-[9px] text-gray-400 leading-tight">Total</div>
                        </div>
                    </Tooltip>
                    <Tooltip content="Nombre de fichiers de logs qui peuvent être lus et parsés">
                        <div className="bg-green-900/20 border border-green-700/50 rounded-lg px-2 py-1.5 cursor-help flex-1">
                            <div className="text-base font-bold text-green-400 leading-tight">
                                {stats.readableFiles}
                            </div>
                            <div className="text-[9px] text-gray-400 leading-tight">Lisibles</div>
                        </div>
                    </Tooltip>
                    <Tooltip content="Nombre de fichiers de logs qui ne peuvent pas être lus ou parsés">
                        <div className={`rounded-lg px-2 py-1.5 border cursor-help flex-1 ${
                            stats.unreadableFiles > 0 
                                ? 'bg-red-900/20 border-red-700/50' 
                                : 'bg-[#0f0f0f] border-gray-800'
                        }`}>
                            <div className={`text-base font-bold leading-tight ${
                                stats.unreadableFiles > 0 ? 'text-red-400' : 'text-gray-400'
                            }`}>
                                {stats.unreadableFiles}
                            </div>
                            <div className="text-[9px] text-gray-400 leading-tight">Erreurs</div>
                        </div>
                    </Tooltip>
                </div>
                <Tooltip content="Taille totale de tous les fichiers de logs pour ce plugin">
                    <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-2 py-1.5 cursor-help">
                        <div className="text-sm font-bold text-yellow-200 leading-tight">
                            {stats.totalSize >= 1024 * 1024 * 1024
                                ? `${(stats.totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`
                                : stats.totalSize >= 1024 * 1024
                                ? `${(stats.totalSize / (1024 * 1024)).toFixed(2)} MB`
                                : `${(stats.totalSize / 1024).toFixed(2)} KB`}
                        </div>
                        <div className="text-[9px] text-gray-400 leading-tight">Taille</div>
                    </div>
                </Tooltip>
            </div>

            {/* Files by Type - Compact */}
            {Object.keys(stats.filesByType).length > 0 && (
                <div className="mb-4">
                    <h4 className="text-xs font-medium text-gray-400 mb-2">Par type</h4>
                    <div className="space-y-1.5">
                        {Object.entries(stats.filesByType).map(([type, typeStats]) => {
                            const stats = typeStats as { total: number; readable: number; unreadable: number };
                            return (
                                <div key={type} className="flex items-center justify-between bg-[#0f0f0f] rounded-lg p-2 border border-gray-800">
                                    <div className="flex items-center gap-1.5">
                                        <Badge variant="gray" size="sm">
                                            {type}
                                        </Badge>
                                        <span className="text-xs text-gray-400">
                                            {stats.total}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-green-400">
                                            {stats.readable}✓
                                        </span>
                                        {stats.unreadable > 0 && (
                                            <span className="text-[10px] text-red-400">
                                                {stats.unreadable}✗
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Errors */}
            {stats.errors.length > 0 && (
                <div className="mb-6">
                    <h4 className="text-sm font-medium text-yellow-400 mb-2 flex items-center gap-2">
                        <AlertCircle size={16} />
                        Erreurs ({stats.errors.length})
                    </h4>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                        {stats.errors.map((error, index) => (
                            <div key={index} className="text-xs text-gray-400 bg-red-900/10 border border-red-700/30 rounded p-2">
                                {error}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Actions and Badges - Compact */}
            <div className="mt-auto pt-3 border-t border-gray-700 flex flex-col items-center gap-2">
                {/* Custom Regex Badge - Compact */}
                {customRegexCount > 0 && (
                    <Tooltip content={`${customRegexCount} regex personnalisée${customRegexCount > 1 ? 's' : ''} configurée${customRegexCount > 1 ? 's' : ''} pour ce plugin`}>
                        <div className="cursor-help">
                            <Badge 
                                variant="purple" 
                                size="sm"
                                className="flex items-center justify-center gap-1.5 px-2 py-1"
                            >
                                <Code size={12} />
                                <span className="text-xs">{customRegexCount} regex</span>
                            </Badge>
                        </div>
                    </Tooltip>
                )}
            </div>
        </div>
    );
};
