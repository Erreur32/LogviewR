# Changelog

All notable changes to LogviewR will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



---

## [0.7.5] - 2026-03-29

### Added
- **Telegram webhook — bot verification**: new "Vérifier" button calls `POST /api/notifications/telegram/verify` (Telegram `getMe`) and displays the bot username inline; token and Chat ID are now validated client-side before save
- **Discord webhook — URL validation**: URL must match `https://discord.com/api/webhooks/…` format; shown as inline field error
- **Generic webhook — URL validation**: must start with `http://` or `https://`
- **Webhook form — required field markers**: name field marked `*` required across all webhook types
- **Fail2ban Config — Application section**: collapsible frame with green `✓ OK` badge when `dashboard.db` exists and fragmentation ≤ 20%; expanded by default
- **Fail2ban Config — NPM integration badge**: green `✓ NPM SQLite` or `✓ NPM MySQL` badge in the Integrations card header when NPM is configured; auto-opens and shows warning when not configured
- **NPM plugin — SQLite auto-detect**: "Détecter database.sqlite" button in PluginOptionsPanel probes `basePath/../database.sqlite` and neighbouring paths; shows green badge with resolved path on success
- **`POST /api/plugins/npm/detect-db`**: new backend endpoint that resolves `database.sqlite` from a given `basePath` using three candidate paths
- **`POST /api/notifications/telegram/verify`**: new backend endpoint proxying Telegram `getMe` to validate a bot token server-side

### Fixed
- **JailConfigModal — ignoreip**: `addIgnoreip()` now validates IP/CIDR format before adding to whitelist; invalid entries show an error message instead of silently adding bad values
- **TabJails — banIp** (×2 components): ban form validates IP/CIDR format before submit; button disabled and inline error shown for invalid input
- **Fail2banPathConfig — MySQL save**: host, user, and db fields are required; port validated as integer 1–65535 before calling the API; port field border turns red for out-of-range values
- **TabConfig — fmPurgeage**: changed from free-text to `type="number" min=0`; `persistDb()` blocks save if value is not a non-negative integer
- **JailConfigModal — port**: `handleSave()` validates port field accepts only `22`, `http`, `80,443`, or `80:443` formats
- **SettingsPage — publicUrl**: `handleSave()` validates URL starts with `http://` or `https://` before calling the API
- **SettingsPage — username**: added forbidden-characters check (`[\w.\-]` only) on top of existing min-3 length check; input border turns red inline

---

## [0.7.4] - 2026-03-29

### Added
- **NPM — MySQL / MariaDB backend support**: Fail2ban top-domains stats now work when NPM runs with a MySQL/MariaDB database; configure via a new toggle (SQLite file / MySQL) in Fail2ban > Config tab with host, port, user, password, and database fields
- **NPM integration — auto-check badge**: on page load the NPM integration frame automatically runs a connection check if a config is already saved; shows a green badge (domain count + source) or red error without requiring a manual click
- **`getNpmDomainMap()` helper**: internal async helper in `Fail2banPlugin` that abstracts SQLite vs MySQL access for the `/check-npm` and `/tops` routes; MySQL mode uses `mysql2/promise` with a 5-second connect timeout

### Changed
- **NPM config path**: SQLite path (`npmDataPath`) and MySQL credentials stored together under `npmDbType` selector; both saved via `POST /api/plugins/fail2ban/config` in a single settings object

---

## [0.7.3] - 2026-03-29

### Added
- **Plugins — test button per card**: each plugin card in Administration now has a visible `⚡ Test` button that calls the connection test and fires a toast notification (green = OK, red = error message)
- **Plugins — activation guard**: enabling a plugin now runs `testConnection()` first; if the test fails, activation is blocked and a red toast explains why — no more silent broken activations
- **Plugins — activation notifications**: every toggle (enable/disable) fires a toast via `notificationStore` with the result
- **Plugins — toggle spinner**: the toggle button shows a spinner while the connection test + activation is in progress
- **PluginOptionsPanel — save/test toasts**: saving or testing a plugin config from the options panel now also triggers a global `notificationStore` toast (in addition to the inline result)
- **Webhook test in edit form**: when editing an existing webhook, a `✉ Envoyer un test` button appears in the form footer; result displayed inline + as a global toast
- **Webhook test button in list**: the small invisible `RefreshCw` icon is replaced by a visible `⚡ Test` button with label
- **Discord/Telegram SVG icons**: logos now appear in webhook type badges and add-buttons (`public/icons/services/telegram.svg`, `src/icons/telegram.svg`)
- **Security > Protection — collapsible sections**: Attack Protection, Blocked IPs, and Active Features are collapsible frames (Active Features collapsed by default)
- **host-system plugin enabled by default**: on first start (no DB config), the host-system log plugin is auto-enabled since system logs are always present

### Changed
- **Fail2ban config split**: SQLite DB path is now only in Administration > Plugins (plugin options), NPM data path is only in Fail2ban > Config tab — no more duplication
- **`Fail2banPathConfig`**: each section (SQLite / NPM) renders only when the corresponding callback is provided — clean separation of concerns

### Fixed
- **`Fail2banPlugin.testConnection()`**: was using `existsSync` (existence only) with OR logic — now tests socket with `R_OK|W_OK` permissions AND SQLite readability; both required; detailed warnings logged
- **`NginxLogPlugin.testConnection()`**: empty catch block replaced with proper error logging (path + error code)
- **`HostSystemLogPlugin.testConnection()`**: journald bypass (was returning `true` unconditionally when journald enabled) now actually checks journal directory accessibility
- **`PluginsManagementSection`**: `!plugin.configured` guard now also fires a notification instead of only showing a temporary status badge

---

## [0.7.2] - 2026-03-29

### Added
- **Settings > Metrics — sub-tabs**: Prometheus, InfluxDB, and MQTT (Home Assistant) each have their own tab; MQTT is first
- **Settings > Metrics — MQTT toggles**: all checkboxes replaced with modern slide toggles (teal theme); each tab has its own save button and unsaved-changes banner
- **Settings > Notifications — sub-tabs**: split into "Notifications internes" and "Webhooks" tabs, each with a framed content area
- **Settings > Notifications — Webhook event triggers**: per-webhook toggle to select which events trigger a dispatch (ban auto, tentative, action manuelle)
- **Settings > Notifications — Webhook batching**: per-webhook batch window (0–60 min) and max-per-batch (1–50) configuration stored in `AppConfig`
- **Webhook dispatch service** (`WebhookDispatchService`): singleton service that actually fires webhooks on ban/action events — Discord (rich embeds), Telegram (HTML), generic HTTP (JSON); supports immediate and cron-batched delivery
- **Automatic ban webhooks**: `fail2banSyncService` dispatches a `ban` event for every new ban detected during non-initial sync
- **Manual action webhooks**: Fail2ban ban/unban API routes dispatch an `action` event with username attribution
- **Settings > Security — sub-tabs**: Protection, Utilisateurs, Réseau, Journaux; Auth settings moved to Utilisateurs; Network + CORS grouped under Réseau
- **Settings > Security > Protection — collapsible sections**: Attack Protection, Blocked IPs, and Active Features are now collapsible frames (Active Features collapsed by default)
- **Telegram SVG icon**: added to `public/icons/services/telegram.svg` and `src/icons/telegram.svg`; Discord and Telegram logos now appear in webhook type badges and add-buttons in the UI

### Changed
- Webhook route (`server/routes/notifications.ts`) extended to persist `events`, `batchWindow`, `maxPerBatch` fields
- Removed placeholder warning "Le déclenchement automatique sera actif dans une prochaine mise à jour" — webhook dispatch is now fully implemented

---

## [0.7.1] - 2026-03-29

### Added
- **Fail2ban > Backup — local snapshots**: config and DB snapshots stored in-app, auto-pruned (max 10 for config, max 5 for DB), with per-row download / restore / delete actions
- **Fail2ban > Backup — per-row download**: IPTables and IPSet backup entries now have a download button to save files locally
- **Fail2ban > Backup — DB export/import**: export only the 6 `f2b_*` tables as JSON; import with merge or replace mode
- **Fail2ban > Config — integration panel**: button order fixed (Test before Save for both SQLite and NPM fields); Save buttons changed from red to blue
- **Fail2ban > Backup — color unification**: backup/save actions = green, restore/import actions = orange, delete actions = red; section header badges keep distinct identity colors

### Changed
- `TabBackup` refactored into self-contained sub-components: `ConfigSnapshotPanel`, `ConfigRestorePanel`, `DbSnapshotPanel`, `DbImportPanel`, `IptBackupPanel`, `IpsetBackupPanel`
- All backup section grids use `alignItems: stretch` with sticky action buttons at card bottom

---

## [0.6.9] - 2026-03-28

### Fixed
- fix: replace `sudo bash <(curl ...)` with `curl ... | sudo bash` everywhere — process substitution fails when `/dev/fd` is unavailable (TabConfig UI, TabAudit UI, README.md, README.fr.md, docker-compose.yml, docker-compose.local.yml)

---

## [0.6.8] - 2026-03-28

### Docs
- docs: fix VACUUM docker-compose example — short-form mount `- /var/lib/fail2ban:/host/var/lib/fail2ban` cannot override a `:ro` parent mount; correct syntax uses `type: bind` with `propagation: shared`
- docs: update `docker-compose.yml`, `README.md`, `README.fr.md` with working VACUUM override and explanation

---

## [0.6.7] - 2026-03-28

### Fixed
- fix: `TypeError: ae.flatMap is not a function` on Fail2ban page in Docker — fallback SQLite path in `/status` route returned `jails` as a Record object instead of an array; changed to `Object.values(jailsMap)`

---

## [0.6.6] - 2026-03-28

### Fixed
- fix: Fail2ban SQLite VACUUM fails in Docker when host filesystem is mounted `:ro` — backend now detects EROFS/SQLITE_READONLY and returns `dockerReadOnly: true`; UI shows the exact docker-compose volume override to enable VACUUM

### Improved
- style: unify input field appearance across all Fail2ban tabs (`#161b22` background + 3-layer inset shadow + `borderBottom: #555`)
- style: convert Fail2banPathConfig.tsx from Tailwind classes to inline styles matching the PHP-palette design system

### Docs
- docs: document `:ro` vs VACUUM trade-off in `docker-compose.yml`, `README.md`, and `README.fr.md` — add commented-out rw override line for enabling VACUUM

---

## [0.6.5] - 2026-03-28

### Performance
- perf: add TTL route cache to Fail2banPlugin for slow endpoints (/status 8s, /history 30s, /tops 30s, /bans-today 5s, /config/parsed 60s)
- perf: /tops always computes 100 items (STORE_LIMIT) regardless of `limit` param — deduplicates concurrent TabStats (limit=100) and BanHistoryChart (limit=1) requests via shared cache key
- perf: delay initial checkConfigWarnings() call by 4s so /config/parsed (~6s) does not compete with /status+/history during first-load wave

---

## [0.6.4] - 2026-03-28

### Added

- **README.fr.md** — French mirror of the main README; link added at the top of `README.md`
- **i18n: `common` namespace** — shared keys for loading, saving, error, close, cancel, hide, refresh, save, edit, delete and their variants; used across all pages
- **i18n: `header` namespace** — all Header.tsx button titles, page titles, live/auto-refresh labels, update badge
- **i18n: `logViewer.types` namespace** — log file type labels (auth, daemon, access, error, syslog, subdomain…) now translated instead of hardcoded
- **i18n: `permissions` namespace** — Freebox permission labels and error messages
- **i18n: `fail2ban` namespace** — 150+ strings across 11 files now fully translated (tabs, status, actions, labels, tooltips, placeholders, errors, periods, attack categories, time-ago, views, config, jails, tracker, map, backup, stats)

### Changed

- **README.md** — fully translated to English (was French/English mix); French version moved to `README.md.fr`
- **CHANGELOG.md** — all French-language entries translated to English
- **`Header.tsx`** — 20+ hardcoded French strings replaced with `t()` calls; `useTranslation` added
- **`LogFileSelector.tsx`** — static `TYPE_LABELS` constant replaced with dynamic `t('logViewer.types.*')` calls
- **`permissions.ts`** — `PERMISSION_LABELS` replaced with i18n key lookups; `getPermissionErrorMessage` and `getPermissionShortError` now accept `TFunction` parameter
- **`PermissionBanner.tsx`** — uses `useTranslation`; hardcoded French string replaced
- **`SettingsPage.tsx`** — error/loading messages in 4 sub-components replaced with `common.errors.*` keys
- **`LogViewerPage.tsx`** — loading and error strings replaced with `common.*` keys
- **Fail2ban — `Fail2banPage.tsx`** — tab labels, time-ago strings, period labels migrated to i18n
- **Fail2ban — `TabJails.tsx`** — filter placeholders, view toggles, status labels, tooltips migrated
- **Fail2ban — `TabStats.tsx`** — stat card labels, section titles, loading states migrated
- **Fail2ban — `TabBackup.tsx`** — backup/import/export labels and error messages migrated
- **Fail2ban — `TabConfig.tsx`** — config labels, error messages migrated
- **Fail2ban — `TabMap.tsx`** — map loading, country filter labels migrated
- **Fail2ban — `IpModal.tsx`** — attack categories, geo labels, table headers migrated
- **Fail2ban — `TabTracker.tsx`** — DNS mode, geo, column headers migrated
- **Fail2ban — `TabBanManager.tsx`** — placeholders and error messages migrated
- **Fail2ban — `TabIPTables.tsx`** — chain/rule labels migrated
- **Fail2ban — `JailConfigModal.tsx`** — error and loading strings migrated
- **Fail2ban — `helpers.tsx`** — `StatusDot` status strings migrated

---

## [0.5.7] - 2026-03-27

### Fixed

- **IP modal log display** — filter out `/api/plugins/fail2ban/` lines from log entries (self-generated API calls were appearing as duplicates); log file sections with no remaining lines are hidden; line count badge reflects filtered count

---

## [0.5.6] - 2026-03-27

### Fixed

- **CI: upgrade GitHub Actions to Node.js 24** — updated all actions to latest versions (`actions/checkout@v6`, `docker/*@v4`/`v6`/`v7`) to eliminate Node.js 20 deprecation warnings before the June 2026 forced migration

---

## [0.5.5] - 2026-03-27

### Fixed

- **Docker build warnings** — suppressed deprecated transitive dependency warnings (`rimraf@3`, `glob@7`, `npmlog`) during `npm ci`; these come from `bcrypt` → `@mapbox/node-pre-gyp` build tools only, not runtime
- **CI: Docker Hub login** — added Docker Hub authentication before QEMU/buildx setup to avoid anonymous pull rate limits on GitHub Actions runners
- **Firewall tabs: `no-new-privileges` incompatibility** — `security_opt: no-new-privileges:true` prevents `sudo` from running, breaking `iptables-save`/`ipset list`/`nft`; commented out in firewall mode with clear explanation in all compose files and README

---

## [0.5.4] - 2026-03-27

### Fixed

- **Firewall tabs (IPTables / IPSet / NFTables) now work correctly in Docker** — `network_mode: host` is required (not just `cap_add: NET_ADMIN`) to share the host network namespace; without it the container saw its own empty namespace instead of the host rules
- **`security_opt: no-new-privileges:true` incompatible with firewall tabs** — this flag prevents `sudo` from elevating privileges, breaking `iptables-save`, `ipset list`, and `nft` commands; must be removed when using firewall tabs
- **JWT tokens invalidated on container restart** — JWT secret is now persisted in the SQLite `app_config` table on first start; subsequent restarts reuse the same secret instead of generating a new one
- **WebSocket endpoints unauthenticated** — `/ws/log-viewer` and `/ws/logs` now require a valid JWT token passed as `?token=` query parameter; connections without a valid token are rejected with code 4401
- **CORS misconfigured in production** — default changed from `true` (all origins) to `false` (same-origin only); set `CORS_ORIGIN` env var to allow a specific origin if needed
- **Path traversal in log viewer** — user-supplied `basePath` values containing `..` are now rejected
- **Path traversal in config import** — uploaded file paths are validated against the allowed config directory using `path.resolve()`
- **Public endpoints unprotected** — `/api/users/check` (20 req/min) and `/api/users/register` (5 req/min) are now rate-limited per IP

### Changed

- **`docker-compose.yml`** — clarified MODE A (bridge, default) vs MODE B (host network, firewall tabs) with inline examples; documented `PORT` vs `DASHBOARD_PORT` distinction; added reverse proxy examples (NPM, Nginx, Caddy, Traefik)
- **`docker-compose.test.yml`** — `security_opt: no-new-privileges` commented out (incompatible with firewall tabs in host network mode)
- **README** — firewall tabs section updated with all three incompatibilities (`ports:`, `no-new-privileges`, port change workflow); reverse proxy configuration examples added
- **Security headers** — added `X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`; removed `X-Powered-By`

---

## [0.4.9] - 2026-03-26

### For users

> Real-time 24h chart, functional Domain column, and automatic refresh of Fail2ban events.

- **Rolling 24h chart** — The chart no longer shows fixed 24-hour slots (00h–23h) but always displays the **last 24 hours** from now, with data points every 30 minutes. The X axis shows exact times (e.g. `14:00`, `15:00`…) and updates continuously.
- **Domain column in Events** — The "Domain" column of the Events table (Jails tab) now displays the domain name of the attacked site for jails linked to Nginx Proxy Manager. Resolution uses the NPM database directly — more reliable than config files that may not exist.
- **Automatically refreshed events** — The Fail2ban events table reloads every 30 seconds in the background (paused when the tab is hidden).
- **Fixed double scrollbar** — The Jails page sometimes displayed two simultaneous scrollbars; this is now fixed.

---

### Technical

#### Backend — Fail2ban

- **`Fail2banPlugin.ts`** — Strategy 3 domain replaced: reads `<npm_base>/database.sqlite` (`proxy_host.domain_names`) via `better-sqlite3` in read-only mode, instead of nginx `.conf` files that may not exist for deleted hosts. `better-sqlite3` import added. `_debug_domains` field removed from `/audit` response.
- **`Fail2banSqliteReader.ts`** — `SLOT_SECS = 1800` (30 min). For `days=1`, `since` aligned to the 30-min boundary (`Math.floor(rawSince / 1800) * 1800`), slots indexed by `CAST((timeofban - since) / 1800 AS INTEGER)`, labels `HH:MM`. `slotBase` returned in response for frontend synchronization.

#### Frontend — Fail2ban

- **`BanHistoryChart.tsx`** — `buildHourlySlots()` replaced by `buildRollingSlots(history, slotBase)`: 48 slots of 30 min from `slotBase` to now, recalculated in real time via a 5s ticker. X labels displayed only on `:00` slots (one label per hour). Vertical "now" line removed.
- **`Fail2banPage.tsx`** — `slotBase` state added, fed from `fetchStatus`, passed to `BanHistoryChart`.
- **`TabJails.tsx`** — `AuditEnrichment._debug_domains` removed; debug panel removed. `fetchAudit` re-polls every 30s with `document.hidden` guard. Domain resolution via `enrichment.jail_domains[b.jail]`.

#### Frontend — Global

- **`App.tsx`** — `wrapWithBackground(content, fullscreen=true)`: `h-screen overflow-hidden` variant without `pb-20` for the Fail2ban page → removes the double scrollbar.
- **`TabAudit.tsx`** — Simplified: the Events/Logs sub-tab switcher removed; the Audit tab now only shows `TabJailsFiles` (Events have their own nav entry).
- **`TabBanManager.tsx`** — `FileBtn` component (styled file button hiding the native `<input type="file">`); responsive grid `minmax(min(100%,420px),1fr)`.
- **`TabConfig.tsx`** — `local_exists` field in `GlobalConfig`; extended DB stats (`bans`, `jails`, `logs`); `resetting` state for the maintenance button.

---

## [0.4.8] - 2026-03-25

### For users

> Refined Fail2ban interface: more compact header, 24h chart by hour, bantime and map fixes.

- **More compact header** — The main navigation bar is slimmer; the Clock and User badges take up less space to leave more room for content.
- **Wider Fail2ban menu** — The left sidebar of the Fail2ban plugin is slightly wider to display tooltips in full; the collapse arrow is always positioned on the right.
- **Centered ban notifications** — Ban alerts now appear at the top center of the screen, clearly visible without obstructing navigation.
- **24h chart: axis by hour** — In "24h" filter mode, the X axis displays all 24 hours (00h–23h) to see precisely what time bans occurred. Other periods automatically adapt the number of labels (7d → 7 labels, 1yr → ~13 labels…).
- **Fixed chart legend** — Clicking a jail name in the legend now actually hides its curve/bar and recalculates the Y scale accordingly.
- **Colored bantime** — The Bantime column in the Jails tab displays a color based on duration: green (< 1h), blue (1h–24h), orange (1d–30d), red (≥ 30d or permanent).
- **Exact bantime for all jails** — Jails whose ban duration was not present in config files (e.g. `recidive`, `apache-shellshock`) now retrieve the actual value via the Fail2ban socket.
- **Regex sections collapsed by default** — The two regex management sections in Settings are now closed on load to lighten the page; a badge shows the number of configured regexes.
- **Map: crash on first load fixed** — The Leaflet map no longer crashes on first display in development mode (Leaflet/MarkerCluster race condition resolved).

---

### Technical

#### Frontend — Fail2ban

- **`BanHistoryChart.tsx`** — `isHourly` prop passed to `BarChart`/`LineChart` sub-components; `effectiveMax` recalculated from visible jails only (legend fix); `labelCountForDays()` adapts label count by period; `buildHourlySlots()` generates 24 slots "00"–"23" for `days=1`.
- **`Fail2banPage.tsx`** — `granularity` state passed to `BanHistoryChart`; ban toasts recentered (`position:fixed, top:5rem, left:50%, transform:translateX(-50%)`); sidebar widened to 220px; `›`/`‹` button always aligned to the right.
- **`TabJails.tsx`** — Colored bantime badge: `bantime < 0 || >= 2592000` → red, `>= 86400` → orange, `>= 3600` → blue, otherwise green.
- **`TabMap.tsx`** — `loadScript()` fixed for React Strict Mode: if the `<script>` is already in the DOM, waits for the `load` event (via `_loaded` flag) instead of resolving immediately → fixes `L.markerClusterGroup is not a function`.

#### Backend — Fail2ban

- **`Fail2banPlugin.ts`** — `parseNum()`: regex `^(-?\d+...)` handles negative bantimes (`-1` = permanent) and the `w` unit (weeks); for jails whose `bantime/findtime/maxretry` is absent from config files, `getJailParam()` is called as fallback via the socket.
- **`Fail2banClientExec.ts`** — New method `getJailParam(jail, param)`: executes `fail2ban-client get <jail> <param>` and parses the returned numeric value.
- **`Fail2banSqliteReader.ts`** — `getBanHistoryByJail()` and `getBanHistory()`: when `days=1`, SQL query uses `strftime('%H', timeofban, 'unixepoch')` for hourly grouping; returns `granularity: 'hour' | 'day'`.

#### Frontend — Global

- **`Header.tsx`** — Reduced padding (`p-4` → `px-4 py-2`), logo `w-8 h-8` → `w-6 h-6`, plugin icons `w-5 h-5` → `w-4 h-4`.
- **`Clock.tsx`** — Container `px-4 py-2` → `px-2.5 py-1.5`, LED dot `w-2 h-2` → `w-1.5 h-1.5`, time text `text-sm` → `text-xs`.
- **`UserMenu.tsx`** — Button `px-3 py-2` → `px-2 py-1.5`, avatar `w-10 h-10` → `w-6 h-6`.
- **`SettingsSection.tsx`** — `collapsible`, `defaultCollapsed`, `badge` props added to `<Section>` with chevron animation.
- **`RegexManagementSection.tsx`** — Both sections (`customTitle`, `generatorTitle`) pass `collapsible defaultCollapsed`; counter badge on the custom section.
- **`SettingsPage.tsx`** — Removed redundant `<Section>` wrapper around `<RegexManagementSection />`.

#### Documentation

- **`README.md`** — Simplified: quick install section at the top, Fail2ban section with a single curl command, cleaned env table.

---

## [0.4.7] - 2026-03-25

### For users

> The Fail2ban plugin now works automatically in Docker, without manual group configuration.

- **Automatic Fail2ban socket access** — The container now detects Fail2ban socket permissions at startup and adapts automatically. No longer need to configure `FAIL2BAN_GID` in the `.env` file: the plugin activates as soon as `setup-fail2ban-access.sh` has been run once on the host.

---

### Technical

#### Docker — `docker-entrypoint.sh`

- **Dynamic GID detection** — Replaces the old static `chmod 660`. On each container start: `stat -c "%g"` reads the real GID of the socket, creates the corresponding group in Alpine (`addgroup -g $SOCK_GID fail2ban`), then adds `node` to that group. Works regardless of the GID used on the host, without any environment variable.
- **Explicit log message** — If `gid=0` (socket still `root:root`), displays a message pointing to `setup-fail2ban-access.sh`.

#### Docker — `docker-compose.yml`

- **Removal of `FAIL2BAN_GID` from `group_add`** — This `group_add` mechanism was inoperative because the `fail2ban` group does not exist in the base Alpine image (Docker silently ignores GIDs absent from `/etc/group`). The entry has been removed; the entrypoint now handles everything dynamically.

---

## [0.4.3] - 2026-03-25

### What's new for users

> Fail2ban plugin configuration check: clearer diagnostics and accurate status indicators.

- **Fail2ban check panel** — All status indicators (socket, daemon, SQLite, drop-in) now reflect the real state correctly. The daemon was previously shown as red even when Fail2ban was running — this is fixed.
- **Fix instructions hidden when OK** — The "See how to fix" button is now hidden for checks that pass. Only failed checks show repair instructions.
- **Paths displayed in full** — File paths (socket, SQLite database) are now shown on their own line, never truncated.
- **README** — Added Fail2ban plugin documentation section.

---

### Technical

#### Backend — `server/plugins/fail2ban/Fail2banPlugin.ts`

- **Daemon check**: was using `this.client?.ping()` which is only initialized when the plugin is already enabled → always null/false before first enable. Now creates a temporary `new Fail2banClientExec()` instance so the check works before the plugin is enabled.
- **Socket fix message**: updated to recommend `chmod 666` (instead of 660) to ensure Docker container access regardless of group. Includes drop-in file path and corrected content.
- **Drop-in fix**: removed the spurious `fix` message that appeared when `dropin.ok=true` but socket was inaccessible — that case now only appears in `socket.fix`.
- **SQLite path in response**: now returns `rawDbPath` (user-facing path, e.g. `/var/lib/fail2ban/fail2ban.sqlite3`) instead of the Docker-resolved internal path (`/host/var/lib/...`).
- **Daemon fix message**: now shows a clear "cannot check — socket inaccessible" message instead of silently returning red with no explanation.

#### Frontend — `src/components/PluginOptionsPanel.tsx`

- **"Voir comment corriger" hidden when `c.ok=true`**: changed `{hasFix && ...}` to `{hasFix && !c.ok && ...}`.
- **Path display**: moved from inline truncated `max-w-[200px]` to a dedicated sub-line with `break-all` so full paths are always visible.
- **Hardcoded helper text**: fixed `/host/var/lib/fail2ban/fail2ban.sqlite3` → `/var/lib/fail2ban/fail2ban.sqlite3`.

#### Documentation — `README.md`

- Added Fail2ban plugin entry in the Plugins section (features, tabs, requirements, configuration).

---

## [0.4.2] - 2026-03-25

### What's new for users

> Automatic update notifications and configurable default page on login.

- **Automatic update check** — LogviewR can now check whether a new version is available and notify you directly in the UI. A dismissable banner appears at the top of the screen when an update is ready (Docker image built on GHCR), with the exact command to run. Check frequency and enable/disable are configurable in Administration → General.
- **Configurable default page** — Choose which page opens after login: dashboard, log viewer, or the Fail2ban page with a specific tab pre-selected.
- **Reminder — Fail2ban plugin** *(available since v0.4.0)* — If you run a server with Fail2ban, the dedicated plugin provides full monitoring: active jails, banned IPs, ban history, attack map, IP tracker, statistics, and ban management. Enable it in Administration → Plugins.

---

### Technical

#### Administration — Update checker

- **`server/routes/updates.ts`** — New version check module: primary method via GitHub Tags API, Docker image availability verified on GHCR (anonymous Bearer token + HEAD manifest check) before reporting an update; `dockerReady: boolean` field separate from `updateAvailable`.
- **`src/stores/updateStore.ts`** — Zustand store: `checkForUpdates`, `loadConfig`, `setConfig(enabled, frequency)`; `UpdateInfo` interface with `dockerReady` field.
- **`src/pages/SettingsPage.tsx` — `UpdateCheckSection`** — Enable toggle + frequency selector (1h/6h/12h/24h/7d); current version / latest version / GHCR build status display; conditional `docker compose pull && docker compose up -d` command block.
- **`src/App.tsx`** — Sticky dismissable banner (amber) shown only when `updateAvailable && dockerReady`; dismissal persisted per version in `localStorage['logviewr-dismissed-version']`; periodic polling based on configured frequency.

#### Administration — General tab

- **Default page** — Added `fail2ban` as a startup page option with tab selector (12 tabs), conditioned on plugin being enabled.
- **`server/routes/system.ts`** — Bug fix: `defaultPage`, `defaultPluginId`, `defaultLogFile` were never written in `PUT /api/system/general` (silent bug since initial implementation). Added `defaultFail2banTab`. Validation against `VALID_PAGES = ['dashboard', 'log-viewer', 'fail2ban']`.
- **`src/App.tsx`** — Effective navigation to configured default page on login (fetch `GET /api/system/general` in `useEffect([isUserAuthenticated])`).
- **DefaultPageSection flicker fix** — General tab no longer unmounts its content on tab switch (`display:none` instead of `&&`); module-level cache for fetched values; inline save indicator (12px spinner in title) with no layout shift.

#### Administration — UI

- **Notifications tab → Webhooks** — Renamed in `en.json` and `fr.json`.
- **Exporter — Removed "Log overview stats" card** — Stats block (files, .gz, active plugins, errors) removed from Exporter tab; related state and `useEffect` removed from `ExporterSection.tsx`.

#### Server log cleanup

- All non-essential `console.log` calls migrated to `logger.debug()` (gated, debug mode only) in: `BasePlugin`, `Fail2banPlugin`, `NotificationPlugin`, `AnalysisPlugin`, `HostSystemLogPlugin`, `fail2banSyncService`, `configService`, `routes/updates.ts`.
- `console.error` → `logger.error()` throughout; no sensitive data (tokens, API keys, full responses) appears in logs.

---

## [0.4.1] - 2026-03-25

### Fixed

- **BanHistoryChart** — Removed `overflow: hidden` on the card wrapper that was masking the SVG chart on view changes.
- **BanHistoryChart** — Clicking the card header no longer accidentally collapses the chart; the collapse toggle is now only on the dedicated `▾/▸` button.
- **Fail2ban — Scrolling** — Switching main tab (Fail2banPage) and switching view in TabJails (Cards/Table/Events) now automatically scrolls back to the top of the page; the chart was invisible because it was hidden above the viewport.
- **Search bars** — Correct centering in the toolbars of TabJails, TabJailsEvents, TabFiltres, TabActions, TabTracker, TabStats (pattern `flex:1; justify-content:center`).
- **Jails tables** — Removed `overflowX: auto` and excessive `minWidth` on the Events and Table tables to avoid unwanted horizontal scroll.

### Added

- **Shared IpModal** (`src/pages/fail2ban/IpModal.tsx`) — New IP detail modal shared across all tabs:
  - Header: IP (red monospace), recidivist badge if present in `recidive` jail, flag + city/country + organization.
  - 2-column block: Statistics (total bans, jail(s), last ban, first ban, attempts) | Whois/Network (country, organization, ASN, ISP, city).
  - **Ban in recidive** button (hidden if already a recidivist), with success/error visual feedback.
  - Scrollable history table (date, jail, duration, attempts) with sticky headers.
  - Auto-fetch geolocation if not provided by the calling context.
  - Exports: `IpModal`, `GeoInfo`, `toFlag`, `fmtBantime`.
- **Clickable IPs — TabTracker** — Updated to use the new shared `IpModal` (local component removed); known jails passed to the modal.
- **Clickable IPs — TabJailsEvents** — IPs in the Events table now open the detail modal.
- **Clickable IPs — JailCard (Cards view)** — Banned IPs in the jail card table now open the detail modal.
- **Clickable IPs — JailExpandedGrid (Table view)** — IPs in the "Bans < 5 min" and "Active banned IPs" columns open the detail modal.

---

## [0.4.0] - 2026-03-25

### Added

#### Fail2ban Plugin — Full integration

New Fail2ban monitoring plugin with a complete multi-tab interface, visually aligned with the PHP reference project `fail2ban-web`.

**Backend (`server/plugins/fail2ban/`)**
- `Fail2banPlugin.ts` — Express plugin with 20+ REST routes covering status, history, jails, bans, filters, actions, tracker, map, IPTables, IPSet, NFTables, configuration, audit.
- `Fail2banSqliteReader.ts` — Direct read of the fail2ban SQLite database (`fail2ban.sqlite3`) in read-only mode; active stats, daily history, top IPs/jails, hourly heatmap, unique IPs, expired bans.
- `Fail2banClientExec.ts` — Execution of `fail2ban-client` commands via Unix socket (ban, unban, reload, status) and system utilities (iptables, ipset, nftables).
- `fail2banSyncService.ts` — Periodic synchronization service SQLite → application DB.
- `f2b_ip_geo` table in application SQLite DB: IP geolocation cache with 30-day TTL.

**Frontend (`src/pages/Fail2banPage.tsx` + `src/pages/fail2ban/`)**
- **TabJails** — Table/cards/events/log files view of active jails; inline expansion with detailed config (bantime, findtime, maxretry, filter, actions, banned IPs); Active/All toggle to show configured but stopped jails (semi-transparent); integrated search filter; ban/unban/reload actions per jail.
- **TabStats** — Global statistics: top IPs, top jails, ban/attempt heatmap by hour, jail distribution, jail summary, period summary, attack types, latest events, IPSets.
- **TabTracker** — Table of currently banned IPs enriched with: reverse DNS resolution (with 10-min cache), IPSet membership per IP, on-demand geolocation (ip-api.com), IP detail modal with ban history.
- **TabMap** — Leaflet map (CDN, dark CartoCDN tile) with MarkerCluster clustering; progressive geolocation; country/region filter side panel with heat-colors; IP popup with link to Tracker.
- **TabBanManager** — Manual ban/unban interface with jail selection + IP input.
- **TabFiltres / TabActions** — View of filters and actions configured per jail with colored badges.
- **TabConfig** — Fail2ban configuration editor (jail.conf, jail.local, jail.d/) with visual diff and reload.
- **TabAudit** — Real-time tail of fail2ban.log with syntax highlighting.
- **TabNetworkRaw** — Raw IPTables / IPSet / NFTables display.
- **TabAide** — Integrated documentation.
- **BanHistoryChart** — Shared chart (bars or curves) displayed once for the Jails and Stats tabs; selectable period (24h, 7d, 30d, 6m, 1yr, All).
- **Topbar chips** — Real-time badges: active jails (blue), banned (red), failures (orange), active (green).
- **Toast notifications** — Automatic detection of new bans on each poll (every 30s) with animated toast.
- **Refresh badge** — Exact time of last refresh + relative age in the title bar.
- **Collapsible sidebar** — Left menu collapsible (icons only) with toggle in header and at bottom of menu.
- **Mini stat cards** — 6 cards (Active Jails, Active Bans, Active Failures, Total cumulative bans, Unique IPs, Expired 24h) with sparklines and ↑/↓ trend indicators.
- **Variable interpolation** — Resolution of `%(__name__)s` and `%(var)s` in filter/banaction badges of inactive jails.
- **JailConfigModal** — Quick edit modal for bantime / findtime / maxretry parameters with slider and step buttons.

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
