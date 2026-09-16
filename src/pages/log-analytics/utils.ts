/**
 * Pure helpers shared across LogAnalyticsPage and its tab components
 * (OverviewTab, TopsTab, HttpSecurityTab).
 */

export type BucketKey = 'minute' | 'hour' | 'day';

/** Human-readable label for a fixed-window size (Day of Week / Calendar / Hour×Day heatmap window). */
export function formatWindowLabel(t: (key: string, opts?: Record<string, unknown>) => string, days: number): string {
    if (days >= 300) return t('logAnalytics.windowLabelMonths');
    return t('logAnalytics.windowLabelDays', { count: days });
}

/** Coverage info for the DB-first quick preview — see HybridAnalyticsResult server-side. */
export interface AnalyticsCoverage {
    rollupDates: string[];
    scannedDates: string[];
    liveRefreshed: boolean;
}

export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/** Softer, less vivid colors for HTTP status bars. */
export function getStatusColor(key: string): string {
    if (/^2\d{2}$/.test(key)) return '#047857';
    if (/^3\d{2}$/.test(key)) return '#1d4ed8';
    if (/^4\d{2}$/.test(key)) return '#b45309';
    if (/^5\d{2}$/.test(key)) return '#b91c1c';
    return '#4b5563';
}

/** Badge color by HTTP method — matches the palette used for status codes elsewhere on the page. */
export function getMethodColor(method: string): string {
    switch (method.toUpperCase()) {
        case 'GET': return 'text-sky-300 bg-sky-500/10 border-sky-500/30';
        case 'POST': return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30';
        case 'PUT':
        case 'PATCH': return 'text-amber-300 bg-amber-500/10 border-amber-500/30';
        case 'DELETE': return 'text-red-300 bg-red-500/10 border-red-500/30';
        default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
    }
}

/**
 * Format timeseries axis labels: no year, "h" for hour (instead of "T").
 * Compact format to avoid overflow. Handles ISO-like strings (2026-02-12T18, 2026-02-12T18:00, etc.).
 */
export function formatTsLabel(raw: string, bucket: BucketKey): string {
    try {
        let d = new Date(raw);
        if (Number.isNaN(d.getTime())) {
            const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?/);
            if (m) d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +(m[5] ?? 0), +(m[6] ?? 0));
            else return raw;
        }
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const hour = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        if (bucket === 'minute') return `${day}/${month} ${hour}:${min}`;
        if (bucket === 'hour') return `${day}/${month} ${hour}h`;
        return `${day}/${month}`;
    } catch {
        return raw;
    }
}

/** Same "still fetching" vs "genuinely no data" distinction as <NoDataOrLoading>, for chart widgets that take a plain `noDataText` string prop instead of a component. */
export function noDataOrLoadingText(t: (key: string) => string, loading: boolean): string {
    return loading ? t('logAnalytics.loadingData') : t('logAnalytics.noData');
}
