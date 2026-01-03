/**
 * Log Viewer Store
 * 
 * Zustand store for managing log viewer state
 */

import { create } from 'zustand';

export interface LogEntry {
    timestamp?: Date | string;
    level?: string;
    message: string;
    [key: string]: unknown;
}

export interface LogFile {
    id: number;
    sourceId: number;
    filePath: string;
    logType: string;
    enabled: boolean;
    follow: boolean;
    maxLines: number;
    filters?: Record<string, unknown>;
    lastReadPosition?: number;
    newLinesCount?: number;
}

export interface LogSource {
    id: number;
    name: string;
    pluginId: string;
    type: string;
    basePath: string;
    filePatterns: string[];
    enabled: boolean;
    follow: boolean;
    maxLines: number;
    filters?: Record<string, unknown>;
    timezone?: string;
    healthStatus?: string;
    lastHealthCheck?: Date;
}

export interface LogViewerState {
    // Current plugin and file
    selectedPluginId: string | null;
    selectedFileId: number | null;
    selectedFilePath: string | null;
    selectedLogType: string | null;

    // Log entries
    logs: LogEntry[];
    columns: string[];
    isLoading: boolean;
    error: string | null;

    // Pagination
    currentPage: number;
    pageSize: number;
    totalLines: number;

    // Filters
    filters: {
        search?: string;
        level?: string | string[];
        httpCode?: number[];
        dateFrom?: Date;
        dateTo?: Date;
        httpMethod?: string[];
        [key: string]: unknown;
    };

    // WebSocket
    isConnected: boolean;
    isFollowing: boolean;

    // Actions
    setSelectedPlugin: (pluginId: string | null) => void;
    setSelectedFile: (fileId: number | null, filePath: string | null, logType: string | null) => void;
    setLogs: (logs: LogEntry[]) => void;
    setColumns: (columns: string[]) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setPage: (page: number) => void;
    setPageSize: (size: number) => void;
    setTotalLines: (total: number) => void;
    setFilters: (filters: Partial<LogViewerState['filters']>) => void;
    setConnected: (connected: boolean) => void;
    setFollowing: (following: boolean) => void;
    clearLogs: () => void;
}

export const useLogViewerStore = create<LogViewerState>((set) => ({
    // Initial state
    selectedPluginId: null,
    selectedFileId: null,
    selectedFilePath: null,
    selectedLogType: null,
    logs: [],
    columns: ['timestamp', 'level', 'message'],
    isLoading: false,
    error: null,
    currentPage: 1,
    pageSize: 50,
    totalLines: 0,
    filters: {},
    isConnected: false,
    isFollowing: false,

    // Actions
    setSelectedPlugin: (pluginId) => set({ selectedPluginId: pluginId }),
    setSelectedFile: (fileId, filePath, logType) => 
        set({ selectedFileId: fileId, selectedFilePath: filePath, selectedLogType: logType }),
    setLogs: (logs) => set({ logs }),
    setColumns: (columns) => set({ columns }),
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
    setPage: (currentPage) => set({ currentPage }),
    setPageSize: (pageSize) => set({ pageSize }),
    setTotalLines: (totalLines) => set({ totalLines }),
    setFilters: (filters) => set((state) => ({ filters: { ...state.filters, ...filters } })),
    setConnected: (isConnected) => set({ isConnected }),
    setFollowing: (isFollowing) => set({ isFollowing }),
    clearLogs: () => set({ logs: [], totalLines: 0, currentPage: 1 })
}));
