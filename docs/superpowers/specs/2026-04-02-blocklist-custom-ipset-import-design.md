# Design: Custom Blocklists + IPSet File Import

**Date:** 2026-04-02
**Scope:** Two independent features in the Fail2ban tab

---

## Feature 1 — Custom URL Blocklists (TabBlocklists)

### Goal

Allow users to add their own public IPv4 blocklists (accessible by URL) alongside the two built-in Data-Shield lists. Custom lists support the same enable/disable/refresh lifecycle. They can be deleted, which automatically cleans up kernel state (iptables rule + ipset).

### Data Model

**`data/blocklist-custom.json`** — persisted array of custom list definitions:

```json
[
  {
    "id": "custom-spamhaus",
    "name": "Spamhaus DROP",
    "url": "https://www.spamhaus.org/drop/drop.txt",
    "ipsetName": "custom-spamhaus",
    "description": "Spamhaus Don't Route Or Peer list",
    "maxelem": 150000
  }
]
```

`id` is derived from `ipsetName` (they share the same value — ipsetName is user-supplied, validated unique).

The existing `data/blocklist-status.json` is unchanged in structure. Status entries for custom lists are stored there alongside built-in ones, keyed by the same `id`.

### Backend Changes (`BlocklistService.ts`)

**New private state:**
- `_customDefsFile: string` — path to `blocklist-custom.json`
- `_customDefs: Map<string, CustomListDef>` — loaded custom definitions

**Constructor:** calls `_loadCustomDefs()` after `_loadStatus()`. The in-memory `LISTS`-equivalent is the merge of hardcoded `LISTS` + `_customDefs`.

**`_loadCustomDefs()`:** reads JSON file, populates `_customDefs`. No-op if file absent.

**`_saveCustomDefs()`:** writes `_customDefs` values to JSON.

**`_allLists()`:** returns `{ ...LISTS, ...Object.fromEntries(_customDefs) }` — used everywhere instead of bare `LISTS`.

All existing methods (`refresh`, `enable`, `disable`, `getStatus`, `restoreOnStartup`, `startAutoRefresh`) are updated to call `_allLists()` instead of `LISTS` directly.

**New public methods:**

`addCustomList(def: CustomListDef): { ok: boolean; error?: string }`
- Validates: `ipsetName` not already used in LISTS or `_customDefs`
- Validates: `name` non-empty, `url` non-empty and starts with `http`
- Sets `id = def.ipsetName` (same value, simplifies key management)
- Adds to `_customDefs`, saves, adds a default status entry (enabled: false, count: 0)
- Returns `{ ok: true }` or `{ ok: false, error: '...' }`

`removeCustomList(id: string): Promise<{ ok: boolean; error?: string }>`
- Refuses if `id` is a built-in key from `LISTS`
- Calls `disable(id)` first (removes iptables rule silently)
- Destroys ipset: `ipset destroy <ipsetName>` (ignores "does not exist")
- Removes from `_customDefs`, saves
- Removes from `_status`, saves status
- Returns `{ ok: true }`

**`getStatus()`** is extended to return a `builtin: boolean` flag per entry.

### New API Routes

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/blocklists/add` | `{ name, url, ipsetName, description?, maxelem? }` | Add custom list |
| `DELETE` | `/blocklists/remove/:id` | — | Delete custom list (auto-disable + kernel cleanup) |

Existing routes (`/status`, `/refresh`, `/toggle`) unchanged.

### Frontend Changes (`TabBlocklists.tsx`)

**ListState** gains `builtin: boolean`.

**Collapsible add form** — triggered by a "+ Ajouter une liste" button below the existing cards:
- Champs : Nom (text), URL (text), Nom d'ipset (text, validated in real-time against current ipset names), Description (text, optional)
- ipsetName validation: checked against the current `lists` state — shows inline error if already taken
- On submit: `POST /blocklists/add`, then `fetchStatus()`
- Cancel button collapses the form

**Delete button** on custom list cards only (`builtin: false`):
- Small trash icon button, top-right of card
- Calls `DELETE /blocklists/remove/:id`, then `fetchStatus()`
- No confirmation modal (action is clear and labeled)

**Card left border color:** built-in = `#e86a65` (existing red), custom = `#58a6ff` (blue) — visual distinction.

---

## Feature 2 — IPSet File Import (TabIPSet)

### Goal

Allow importing a `.txt` file (one IPv4 per line) into an existing ipset, as an alternative to adding IPs one by one.

### Backend Changes (`Fail2banPlugin.ts`)

**New route:** `POST /ipset/import`

Body: `{ set: string, ips: string[] }`

Logic:
- Validates `set` exists (calls `ipset list -n <set>`)
- Filters `ips` to valid IPv4 (server-side re-validation, even though client pre-validates)
- Iterates valid IPs, calls `ipset add <set> <ip>` for each (ignores "already added" errors)
- Returns `{ added: number, skipped: number, errors: string[] }`

No new service class needed — inline in the route handler like existing ipset routes.

### Frontend Changes (`TabIPSet.tsx`)

**Import button** added to the existing UI (next to the "Ajouter une IP" input area):
- `<input type="file" accept=".txt" style={{ display: 'none' }}>` triggered by button click
- On file select: reads as text, splits by newline, filters valid IPv4 regex, sends to `/ipset/import`
- Shows inline feedback: "127 IPs ajoutées, 3 ignorées"
- Button is disabled if no set is selected

---

## Out of Scope

- CIDR range support in file import (IPv4 only, no subnets)
- Edit existing custom list definition (delete + re-add)
- Custom `maxelem` exposed in the add form (defaults to 150000, same as built-ins)
- Pagination or search within blocklist cards
