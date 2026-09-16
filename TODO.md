# TODO

Consolidated backlog for LogviewR, checked against the codebase as of v0.14.2 (2026-09-15).
Not user-facing — internal tracking only, ignored by CHANGELOG.md.

## High priority

### 1. `LogAnalyticsPage.tsx` refactor (cognitive complexity ~37)
Only remaining Critical SonarCloud issue. Deferred since v0.9.0 ("trop compliqué pour le résultat" in one release).
Marked with a `// Note:` comment at the component declaration (`src/pages/LogAnalyticsPage.tsx:334`).

- [ ] Extract `<GraphsTab>` — timeline, unique visitors, day-of-week, peak hours, calendar heatmap, hour×day heatmap, status trends, bandwidth, bot detection
- [ ] Extract `<HttpTab>` — HTTP codes panel, methods & codes by domain
- [ ] Extract `<TopsTab>` — top 404, response time, referring sites, virtual hosts, referrer URLs, requested files
- [ ] Each tab receives data via props only, no new state duplication — parent keeps `fetchAnalytics`/`fetchCalendar`/state
- [ ] Do not mark the Sonar issue "Won't Fix" — legitimate code smell, leave Open until done

### 2. Sync fixed-window widgets with global date filter (log-analytics)
Accepted by user 2026-09-15, not started. Day of Week / Calendar Heatmap / Hour×Day Heatmap currently hardcode a 12-month window regardless of the global filter.

- [ ] Make `fetchCalendar`'s `windowDays` dynamic (currently hardcoded 365; cache key is just `pluginId` — must include the window)
- [ ] Lower server floor `Math.max(30, ...)` in `GET /analytics/calendar` (`server/routes/log-viewer.ts`) to allow 7 days
- [ ] When global filter = 7j/30j → use that window; when 1h/24h (too short) → fall back to 7j
- [ ] Make `FixedWindowBadge` / "Fenêtre fixe" group label dynamic instead of hardcoded "12 mois"
- [ ] Best done together with item #1 (same component)

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

### 9. Show file size next to the pagination "lines per page / X lines total" line (`/log/*` pages)
Raised 2026-09-16, not started. `LogTable.tsx` already receives a `fileSize` prop and displays it via `formatFileSize()` in the header stats bar (`src/components/log-viewer/LogTable.tsx:1072-1077`, next to "total lines"/"valid lines" badges). The pagination bar's compact `{linesPerPage} / {linesTotal}` line (`LogTable.tsx:1153`) doesn't show it.

- [ ] Add the file size (reuse `formatFileSize(fileSize)`, same `fileSize` prop already in scope) next to the `t('logViewer.linesPerPage')` / `t('logViewer.linesTotal', ...)` span at `LogTable.tsx:1153`
- [ ] Decide on separator/format consistent with the existing badge style at line ~1072, or a plain inline text to match the rest of that pagination row (unlike the header stats bar, this row isn't badge-styled)

## Notes / non-blocking

- **Fixed 2026-09-15**: `server/services/__tests__/logParserService.test.ts` used static imports for `connection.js`/`PluginConfig.js` after setting `DATABASE_PATH=':memory:'` — due to ESM import hoisting, the DB path froze to the real `data/dashboard.db` before the env var took effect, so `npm run test:run` was silently wiping the real `plugin_configs` table (Apache/NPM/etc configs) on every run. Fixed with the dynamic-`import()` pattern already used in `server/mcp/__tests__/*.test.ts`. **Any new test file touching `server/database/connection.ts` must use dynamic imports after the env assignment, never static ones.**
- `HostSystemFilesManager.tsx` has intentionally duplicated types (`SystemBaseFileType`/`AutoDetectedFileType`) vs. `HostSystemLogPlugin.ts` — deliberate, not a bug, since no `src/` file imports from `server/`. Must be kept manually in sync if a new type (e.g. another fail2ban variant) is added server-side.
- Manual browser test never run for the `host-system` fail2ban.log feature (columns `timestamp/level/jail/action/ip/message`, color badges Ban=red/Unban=green/Found=amber).
