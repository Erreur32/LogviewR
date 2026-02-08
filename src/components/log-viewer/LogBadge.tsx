/**
 * Log Badge Component
 *
 * Colored badges for level, HTTP codes, HTTP methods, size, gzip ratio,
 * upstream status, upstream IP/host, response time (NPM and access logs).
 */

import React from 'react';
import { Badge } from '../ui/Badge.js';

/** Format bytes to human-readable size (e.g. "1.2 KB") */
function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

interface LogBadgeProps {
    type: 'level' | 'httpCode' | 'httpMethod' | 'responseTime' | 'size' | 'gzip' | 'upstreamStatus' | 'upstream';
    value: string | number;
    className?: string;
}

export const LogBadge: React.FC<LogBadgeProps> = ({ type, value, className = '' }) => {
    const getVariant = (): 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple' => {
        if (type === 'level') {
            const level = String(value).toLowerCase();
            if (level === 'error' || level === 'err' || level === 'emerg' || level === 'alert' || level === 'crit') {
                return 'error';
            }
            if (level === 'warn' || level === 'warning') {
                return 'warning';
            }
            if (level === 'info' || level === 'notice') {
                return 'info';
            }
            if (level === 'debug') {
                return 'default';
            }
            return 'info';
        }

        if (type === 'httpCode' || type === 'upstreamStatus') {
            const code = Number(value);
            if (isNaN(code) || value === '' || value === '-' || value === null) {
                return 'default';
            }
            if (code >= 200 && code < 300) {
                return 'success';
            }
            if (code >= 300 && code < 400) {
                return 'info';
            }
            if (code >= 400 && code < 500) {
                return 'warning';
            }
            if (code >= 500) {
                return 'error';
            }
            return 'default';
        }

        if (type === 'httpMethod') {
            const method = String(value).toUpperCase();
            if (method === 'GET') {
                return 'info';
            }
            if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
                return 'success';
            }
            if (method === 'DELETE') {
                return 'error';
            }
            return 'default';
        }

        if (type === 'responseTime') {
            const time = Number(value);
            if (time < 100) {
                return 'success';
            }
            if (time < 500) {
                return 'warning';
            }
            return 'error';
        }

        if (type === 'size') {
            const bytes = Number(value);
            if (isNaN(bytes) || bytes < 0) return 'default';
            if (bytes < 1024) return 'success';       // < 1 KB
            if (bytes < 100 * 1024) return 'info';    // < 100 KB
            if (bytes < 1024 * 1024) return 'warning'; // < 1 MB
            return 'error';                            // >= 1 MB
        }

        if (type === 'gzip') {
            const str = String(value).trim();
            if (str === '' || str === '-' || str === 'null' || str === 'undefined') {
                return 'default';
            }
            const num = Number(value);
            if (isNaN(num)) return 'default';
            if (num >= 2) return 'success';  // Good compression ratio
            if (num >= 1) return 'info';
            return 'warning';
        }

        if (type === 'upstream') {
            const str = String(value).trim();
            if (str === '' || str === '-') return 'default';
            return 'purple';
        }

        return 'default';
    };

    const formatValue = (): string => {
        if (type === 'responseTime' && typeof value === 'number') {
            return `${value}ms`;
        }
        if (type === 'size' && (typeof value === 'number' || !isNaN(Number(value)))) {
            return formatSize(Number(value));
        }
        if (type === 'gzip') {
            const str = String(value).trim();
            if (str === '' || str === '-' || str === 'null' || str === 'undefined') return '-';
            const num = Number(value);
            return isNaN(num) ? str : String(num);
        }
        return String(value);
    };

    return (
        <Badge variant={getVariant()} size="sm" className={className}>
            {formatValue()}
        </Badge>
    );
};
