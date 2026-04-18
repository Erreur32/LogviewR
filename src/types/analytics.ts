/**
 * Types for LogAnalytics page (aggregated web server log stats)
 */

export interface AnalyticsOverview {
    totalRequests: number;
    uniqueIps: number;
    status4xx: number;
    status5xx: number;
    totalBytes: number;
    filesAnalyzed: number;
    dateFrom?: string;
    dateTo?: string;
    validRequests?: number;
    failedRequests?: number;
    notFound?: number;
    staticFiles?: number;
}

export interface AnalyticsDistribution {
    key: string;
    count: number;
    percent: number;
}

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
    uniqueVisitors?: number;
    statusGroups?: AnalyticsStatusGroups;
    totalBytes?: number;
}

export interface AnalyticsTopItem {
    key: string;
    count: number;
    percent?: number;
}

export interface AnalyticsTopItemWithVisitors extends AnalyticsTopItem {
    uniqueVisitors: number;
}

export interface AnalyticsTopUrlItem extends AnalyticsTopItemWithVisitors {
    txAmount?: number;
    method?: string;
    protocol?: string;
}

export interface AnalyticsStatusByHostItem {
    host: string;
    status: string;
    count: number;
    uniqueVisitors: number;
}

export interface AnalyticsBotVsHuman {
    bots: number;
    humans: number;
    botPercent: number;
    topBots: AnalyticsTopItem[];
}

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
