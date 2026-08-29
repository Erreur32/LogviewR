/**
 * Module-level TTL cache for /log-analytics API responses.
 *
 * LogAnalyticsPage uses hash-based navigation (not React Router), so the
 * component fully unmounts when the user leaves the page. A useState/useRef
 * cache would be lost on remount; a module-level object survives it.
 */

import type {
    AnalyticsOverview,
    AnalyticsTimeseriesBucket,
    AnalyticsTopItem,
    AnalyticsDistribution,
    AnalyticsDistributionWithVisitors,
    AnalyticsTopItemWithVisitors,
    AnalyticsTopUrlItem,
    AnalyticsStatusByHostItem,
    AnalyticsBotVsHuman,
    AnalyticsResponseTimeDistribution
} from '../types/analytics';

export interface AnalyticsApiResponse {
    overview: AnalyticsOverview;
    timeseries: { buckets: AnalyticsTimeseriesBucket[] };
    hourOfDay?: number[];
    distribution?: {
        methods: AnalyticsDistribution[];
        status: AnalyticsDistribution[];
        statusWithVisitors?: AnalyticsDistributionWithVisitors[];
        botVsHuman?: AnalyticsBotVsHuman;
        responseTime?: AnalyticsResponseTimeDistribution | null;
    };
    top: {
        urls: AnalyticsTopItem[];
        ips: AnalyticsTopItem[];
        status: AnalyticsTopItem[];
        ua: AnalyticsTopItem[];
        referrer: AnalyticsTopItem[];
        browser?: AnalyticsTopItem[];
        host?: AnalyticsTopItem[];
        referringSites?: AnalyticsTopItemWithVisitors[];
        referrerWithVisitors?: AnalyticsTopItemWithVisitors[];
        hostWithVisitors?: AnalyticsTopItemWithVisitors[];
        urlsWithExtras?: AnalyticsTopUrlItem[];
        statusByHost?: AnalyticsStatusByHostItem[];
        notFoundUrls?: AnalyticsTopItemWithVisitors[];
    };
}

export interface CalendarApiResponse {
    buckets: { label: string; count: number; uniqueVisitors: number }[];
    hourDayGrid: number[][];
    live24h: { hourOfDay: number[]; dayOfWeek: number[] };
    live7d: { hourDayGrid: number[][] };
}

interface CacheSlot<T> {
    key: string;
    data: T;
    timestamp: number;
}

const CACHE_TTL_MS = 60_000;

let mainSlot: CacheSlot<AnalyticsApiResponse> | null = null;
let calendarSlot: CacheSlot<CalendarApiResponse> | null = null;

function isFresh<T>(slot: CacheSlot<T> | null, key: string): slot is CacheSlot<T> {
    return slot !== null && slot.key === key && (Date.now() - slot.timestamp) < CACHE_TTL_MS;
}

export function getCachedAnalytics(key: string): AnalyticsApiResponse | null {
    return isFresh(mainSlot, key) ? mainSlot.data : null;
}

export function setCachedAnalytics(key: string, data: AnalyticsApiResponse): void {
    mainSlot = { key, data, timestamp: Date.now() };
}

export function getCachedCalendar(key: string): CalendarApiResponse | null {
    return isFresh(calendarSlot, key) ? calendarSlot.data : null;
}

export function setCachedCalendar(key: string, data: CalendarApiResponse): void {
    calendarSlot = { key, data, timestamp: Date.now() };
}
