/**
 * Log Analytics Service
 *
 * Aggregates parsed access logs for the LogAnalytics page statistics.
 * Supports: overview (KPI), timeseries (requests over time), top metrics (URLs, IPs, status, UA, referrers).
 */

import { pluginManager } from './pluginManager.js';
import { logParserService } from './logParserService.js';
import { logReaderService } from './logReaderService.js';
import { PluginConfigRepository } from '../database/models/PluginConfig.js';
import type { LogSourcePlugin } from '../plugins/base/LogSourcePluginInterface.js';
import { logger } from '../utils/logger.js';

/** Web access log plugins only (NPM, Apache). Nginx excluded for now - focus on NPM first. */
const LOG_SOURCE_PLUGINS = ['npm', 'apache'] as const;
const MAX_FILES_TOTAL = 20;

/**
 * Tail-cap per file scaled to the requested period. Keeps memory bounded on short windows
 * while allowing enough history for 7d/30d heatmaps to fill their grids.
 */
function tailCapForPeriod(dateFrom?: Date, dateTo?: Date): number {
    if (!dateFrom) return 10_000;
    const spanHours = ((dateTo?.getTime() ?? Date.now()) - dateFrom.getTime()) / 3_600_000;
    if (spanHours <= 2) return 10_000;
    if (spanHours <= 26) return 50_000;
    if (spanHours <= 24 * 8) return 200_000;
    return 500_000;
}

/**
 * Long windows (>24h) typically need rotated .gz files to reach enough calendar days.
 * Still gated by the plugin's own `readCompressed` setting — this only auto-enables the request.
 */
function shouldAutoIncludeCompressed(dateFrom?: Date, dateTo?: Date): boolean {
    if (!dateFrom) return false;
    const spanHours = ((dateTo?.getTime() ?? Date.now()) - dateFrom.getTime()) / 3_600_000;
    return spanHours > 26;
}

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

export interface AnalyticsStatusGroups {
    s2xx: number;
    s3xx: number;
    s4xx: number;
    s5xx: number;
}

export interface AnalyticsTimeseriesBucket {
    label: string;
    count: number;
    /** Unique visitors (unique IPs) per bucket for dual-line charts. */
    uniqueVisitors?: number;
    /** HTTP status code group counts per bucket. */
    statusGroups?: AnalyticsStatusGroups;
    /** Total bytes transferred in this bucket. */
    totalBytes?: number;
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
    responseTime?: number;
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
    return Number.isNaN(d.getTime()) ? null : d;
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

            const tailCap = tailCapForPeriod(dateFrom, dateTo);

            for (const file of accessFiles) {
                if (filesAnalyzed >= MAX_FILES_TOTAL) break;

                try {
                    // Tail from the end of the file: recent entries come first, which matches
                    // how users think of "7d of logs" (the last 7 days, not the first 5000 lines).
                    const lines = await logReaderService.readLastLines(file.path, tailCap, {
                        readCompressed: readCompressed && isCompressedFile(file.path)
                    });

                    for (const logLine of lines) {
                        const parsed = logParserService.parseLogLine(pluginId, logLine.line, 'access', file.path);
                        if (!parsed) continue;
                        const p = parsed as ParsedAccessEntry;
                        if (!hasAccessFields(p)) continue;

                        const ts = toDate(p.timestamp);
                        if (dateFrom && ts && ts < dateFrom) continue;
                        if (dateTo && ts && ts > dateTo) continue;

                        const ext = p as { host?: string; vhost?: string; protocol?: string; responseTime?: number };
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
                            timestamp: p.timestamp,
                            responseTime: typeof ext.responseTime === 'number' ? ext.responseTime : undefined
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
 * Includes uniqueVisitors, statusGroups, and totalBytes per bucket.
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
    const statusMap = new Map<string, AnalyticsStatusGroups>();
    const bytesMap = new Map<string, number>();

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

        if (typeof e.status === 'number') {
            let sg = statusMap.get(label);
            if (!sg) {
                sg = { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 };
                statusMap.set(label, sg);
            }
            if (e.status >= 200 && e.status < 300) sg.s2xx++;
            else if (e.status >= 300 && e.status < 400) sg.s3xx++;
            else if (e.status >= 400 && e.status < 500) sg.s4xx++;
            else if (e.status >= 500) sg.s5xx++;
        }

        if (typeof e.size === 'number') {
            bytesMap.set(label, (bytesMap.get(label) ?? 0) + e.size);
        }
    }

    return Array.from(countMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, count]) => ({
            label,
            count,
            uniqueVisitors: visitorsMap.get(label)?.size ?? 0,
            statusGroups: statusMap.get(label) ?? { s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0 },
            totalBytes: bytesMap.get(label) ?? 0
        }));
}

/**
 * Hour-of-day distribution (24 buckets) computed from raw entries.
 * Independent of the timeseries bucket — needed for the Peak Hours chart when
 * the main timeline is in day-mode (7d/30d), which otherwise collapses all counts to midnight.
 */
export function computeHourOfDay(entries: ParsedAccessEntry[]): number[] {
    const hours = new Array<number>(24).fill(0);
    for (const e of entries) {
        const ts = toDate(e.timestamp);
        if (!ts) continue;
        hours[ts.getHours()]++;
    }
    return hours;
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
 * Compute top URLs returning 404 (broken links / not found).
 */
export function computeTop404Urls(
    entries: ParsedAccessEntry[],
    limit: number
): AnalyticsTopItemWithVisitors[] {
    const notFoundEntries = entries.filter((e) => e.status === 404);
    const countMap = new Map<string, number>();
    const visitorsMap = new Map<string, Set<string>>();
    const total = notFoundEntries.length;

    for (const e of notFoundEntries) {
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
 * Classify user-agent as bot or human.
 */
function isBot(ua: string | undefined): boolean {
    if (!ua || ua === '-') return false;
    const u = ua.toLowerCase();
    return /bot|crawler|spider|curl|wget|python|go-http|java\/|libwww|scrapy|headless|phant|slurp|fetch|http-client|axios|node-fetch/.test(u);
}

/**
 * Compute bot vs human traffic distribution.
 */
export interface AnalyticsBotVsHuman {
    bots: number;
    humans: number;
    botPercent: number;
    topBots: AnalyticsTopItem[];
}

export function computeBotVsHuman(entries: ParsedAccessEntry[]): AnalyticsBotVsHuman {
    let bots = 0;
    let humans = 0;
    const botUaMap = new Map<string, number>();

    for (const e of entries) {
        if (isBot(e.userAgent)) {
            bots++;
            const ua = (e.userAgent || 'Unknown Bot').trim();
            const key = ua.length > 60 ? ua.slice(0, 57) + '...' : ua;
            botUaMap.set(key, (botUaMap.get(key) ?? 0) + 1);
        } else {
            humans++;
        }
    }

    const total = bots + humans;
    const topBots = Array.from(botUaMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([key, count]) => ({
            key,
            count,
            percent: total > 0 ? Math.round((count / total) * 100) : 0
        }));

    return {
        bots,
        humans,
        botPercent: total > 0 ? Math.round((bots / total) * 100) : 0,
        topBots
    };
}

/**
 * Compute response time distribution with percentiles.
 */
export interface AnalyticsResponseTimeBucket {
    range: string;
    count: number;
    percent: number;
}

export interface AnalyticsResponseTimeDistribution {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    buckets: AnalyticsResponseTimeBucket[];
}

export function computeResponseTimeDistribution(entries: ParsedAccessEntry[]): AnalyticsResponseTimeDistribution | null {
    const times = entries
        .filter((e) => typeof e.responseTime === 'number' && e.responseTime >= 0)
        .map((e) => e.responseTime!);

    if (times.length === 0) return null;

    times.sort((a, b) => a - b);
    const sum = times.reduce((s, t) => s + t, 0);
    const avg = sum / times.length;
    const p50 = times[Math.floor(times.length * 0.5)];
    const p95 = times[Math.floor(times.length * 0.95)];
    const p99 = times[Math.floor(times.length * 0.99)];
    const max = times[times.length - 1];

    const ranges: [string, number, number][] = [
        ['0-100ms', 0, 100],
        ['100-500ms', 100, 500],
        ['500ms-1s', 500, 1000],
        ['1-2s', 1000, 2000],
        ['2-5s', 2000, 5000],
        ['>5s', 5000, Infinity]
    ];

    const buckets: AnalyticsResponseTimeBucket[] = ranges.map(([range, lo, hi]) => {
        const count = times.filter((t) => t >= lo && t < hi).length;
        return {
            range,
            count,
            percent: times.length > 0 ? Math.round((count / times.length) * 100) : 0
        };
    });

    return { avg, p50, p95, p99, max, buckets };
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
    /** 24-number array: count per hour-of-day aggregated over the selected period (independent of main bucket). */
    hourOfDay: number[];
    distribution: {
        methods: AnalyticsDistribution[];
        status: AnalyticsDistribution[];
        statusWithVisitors: AnalyticsDistributionWithVisitors[];
        botVsHuman: AnalyticsBotVsHuman;
        responseTime: AnalyticsResponseTimeDistribution | null;
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
        notFoundUrls: AnalyticsTopItemWithVisitors[];
    };
}> {
    const enabledPluginIds = LOG_SOURCE_PLUGINS.filter((id) => {
        const cfg = PluginConfigRepository.findByPluginId(id);
        return cfg?.enabled === true;
    });

    const isLogSourceId = (id: string): id is (typeof LOG_SOURCE_PLUGINS)[number] =>
        (LOG_SOURCE_PLUGINS as readonly string[]).includes(id);

    const pluginIds =
        !pluginId || pluginId === 'all'
            ? enabledPluginIds
            : isLogSourceId(pluginId) && enabledPluginIds.includes(pluginId)
              ? [pluginId]
              : [];

    // Auto-enable compressed reads for long windows (>26h) so rotated .gz files contribute.
    // Still gated by each plugin's own `readCompressed` setting inside collectParsedEntries.
    const effectiveIncludeCompressed =
        (options?.includeCompressed ?? false) || shouldAutoIncludeCompressed(fromDate, toDate);

    const { entries, filesAnalyzed } = await collectParsedEntries(
        pluginIds,
        fromDate,
        toDate,
        {
            fileScope: options?.fileScope ?? 'all',
            includeCompressed: effectiveIncludeCompressed
        }
    );
    const bucket = options?.bucket ?? 'hour';
    const topLimit = Math.min(options?.topLimit ?? 10, 50);

    return {
        overview: computeOverview(entries, filesAnalyzed),
        timeseries: {
            buckets: computeTimeseries(entries, bucket)
        },
        hourOfDay: computeHourOfDay(entries),
        distribution: {
            methods: computeDistribution(entries, 'method'),
            status: computeDistribution(entries, 'status'),
            statusWithVisitors: computeDistributionWithVisitors(entries, 'status'),
            botVsHuman: computeBotVsHuman(entries),
            responseTime: computeResponseTimeDistribution(entries)
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
            statusByHost: computeStatusByHost(entries, topLimit * 2),
            notFoundUrls: computeTop404Urls(entries, topLimit)
        }
    };
}

/** Calendar heatmap response shape: one bucket per calendar day over a fixed sliding window. */
export interface AnalyticsCalendarBucket {
    /** YYYY-MM-DD */
    label: string;
    count: number;
    uniqueVisitors: number;
}

export interface AnalyticsCalendarStats {
    total: number;
    totalVisitors: number;
    avgPerDay: number;
    /** Peak day-of-week (0 = Monday, 6 = Sunday) and its request count. */
    peakDayOfWeekIdx: number;
    peakDayOfWeekCount: number;
    /** Peak single day (ISO date) over the window. */
    peakDayLabel: string | null;
    peakDayCount: number;
    /** Number of days in the window that had at least one request. */
    activeDays: number;
    /** Range actually covered by log data (narrower than the 365d window when logs don't go that far back). */
    firstDay: string | null;
    lastDay: string | null;
}

export interface AnalyticsCalendarResponse {
    buckets: AnalyticsCalendarBucket[];
    stats: AnalyticsCalendarStats;
    /** 7×24 matrix (Mon→Sun × 0h→23h) aggregated over the whole window. Always filled when logs exist. */
    hourDayGrid: number[][];
    /** Last-24h slice: hourOfDay (24) + dayOfWeek (7) — "live" view toggle for the fixed charts. */
    live24h: {
        hourOfDay: number[];
        dayOfWeek: number[];
    };
    /** Last-7d slice: hourDayGrid (7×24) — "live week" toggle for the Hour×Day heatmap. */
    live7d: {
        hourDayGrid: number[][];
    };
    /** Number of files scanned. Useful to detect "no rotated logs available" scenarios client-side. */
    filesAnalyzed: number;
    /** Window actually requested (informational). */
    windowDays: number;
}

function computeHourDayGrid(entries: ParsedAccessEntry[]): number[][] {
    const grid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    for (const e of entries) {
        const ts = toDate(e.timestamp);
        if (!ts) continue;
        const jsDay = ts.getDay();
        const dayIdx = jsDay === 0 ? 6 : jsDay - 1; // Monday = 0, Sunday = 6
        grid[dayIdx][ts.getHours()]++;
    }
    return grid;
}

function computeDayOfWeek(entries: ParsedAccessEntry[]): number[] {
    const days = new Array<number>(7).fill(0);
    for (const e of entries) {
        const ts = toDate(e.timestamp);
        if (!ts) continue;
        const jsDay = ts.getDay();
        const dayIdx = jsDay === 0 ? 6 : jsDay - 1;
        days[dayIdx]++;
    }
    return days;
}

function computeCalendarStats(buckets: AnalyticsCalendarBucket[]): AnalyticsCalendarStats {
    if (buckets.length === 0) {
        return {
            total: 0, totalVisitors: 0, avgPerDay: 0,
            peakDayOfWeekIdx: 0, peakDayOfWeekCount: 0,
            peakDayLabel: null, peakDayCount: 0, activeDays: 0,
            firstDay: null, lastDay: null
        };
    }

    const dowCounts = [0, 0, 0, 0, 0, 0, 0];
    let total = 0;
    let activeDays = 0;
    let peakDayLabel: string | null = null;
    let peakDayCount = 0;
    let firstDay: string | null = null;
    let lastDay: string | null = null;
    // Approximate totalVisitors as sum of daily uniques — true global uniqueness would need the raw entries.
    let totalVisitors = 0;

    for (const b of buckets) {
        total += b.count;
        totalVisitors += b.uniqueVisitors;
        if (b.count > 0) {
            activeDays++;
            if (!firstDay) firstDay = b.label;
            lastDay = b.label;
            if (b.count > peakDayCount) {
                peakDayCount = b.count;
                peakDayLabel = b.label;
            }
            const d = new Date(`${b.label}T00:00:00`);
            const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
            dowCounts[dow] += b.count;
        }
    }

    let peakDayOfWeekIdx = 0;
    let peakDayOfWeekCount = 0;
    for (let i = 0; i < 7; i++) {
        if (dowCounts[i] > peakDayOfWeekCount) {
            peakDayOfWeekCount = dowCounts[i];
            peakDayOfWeekIdx = i;
        }
    }

    return {
        total,
        totalVisitors,
        avgPerDay: activeDays > 0 ? Math.round(total / activeDays) : 0,
        peakDayOfWeekIdx,
        peakDayOfWeekCount,
        peakDayLabel,
        peakDayCount,
        activeDays,
        firstDay,
        lastDay
    };
}

/**
 * Build a day-bucketed calendar over the window, filling missing days with zero counts
 * so the frontend heatmap always has a contiguous grid.
 */
function buildCalendarBuckets(entries: ParsedAccessEntry[], fromDate: Date, toDate: Date): AnalyticsCalendarBucket[] {
    const countMap = new Map<string, number>();
    const visitorsMap = new Map<string, Set<string>>();

    for (const e of entries) {
        const d = e.timestamp instanceof Date ? e.timestamp : (typeof e.timestamp === 'string' ? new Date(e.timestamp) : null);
        if (!d || Number.isNaN(d.getTime())) continue;
        const key = d.toISOString().slice(0, 10);
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

    const buckets: AnalyticsCalendarBucket[] = [];
    const day = new Date(fromDate);
    day.setUTCHours(0, 0, 0, 0);
    const end = new Date(toDate);
    end.setUTCHours(0, 0, 0, 0);
    while (day <= end) {
        const key = day.toISOString().slice(0, 10);
        buckets.push({
            label: key,
            count: countMap.get(key) ?? 0,
            uniqueVisitors: visitorsMap.get(key)?.size ?? 0
        });
        day.setUTCDate(day.getUTCDate() + 1);
    }
    return buckets;
}

/**
 * Fetch calendar-heatmap analytics over a fixed 12-month sliding window.
 * Independent of the page's timeRange selector: the heatmap always shows the same year-long grid
 * so seasonal patterns remain visible regardless of what the rest of the dashboard is filtering on.
 */
export async function getCalendarAnalytics(
    pluginId?: string,
    windowDays = 365
): Promise<AnalyticsCalendarResponse> {
    const windowEnd = new Date();
    const fromDate = new Date(windowEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const enabledPluginIds = LOG_SOURCE_PLUGINS.filter((id) => {
        const cfg = PluginConfigRepository.findByPluginId(id);
        return cfg?.enabled === true;
    });

    const isLogSourceId = (id: string): id is (typeof LOG_SOURCE_PLUGINS)[number] =>
        (LOG_SOURCE_PLUGINS as readonly string[]).includes(id);

    const pluginIds =
        !pluginId || pluginId === 'all'
            ? enabledPluginIds
            : isLogSourceId(pluginId) && enabledPluginIds.includes(pluginId)
              ? [pluginId]
              : [];

    const { entries, filesAnalyzed } = await collectParsedEntries(
        pluginIds,
        fromDate,
        windowEnd,
        { fileScope: 'all', includeCompressed: true } // always include .gz for the calendar view
    );

    const buckets = buildCalendarBuckets(entries, fromDate, windowEnd);

    // Single pass: aggregate full-window grids + live24h/live7d slices without building extra arrays.
    const now = Date.now();
    const live24hCutoffMs = now - 24 * 60 * 60 * 1000;
    const live7dCutoffMs = now - 7 * 24 * 60 * 60 * 1000;

    const fullHourDayGrid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const live7dHourDayGrid: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    const live24hHourOfDay = new Array<number>(24).fill(0);
    const live24hDayOfWeek = new Array<number>(7).fill(0);

    for (const e of entries) {
        const ts = toDate(e.timestamp);
        if (!ts) continue;
        const tsMs = ts.getTime();
        const jsDay = ts.getDay();
        const dayIdx = jsDay === 0 ? 6 : jsDay - 1;
        const hour = ts.getHours();

        fullHourDayGrid[dayIdx][hour]++;
        if (tsMs >= live7dCutoffMs) {
            live7dHourDayGrid[dayIdx][hour]++;
            if (tsMs >= live24hCutoffMs) {
                live24hHourOfDay[hour]++;
                live24hDayOfWeek[dayIdx]++;
            }
        }
    }

    return {
        buckets,
        stats: computeCalendarStats(buckets),
        hourDayGrid: fullHourDayGrid,
        live24h: { hourOfDay: live24hHourOfDay, dayOfWeek: live24hDayOfWeek },
        live7d: { hourDayGrid: live7dHourDayGrid },
        filesAnalyzed,
        windowDays
    };
}
