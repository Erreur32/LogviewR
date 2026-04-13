/**
 * Log Badge Component
 *
 * Each column type has a distinct visual style to avoid confusion:
 *   Level:        semi-transparent bg, no border (pill)
 *   HTTP Method:  SOLID filled pill, white text
 *   HTTP Status:  transparent bg + thin solid border (pill)
 *   Response Time: teal for fast, dashed border for medium/slow (pill)
 *   Size:         outline only — no bg fill (pill)
 *   Gzip:         minimal flat rectangle
 *   Upstream:     purple transparent + border (pill)
 */

import React from 'react';

/** Format bytes to human-readable size */
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

const BASE = 'inline-flex items-center rounded-full font-semibold text-xs px-1.5 py-0.5';

export const LogBadge: React.FC<LogBadgeProps> = ({ type, value, className = '' }) => {

    const formatValue = (): string => {
        if (type === 'responseTime' && typeof value === 'number') return `${value}ms`;
        if (type === 'size' && (typeof value === 'number' || !Number.isNaN(Number(value)))) {
            return formatSize(Number(value));
        }
        if (type === 'gzip') {
            const str = String(value).trim();
            if (str === '' || str === '-' || str === 'null' || str === 'undefined') return '-';
            const num = Number(value);
            return Number.isNaN(num) ? str : String(num);
        }
        return String(value);
    };

    // ─── Level badges: semi-transparent bg, no border ────────────────
    if (type === 'level') {
        const level = String(value).toLowerCase();
        let style: React.CSSProperties;
        if (level === 'emerg') {
            style = { background: 'rgba(248,81,73,0.40)', color: '#ffa198', fontWeight: 700 };
        } else if (level === 'crit') {
            style = { background: 'rgba(248,81,73,0.35)', color: '#ffa198' };
        } else if (level === 'alert') {
            style = { background: 'rgba(235,120,50,0.30)', color: '#ffab70' };
        } else if (level === 'error' || level === 'err') {
            style = { background: 'rgba(248,81,73,0.25)', color: '#ff7b72' };
        } else if (level === 'warn' || level === 'warning') {
            style = { background: 'rgba(210,153,34,0.25)', color: '#e3b341' };
        } else if (level === 'notice') {
            style = { background: 'rgba(56,139,253,0.15)', color: '#a5d6ff', border: '1px solid rgba(56,139,253,0.2)' };
        } else if (level === 'info') {
            style = { background: 'rgba(56,139,253,0.25)', color: '#79c0ff' };
        } else {
            // debug + unknown
            style = { background: 'rgba(139,148,158,0.15)', color: '#8b949e' };
        }
        return <span className={`${BASE} ${className}`} style={style}>{formatValue()}</span>;
    }

    // ─── HTTP Method: SOLID filled pill, white text ──────────────────
    if (type === 'httpMethod') {
        const method = String(value).toUpperCase();
        const methodColors: Record<string, { bg: string; color: string }> = {
            GET:     { bg: '#1f6feb', color: '#ffffff' },
            POST:    { bg: '#238636', color: '#ffffff' },
            PUT:     { bg: '#8957e5', color: '#ffffff' },
            PATCH:   { bg: '#6e40c9', color: '#ffffff' },
            DELETE:  { bg: '#da3633', color: '#ffffff' },
            HEAD:    { bg: '#484f58', color: '#c9d1d9' },
            OPTIONS: { bg: '#484f58', color: '#c9d1d9' },
        };
        const colors = methodColors[method] || { bg: '#484f58', color: '#c9d1d9' };
        return (
            <span className={`${BASE} ${className}`}
                style={{ backgroundColor: colors.bg, color: colors.color }}>
                {method}
            </span>
        );
    }

    // ─── HTTP Status Code: transparent bg + thin border ──────────────
    if (type === 'httpCode' || type === 'upstreamStatus') {
        const code = Number(value);
        let style: React.CSSProperties;
        if (Number.isNaN(code) || value === '' || value === '-' || value === null) {
            style = { background: 'rgba(139,148,158,0.15)', color: '#8b949e' };
        } else if (code >= 200 && code < 300) {
            style = { background: 'rgba(63,185,80,0.20)', color: '#7ee787', border: '1px solid rgba(63,185,80,0.25)' };
        } else if (code >= 300 && code < 400) {
            // Violet instead of blue — avoids collision with INFO
            style = { background: 'rgba(130,80,223,0.20)', color: '#bc8cff', border: '1px solid rgba(130,80,223,0.25)' };
        } else if (code >= 400 && code < 500) {
            style = { background: 'rgba(210,153,34,0.20)', color: '#e3b341', border: '1px solid rgba(210,153,34,0.25)' };
        } else if (code >= 500) {
            style = { background: 'rgba(248,81,73,0.20)', color: '#ff7b72', border: '1px solid rgba(248,81,73,0.25)' };
        } else {
            style = { background: 'rgba(139,148,158,0.15)', color: '#8b949e' };
        }
        return <span className={`${BASE} ${className}`} style={style}>{formatValue()}</span>;
    }

    // ─── Response Time: teal fast, dashed border medium/slow ─────────
    if (type === 'responseTime') {
        const time = Number(value);
        let style: React.CSSProperties;
        if (time < 100) {
            style = { background: 'rgba(31,183,166,0.25)', color: '#56d4c8' };
        } else if (time < 500) {
            style = { background: 'rgba(210,153,34,0.20)', color: '#e3b341', border: '1px dashed rgba(210,153,34,0.35)' };
        } else {
            style = { background: 'rgba(248,81,73,0.20)', color: '#ff7b72', border: '1px dashed rgba(248,81,73,0.35)' };
        }
        return <span className={`${BASE} ${className}`} style={style}>{formatValue()}</span>;
    }

    // ─── File Size: outline only (transparent bg + border) ───────────
    if (type === 'size') {
        const bytes = Number(value);
        let style: React.CSSProperties;
        if (Number.isNaN(bytes) || bytes < 0) {
            style = { color: '#8b949e' };
        } else if (bytes < 1024) {
            style = { background: 'transparent', color: '#7ee787', border: '1px solid rgba(63,185,80,0.35)' };
        } else if (bytes < 100 * 1024) {
            style = { background: 'transparent', color: '#a5d6ff', border: '1px solid rgba(56,139,253,0.35)' };
        } else if (bytes < 1024 * 1024) {
            style = { background: 'transparent', color: '#e3b341', border: '1px solid rgba(210,153,34,0.35)' };
        } else {
            style = { background: 'transparent', color: '#ff7b72', border: '1px solid rgba(248,81,73,0.35)' };
        }
        return <span className={`${BASE} ${className}`} style={style}>{formatValue()}</span>;
    }

    // ─── Gzip Ratio: minimal flat rectangle ──────────────────────────
    if (type === 'gzip') {
        const str = String(value).trim();
        const isEmpty = str === '' || str === '-' || str === 'null' || str === 'undefined';
        let style: React.CSSProperties;
        if (isEmpty) {
            style = { color: '#484f58' };
        } else {
            const num = Number(value);
            if (Number.isNaN(num)) {
                style = { color: '#484f58' };
            } else if (num >= 2) {
                style = { color: '#7ee787', background: 'rgba(63,185,80,0.10)' };
            } else if (num >= 1) {
                style = { color: '#a5d6ff', background: 'rgba(56,139,253,0.10)' };
            } else {
                style = { color: '#e3b341', background: 'rgba(210,153,34,0.10)' };
            }
        }
        return (
            <span className={`inline-flex items-center font-semibold text-xs px-1.5 py-0.5 rounded ${className}`}
                style={style}>
                {formatValue()}
            </span>
        );
    }

    // ─── Upstream: purple with border ────────────────────────────────
    if (type === 'upstream') {
        const str = String(value).trim();
        if (str === '' || str === '-') {
            return <span className={`${BASE} ${className}`} style={{ background: 'rgba(139,148,158,0.15)', color: '#8b949e' }}>{str || '-'}</span>;
        }
        return (
            <span className={`${BASE} ${className}`}
                style={{ background: 'rgba(130,80,223,0.15)', color: '#bc8cff', border: '1px solid rgba(130,80,223,0.25)' }}>
                {formatValue()}
            </span>
        );
    }

    // Fallback
    return <span className={`${BASE} ${className}`} style={{ background: 'rgba(139,148,158,0.15)', color: '#8b949e' }}>{formatValue()}</span>;
};
