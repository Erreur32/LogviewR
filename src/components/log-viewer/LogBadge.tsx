/**
 * Log Badge Component
 * 
 * Badges colorés pour level, codes HTTP, méthodes HTTP, etc.
 */

import React from 'react';
import { Badge } from '../ui/Badge.js';

interface LogBadgeProps {
    type: 'level' | 'httpCode' | 'httpMethod' | 'responseTime';
    value: string | number;
    className?: string;
}

export const LogBadge: React.FC<LogBadgeProps> = ({ type, value, className = '' }) => {
    const getVariant = (): 'default' | 'success' | 'warning' | 'error' | 'info' => {
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

        if (type === 'httpCode') {
            const code = Number(value);
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

        return 'default';
    };

    const formatValue = (): string => {
        if (type === 'responseTime' && typeof value === 'number') {
            return `${value}ms`;
        }
        return String(value);
    };

    return (
        <Badge variant={getVariant()} size="sm" className={className}>
            {formatValue()}
        </Badge>
    );
};
