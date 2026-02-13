/**
 * Log Analytics Service
 *
 * Aggregates parsed access logs for GoAccess-style statistics.
 * Supports: overview (KPI), timeseries (requests over time), top metrics (URLs, IPs, status, UA, referrers).
 */

import { pluginManager } from './pluginManager.js';
import { logParserService } from './logParserService.js';
import { PluginConfigRepository } from '../database/models/PluginConfig.js';
import type { LogSourcePlugin } from '../plugins/base/LogSourcePluginInterface.js';
import { logger } from '../utils/logger.js';

/** Web access log plugins only (NPM, Apache). Nginx excluded for now - focus on NPM first. */
const LOG_SOURCE_PLUGINS = ['npm', 'apache'] as const;
const MAX_LINES_PER_FILE = 5000;
const MAX_FILES_TOTAL = 20;

export interface AnalyticsOverview {
    totalRequests: number;
    uniqueIps: number;
    status4xx: number;
    status5xx: number;
    totalBytes: number;
    filesAnalyzed: number;
    dateFrom?: string;
    dateTo?: string;
    /** Valid requests (2xx). */
    validRequests?: number;
    /** Failed requests (4xx + 5xx). */
    failedRequests?: number;
    /** Not found (404). */
    notFound?: number;
    /** Static file requests (js, css, images, etc.). */
    staticFiles?: number;
}

export interface AnalyticsDistribution {
    key: string;
    count: number;
    percent: number;
}

/** Distribution item with unique visitors for dual bar charts (hits + visitors). */
export interface AnalyticsDistributionWithVisitors extends AnalyticsDistribution {
    uniqueVisitors: number;
}

export interface AnalyticsTimeseriesBucket {
    label: string;
    count: number;
    /** Unique visitors (unique IPs) per bucket for dual-line charts. */
    uniqueVisitors?: number;
}

export interface AnalyticsTopItem {
    key: string;
    count: number;
    percent?: number;
}

/** Top item with unique visitors for dual bar charts. */
export interface AnalyticsTopItemWithVisitors extends AnalyticsTopItem {
    uniqueVisitors: number;
}

/** Extended URL item for Requested Files panel (hits, visitors, tx amount, method, protocol). */
export interface AnalyticsTopUrlItem extends AnalyticsTopItemWithVisitors {
    txAmount?: number;
    method?: string;
    protocol?: string;
}

/** Status by host/domain for detailed HTTP codes panel. */
export interface AnalyticsStatusByHostItem {
    host: string;
    status: string;
    count: number;
    uniqueVisitors: number;
}

interface ParsedAccessEntry {
    ip?: string;
    status?: number;
    size?: number;
    url?: string;
    userAgent?: string;
    referer?: string;
    method?: string;
    host?: string;
    protocol?: string;
    timestamp?: Date | string;
}

function isLogSourcePlugin(plugin: unknown): plugin is LogSourcePlugin {
    return (
        typeof plugin === 'object' &&
        plugin !== null &&
        typeof (plugin as LogSourcePlugin).scanLogFiles === 'function' &&
        typeof (plugin as LogSourcePlugin).parseLogLine === 'function'
    );
}

function getEffectiveBasePath(pluginId: string, plugin: LogSourcePlugin): string {
    const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
    const configured = pluginConfig?.settings?.basePath;
    if (configured && typeof configured === 'string' && configured.trim()) {
        return configured.trim();
    }
    return plugin.getDefaultBasePath();
}

function isCompressedFile(path: string): boolean {
    return /\.(gz|bz2|xz)$/i.test(path);
}

function hasAccessFields(entry: ParsedAccessEntry): boolean {
    return (
        (typeof entry.ip === 'string' || typeof entry.status === 'number') &&
        entry.status !== undefined
    );
}

function toDate(ts: Date | string | undefined): Date | null {
    if (!ts) return null;
    if (ts instanceof Date) return ts;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
}

export type FileScopeOption = 'latest' | 'all';
export type IncludeCompressedOption = boolean;

/**
 * Collect and parse access logs from plugin(s), then aggregate into analytics data.
 * - fileScope 'latest': only the most recent file per plugin (access.log or access.log.1)
 * - fileScope 'all': up to MAX_FILES_TOTAL files per plugin (includes rotated .1, .2, etc.)
 * - includeCompressed: when true and plugin has readCompressed enabled, include .gz/.bz2/.xz files
 */
async function collectParsedEntries(
    pluginIds: string[],
    dateFrom?: Date,
    dateTo?: Date,
    options?: { fileScope?: FileScopeOption; includeCompressed?: boolean }
): Promise<{ entries: ParsedAccessEntry[]; filesAnalyzed: number }> {
    const allEntries: ParsedAccessEntry[] = [];
    let filesAnalyzed = 0;
    const fileScope = options?.fileScope ?? 'all';
    const includeCompressed = options?.includeCompressed ?? false;

    for (const pluginId of pluginIds) {
        const plugin = pluginManager.getPlugin(pluginId);
        if (!plugin || !isLogSourcePlugin(plugin)) continue;

        const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
        const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;
        const canReadCompressed = includeCompressed && readCompressed;

        try {
            const basePath = getEffectiveBasePath(pluginId, plugin);
            const patterns = plugin.getDefaultFilePatterns();
            const scannedFiles = await plugin.scanLogFiles(basePath, patterns);

            const accessFiles = scannedFiles
                .filter(
                    (f) =>
                        (f.type || 'access') === 'access' &&
                        (canReadCompressed || !isCompressedFile(f.path))
                )
                .sort((a, b) => (b.modified instanceof Date ? b.modified.getTime() : 0) - (a.modified instanceof Date ? a.modified.getTime() : 0))
                .slice(0, fileScope === 'latest' ? 1 : Math.ceil(MAX_FILES_TOTAL / pluginIds.length));

            for (const file of accessFiles) {
                if (filesAnalyzed >= MAX_FILES_TOTAL) break;

                try {
                    const results = await logParserService.parseLogFile({
                        pluginId,
                        filePath: file.path,
                        logType: 'access',
                        maxLines: MAX_LINES_PER_FILE,
                        fromLine: 0,
                        readCompressed
                    });

                    for (const r of results) {
                        const p = r.parsed as ParsedAccessEntry & { isParsed?: boolean };
                        if (!hasAccessFields(p)) continue;

                        const ts = toDate(p.timestamp);
                        if (dateFrom && ts && ts < dateFrom) continue;
                        if (dateTo && ts && ts > dateTo) continue;

                        const ext = p as { host?: string; vhost?: string; protocol?: string };
                        allEntries.push({
                            ip: p.ip,
                            status: p.status,
                            size: typeof p.size === 'number' ? p.size : 0,
                            url: p.url,
                            userAgent: p.userAgent,
                            referer: p.referer,
                            method: p.method,
                            host: ext.host ?? ext.vhost,
                            protocol: ext.protocol,
                            timestamp: p.timestamp
                        });
                    }

                    filesAnalyzed++;
                } catch (err) {
                    logger.warn('LogAnalytics', `Failed to parse ${file.path}:`, err);
                }
            }
        } catch (err) {
            logger.warn('LogAnalytics', `Failed to scan plugin ${pluginId}:`, err);
        }
    }

    return { entries: allEntries, filesAnalyzed };
}

/**
 * Compute overview (KPI) from parsed entries.
 */
export function computeOverview(
    entries: ParsedAccessEntry[],
    filesAnalyzed: number
): AnalyticsOverview {
    const ips = new Set<string>();
    let status4xx = 0;
    let status5xx = 0;
    let totalBytes = 0;
    let validRequests = 0;
    let notFound = 0;
    let staticFiles = 0;
    let dateFrom: string | undefined;
    let dateTo: string | undefined;

    for (const e of entries) {
        if (e.ip) ips.add(e.ip);
        if (typeof e.status === 'number') {
            if (e.status >= 200 && e.status < 300) validRequests++;
            else if (e.status === 404) notFound++;
            else if (e.status >= 400 && e.status < 500) status4xx++;
            else if (e.status >= 500) status5xx++;
        }
        if (typeof e.size === 'number') totalBytes += e.size;
        if (isStaticFileUrl(e.url)) staticFiles++;
        const ts = toDate(e.timestamp);
        if (ts) {
            const iso = ts.toISOString();
            if (!dateFrom || iso < dateFrom) dateFrom = iso;
            if (!dateTo || iso > dateTo) dateTo = iso;
        }
    }

    return {
        totalRequests: entries.length,
        uniqueIps: ips.size,
        status4xx,
        status5xx,
        totalBytes,
        filesAnalyzed,
        dateFrom,
        dateTo,
        validRequests,
        failedRequests: status4xx + status5xx,
        notFound,
        staticFiles
    };
}

/**
 * Compute timeseries buckets (per minute, hour, or day) from parsed entries.
 * Includes uniqueVisitors per bucket for dual-line charts (requests + visitors).
 */
export function computeTimeseries(
    entries: ParsedAccessEntry[],
    bucket: 'minute' | 'hour' | 'day'
): AnalyticsTimeseriesBucket[] {
    const bucketMs =
        bucket === 'minute' ? 60 * 1000 : bucket === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const sliceLen = bucket === 'minute' ? 16 : bucket === 'hour' ? 13 : 10;
    const countMap = new Map<string, number>();
    const visitorsMap = new Map<string, Set<string>>();

    for (const e of entries) {
        const ts = toDate(e.timestamp);
        if (!ts) continue;
        const key = Math.floor(ts.getTime() / bucketMs) * bucketMs;
        const label = new Date(key).toISOString().slice(0, sliceLen);
        countMap.set(label, (countMap.get(label) ?? 0) + 1);
        if (e.ip) {
            let set = visitorsMap.get(label);
            if (!set) {
                set = new Set<string>();
                visitorsMap.set(label, set);
            }
            set.add(e.ip);
        }
    }

    return Array.from(countMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, count]) => ({
            label,
            count,
            uniqueVisitors: visitorsMap.get(label)?.size ?? 0
        }));
}

/**
 * Extract referring site domain from referer URL (e.g. https://google.com/search -> google.com).
 */
function extractReferringSiteDomain(referer: string | undefined): string {
    if (!referer || referer === '-') return 'Direct';
    try {
        const u = referer.trim();
        if (!u || u.startsWith('-')) return 'Direct';
        const url = new URL(u);
        return url.hostname || 'Direct';
    } catch {
        return referer.length > 60 ? referer.slice(0, 57) + '...' : referer;
    }
}

/**
 * Check if URL points to a static file (common extensions).
 */
function isStaticFileUrl(url: string | undefined): boolean {
    if (!url || url === '-') return false;
    const ext = url.split('?')[0].toLowerCase();
    return /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map|webp|avif)$/.test(ext);
}

/**
 * Extract browser family from User-Agent string (simple heuristic, no external lib).
 */
function extractBrowser(ua: string | undefined): string {
    if (!ua || ua === '-') return 'Direct/Unknown';
    const u = ua.toLowerCase();
    if (u.includes('edg/')) return 'Edge';
    if (u.includes('opr/') || u.includes('opera')) return 'Opera';
    if (u.includes('chrome') && !u.includes('chromium')) return 'Chrome';
    if (u.includes('firefox') || u.includes('fxios')) return 'Firefox';
    if (u.includes('safari') && !u.includes('chrome')) return 'Safari';
    if (u.includes('curl')) return 'curl';
    if (u.includes('wget')) return 'Wget';
    if (u.includes('bot') || u.includes('crawler') || u.includes('spider')) return 'Bot/Crawler';
    return 'Other';
}

/**
 * Compute distribution (methods, status, browsers) for bar charts.
 */
export function computeDistribution(
    entries: ParsedAccessEntry[],
    metric: 'method' | 'status' | 'browser'
): AnalyticsDistribution[] {
    const map = new Map<string, number>();
    const total = entries.length;

    for (const e of entries) {
        let key: string;
        switch (metric) {
            case 'method':
                key = (e.method || 'UNKNOWN').trim() || 'UNKNOWN';
                break;
            case 'status':
                key = String(e.status ?? '-');
                break;
            case 'browser':
                key = extractBrowser(e.userAgent);
                break;
            default:
                continue;
        }
        map.set(key, (map.get(key) ?? 0) + 1);
    }

    return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({
            key,
            count,
            percent: total > 0 ? Math.round((count / total) * 100) : 0
        }));
}

/**
 * Compute distribution with unique visitors per key (for dual bar charts: hits + visitors).
 */
export function computeDistributionWithVisitors(
    entries: ParsedAccessEntry[],
    metric: 'status'
): AnalyticsDistributionWithVisitors[] {
    const countMap = new Map<string, number>();
    const visitorsMap = new Map<string, Set<string>>();
    const total = entries.length;

    for (const e of entries) {
        const key = String(e.status ?? '-');
        countMap.set(key, (countMap.get(key) ?? 0) + 1);
        if (e.ip) {
            let set = visitorsMap.get(key);
            if (!set) {
                set = new Set<string>();
                visitorsMap.set(key, set);
            }
            set.add(e.ip);
        }
    }

    return Array.from(countMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({
            key,
            count,
            percent: total > 0 ? Math.round((count / total) * 100) : 0,
            uniqueVisitors: visitorsMap.get(key)?.size ?? 0
        }));
}

/**
 * Compute status by host/domain (for detailed HTTP codes panel with domain breakdown).
 */
export function computeStatusByHost(
    entries: ParsedAccessEntry[],
    limit: number
): AnalyticsStatusByHostItem[] {
    const map = new Map<string, { count: number; visitors: Set<string> }>();

    for (const e of entries) {
        const host = (e.host || '-').trim() || '-';
        const status = String(e.status ?? '-');
        const key = `${host}\t${status}`;
        const existing = map.get(key);
        if (!existing) {
            map.set(key, {
                count: 1,
                visitors: e.ip ? new Set([e.ip]) : new Set()
            });
        } else {
            existing.count++;
            if (e.ip) existing.visitors.add(e.ip);
        }
    }

    return Array.from(map.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, limit)
        .map(([key, val]) => {
            const [host, status] = key.split('\t');
            return {
                host,
                status,
                count: val.count,
                uniqueVisitors: val.visitors.size
            };
        });
}

/**
 * Compute top N items with unique visitors (for dual bar charts).
 */
export function computeTopWithVisitors(
    entries: ParsedAccessEntry[],
    metric: 'referrer' | 'referringSite' | 'host' | 'urls',
    limit: number
): AnalyticsTopItemWithVisitors[] {
    const countMap = new Map<string, number>();
    const visitorsMap = new Map<string, Set<string>>();
    const total = entries.length;

    for (const e of entries) {
        let key: string;
        switch (metric) {
            case 'referrer':
                key = (e.referer || '-').trim() || '-';
                if (key.length > 80) key = key.slice(0, 77) + '...';
                break;
            case 'referringSite':
                key = extractReferringSiteDomain(e.referer);
                break;
            case 'host':
                key = (e.host || '-').trim() || '-';
                break;
            case 'urls':
                key = (e.url || '-').trim() || '-';
                if (key.length > 80) key = key.slice(0, 77) + '...';
                break;
            default:
                continue;
        }
        countMap.set(key, (countMap.get(key) ?? 0) + 1);
        if (e.ip) {
            let set = visitorsMap.get(key);
            if (!set) {
                set = new Set<string>();
                visitorsMap.set(key, set);
            }
            set.add(e.ip);
        }
    }

    return Array.from(countMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => ({
            key,
            count,
            percent: total > 0 ? Math.round((count / total) * 100) : 0,
            uniqueVisitors: visitorsMap.get(key)?.size ?? 0
        }));
}

/**
 * Compute top URLs with extended fields (hits, visitors, tx amount, method, protocol) for Requested Files panel.
 */
export function computeTopUrlsWithExtras(
    entries: ParsedAccessEntry[],
    limit: number
): AnalyticsTopUrlItem[] {
    const countMap = new Map<string, number>();
    const visitorsMap = new Map<string, Set<string>>();
    const txMap = new Map<string, number>();
    const methodMap = new Map<string, Map<string, number>>();
    const protocolMap = new Map<string, Map<string, number>>();
    const total = entries.length;

    for (const e of entries) {
        const key = (e.url || '-').trim() || '-';
        const urlKey = key.length > 80 ? key.slice(0, 77) + '...' : key;
        countMap.set(urlKey, (countMap.get(urlKey) ?? 0) + 1);
        if (e.ip) {
            let set = visitorsMap.get(urlKey);
            if (!set) {
                set = new Set<string>();
                visitorsMap.set(urlKey, set);
            }
            set.add(e.ip);
        }
        txMap.set(urlKey, (txMap.get(urlKey) ?? 0) + (typeof e.size === 'number' ? e.size : 0));
        const method = (e.method || 'UNKNOWN').trim() || 'UNKNOWN';
        let m = methodMap.get(urlKey);
        if (!m) {
            m = new Map<string, number>();
            methodMap.set(urlKey, m);
        }
        m.set(method, (m.get(method) ?? 0) + 1);
        const protocol = (e.protocol || '-').trim() || '-';
        let p = protocolMap.get(urlKey);
        if (!p) {
            p = new Map<string, number>();
            protocolMap.set(urlKey, p);
        }
        p.set(protocol, (p.get(protocol) ?? 0) + 1);
    }

    return Array.from(countMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => {
            const methods = methodMap.get(key);
            const protocols = protocolMap.get(key);
            const topMethod = methods
                ? Array.from(methods.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
                : undefined;
            const topProtocol = protocols
                ? Array.from(protocols.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
                : undefined;
            return {
                key,
                count,
                percent: total > 0 ? Math.round((count / total) * 100) : 0,
                uniqueVisitors: visitorsMap.get(key)?.size ?? 0,
                txAmount: txMap.get(key) ?? 0,
                method: topMethod,
                protocol: topProtocol
            };
        });
}

/**
 * Compute top N items for a given metric.
 */
export function computeTop(
    entries: ParsedAccessEntry[],
    metric: 'urls' | 'ips' | 'status' | 'ua' | 'referrer' | 'browser' | 'host',
    limit: number
): AnalyticsTopItem[] {
    const map = new Map<string, number>();

    for (const e of entries) {
        let key: string;
        switch (metric) {
            case 'urls':
                key = (e.url || '-').trim() || '-';
                break;
            case 'ips':
                key = (e.ip || '-').trim() || '-';
                break;
            case 'status':
                key = String(e.status ?? '-');
                break;
            case 'ua':
                key = (e.userAgent || '-').trim() || '-';
                if (key.length > 80) key = key.slice(0, 77) + '...';
                break;
            case 'referrer':
                key = (e.referer || '-').trim() || '-';
                if (key.length > 80) key = key.slice(0, 77) + '...';
                break;
            case 'browser':
                key = extractBrowser(e.userAgent);
                break;
            case 'host':
                key = (e.host || '-').trim() || '-';
                break;
            default:
                continue;
        }
        map.set(key, (map.get(key) ?? 0) + 1);
    }

    const total = entries.length;
    return Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([key, count]) => ({
            key,
            count,
            percent: total > 0 ? Math.round((count / total) * 100) : 0
        }));
}

/**
 * Main entry: fetch all analytics for the given plugin filter and time range.
 * Returns overview, timeseries, and top metrics in one pass (single parse).
 */
export async function getAllAnalytics(
    pluginId: string | undefined,
    fromDate?: Date,
    toDate?: Date,
    options?: {
        bucket?: 'minute' | 'hour' | 'day';
        topLimit?: number;
        fileScope?: FileScopeOption;
        includeCompressed?: boolean;
    }
): Promise<{
    overview: AnalyticsOverview;
    timeseries: { buckets: AnalyticsTimeseriesBucket[] };
    distribution: {
        methods: AnalyticsDistribution[];
        status: AnalyticsDistribution[];
        statusWithVisitors: AnalyticsDistributionWithVisitors[];
    };
    top: {
        urls: AnalyticsTopItem[];
        ips: AnalyticsTopItem[];
        status: AnalyticsTopItem[];
        ua: AnalyticsTopItem[];
        referrer: AnalyticsTopItem[];
        browser: AnalyticsTopItem[];
        host: AnalyticsTopItem[];
        referringSites: AnalyticsTopItemWithVisitors[];
        referrerWithVisitors: AnalyticsTopItemWithVisitors[];
        hostWithVisitors: AnalyticsTopItemWithVisitors[];
        urlsWithExtras: AnalyticsTopUrlItem[];
        statusByHost: AnalyticsStatusByHostItem[];
    };
}> {
    const enabledPluginIds = LOG_SOURCE_PLUGINS.filter((id) => {
        const cfg = PluginConfigRepository.findByPluginId(id);
        return cfg?.enabled === true;
    });

    const pluginIds =
        !pluginId || pluginId === 'all'
            ? enabledPluginIds
            : LOG_SOURCE_PLUGINS.includes(pluginId as (typeof LOG_SOURCE_PLUGINS)[number]) &&
                enabledPluginIds.includes(pluginId)
              ? [pluginId]
              : [];

    const { entries, filesAnalyzed } = await collectParsedEntries(
        pluginIds,
        fromDate,
        toDate,
        {
            fileScope: options?.fileScope ?? 'all',
            includeCompressed: options?.includeCompressed ?? false
        }
    );
    const bucket = options?.bucket ?? 'hour';
    const topLimit = Math.min(options?.topLimit ?? 10, 50);

    return {
        overview: computeOverview(entries, filesAnalyzed),
        timeseries: {
            buckets: computeTimeseries(entries, bucket)
        },
        distribution: {
            methods: computeDistribution(entries, 'method'),
            status: computeDistribution(entries, 'status'),
            statusWithVisitors: computeDistributionWithVisitors(entries, 'status')
        },
        top: {
            urls: computeTop(entries, 'urls', topLimit),
            ips: computeTop(entries, 'ips', topLimit),
            status: computeTop(entries, 'status', topLimit),
            ua: computeTop(entries, 'ua', topLimit),
            referrer: computeTop(entries, 'referrer', topLimit),
            browser: computeTop(entries, 'browser', topLimit),
            host: computeTop(entries, 'host', topLimit),
            referringSites: computeTopWithVisitors(entries, 'referringSite', topLimit),
            referrerWithVisitors: computeTopWithVisitors(entries, 'referrer', topLimit),
            hostWithVisitors: computeTopWithVisitors(entries, 'host', topLimit),
            urlsWithExtras: computeTopUrlsWithExtras(entries, topLimit),
            statusByHost: computeStatusByHost(entries, topLimit * 2)
        }
    };
}
