# TabMap — Carte Géographique des IPs Bannies

**Date:** 2026-03-25
**Status:** Implemented
**Scope:** `src/pages/fail2ban/TabMap.tsx` + backend routes in `Fail2banPlugin.ts`

---

## Purpose

Display all currently-banned IPs on an interactive world map so that administrators can visually identify attack sources, spot geographic concentrations, and drill into per-country/region breakdowns. Mirrors the `carte.php` tab in the PHP `fail2ban-web` reference app.

---

## Architecture

### Frontend (`TabMap.tsx`)

Single React component with three logical layers:

1. **CDN loader** — Leaflet 1.9.4 and MarkerCluster 1.5.3 are injected as `<script>`/`<link>` tags at mount time (same versions as the PHP reference). No npm bundle; matches the reference app's CDN-first approach.

2. **Data pipeline**
   - `GET /api/plugins/fail2ban/map` — returns all currently-banned IPs with any cached geo from SQLite (`f2b_ip_geo`), plus `resolveDelayMs` (hardcoded 380 ms in backend) and `cacheTtlDays` (30). Points with no cached geo are placed in a resolution queue.
   - Progressive resolution pump — processes the queue one IP at a time with the received `resolveDelayMs` delay (clamped to 120–2000 ms by the frontend) calling `GET /api/plugins/fail2ban/map/resolve/:ip` for each uncached IP.
   - Each resolved IP is immediately added as a marker without waiting for the full queue.

3. **Filter sidebar** — collapsible panel showing country breakdown (sorted by ban count, heat-colored). Clicking a country zooms the map to its bounding box and shows a region sub-list.

### Backend (two routes in `Fail2banPlugin.ts`)

| Route | Purpose |
|---|---|
| `GET /api/plugins/fail2ban/map` | Returns `{ ok, points: [{ip, jails, cached: GeoData\|null}], resolveDelayMs: 380, cacheTtlDays: 30 }`. Reads currently-banned IPs from SQLite bans table; hydrates geo from `f2b_ip_geo` cache (TTL 30 days). Returns `ok: false, points: []` if SQLite is not readable. |
| `GET /api/plugins/fail2ban/map/resolve/:ip` | Looks up `f2b_ip_geo`; on cache miss fetches `http://ip-api.com/json/:ip` (lat/lon/country/region/city/org), stores result, returns geo. 5 s timeout per request. |

### Database

`f2b_ip_geo` table in the LogviewR app SQLite DB (not the fail2ban DB):

```sql
CREATE TABLE IF NOT EXISTS f2b_ip_geo (
    ip          TEXT PRIMARY KEY,
    lat         REAL, lng REAL,
    country     TEXT, countryCode TEXT,
    region      TEXT, city TEXT, org TEXT,
    ts          INTEGER  -- unix epoch of last resolve
);
```

Cache TTL: 30 days. Expired entries are overwritten on next resolve.

---

## Key Design Decisions

### CDN over npm for Leaflet

Leaflet's CSS relies on image URLs relative to the JS file. Bundling it with Vite requires extra asset configuration. The PHP reference uses CDN; adopting the same approach avoids build complexity and keeps the two implementations aligned.

### Progressive resolution instead of batch

Calling `ip-api.com` in parallel for all IPs would be rate-limited (free tier: 45 req/s). Sequential pumping with a server-supplied delay (`resolveDelayMs`, hardcoded at 380 ms) respects the rate limit and gives progressive visual feedback as markers appear one by one. The frontend clamps the received value to 120–2000 ms.

### SQLite geo cache (30-day TTL)

IP-to-geo mapping is stable over weeks. Caching in the app DB avoids redundant external calls on every page load and provides instant display for IPs seen before.

### MarkerCluster for large ban sets

At global zoom levels, hundreds of markers overlap and degrade rendering. MarkerCluster groups nearby markers into a single cluster badge (showing count), expanding to individual markers on zoom or click.

---

## Component Interface

```tsx
interface TabMapProps {
    onGoToTracker?: (ip: string) => void;  // receives the clicked IP; callback for popup "Détails dans le Tracker" button
}
```

The parent `Fail2banPage.tsx` passes `(ip) => { void ip; setTab('tracker'); }` — the IP is received but navigation currently ignores it (switches to Tracker tab without pre-filtering by IP).

---

## Data Flow

```
Fail2banPage renders <TabMap>
  │
  ├─ loadScript(leaflet CDN) → setLeafletReady(true)
  │
  ├─ GET /map → { ok, points: [{ip, jails, cached?}], resolveDelayMs, cacheTtlDays }
  │     ├─ cached points → addMarker() immediately
  │     └─ uncached IPs → resolution queue
  │
  └─ Progressive pump (one IP every resolveDelayMs ms)
        GET /map/resolve/:ip → geo
        → addMarker() → setResolved(n+1)
        → applyFilter() (respects active country/region filter)
        → rebuildStats() (updates sidebar counts)
```

---

## Visual Design

- **Tile layer:** CartoCDN dark (`dark_all`) — matches the page's dark theme (`#0d1117` background).
- **Markers:** Default Leaflet blue pin (no custom icon needed — clusters dominate at overview zoom).
- **Popup:** Dark-themed HTML popup with: IP (red monospace), flag emoji + location, org, jail badges (green), "Détails dans le Tracker" button (blue).
- **Heat colors:** Country/region sidebar bars use `hsl(14–26, 36–92%, 76–34%)` — same algorithm as PHP reference — transitioning from light orange (low) to deep red-orange (high).
- **Sidebar toggle:** FAB button using the Lucide `SlidersHorizontal` icon at top-right corner of the map canvas.

---

## Error States

| Condition | Behaviour |
|---|---|
| Leaflet CDN fails to load | Error message displayed, map never renders |
| SQLite not readable | `/map` returns `ok: false, points: []`; error message shown |
| `/map` returns `ok: false` (other) | Error message shown |
| `/map` returns 0 points | "Aucune IP à afficher" empty state with globe emoji |
| Individual resolve fails | IP silently skipped (pump continues to next) |

---

## Constraints & Limits

- **ip-api.com HTTP-only:** The free tier does not support HTTPS. The backend calls `http://ip-api.com/...`. This means the server making the request must allow outbound HTTP. The frontend never contacts ip-api.com directly.
- **Rate limiting:** ip-api.com free tier: 45 req/s, 1000 req/day. `resolveDelayMs` (≥ 120 ms) keeps throughput within limits for normal ban counts (< 200 IPs).
- **Map instance lifecycle:** Created once (guarded by `if (mapRef.current) return`). Navigating away and back reuses the existing instance without re-fetching.
- **`invalidateSize` calls:** Triggered via `requestAnimationFrame` immediately after map init, again after 400 ms timeout, and on every `ResizeObserver` event and sidebar open/close (with 280 ms debounce), to handle flex layout edge cases.
- **Authentication:** Both `/map` and `/map/resolve/:ip` routes are protected by `requireAuth` middleware.
