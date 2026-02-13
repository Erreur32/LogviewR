# Log Analytics (GoAccess-style) – Architecture

## Overview

This document describes the architecture and data flow of the **Stats Logs** page, a full-screen log analytics dashboard inspired by [GoAccess for Nginx Proxy Manager](https://github.com/xavier-hernandez/goaccess-for-nginxproxymanager).

## Purpose

- Provide a dedicated page for graphical log statistics (KPI, timeline, top panels)
- Accessible via a footer button next to "Analytique"
- Scope configurable by plugin (NPM by default, extensible to Nginx, Apache)
- No external dependencies; native React + backend aggregation

## Components

### Frontend

| File | Role |
|------|------|
| `src/pages/GoAccessStyleStatsPage.tsx` | Main page: KPI cards, timeline histogram, top panels (URLs, IPs, status, UA, referrers) |
| `src/types/analytics.ts` | TypeScript types for overview, timeseries, top items |
| `src/components/layout/Footer.tsx` | New "Stats Logs" button (icon-only, next to Analytique) |
| `src/App.tsx` | Routing for `currentPage === 'goaccess-stats'` |
| `src/components/layout/Header.tsx` | Plugin icons and document title for goaccess-stats page |

### Backend

| File | Role |
|------|------|
| `server/services/logAnalyticsService.ts` | Aggregation logic: collect parsed access logs, compute overview, timeseries, top metrics |
| `server/routes/log-viewer.ts` | `GET /api/log-viewer/analytics` route |

## Data Flow

```
Footer button (Stats Logs)
    → setCurrentPage('goaccess-stats')
    → App.tsx renders GoAccessStyleStatsPage
    → Page fetches GET /api/log-viewer/analytics?pluginId=&from=&to=&bucket=&topLimit=
    → logAnalyticsService.getAllAnalytics()
        → collectParsedEntries() for each plugin (npm, nginx, apache)
        → logParserService.parseLogFile() per access log file
        → computeOverview(), computeTimeseries(), computeTop()
    → Response: { overview, timeseries: { buckets }, top: { urls, ips, status, ua, referrer } }
    → Page renders KPI, MiniBarChart, TopPanel components
```

## API

### GET /api/log-viewer/analytics

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `pluginId` | string | Optional. Filter by plugin: `npm`, `nginx`, `apache`. Omit or `all` for all plugins. |
| `from` | ISO date | Optional. Start of time window. |
| `to` | ISO date | Optional. End of time window. |
| `bucket` | `minute` \| `hour` | Optional. Timeseries bucket size. Default: `hour`. |
| `topLimit` | number | Optional. Max items per top list. Default: 10, max: 50. |

**Response:**

```json
{
  "success": true,
  "result": {
    "overview": {
      "totalRequests": 1234,
      "uniqueIps": 42,
      "status4xx": 10,
      "status5xx": 2,
      "totalBytes": 5678901,
      "filesAnalyzed": 5
    },
    "timeseries": {
      "buckets": [
        { "label": "2026-02-13T10", "count": 120 },
        { "label": "2026-02-13T11", "count": 95 }
      ]
    },
    "top": {
      "urls": [{ "key": "/api/test", "count": 50, "percent": 4 }],
      "ips": [{ "key": "192.168.1.1", "count": 30, "percent": 2 }],
      "status": [{ "key": "200", "count": 1100, "percent": 89 }],
      "ua": [...],
      "referrer": [...]
    }
  }
}
```

## Performance Limits

- **MAX_LINES_PER_FILE**: 5000 lines per access log file
- **MAX_FILES_TOTAL**: 20 files across all plugins
- Only **non-compressed** access logs are processed (`.gz` excluded unless `readCompressed` is enabled)
- Supported plugins: **npm**, **nginx**, **apache** (host-system logs are syslog, not HTTP access format)

## i18n

Namespace: `goaccessStats` (fr.json, en.json)

Keys: `title`, `subtitle`, `back`, `refresh`, `loading`, `loadError`, `noData`, `allPlugins`, `totalRequests`, `uniqueVisitors`, `status4xx`, `status5xx`, `totalBytes`, `filesAnalyzed`, `requestsOverTime`, `requests`, `topUrls`, `topIps`, `topStatus`, `topUserAgents`, `topReferrers`

Footer tooltip: `footer.goaccessStatsTooltip`
