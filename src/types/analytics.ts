/**
 * Types for Log Analytics (GoAccess-style stats)
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

export interface AnalyticsTimeseriesBucket {
    label: string;
    count: number;
    uniqueVisitors?: number;
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
