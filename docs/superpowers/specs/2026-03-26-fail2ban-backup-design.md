# Fail2ban — Tab Backup (export + restore)

**Date:** 2026-03-26
**Scope:** Fail2ban backup only (IPTables/NFTables excluded from v1)
**Reference:** `integration/Fail2ban-web/tabs/backups.php` + `engine.inc.php:full_backup_export / full_backup_restore`

---

## Goal

Add a **Backup** tab to the Fail2ban page that allows:
1. Downloading a full JSON backup of all Fail2ban config files + runtime state
2. Restoring that backup (`.local` files only) with an optional `fail2ban-client reload`

---

## Architecture

### Backend — `server/plugins/fail2ban/Fail2banPlugin.ts`

Two new Express routes registered under `/api/plugins/fail2ban/`:

#### `GET /backup/full`
- Resolves config path via `this.resolveDockerPathSync('/etc/fail2ban')` (same pattern as all other routes — never a hardcoded `/host/` prefix)
- Reads the following files (non-recursive, direct children only for subdirs):
  - Root files: `fail2ban.conf`, `fail2ban.local`, `jail.conf`, `jail.local`, `paths-common.conf`, `paths-debian.conf`
  - Subdirectories (direct children only): `jail.d/`, `filter.d/`, `action.d/`
- Adds runtime jail state via `fail2ban-client status <jail>` (banned IPs, counts) — best-effort, skipped on error
- Builds a JSON object matching the PHP `f2b_full_backup` format:
  ```json
  {
    "version": 1,
    "type": "f2b_full_backup",
    "exported_at": "<ISO timestamp>",
    "exported_by": "LogviewR",
    "host": "<os.hostname()>",
    "files": { "/etc/fail2ban/jail.local": "<content>", ... },
    "runtime": {
      "total_banned": 3,
      "jails": {
        "sshd": { "currently_banned": 2, "banned_ips": ["1.2.3.4"] }
      }
    }
  }
  ```
  `host` is obtained via `import * as os from 'os'` → `os.hostname()`.
- Sets headers: `Content-Type: application/json`, `Content-Disposition: attachment` (no filename in header — filename is owned by the frontend)
- Returns the JSON as a streamed response (no `{ success, result }` wrapper — it's a file download)

#### `POST /backup/restore`
- Receives `application/json` body: the backup JSON object
- **Backend validation:** rejects with HTTP 400 if `body.type !== 'f2b_full_backup'` or `body.version !== 1`
- Query param: `?reload=1` to trigger `fail2ban-client reload` after writing
- Security — two-layer path guard:
  1. Rejects any file key containing `..`
  2. After resolving the write path, asserts `resolvedPath.startsWith(confBase)` before writing (mirrors the guard used by the `/logs/:name` route)
- Only writes files whose key ends with `.local` — `.conf` files are always skipped
- For each eligible `.local` file: writes content to the Docker-resolved path
- Returns standard `{ success: true, result: { ok, written, skipped, errors, reloadOk?, reloadOut? } }`
  - `ok: true` if no file-write errors occurred (reload failures do not affect `ok`)

### Frontend — `src/pages/fail2ban/TabBackup.tsx`

Single file, two PHP-style cards rendered in a single-column layout.

#### Card 1 — Backup complet (export)
- Header: "Backup complet" (blue), badge "Export"
- Body: list of 6 included items (config files, runtime state) — static, same as PHP
- Button: "Télécharger le backup JSON"
  - On click: sets `exporting = true` (shows spinner)
  - `fetch('/api/plugins/fail2ban/backup/full', { credentials: 'include' })`
  - On success: creates `blob URL` → sets `<a download="fail2ban-backup-YYYY-MM-DD_HHmmss.json">` → auto-clicks → revokes URL
  - Filename `fail2ban-backup-YYYY-MM-DD_HHmmss.json` is computed client-side at click time (frontend owns the filename; `Content-Disposition` header has no filename)
  - On error: shows inline red error message
  - `exporting = false` when done

#### Card 2 — Restaurer un backup (restore)
- Header: "Restaurer un backup" (purple), badge "Restaurer"
- Warning banner: "Seuls les fichiers `.local` sont restaurés — les `.conf` système ne sont jamais écrasés"
- `<input type="file" accept=".json">` → `FileReader.readAsText()`
  - Client-side validates: `d.type === 'f2b_full_backup'` and `d.version === 1`
  - If invalid: inline red message
  - If valid: shows preview panel:
    - ✓ "Backup valide"
    - Exporté le `<date>` depuis `<host>`
    - `N fichier(s)` au total · `N fichier(s) .local` seront restaurés
    - Jails: `sshd, apache, ...`
- Checkbox: "Recharger Fail2ban après restauration (`fail2ban-client reload`)" — checked by default
- Button: "Lancer la restauration" (disabled until valid file selected)
  - On click: `window.confirm(...)` — cancellable
  - On confirm: sets `restoring = true`
  - `fetch POST /api/plugins/fail2ban/backup/restore?reload=<0|1>` with JSON body
  - On success (`result.ok === true`): shows result panel (written files ✓, skipped files -, errors ✗, reload status)
  - On error or `result.ok === false`: inline red message
  - `restoring = false` when done

### Integration in `Fail2banPage.tsx`

**Sequence matters:** `types.ts` must be updated first so that `'backup'` is a valid `TabId` member before the `as TabId` cast in `NAV_GROUPS` references it.

1. Add `'backup'` to `TabId` union in `types.ts`
2. Add entry to `NAV_GROUPS` under group **Outils** (after Audit, before Aide):
   ```ts
   { id: 'backup', label: 'Backup', icon: Archive, color: '#58a6ff' }
   ```
3. Import `TabBackup` from `./fail2ban/TabBackup`
4. Add `{tab === 'backup' && <TabBackup />}` inside the content `<div>`, after the `aide` render branch (render order has no functional effect, but mirrors nav order)

---

## Data Flow

```
[User clicks Export]
  → fetch GET /api/plugins/fail2ban/backup/full
    → Node resolves path via resolveDockerPathSync('/etc/fail2ban')
    → Node reads root files + jail.d/, filter.d/, action.d/ (non-recursive)
    → Node queries fail2ban-client for runtime state (best-effort)
    → Node streams JSON with Content-Disposition: attachment
  → Browser receives blob
  → JS sets <a download="fail2ban-backup-YYYY-MM-DD_HHmmss.json"> and clicks it
  → File saved to Downloads

[User picks restore file]
  → FileReader parses JSON client-side
  → Validates type === 'f2b_full_backup' and version === 1
  → Preview rendered instantly (no server call)

[User confirms restore]
  → fetch POST /api/plugins/fail2ban/backup/restore?reload=1
    → Node validates type + version (400 if wrong)
    → Node filters to .local keys only
    → Node applies two-layer path guard (.. check + startsWith assert)
    → Node writes to resolved confBase path
    → Node runs fail2ban-client reload (if requested)
  → Result panel shown inline
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Config dir not mounted / unreachable | Export returns 503 with message |
| No `.local` files in backup | Restore succeeds with `written: []`, `skipped: [all]`, `ok: true` |
| Invalid JSON file picked (client-side) | Red inline message, button stays disabled |
| Invalid `type` or `version` in POST body | Backend returns 400, inline red message |
| Malformed / truncated POST body | Express JSON middleware returns 400, inline red message |
| Path traversal attempt in file key | Rejected before write, counted in `errors[]` |
| `fail2ban-client reload` fails | `reloadOk: false`, `reloadOut` shown in result — `ok` unaffected |
| Network error during export/restore | Inline red message, spinner stopped |

---

## Files Changed

| File | Change |
|---|---|
| `server/plugins/fail2ban/Fail2banPlugin.ts` | Add `GET /backup/full` and `POST /backup/restore` routes; add `import * as os from 'os'` |
| `src/pages/fail2ban/types.ts` | Add `'backup'` to `TabId` |
| `src/pages/fail2ban/TabBackup.tsx` | New file — 2-card backup UI |
| `src/pages/Fail2banPage.tsx` | Import TabBackup, add nav entry (after Audit in Outils group), add render branch |

---

## Out of Scope (v1)

- IPTables export/restore
- NFTables export/restore
- Export jails sélectif (already accessible via Jails tab)
- Backup history / list of previous backups
