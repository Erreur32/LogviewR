/**
 * Log Viewer Page
 * 
 * Page principale de visualisation des logs
 * Utilise les routes directes (bypass DB) pour tester sans configuration DB
 */

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useLogViewerStore } from '../stores/logViewerStore.js';
import { api } from '../api/client.js';
import { LogTable } from '../components/log-viewer/LogTable.js';
import { LogFilters } from '../components/log-viewer/LogFilters.js';
import { Button } from '../components/ui/Button.js';
import { Badge } from '../components/ui/Badge.js';
import { useLogViewerWebSocket } from '../hooks/useLogViewerWebSocket.js';
import { Play, Square, RefreshCw, FileText } from 'lucide-react';
import type { LogFileInfo, LogViewerResponse, LogEntry, LogFilters as LogFiltersType } from '../types/logViewer.js';

interface LogViewerPageProps {
    pluginId?: string;
    defaultLogFile?: string;
    onBack?: () => void;
    // Callbacks to expose data to parent (for Header)
    onPluginDataChange?: (data: {
        pluginId: string;
        pluginName: string;
        availableFiles: LogFileInfo[];
        selectedFilePath?: string;
        onFileSelect: (filePath: string, logType: string) => void;
        filters?: LogFiltersType;
        onFiltersChange?: (filters: Partial<LogFiltersType>) => void;
        logType?: string;
        osType?: string;
        isConnected?: boolean;
        viewMode?: 'parsed' | 'raw';
        onRefresh?: () => void;
        onToggleViewMode?: () => void;
        logDateRange?: { min?: Date; max?: Date };
    }) => void;
}

export function LogViewerPage({ pluginId: initialPluginId, defaultLogFile: initialDefaultLogFile, onBack, onPluginDataChange }: LogViewerPageProps) {
    const {
        selectedPluginId,
        selectedFilePath,
        selectedLogType,
        logs,
        columns,
        isLoading,
        error,
        filters,
        isConnected,
        isFollowing,
        currentPage,
        pageSize,
        setSelectedPlugin,
        setSelectedFile,
        setLogs,
        setColumns,
        setLoading,
        setError,
        setFilters,
        setFollowing,
        setPage,
        setPageSize,
        clearLogs
    } = useLogViewerStore();

    const [viewMode, setViewMode] = useState<'parsed' | 'raw'>('parsed');
    const [rawLogs, setRawLogs] = useState<string[]>([]);

    // WebSocket hook
    const { subscribe, unsubscribe } = useLogViewerWebSocket();

    const [availableFiles, setAvailableFiles] = useState<LogFileInfo[]>([]);
    const [osType, setOsType] = useState<string | undefined>(undefined);
    const [rememberLastFile, setRememberLastFile] = useState(true);

    // Load remember last file setting
    useEffect(() => {
        api.get<{ rememberLastFile?: boolean }>('/api/system/general')
            .then(response => {
                if (response.success && response.result) {
                    setRememberLastFile(response.result.rememberLastFile !== undefined ? response.result.rememberLastFile : true);
                }
            })
            .catch(err => {
                console.warn('[LogViewerPage] Failed to get remember last file setting:', err);
                setRememberLastFile(true); // Default to true
            });
    }, []);

    // Helper functions for remembering last file
    const getLastFileKey = (pluginId: string) => `logviewer_last_file_${pluginId}`;
    
    const saveLastFile = (pluginId: string, filePath: string, logType: string) => {
        if (!rememberLastFile) return;
        try {
            localStorage.setItem(getLastFileKey(pluginId), JSON.stringify({ filePath, logType }));
        } catch (err) {
            console.warn('[LogViewerPage] Failed to save last file:', err);
        }
    };

    const loadLastFile = (pluginId: string): { filePath: string; logType: string } | null => {
        if (!rememberLastFile) return null;
        try {
            const stored = localStorage.getItem(getLastFileKey(pluginId));
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (err) {
            console.warn('[LogViewerPage] Failed to load last file:', err);
        }
        return null;
    };

    // Initialize plugin if provided or from sessionStorage
    // Force update when pluginId changes (from dashboard or footer)
    useEffect(() => {
        // Check sessionStorage first (from footer click)
        const storedPluginId = sessionStorage.getItem('selectedPluginId');
        const pluginToUse = storedPluginId || initialPluginId;
        
        // Always update if we have a pluginId and it's different from current
        if (pluginToUse && pluginToUse !== selectedPluginId) {
            console.log('[LogViewerPage] Setting plugin:', pluginToUse, '(was:', selectedPluginId, ')');
            // Clear current selection when changing plugin
            clearLogs();
            setSelectedFile(null, null, null);
            setAvailableFiles([]);
            setRawLogs([]);
            setPage(1);
            // Set new plugin
            setSelectedPlugin(pluginToUse);
            // Clear sessionStorage after reading ONLY if we actually used it
            // This prevents race conditions with multiple clicks
            if (storedPluginId && storedPluginId === pluginToUse) {
                // Use setTimeout to ensure state update happens first
                setTimeout(() => {
                    sessionStorage.removeItem('selectedPluginId');
                }, 100);
            }
        }
    }, [initialPluginId, selectedPluginId, setSelectedPlugin, clearLogs, setSelectedFile, setPage]);

    // Load OS type for host-system plugin
    useEffect(() => {
        if (selectedPluginId === 'host-system') {
            api.get<{ type: string; version?: string }>('/api/log-viewer/os-type')
                .then(response => {
                    if (response.success && response.result) {
                        setOsType(response.result.type);
                    }
                })
                .catch(err => {
                    console.warn('[LogViewerPage] Failed to get OS type:', err);
                    setOsType(undefined);
                });
        } else {
            setOsType(undefined);
        }
    }, [selectedPluginId]);

    // Get plugin name from pluginId (moved before loadFiles to avoid lint errors)
    const pluginName = useMemo(() => {
        const pluginNames: Record<string, string> = {
            'host-system': 'Host System Logs',
            'nginx': 'Nginx Logs',
            'apache': 'Apache Logs',
            'npm': 'Nginx Proxy Manager Logs'
        };
        return pluginNames[selectedPluginId || ''] || selectedPluginId || 'Log Viewer';
    }, [selectedPluginId]);

    // Handle file select from header (moved before loadFiles to avoid lint errors)
    const handleFileSelectFromHeader = useCallback((filePath: string, logType: string) => {
        // Unsubscribe from previous file if following
        if (isFollowing && selectedFilePath && selectedPluginId) {
            const fileId = `${selectedPluginId}:${selectedFilePath}`;
            unsubscribe(fileId);
            setFollowing(false);
        }
        setSelectedFile(null, filePath, logType);
        // Save last file if remember is enabled
        if (selectedPluginId) {
            saveLastFile(selectedPluginId, filePath, logType);
        }
    }, [isFollowing, selectedFilePath, selectedPluginId, unsubscribe, setSelectedFile, setFollowing, saveLastFile]);

    // Load available files for selected plugin using direct route
    useEffect(() => {
        if (!selectedPluginId) {
            setAvailableFiles([]);
            return;
        }

        let isCancelled = false;

        const loadFiles = async () => {
            try {
                setLoading(true);
                setError(null);
                // Clear files immediately to show loading state
                setAvailableFiles([]);

                const response = await api.get<{ files: Array<{ path: string; type: string; size: number; modified: string }> }>(
                    `/api/log-viewer/plugins/${selectedPluginId}/files-direct`
                );

                if (isCancelled) return;

                if (response.success && response.result) {
                    const data = response.result as any;
                    // Handle both formats: { files: [...] } or direct array
                    const filesArray = data.files || (Array.isArray(data) ? data : []);
                    if (filesArray && filesArray.length > 0) {
                        const mappedFiles = filesArray.map((file: any) => ({
                            path: file.path,
                            type: file.type,
                            size: file.size,
                            modified: new Date(file.modified),
                            enabled: true,
                            readable: file.readable !== false // Default to true if not specified
                        }));
                        if (!isCancelled) {
                            setAvailableFiles(mappedFiles);
                            
                            // Priority: 1. initialDefaultLogFile, 2. last file if remember is enabled
                            let fileToLoad: { path: string; type: string } | null = null;
                            
                            if (initialDefaultLogFile) {
                                // Check if the default log file exists in available files
                                const fileExists = mappedFiles.find(f => f.path === initialDefaultLogFile);
                                if (fileExists && fileExists.readable !== false && fileExists.size > 0) {
                                    fileToLoad = { path: fileExists.path, type: fileExists.type };
                                }
                            }
                            
                            if (!fileToLoad) {
                                // Try to load last file if remember is enabled
                                const lastFile = loadLastFile(selectedPluginId);
                                if (lastFile) {
                                    // Check if the last file still exists in available files
                                    const fileExists = mappedFiles.find(f => f.path === lastFile.filePath);
                                    if (fileExists && fileExists.readable !== false && fileExists.size > 0) {
                                        fileToLoad = { path: fileExists.path, type: fileExists.type };
                                    }
                                }
                            }
                            
                            if (fileToLoad) {
                                // Set the file immediately
                                setSelectedFile(null, fileToLoad.path, fileToLoad.type);
                            }
                        }
                    } else {
                        if (!isCancelled) {
                            setAvailableFiles([]);
                        }
                    }
                } else {
                    if (!isCancelled) {
                        setError(response.error?.message || 'Failed to load files');
                        setAvailableFiles([]);
                    }
                }
            } catch (err) {
                if (!isCancelled) {
                    const errorMessage = err instanceof Error ? err.message : 'Failed to load files';
                    setError(errorMessage);
                    console.error('[LogViewerPage] Error loading files:', err);
                    // Log more details for debugging
                    if (err instanceof Error) {
                        console.error('[LogViewerPage] Error details:', {
                            message: err.message,
                            stack: err.stack,
                            pluginId: selectedPluginId,
                            url: `/api/log-viewer/plugins/${selectedPluginId}/files-direct`
                        });
                    } else {
                        console.error('[LogViewerPage] Unknown error type:', typeof err, err);
                    }
                    setAvailableFiles([]);
                }
            } finally {
                if (!isCancelled) {
                    setLoading(false);
                }
            }
        };

        loadFiles();

        return () => {
            isCancelled = true;
        };
    }, [selectedPluginId, pluginName, setLoading, setError, setSelectedFile]);

    // Load raw logs (without parsing)
    const loadRawLogs = useCallback(async (filePath: string) => {
        if (!selectedPluginId) {
            console.warn('[LogViewerPage] Cannot load raw logs: no plugin selected');
            return;
        }

        try {
            setLoading(true);
            setError(null);
            setRawLogs([]);

            const response = await api.post<{ lines: string[]; totalLines: number }>(
                `/api/log-viewer/plugins/${selectedPluginId}/read-raw`,
                {
                    filePath,
                    maxLines: 10000, // Load up to 10000 lines for raw view (client-side pagination)
                    fromLine: 0
                }
            );

            if (response.success && response.result?.lines) {
                setRawLogs(response.result.lines);
            } else {
                setError(response.error?.message || 'Failed to load raw logs');
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load raw logs';
            console.error('[LogViewerPage] Exception loading raw logs:', err);
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [selectedPluginId, pageSize, currentPage, setLoading, setError]);

    // Load logs for selected file using direct route
    const loadLogs = useCallback(async (filePath: string, logType: string) => {
        if (!selectedPluginId) {
            console.warn('[LogViewerPage] Cannot load logs: no plugin selected');
            return;
        }

        console.log('[LogViewerPage] Loading logs:', { pluginId: selectedPluginId, filePath, logType, viewMode });

        // If raw mode, load raw logs
        if (viewMode === 'raw') {
            await loadRawLogs(filePath);
            return;
        }

        try {
            setLoading(true);
            setError(null);
            clearLogs();
            setPage(1); // Reset to first page when loading new file

            console.log('[LogViewerPage] Sending POST request to /api/log-viewer/plugins/' + selectedPluginId + '/read-direct');

            const response = await api.post<LogViewerResponse>(
                `/api/log-viewer/plugins/${selectedPluginId}/read-direct`,
                {
                    filePath,
                    logType,
                    maxLines: 0, // 0 = no limit (was 1000)
                    fromLine: 0
                }
            );

            console.log('[LogViewerPage] Response received:', { success: response.success, hasResult: !!response.result, error: response.error });

            if (response.success && response.result) {
                const data = response.result;
                console.log('[LogViewerPage] Response data:', { 
                    logsCount: data.logs?.length || 0, 
                    columnsCount: Array.isArray(data.columns) ? data.columns.length : 0,
                    columns: Array.isArray(data.columns) ? data.columns : []
                });
                
                if (data.logs) {
                    const parsedLogs = data.logs.map((log) => log.parsed);
                    console.log('[LogViewerPage] Setting logs:', parsedLogs.length, 'entries');
                    // Debug: log first entry to see structure
                    if (parsedLogs.length > 0) {
                        console.log('[LogViewerPage] First log entry sample:', {
                            timestamp: parsedLogs[0].timestamp,
                            timestampType: typeof parsedLogs[0].timestamp,
                            hostname: parsedLogs[0].hostname,
                            hostnameType: typeof parsedLogs[0].hostname,
                            keys: Object.keys(parsedLogs[0])
                        });
                    }
                    setLogs(parsedLogs);
                } else {
                    console.warn('[LogViewerPage] No logs in response');
                }
                
                if (data.columns) {
                    console.log('[LogViewerPage] Setting columns:', data.columns.length, 'columns');
                    setColumns(data.columns);
                } else {
                    console.warn('[LogViewerPage] No columns in response');
                }
            } else {
                const errorMsg = response.error?.message || 'Failed to load logs';
                console.error('[LogViewerPage] API error:', errorMsg, response.error);
                setError(errorMsg);
            }
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Failed to load logs';
            console.error('[LogViewerPage] Exception loading logs:', err);
            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    }, [selectedPluginId, viewMode, setLoading, setError, clearLogs, setLogs, setColumns, setPage, loadRawLogs, pageSize, currentPage]);

    // Automatically load logs when file is selected
    useEffect(() => {
        if (selectedFilePath && selectedLogType && selectedPluginId) {
            setTimeout(() => {
                loadLogs(selectedFilePath, selectedLogType);
            }, 100);
        }
    }, [selectedFilePath, selectedLogType, selectedPluginId, loadLogs]);

    const handleFileSelect = (file: LogFileInfo) => {
        // Unsubscribe from previous file if following
        if (isFollowing && selectedFilePath && selectedPluginId) {
            const fileId = `${selectedPluginId}:${selectedFilePath}`;
            unsubscribe(fileId);
            setFollowing(false);
        }
        setSelectedFile(null, file.path, file.type);
        // Save last file if remember is enabled
        if (selectedPluginId) {
            saveLastFile(selectedPluginId, file.path, file.type);
        }
        // Automatically load logs when file is selected
        setTimeout(() => {
            loadLogs(file.path, file.type);
        }, 100);
    };

    const handleRefresh = useCallback(() => {
        if (selectedFilePath && selectedLogType) {
            // Stop following if active
            if (isFollowing && selectedPluginId) {
                const fileId = `${selectedPluginId}:${selectedFilePath}`;
                unsubscribe(fileId);
                setFollowing(false);
            }
            loadLogs(selectedFilePath, selectedLogType);
        }
    }, [selectedFilePath, selectedLogType, isFollowing, selectedPluginId, unsubscribe, setFollowing, loadLogs]);

    const handleToggleFollow = useCallback(() => {
        if (!selectedPluginId || !selectedFilePath || !selectedLogType) {
            return;
        }

        const fileId = `${selectedPluginId}:${selectedFilePath}`;

        if (isFollowing) {
            unsubscribe(fileId);
            setFollowing(false);
        } else {
            subscribe(selectedPluginId, selectedFilePath, selectedLogType, true);
            setFollowing(true);
        }
    }, [selectedPluginId, selectedFilePath, selectedLogType, isFollowing, subscribe, unsubscribe, setFollowing]);

    // Calculate log date range from logs
    const logDateRange = useMemo(() => {
        if (!logs || logs.length === 0) {
            return undefined;
        }

        const timestamps = logs
            .map(log => {
                if (log.timestamp) {
                    const date = typeof log.timestamp === 'string' ? new Date(log.timestamp) : log.timestamp;
                    return isNaN(date.getTime()) ? null : date;
                }
                return null;
            })
            .filter((date): date is Date => date !== null);

        if (timestamps.length === 0) {
            return undefined;
        }

        const min = new Date(Math.min(...timestamps.map(d => d.getTime())));
        const max = new Date(Math.max(...timestamps.map(d => d.getTime())));

        return { min, max };
    }, [logs]);

    // Get file size for selected file
    const selectedFileSize = useMemo(() => {
        if (!selectedFilePath || !availableFiles.length) {
            return undefined;
        }
        const file = availableFiles.find(f => f.path === selectedFilePath);
        return file?.size;
    }, [selectedFilePath, availableFiles]);

    // Notify parent component of plugin data changes
    // Use refs to avoid infinite loops with callbacks
    const onPluginDataChangeRef = useRef(onPluginDataChange);
    const handleFileSelectFromHeaderRef = useRef(handleFileSelectFromHeader);
    const handleRefreshRef = useRef(handleRefresh);
    const handleToggleFollowRef = useRef(handleToggleFollow);
    const loadLogsRef = useRef(loadLogs);
    const viewModeRef = useRef(viewMode);
    const selectedFilePathRef = useRef(selectedFilePath);
    const selectedLogTypeRef = useRef(selectedLogType);

    // Update refs when values change
    useEffect(() => {
        onPluginDataChangeRef.current = onPluginDataChange;
        handleFileSelectFromHeaderRef.current = handleFileSelectFromHeader;
        handleRefreshRef.current = handleRefresh;
        handleToggleFollowRef.current = handleToggleFollow;
        loadLogsRef.current = loadLogs;
        viewModeRef.current = viewMode;
        selectedFilePathRef.current = selectedFilePath;
        selectedLogTypeRef.current = selectedLogType;
    }, [onPluginDataChange, handleFileSelectFromHeader, handleRefresh, handleToggleFollow, loadLogs, viewMode, selectedFilePath, selectedLogType]);

    // Notify header when plugin data changes (separated from file loading to avoid loops)
    useEffect(() => {
        if (!onPluginDataChangeRef.current || !selectedPluginId) {
            return;
        }

        onPluginDataChangeRef.current({
            pluginId: selectedPluginId,
            pluginName,
            availableFiles,
            selectedFilePath: selectedFilePath || undefined,
            onFileSelect: handleFileSelectFromHeaderRef.current,
            filters: filters as LogFiltersType,
            onFiltersChange: setFilters as (filters: Partial<LogFiltersType>) => void,
            logType: selectedLogType || undefined,
            osType: selectedPluginId === 'host-system' ? osType : undefined,
            // Log viewer controls
            isConnected,
            viewMode,
            onRefresh: handleRefreshRef.current,
            onToggleViewMode: () => {
                const newMode = viewModeRef.current === 'parsed' ? 'raw' : 'parsed';
                setViewMode(newMode);
                // Reload logs when mode changes
                if (selectedFilePathRef.current && selectedLogTypeRef.current) {
                    setTimeout(() => {
                        loadLogsRef.current(selectedFilePathRef.current!, selectedLogTypeRef.current!);
                    }, 100);
                }
            },
            // Log date range
            logDateRange
        });
    }, [selectedPluginId, pluginName, availableFiles, selectedFilePath, selectedLogType, filters, setFilters, osType, isFollowing, isConnected, viewMode, logDateRange, setViewMode]);

    // Filter logs based on active filters
    const filteredLogs = useMemo(() => {
        if (!filters || Object.keys(filters).length === 0) {
            return logs;
        }

        return logs.filter((log) => {
            // Search filter
            if (filters.search) {
                const searchLower = filters.search.toLowerCase();
                const logString = JSON.stringify(log).toLowerCase();
                if (!logString.includes(searchLower)) {
                    return false;
                }
            }

            // Level filter
            if (filters.level) {
                const levels = Array.isArray(filters.level) ? filters.level : [filters.level];
                const logLevel = String(log.level || '').toLowerCase();
                if (!levels.some(l => logLevel === l.toLowerCase())) {
                    return false;
                }
            }

            // Date range filter
            if (filters.dateFrom || filters.dateTo) {
                const logDate = log.timestamp ? new Date(log.timestamp) : null;
                if (!logDate) return false;
                if (filters.dateFrom && logDate < filters.dateFrom) return false;
                if (filters.dateTo && logDate > filters.dateTo) return false;
            }

            // HTTP code filter
            if (filters.httpCode && filters.httpCode.length > 0) {
                const logCode = Number(log.status || log.statusCode || log.code || 0);
                if (!filters.httpCode.includes(logCode)) {
                    return false;
                }
            }

            // HTTP method filter
            if (filters.httpMethod && filters.httpMethod.length > 0) {
                const logMethod = String(log.method || log.httpMethod || '').toUpperCase();
                if (!filters.httpMethod.some(m => logMethod === m.toUpperCase())) {
                    return false;
                }
            }

            // Unparsed logs filter (hide unparsed logs if showUnparsed is false)
            if (filters.showUnparsed === false) {
                // Hide logs that were not successfully parsed
                if (log.isParsed === false) {
                    return false;
                }
            }

            return true;
        });
    }, [logs, filters]);

    return (
        <div className="min-h-screen bg-[#050505] p-4 md:p-6 max-w-full">

            {/* Contenu principal (fichier sélectionné) */}
            {selectedPluginId && availableFiles.length > 0 && (
                <div className="mb-6">
                    {isLoading ? (
                        <div className="text-theme-secondary p-8 text-center">Chargement des fichiers...</div>
                    ) : (
                        <div className="space-y-6">
                            {selectedFilePath ? (
                                <>
                                    {/* Raw View Mode */}
                                    {viewMode === 'raw' ? (
                                        <div className="bg-[#121212] border border-gray-800 rounded-xl overflow-hidden">
                                            {isLoading ? (
                                                <div className="p-12 text-center">
                                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto mb-4"></div>
                                                    <div className="text-gray-400">Chargement des logs bruts...</div>
                                                </div>
                                            ) : rawLogs.length > 0 ? (
                                                <>
                                                    <div className="bg-[#0a0a0a] border-b border-gray-800 px-4 py-3 flex items-center justify-between flex-wrap gap-4">
                                                        <span className="text-xs text-gray-400">
                                                            {rawLogs.length} ligne{rawLogs.length > 1 ? 's' : ''} brute{rawLogs.length > 1 ? 's' : ''} (Page {currentPage} sur {Math.ceil(rawLogs.length / pageSize)})
                                                        </span>
                                                        <div className="flex items-center gap-2 text-xs text-gray-400">
                                                            <span>Lignes par page:</span>
                                                            <select
                                                                value={pageSize}
                                                                onChange={(e) => {
                                                                    const newSize = parseInt(e.target.value, 10);
                                                                    setPageSize(newSize);
                                                                    setPage(1);
                                                                    // Reload raw logs with new page size
                                                                    if (selectedFilePath) {
                                                                        setTimeout(() => {
                                                                            loadRawLogs(selectedFilePath);
                                                                        }, 100);
                                                                    }
                                                                }}
                                                                className="px-2 py-1 bg-[#121212] border border-gray-700 rounded text-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                                            >
                                                                <option value={50}>50</option>
                                                                <option value={100}>100</option>
                                                                <option value={250}>250</option>
                                                                <option value={500}>500</option>
                                                                <option value={1000}>1000</option>
                                                            </select>
                                                        </div>
                                                    </div>
                                                    <div className="max-h-[600px] overflow-y-auto">
                                                        <pre className="p-4 text-xs font-mono text-gray-300 whitespace-pre-wrap break-words">
                                                            {rawLogs.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((line, index) => (
                                                                <div key={index} className="mb-1">
                                                                    <span className="text-gray-500 mr-3 select-none">{((currentPage - 1) * pageSize + index + 1).toString().padStart(6, ' ')}</span>
                                                                    <span>{line}</span>
                                                                </div>
                                                            ))}
                                                        </pre>
                                                    </div>
                                                    {/* Pagination for raw logs */}
                                                    {rawLogs.length > pageSize && (
                                                        <div className="px-4 py-3 bg-[#0a0a0a] border-t border-gray-800 flex items-center justify-between flex-wrap gap-4">
                                                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                                                <span>Page {currentPage} sur {Math.ceil(rawLogs.length / pageSize)}</span>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    onClick={() => {
                                                                        const newPage = Math.max(1, currentPage - 1);
                                                                        setPage(newPage);
                                                                        if (selectedFilePath) {
                                                                            setTimeout(() => {
                                                                                loadRawLogs(selectedFilePath);
                                                                            }, 100);
                                                                        }
                                                                    }}
                                                                    disabled={currentPage === 1}
                                                                    className="p-1.5 rounded border border-gray-700 bg-[#121212] text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                                    title="Page précédente"
                                                                >
                                                                    ←
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        const newPage = Math.min(Math.ceil(rawLogs.length / pageSize), currentPage + 1);
                                                                        setPage(newPage);
                                                                        if (selectedFilePath) {
                                                                            setTimeout(() => {
                                                                                loadRawLogs(selectedFilePath);
                                                                            }, 100);
                                                                        }
                                                                    }}
                                                                    disabled={currentPage >= Math.ceil(rawLogs.length / pageSize)}
                                                                    className="p-1.5 rounded border border-gray-700 bg-[#121212] text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                                                    title="Page suivante"
                                                                >
                                                                    →
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="p-12 text-center">
                                                    <div className="text-gray-500 text-lg mb-2">Aucun log brut disponible</div>
                                                    <div className="text-gray-600 text-sm">Les logs bruts seront affichés ici</div>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        /* Parsed View Mode */
                                        columns.length > 0 ? (
                                            <div className="bg-[#121212] border border-gray-800 rounded-xl overflow-hidden">
                                                <LogTable
                                                    logs={filteredLogs}
                                                    columns={columns}
                                                    logType={selectedLogType || 'syslog'}
                                                    isLoading={isLoading}
                                                    filteredCount={logs.length - filteredLogs.length}
                                                    currentPage={currentPage}
                                                    selectedFilePath={selectedFilePath}
                                                    pageSize={pageSize}
                                                    onPageChange={setPage}
                                                    onPageSizeChange={setPageSize}
                                                    filters={filters}
                                                    onFiltersChange={setFilters}
                                                    logDateRange={logDateRange}
                                                    pluginId={selectedPluginId || undefined}
                                                    fileSize={selectedFileSize}
                                                />
                                            </div>
                                        ) : (
                                            <div className="bg-[#121212] border border-gray-800 rounded-xl p-12 text-center">
                                                <div className="text-gray-500 text-lg mb-2">Aucune colonne disponible</div>
                                                <div className="text-gray-600 text-sm">Les colonnes seront définies une fois les logs chargés</div>
                                                <button
                                                    onClick={() => setViewMode('raw')}
                                                    className="mt-4 px-4 py-2 bg-purple-500/20 border border-purple-500/50 text-purple-400 rounded-lg hover:bg-purple-500/30 transition-colors"
                                                >
                                                    Afficher en mode brut
                                                </button>
                                            </div>
                                        )
                                    )}
                                </>
                            ) : (
                                <div className="flex items-center justify-center bg-[#121212] border border-gray-800 rounded-xl p-12">
                                    <div className="text-center">
                                        <div className="text-gray-500 text-lg mb-2">Aucun fichier sélectionné</div>
                                        <div className="text-gray-600 text-sm">Sélectionnez un fichier dans le menu du header pour afficher ses logs</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Error Display */}
            {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 text-red-400 rounded-xl">
                    <div className="font-semibold mb-1">Erreur</div>
                    <div className="text-sm">{error}</div>
                </div>
            )}

            {/* Info: Unreadable files warning */}
            {selectedPluginId && availableFiles.length > 0 && (() => {
                const unreadableFiles = availableFiles.filter(f => f.readable === false);
                if (unreadableFiles.length > 0) {
                    return (
                        <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/50 text-yellow-400 rounded-xl">
                            <div className="font-semibold mb-2 flex items-center gap-2">
                                <span>⚠️</span>
                                <span>Fichiers non accessibles</span>
                            </div>
                            <div className="text-sm mb-3">
                                <span className="font-medium">{unreadableFiles.length}</span> fichier{unreadableFiles.length > 1 ? 's' : ''} ne peut{unreadableFiles.length > 1 ? 'vent' : ''} pas être lu{unreadableFiles.length > 1 ? 's' : ''} en raison de permissions insuffisantes.
                            </div>
                            <div className="text-xs text-yellow-300/80 space-y-1">
                                <div className="font-medium mb-1">Solutions possibles :</div>
                                <ul className="list-disc list-inside space-y-1 ml-2">
                                    <li>Ajouter l'utilisateur du conteneur Docker au groupe approprié (ex: <code className="bg-yellow-500/20 px-1 rounded">adm</code> ou <code className="bg-yellow-500/20 px-1 rounded">systemd-journal</code>)</li>
                                    <li>Modifier les permissions des fichiers de logs (ex: <code className="bg-yellow-500/20 px-1 rounded">chmod 644</code>)</li>
                                    <li>Vérifier que le volume Docker a les bonnes permissions</li>
                                    <li>En développement local, exécuter avec les permissions appropriées</li>
                                </ul>
                                <div className="mt-2 text-yellow-400/70">
                                    Les fichiers non accessibles sont grisés dans la liste et peuvent être masqués avec le bouton "Masquer".
                                </div>
                            </div>
                        </div>
                    );
                }
                return null;
            })()}

            {/* Empty State */}
            {!selectedPluginId && (
                <div className="text-center p-12 bg-theme-tertiary rounded-lg border border-theme-border">
                    <p className="text-theme-secondary">
                        Sélectionnez un plugin pour commencer à visualiser les logs
                    </p>
                </div>
            )}
        </div>
    );
}
