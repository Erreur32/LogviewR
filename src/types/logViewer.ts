/**
 * Types for Log Viewer
 */

export interface LogEntry {
    id?: string;
    timestamp?: Date | string;
    level?: 'info' | 'warn' | 'error' | 'debug' | 'emerg' | 'alert' | 'crit' | 'notice';
    message: string;
    isParsed?: boolean; // Whether the log line was successfully parsed (false = raw line)
    [key: string]: unknown;
}

export interface LogFilters {
    search?: string;
    level?: string[];
    httpCode?: number[];
    dateFrom?: Date;
    dateTo?: Date;
    httpMethod?: string[];
    showUnparsed?: boolean; // Show/hide unparsed log lines (default: true)
    [key: string]: unknown;
}

export interface LogFileInfo {
    path: string;
    type: 'access' | 'error' | 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
    size: number;
    modified: Date | string;
    enabled?: boolean;
    newLinesCount?: number;
    readable?: boolean; // Whether the file is readable (has proper permissions)
}

export interface ParsedLogResult {
    parsed: LogEntry;
    lineNumber: number;
}

export interface LogViewerResponse {
    pluginId?: string;
    filePath: string;
    logType: string;
    columns: string[];
    logs: ParsedLogResult[];
    totalLines: number;
    fileId?: number;
}

export interface LogFilesResponse {
    pluginId: string;
    basePath: string;
    patterns: string[];
    files: Array<{
        path: string;
        type: string;
        size: number;
        modified: string;
    }>;
}

export interface LogPluginStats {
    pluginId: string;
    status: 'ok' | 'warning' | 'error';
    totalFiles: number;
    readableFiles: number;
    unreadableFiles: number;
    totalSize: number; // Total size of all log files in bytes
    gzCount?: number; // Number of .gz files (for exporter stats)
    filesByType: {
        [type: string]: {
            total: number;
            readable: number;
            unreadable: number;
        };
    };
    errors: string[];
}
