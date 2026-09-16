# TODO

Consolidated backlog for LogviewR, checked against the codebase as of v0.14.2 (2026-09-15).
Not user-facing — internal tracking only, ignored by CHANGELOG.md.

## High priority

### 1. `LogAnalyticsPage.tsx` refactor (cognitive complexity ~37)
Only remaining Critical SonarCloud issue. Deferred since v0.9.0 ("trop compliqué pour le résultat" in one release).
Marked with a `// Note:` comment at the component declaration (`src/pages/LogAnalyticsPage.tsx:334`).

**Superseded by the validated plan in item #2bis** — the 3-tab split below (`<GraphsTab>`/`<HttpTab>`/`<TopsTab>`) is replaced by `<OverviewTab>`/`<TopsTab>`/`<HttpSecurityTab>` per the 2026-09-16 reorg decision (merges redundant widgets, moves Top 404 into Tops). Left here for history; follow #2bis for the actual extraction shape.

- [ ] Extract `<OverviewTab>` — KPI bar, merged requests-over-time, merged HTTP-codes, bandwidth, day-of-week, peak hours, calendar heatmap, hour×day heatmap
- [ ] Extract `<HttpSecurityTab>` — bot vs human detection, methods & codes by domain
- [ ] Extract `<TopsTab>` — top 404, response time, referring sites, virtual hosts, referrer URLs, requested files, top IPs/status/browsers/UA panels
- [ ] Each tab receives data via props only, no new state duplication — parent keeps `fetchAnalytics`/`fetchCalendar`/state
- [ ] Do not mark the Sonar issue "Won't Fix" — legitimate code smell, leave Open until done

### 2. Sync fixed-window widgets with global date filter (log-analytics)
Accepted by user 2026-09-15, not started. Day of Week / Calendar Heatmap / Hour×Day Heatmap currently hardcode a 12-month window regardless of the global filter.

- [ ] Make `fetchCalendar`'s `windowDays` dynamic (currently hardcoded 365; cache key is just `pluginId` — must include the window)
- [ ] Lower server floor `Math.max(30, ...)` in `GET /analytics/calendar` (`server/routes/log-viewer.ts`) to allow 7 days
- [ ] When global filter = 7j/30j → use that window; when 1h/24h (too short) → fall back to 7j
- [ ] Make `FixedWindowBadge` / "Fenêtre fixe" group label dynamic instead of hardcoded "12 mois"
- [ ] Best done together with item #1 (same component)

### 2bis. DB-first rendering for /log-analytics + tab reorganization — design validated 2026-09-16, not started
Combines the DB-first idea (raised 2026-09-16) with a page/tab reorganization the user asked to settle first, before touching the cc37 refactor (item #1/#2). Design discussed and validated by the user 2026-09-16; implementation not started.

**DB-first decisions (validated):**
- `log_daily_stats` gets enriched with JSON columns for top URLs/IPs/referers/user-agents per day (top 20 each — small enough to not matter for DB size, can raise later if needed)
- `logAnalyticsRollupService` cycle lowered from 30 min → **15 min**
- "Live" button scope: **today only** (completes what the 15-min-stale rollup hasn't caught up on yet) — not a full custom-range override
- Dates before the rollup existed: **automatic fallback** to the current raw-log-scan behavior, no "no data" dead end
- Rollup-backed data serves the fixed-window/period-filtered aggregate widgets instantly; anything needing full per-line detail (methods & codes by domain, bot detection) still needs a scan

**Tab reorganization (validated), found while auditing the current 3 tabs (Graphs/HTTP/Tops) for redundancy:**
- Found real duplication, not just a cc37 complexity artifact: "Distribution temporelle" + "Visiteurs uniques" + "Requêtes dans le temps" are 3 widgets plotting the *same* `trimmedTimeseries` count/visitors series; "Tendance des codes HTTP" + "Codes HTTP" + "Top codes HTTP" are 3 views of the same 2xx/3xx/4xx/5xx breakdown; "Top URLs"/"Top Référents" small panels duplicate the "Requested Files"/"Referrer URLs" detailed tables covering the same data.
- [ ] New tab **"Vue d'ensemble"**: KPI bar, ONE merged requests-over-time widget (bar/curve toggle + optional unique-visitors line, replacing the 3 redundant ones), ONE merged HTTP-codes widget (snapshot/trend toggle, replacing the 3 redundant ones), bandwidth, day-of-week/peak-hours/calendar-heatmap/hour×day-heatmap (unchanged, already well-organized into "filtered by period" vs "fixed window" groups) — this tab becomes fully rollup-backed, always instant
- [ ] New tab **"Top / Classements"**: one representation per category, no duplicate formats — keep the **detailed tables/dual-bar-charts** for URLs and referrers (they carry hits+visitors+bytes+method/protocol, more info than the small panels), drop their small-`TopPanel` duplicates; **keep the compact `TopPanel` format** for IPs/status/browsers/user-agents since no detailed-table equivalent exists for them (not worth building one just for uniformity); **Top 404 moves here** from the HTTP tab (it's a "top list" like the others, no strong reason it was split out)
- [ ] Tab **"HTTP / Sécurité"** (renamed from "HTTP"): keeps Bot vs Human detection + Methods & codes by domain — the two diagnostics that don't reduce well to a daily JSON blob (per-domain breakdown is high-cardinality), most likely to keep needing a live scan
- [ ] KPI bar vs. "Group A" stats tiles (total/unique/avg-day/avg-hour/peak-day/peak-hour) in the old `section-filtered-stats` also overlap partially — revisit when building the merged Overview tab, don't necessarily keep both as-is

**Suggested execution order** (user left this to the assistant's judgment):
1. [x] **DONE (2026-09-16, commit `6314490`)** — Extend `log_daily_stats` schema (JSON top-N columns) + extend `logAnalyticsRollupService.ts` to compute/store them, bump cycle to 15 min
2. [x] **DONE (2026-09-16)** — Backend read path: `server/services/logAnalyticsHybridService.ts` (`getHybridAnalytics()`), DB-first for covered dates, automatic raw-scan fallback (grouped into contiguous ranges) for dates the rollup doesn't cover, `live` option re-scans today instead of trusting its (up to 15-min-stale) rollup row. New route `GET /api/log-viewer/analytics/rollup`. Also added `status_404`/`static_files` columns to the rollup (needed so the KPI bar's "Not Found"/"Static Files" tiles can be DB-first too). Covers only what the rollup stores (overview, day-bucketed timeseries, top-20 urls/ips/referrer/ua) — NOT a drop-in replacement for `getAllAnalytics()`'s full `AnalyticsResult` (no per-item visitors, no method/protocol breakdown, no bot detection, no response time). Tests: `logAnalyticsHybridService.test.ts` (4 cases: fully-covered, partial-coverage fallback, live-refresh, no-plugin-resolved). Not yet consumed by the frontend.
3. [x] **DONE (2026-09-16, commit `876c9f5`)** — Wired `LogAnalyticsPage.tsx` onto the new DB-first path: `fetchQuickAnalytics()` fills overview/timeseries/top-N instantly from `/analytics/rollup` on mount, `fullDataArrivedRef` guards against overwriting once the full raw-scan fetch lands, "Aperçu instantané" badge shows rollup/scanned coverage while loading, new "Live" button re-scans only today. i18n keys added. `npx tsc` 0 errors, 86/86 tests pass. Browser visual verification not done, `localhost` blocked by Chrome extension site permissions in this session.
4. [ ] Only then do the tab reorg + cc37 component extraction (items #1/#2) together — merging widgets and splitting into `<OverviewTab>`/`<TopsTab>`/`<HttpSecurityTab>` is the same piece of work at that point, no reason to do it twice
5. [ ] Item #2's fixed-window/global-filter sync becomes easier once step 2 gives flexible date-range DB queries

### 3. Fail2ban tooltip i18n audit — DONE (2026-09-15)
Fixed: `TabConfig.tsx` (sync + Netfilter tooltips, incl. `WarnBadge` hover tip), `TabStats.tsx` ("Fichiers logs NPM"), `Fail2banPage.tsx` (the "Bans (period)" mini-card tooltip, which was fully hardcoded unlike its 5 siblings). All other `F2bTooltip`/`TT` usages across the fail2ban files were already using `t()`. Keys added to `en.json`/`fr.json`. `README.md` "Known TODO" entry removed. `npx tsc` 0 errors, tests pass.

## Medium priority

### 4. Suspicious-IP allowlist (Error logs detection) — DONE (2026-09-16)
`suspiciousIpAllowlist: string[]` added to `ErrorAnalysisConfig`, sanitized/capped at 200 entries. `analyzeSuspiciousActivity()` skips any line whose IP is allowlisted, across all 3 check categories (403/401, injection, bruteforce). UI: textarea in Settings > Analysis (draft-state + parse-on-blur pattern). 2 new unit tests. i18n fr/en added. `npx tsc` 0 errors, `npm run test:run` 76/76.

### 5. Daily rollup table for long-term log stats — DONE (2026-09-16)
Proposed 2026-09-15, implemented 2026-09-16. Removes the structural dependency on raw log files (rotation/retention/multi-vhost) for long-term stats, in preparation for item #1/#2 above.

- [x] Table `log_daily_stats` (date, plugin_id, count, unique_ips, total_bytes, status groups) — `server/database/connection.ts`
- [x] Periodic feeder service, same pattern as `Fail2banSyncService` — `server/services/logAnalyticsRollupService.ts` (every 30 min, recomputes today + yesterday only, no retroactive backfill)
- [x] Unit tests (aggregation math, upsert idempotency, filtered reads) — `server/services/__tests__/logAnalyticsRollupService.test.ts`
- [ ] Not yet wired into `getCalendarAnalytics`/`LogAnalyticsPage` — deferred to the item #1/#2 refactor session
- Estimated volume: ~365 rows/year/plugin — negligible

### 6. NPM database ACL fix on host `myoueb`
Code-side fix already shipped (explicit warning instead of silent "0 bans"). Root cause is host permissions, out of repo scope — needs manual action on the `myoueb` host itself.

- [ ] `sudo setfacl -m u:1000:r /home/docker/nginx_proxy/data/database.sqlite` on host `myoueb` (192.168.32.150)
- [ ] Re-verify with `docker exec -u node logviewr sh -c 'cat <path> > /dev/null; echo $?'` after the fix

## Low priority / decisions needed

### 7. Remove Rybbit analytics tracking — DONE (2026-09-16)
Raised 2026-09-15: `way.myoueb.fr` endpoints returned 404 (`/api/track`, `/api/site/tracking-config/...`) — the injected script was dead weight. Decision made 2026-09-15: full ripout, not just a runtime opt-out.

- [x] Remove injection block in `src/main.tsx` (was lines ~76-80)
- [x] Clean up `Dockerfile` `ARG VITE_ANALYTICS_HOST`/`ARG VITE_ANALYTICS_SITE_ID` + `ENV` declarations
- [x] Clean up `.github/workflows/docker-publish.yml` build-args
- [x] Clean up `docker-compose.local.yml` build.args
- [x] `npx tsc` (0 errors) + `npm run test:run` (74/74) after removal
- [x] Code changes committed (`dff0976`, 2026-09-16, not yet pushed)
- [x] Remove GitHub secrets `VITE_ANALYTICS_HOST`/`VITE_ANALYTICS_SITE_ID` — deleted 2026-09-16 with explicit user confirmation, verified gone via `gh secret list`
- [x] CHANGELOG.md entry — added under `[0.14.3]` (2026-09-16), not yet committed, version not bumped via `scripts/update-version.sh` yet

### 8. Snyk Code (SAST) job disabled — to re-enable later
`snyk-code` job in `.github/workflows/snyk.yml` has `if: false` (confirmed) — disabled 2026-09-14 because Snyk Code isn't enabled on the `erreur32` Snyk org/plan.

- [ ] Deferred by user (2026-09-15): re-enable later, not now
- [ ] When picked back up: enable Snyk Code in Settings > Snyk Code on app.snyk.io (if plan allows), then flip `if: false` → normal condition in `.github/workflows/snyk.yml`

### 9. Show file size next to the pagination "lines per page / X lines total" line (`/log/*` pages) — DONE (2026-09-16)
- [x] Added `· {formatFileSize(fileSize)}` (guarded on `fileSize !== undefined && fileSize > 0`, same prop already in scope) right after the `t('logViewer.linesPerPage')` / `t('logViewer.linesTotal', ...)` span at `LogTable.tsx:1153` — plain inline text (`text-gray-600`), not badge-styled, to match the rest of that pagination row.

### 10. Optimize animated backgrounds (perf) — audit done 2026-09-16, no code changed yet
Raised after spotting recurring Chrome "[Violation] 'requestAnimationFrame' handler took Nms" warnings on `/log-analytics`. Root cause confirmed unrelated to log-analytics: it's `src/components/AnimatedBackground.tsx`'s decorative background variants, happens on any page. Audited all canvas-based variants (13 total in `FULL_ID_TO_VISUAL`) for the same anti-patterns (large per-frame grid, full-array sort/O(n²) every frame, no FPS cap) — findings below, ordered by priority. Nothing coded yet, per explicit request to audit-only first.

**High priority (comparable or worse than the original particle-waves finding):**
- [ ] `ParticleWavesCanvas` (`animation.80.particle-waves`, ~line 698) — ~6400-point 3D grid (`distance=5` over ~400×400) recomputed **and** `Array.prototype.sort()`-by-depth every frame, no FPS cap. The original finding.
- [ ] `BitOceanCanvas` (`animation.95.bit-ocean`, ~line 2144) — same scale: 80×80 = 6400-vertex grid (`gridSize=400`, `spacing=5`), each vertex runs a noise() calculation every frame, no FPS cap. No sort, so slightly cheaper than particle-waves, but same order of magnitude.
- [ ] `PlaystationCanvas` (`animation.72.playstation-3-bg-style`, ~line 996) — heaviest per-frame grid of all variants: 129×129 (`gridRes=128`) ≈ 16,641 points, each cell draws 2 triangles with a full normal/lighting calculation done **twice** per cell (once "general", once again per-triangle — looks like leftover/redundant computation, not intentional). Already has partial mitigation: `targetFPS` (default 60) + `enableAnimationTimeout` (default true, freezes the animation entirely after 5s) — real-world impact is capped unless a user disables the timeout via animation parameters.

**Lower priority (moderate cost, no FPS cap either):**
- [ ] `ParticulesLineCanvas` (`animation.93.particules-line`, ~line 823) — fixed 16×12=192 particles, O(n²) pairwise link-distance check (~18k `Math.hypot` calls/frame). Real but much smaller than the grid-based ones above.

**Already mitigated, low priority:** `AuroraCanvas`/`AuroraV2Canvas`/`AlienBlackoutCanvas` all have the same `targetFPS`+`enableAnimationTimeout` (5s auto-freeze) pattern as Playstation built in.

**Not a concern:** `HomeAssistantParticlesCanvas` (50 particles), `CanvasRibbons` (3 waves × 120 lines), `CssDarkParticles` (pure CSS animation, no canvas/rAF), `StarsCanvas`/`SpaceCanvas`/`SidelinedCanvas` (moderate particle counts, no grid/sort/O(n²) pattern found).

- [ ] When picked up: for the grid-based ones (particle-waves, bit-ocean, playstation), reduce point density and/or add the same `targetFPS`/`enableAnimationTimeout` pattern the Aurora/AlienBlackout variants already use, consistently across all variants instead of ad hoc per-animation.
- [ ] Not urgent, independent of the `/log-analytics` DB-first work — pick up whenever background-animation performance is worth revisiting

## Notes / non-blocking

- **Fixed 2026-09-15**: `server/services/__tests__/logParserService.test.ts` used static imports for `connection.js`/`PluginConfig.js` after setting `DATABASE_PATH=':memory:'` — due to ESM import hoisting, the DB path froze to the real `data/dashboard.db` before the env var took effect, so `npm run test:run` was silently wiping the real `plugin_configs` table (Apache/NPM/etc configs) on every run. Fixed with the dynamic-`import()` pattern already used in `server/mcp/__tests__/*.test.ts`. **Any new test file touching `server/database/connection.ts` must use dynamic imports after the env assignment, never static ones.**
- `HostSystemFilesManager.tsx` has intentionally duplicated types (`SystemBaseFileType`/`AutoDetectedFileType`) vs. `HostSystemLogPlugin.ts` — deliberate, not a bug, since no `src/` file imports from `server/`. Must be kept manually in sync if a new type (e.g. another fail2ban variant) is added server-side.
- Manual browser test never run for the `host-system` fail2ban.log feature (columns `timestamp/level/jail/action/ip/message`, color badges Ban=red/Unban=green/Found=amber).
