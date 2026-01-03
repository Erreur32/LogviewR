/**
 * Types for Log Size Alerts
 * 
 * System for configuring size limits and alerts for log files
 */

export interface LogSizeAlertConfig {
    pluginId: string;
    enabled: boolean;
    maxSizeBytes: number; // Maximum size in bytes before alert
    alertThreshold: 'warning' | 'error'; // Alert level when limit is reached
    notifyOnExceed: boolean; // Whether to send notification when limit is exceeded
    createdAt?: string;
    updatedAt?: string;
}

export interface LogSizeAlertStatus {
    pluginId: string;
    currentSize: number;
    maxSize: number;
    percentage: number; // Percentage of max size used (0-100)
    status: 'ok' | 'warning' | 'error';
    exceeded: boolean;
    lastChecked?: string;
}
