# Changelog

All notable changes to LogviewR will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.55] - 2026-04-16

### For users

- **Fix Apache/Nginx log timestamps shifted by your local TZ offset** — the container now defaults to `Europe/Paris` (was UTC); override via `TZ=...` in `.env`. Without this, `[Thu Apr 16 22:25 2026]` from Apache (written in host local time, no TZ info) was rendered as `17/04 00:25` (+2h shift, next day). Pull the new image and recreate the container to apply.
- **Fix oversized "Time" column on access logs** — on access logs (apache/nginx/npm) the `timestamp` column was inflated on wide screens because no column absorbed the leftover space. The widest text column now absorbs it (priority `message > userAgent > referer > url > last`), keeping `timestamp` at its declared 185 px.
- **Show all NPM log files** — `letsencrypt.log` (+ rotated `.1`…`.N`) and `fallback_http_*` / `fallback_stream_*` files were silently filtered out. Patterns broadened so they now appear in the file selector. Letsencrypt files are typed as `error` (certbot operation log).
- **Raw view: pagination at the top + far more visible at the bottom** — added prev/next/first/last controls in the top header and restyled the bottom bar (cyan accent, shadow, brighter counter). Useful when a file has many pages — easier to jump to the end.

### Technical

- **`Dockerfile`** — added `tzdata` package to the runtime stage so `TZ=Europe/Paris` (etc.) is actually honored; without it Alpine knows only UTC.
- **`docker-compose.yml` / `docker-compose.fail2ban.yml` / `docker-compose.local.yml`** — added `TZ: ${TZ:-Europe/Paris}` env var.
- **`README.md`** — documented `TZ` in the env vars table.
- **`src/components/log-viewer/LogTable.tsx`** — colgroup now picks one absorbing column with `width: auto` so leftover space goes to that column instead of being distributed proportionally across all (which inflated `timestamp` under `table-fixed` + `w-full`). Global fix — applies to every plugin/logType.
- **`server/plugins/npm/NpmLogPlugin.ts`** — patterns broadened: `fallback_*.log*` (covers `_http_`, `_stream_` variants) and `letsencrypt*.log*` (covers `letsencrypt.log` + rotated). `determineLogType()` classifies `letsencrypt*` as `error`.
- **`src/pages/LogViewerPage.tsx`** — extracted `goToRawPage` + `rawPaginationControls` (« ← page X/Y → ») reused in top header and bottom bar (no JSX duplication).

---

## [0.8.54] - 2026-04-16

### For users

- **Fix Docker startup crash** — `docker compose up` failed with "Unable to find group" when fail2ban was not installed. The `FAIL2BAN_GID` (empty default) and fail2ban socket mount are now commented out by default.
- **Setup script auto-configures docker-compose.yml** — `setup-fail2ban-access.sh` now writes `FAIL2BAN_GID` to `.env` and uncomments fail2ban lines in `docker-compose.yml` automatically (no manual editing needed).
- **Renamed container** — `logviewr-dev` → `logviewr` (production name).

### Technical

- **`docker-compose.yml`** — `FAIL2BAN_GID` group_add and socket mount commented by default; container renamed.
- **`scripts/setup-fail2ban-access.sh`** — section 7 rewritten: auto-patches `.env` + `docker-compose.yml`, idempotent, respects `--check` mode.
- **`README.md` / `README.fr.md`** — installation steps reordered (`.env` + compose first, then optional fail2ban script), added wget alternative.

---

## [0.8.53] - 2026-04-15

### Technical

- **SonarCloud cleanup (~60 issues)** - sanitize log injection in API client, replace regex with string literals in `replaceAll`, add `role`/`tabIndex`/`onKeyDown` accessibility on interactive elements, associate form labels with controls via `htmlFor`/`id`, fix identical conditional branches, fix async Promise executor in MqttService, use `Number.isFinite`/`codePointAt` over globals, add `tabIndex={-1}` on `aria-hidden` canvas elements. Files: `client.ts`, `AnimatedBackground.tsx`, `ExporterSection.tsx`, `ThemeSection.tsx`, `PluginsManagementSection.tsx`, `SettingsSection.tsx`, `Header.tsx`, `DownloadDetails.tsx`, `LogsManagementSection.tsx`, `GrokPatterns.ts`, `HostSystemLogPlugin.ts`, `WebhookService.ts`, `MqttService.ts`, `metricsService.ts`, `updates.ts`, `index.ts`, `Fail2banPlugin.ts`.

---

## [0.8.52] - 2026-04-15

### For users

> Fixes rate limiting that blocked the UI after navigating between tabs, and stops the sync-status banner from polling every 2 seconds permanently.

- **Fix 429 rate limit blocking UI** - rate limit increased from 60 to 300 requests/min for fail2ban routes. Navigating between tabs no longer causes "Too Many Requests" errors.
- **Fix sync-status polling storm** - the sync progress banner now polls every 30s when idle (was 2s permanently), speeding up to 2s only during active sync.
- **Docker local build** - `docker-compose.local.yml` now mirrors production with MODE A/B comments, `security_opt`, and optional volume mounts.

### Technical

- **`server/plugins/fail2ban/Fail2banPlugin.ts`** - rate limiter raised from 60 to 300 req/min per IP.
- **`src/pages/fail2ban/SyncProgressBanner.tsx`** - adaptive polling: 30s idle, 2s during sync. Removed `visible` from useEffect deps to prevent interval re-creation loops.
- **`docker-compose.local.yml`** - added MODE B (network_mode: host + NET_ADMIN) commented, `security_opt`, optional VACUUM/config bind mounts.

---

## [0.8.51] - 2026-04-15

### For users

> Fixes fail2ban socket saturation that caused all tabs to fail after ~220 seconds, requiring a Docker restart.

- **Fix fail2ban socket crash** - all fail2ban-client commands are now rate-limited to 3 concurrent executions max, preventing socket saturation from parallel polling.
- **Status cache extended** - `/status` endpoint cache increased from 8s to 15s to reduce redundant fail2ban-client calls.

### Technical

- **`server/plugins/fail2ban/Fail2banClientExec.ts`** - added `Semaphore` class limiting concurrent `execFile` calls to 3. All `fail2ban-client` invocations now queue through the semaphore instead of running unbounded in parallel.
- **`server/plugins/fail2ban/Fail2banPlugin.ts`** - `/status` route cache TTL increased from 8s to 15s.

---

## [0.8.50] - 2026-04-15

### For users

> Live map now shows your server position with a green pulsing marker, attack arcs stay visible longer, and replay works smoothly with animated panning.

- **Server marker on live map** - green pulsing dot shows your server's location with a "Your server" popup on click.
- **Attack arcs stay visible** - arcs now remain visible at 35% opacity after animation (were disappearing completely after 4s).
- **Smooth replay** - clicking an event now uses animated panning (`flyToBounds`) instead of instant jump, with arc drawn after pan completes.

### Technical

- **`TabMap.tsx`** - added `serverMarkerRef` + `addServerMarker()` with `f2b-server-pulse` CSS animation. Changed `fitBounds` to `flyToBounds` with 1.2s duration in `replayEvent`. Attack-fly animation ends at `opacity: 0.35` instead of `0`. Server marker lifecycle tied to live mode toggle.

---

## [0.8.49] - 2026-04-15

### For users

> Security hardening: revoked JWT tokens now survive container restarts, WebSocket connections are rate-limited, and SonarCloud accessibility issues are fixed.

- **JWT revocation persists across restarts** - logging out or banning a user now permanently invalidates their token, even if the container is restarted.
- **WebSocket rate limiting** - protection against message flooding on WebSocket connections (60 msgs / 10s window).

### Technical

- **`server/database/connection.ts`** - added `revoked_tokens` table (token TEXT PK, expires_at INTEGER).
- **`server/services/authService.ts`** - `revokeToken()` now persists to SQLite. Added `loadRevokedTokens()` on startup. `cleanupRevokedTokens()` cleans both memory and database.
- **`server/services/logsWebSocket.ts`** - per-connection rate limiter (60 msgs / 10s), closes with code 4429 on exceed.
- **`src/pages/fail2ban/TabMap.tsx`** - fixed SonarCloud issues: added `role="button"` + `tabIndex` + `onKeyDown` for accessibility, added braces to conditional statements, extracted `mergeLiveEvents()` to reduce nesting depth.

---

## [0.8.48] - 2026-04-15

### For users

> Fail2ban navigation reorganized, NFTables merged into IPTables with sub-tabs, blocklist tab fixed, and live map attacks are now visible much longer with replay support.

- **Blocklist tab fix** - clicking the Blocklists tab now correctly shows blocklists instead of jails.
- **NFTables merged into IPTables** - the IPTables tab now has sub-tabs (IPTables / NFTables) instead of two separate top-level tabs.
- **Navigation reorganized** - Fail2ban category now contains only core views (Jails, Filters, Actions). New "Analysis" category for Tracker, Map, Stats. Ban Manager moved to "Firewall" category alongside IPTables, IPSet, and Blocklists.
- **Live map attack arcs last longer** - attack arcs now stay visible for 10 seconds (was 2.7s), pulsing dots for 15 seconds (was 6s), with a slower animation for better visibility.
- **Replay attacks on map** - click any event in the live sidebar to replay its attack arc. A "Replay last attack" button appears at the top of the sidebar.
- **Live mode pre-loads recent bans** - activating live mode immediately loads the 10 most recent bans from the database, so the list is never empty.

### Technical

- **`Fail2banPage.tsx`** - removed `nftables` from `NAV_GROUPS`, `VALID_TABS`, `TabId` type, and tooltip map. Added `blocklists` to `VALID_TABS`. Reorganized nav groups into 4 categories (Fail2ban, Analysis, Firewall, Tools). Removed unused `Server` icon import.
- **`TabIPTables.tsx`** - renamed main component to `IPTablesContent`, added `TabNFTables` import and sub-tab selector with `FirewallSubTab` type.
- **`TabMap.tsx`** - increased arc timeout (2.7s to 10s), dot timeout (6s to 15s), CSS animation (2.5s to 4s). Added `replayEvent()` with `fitBounds`. Pre-loads last 10 bans on live mode activation. Sidebar events are clickable for replay.
- **`types.ts`** - removed `nftables` from `TabId` union.
- **`en.json` / `fr.json`** - added `fail2ban.tabs.analysis` key.

---

## [0.8.45] - 2026-04-13

### For users

> Badges in the log viewer are now visually distinct per column - each column type has its own color palette and shape, making logs easier to scan at a glance.

- **Distinct badge styles per column** - Method (solid filled), Status (bordered, 3xx now violet), Level (8 severity shades), Response Time (teal for fast), Size (outline only), Gzip (minimal flat), Upstream (purple bordered).
- **IP vs Username differentiation** - IP badges use cool tones (blue/cyan/indigo) with solid dark fill; Username badges use warm tones (orange/pink/amber) with left-border accent. No more identical colors.
- **Hostname badges** - pastel tones with dashed border, visually distinct from both IP and Username.
- **Timestamp day/night cycle** - timestamps now show a subtle dark-to-slate-blue gradient matching time of day (near-black at night, faded blue at noon), replacing the previous vivid rainbow colors.

### Technical

- **`src/utils/badgeColors.ts`** - rewritten: IP restricted to hue 170-270 (cool), Username to hue 0-60/320-360 (warm) with left-border style, Hostname pastel with dashed border, Timestamp uses single neutral hue (220) with lightness 11-48% day/night cycle.
- **`src/components/log-viewer/LogBadge.tsx`** - rewritten with inline styles per type instead of shared Badge variants: solid methods, bordered status codes, teal response time, outline sizes, minimal gzip.
- **`src/components/log-viewer/LogTable.tsx`** - cleaned unused color function imports, updated user/hostname badge classNames to match new style system.

---

## [0.8.44] - 2026-04-13

### For users

> Click any IP in the log viewer → "Details" now shows full network information (WHOIS, geolocation, hostname, known provider) - and if fail2ban is active, also ban status, history, and actions.

- **IP detail modal from LogViewer** - now displays geo (country, city, flag), WHOIS (org, ASN, CIDR, netname), reverse DNS hostname, and known cloud provider detection for any IP address.
- **Fail2ban integration in LogViewer** - when fail2ban plugin is enabled, the IP detail modal also shows ban status, jail info, timeline, actions (ban/unban), and source log activity.
- **Fail2ban activation fix** - the plugin toggle in Settings was stuck (deadlock: test required enabled, enable required test). Now works in both Docker and dev mode.

### Technical

- **`server/services/ipLookupService.ts`** - new shared service: `runWhois`, `reverseDns`, `fetchGeo`, `checkKnownProvider`, `lookupIp` extracted from Fail2banPlugin to avoid duplication.
- **`server/routes/ipLookup.ts`** - new route `GET /api/ip/:ip/lookup` with rate limiting, independent of fail2ban plugin.
- **`server/plugins/fail2ban/Fail2banPlugin.ts`** - `testConnection()` no longer requires `isEnabled()`, fixing the activation deadlock; imports shared IP lookup functions; added direct DB fallback when reader not yet initialized.
- **`src/pages/fail2ban/IpModal.tsx`** - hybrid mode: always fetches generic IP lookup, attempts fail2ban endpoints gracefully; sections auto-hide when fail2ban is unavailable.

---

## [0.8.43] - 2026-04-12

### Technical

- **`src/components/log-viewer/LogTable.tsx`** - Level/severity column widths increased from 56px to 72px to fix missing right padding on badge text.

---

## [0.8.42] - 2026-04-12

### Technical

- **`src/components/log-viewer/LogTable.tsx`** - IP column widths increased from 114px to 145px (`ip`, `ipaddress`, `clientip`, `remoteip`) to accommodate ShieldAlert banned-IP icon without overflowing into the next column.
- **`src/components/ui/Badge.tsx`** - Badge background opacity increased from 10% to 30% and text colors lightened (`text-*-400` to `text-*-300`) for better readability on dark backgrounds.

---

## [0.8.41] - 2026-04-12

### For users

> Right-click any IP in the log viewer to exclude it from results or ban it via fail2ban.

- **IP context menu** - Click any IP address in log tables to open a menu with "Exclude from logs" and "Ban with fail2ban" options.
- **Ban IP modal** - Select a jail, see if the IP is already banned, and ban directly from the log viewer.
- **Banned IP indicator** - A red shield icon appears next to IPs currently banned by fail2ban.

---

### Technical

- **`src/components/log-viewer/IpContextMenu.tsx`** - New dropdown component on IP cell click (Exclude / Ban).
- **`src/components/log-viewer/BanIpModal.tsx`** - Modal with jail selector, already-banned detection, inline fail2ban palette.
- **`src/components/log-viewer/LogTable.tsx`** - ShieldAlert icon on banned IPs, `bannedIpsMap` prop, IP cell click handler.
- **`src/pages/LogViewerPage.tsx`** - Fetches banned IPs map from `/api/plugins/fail2ban/status` on mount.
- **Code quality (SonarCloud)** - `ParserUtils.ts` extraction, regex backtracking elimination, rate limiting on `/api/logs` (CodeQL), a11y keyboard listeners, `node:` prefix on built-in imports.

---

## [0.8.40] - 2026-04-10

### For users

> Code quality & security hardening - no visible changes, same features.

- **Security audit clean** - All SonarCloud security issues resolved (was D, now A). All CodeQL alerts resolved.
- **Reliability improvements** - 500+ code modernizations (ES2015+ methods) reducing reliability issues by 63%.

---

### Technical

- **SonarCloud security hotspots** - Regex DoS fix in ApacheParser (split instead of backtracking regex), HTTPS for blocklist URLs, `crypto.randomBytes()` replacing `Math.random()`.
- **CodeQL fixes** - `safe-regex2` for user-controlled regex validation, `express-rate-limit` on user routes, `globToRegex` utility with full regex escaping (replaces 8 duplicated inline implementations).
- **ES2015+ migration** - `parseInt`→`Number.parseInt`, `parseFloat`→`Number.parseFloat`, `isNaN`→`Number.isNaN`, `.replace(/g)`→`.replaceAll(/g)` across 77 files.
- **Code deduplication** - `shouldExcludeByFilters()` and `ExcludeFilters` type extracted to BasePlugin, `globToLogRegex()` utility for rotation-aware log matching. Net -200 lines removed from plugin files.
- **Version script** - `sonar-project.properties` added as 7th versioned file in `update-version.sh`.

---

## [0.8.39] - 2026-04-10

### For users

> Security hardening based on SonarCloud hotspot review - no functional changes.

- **Regex DoS fix** - Apache log parser no longer uses a backtracking-vulnerable regex; replaced with linear-time string splitting.
- **HTTPS blocklist** - BruteForceBlocker blocklist now fetched over HTTPS instead of plain HTTP.

---

### Technical

- **`server/plugins/apache/ApacheParser.ts`** - Replaced `(.+?)\s+(\S+)$` regex in `parseRequest()` with `split(/\s+/)` to eliminate super-linear backtracking risk (SonarCloud S5852).
- **`server/plugins/fail2ban/BlocklistService.ts`** - Upgraded `danger.rulez.sk` URLs from `http://` to `https://` (SonarCloud S5332).
- **`server/plugins/notification/NotificationService.ts`** - Replaced `Math.random()` with `crypto.randomBytes()` for notification IDs (SonarCloud S2245).
- **`server/services/MqttService.ts`** - Replaced `Math.random()` with `crypto.randomBytes()` for MQTT client IDs (SonarCloud S2245).

---

## [0.8.38] - 2026-04-09

### For users

> Navigation now uses clean URLs - bookmarkable, refreshable, and tracked by Rybbit analytics.

- **Clean URL navigation** - Pages now use proper URLs (`/fail2ban/stats`, `/settings/security/users`, `/log/nginx?file=...`) instead of hash fragments (`#fail2ban/stats`). Refreshing the browser keeps you on the same page and tab.
- **Rybbit analytics** - Opt-in pageview tracking via self-hosted Rybbit (Umami clone). Each page and tab is tracked individually. Disabled by default - requires `VITE_ANALYTICS_HOST` and `VITE_ANALYTICS_SITE_ID` in `.env`.
- **Favicon** - Browser tab now shows the LogviewR icon instead of a 404.

---

### Technical

#### Frontend

- **React Router migration** - Replaced hash-based navigation (`window.location.hash` + `parseHashNav()`) with `react-router-dom` v7 (`BrowserRouter`, `useLocation`, `useNavigate`). `currentPage` derived from `location.pathname` via `pathToPage()` helper. All `setCurrentPage()` calls replaced with `navigate()`.
- **`src/App.tsx`** - Removed 165 lines: `parseHashNav()`, `HashNav` type, `VALID_FAIL2BAN_TABS`, `isSafeFilePath()`, hash sync useEffects, `hashchange` listener, sessionStorage deep link stashing. Added `pageToPath()`/`pathToPage()` helpers, URL-derived state via `useMemo`.
- **`src/pages/Fail2banPage.tsx`** - Tab derived from `useLocation().pathname.split('/')[2]` with `VALID_TABS` validation. `setTab()` wrapped in `useCallback` calling `navigate()`.
- **`src/pages/SettingsPage.tsx`** - Tab/subtab derived from `useLocation().pathname.split('/')`. Removed hash sync useEffect and `#admin` hash check.
- **`src/main.tsx`** - Wrapped `<App>` with `<BrowserRouter>`. Added Rybbit script tag injection (opt-in, `disableSessionReplay=true`).
- **`src/components/widgets/LargestFilesCard.tsx`** - Converted last hash link to Router URL.
- **`index.html`** - Added `<link rel="icon">` pointing to existing SVG favicon.

#### Backend

- **`server/index.ts`** - Added `https://way.myoueb.fr` to CSP `script-src` and `connect-src` for Rybbit analytics. SPA fallback already existed.

---

## [0.8.37] - 2026-04-08

### For users

- **Update check - clearer error** - When GitHub API rate limit is hit, the error now says so instead of the misleading "Package not found". Suggests setting `GITHUB_TOKEN` in `.env` for higher limits (5000 req/h vs 60).

---

### Technical

- **`server/routes/updates.ts`** - Method 2 (packages API) now checks `x-ratelimit-remaining` header on 401/403 and returns a specific rate-limit message instead of generic "requires authentication".

---

## [0.8.36] - 2026-04-08

### For users

- **Favicons restored** - Domain favicons (DuckDuckGo, Google) were blocked by the new CSP header added in v0.8.34. Now allowed.

---

### Technical

- **CSP fix** - Added `icons.duckduckgo.com` and `www.google.com` to `img-src` directive.
- **OpenSSF Scorecard** - Added workflow (weekly scan), badge on both READMEs.
- **CodeQL badge** - Fixed URL for dynamic default setup (uses workflow ID).
- **Docker Build badge** - Added to both READMEs.

---

## [0.8.35] - 2026-04-08

### For users

> Dependency cleanup and GitHub CodeQL security alerts resolved - no UI changes.

- **Zero vulnerabilities** - all npm audit and GitHub Dependabot/CodeQL alerts resolved.
- **Lighter install** - removed vitest (27 packages), unused dependencies, cleaned devDependencies.

---

### Technical

#### Dependencies
- **Removed vitest** - tests migrated to Node.js built-in `node:test` runner (zero dependency, 12 tests pass).
- **Removed `brace-expansion`** (unused direct dep), stale npm overrides (tough-cookie, esbuild, minimatch).
- **Moved to devDependencies**: `concurrently`, `cross-env`, `@types/leaflet`, `@types/leaflet.markercluster`.
- Deleted `vitest.config.ts` and test setup file.

#### CodeQL fixes (30 alerts → 0)
- **Regex injection** - added ReDoS validation (length cap, nested quantifier rejection) before all user-supplied `new RegExp()` calls in logSearchService, Fail2banPlugin, and log-viewer.
- **Rate limiting** - added per-IP rate limiter (60 req/min) on all fail2ban plugin routes via `router.use()`, plus explicit rate limits on `GET /me` (30/min) and `GET /security-status` (10/min).
- **ReDoS** - rewrote IPv6 regex in regexGeneratorService to avoid polynomial backtracking; added line length cap (4096) in Fail2banPlugin config parser.
- **CORS** - DB config fallback now defaults to `false` (same-origin) instead of `true` (wildcard).
- **URL substring** - `IpModal.tsx` bot detection uses `endsWith('.msn.com')` instead of `includes('msn.com')`.

#### Other
- **`.gitignore`** - consolidated all AI/dev tool patterns (Copilot, Gemini, Aider, Bolt, Codeium, etc.), removed duplicates.
- **GitHub repo** - added 15 SEO topics, disabled unused Projects tab.

---

## [0.8.34] - 2026-04-08

### For users

> Security hardening release - no UI changes, no new features.

- **JWT security** - Tokens are now pinned to HS256 algorithm, preventing `alg: "none"` bypass attacks.
- **Logout endpoint** - `POST /api/users/logout` now revokes the current token server-side (previously only cleared localStorage).
- **Security headers** - Added HSTS (production) and Content-Security-Policy to all responses.
- **Login rate limiting** - Login endpoint now has a 10 req/min rate limit as defense-in-depth.
- **Webhook URL validation** - Webhook URLs are now checked against private/internal IP ranges (SSRF protection).

---

### Technical

#### Backend - Security fixes

- **`authService.ts`** - `jwt.verify()` now uses `{ algorithms: ['HS256'] }` to prevent algorithm confusion attacks. `jwt.sign()` also explicitly pins `algorithm: 'HS256'`. Added in-memory token blacklist with periodic cleanup (10 min interval) for logout/revocation.
- **`users.ts`** - Added `POST /logout` route that calls `authService.revokeToken()`. Added `rateLimit(10, 60_000)` to `POST /login`.
- **`index.ts`** - Added `Strict-Transport-Security` (production only) and `Content-Security-Policy` headers. CSP allows Leaflet tiles (`*.basemaps.cartocdn.com`, `*.tile.openstreetmap.org`), GitHub API, WebSocket, and inline styles/scripts.
- **`system.ts`** - `GET /security-status` now requires authentication (was public, disclosed whether JWT secret was default).
- **`log-viewer.ts`** - `validatePathSafe()` now also blocks null bytes. Added path validation to `read-direct` and `read-raw` endpoints. User-supplied regex patterns are rejected if they contain nested quantifiers (ReDoS) or exceed 500 chars.
- **`notifications.ts`** - Added `validateWebhookUrl()` that blocks localhost, private IPs (10.x, 172.16-31.x, 192.168.x), and cloud metadata (169.254.x) for SSRF protection.
- **`systemServer.ts`** - Quoted `HOST_ROOT_PATH` in `chroot` shell commands to prevent injection with special characters.

#### Dependencies

- **Vite** updated from 6.2.0 → 6.4.2 (fixes GHSA-4w7w-66w2-5vf9 path traversal and GHSA-p9ff-h696-f583 arbitrary file read).

#### Other

- **`.gitignore`** - Added `CLAUDE.md`, `resume_claude*.txt`, `data-test/`, `.planning/`; removed tracked `resume_claude_last.txt`.

---

## [0.8.33] - 2026-04-06

### For users

> Removed a false version mismatch warning in the Fail2ban configuration panel.

- **Fail2ban config - version check removed** - The red "Version mismatch" warning (container vs host fail2ban versions) no longer appears. The check was a false alarm: the socket protocol is compatible across 1.0.x/1.1.x versions and everything works correctly.

---

### Technical

#### Backend - `server/plugins/fail2ban/Fail2banPlugin.ts`

- **Version check removed from `/check` endpoint** - Dropped the `version` entry from the `checks` object in the diagnostic route. Also removed the `versions()` call and the `versionInfo` variable from the ping block - they no longer serve any purpose.

---

## [0.8.32] - 2026-04-05

### For users

> Live attack map improvements: toast alerts on new bans, fixed live mode conflicts, and a cleaner IP details modal.

- **Live map - toast on new ban** - When Live mode is active on the map tab, each newly detected ban triggers a notification toast in the header so you know when to look at the map, even from another tab.
- **Live map - source buttons now always work** - Clicking "Bans actifs" or "Historique" while Live mode is on now switches the source and disables Live mode directly, without having to click Live first.
- **Live map - accurate status bar** - The "88 IPs on map" counter is replaced by "⚡ Mode Live" and a live event counter while Live mode is active. The geo-resolution progress badge is hidden during Live mode.
- **IP modal - Actions rapides redesigned** - Each action (Recidive, Débannir, IPSet) now has its own labelled block with full-width buttons. The IPSet select is on its own line, with Add/Remove side by side below. Feedback messages appear in a coloured banner.
- **IP modal - Blocklist header** - When the IP is not found in any active blocklist, the message moves to the card header and the body collapses. When the IP is detected, a warning icon appears in the header.

---

### Technical

#### Frontend - `src/pages/fail2ban/TabMap.tsx`

- **Toast on live events** - `pollLiveEvents` now calls `useNotificationStore.getState().addBan()` for each new event, reusing the existing ban toast TTL (10s).
- **Source buttons** - Removed `pointerEvents: none` / `opacity` dimming on the source toggle when Live mode is on. Both buttons call `setLiveMode(false)` alongside `setMapSource(...)`. Active button highlight also checks `!liveMode` so neither appears selected during Live.
- **Live mode header** - Title shows `"⚡ Mode Live"` instead of IP count. Geo-resolution progress badge conditionally hidden (`!liveMode`). New live event counter badge added.
- **Live mode marker bleed fix** - The `points` useEffect that populates cluster markers now early-returns when `liveMode` is true, preventing ban markers from reappearing after a background refresh cycle (~10–15 s).
- **Live loading spinner** - Fixed `transform-origin` mismatch: spinner SVG resized from 16×16 (cx=8) to 11×11 (cx=5.5) to match the existing `f2b-geo-spin` CSS `transform-origin: 5.5px 5.5px`.

#### Frontend - `src/pages/fail2ban/IpModal.tsx`

- **Actions rapides** - Replaced flat `label + row` layout with vertical blocks per action. Each block has an uppercase label, then full-width button(s) or `select + button` row. IPSet gets a full-width select then a two-column button row. `actionMsg` displayed in a tinted bordered banner.
- **Blocklist card** - When no hits: body hidden, "Non présente dans les blocklists actives" moved to `cardH` as italic grey trailing text, shield icon dimmed. When hits present: `AlertTriangle` icon added to header alongside the existing hit count badge.

## [0.8.31] - 2026-04-04

### For users

> The stats summary banner now shows IPs that are currently attempting connections (not yet banned) in the "En cours" section.

- **Failing IPs in "En cours"** - Red monospace chips appear for each IP that has generated `Found` log entries in the last 5 minutes but has not yet been banned. Each chip shows the IP address, the jail it was found in, and a ×N attempt count. A tooltip gives the full details. If more than 6 are active, the overflow is shown as "+N autres". The list refreshes every 20 seconds.

---

### Technical

#### Backend - `server/plugins/fail2ban/Fail2banPlugin.ts`

- **`GET /failing-ips`** - New endpoint: reads the last 2000 lines of `fail2ban.log` (via `readLogTail`), filters to entries within the past 5 minutes, parses `[<jail>] Found <ip>` lines, excludes IPs that are currently banned (cross-referenced against `f2b_events`), groups by `jail:ip`, returns sorted by most recent first. TTL cache: 15s.

#### Frontend - `src/pages/fail2ban/TabStats.tsx`

- **`StatsSummaryBanner`** - Added `failingIps` state + `useEffect` polling `/failing-ips` every 20s. The "En cours" row now renders up to 6 failing IP chips (red) alongside the existing jail-pressure badges. Overflow count shown as "+N autres".

## [0.8.30] - 2026-04-04

### For users

> Fix: the "Bans actifs" stat card in the État actuel panel is no longer smaller than its siblings.

- **Stat card alignment** - The "Bans actifs" card had a tooltip wrapper with `display: inline-flex` that caused it to shrink relative to the other three cards (Jails actifs, Échecs en cours, Total bans). All four cards now align uniformly.

---

### Technical

#### Frontend - `src/pages/fail2ban/TabStats.tsx`

- **`F2bTooltip` on Bans actifs** - Added `block` prop so the wrapper renders as `display: block` instead of `display: inline-flex`, matching plain `<div>` siblings in the `repeat(4,1fr)` grid.

## [0.8.29] - 2026-04-04

### For users

> The Fail2ban map gets a live attack mode with animated arcs, a monthly bar chart is added below each heatmap, and the map no longer double-scrolls in history mode.

- **Live attack mode** - A new "⚡ Live" toggle on the map activates real-time tracking. New bans are polled every 5 seconds. For each ban with a known geo location, an animated arc draws itself from the attacker's location toward your server, with an arrowhead at the tip. A double pulsing ring marks the source.
- **Live feed panel** - When live mode is on, a dedicated left panel lists incoming bans in real time: IP, jail, city, flag, attempt count, and time since ban. The most recent entries (< 10s) are highlighted in red.
- **Source buttons disabled in live mode** - The "Bans actifs" and "Historique" toggles and country filters are grayed out and non-clickable while live mode is on. Existing ban markers are cleared from the map; they are restored when live mode is turned off.
- **Monthly bar chart** - Each "Bans per hour" and "Attempts per hour" heatmap card now includes a bar chart by month (Jan–Déc) below the weekly grid. Hover a bar to see the exact count and share of total. Only shown when data exists for the period.
- **Map double-scroll fixed** - In history mode with many banned IPs, the map container no longer produces a second vertical scrollbar.

---

### Technical

#### Backend - `server/plugins/fail2ban/Fail2banPlugin.ts`

- **`GET /map/server-geo`** - Resolves the server's own public IP via `ip-api.com/json/` (no IP = caller's IP). Result cached in `f2b_ip_geo` with key `_server_geo_` for 24h. Falls back to Paris coordinates if resolution fails.
- **`GET /map/events?since=<ts>&limit=<n>`** - Returns recent ban events from `f2b_events` since the given Unix timestamp, joined with cached geo from `f2b_ip_geo`. Only events with known geo are returned (no network calls - keeps the endpoint fast). Used by the live mode poll.
- **Monthly heatmap data** - `/tops` now computes `heatmapMonth` and `heatmapFailedMonth` via `strftime('%m', timeofban, 'unixepoch')` GROUP BY queries. Included in both `phase=fast` and `phase=full` responses.

#### Frontend - `src/pages/fail2ban/TabMap.tsx`

- **`LiveEvent` interface** - New type for live attack events with embedded geo.
- **`liveMode` state** - Boolean toggle; when true starts polling `/map/events` every 5s via `setInterval`. Cleaned up on toggle-off (lines removed, interval cleared).
- **`drawAttackArc()`** - Creates `L.polyline` from source to server geo with `stroke-dasharray: 8 6` and CSS `f2b-attack-fly` animation (2.2s ease-out, fades out). Adds a pulsing `L.divIcon` marker at source. Both auto-removed after 3s.
- **`serverGeo` state** - Fetched once from `/map/server-geo` on first live activation; cached in React state for subsequent polls.
- **CSS keyframes** - `f2b-attack-fly` (stroke-dashoffset 300→0, opacity 0→0.9→0) and `f2b-pulse-ring` (scale 1→2.5, opacity fade) injected in the existing style block.
- **Left live panel** - 220px aside prepended to map row when `liveMode` is true. Shows scrollable event list with IP, jail, city, flag, attempts × count. Recent entries (< 10s) highlighted.
- **Double-scroll fix** - Added `overflow: hidden` to the outer `height: calc(100vh - 165px)` container.

#### Frontend - `src/pages/fail2ban/TabStats.tsx`

- **`TopsData`** - Added optional `heatmapMonth` and `heatmapFailedMonth` fields (`{ month: number; count: number }[]`).
- **`HeatmapSection`** - Added `monthKey` prop (`'heatmapMonth' | 'heatmapFailedMonth'`). Monthly bar chart rendered below weekly heatmap legend: 12 columns, hover tooltip, peak month outlined, hidden when all zeros.
- **`MONTHS_FR`** - `['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']`

## [0.8.28] - 2026-04-04

### For users

> The Fail2ban Stats tab now shows a smart summary banner at the top with a real-time security situation overview, total blocked IPs (fail2ban + IPSet), period comparison, and alerts for jails under pressure.

- **Stats summary banner** - A contextual banner appears at the top of the Stats tab. It shows: current security status based on live fail2ban bans only (Calm / Normal / Moderate / High), total IPs blocked combining fail2ban and IPSet, and active jail count.
- **IPSet framed as protection** - IPSet entries are now displayed as "X IPs blocked upstream" with a tooltip listing each set and explaining they are kernel-level filters applied before fail2ban - not a threat indicator. This prevents the banner from showing false "High activity" when blocklists are well populated.
- **Period comparison with trends** - The banner shows bans, unique IPs, and attempts for the selected period with ▲/▼/= trend badges compared to the previous equivalent period.
- **Jails under pressure** - Jails with `currentlyFailed > 0` are listed in orange with their attempt count. If `currentlyFailed ≥ maxretry − 1`, a "→ ban imminent" warning is shown.
- **Attempt trend alert** - If attempts increased vs the previous period, an orange alert badge appears with the delta and a tooltip explaining possible causes (service not covered by fail2ban, `maxretry` too high).

---

### Technical

#### Frontend - `src/pages/fail2ban/TabStats.tsx`

- **`StatsSummaryBanner`** - New component inserted between the `<h2>` title and `IpSetsSection`. Four rows: live status + protection totals; period stats with `TrendBadge`; active bans by jail + top domain; attempt pressure row.
- **`TrendBadge`** - Reuses the existing component (line ~676) with `curr`/`prev` props for all three period metrics (bans, unique IPs, attempts).
- **Status logic** - Based solely on `totalBanned` (fail2ban live count): 0 → Calm (green), 1–5 → Normal (blue), 6–20 → Moderate (orange), >20 → High (red). IPSet entry count no longer influences status.
- **IPSet fetch** - Reads from `_cache['ipset:info']` first (populated by `IpSetsSection`); falls back to `/api/plugins/fail2ban/ipset/info` on cold load. No duplicate network request.
- **`jailsUnderPressure`** - Derived from `jails.filter(j => j.currentlyFailed > 0)` sorted descending, top 4 shown.
- **`failuresDelta`** - Computed from `summary.totalFailures − prevSummary.totalFailures`; row 4 only renders when delta > 0 or jails have active failures.

## [0.8.27] - 2026-04-03

### For users

> The Fail2ban audit check now shows all failing components correctly, and the IPSet stats section is redesigned with shared colors across bars, pie chart, and history graph.

- **Audit fix** - The status badge in the "Fail2ban - Vérifications" panel now correctly reflects all checks. Previously it could show red while all visible rows were green, because the `fail2ban-client` binary check was counted but not displayed. The client check now appears as its own row.
- **IPSet bars - multi-column layout** - The bar list automatically switches from 1 to 2 to 3 columns (max) depending on how many sets are present (≤ 4 → 1 col, ≤ 8 → 2 cols, 9+ → 3 cols). Columns fill top-to-bottom so the largest sets are always in the first column.
- **IPSet - consistent colors** - Each IPSet now uses the same color across the bar list, the pie chart, and the historical line graph. Previously each view assigned colors independently.
- **IPSet pie - two-sided legend** - The pie chart legend is now split: largest sets on the left, smallest on the right, with the pie in the center. The history graph legend is sorted largest-first.
- **IPSet - empty sets hidden from graph** - IPSets with 0 current entries are no longer shown as lines in the historical chart.

---

### Technical

#### Frontend - `src/pages/fail2ban/TabAudit.tsx`

- **`checkF2b`** - Changed `allOk` from `Object.values(checks).every(c => c.ok)` to `res.result.ok` (uses the backend-computed field, avoiding spurious red from `version` and `dropin` keys not included in backend `allOk`).
- **`f2bChecks`** - Added `client` entry (fail2ban-client binary check) between `daemon` and `socket`, using `FileText` icon. Title badge and visible rows are now consistent.

#### Frontend - `src/pages/fail2ban/TabStats.tsx`

- **`IpSetsSection`** - `barSets` derived as `sets.filter(s => s.entries > 0)` for `maxEntries` calculation.
- **Bar grid** - Replaced `flex-direction: column` (fixed width 340 px) with CSS grid (`grid-auto-flow: column`, `grid-template-rows: repeat(ceil(n/cols), auto)`). Column count: 1 / 2 / 3 based on `sets.length`. `marginTop: .5rem` added.
- **`colorMap`** - `Record<string, string>` built from `slices` after pie computation; shared via prop to `HistChart` and used inline in bar rows. All three views now use the same color per ipset name.
- **`HistChart`** - Added `nonEmptyNames?: Set<string>` prop: filters `ipset_names` from backend to exclude sets with 0 current entries. Added `colorMap?: Record<string, string>` prop used for both line colors and legend colors. Legend sorted by `colorMap` key order (largest → smallest).
- **Pie layout** - Legend split into `leftSlices` (first half) and `rightSlices` (second half) with pie SVG centered between them. `alignItems: flex-start`, `marginTop: .5rem` on both legend columns, bottom padding removed from wrapper.

## [0.8.23] - 2026-04-03

### For users

> Activating a blocklist that contains your own IP now shows a warning instead of instantly locking you out.

- **Self-ban protection** - Before applying any blocklist to iptables, LogviewR checks whether your current IP is inside the list. If it is, a warning modal appears showing your IP and the list name, and the activation is blocked. You can still force-activate if you know what you are doing (e.g. you have physical or out-of-band access), but the accidental self-ban scenario is prevented by default.

---

### Technical

#### Backend - `server/plugins/fail2ban/BlocklistService.ts`

- **`enable(id, callerIp?, force?)`** - Signature extended with optional `callerIp` and `force` parameters. After the ipset is populated (refresh if needed), runs `ipset test <setname> <callerIp>`. Exit 0 (IP present) returns `{ ok: false, selfBan: true, error: "Votre IP (<ip>) est dans cette liste…" }` without touching iptables. Exit 1 (IP absent) falls through normally. `force: true` bypasses the check entirely. Return type extended with `selfBan?: boolean`.

#### Backend - `server/plugins/fail2ban/Fail2banPlugin.ts`

- **`POST /blocklists/toggle`** - Now accepts optional `force: boolean` in the request body. Extracts the caller IP from `req.ip ?? req.socket.remoteAddress`, strips the `::ffff:` IPv4-mapped prefix, and passes both to `enable()`.

#### Frontend - `src/pages/fail2ban/TabBlocklists.tsx`

- **`handleToggle(id, currentEnabled, force?)`** - Intercepts `selfBan: true` in the API response: extracts the IP from the error message via regex, reverts the `updating` spinner, and opens the warning modal instead of proceeding.
- **Self-ban warning modal** - Fixed overlay with danger border. Shows caller IP (orange) and list name. "Annuler" closes the modal; "Forcer l'activation" retries with `force: true`.

## [0.8.22] - 2026-04-03

### For users

> The Blocklists tab gets 11 new built-in lists with direction (IN/OUT) support, a compact card layout, and a force-reset button for stuck lists. The IP modal now shows which active blocklists contain a clicked IP. The IPSet tab gains a destroy button per set and a "FULL" indicator.

- **11 new built-in blocklists** - TOR Exit Nodes, BruteForceBlocker, Spamhaus DROP (CIDRs), CINS Army, Blocklist.de All, GreenSnow, Firehol Level 1 (CIDRs), Stopforumspam 7d, Russia CIDRs, China CIDRs. All disabled by default; source repository links shown on each card.
- **IN/OUT direction support** - Each blocklist targets either INPUT (inbound, default), OUTPUT (outbound), or both chains. An ⚠ badge appears on enabled outbound lists as a reminder.
- **Compact blocklist cards** - Cards are now a single horizontal row (toggle, name, count, age, direction badge, source link, refresh, delete) instead of tall stacked blocks. Errors appear inline below the row with a "🔄 Reset ipset" button.
- **Force-reset button** - When a list fails to load (e.g. after a kernel ipset conflict), a "🔄 Reset ipset" button appears. It removes iptables rules, destroys the corrupted ipset, and triggers a clean rebuild from scratch.
- **IP modal - blocklist membership** - Clicking an IP now shows a "Blocklists" card listing which active lists contain that IP (tested in O(1) via `ipset test`), with direction badge per list.
- **IPSet tab - destroy button** - Each set in the IPSet list panel now has a trash icon to permanently destroy it from the kernel. A "⚠ PLEIN" badge appears when a set is at 100% capacity.
- **Nav badges** - The Blocklists tab badge shows the number of active (enabled) lists. The IPSet tab badge shows the total number of kernel sets. Both update live.
- **Fix: update notification** - The update banner now shows the git commit title (e.g. "feat: … (v0.8.21)") when the GitHub release has no description, via a fallback to the tag's commit message.
- **Fix: ipset kernel limit guard** - Lists exceeding ~520 000 entries (hard kernel limit for hash:ip sets in most Docker environments) now fail early with a clear message instead of crashing mid-load and leaving orphaned temp sets.
- **Fix: settings page** - Clicking "Check for updates" no longer shows a duplicate toast when an update is already available (the header banner already signals it).

---

### Technical

#### Backend - `server/plugins/fail2ban/BlocklistService.ts`

- **`ListDirection` / `IpsetType` types** - `'in' | 'out' | 'both'` and `'hash:ip' | 'hash:net'`; added to `BuiltinListDef` and `CustomListDef`.
- **`iptablesChainsFor(direction)`** - Returns `[chain, matchFlag][]` pairs: `INPUT/src` for `'in'`, `OUTPUT/dst` for `'out'`, both for `'both'`. Used by `enable()`, `disable()`, `restoreOnStartup()`, `startAutoRefresh()`.
- **`refresh()` - explicit -new set creation** - The temp `<name>-new` set is now created explicitly via `ipset create` (with computed `hashsize` and `maxelem`) before writing the restore file. The restore file contains only `add` lines, eliminating the risk of a stale `-new` set with wrong maxelem silently absorbing entries.
- **Dynamic `hashsize`** - Computed as the next power of 2 above `maxelem / 4`, so the kernel hash table never needs to grow past its initial allocation for expected list sizes.
- **Kernel limit guard** - `entries.length > 520 000` throws immediately with an explicit message instead of running `ipset restore` and failing deep in the kernel.
- **`forceReset(id)`** - Removes iptables rules, destroys main set and `-new` orphan, calls `refresh()`, then re-adds rules if the list was enabled. Exposed via `POST /blocklists/force-reset`.
- **maxelem bumps** - CINS Army 30 K → 60 K; GreenSnow 100 K → 200 K. Bitwire IN/OUT removed (3.3 M entries exceeds kernel limit).

#### Backend - `server/plugins/fail2ban/Fail2banPlugin.ts`

- **`POST /blocklists/force-reset`** - Delegates to `blocklistService.forceReset(id)`.
- **`DELETE /ipset/destroy/:setName`** - Sanitises set name; runs `ipset destroy`; used by the IPSet tab trash button.
- **`GET /blocklists/test/:ip`** - Runs `ipset test <setName> <ip>` in parallel across all lists with `count > 0`; returns `{ id, name, direction, present }[]`. Used by IpModal.

#### Backend - `server/routes/updates.ts`

- **Commit message fallback** - When the latest GitHub release has no body and the CHANGELOG doesn't contain the version, the tag's commit message (first line) is fetched and used as release notes.

#### Frontend - `src/pages/fail2ban/TabBlocklists.tsx`

- **Compact card layout** - Single flex row per list; error row spans full width with inline "🔄 Reset ipset" button.
- **`handleForceReset(id)`** - Posts to `/blocklists/force-reset`, sets `updating: true` while in-flight.
- **`newMaxelem` presets** - 65 K / 150 K / 500 K / 1 M dropdown when adding a custom list.
- **`newDirection`** - IN / OUT / BOTH selector in the add form.
- **Info note** - Outbound warning reworded: lists can target OUTPUT but require care.

#### Frontend - `src/pages/fail2ban/IpModal.tsx`

- **`blocklistHits` state** - Fourth parallel fetch on IP modal open: calls `/blocklists/test/:ip`; renders a "Blocklists" card with ✓/○ per list and a direction badge.

#### Frontend - `src/pages/fail2ban/TabIPSet.tsx`

- **Destroy button** - Trash2 icon per set; calls `DELETE /api/plugins/fail2ban/ipset/destroy/:name`; invalidates set cache and refreshes list.
- **"⚠ PLEIN" badge** - Shown when `set.entries >= set.maxelem`.

#### Frontend - `src/pages/Fail2banPage.tsx`

- **`ipsetCount` state** - Fetched from `/ipset/info` on mount; used for the IPSet nav badge (purple `#bc8cff`).
- **Blocklists badge** - Active (enabled) list count; red `#e86a65`.

#### Frontend - `src/pages/SettingsPage.tsx`

- **No duplicate toast** - `handleCheckNow` no longer adds an action toast when an update is available; the header banner is sufficient.

## [0.8.21] - 2026-04-02

### For users

> The Fail2ban blocklist manager now supports custom public lists alongside the built-in Data-Shield lists, and the IPSet tab lets you import bulk IPv4 addresses from a .txt file.

- **Custom blocklists** - Add any public IPv4 blocklist by URL directly from the Blocklists tab. Each custom list has its own ipset and iptables DROP rule, and can be enabled, refreshed, or deleted independently of the built-in lists.
- **Bulk IPSet import** - Upload a `.txt` file (one IPv4 address per line) to populate any existing ipset in one click. The interface shows how many IPs were added and how many were skipped.
- **Fix: page reload after deployment** - After a server update, the app now automatically reloads when it detects a stale cached bundle instead of showing a blank error screen.
- **Fix: blocklist persistence after restart** - Enabled blocklists are now automatically restored (ipset + iptables rule) when the Docker container restarts, without requiring a manual disable/re-enable cycle.

---

### Technical

#### Backend - `server/plugins/fail2ban/BlocklistService.ts`

- **Dynamic list registry** - `LISTS` constant replaced by `_allLists()` helper merging built-in entries with user-defined `CustomListDef` records loaded from `data/blocklist-custom.json`.
- **`addCustomList()`** - Validates name, URL, ipset name format (`/^[a-z0-9][a-z0-9-]*$/`), and uniqueness against both map keys and `ipsetName` values of existing lists. Creates disabled status entry; no kernel calls on add.
- **`removeCustomList()`** - Guards against removing built-in lists; checks `_refreshInProgress` to prevent concurrent remove/refresh race; calls `disable()`, then `ipset destroy`, then removes from both maps.
- **`restoreOnStartup()`** - Called once at boot (fire-and-forget) to re-populate ipsets and re-add iptables DROP rules for all enabled lists after a container restart.
- **`startAutoRefresh()`** - After each successful refresh, re-adds the iptables DROP rule if it has disappeared (e.g. after `iptables -F`).

#### Backend - `server/plugins/fail2ban/Fail2banPlugin.ts`

- **`POST /blocklists/add`** - Accepts `{ name, url, ipsetName, description?, maxelem? }`, delegates to `addCustomList()`.
- **`DELETE /blocklists/remove/:id`** - Delegates to `removeCustomList()`; async with await.
- **`POST /ipset/import`** - Accepts `{ set, ips[] }`; validates set existence via `ipsetEntries()`; server-side IPv4 re-validation with type guard; loops `ipsetAdd()` per IP; counts added/skipped (including duplicates)/errors; early bail if `this.client` is null.

#### Frontend - `src/pages/fail2ban/TabBlocklists.tsx`

- **`ListState.builtin`** - New boolean flag; card border switches `#e86a65` (built-in) vs `#58a6ff` (custom).
- **Add form** - Collapsible form with name, URL, ipset name (real-time uniqueness + format hint), description fields. Submit disabled when fields empty or ipset name already in use.
- **Delete button** - Shown on custom list cards only; surfaces API error via `setGlobalError` if deletion fails.
- **Source badge** - Shows "jsDelivr CDN" for built-in lists and "URL personnalisée" for custom lists.

#### Frontend - `src/pages/fail2ban/TabIPSet.tsx`

- **File import** - Hidden `<input type="file" accept=".txt">` triggered by "↑ Importer .txt" button inside `EntriesPanel`. Parses IPv4 lines client-side, posts to `/ipset/import`, shows "✓ N ajoutées" feedback. `importResult` cleared on set switch.

#### Frontend - `src/components/ErrorBoundary.tsx`

- **Chunk reload** - `componentDidCatch` detects "Failed to fetch dynamically imported module" errors and reloads once (guarded by `sessionStorage` to prevent reload loops after deployment.

## [0.8.20] - 2026-04-01

### For users

> The largest log files table now shows the domain name for NPM and Apache files, each path is clickable and opens the file directly in the log viewer.

- **Domain in largest files table** - NPM log files now display the associated domain name (read from NPM's SQLite/MySQL database). Apache log files show the virtual host when it can be inferred from the filename (e.g. `example.com-access.log`) or the parent directory.
- **Clickable paths** - Each file path in the table is now a link that opens the log viewer with that file pre-selected. Hover over the path for a tooltip showing the full path, plugin, type, size, last modified date, and domain.
- **Clean navigation URLs** - Log viewer deep links now use readable URLs (`#log/nginx/var/log/nginx/access.log`) instead of percent-encoded paths (`%2Fvar%2Flog%2F...`). Old bookmarked links continue to work.

---

### Technical

#### Backend - `server/routes/log-viewer.ts`

- **`extractApacheVhost()`** - New helper: extracts virtual host from filename prefix (`example.com-access.log`) or parent directory name; skips generic names like `apache2`, `logs`, etc.
- **NPM domain enrichment** - After scanning files, builds proxy-host ID → domain map by reading `database.sqlite`; tries 4 path candidates: inferred from file path (`../database.sqlite`), same directory, raw `fail2ban.npmDataPath`, and Docker-resolved `HOST_ROOT + npmDataPath`.
- **Apache vhost enrichment** - Calls `extractApacheVhost()` for each Apache file after scan.
- **Response** - `domain?: string` added to each file entry in `/api/log-viewer/largest-files`.

#### Frontend - `src/components/widgets/LargestFilesCard.tsx`

- **`LargestFileEntry`** - Added `domain?: string` field.
- **Clickable path** - Path cell replaced by `<a href="#log/{pluginId}{filePath}">` using clean URL format.
- **Structured tooltip** - `F2bTooltip` + `TT` helpers wrap the path link; shows full path, plugin, type, size, modification date, and domain.
- **Domain display** - Domain shown in small italic text below the path when available.

#### Frontend - `src/App.tsx`

- **`parseHashNav()`** - Now handles both clean (`var/log/file.log`) and legacy (`%2Fvar%2Flog%2Ffile.log`) hash formats; prepends `/` when missing.
- **Hash sync** - Log-viewer URL hash now uses clean format `#log/{pluginId}{filePath}` (no `encodeURIComponent`).
- **`hashchange` listener** - New `useEffect` (runs when authenticated): listens for hash navigation clicks in-session and triggers `setSelectedPluginId` + `setDefaultLogFile` + `setCurrentPage('log-viewer')`.



---

## [0.8.19] - 2026-04-01

### For users

> IP Tracker table improvements: all badges visible, layout fixed, better pagination.

- **Active/History toggle** - The two buttons no longer overlap when the label is long.
- **All jail and IPSet badges visible** - Badges in the Jail(s) and IPSet(s) columns now show every entry instead of truncating after 2–3 items.
- **Pagination at the bottom** - Page controls (‹ › and rows-per-page) now appear below the table as well, so you don't have to scroll back to the top to navigate.
- **Per-page options simplified** - Options are now 16, 32, and All (50/100 removed).
- **Table no longer clipped** - Selecting 32 rows or more now correctly expands the card; rows are no longer cut off by the layout.

---

### Technical

#### Frontend - `src/pages/fail2ban/TabTracker.tsx`

- **Active/history toggle** - Removed fixed `width: 118px` on toggle buttons; replaced with `minWidth: 0` + auto width so long labels like "Historique des bans" don't overflow.
- **Jail(s) column** - Removed `slice(0, 3)`, `+N` overflow badge, `flexWrap: nowrap`, `overflow: hidden`, and `maxWidth: 320`. All jail badges now render with `flexWrap: wrap`. Header changed from `width: 320` to `minWidth: 180`.
- **IPSet(s) column** - Same treatment: removed `slice(0, 2)`, `+N` badge, `flexWrap: nowrap`, `overflow: hidden`, and `maxWidth: 180`. All IPSet badges render with `flexWrap: wrap`. Header changed from `width: 180` to `minWidth: 160`.
- **Hostname column** - Reduced to `width: 120 / maxWidth: 120` with `textOverflow: ellipsis` to give space back to IPSet/Jail columns.
- **IP column** - Reduced from `width: 130` to `width: 110`.
- **Bottom pagination bar** - Added a second pagination row below `</table>` (same prev/next buttons + per-page selector).
- **Per-page options** - Array changed from `[16, 32, 50, 100]` to `[16, 32]` at both render sites (top bar and bottom bar).
- **Flex layout fix** - Added `flexShrink: 0` to the card wrapper (`{ ...card, flexShrink: 0 }`). Root cause: the card was a flex child with default `flex-shrink: 1` inside a `flex-direction: column / overflow-y: auto` container; the flex algorithm was shrinking the card to the viewport height and `overflow: hidden` on the card clipped the remaining rows silently.

---

## [0.8.18] - 2026-04-01

### Fixed

- Version numbers (header logo, tab info, server fallback) were frozen at 0.8.14 - now correctly updated to 0.8.18.

---

## [0.8.17] - 2026-04-01

### For users

> Deep links for settings tabs, cleaner Security page, and unified log files table.

- **Settings deep links** - Each settings tab now updates the URL (`#config/general`, `#config/security/protection`, etc.). You can copy the URL and share a direct link to any tab - the recipient lands exactly on the right page after login.
- **CORS - preset buttons** - HTTP methods (GET, POST, PUT…) and common headers (Content-Type, Authorization…) are now clickable chips. Click to add/remove. A custom input remains for non-standard values. Fields are greyed out until at least one allowed origin is configured.
- **Security page cleanup** - Removed two inactive sections: "Sécurité réseau" (disabled checkboxes, not implemented) and "Fonctionnalités actives" (static text only).
- **Protection fields alignment** - The three editable fields in the Attack Protection tab are now aligned to the same right column.
- **Log files table** - The "Largest log files" table is now identical in the Dashboard and the Statistics page: colored type badges, full path (no truncation), and filter toggles (show all / hide .gz / hide .log.1).


---

### Technical

#### Frontend - `src/App.tsx`

- `HashNav` type extended with `config` variant; `parseHashNav()` handles `#config/TAB[/SUBTAB]`; stores `_hashNavConfig` in sessionStorage; passes `initialSecuritySubTab` to `SettingsPage`

#### Frontend - `src/pages/SettingsPage.tsx`

- New `initialSecuritySubTab` prop; `securitySubTab` state initialized from prop; `useEffect` calls `history.replaceState` on every tab/subtab change; hash cleared on unmount

#### Frontend - `src/components/SecuritySection.tsx`

- `toggleMethod` / `toggleHeader` helpers for preset chip toggle
- Preset chips for 7 HTTP methods and 8 common headers (blue/cyan active state, grey inactive)
- Credentials + Methods + Headers wrapped in `opacity-40 pointer-events-none` when no origins configured
- Removed "Sécurité réseau" section (2 disabled checkboxes) and "Fonctionnalités actives" section
- Protection fields: `w-44` on right container for column alignment; `readOnly` label moved to `description`

#### Frontend - `src/components/SettingsSection.tsx`

- `SettingRow.description` prop type widened to `string | React.ReactNode`

#### Frontend - `src/components/widgets/LargestFilesCard.tsx`

- Full rewrite: `limit` prop, `Toggle` sub-component, `showAll` / `hideGz` / `hideRotated` filters, `TypeBadge` colored inline styles, `break-all` full path, "+ N more" row when not expanded

#### Frontend - `src/pages/AnalyticsPage.tsx`

- Inline largest files section (~150 lines) replaced by `<LargestFilesCard limit={50} />`; related state and fetch removed

#### Backend - `server/routes/updates.ts`

- `updateAvailable` decoupled from `dockerReady` - update is detected as soon as `latestVersion > currentVersion`; Docker status shown separately in UI
- `getReleaseNotesFromChangelog`: strips `> ` blockquote markers for clean display

---

## [0.8.16] - 2026-04-01

### For users

> Session expiry now shows a re-login prompt, and attempt notifications display the jail name.

- **Automatic re-login on session expiry** - If your session expires while the page is open, a login modal appears automatically so you can re-authenticate without refreshing the page.
- **Jail name in attempt notifications** - The header notification for login attempts now always shows the jail name (e.g. `sshd`, `nginx-http-auth`). The associated domain is shown alongside when available.
- **Profile page navigation** - The LogviewR logo on the Profile page links back to the dashboard, and the User Menu highlights the active page (Profile vs Administration) correctly.

---

### Technical

#### Frontend - `src/api/client.ts`

- Dispatches `auth:session-expired` custom event on HTTP 401 or `error_code: auth_required` responses - skipped for `/api/users/login` to avoid false triggers on wrong password

#### Frontend - `src/App.tsx`

- Listens for `auth:session-expired` event in the auth `useEffect` → calls `userLogout()` → sets `isAuthenticated: false` → `UserLoginModal` renders automatically

#### Frontend - `src/components/layout/Header.tsx`

- `NotifCard` attempt branch: added `{n.jail}` badge (always visible, yellow monospace) before the domain; domain demoted to secondary grey text

#### Frontend - `src/components/layout/Header.tsx`, `src/pages/ProfilePage.tsx`

- ProfilePage header: LogviewR logo replaces back button (same style as dashboard)
- `UserMenu`: `activePage` prop highlights "Mon Profil" vs "Administration" depending on current page

---

## [0.8.15] - 2026-03-31

### For users

> Active bans synchronized with fail2ban in real time, improved ban chart, enriched notifications and more compact Config UI.

- **Reliable active ban counter** - The "active bans" badge in the menu and IP Tracker now shows exactly the same count as fail2ban. Unbans are detected automatically on every refresh (every 30s) and recorded in history.
- **Grouped bar chart** - In "Bars" mode, each jail is displayed side by side (instead of stacked), sorted from highest to lowest for each day.
- **Accurate Y-axis** - The axis maximum matches the actual peak of the visible data, with no artificial rounding.
- **Enriched attempt notifications** - The domain associated with the IP is shown in the notification (when available), in addition to the IP and attempt count. The active jails badge and "+N attempts" text were removed to reduce clutter.
- **Top Domains** - Counting now covers all jails combined (not per jail), which better reflects real traffic. An explanatory tooltip on the title details the calculation method and the case of Access List IP-protected domains.
- **Fail2ban Config - collapsed cards more compact** - The Runtime, Database and Config Files cards now have the same height when collapsed, with no visible residual border.

---

### Technical

#### Backend - `server/plugins/fail2ban/Fail2banPlugin.ts`

- `_syncUnbans(liveBannedIps: Set<string>)`: new private method - compares active IPs in DB (`unban_at IS NULL`) with live fail2ban; marks absent IPs with `unban_at = now` without ever deleting historical rows
- Called in `GET /status` route after fetching `jailsWithMeta` - synced on every 30s poll
- All "active bans" queries migrated from `bantime=-1 OR (timeofban+bantime) > ?` to `unban_at IS NULL` (lines 910, 1172, 1876, 1914) - `now` parameter removed from these `.all()` calls
- Top domains: replaced `jailBannedIps` (per-jail) with `allBannedIps` (union of all jails) as candidate set

#### Backend - `server/database/connection.ts`

- Migration: `ALTER TABLE f2b_events ADD COLUMN unban_at INTEGER` (try/catch)
- Index: `CREATE INDEX IF NOT EXISTS idx_f2b_events_unban ON f2b_events(unban_at)`
- Backfill on startup: expired bans older than 60s (`bantime > 0`) receive `unban_at = timeofban + bantime`

#### Frontend - `src/pages/fail2ban/BanHistoryChart.tsx`

- Removed `niceMax()` - Y-axis max = raw maximum of visible values
- `effectiveMax`: removed `sliceMax` floor when jails are visible
- `BarChart`: grouped bars side by side; `sortedJails` sorted by descending value per date; proportional `groupW` / `subBarW` / `groupGap` calculation

#### Frontend - `src/pages/fail2ban/TabStats.tsx`

- `TopCard`: new prop `titleTooltip?: { bodyNode, color?, width? }` - wraps the title in an `F2bTooltip` with `help` cursor and dotted underline
- `domainTitleTooltip` (360px, cyan): 4 explanatory sections (counting method, all jails, Access List domains, reading results) passed to both domain TopCards

#### Frontend - `src/pages/fail2ban/TabConfig.tsx`

- Conditional `alignSelf` per card (`start` when collapsed and neighbor is open, `stretch` otherwise) - removes ghost space below collapsed cards
- Conditional `borderBottom`: `none` when card is collapsed, `1px solid #30363d` when open

#### Frontend - `src/pages/Fail2banPage.tsx`

- Fetch `/api/plugins/fail2ban/tracker` on mount → `trackerActive` state
- IP Tracker badge uses `trackerActive ?? totalBanned` (DB-based) - no longer `bannedIps.length` from fail2ban-client
- `jailDomainsRef`: lazy fetch `/jails/enrichment` once after first status load
- Passes `onActiveChange={setTrackerActive}` to `TabTracker`

#### Frontend - `src/pages/fail2ban/TabTracker.tsx`

- Prop `onActiveChange?: (n: number) => void` - called from `activeCount` useMemo to bubble the DB count up to the parent

#### Frontend - `src/components/layout/Header.tsx`

- Attempt notification: removed jail badge and `{n.total} actives` text
- Added domain badge (orange, monospace, maxWidth 160px) when `n.domain` is present

#### Frontend - `src/stores/notificationStore.ts`

- `AppNotification`: added `domain?: string` field
- `addAttempt` signature extended with `domain`

---

## [0.8.13] - 2026-03-31

### For users

> After a VACUUM or a configuration change, the UI updates immediately without needing to clear the cache.

- **VACUUM dashboard.db** - The fragmentation badge disappears instantly after VACUUM, with no manual reload.
- **Fail2ban config** - Changes to `fail2ban.local` (loglevel, logtarget, dbpurgeage…) and raw edits are reflected immediately in the UI.

---

### Technical

#### Backend - `server/plugins/fail2ban/Fail2banPlugin.ts`

- `POST /config/dashboard-vacuum`: added `_routeCache.delete('config/parsed')` after VACUUM - the fragmentation cache was kept for 60s, causing stale display
- `POST /config/write`: invalidates `config/parsed` cache if at least one key was written to `fail2ban.local`
- `POST /config/write-raw`: invalidates `config/parsed` cache after successful write of `fail2ban.local` / `jail.local`

---

## [0.8.12] - 2026-03-31

### For users

> Several visual improvements in the fail2ban Configuration tab and ban statistics chart.

- **Ban Statistics chart** - The Y-axis now adapts to the actual data scale: bars correctly fill the chart area, and labels show round numbers (20, 50, 100…).
- **Fail2ban Config** - The "fail2ban ↔ dashboard.db Synchronization" card now appears first, before "Internal database (dashboard.db)".

---

### Technical

#### Frontend - `src/pages/fail2ban/BanHistoryChart.tsx`

- `niceMax(raw)`: new function - rounds up to the next "nice" number (e.g. 13→20, 47→50, 130→200)
- `yTicks(max)`: for max ≤ 5, generates a tick per integer (avoids duplicates); for max > 5, 4 ticks at 25/50/75/100%
- `effectiveMax`: fallback replaced - uses `sliceMax` (max of the visible slice) instead of global `histMax`; `niceMax()` applied to output; `Math.max(byJailMax, sliceMax)` avoids underestimation if `byJail` is incomplete

#### Frontend - `src/pages/fail2ban/TabConfig.tsx`

- "fail2ban ↔ dashboard.db Synchronization" card moved before "Internal database (dashboard.db)" in the Application column

---

## [0.8.11] - 2026-03-31

### For users

> Fix for the NPM panel in MySQL mode: the panel no longer shows the "not configured" warning when MySQL is properly configured.

- **NPM MySQL integration** - The Integrations panel turns green as soon as the MySQL fields (host, user, database) are filled in, even without a log path.

---

### Technical

#### Frontend - `src/pages/fail2ban/TabConfig.tsx`

- `npmMysqlOk`: removed `&& s.npmDataPath` from the detection condition - MySQL is considered configured as soon as host + user + db are present

#### Frontend - `src/pages/Fail2banPage.tsx`

- `npmMysqlConfigured`: new state, fetches `npmDbType`/`npmMysqlHost`/`npmMysqlUser`/`npmMysqlDb` on mount
- `npmMissing`: `npmDataPath === '' && !npmMysqlConfigured` (was just `npmDataPath === ''`)
- `onNpmDataPathChange`: re-fetches full settings after save to update `npmMysqlConfigured`

---

## [0.8.10] - 2026-03-31

### For users

> The fail2ban menu now shows blocklist status directly in the navigation tooltip.

- **Blocklists tooltip** - Hovering over the "Blocklists" tab in the menu shows each list with its status (active / inactive) and last update date.

---

### Technical

#### Frontend - `src/pages/Fail2banPage.tsx`

- `blocklistsStatus` state + `useEffect`: fetch `GET /api/plugins/fail2ban/blocklists/status` on mount to populate the navigation tooltip
- `navTt.blocklists`: new entry `color: 'red'`, bodyNode with ● ○ per list, name, and duration since `lastUpdate` (format "Xh Ym ago" or "Never")

---

## [0.8.9] - 2026-03-31

### For users

> The change summary is now displayed in the administration update panel.

- **Update panel (Administration → General)** - The "Update available" section now shows the change summary (extracted from CHANGELOG) above the docker command, just like the dashboard banner.

---

### Technical

#### Frontend - `src/pages/SettingsPage.tsx`

- "Update available" block: added `{updateInfo.releaseNotes && <p>…</p>}` between the version title and docker command (`line-clamp-3`, `whitespace-pre-wrap`)

---

## [0.8.8] - 2026-03-31

### For users

> Fix for NPM MySQL configuration: the log path is now correctly saved and required, making Top Domains functional in MySQL mode.

- **Top Domains MySQL** - The NPM domain top worked with SQLite but returned empty with MySQL. Cause: the log path (`/data/logs/`) was not saved during MySQL configuration. The config form now shows this field in MySQL mode and saves it correctly.
- **NPM config panel** - The Integrations panel stayed yellow even after a complete MySQL configuration. It now turns green as soon as MySQL + log path are configured.

---

### Technical

#### Frontend - `src/pages/fail2ban/Fail2banPathConfig.tsx`

- `saveNpmConfig()`: `npmDataPath` always included in saved settings (SQLite and MySQL mode)
- `onNpmDataPathChange` called in both modes (was only called in SQLite)
- Load effect: restores `s.npmDataPath` from API settings in MySQL mode
- MySQL section: added "NPM log path" field to enter the NPM root folder (`logs/` required for Top Domains)

#### Frontend - `src/pages/fail2ban/TabConfig.tsx`

- `npmMysqlOk`: extended condition - now requires `s.npmDataPath` in addition to MySQL credentials (green badge only if config is complete)
- Integrations card `borderColor`: `(npmDataPath || npmMysqlOk)` instead of `npmDataPath` alone

---

## [0.8.7] - 2026-03-31

### For users

> New Blocklists tab in Fail2ban: enable malicious IPv4 lists (~100k IPs) in one click. The update banner now shows the change summary.

- **IP Blocklists (Fail2ban → Firewall → Blocklists)** - New tab to enable/disable Data-Shield lists: malicious IPv4 addresses updated every 6h. Two sources available: Prod (web apps, WordPress, Nginx) and Critical (DMZ, APIs). Each enabled list injects IPs into a dedicated ipset with an iptables DROP rule on incoming traffic.
- **Enriched update banner** - The new version notification now shows a change summary extracted from CHANGELOG.md, in addition to the version number.

---

### Technical

#### Backend - `server/plugins/fail2ban/BlocklistService.ts` (new)

- Download from jsDelivr CDN with 30s timeout, redirect following, 50 MB limit
- Atomic ipset swap via `ipset restore` + `ipset swap` (no protection interruption)
- `INPUT DROP` iptables rule per list, `-C` check before insertion
- Race condition guard (`_refreshInProgress` Set), strict IPv4 regex (octets 0–255), empty list guard
- Status persisted in `data/blocklist-status.json` with crash recovery on startup
- Auto-refresh every 6h for enabled lists via `setInterval`

#### Backend - `server/plugins/fail2ban/Fail2banPlugin.ts`

- `BlocklistService` instantiated at plugin init
- New routes: `GET /blocklists/status`, `POST /blocklists/refresh`, `POST /blocklists/toggle`

#### Backend - `server/routes/updates.ts`

- Added `getReleaseNotesFromChangelog(version)`: parses local `CHANGELOG.md`, extracts the `## [x.y.z]` section, strips technical subsections (`####`), truncates to 400 chars
- Fallback called in all 4 version fetch methods when GitHub Releases API returns empty or 404

#### Frontend - `src/pages/fail2ban/TabBlocklists.tsx` (new)

- Per-list cards: Active/Inactive toggle, Refresh button, IP counter, last update date, per-list error display
- Inline styles, design system palette (security red `#e86a65`, count purple `#bc8cff`)

#### Frontend - `src/pages/Fail2banPage.tsx` + `types.ts` + i18n

- New `blocklists` tab in the Firewall group (after NFTables)
- `TabId` extended, i18n key `fail2ban.tabs.blocklists` added in `en.json` and `fr.json`

---

## [0.8.6] - 2026-03-30

### Fix

- **Top Domains - critical fix**: NPM domains were never displayed (always empty) because the Stats tab was not calling the dedicated `/tops/domains` route. The route has existed since v0.8.3 but the frontend fetch was missing. Now `/tops/domains` is called in parallel with the main fetch (phase 3) and the result is merged into the tab data.

---

## [0.8.5] - 2026-03-30

### Fix

- **Update banner** - Removed the "Docker image ready" text and `docker compose` command from the new version notification. The banner now only shows the version number and release notes summary.

---

## [0.8.4] - 2026-03-30

### For users

> Enriched dashboard: full fail2ban tooltip, type badges, full paths, GoAccess branding removed.

- **Fail2ban tooltip** - The fail2ban icon tooltip in the header now shows: bans since midnight, bans yesterday, unique IPs today, currently blocked IPs, all-time total, and active jails. Each section is clearly labelled.
- **Fail2ban badge** - The red badge shows today's bans (since midnight), consistent with the fail2ban page header.
- **Large files table** - Full path displayed (no more truncation). Type shown as a colored badge: access (green), error (red), syslog (blue), auth (orange), system (cyan), kernel (purple).
- **GoAccess branding removed** - The Stats page and its tooltips no longer reference GoAccess; the text now describes statistics generated from web server logs.

---

### Technical

#### Frontend - `src/components/layout/Header.tsx`

- **`fetchF2bSummary`** - Third `Promise.all` fetch added: `/api/plugins/fail2ban/history?days=2` to extract yesterday's ban count.
- **`f2bSummary`** - Extended state: `bansYesterday: number | null`, `totalAllTimeBans: number` (sum of `totalBannedSqlite` per jail), removed `expiredLast24h` (unused in tooltip).
- **Tooltip bodyNode** - Reorganized into three sections (`Today` / `Global` / `Jails - active bans`) with uppercase muted headers.

#### Frontend - `src/components/widgets/LargestFilesCard.tsx`

- **Path column** - `truncate max-w-[280px]` → `break-all`: full path always visible.
- **`TypeBadge`** - New component + `TYPE_STYLE` map: inline colored badge by log type.

#### Frontend - `src/locales/en.json` + `src/locales/fr.json`

- Removed "GoAccess" from `goaccessStats.subtitle` and `footer.goaccessStatsTooltip` keys.

---

## [0.8.3] - 2026-03-30

### For users

> Statistics performance, enriched tooltips, live fail2ban badge, and NPM MySQL fixes.

- **Statistics - instant period filters** - Changing the period (1d / 7d / 30d…) now shows charts in ~150ms (fast phase) then tables in ~400ms (full phase), instead of waiting 1–10s. Previous data stays visible during reload.
- **Adaptive cache** - Long periods (30d, 90d) are cached for 10min server-side and frontend; recent data (1d) stays at 30s. A second click on the same period within 2 minutes is instant.
- **Period prewarm** - After loading a period, other periods are silently preloaded in the background.
- **Fail2ban badge** - The fail2ban icon in the header shows a red badge with the number of currently banned IPs, updated automatically.
- **Fail2ban tooltip** - Hovering the fail2ban icon shows live stats: banned IPs, expired bans (24h), top jails.
- **Enriched tooltips** - All header and footer tooltips have been rewritten in the fail2ban style: colored title, icons, structured descriptions.
- **Footer - screen-edge icons** - On large screens, icons are now pinned to the left and right edges.
- **Footer - badges without background** - The size/files badges in the center of the footer no longer have a colored background (border only).
- **Update notification** - The new version banner now shows the GitHub release notes summary.
- **NPM MySQL - clear message** - If NPM is configured in MySQL mode but `npmDataPath` (log path) is missing, an explicit message is shown instead of a silent empty result.

---

### Technique

#### Backend - `server/plugins/fail2ban/Fail2banPlugin.ts`

- **SQLite composite index** - `idx_f2b_events_type_time ON f2b_events(event_type, timeofban)` added: eliminates full-table-scans on all `/tops` queries (×3 to ×5 speedup).
- **`_adaptiveTtl(days)`** - New method: 30s for ≤2d, 2min for ≤7d, 10min for ≥30d. Applied on `/tops`, `/history`, `/ipset/info`, `/ipset/history`.
- **`/tops?phase=fast`** - New parameter: returns only `summary` + `heatmaps` (~6 queries, ~150ms) by skipping slow topIps/topJails/topRecidivists queries. Separate cache key `tops:fast:{days}`.
- **`/tops/domains`** - NPM scan extracted from `/tops` into a dedicated route. Cache STORE_LIMIT=100, sliced in response only.
- **`/ipset/info` and `/ipset/history`** - TTL cache added (60s and adaptive).
- **NPM MySQL + npmDataPath** - `/tops/domains` returns an explicit `warning` if MySQL is configured without `npmDataPath`.

#### Backend - `server/routes/updates.ts`

- **Release notes** - `/api/updates/check` now fetches the body of the matching GitHub Release and returns it in `releaseNotes` (max 400 chars).

#### Frontend - `src/pages/fail2ban/TabStats.tsx`

- **`getCacheTtl(days)`** - Replaces the fixed `CACHE_TTL = 60_000`. Adaptive TTL aligned with backend.
- **Stale data UX** - On period change, previous data stays displayed with an "updating" badge instead of a blank spinner.
- **Progressive loading** - `fetchTops` fires `phase=fast` then `phase=full` with the same `AbortController`. Fast phase enriches partial state, full phase completes it.
- **Prewarm** - `useEffect` triggers a silent prefetch of adjacent periods 2s after full load, with stored AbortControllers for cleanup.
- **`topsRefreshing` + elapsed badge** - New state + `useElapsed` hook to display "updated Xs ago".

#### Frontend - `src/components/layout/Header.tsx`

- **Fail2ban icon** - Added to the plugin icons area (dashboard/analytics).
- **Enlarged icons** - `w-4 h-4` → `w-6 h-6`, reduced padding.
- **Logo** - `w-6 h-6` → `w-8 h-8`.
- **Live badge** - Red dot top-right on the fail2ban icon with `currentlyBanned`. Fetched on mount, 30s cache.
- **Fail2ban tooltip** - Live stats: banned IPs, 24h expired, top jails breakdown.
- **Plugin tooltips** - Replace native `title=` with rich `<Tooltip>`.

#### Frontend - `src/components/layout/Footer.tsx`

- **Screen edge** - `max-w-[1920px] mx-auto` removed, `w-full` used.
- **Badges without background** - `bg-*/10` removed from the 3 stats badges.
- **Enriched tooltips** - Title + structured bodyNode on files, size, gz, timer (adaptive timer green/orange/red).

#### Frontend - `src/components/ui/Tooltip.tsx`

- **Full rewrite** - F2bTooltip style: `#161b22` background, colored left accent border, accent title, `pre-wrap` body, arrow portal. Props: `title?`, `content?`, `bodyNode?`, `color?`, `width?`.

#### Frontend - `src/stores/updateStore.ts`

- **`releaseNotes?`** - Field added to `UpdateInfo`.

---

## [0.8.1] - 2026-03-30

### For users

> Fix for period filter freeze in the Statistics tab, and new "Retry" button when fail2ban is unreachable.

- **Period filters - no more freeze** - Changing the period (1d / 7d / 30d…) in the Statistics tab could freeze the page on instances with many jails or a large history. Data would stop refreshing even after multiple clicks. Fixed.
- **Socket banner - "Retry" button** - When the "Source unavailable - fail2ban daemon not responding" banner appears (socket inaccessible after a fail2ban restart), a **Retry** button appears on the right. One click immediately re-runs the check after fixing permissions (`sudo chmod 660 /var/run/fail2ban/fail2ban.sock`), with no page reload.

---

### Technical

#### Bug context (for future debugging)

The period filter freeze was caused by an accumulation of concurrent requests without cancellation. Each period change triggered ~6 simultaneous API requests (`/status`, `/history`, `/tops`, `/ipset/history`, `/tops?compare=1`, `/tops/prev`). The browser limits HTTP/1.1 connections to 6 per origin - beyond that, new requests are queued. Server calls use `fail2ban-client` with a 10s timeout: on a loaded instance (many jails, large SQLite), each request can take several seconds. By changing the period 2-3 times quickly, 12-18 requests accumulate and the queue stays blocked for 30s+.

The bug existed from the start but only manifested when the data volume / number of jails exceeded a threshold. The other Docker instance "that worked" simply had less load.

#### Frontend - `src/pages/Fail2banPage.tsx`

- **`fetchStatusAbortRef`** - New `useRef<AbortController | null>(null)` added after `hasBootstrappedRef`. Cancels any previous wave at the start of each `fetchStatus()` call.
- **`fetchStatus` - AbortController** - `fetchStatusAbortRef.current?.abort()` + new `AbortController ac` created at function start. Signal passed to both `api.get()` calls: `/status?days=X` and `/history?days=X` via `{ signal: ac.signal }`.
- **`fetchStatus` - guard in `waveDone`** - `if (ac.signal.aborted) return;` added as first line of `waveDone()`. Prevents a cancelled wave from calling `setRefreshBusy(false)` and resetting `hasBootstrappedRef` / `lastRefreshed` while a new wave is in progress.
- **"Source unavailable" banner - Retry button** - `<button onClick={fetchStatus}>Retry</button>` added to the right of the error text. Orange inline style consistent with the banner (`border: rgba(227,179,65,.4)`, `background: rgba(227,179,65,.12)`). `flex: 1` added to the text `<div>` to push the button to the right.

#### Frontend - `src/pages/fail2ban/TabStats.tsx`

- **`HistChart` extracted to module level** - Was defined as a component inside `IpSetsSection`, forcing React to unmount/remount it on every parent render (losing `hiddenLines` + `svgW` state, ResizeObserver needlessly recreated). Moved before `IpSetsSection` at module level. `IpSetHist` type alias introduced for `hist` type. Signature: `React.FC<{ hist: IpSetHist; days: number; onDaysChange: (d: number) => void }>`. Call site updated: `<HistChart hist={hist} days={days} onDaysChange={onDaysChange} />`. `hiddenLines` and `svgW` state now persistent across parent re-renders.
- **`topsAbortRef`** - New `useRef<AbortController | null>(null)` in `TabStats`. Cancels the previous `/tops` request at the start of each `fetchTops()`.
- **`fetchTops` - AbortController** - `topsAbortRef.current?.abort()` + new `AbortController ac`. Signal passed to `api.get('/tops?...')`. Guards added: `if (ac.signal.aborted) return;` in `.then()` and `.finally()` to prevent state updates on cancelled requests (setTopsData, setTopsLoading, dispatchTabLoaded).
- **`useEffect([days, fetchTops])` - cleanup** - `return () => { clearInterval(id); topsAbortRef.current?.abort(); }` - abort added to cleanup to cancel in-flight requests when component unmounts or `days` changes.
- **`IpSetsSection` - history effect AbortController** - `useEffect([days])` fetching `/ipset/history?days=X` had no cleanup. Replaced with a local `AbortController ac`: signal passed to `api.get()`, `!ac.signal.aborted` guard in `.then()`, `return () => ac.abort()` as cleanup. `IpSetHist` type used for `getCached<IpSetHist>`.

---

## [0.8.0] - 2026-03-30

### For users

> The Fail2ban button moves to the plugins area at the bottom right of the footer, with text and colored icon. Load time now also appears when navigating to the dashboard.

- **Footer - Fail2ban button** - Moved from the left navigation bar to the right plugins area. Shows the Fail2ban icon + "Fail2ban" text, with a red color when the tab is active - consistent with other plugin buttons.
- **Load time** - The time badge was not shown when navigating to the dashboard via the header logo. Fixed.

---

### Technical

#### Frontend

- **`Footer.tsx`** - Fail2ban button removed from the left navigation area and added to the right plugins section (`enabledLogPlugins`); active color red (`text-red-400 / bg-red-500/15`); removed unused `Shield` import.
- **`App.tsx`** - `handleHomeClick` and the log-viewer inline `onHomeClick` now call `handlePageChange('dashboard')` instead of `setCurrentPage` directly, which activates the `timedNavRef` timer and triggers the `tab-loaded` dispatch.

---

## [0.7.7] - 2026-03-29

### Fixed
- **bantime / findtime validation**: regex now accepts all fail2ban time suffixes - `w`/`week`/`weeks`, `mo`/`month`/`months`, `y`/`yr`/`year`/`years` - values like `6months` or `1y` no longer trigger a false validation error
- **Config file viewer**: `jail.local` is now the default tab when opening the file editor (was `fail2ban.conf`)

---

## [0.7.6] - 2026-03-29

### Fixed
- **`parseJailIniFile` - multi-line values**: continuation lines (indented with whitespace) were silently dropped; the parser now detects them before trimming and appends them to the previous key's value - `ignoreip` with 20+ IPs spread across multiple lines is now fully read
- **Syntax highlighter - continuation lines**: indented value lines in `fail2ban.conf` / `jail.local` were rendered as plain gray; they are now coloured green like regular values

---

## [0.7.5] - 2026-03-29

### Added
- **Telegram webhook - bot verification**: new "Vérifier" button calls `POST /api/notifications/telegram/verify` (Telegram `getMe`) and displays the bot username inline; token and Chat ID are now validated client-side before save
- **Discord webhook - URL validation**: URL must match `https://discord.com/api/webhooks/…` format; shown as inline field error
- **Generic webhook - URL validation**: must start with `http://` or `https://`
- **Webhook form - required field markers**: name field marked `*` required across all webhook types
- **Fail2ban Config - Application section**: collapsible frame with green `✓ OK` badge when `dashboard.db` exists and fragmentation ≤ 20%; expanded by default
- **Fail2ban Config - NPM integration badge**: green `✓ NPM SQLite` or `✓ NPM MySQL` badge in the Integrations card header when NPM is configured; auto-opens and shows warning when not configured
- **NPM plugin - SQLite auto-detect**: "Détecter database.sqlite" button in PluginOptionsPanel probes `basePath/../database.sqlite` and neighbouring paths; shows green badge with resolved path on success
- **`POST /api/plugins/npm/detect-db`**: new backend endpoint that resolves `database.sqlite` from a given `basePath` using three candidate paths
- **`POST /api/notifications/telegram/verify`**: new backend endpoint proxying Telegram `getMe` to validate a bot token server-side

### Fixed
- **JailConfigModal - ignoreip**: `addIgnoreip()` now validates IP/CIDR format before adding to whitelist; invalid entries show an error message instead of silently adding bad values
- **TabJails - banIp** (×2 components): ban form validates IP/CIDR format before submit; button disabled and inline error shown for invalid input
- **Fail2banPathConfig - MySQL save**: host, user, and db fields are required; port validated as integer 1–65535 before calling the API; port field border turns red for out-of-range values
- **TabConfig - fmPurgeage**: changed from free-text to `type="number" min=0`; `persistDb()` blocks save if value is not a non-negative integer
- **JailConfigModal - port**: `handleSave()` validates port field accepts only `22`, `http`, `80,443`, or `80:443` formats
- **SettingsPage - publicUrl**: `handleSave()` validates URL starts with `http://` or `https://` before calling the API
- **SettingsPage - username**: added forbidden-characters check (`[\w.\-]` only) on top of existing min-3 length check; input border turns red inline

---

## [0.7.4] - 2026-03-29

### Added
- **NPM - MySQL / MariaDB backend support**: Fail2ban top-domains stats now work when NPM runs with a MySQL/MariaDB database; configure via a new toggle (SQLite file / MySQL) in Fail2ban > Config tab with host, port, user, password, and database fields
- **NPM integration - auto-check badge**: on page load the NPM integration frame automatically runs a connection check if a config is already saved; shows a green badge (domain count + source) or red error without requiring a manual click
- **`getNpmDomainMap()` helper**: internal async helper in `Fail2banPlugin` that abstracts SQLite vs MySQL access for the `/check-npm` and `/tops` routes; MySQL mode uses `mysql2/promise` with a 5-second connect timeout

### Changed
- **NPM config path**: SQLite path (`npmDataPath`) and MySQL credentials stored together under `npmDbType` selector; both saved via `POST /api/plugins/fail2ban/config` in a single settings object

---

## [0.7.3] - 2026-03-29

### Added
- **Plugins - test button per card**: each plugin card in Administration now has a visible `⚡ Test` button that calls the connection test and fires a toast notification (green = OK, red = error message)
- **Plugins - activation guard**: enabling a plugin now runs `testConnection()` first; if the test fails, activation is blocked and a red toast explains why - no more silent broken activations
- **Plugins - activation notifications**: every toggle (enable/disable) fires a toast via `notificationStore` with the result
- **Plugins - toggle spinner**: the toggle button shows a spinner while the connection test + activation is in progress
- **PluginOptionsPanel - save/test toasts**: saving or testing a plugin config from the options panel now also triggers a global `notificationStore` toast (in addition to the inline result)
- **Webhook test in edit form**: when editing an existing webhook, a `✉ Envoyer un test` button appears in the form footer; result displayed inline + as a global toast
- **Webhook test button in list**: the small invisible `RefreshCw` icon is replaced by a visible `⚡ Test` button with label
- **Discord/Telegram SVG icons**: logos now appear in webhook type badges and add-buttons (`public/icons/services/telegram.svg`, `src/icons/telegram.svg`)
- **Security > Protection - collapsible sections**: Attack Protection, Blocked IPs, and Active Features are collapsible frames (Active Features collapsed by default)
- **host-system plugin enabled by default**: on first start (no DB config), the host-system log plugin is auto-enabled since system logs are always present

### Changed
- **Fail2ban config split**: SQLite DB path is now only in Administration > Plugins (plugin options), NPM data path is only in Fail2ban > Config tab - no more duplication
- **`Fail2banPathConfig`**: each section (SQLite / NPM) renders only when the corresponding callback is provided - clean separation of concerns

### Fixed
- **`Fail2banPlugin.testConnection()`**: was using `existsSync` (existence only) with OR logic - now tests socket with `R_OK|W_OK` permissions AND SQLite readability; both required; detailed warnings logged
- **`NginxLogPlugin.testConnection()`**: empty catch block replaced with proper error logging (path + error code)
- **`HostSystemLogPlugin.testConnection()`**: journald bypass (was returning `true` unconditionally when journald enabled) now actually checks journal directory accessibility
- **`PluginsManagementSection`**: `!plugin.configured` guard now also fires a notification instead of only showing a temporary status badge

---

## [0.7.2] - 2026-03-29

### Added
- **Settings > Metrics - sub-tabs**: Prometheus, InfluxDB, and MQTT (Home Assistant) each have their own tab; MQTT is first
- **Settings > Metrics - MQTT toggles**: all checkboxes replaced with modern slide toggles (teal theme); each tab has its own save button and unsaved-changes banner
- **Settings > Notifications - sub-tabs**: split into "Notifications internes" and "Webhooks" tabs, each with a framed content area
- **Settings > Notifications - Webhook event triggers**: per-webhook toggle to select which events trigger a dispatch (ban auto, tentative, action manuelle)
- **Settings > Notifications - Webhook batching**: per-webhook batch window (0–60 min) and max-per-batch (1–50) configuration stored in `AppConfig`
- **Webhook dispatch service** (`WebhookDispatchService`): singleton service that actually fires webhooks on ban/action events - Discord (rich embeds), Telegram (HTML), generic HTTP (JSON); supports immediate and cron-batched delivery
- **Automatic ban webhooks**: `fail2banSyncService` dispatches a `ban` event for every new ban detected during non-initial sync
- **Manual action webhooks**: Fail2ban ban/unban API routes dispatch an `action` event with username attribution
- **Settings > Security - sub-tabs**: Protection, Utilisateurs, Réseau, Journaux; Auth settings moved to Utilisateurs; Network + CORS grouped under Réseau
- **Settings > Security > Protection - collapsible sections**: Attack Protection, Blocked IPs, and Active Features are now collapsible frames (Active Features collapsed by default)
- **Telegram SVG icon**: added to `public/icons/services/telegram.svg` and `src/icons/telegram.svg`; Discord and Telegram logos now appear in webhook type badges and add-buttons in the UI

### Changed
- Webhook route (`server/routes/notifications.ts`) extended to persist `events`, `batchWindow`, `maxPerBatch` fields
- Removed placeholder warning "Le déclenchement automatique sera actif dans une prochaine mise à jour" - webhook dispatch is now fully implemented

---

## [0.7.1] - 2026-03-29

### Added
- **Fail2ban > Backup - local snapshots**: config and DB snapshots stored in-app, auto-pruned (max 10 for config, max 5 for DB), with per-row download / restore / delete actions
- **Fail2ban > Backup - per-row download**: IPTables and IPSet backup entries now have a download button to save files locally
- **Fail2ban > Backup - DB export/import**: export only the 6 `f2b_*` tables as JSON; import with merge or replace mode
- **Fail2ban > Config - integration panel**: button order fixed (Test before Save for both SQLite and NPM fields); Save buttons changed from red to blue
- **Fail2ban > Backup - color unification**: backup/save actions = green, restore/import actions = orange, delete actions = red; section header badges keep distinct identity colors

### Changed
- `TabBackup` refactored into self-contained sub-components: `ConfigSnapshotPanel`, `ConfigRestorePanel`, `DbSnapshotPanel`, `DbImportPanel`, `IptBackupPanel`, `IpsetBackupPanel`
- All backup section grids use `alignItems: stretch` with sticky action buttons at card bottom

---

## [0.6.9] - 2026-03-28

### Fixed
- fix: replace `sudo bash <(curl ...)` with `curl ... | sudo bash` everywhere - process substitution fails when `/dev/fd` is unavailable (TabConfig UI, TabAudit UI, README.md, README.fr.md, docker-compose.yml, docker-compose.local.yml)

---

## [0.6.8] - 2026-03-28

### Docs
- docs: fix VACUUM docker-compose example - short-form mount `- /var/lib/fail2ban:/host/var/lib/fail2ban` cannot override a `:ro` parent mount; correct syntax uses `type: bind` with `propagation: shared`
- docs: update `docker-compose.yml`, `README.md`, `README.fr.md` with working VACUUM override and explanation

---

## [0.6.7] - 2026-03-28

### Fixed
- fix: `TypeError: ae.flatMap is not a function` on Fail2ban page in Docker - fallback SQLite path in `/status` route returned `jails` as a Record object instead of an array; changed to `Object.values(jailsMap)`

---

## [0.6.6] - 2026-03-28

### Fixed
- fix: Fail2ban SQLite VACUUM fails in Docker when host filesystem is mounted `:ro` - backend now detects EROFS/SQLITE_READONLY and returns `dockerReadOnly: true`; UI shows the exact docker-compose volume override to enable VACUUM

### Improved
- style: unify input field appearance across all Fail2ban tabs (`#161b22` background + 3-layer inset shadow + `borderBottom: #555`)
- style: convert Fail2banPathConfig.tsx from Tailwind classes to inline styles matching the PHP-palette design system

### Docs
- docs: document `:ro` vs VACUUM trade-off in `docker-compose.yml`, `README.md`, and `README.fr.md` - add commented-out rw override line for enabling VACUUM

---

## [0.6.5] - 2026-03-28

### Performance
- perf: add TTL route cache to Fail2banPlugin for slow endpoints (/status 8s, /history 30s, /tops 30s, /bans-today 5s, /config/parsed 60s)
- perf: /tops always computes 100 items (STORE_LIMIT) regardless of `limit` param - deduplicates concurrent TabStats (limit=100) and BanHistoryChart (limit=1) requests via shared cache key
- perf: delay initial checkConfigWarnings() call by 4s so /config/parsed (~6s) does not compete with /status+/history during first-load wave

---

## [0.6.4] - 2026-03-28

### Added

- **README.fr.md** - French mirror of the main README; link added at the top of `README.md`
- **i18n: `common` namespace** - shared keys for loading, saving, error, close, cancel, hide, refresh, save, edit, delete and their variants; used across all pages
- **i18n: `header` namespace** - all Header.tsx button titles, page titles, live/auto-refresh labels, update badge
- **i18n: `logViewer.types` namespace** - log file type labels (auth, daemon, access, error, syslog, subdomain…) now translated instead of hardcoded
- **i18n: `permissions` namespace** - Freebox permission labels and error messages
- **i18n: `fail2ban` namespace** - 150+ strings across 11 files now fully translated (tabs, status, actions, labels, tooltips, placeholders, errors, periods, attack categories, time-ago, views, config, jails, tracker, map, backup, stats)

### Changed

- **README.md** - fully translated to English (was French/English mix); French version moved to `README.md.fr`
- **CHANGELOG.md** - all French-language entries translated to English
- **`Header.tsx`** - 20+ hardcoded French strings replaced with `t()` calls; `useTranslation` added
- **`LogFileSelector.tsx`** - static `TYPE_LABELS` constant replaced with dynamic `t('logViewer.types.*')` calls
- **`permissions.ts`** - `PERMISSION_LABELS` replaced with i18n key lookups; `getPermissionErrorMessage` and `getPermissionShortError` now accept `TFunction` parameter
- **`PermissionBanner.tsx`** - uses `useTranslation`; hardcoded French string replaced
- **`SettingsPage.tsx`** - error/loading messages in 4 sub-components replaced with `common.errors.*` keys
- **`LogViewerPage.tsx`** - loading and error strings replaced with `common.*` keys
- **Fail2ban - `Fail2banPage.tsx`** - tab labels, time-ago strings, period labels migrated to i18n
- **Fail2ban - `TabJails.tsx`** - filter placeholders, view toggles, status labels, tooltips migrated
- **Fail2ban - `TabStats.tsx`** - stat card labels, section titles, loading states migrated
- **Fail2ban - `TabBackup.tsx`** - backup/import/export labels and error messages migrated
- **Fail2ban - `TabConfig.tsx`** - config labels, error messages migrated
- **Fail2ban - `TabMap.tsx`** - map loading, country filter labels migrated
- **Fail2ban - `IpModal.tsx`** - attack categories, geo labels, table headers migrated
- **Fail2ban - `TabTracker.tsx`** - DNS mode, geo, column headers migrated
- **Fail2ban - `TabBanManager.tsx`** - placeholders and error messages migrated
- **Fail2ban - `TabIPTables.tsx`** - chain/rule labels migrated
- **Fail2ban - `JailConfigModal.tsx`** - error and loading strings migrated
- **Fail2ban - `helpers.tsx`** - `StatusDot` status strings migrated

---

## [0.5.7] - 2026-03-27

### Fixed

- **IP modal log display** - filter out `/api/plugins/fail2ban/` lines from log entries (self-generated API calls were appearing as duplicates); log file sections with no remaining lines are hidden; line count badge reflects filtered count

---

## [0.5.6] - 2026-03-27

### Fixed

- **CI: upgrade GitHub Actions to Node.js 24** - updated all actions to latest versions (`actions/checkout@v6`, `docker/*@v4`/`v6`/`v7`) to eliminate Node.js 20 deprecation warnings before the June 2026 forced migration

---

## [0.5.5] - 2026-03-27

### Fixed

- **Docker build warnings** - suppressed deprecated transitive dependency warnings (`rimraf@3`, `glob@7`, `npmlog`) during `npm ci`; these come from `bcrypt` → `@mapbox/node-pre-gyp` build tools only, not runtime
- **CI: Docker Hub login** - added Docker Hub authentication before QEMU/buildx setup to avoid anonymous pull rate limits on GitHub Actions runners
- **Firewall tabs: `no-new-privileges` incompatibility** - `security_opt: no-new-privileges:true` prevents `sudo` from running, breaking `iptables-save`/`ipset list`/`nft`; commented out in firewall mode with clear explanation in all compose files and README

---

## [0.5.4] - 2026-03-27

### Fixed

- **Firewall tabs (IPTables / IPSet / NFTables) now work correctly in Docker** - `network_mode: host` is required (not just `cap_add: NET_ADMIN`) to share the host network namespace; without it the container saw its own empty namespace instead of the host rules
- **`security_opt: no-new-privileges:true` incompatible with firewall tabs** - this flag prevents `sudo` from elevating privileges, breaking `iptables-save`, `ipset list`, and `nft` commands; must be removed when using firewall tabs
- **JWT tokens invalidated on container restart** - JWT secret is now persisted in the SQLite `app_config` table on first start; subsequent restarts reuse the same secret instead of generating a new one
- **WebSocket endpoints unauthenticated** - `/ws/log-viewer` and `/ws/logs` now require a valid JWT token passed as `?token=` query parameter; connections without a valid token are rejected with code 4401
- **CORS misconfigured in production** - default changed from `true` (all origins) to `false` (same-origin only); set `CORS_ORIGIN` env var to allow a specific origin if needed
- **Path traversal in log viewer** - user-supplied `basePath` values containing `..` are now rejected
- **Path traversal in config import** - uploaded file paths are validated against the allowed config directory using `path.resolve()`
- **Public endpoints unprotected** - `/api/users/check` (20 req/min) and `/api/users/register` (5 req/min) are now rate-limited per IP

### Changed

- **`docker-compose.yml`** - clarified MODE A (bridge, default) vs MODE B (host network, firewall tabs) with inline examples; documented `PORT` vs `DASHBOARD_PORT` distinction; added reverse proxy examples (NPM, Nginx, Caddy, Traefik)
- **`docker-compose.test.yml`** - `security_opt: no-new-privileges` commented out (incompatible with firewall tabs in host network mode)
- **README** - firewall tabs section updated with all three incompatibilities (`ports:`, `no-new-privileges`, port change workflow); reverse proxy configuration examples added
- **Security headers** - added `X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`; removed `X-Powered-By`

---

## [0.4.9] - 2026-03-26

### For users

> Real-time 24h chart, functional Domain column, and automatic refresh of Fail2ban events.

- **Rolling 24h chart** - The chart no longer shows fixed 24-hour slots (00h–23h) but always displays the **last 24 hours** from now, with data points every 30 minutes. The X axis shows exact times (e.g. `14:00`, `15:00`…) and updates continuously.
- **Domain column in Events** - The "Domain" column of the Events table (Jails tab) now displays the domain name of the attacked site for jails linked to Nginx Proxy Manager. Resolution uses the NPM database directly - more reliable than config files that may not exist.
- **Automatically refreshed events** - The Fail2ban events table reloads every 30 seconds in the background (paused when the tab is hidden).
- **Fixed double scrollbar** - The Jails page sometimes displayed two simultaneous scrollbars; this is now fixed.

---

### Technical

#### Backend - Fail2ban

- **`Fail2banPlugin.ts`** - Strategy 3 domain replaced: reads `<npm_base>/database.sqlite` (`proxy_host.domain_names`) via `better-sqlite3` in read-only mode, instead of nginx `.conf` files that may not exist for deleted hosts. `better-sqlite3` import added. `_debug_domains` field removed from `/audit` response.
- **`Fail2banSqliteReader.ts`** - `SLOT_SECS = 1800` (30 min). For `days=1`, `since` aligned to the 30-min boundary (`Math.floor(rawSince / 1800) * 1800`), slots indexed by `CAST((timeofban - since) / 1800 AS INTEGER)`, labels `HH:MM`. `slotBase` returned in response for frontend synchronization.

#### Frontend - Fail2ban

- **`BanHistoryChart.tsx`** - `buildHourlySlots()` replaced by `buildRollingSlots(history, slotBase)`: 48 slots of 30 min from `slotBase` to now, recalculated in real time via a 5s ticker. X labels displayed only on `:00` slots (one label per hour). Vertical "now" line removed.
- **`Fail2banPage.tsx`** - `slotBase` state added, fed from `fetchStatus`, passed to `BanHistoryChart`.
- **`TabJails.tsx`** - `AuditEnrichment._debug_domains` removed; debug panel removed. `fetchAudit` re-polls every 30s with `document.hidden` guard. Domain resolution via `enrichment.jail_domains[b.jail]`.

#### Frontend - Global

- **`App.tsx`** - `wrapWithBackground(content, fullscreen=true)`: `h-screen overflow-hidden` variant without `pb-20` for the Fail2ban page → removes the double scrollbar.
- **`TabAudit.tsx`** - Simplified: the Events/Logs sub-tab switcher removed; the Audit tab now only shows `TabJailsFiles` (Events have their own nav entry).
- **`TabBanManager.tsx`** - `FileBtn` component (styled file button hiding the native `<input type="file">`); responsive grid `minmax(min(100%,420px),1fr)`.
- **`TabConfig.tsx`** - `local_exists` field in `GlobalConfig`; extended DB stats (`bans`, `jails`, `logs`); `resetting` state for the maintenance button.

---

## [0.4.8] - 2026-03-25

### For users

> Refined Fail2ban interface: more compact header, 24h chart by hour, bantime and map fixes.

- **More compact header** - The main navigation bar is slimmer; the Clock and User badges take up less space to leave more room for content.
- **Wider Fail2ban menu** - The left sidebar of the Fail2ban plugin is slightly wider to display tooltips in full; the collapse arrow is always positioned on the right.
- **Centered ban notifications** - Ban alerts now appear at the top center of the screen, clearly visible without obstructing navigation.
- **24h chart: axis by hour** - In "24h" filter mode, the X axis displays all 24 hours (00h–23h) to see precisely what time bans occurred. Other periods automatically adapt the number of labels (7d → 7 labels, 1yr → ~13 labels…).
- **Fixed chart legend** - Clicking a jail name in the legend now actually hides its curve/bar and recalculates the Y scale accordingly.
- **Colored bantime** - The Bantime column in the Jails tab displays a color based on duration: green (< 1h), blue (1h–24h), orange (1d–30d), red (≥ 30d or permanent).
- **Exact bantime for all jails** - Jails whose ban duration was not present in config files (e.g. `recidive`, `apache-shellshock`) now retrieve the actual value via the Fail2ban socket.
- **Regex sections collapsed by default** - The two regex management sections in Settings are now closed on load to lighten the page; a badge shows the number of configured regexes.
- **Map: crash on first load fixed** - The Leaflet map no longer crashes on first display in development mode (Leaflet/MarkerCluster race condition resolved).

---

### Technical

#### Frontend - Fail2ban

- **`BanHistoryChart.tsx`** - `isHourly` prop passed to `BarChart`/`LineChart` sub-components; `effectiveMax` recalculated from visible jails only (legend fix); `labelCountForDays()` adapts label count by period; `buildHourlySlots()` generates 24 slots "00"–"23" for `days=1`.
- **`Fail2banPage.tsx`** - `granularity` state passed to `BanHistoryChart`; ban toasts recentered (`position:fixed, top:5rem, left:50%, transform:translateX(-50%)`); sidebar widened to 220px; `›`/`‹` button always aligned to the right.
- **`TabJails.tsx`** - Colored bantime badge: `bantime < 0 || >= 2592000` → red, `>= 86400` → orange, `>= 3600` → blue, otherwise green.
- **`TabMap.tsx`** - `loadScript()` fixed for React Strict Mode: if the `<script>` is already in the DOM, waits for the `load` event (via `_loaded` flag) instead of resolving immediately → fixes `L.markerClusterGroup is not a function`.

#### Backend - Fail2ban

- **`Fail2banPlugin.ts`** - `parseNum()`: regex `^(-?\d+...)` handles negative bantimes (`-1` = permanent) and the `w` unit (weeks); for jails whose `bantime/findtime/maxretry` is absent from config files, `getJailParam()` is called as fallback via the socket.
- **`Fail2banClientExec.ts`** - New method `getJailParam(jail, param)`: executes `fail2ban-client get <jail> <param>` and parses the returned numeric value.
- **`Fail2banSqliteReader.ts`** - `getBanHistoryByJail()` and `getBanHistory()`: when `days=1`, SQL query uses `strftime('%H', timeofban, 'unixepoch')` for hourly grouping; returns `granularity: 'hour' | 'day'`.

#### Frontend - Global

- **`Header.tsx`** - Reduced padding (`p-4` → `px-4 py-2`), logo `w-8 h-8` → `w-6 h-6`, plugin icons `w-5 h-5` → `w-4 h-4`.
- **`Clock.tsx`** - Container `px-4 py-2` → `px-2.5 py-1.5`, LED dot `w-2 h-2` → `w-1.5 h-1.5`, time text `text-sm` → `text-xs`.
- **`UserMenu.tsx`** - Button `px-3 py-2` → `px-2 py-1.5`, avatar `w-10 h-10` → `w-6 h-6`.
- **`SettingsSection.tsx`** - `collapsible`, `defaultCollapsed`, `badge` props added to `<Section>` with chevron animation.
- **`RegexManagementSection.tsx`** - Both sections (`customTitle`, `generatorTitle`) pass `collapsible defaultCollapsed`; counter badge on the custom section.
- **`SettingsPage.tsx`** - Removed redundant `<Section>` wrapper around `<RegexManagementSection />`.

#### Documentation

- **`README.md`** - Simplified: quick install section at the top, Fail2ban section with a single curl command, cleaned env table.

---

## [0.4.7] - 2026-03-25

### For users

> The Fail2ban plugin now works automatically in Docker, without manual group configuration.

- **Automatic Fail2ban socket access** - The container now detects Fail2ban socket permissions at startup and adapts automatically. No longer need to configure `FAIL2BAN_GID` in the `.env` file: the plugin activates as soon as `setup-fail2ban-access.sh` has been run once on the host.

---

### Technical

#### Docker - `docker-entrypoint.sh`

- **Dynamic GID detection** - Replaces the old static `chmod 660`. On each container start: `stat -c "%g"` reads the real GID of the socket, creates the corresponding group in Alpine (`addgroup -g $SOCK_GID fail2ban`), then adds `node` to that group. Works regardless of the GID used on the host, without any environment variable.
- **Explicit log message** - If `gid=0` (socket still `root:root`), displays a message pointing to `setup-fail2ban-access.sh`.

#### Docker - `docker-compose.yml`

- **Removal of `FAIL2BAN_GID` from `group_add`** - This `group_add` mechanism was inoperative because the `fail2ban` group does not exist in the base Alpine image (Docker silently ignores GIDs absent from `/etc/group`). The entry has been removed; the entrypoint now handles everything dynamically.

---

## [0.4.3] - 2026-03-25

### What's new for users

> Fail2ban plugin configuration check: clearer diagnostics and accurate status indicators.

- **Fail2ban check panel** - All status indicators (socket, daemon, SQLite, drop-in) now reflect the real state correctly. The daemon was previously shown as red even when Fail2ban was running - this is fixed.
- **Fix instructions hidden when OK** - The "See how to fix" button is now hidden for checks that pass. Only failed checks show repair instructions.
- **Paths displayed in full** - File paths (socket, SQLite database) are now shown on their own line, never truncated.
- **README** - Added Fail2ban plugin documentation section.

---

### Technical

#### Backend - `server/plugins/fail2ban/Fail2banPlugin.ts`

- **Daemon check**: was using `this.client?.ping()` which is only initialized when the plugin is already enabled → always null/false before first enable. Now creates a temporary `new Fail2banClientExec()` instance so the check works before the plugin is enabled.
- **Socket fix message**: updated to recommend `chmod 666` (instead of 660) to ensure Docker container access regardless of group. Includes drop-in file path and corrected content.
- **Drop-in fix**: removed the spurious `fix` message that appeared when `dropin.ok=true` but socket was inaccessible - that case now only appears in `socket.fix`.
- **SQLite path in response**: now returns `rawDbPath` (user-facing path, e.g. `/var/lib/fail2ban/fail2ban.sqlite3`) instead of the Docker-resolved internal path (`/host/var/lib/...`).
- **Daemon fix message**: now shows a clear "cannot check - socket inaccessible" message instead of silently returning red with no explanation.

#### Frontend - `src/components/PluginOptionsPanel.tsx`

- **"Voir comment corriger" hidden when `c.ok=true`**: changed `{hasFix && ...}` to `{hasFix && !c.ok && ...}`.
- **Path display**: moved from inline truncated `max-w-[200px]` to a dedicated sub-line with `break-all` so full paths are always visible.
- **Hardcoded helper text**: fixed `/host/var/lib/fail2ban/fail2ban.sqlite3` → `/var/lib/fail2ban/fail2ban.sqlite3`.

#### Documentation - `README.md`

- Added Fail2ban plugin entry in the Plugins section (features, tabs, requirements, configuration).

---

## [0.4.2] - 2026-03-25

### What's new for users

> Automatic update notifications and configurable default page on login.

- **Automatic update check** - LogviewR can now check whether a new version is available and notify you directly in the UI. A dismissable banner appears at the top of the screen when an update is ready (Docker image built on GHCR), with the exact command to run. Check frequency and enable/disable are configurable in Administration → General.
- **Configurable default page** - Choose which page opens after login: dashboard, log viewer, or the Fail2ban page with a specific tab pre-selected.
- **Reminder - Fail2ban plugin** *(available since v0.4.0)* - If you run a server with Fail2ban, the dedicated plugin provides full monitoring: active jails, banned IPs, ban history, attack map, IP tracker, statistics, and ban management. Enable it in Administration → Plugins.

---

### Technical

#### Administration - Update checker

- **`server/routes/updates.ts`** - New version check module: primary method via GitHub Tags API, Docker image availability verified on GHCR (anonymous Bearer token + HEAD manifest check) before reporting an update; `dockerReady: boolean` field separate from `updateAvailable`.
- **`src/stores/updateStore.ts`** - Zustand store: `checkForUpdates`, `loadConfig`, `setConfig(enabled, frequency)`; `UpdateInfo` interface with `dockerReady` field.
- **`src/pages/SettingsPage.tsx` - `UpdateCheckSection`** - Enable toggle + frequency selector (1h/6h/12h/24h/7d); current version / latest version / GHCR build status display; conditional `docker compose pull && docker compose up -d` command block.
- **`src/App.tsx`** - Sticky dismissable banner (amber) shown only when `updateAvailable && dockerReady`; dismissal persisted per version in `localStorage['logviewr-dismissed-version']`; periodic polling based on configured frequency.

#### Administration - General tab

- **Default page** - Added `fail2ban` as a startup page option with tab selector (12 tabs), conditioned on plugin being enabled.
- **`server/routes/system.ts`** - Bug fix: `defaultPage`, `defaultPluginId`, `defaultLogFile` were never written in `PUT /api/system/general` (silent bug since initial implementation). Added `defaultFail2banTab`. Validation against `VALID_PAGES = ['dashboard', 'log-viewer', 'fail2ban']`.
- **`src/App.tsx`** - Effective navigation to configured default page on login (fetch `GET /api/system/general` in `useEffect([isUserAuthenticated])`).
- **DefaultPageSection flicker fix** - General tab no longer unmounts its content on tab switch (`display:none` instead of `&&`); module-level cache for fetched values; inline save indicator (12px spinner in title) with no layout shift.

#### Administration - UI

- **Notifications tab → Webhooks** - Renamed in `en.json` and `fr.json`.
- **Exporter - Removed "Log overview stats" card** - Stats block (files, .gz, active plugins, errors) removed from Exporter tab; related state and `useEffect` removed from `ExporterSection.tsx`.

#### Server log cleanup

- All non-essential `console.log` calls migrated to `logger.debug()` (gated, debug mode only) in: `BasePlugin`, `Fail2banPlugin`, `NotificationPlugin`, `AnalysisPlugin`, `HostSystemLogPlugin`, `fail2banSyncService`, `configService`, `routes/updates.ts`.
- `console.error` → `logger.error()` throughout; no sensitive data (tokens, API keys, full responses) appears in logs.

---

## [0.4.1] - 2026-03-25

### Fixed

- **BanHistoryChart** - Removed `overflow: hidden` on the card wrapper that was masking the SVG chart on view changes.
- **BanHistoryChart** - Clicking the card header no longer accidentally collapses the chart; the collapse toggle is now only on the dedicated `▾/▸` button.
- **Fail2ban - Scrolling** - Switching main tab (Fail2banPage) and switching view in TabJails (Cards/Table/Events) now automatically scrolls back to the top of the page; the chart was invisible because it was hidden above the viewport.
- **Search bars** - Correct centering in the toolbars of TabJails, TabJailsEvents, TabFiltres, TabActions, TabTracker, TabStats (pattern `flex:1; justify-content:center`).
- **Jails tables** - Removed `overflowX: auto` and excessive `minWidth` on the Events and Table tables to avoid unwanted horizontal scroll.

### Added

- **Shared IpModal** (`src/pages/fail2ban/IpModal.tsx`) - New IP detail modal shared across all tabs:
  - Header: IP (red monospace), recidivist badge if present in `recidive` jail, flag + city/country + organization.
  - 2-column block: Statistics (total bans, jail(s), last ban, first ban, attempts) | Whois/Network (country, organization, ASN, ISP, city).
  - **Ban in recidive** button (hidden if already a recidivist), with success/error visual feedback.
  - Scrollable history table (date, jail, duration, attempts) with sticky headers.
  - Auto-fetch geolocation if not provided by the calling context.
  - Exports: `IpModal`, `GeoInfo`, `toFlag`, `fmtBantime`.
- **Clickable IPs - TabTracker** - Updated to use the new shared `IpModal` (local component removed); known jails passed to the modal.
- **Clickable IPs - TabJailsEvents** - IPs in the Events table now open the detail modal.
- **Clickable IPs - JailCard (Cards view)** - Banned IPs in the jail card table now open the detail modal.
- **Clickable IPs - JailExpandedGrid (Table view)** - IPs in the "Bans < 5 min" and "Active banned IPs" columns open the detail modal.

---

## [0.4.0] - 2026-03-25

### Added

#### Fail2ban Plugin - Full integration

New Fail2ban monitoring plugin with a complete multi-tab interface, visually aligned with the PHP reference project `fail2ban-web`.

**Backend (`server/plugins/fail2ban/`)**
- `Fail2banPlugin.ts` - Express plugin with 20+ REST routes covering status, history, jails, bans, filters, actions, tracker, map, IPTables, IPSet, NFTables, configuration, audit.
- `Fail2banSqliteReader.ts` - Direct read of the fail2ban SQLite database (`fail2ban.sqlite3`) in read-only mode; active stats, daily history, top IPs/jails, hourly heatmap, unique IPs, expired bans.
- `Fail2banClientExec.ts` - Execution of `fail2ban-client` commands via Unix socket (ban, unban, reload, status) and system utilities (iptables, ipset, nftables).
- `fail2banSyncService.ts` - Periodic synchronization service SQLite → application DB.
- `f2b_ip_geo` table in application SQLite DB: IP geolocation cache with 30-day TTL.

**Frontend (`src/pages/Fail2banPage.tsx` + `src/pages/fail2ban/`)**
- **TabJails** - Table/cards/events/log files view of active jails; inline expansion with detailed config (bantime, findtime, maxretry, filter, actions, banned IPs); Active/All toggle to show configured but stopped jails (semi-transparent); integrated search filter; ban/unban/reload actions per jail.
- **TabStats** - Global statistics: top IPs, top jails, ban/attempt heatmap by hour, jail distribution, jail summary, period summary, attack types, latest events, IPSets.
- **TabTracker** - Table of currently banned IPs enriched with: reverse DNS resolution (with 10-min cache), IPSet membership per IP, on-demand geolocation (ip-api.com), IP detail modal with ban history.
- **TabMap** - Leaflet map (CDN, dark CartoCDN tile) with MarkerCluster clustering; progressive geolocation; country/region filter side panel with heat-colors; IP popup with link to Tracker.
- **TabBanManager** - Manual ban/unban interface with jail selection + IP input.
- **TabFiltres / TabActions** - View of filters and actions configured per jail with colored badges.
- **TabConfig** - Fail2ban configuration editor (jail.conf, jail.local, jail.d/) with visual diff and reload.
- **TabAudit** - Real-time tail of fail2ban.log with syntax highlighting.
- **TabNetworkRaw** - Raw IPTables / IPSet / NFTables display.
- **TabAide** - Integrated documentation.
- **BanHistoryChart** - Shared chart (bars or curves) displayed once for the Jails and Stats tabs; selectable period (24h, 7d, 30d, 6m, 1yr, All).
- **Topbar chips** - Real-time badges: active jails (blue), banned (red), failures (orange), active (green).
- **Toast notifications** - Automatic detection of new bans on each poll (every 30s) with animated toast.
- **Refresh badge** - Exact time of last refresh + relative age in the title bar.
- **Collapsible sidebar** - Left menu collapsible (icons only) with toggle in header and at bottom of menu.
- **Mini stat cards** - 6 cards (Active Jails, Active Bans, Active Failures, Total cumulative bans, Unique IPs, Expired 24h) with sparklines and ↑/↓ trend indicators.
- **Variable interpolation** - Resolution of `%(__name__)s` and `%(var)s` in filter/banaction badges of inactive jails.
- **JailConfigModal** - Quick edit modal for bantime / findtime / maxretry parameters with slider and step buttons.

**Design**
- Exact PHP palette: `bg0=#0d1117`, `bg1=#161b22`, `bg2=#21262d`, `border=#30363d`, `green=#3fb950`, `blue=#58a6ff`, `red=#e86a65`, `orange=#e3b341`, `purple=#bc8cff`, `cyan=#39c5cf`.
- PHP-style pills `.jdp-pill` (`border-radius: 6px`) in the expanded jail view.
- PHP-style chips `.chip` (`border-radius: 20px`, transparent background) in the topbar.

**Infrastructure**
- Unix socket `/var/run/fail2ban/fail2ban.sock` mounted RW in docker-compose.
- `docker-entrypoint.sh`: automatic `chmod 660` on socket at startup.
- Fail2ban SVG icon (`src/icons/fail2ban.svg`).

---

## [0.3.8] - 2026-03-13

### Added

#### Log Viewer – IP Filter (Apache, NPM, Nginx)
- **IPs or ranges to hide**: Option in plugin configuration (Settings > Plugins and config modal) to define IPs or CIDRs to exclude from display (one per line or separated by comma/semicolon).
- **Hidden by default**: Lines whose IP (columns ip, ipaddress, clientip, remoteip) matches the list are hidden; click the "Filtered: N" badge to show or hide these lines.
- **Badge in stats bar**: "Filtered: {{count}}" badge (or "Filtered: {{count}}") next to total/valid/filtered/unreadable indicators; the number indicates how many lines are currently hidden by the IP filter (0 when everything is shown).
- **Click on IP → modal**: Clicking an IP cell in the table, a modal offers to add this IP to the excluded IPs list; confirmation saves the plugin config and refreshes the list.
- **Utility**: `src/utils/ipFilterUtils.ts` (parseExcludedIps, isIpInExcludedList, isLogExcludedByIp, IPv4 and CIDR support).

#### Translations (i18n)
- Keys `excludedIpsLabel`, `excludedIpsPlaceholder`, `excludedIpsHelp` (pluginConfig); `ipFilterBadgeHidden`, `ipFilterBadgeAll`, `ipFilterTooltipShow`/`Hide`, `addIpToFilterTitle`/`Message`/`Confirm`/`Cancel` (logViewer).

---

## [0.3.5] - 2026-03-10

### Security

- **`tar` dependency**: Override updated `>=7.5.9` → `>=7.5.10` to fix the path sanitization vulnerability (Dependabot PR #6, `isaacs/node-tar@7bc755d`). Closed PR #6 (fixed directly via override).

---

## [0.3.4] - 2026-02-13

### Added

#### Log Stats – New charts and visualizations
- **Monthly heatmap**: `HeatmapChart` component (GitHub contributions style) to visualize request density by day over the month, displayed at day granularity.
- **Peak Hours**: `PeakHoursChart` component – request distribution by hour of day (bars, hour/minute granularity only).
- **Traffic by Day of Week**: `DayOfWeekChart` component – traffic distribution by day of the week.
- **Hour × Day Heatmap**: `HourDayHeatmap` component – hour/day cross heatmap to identify activity peaks (hour/minute granularity).
- **HTTP Status Trends**: `StatusTrendsChart` component – stacked area chart with monotone spline interpolation, SVG gradients, time X axis, value Y axis, detailed tooltip (time, values per code, percentage, total).
- **Bandwidth Over Time**: Bandwidth timeline chart cumulated per bucket via `totalBytes` in timeseries.
- **Bot vs Human Traffic**: `DonutChart` component + backend bot/human detection (`computeBotVsHuman`), displayed first in the HTTP tab.
- **Top 404 URLs**: Backend `computeTop404Urls` function + DualBarChart panel in the HTTP tab.
- **Response Time Distribution**: `ResponseTimeChart` component (avg, p50, p95, p99, max, buckets) + `computeResponseTimeDistribution` on backend.

#### Log Stats – Organization by tabs
- **Charts / HTTP / Top & Rankings tabs**: Tab navigation (TrendingUp, Shield, Trophy icons) to group content by category.
- **Floating navigation menu**: Updated dynamically based on active tab.

#### Log Stats – Source indicator
- **Source badge per section**: Each chart, table and TopPanel displays a colored badge indicating the data source (Apache = red, NPM = green, All = blue).
- **`SourceBadge` and `SectionHeading` components**: Reusable components to standardize source badge display across all sections.

#### Backend – Analytics enrichment
- **`statusGroups` per bucket**: `computeTimeseries` aggregates HTTP codes (s2xx, s3xx, s4xx, s5xx) per time slot.
- **`totalBytes` per bucket**: Cumulated bandwidth per bucket in timeseries.
- **`computeTop404Urls`**: Aggregation of URLs returning a 404 code.
- **`computeBotVsHuman`**: User-agent classification (bot/human) with percentage and top bots.
- **`computeResponseTimeDistribution`**: Calculation of avg, percentiles (p50, p95, p99), max and distribution buckets of response times.
- **Types**: New types `AnalyticsStatusGroups`, `AnalyticsBotVsHuman`, `AnalyticsResponseTimeBucket`, `AnalyticsResponseTimeDistribution`.

### Changed

#### Log Stats – Unified KPIs
- **Single KPI block**: Merged two KPI sections into a single block with source badge, colored date range (blue/amber), and hide/show button integrated in the header.
- **KPI tooltip**: The "Stats KPI" title shows an explanation of what KPIs are on hover (text from `kpiModalIntro`).
- **Removed "Understanding the numbers" modal** and the expandable help section (state, localStorage, API).

#### Log Stats – Section grouping
- **HTTP Codes + Methods**: The 3 old HTTP sections consolidated into 2 panels (HTTP Codes with table + distribution, Methods + Codes by domain).
- **Day of Week + Hour/Day Heatmap**: Grouped in the same frame (2-column grid).
- **Colored dates**: The dates in the range (KPI bar) are sky blue (start) and amber (end).

#### Log Stats – Improved HTTP Status Trends
- **Modern colors**: 2xx emerald green, 3xx bright blue, 4xx amber, 5xx bright red with vertical gradients.
- **Spline curves**: Monotone cubic interpolation instead of straight lines.
- **Time and value axes**: X axis with formatted labels (6 ticks), Y axis with scale (K/M), horizontal and vertical grid.
- **Enriched tooltip**: Time in blue, total, value per code + percentage, white dot and dashed line on hover.

#### Translations (i18n)
- Added all keys for new charts, tabs, days of the week, bot/human metrics, response times, navigation, and source.

---

## [0.3.3] - 2026-02-13

### Added

#### Dashboard – Global search
- **Active plugin filters**: Filter buttons only show plugins enabled in the application.
- **Results by category**: Grouped display by plugin (Host System, Apache, NPM, Nginx).
- **Declared host-system paths**: Uses configured files (systemBaseFiles, autoDetectedFiles, customFiles) in addition to scanning, aligned with the Log Viewer.
- **Count per file**: Colored badge (green/orange/red) for the number of occurrences per file; a single example line per file.
- **`.gz` files option**: "Include .gz files" checkbox (unchecked by default) to exclude or include compressed files in the search.
- **API**: `includeCompressed` parameter for `POST /api/log-viewer/search-all`; enriched response (`filesWithMatches`, `matchCountPerFile`, `matchesByPlugin`).

### Changed

#### Dashboard – Global search
- **Occurrence badges**: Only the number is colored (green ≤3, orange ≤10, red >10), the rest of the badge remains neutral.
- **Explicit plugin search**: When one or more plugins are selected, the search runs even if the plugin is disabled in config.

#### Build
- **Vite chunks**: Removed `vendor-icons` and `vendor-state` chunks to eliminate "Circular chunk" warnings (merged into `vendor`).
- **Dependencies**: `npm audit fix` – fix minimatch and rollup vulnerabilities (0 vulnerabilities).

### Fixed

#### Dashboard – Global search
- **includeCompressed**: Missing variable in the search service options destructuring.

---

## [0.3.2] - 2026-02-13

### Changed

#### Dashboard – Analysis / Error logs card
- **Collapsed by default**: only the header line visible (title + error count); click to expand.
- **Scan results**: folding removed, results always shown when the card is expanded.
- **Unanalyzed files (too large)**: folding kept.

#### Log Viewer – IPv6 in tables
- **IPv6 truncation**: "start…end" display to fit in cells (e.g. `2001:0db8:85…0370:7334`).
- **Tooltip**: Full IP on hover (columns ip, ipaddress, clientip, remoteip, upstream).
- **Utility**: `src/utils/ipUtils.ts` (isIPv6, truncateIPv6ForDisplay).

---

## [0.3.1] - 2026-02-13

### Added

#### Dashboard – Global search
- **Search frame**: New "Search" block at the top of the dashboard to search across all active plugin logs.
- **Plugin filters**: Buttons to limit the search to specific plugins (Host System, Apache, NPM, Nginx) or all.
- **Options**: Case sensitive, regular expression (regex).
- **Results**: Display of matches with plugin, file, line number and excerpt; click to open in the log viewer.
- **API**: `POST /api/log-viewer/search-all` (query, pluginIds, caseSensitive, useRegex, maxResults).
- **Compact UX**: Only the search bar visible by default (no empty frame); search icon on the left; content (filters, results) shown only when relevant.

### Changed

#### Administration – Tab reorganization
- **Regex tab**: moved into the Plugins tab as a separate category (section "Regex").
- **Debug tab**: moved into the Info tab as a separate category (sections App Logs, Log Levels, Diagnostics).
- **New tab order**: General, Plugins, Analysis, Notification, Theme, Security, Exporter, Database, Info.
- **Redirect**: old URLs/links to `adminTab=regex` or `adminTab=debug` automatically redirect to Plugins or Info.

#### Dashboard – Unanalyzed files (too large)
- **Enriched display**: Plugin (Host System, Apache, NPM, Nginx), size, full path; grouping by distinct plugin category.
- **Analyze button**: Success/error notification; "Analyzing…" indication during execution; explanatory tooltip; automatic expansion of results; file removed from the list once analyzed.

---

## [0.3.0] - 2026-02-13

### Security

- **Dependencies (npm overrides)**: Fix vulnerabilities reported by Dependabot and `npm audit`.
  - **minimatch**: override `>=10.2.1` to fix ReDoS (CVE, patterns with repeated wildcards). Transitive dependency via bcrypt → node-pre-gyp → rimraf → glob → minimatch.
  - **tar**: override `>=7.5.9` to fix arbitrary file read/write via hardlink (CVE). Transitive dependency via bcrypt → node-pre-gyp → tar.
  - After `npm install`, `npm audit` shows 0 vulnerabilities.

---

## [0.2.8] - 2026-02-13

### Added

#### Analysis / Error logs – System log integration (host-system)
- **Include host-system in scan**: host-system plugin files (syslog, auth.log, kern.log, daemon.log, mail.log, etc.) are scanned when the plugin is checked in Settings > Analysis. See [Doc_Dev/AUDIT_ERROR_SUMMARY_HOST_SYSTEM.md](Doc_Dev/AUDIT_ERROR_SUMMARY_HOST_SYSTEM.md).
- **Error/warn search for system logs**: Detection extended to syslog/journald formats (whole words `error`, `err`, `warn`, `warning`) in addition to `[error]`/`[warn]` tags (Apache/Nginx/NPM).

#### Analysis / Error logs – Access files and HTTP codes
- **Access files included**: For Apache, Nginx and NPM, access files (in addition to error files) are scanned; 3xx, 4xx, 5xx HTTP code counts.
- **4xx/5xx and error/warn badges**: Per plugin column (Apache/Nginx/NPM: 4xx, 5xx; NPM/Nginx/Host: error, warn). On clicking a file, details "Breakdown for this file" (4xx, 5xx, 3xx, error, warn).

#### Analysis / Error logs – UX and rescan
- **Results per plugin in columns**: Grid display (host-system, apache, npm, nginx) with collapsible "Scan results" section (collapsed by default).
- **Plugin order**: System, Apache, NPM, Nginx (results and Settings > Analysis options).
- **Explicit rescan**: `POST /api/log-viewer/error-summary/invalidate`; the card's Refresh button invalidates the cache and restarts a scan. Message after saving Analysis inviting to refresh the card.

#### Settings > Analysis
- **Explanatory text**: "Current search" (error + access files, [error]/[warn] and 3xx/4xx/5xx); description under "Security check". Two-column layout (Error summary | Security check).
- **Plugins to include**: Plugin icons (host-system, apache, npm, nginx) next to toggles. Note on Apache/Nginx (plugin enabled + path containing error logs).

#### Administration
- **User management**: Frame moved from General tab to Security tab (displayed first, admin only).
- **Security**: "Blocked IPs and accounts" and "CORS configuration" sections displayed in two columns (grid `lg:grid-cols-2`).

#### Documentation
- **Audits**: [Doc_Dev/AUDIT_ERROR_SUMMARY_HOST_SYSTEM.md](Doc_Dev/AUDIT_ERROR_SUMMARY_HOST_SYSTEM.md), [Doc_Dev/AUDIT_ADMIN_OPTIONS.md](Doc_Dev/AUDIT_ADMIN_OPTIONS.md). README: Analysis / Error logs section, host-system audit link; Documentation > Audits and design.

### Changed

#### Analysis / Error logs
- **Backend**: Per-file counts with detail `count4xx`, `count5xx`, `count3xx`, `countErrorTag`, `countWarnTag`; `countLevelFromRawLineBreakdown()` for tags and HTTP codes.

---

## [0.2.7] - 2026-02-13

### Fixed

#### Log Viewer – Large files
- **Stack overflow on large files**: with logs of 45 MB or more, the date range calculation (`logDateRange`) caused "Maximum call stack size exceeded" due to `Math.min(...timestamps)`. Replaced by a `for` loop to avoid stack overflow.

### Added

#### Log Viewer – Default file on first use
- **Automatic selection**: for NPM, Nginx and Apache, a default access log file is selected when the user opens the viewer for the first time (without a last file or custom setting).
- **Priority by plugin**: NPM → `default-host_access.log` or first `proxy-host-*_access.log`; Nginx/Apache → `access.log`.

#### File selector – "Hide empty" option
- **"Hide empty" toggle**: replaces the "Hide empty files" checkbox with a modern toggle (Log Stats style).
- **Default value**: enabled by default (hides .gz files and 0-byte files).
- **Persistence**: user preference saved in `localStorage` (`logviewr_hide_empty_files`).

### Changed

#### Log Viewer – UX
- **Shortened label**: "Sans vides" (FR) / "Hide empty" (EN) instead of "Masquer fichiers vides".

---

## [0.2.6] - 2026-02-13

### Added

#### Log Stats – Stats KPI and explanatory modal
- **"What is a KPI?" modal**: Info button next to the Stats KPI title opens an explanatory modal (definition, HTTP log context, use cases). Closed by clicking outside, Escape key or Close button.
- **Translations**: `kpiModalTitle`, `kpiModalIntro`, `kpiModalLogs`, `kpiModalUse`, `kpiModalClose` (fr/en).

### Changed

#### Log Stats – Display and UX
- **Improved Stats KPI**: each indicator in a card with border, icons (Activity, Globe, AlertTriangle, FileText, HardDrive), 2/3/5-column grid based on screen, values in `text-lg`.
- **Requests over time**: default display in **curve** mode instead of bars (TimelineChart).

---

## [0.2.5] - 2026-02-13

### Added

#### Log Stats – Tooltips and panels
- **Portal tooltips**: all tooltips (Top URLs, Top Referrers, Top IPs, Top HTTP codes, Top Browsers, Top User-Agents, Referrer URLs, HTTP Status Codes, Requested Files) are rendered via `createPortal` in `document.body` to avoid any masking by overflow or z-index.
- **Always-visible tooltips**: z-index 99999, fixed position, opaque background (`rgb(17, 24, 39)`) to avoid transparency imposed by the theme (`themes.css` replaces `bg-gray-900` with `var(--bg-tertiary)`).
- **View toggle button**: Maximize2/Minimize2 icon in each Top panel to display 5 results or the full list.
- **Translations**: `showAllItems` (Show all), `showLimitedItems` (Limited view (5)).

### Changed

#### Log Stats – Layout and display
- **HTTP Status / Methods distribution**: thinner bars (`h-3`), count and percentage on a single line (`whitespace-nowrap`), bar alignment with fixed count column (`min-w-[5.5rem] text-right`), adapted label (4rem for codes, 7rem for methods).
- **Top panels**: Top URLs and Top Referrers on the first row (2 columns); Top IPs, Top Status, Top Browsers on the second row; Top User-Agents on a dedicated row (same width as Top Referrers).
- **Default TopPanel**: display of 5 results without scroll; click the icon to show all.
- **Extracted TopPanel**: component moved to module level to avoid resetting `showAll` state on each parent render.
- **Enriched tooltips**: content (Hits, Total %), separator, improved padding and borders.

---

## [0.2.4] - 2026-02-13

### Added

#### Log Stats (GoAccess style)
- **Full-screen page**: Graphical log statistics (KPI, Stats KPI, timeline, Time Distribution, Unique Visitors, HTTP Status Codes, Referring Sites, Virtual Hosts, Referrer URLs, Requested Files, top panels), inspired by [GoAccess for Nginx Proxy Manager](https://github.com/xavier-hernandez/goaccess-for-nginxproxymanager).
- **Footer button**: Access to Log Stats page next to Analytics.
- **Analytics API**: Endpoint `GET /api/log-viewer/analytics` with `pluginId`, `from`, `to`, `bucket`, `topLimit`, `fileScope`, `includeCompressed`.
- **Plugin filter**: All (NPM + Apache), NPM or Apache.
- **Time range**: 1h, 24h, 7d, 30d + custom (datetime-local).
- **File scope**: Last file only or all files (access.log, .1, .2, etc.).
- **.gz option**: Include compressed files (if enabled in Settings > Plugins).
- **Requests over time**: Toggle Bars / Curve + X axis with spaced date/time labels.
- **Readable X axes**: Time markers (6 graduations) and vertical grid on Time Distribution and Unique Visitors.
- **Dual curves**: Time Distribution and Unique Visitors (DualLineChart).
- **Table panels**: HTTP Status Codes, Referring Sites, Virtual Hosts, Referrer URLs (left label, right bars).
- **HTTP codes by domain**: Detailed host + status panel.
- **Extended Stats KPI**: valid requests, failed requests, not found, static files.
- **Info and tooltips**: "Understanding the numbers" section + tooltips on badges.
- **Documentation**: `Doc_Dev/LOG_ANALYTICS_GRAPHS_GOACCESS.md`.

---

## [0.2.3] - 2026-02-10

### Fixed

#### Header – Log selector icon flickering
- **Hover flicker**: buttons (Files, History, Regex, Play, Stop, Refresh, Parsed/Raw mode) were wrapped in a `Tooltip` component (inline-flex span), causing hover enter/exit events and flickering. Replaced with native `title` attribute on buttons. Removed `fadeInDown` animation from plugin dropdown and `transition-transform` from chevron.

#### Changelog in Docker version
- **Changelog unavailable in Admin > Info**: `CHANGELOG.md` was not copied into the final Docker image. Added a `COPY` in the Dockerfile to include `CHANGELOG.md` at the container root (`/app/CHANGELOG.md`), so the `GET /api/info/changelog` route returns content in Docker.

#### Raw logs view – Frame height
- **Frame too small**: the scrollable raw logs area had a fixed height `max-h-[600px]`. Replaced with `min-h-[400px] h-[calc(100vh-15rem)]` to adapt height to viewport while keeping the "Lines per page" choice and pagination.

### Changed

#### Admin > Info – "About" text
- **Tagline and description (EN/FR)**: wording updated to clarify that LogviewR **reads local log files** (machine or container) and that **no outbound connection** to servers is required, which is preferable for security. The `tagline` and `aboutDescription` keys were modified in `en.json` and `fr.json`.

#### Apache – Custom regexes and option display
- **Custom regex used for parsing**: when a custom regex is saved for an Apache file (access), the backend was using `CustomLogParser` without column mapping. Now, for the Apache plugin and the access type, the custom regex is passed to `ApacheParser.parseAccessLineWithCustomRegex()`: columns (ip, vhost, method, url, status, size, referer, userAgent) are correctly populated.
- **Default access regex**: the default regex for Apache access (editor and default-regex API) is now `APACHE_ACCESS_VHOST_COMBINED_REGEX` (vhost_combined format with `%t` first).
- **Regex options: 3 generic entries + Custom**: in "Files detected with regex" (Settings > Plugins > Apache), display of only **access.log**, **error.log** and **access_*.log** (generic editing). Files whose regex was edited via the viewer header appear as **Custom**; a Custom entry replaces the corresponding generic entry (no duplicate). **Reset** button shown for any Custom entry or when the regex differs from the default.
- **access.\*.log recognition**: files of type `access.home32.myoueb.fr.log` or `access.ip.myoueb.fr.log` are now assigned to the **access_*.log** slot for applying the vhost_combined regex (fix for VIRTUAL HOST / STATUS / METHOD / URL display).

#### NPM – Regex option grouping
- **Regex options: 10 generic entries + Custom**: in "Files detected with regex" for NPM, display of **proxy-host-*_access.log**, **proxy-host-*_error.log**, **dead-host-*_access/error**, **default-host_access/error**, **fallback_access/error**, **letsencrypt-requests_access/error**. A regex saved for an entry applies to all matching files. Same Custom logic as Apache (replace generic, no duplicate). Regex resolution by key via `getNpmRegexKeyForPath()`.

#### Nginx – Regex option grouping
- **Regex options: 2 generic entries + Custom**: for Nginx, display of **access.log** and **error.log** only; one regex per type applies to all access/error files. Resolution via `getNginxRegexKeyForPath()`.

#### i18n
- **Regex option hints**: added `apacheRegexHint`, `npmRegexHint` and `nginxRegexHint` in locales (fr/en), displayed above the list in the "Files detected with regex" section for Apache, NPM and Nginx.

---

## [0.2.2] - 2026-02-10

### Changed

#### Script update-version.sh
- **Integration of `commit-message.txt` in `--tag-push`**: the `--tag-push` mode now uses `git commit -F commit-message.txt` instead of the generic message `"release: v$NEW"`. If the file is absent or does not mention the version, automatic fallback with warning.
- **Addition of `server/routes/system.ts`** (step 5): the `appVersion` fallback in `system.ts` is now automatically updated by the script (it was previously forgotten).
- **Intelligent detection of commit-message.txt**: after the bump, the script checks if `commit-message.txt` exists and mentions the correct version (green check / yellow warning / template generation).
- **Improved output**: numbered commands 1-2-3 at the end of the script, option "re-run with --tag-push", all-in-one with `git commit -F commit-message.txt`.
- **Flexible argument parsing**: the order of `--tag-push` / version no longer matters.

---

## [0.2.1] - 2026-02-10

### Fixed

#### NPM Plugin – error.log file parsing
- **`proxy-host-*_error.log` files not shown in table**: the `determineLogType()` method in `NpmLogPlugin.ts` checked `proxy-host` before `error` in the filename. A `proxy-host-12_error.log` file was classified as `access` instead of `error`, the access parser failed on Nginx error lines, and all lines remained unparsed. The check order is now reversed: `error` is tested first.
- **NPM error parser without PID/TID support**: `NpmParser.parseErrorLine()` had only one basic regex that didn't handle the `497#497:` (PID/TID) format ubiquitous in Nginx error logs. Added the PID/TID format as in `NginxParser`, with extraction of `pid` and `tid`.
- **Missing `pid`/`tid` columns for NPM error logs**: `getColumns('error')` returned `['timestamp', 'level', 'message']`. Aligned with Nginx with `['timestamp', 'level', 'pid', 'tid', 'message']`.

#### LogTable – Timestamp badge overflow
- **Timestamp badge overflowing the column**: timestamp width was 146px (access) and 158px (error), insufficient for the mono fr-FR badge "08/02/2026 13:30:06" (~149px badge + 32px cell padding = 181px minimum). Width unified to 185px for all plugins and logTypes.

### Changed

#### LogTable – Column unification
- **Centralized column widths**: replacement of ~110 lines of duplicated `if/else` (error vs non-error branch) in `colgroup` by a single `COLUMN_WIDTHS` object (single source of truth for 30+ columns). Any common column now has the same width regardless of plugin or logType.
- **Unified cell padding**: removed special `px-5` padding for error logs. All cells and headers use `px-4 py-3` uniformly.
- **Completed `getColumnType`**: added `port` in numeric columns, `action` in badge columns.
- **Completed `getColumnDisplayName`**: added missing display names (`tid` → TID, `protocol` → Protocol) and defensive aliases (`severity`, `statuscode`, `httpcode`, `urlpath`, `user-agent`).
- **`COLUMN_WIDTHS` with defensive aliases**: added column name variants (`severity`, `statuscode`, `httpcode`, `urlpath`, `user-agent`) to ensure correct widths even with custom parsers.

---

## [0.2.0] - 2026-02-08

### Added

#### Internationalization (i18n)
- **Complete administration translation**: namespaces and keys for all tabs (Exporter, Database, Analysis, Notifications, Debug, Info). All texts use `t()` with `fr.json` / `en.json`.
- **Analytics page**: `analytics` namespace (titles, plugin sections, largest files, database, user info, roles). `AnalyticsPage` component fully translated.
- **Log View (LogTable)**: `logViewer` namespace for pagination (lines per page, page X of Y), stats (total/valid/filtered/unreadable lines), cell tooltips (HTTP codes, size, GZIP, upstream, response time, level, HTTP method). Applies to Apache, Nginx, NPM and System.
- **Footer**: `footer` namespace for Analytics and Administration button tooltips, and detailed tooltips for stats badges (readable files, total size, .gz size).

#### Footer – UX
- **Button tooltips**: hover tooltips for Analytics button ("Statistics and detailed info") and Administration button ("Settings and administration"). Detailed tooltips for stats badges (files, size, .gz).
- **Icon-only buttons**: Analytics and Administration buttons displayed as icon only (no text) for a more compact footer.
- **Click effect**: visual feedback on click for navigation buttons (Analytics, Administration, plugins) via `active:brightness-90`, without shifting other buttons.

#### Tooltip component
- **Reliable display**: tooltip rendered in a portal (`createPortal` to `document.body`) to avoid any masking by the footer (overflow, z-index). Z-index raised to 10000.
- **Position**: position calculated in `useLayoutEffect` before display to avoid a flash at (0,0). Constraints to stay within viewport.
- **`wrap` option**: long tooltips (stats badges) with line wrapping and `max-w-sm`.

### Changed

#### License
- **Project license**: display in the Info tab changed from "Private" to "Public, MIT" (fr.json / en.json, key `info.licenseValue`).

#### Versions
- **Server version fallback**: default value in `server/index.ts` and `server/routes/system.ts` aligned on `0.2.0` when `package.json` is not readable.

---

## [0.1.16] - 2026-02-08

### Fixed

#### Dashboard / Footer – Plugin stats in Docker
- **Stats at 0 in Docker**: the `GET /plugins/:pluginId/stats` routes and the "all plugins" aggregation were using `getDefaultBasePath()` instead of the saved path in database. They now use `getEffectiveBasePath()`: statistics (Total, Readable, Size) in the dashboard and footer reflect the configured path (e.g. `/home/docker/nginx_proxy/data/logs` for NPM).

#### Theme – Live animation settings
- **Sliders without effect**: by passing a second instance of the settings (`animationParametersForBackground`) to the background, sliders (speed, colors, etc.) were only updating the context, not the displayed animation. When a single animation is selected, the background now receives the same parameters as the Settings panel (`backgroundParams` = context parameters), so settings apply in real time.
- **Speed and animation out of sync (same tab)**: `StorageEvent` does not fire in the tab that modifies `localStorage`. Custom events added (`logviewr_animation_speed_sync`, `logviewr_full_animation_id_sync`) so that all instances of the `useBackgroundAnimation` hook (App + Settings) receive speed and animation selection changes in real time.

### Added

#### Theme – Animations
- **"Reset" button**: next to the "Animation settings" title, a button resets all current animation parameters to their default (ideal) values.
- **Stars animation**: **Star color (palette)** parameter (`starColor`, color type, default `#6eb5ff`); if set, gradient and background use this color (with `hexToDarkHsl` helper for dark tones).
- **Sidelined animation**: **Line color (palette)** parameter (`lineColor`, color type, default `#a78bfa`); if set, strokes and glow use this color.

### Changed

#### Theme – Particle waves
- **Max speed and responsiveness**: Speed parameter extended (max 8 → 15, default 0.5 → 0.8); time divisor 5000 ms → 1500 ms; wave phase amplified (`phaseSpeed = waveSpeed * 2.5`) for a visible effect at max speed. The Speed slider (and global multiplier) has a clear impact on the animation.

---

## [0.1.15] - 2026-02-08

### Fixed

#### Docker – NPM plugin and custom path
- **Empty file list in Docker**: when the Log Viewer page calls the API without sending the `basePath` parameter (`files-direct` route), the backend was always using the plugin's default path (`/var/log/npm`) instead of the saved path in database (e.g. `/home/docker/nginx_proxy/data/logs`). A `getEffectiveBasePath()` function has been added: priority 1) request value, 2) saved path in database (plugin config), 3) plugin default. The `files`, `files-direct`, `scan` and `detected-files` routes now use this effective path. The path configured in Settings → NPM plugin is thus respected in Docker without having to declare an additional volume.

### Changed

#### Theme – Background animation
- **"Speed" slider (All cycle)**: display of value with multiplier unit (×), range 0.3× to 3.0×; explanatory label and tooltip (slow/fast); use of `speedToMultiplier` from `useBackgroundAnimation`.

#### Docker
- **docker-compose.yml**: comment added clarifying that the custom NPM path (e.g. `/home/docker/nginx_proxy/data/logs`) does not need to be declared as a volume: the `/: /host:ro` mount already exposes the entire host, the app resolves the path automatically.

---

## [0.1.10] - 2026-02-08

### Fixed

#### Docker – Plugin paths
- **Absolute host paths in options**: in Docker, any absolute path entered in a plugin's options (e.g. `/home/docker/nginx_proxy/data/logs`) is now prefixed by `HOST_ROOT_PATH` (`/host` by default). The container thus accesses the correct directory (e.g. `/host/home/docker/nginx_proxy/data/logs`), notably when `/var/log/npm` on the host is a symlink to another directory.
- **NPM plugin**: use of `resolveDockerPathSync` (testing both variants `/host/logs/npm` and `/host/var/log/npm`) and diagnostic logs on `testConnection` or `scanLogFiles` failure (tested path + `docker exec` command to verify).

### Changed

#### Apache and NPM plugins
- **Apache / NPM alignment**: Apache now uses `resolveDockerPathSync` and the same diagnostic messages as NPM on connection or scan failure. Both plugins share the same path resolution logic and regex for files (rotation `.log.1`, compression `.gz`/`.bz2`/`.xz`).
- **BasePlugin**: `resolveDockerPathSync` extended to handle any absolute host path (not just `/var/log`) by prefixing it with `/host` when the app runs in Docker.

---

## [0.1.9] - 2026-02-08

### Added

#### Docker
- **HOST_IP indication at startup**: in Docker, if `HOST_IP` is not defined, a message in the logs reminds to define `HOST_IP` in the `.env` (e.g. `HOST_IP=192.168.32.150`) to display the host machine's IP in the banner instead of the Docker gateway

### Fixed

#### NPM Plugin (Docker)
- **NPM files visible in Docker**: the NPM plugin now applies `convertToDockerPath()` on the `basePath` (like Apache and Nginx), so that `/var/log/npm` is converted to `/host/logs/npm` or `/host/var/log/npm` and NPM log files display correctly

### Changed

#### Docker
- **docker-compose.yml**: reinforced comments for `HOST_IP` (recommendation and example 192.168.32.150)

---

## [0.1.8] - 2026-02-08

### Added

#### Log Viewer – Live mode and Auto-refresh
- **Play button in header**: once a file is selected, display a Play button opening a menu
  - **Live (real-time)**: existing WebSocket follow (tail -f)
  - **Auto-refresh**: periodic HTTP reload with chosen interval (2s, 5s, 10s, 15s, 30s)
- **Square button (Stop)**: stops Live mode or Auto-refresh
- **Persistence**: the chosen interval for Auto-refresh is saved in `localStorage` (`logviewer_auto_refresh_interval_ms`)
- Constants `AUTO_REFRESH_INTERVALS_MS`, `AUTO_REFRESH_DEFAULT_MS` and `AUTO_REFRESH_STORAGE_KEY` in `src/utils/constants.ts`
- Compatible with parsed mode and raw mode: auto-refresh uses the same logic as the Refresh button

### Changed

#### Dependency security
- **npm overrides**: `tar` >= 7.5.7 and `esbuild` >= 0.25.0 to fix vulnerabilities (Dependabot) without upgrading to bcrypt 6 or vitest 4

---

## [0.1.7] - 2026-02-08

### Added

#### Footer
- **`.gz` size badge**: New badge displaying the total size of compressed log files (.gz)
  - Displayed only if at least one plugin has .gz files (and "Read .gz" option enabled)
  - Green style (emerald), Archive icon, explanatory tooltip
  - Calculation via double stats call (quick=true for non-.gz, without quick for total) then difference

#### Scripts
- **update-version.sh**: Version update script adapted for the LogviewR project
  - Updates `package.json`, `src/constants/version.ts` and `README.md` (badge, release link, text)
  - Reads current version from `package.json`; suggests patch version if no argument
  - Reminder to add an entry in `CHANGELOG.md` and suggested git commands
  - Portable macOS/Linux (sed in-place), ANSI colors if TTY

### Changed

#### Header / Clock
- **Clock LED indicator**: Color and animation aligned with theme
  - Fixed yellow color replaced by `var(--accent-primary)` (follows theme)
  - New `clockLedGlow` animation (2s breathing): opacity and halo (box-shadow) in loop
  - Animation defined in `src/index.css`, applied on the Clock component dot

#### Footer
- **Stats badge labels**: "size" badge tooltip clarified: "Total size of uncompressed log files"
  - Stats state extended with `totalSizeGz` for the new .gz badge

---

## [0.1.4] - 2026-01-03

### Fixed

#### Plugin Options Panel
- **Auto-refresh issue**: Fixed automatic refresh that was overwriting user input when editing `basePath` field
  - Added debounce (500ms) for `basePath` field auto-save
  - Added debounce (1s) for detected files reload after `basePath` changes
  - Prevents file list from reloading while user is typing
  - User modifications are no longer overwritten during editing

#### Docker Path Conversion
- **Apache and Nginx plugins**: Fixed Docker path conversion for log files
  - Added `convertToDockerPath()` method in `BasePlugin` for automatic path conversion
  - Converts `/var/log/apache2` to `/host/logs/apache2` (or `/host/var/log/apache2` as fallback)
  - Converts `/var/log/nginx` to `/host/logs/nginx` (or `/host/var/log/nginx` as fallback)
  - Handles all paths starting with `/var/log` automatically
  - Works correctly even when `/host/logs` symlink doesn't exist

#### Host System Plugin
- **Docker path fallback**: Improved fallback mechanism for log base path
  - Uses `/host/var/log` directly when `/host/logs` symlink doesn't exist
  - Prevents "Connection failed" errors when symlink creation fails
  - Better compatibility with read-only filesystems

#### HTML Validation
- **Nested buttons**: Fixed React hydration error caused by nested `<button>` elements
  - Replaced parent buttons with `<div>` elements using `role="button"` and `tabIndex={0}`
  - Added keyboard navigation support (Enter and Space keys)
  - Applied to "Fichiers de logs système" and "Fichiers détectés avec regex" sections
  - Maintains full functionality and accessibility

#### TypeScript Errors
- **Type conversions**: Fixed TypeScript errors for `HostSystemPluginConfig` type conversions
  - Added `as unknown as` intermediate conversion for safe type casting
  - Fixed type mapping for 'user' and 'cron' log types in auto-detected files
  - Improved type safety in plugin configuration handling

### Added

#### Log File Permissions
- **Docker permissions**: Added automatic configuration for reading system log files
  - Container automatically adds `node` user to `adm` group (GID 4)
  - Allows reading files owned by `root:adm` with permissions `640`
  - Configurable via `ADM_GID` environment variable for custom GID
  - Supports reading auth.log, cron.log, daemon.log, syslog, and other system logs

#### Documentation
- **README updates**: Added comprehensive documentation for log file permissions
  - Section explaining Docker permissions configuration
  - Instructions for handling files with restrictive permissions (600)
  - Examples for fixing permissions on php8.0-fpm.log and rkhunter.log.1
  - Security notes about adm group usage

### Changed

#### Docker Configuration
- **docker-compose.yml**: Added `group_add` configuration for adm group
  - Automatically adds container to adm group for log file access
  - Configurable via `ADM_GID` environment variable (default: 4)

#### docker-entrypoint.sh
- **Group management**: Enhanced entrypoint script to add node user to adm group
  - Creates adm group with standard GID 4 if it doesn't exist
  - Adds node user to adm group for log file access
  - Works seamlessly with Docker volume mounts

---

## [0.1.3] - 2026-01-03

---

## [0.1.2] - 2025-01-28

### Changed

#### UI/UX Improvements
- **Header file selector**: Removed file count badge from "Fichiers de logs" button - count now only displayed on plugin icon badge
  - Cleaner header interface
  - File count remains visible on plugin icon for quick reference
- **Log table statistics**: Improved statistics badges display
  - Added file size badge (displayed first, before other badges)
  - Removed "Statistiques :" label text - only badges are now displayed
  - File size badge uses purple color scheme to differentiate from other badges
  - File size formatted automatically (B, KB, MB, GB)
- **Filter badges layout**: Enhanced filter badges display for better readability
  - Filter titles and badges now displayed on a single line with separator "|"
  - Applied to "Niveau", "Code HTTP", and "Méthode HTTP" filters
  - More compact and consistent layout
  - Better use of horizontal space

### Technical Details

- **Frontend**:
  - Updated `Header.tsx` to remove file count from file selector button
  - Updated `LogTable.tsx` to add file size badge and remove statistics label
  - Updated `LogFilters.tsx` to display filter titles and badges on single line
  - Added `fileSize` prop to `LogTable` component
  - Updated `LogViewerPage.tsx` to pass file size from `availableFiles` to `LogTable`

## [0.1.1] - 2025-01-28

### Added

#### Log Viewer Improvements
- **Automatic log loading**: Logs are now automatically loaded when a file is selected, eliminating the need to click "Refresh"
  - Automatic loading triggered when `selectedFilePath` or `selectedLogType` changes
  - Seamless user experience with immediate log display
- **Custom regex editor**: New modal for editing custom regex patterns for log files
  - `RegexEditorModal` component with full regex editing capabilities
  - Display of default regex pattern (if available) for the selected log type
  - Real-time regex testing with sample log lines
  - Visual feedback showing capture groups and matches
  - Validation of regex syntax before saving
- **Regex editor button in header**: Quick access to regex editor from the log viewer header
  - Button with `Code` icon next to the file selector
  - Only visible when a log file is selected
  - Opens the regex editor modal for the current file
- **Backend API for custom regex**: New API endpoints for managing custom regex patterns
  - `GET /api/log-viewer/plugins/:pluginId/default-regex` - Get default regex for a log type
  - `GET /api/log-viewer/plugins/:pluginId/regex-config` - Get custom regex for a file
  - `PUT /api/log-viewer/plugins/:pluginId/regex-config` - Save custom regex for a file
  - Custom regexes stored in plugin configuration via `PluginConfigRepository`
- **Custom regex display in plugin settings**: List of custom regexes in plugin configuration modal
  - New "Regex personnalisées" section in `PluginConfigModal`
  - Displays all custom regexes with file path, log type, modification date, and full regex pattern
  - Available for all log source plugins (host-system, nginx, apache, npm)
  - Helpful message explaining how to configure regexes from the log viewer

### Changed

- **Log file selection behavior**: File selection now automatically triggers log loading
  - Removed manual "Refresh" requirement after file selection
  - Improved user experience with immediate feedback
- **Header component**: Enhanced with regex editor button
  - Added `Code` icon button for regex editing
  - Integrated `RegexEditorModal` component
  - Conditional rendering based on file selection

### Technical Details

- **Frontend**:
  - New `RegexEditorModal.tsx` component with regex editing and testing
  - Updated `Header.tsx` with regex editor button and modal integration
  - Updated `LogViewerPage.tsx` with automatic log loading on file selection
  - Updated `PluginConfigModal.tsx` with custom regex display section
- **Backend**:
  - New routes in `log-viewer.ts` for regex management
  - Integration with `PluginConfigRepository` for persistent storage
  - Default regex patterns for common log types (NPM, Nginx, Apache, Host System)

## [0.1.0] - 2024-01-15

### Added

#### User Management
- **Automatic default admin user creation**: On first application startup, a default admin user is automatically created
  - Default username: `admin`
  - Default password: `admin123`
  - Default email: `admin@localhost`
  - Default role: `admin`
  - Credentials can be customized via environment variables:
    - `DEFAULT_ADMIN_USERNAME`
    - `DEFAULT_ADMIN_PASSWORD`
    - `DEFAULT_ADMIN_EMAIL`
- **JWT-based authentication system**: Secure user authentication using JSON Web Tokens
  - Token stored in browser localStorage
  - Automatic token validation on application startup
  - Automatic reconnection if valid token exists
  - Configurable token expiration (default: 7 days)
- **User login modal**: Automatic display of login modal when user is not authenticated
- **Password security**: Passwords are hashed using bcrypt (10 rounds)
- **Brute force protection**: Account lockout after multiple failed login attempts
- **User roles**: Support for three roles (`admin`, `user`, `viewer`)
- **User management**: Full CRUD operations for user accounts
  - User registration
  - User login/logout
  - User profile management
  - Password change functionality
  - User enable/disable
  - Role management

#### Log Source Plugin System
- **Plugin architecture**: New plugin system for log sources
  - `LogSourcePlugin` interface for implementing log source plugins
  - Support for multiple log source types (Apache, Nginx, NPM, Host System)
  - Plugin registration and management system
- **Host System Log Plugin**: Default plugin for reading system logs
  - Automatic detection of Docker environment
  - Reads logs from `/host/logs` in Docker or `/var/log` locally
  - Support for multiple log types:
    - Syslog
    - Auth logs
    - Kernel logs
    - Daemon logs
    - Mail logs
    - Custom logs
- **Log file scanning**: Automatic detection and scanning of log files
  - Pattern-based file matching
  - Support for rotated log files
  - Compressed file support (gzip)
- **Log parsing**: Specialized parsers for different log formats
  - Syslog parser
  - Nginx access/error log parser
  - Apache access/error log parser
  - NPM log parser
  - Auth log parser
  - Kernel log parser
  - Daemon log parser
  - Mail log parser
  - Custom log parser
- **Log reading service**: Efficient log file reading with streaming support
  - Configurable line limits
  - Support for reading from specific line numbers
  - Handling of large log files
- **Log parser service**: Coordinates log reading and parsing using registered plugins
  - Dynamic column detection based on log type
  - Parsed log entry structure
- **WebSocket streaming**: Real-time log streaming via WebSocket
  - `/ws/log-viewer` WebSocket endpoint
  - Real-time log updates
  - Automatic reconnection on disconnect
  - Follow mode for live log monitoring
- **REST API routes**: Complete API for log viewer functionality
  - `GET /api/log-viewer/plugins/:pluginId/files` - List available log files
  - `POST /api/log-viewer/plugins/:pluginId/scan` - Scan for log files
  - `GET /api/log-viewer/files/:fileId/logs` - Read logs from a file
  - `POST /api/log-viewer/plugins/:pluginId/read-direct` - Read logs directly (bypass DB)
  - `GET /api/log-viewer/plugins/:pluginId/files-direct` - List files directly (bypass DB)
  - `GET /api/log-viewer/sources` - List log sources
  - `POST /api/log-viewer/sources` - Create log source
  - `GET /api/log-viewer/sources/:id` - Get log source
  - `PUT /api/log-viewer/sources/:id` - Update log source
  - `DELETE /api/log-viewer/sources/:id` - Delete log source
  - `GET /api/log-viewer/files` - List log files
  - `PUT /api/log-viewer/files/:id` - Update log file
  - `DELETE /api/log-viewer/files/:id` - Delete log file
- **Database models**: New database models for log management
  - `LogSource` model for managing log sources
  - `LogFile` model for managing individual log files
  - Database tables with proper indexes

#### Frontend Log Viewer
- **LogViewerPage**: Complete log viewer page component
  - Plugin selection
  - File selection
  - Log display with dynamic columns
  - Real-time log streaming support
- **LogTable component**: Structured table for displaying logs
  - Dynamic columns based on log type
  - Colored badges for log levels, HTTP codes, methods
  - Responsive design with horizontal scrolling on mobile
- **LogBadge component**: Colored badges for log entries
  - Level badges (INFO, WARN, ERROR, DEBUG, etc.)
  - HTTP code badges (2xx, 3xx, 4xx, 5xx)
  - HTTP method badges (GET, POST, DELETE, etc.)
  - Response time badges
- **LogFilters component**: Advanced filtering system
  - Text search with debounce (300ms)
  - Level filtering
  - HTTP code filtering
  - HTTP method filtering
  - Date range filtering
  - IP source filtering
  - Active filter count badge
  - Reset filters button
  - Responsive modal on mobile
- **WebSocket hook**: React hook for WebSocket connection
  - `useLogViewerWebSocket` hook
  - Automatic connection management
  - Automatic reconnection on disconnect
  - Subscribe/unsubscribe to log files
  - Real-time log updates
- **Log viewer store**: Zustand store for log viewer state management
  - Selected plugin and file state
  - Log entries state
  - Filter state
  - WebSocket connection state
  - Loading and error states
- **Dashboard integration**: Button in dashboard to navigate to log viewer
- **TypeScript types**: Complete type definitions for log viewer
  - `LogEntry` interface
  - `LogFilters` interface
  - `LogFileInfo` interface

### Changed

- **Project name**: Changed from "MyNetwork" to "LogviewR"
- **Project version**: Set to `0.1.0`
- **Removed Freebox/UniFi/Scanner**: All Freebox, UniFi, and network scanner code has been removed
  - Freebox API routes removed
  - Freebox services removed
  - UniFi plugin removed
  - Network scanner plugin removed
  - Freebox-specific WebSocket removed
  - Freebox-specific configuration removed

### Removed

- Freebox API integration
- UniFi plugin
- Network scanner plugin
- Freebox WebSocket service
- Latency monitoring system
- All Freebox-specific routes and services

### Security

- JWT-based authentication
- Password hashing with bcrypt
- Brute force protection
- Token expiration management
- Secure token storage

### Technical Details

- **Backend**: Node.js with Express.js
- **Frontend**: React with TypeScript
- **Database**: SQLite with WAL mode
- **WebSocket**: ws library for real-time communication
- **Authentication**: JWT tokens
- **Password hashing**: bcrypt

---

## Future Plans

### Planned Features

- **Additional log source plugins**:
  - Apache log plugin (in progress)
  - Nginx log plugin (in progress)
  - NPM log plugin (in progress)
- **Dashboard page**: Summary dashboard with plugin statistics
- **Export functionality**: Export logs in multiple formats (CSV, JSON, TXT, Excel, PDF)
- **Advanced filtering**: Server-side filtering for better performance
- **Log statistics**: Statistics and analytics for log sources
- **Plugin icon buttons**: Footer integration with plugin icons
- **Clock component**: Real-time clock in header
- **Header improvements**: Adaptive header with file selector

---

[0.3.8]: https://github.com/Erreur32/LogviewR/releases/tag/v0.3.8
[0.3.5]: https://github.com/Erreur32/LogviewR/releases/tag/v0.3.5
[0.3.4]: https://github.com/Erreur32/LogviewR/releases/tag/v0.3.4
[0.3.3]: https://github.com/Erreur32/LogviewR/releases/tag/v0.3.3
[0.3.2]: https://github.com/Erreur32/LogviewR/releases/tag/v0.3.2
[0.3.1]: https://github.com/Erreur32/LogviewR/releases/tag/v0.3.1
[0.3.0]: https://github.com/Erreur32/LogviewR/releases/tag/v0.3.0
[0.2.7]: https://github.com/Erreur32/LogviewR/releases/tag/v0.2.7
[0.2.6]: https://github.com/Erreur32/LogviewR/releases/tag/v0.2.6
[0.2.5]: https://github.com/Erreur32/LogviewR/releases/tag/v0.2.5
[0.2.2]: https://github.com/Erreur32/LogviewR/releases/tag/v0.2.2
[0.2.1]: https://github.com/Erreur32/LogviewR/releases/tag/v0.2.1
[0.2.0]: https://github.com/Erreur32/LogviewR/releases/tag/v0.2.0
[0.1.0]: https://github.com/Erreur32/LogviewR/releases/tag/v0.1.0
