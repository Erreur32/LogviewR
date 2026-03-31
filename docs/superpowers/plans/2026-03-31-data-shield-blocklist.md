# Plan: Data-Shield IPv4 Blocklist Integration

## Context

Data-Shield (https://github.com/duggytuxy/Data-Shield_IPv4_Blocklist) provides curated IPv4 blocklists (~100k IPs, updated every 6h). We integrate it into LogviewR's Fail2ban page as a new "Blocklists" tab in the Firewall group.

**Architecture:** LogviewR runs in Docker with NET_ADMIN capability. ipset commands run from within the container (same as TabIPSet). Downloads happen via Node https. Status persisted to `data/blocklist-status.json`. Each list can be toggled on/off independently.

**Worktree:** `.worktrees/feature/data-shield-blocklist`

---

## Available Lists

```
id: "prod"
  name: "Data-Shield Prod"
  url:  "https://cdn.jsdelivr.net/gh/duggytuxy/Data-Shield_IPv4_Blocklist@main/prod_data-shield_ipv4_blocklist.txt"
  ipsetName: "data-shield-prod"
  description: "Web apps, WordPress, Nginx/Apache (~100k IPs)"

id: "critical"
  name: "Data-Shield Critical"
  url:  "https://cdn.jsdelivr.net/gh/duggytuxy/Data-Shield_IPv4_Blocklist@main/prod_critical_data-shield_ipv4_blocklist.txt"
  ipsetName: "data-shield-critical"
  description: "DMZ, APIs, sensitive infra (~100k IPs)"
```

Both use `maxelem: 150000` (margin for growth), type `hash:ip`.

---

## Data Model

### BlocklistStatus (persisted to `data/blocklist-status.json`)
```typescript
interface BlocklistStatus {
  id: string;           // "prod" | "critical"
  enabled: boolean;     // true = ipset exists + iptables DROP rule active
  lastUpdate: string | null;  // ISO timestamp
  count: number;        // number of IPs loaded
  error: string | null; // last error or null
  updating: boolean;    // true while refresh in progress (reset on startup)
}
```

---

## Task 1 — BlocklistService

**File:** `server/plugins/fail2ban/BlocklistService.ts`

Create a service class `BlocklistService` that manages download, ipset operations, and status persistence.

### Interface

```typescript
class BlocklistService {
  constructor(dataDir: string)
  getStatus(): BlocklistStatus[]
  refresh(id: string): Promise<{ ok: boolean; count?: number; error?: string }>
  enable(id: string): Promise<{ ok: boolean; error?: string }>
  disable(id: string): Promise<{ ok: boolean; error?: string }>
  startAutoRefresh(): void   // setInterval every 6h for enabled lists
  stopAutoRefresh(): void
}
```

### LISTS constant (module-level)
```typescript
const LISTS: Record<string, { name: string; url: string; ipsetName: string; description: string; maxelem: number }> = {
  prod: {
    name: 'Data-Shield Prod',
    url: 'https://cdn.jsdelivr.net/gh/duggytuxy/Data-Shield_IPv4_Blocklist@main/prod_data-shield_ipv4_blocklist.txt',
    ipsetName: 'data-shield-prod',
    description: 'Web apps, WordPress, Nginx/Apache',
    maxelem: 150000,
  },
  critical: {
    name: 'Data-Shield Critical',
    url: 'https://cdn.jsdelivr.net/gh/duggytuxy/Data-Shield_IPv4_Blocklist@main/prod_critical_data-shield_ipv4_blocklist.txt',
    ipsetName: 'data-shield-critical',
    description: 'DMZ, APIs, infrastructure sensible',
    maxelem: 150000,
  },
};
```

### Status file
- Path: `path.join(dataDir, 'blocklist-status.json')`
- Loaded from disk on construction; if missing, defaults to all lists with `enabled: false, count: 0, lastUpdate: null, error: null, updating: false`
- Written after every state change
- On startup: reset all `updating: true` → `false` (crash recovery)

### `refresh(id)` implementation

1. Validate id is in LISTS, else return error
2. Set `updating: true`, save
3. Download via Node `https.get()` with 30s timeout. Follow one redirect (jsDelivr → CDN). Collect response body as string.
4. Parse: split on newlines, filter to valid IPv4 regex `/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/`
5. Build ipset restore script in memory:
   ```
   create data-shield-prod-new hash:ip family inet hashsize 32768 maxelem 150000
   add data-shield-prod-new 1.2.3.4
   add data-shield-prod-new ...
   ```
6. Execute ipset commands:
   a. Ensure main set exists: `ipset create {ipsetName} hash:ip maxelem 150000 2>/dev/null || true` — use `execFile('ipset', ['create', name, 'hash:ip', 'maxelem', '150000'], {})` wrapped in try/catch (already-exists error is ok)
   b. Destroy old temp: `execFile('ipset', ['destroy', `${ipsetName}-new`])` — ignore error
   c. Write restore script to a temp file in os.tmpdir()
   d. `execFile('ipset', ['restore', '-f', tmpFile])` with 60s timeout, maxBuffer 16MB
   e. `execFile('ipset', ['swap', `${ipsetName}-new`, ipsetName])`
   f. `execFile('ipset', ['destroy', `${ipsetName}-new`])` — ignore error
   g. Delete temp file
7. Update status: `updating: false, lastUpdate: new Date().toISOString(), count, error: null`
8. Return `{ ok: true, count }`
9. On any error: set `updating: false, error: message`, save, return `{ ok: false, error: message }`

**NOTE:** Use `priv()` helper (same pattern as IptablesService) when not running as root:
```typescript
function priv(cmd: string, args: string[]): [string, string[]] {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  return isRoot ? [cmd, args] : ['sudo', ['-n', cmd, ...args]];
}
```
Apply to all `ipset` and `iptables` calls.

### `enable(id)` implementation

1. Validate id
2. If `count === 0` (never loaded), call `refresh(id)` first; return error if refresh fails
3. Check if iptables rule already exists: `iptables -C INPUT -m set --match-set {ipsetName} src -j DROP` — if exit 0 it exists, skip; if error, add it
4. Add iptables rule: `iptables -I INPUT -m set --match-set {ipsetName} src -j DROP`
5. Set `enabled: true`, save, return `{ ok: true }`

### `disable(id)` implementation

1. Validate id
2. Remove iptables rule (ignore error if not present): `iptables -D INPUT -m set --match-set {ipsetName} src -j DROP`
3. Set `enabled: false`, save, return `{ ok: true }`

### `startAutoRefresh()`

`setInterval` every 6 hours (6 * 60 * 60 * 1000). For each list where `enabled === true`, call `refresh(id)`. Log result.

**Imports needed:**
```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../../utils/logger.js';
```

---

## Task 2 — Routes in Fail2banPlugin.ts

**File:** `server/plugins/fail2ban/Fail2banPlugin.ts`

### Instantiation

At the top of `Fail2banPlugin` class, add:
```typescript
private blocklistService: BlocklistService | null = null;
```

In `initializePlugin()` or `setupRoutes()` method (wherever the plugin is initialized — look for where `this.client = new Fail2banClientExec()` is called), add:
```typescript
import { BlocklistService } from './BlocklistService.js';
// ...
const dataDir = path.join(process.cwd(), 'data');
this.blocklistService = new BlocklistService(dataDir);
this.blocklistService.startAutoRefresh();
```

### Routes (add before the `/nftables` route, around line 2933)

```typescript
// GET /blocklists/status
router.get('/blocklists/status', requireAuth, asyncHandler(async (_req, res) => {
    const lists = this.blocklistService?.getStatus() ?? [];
    res.json({ success: true, result: { lists } });
}));

// POST /blocklists/refresh  { id: string }
router.post('/blocklists/refresh', requireAuth, asyncHandler(async (req, res) => {
    const { id } = req.body as { id?: string };
    if (!id) return res.json({ success: true, result: { ok: false, error: 'id manquant' } });
    const r = await this.blocklistService?.refresh(id) ?? { ok: false, error: 'service non initialisé' };
    res.json({ success: true, result: r });
}));

// POST /blocklists/toggle  { id: string, enabled: boolean }
router.post('/blocklists/toggle', requireAuth, asyncHandler(async (req, res) => {
    const { id, enabled } = req.body as { id?: string; enabled?: boolean };
    if (!id || enabled === undefined) return res.json({ success: true, result: { ok: false, error: 'Paramètres manquants' } });
    const r = enabled
        ? await this.blocklistService?.enable(id) ?? { ok: false, error: 'service non initialisé' }
        : await this.blocklistService?.disable(id) ?? { ok: false, error: 'service non initialisé' };
    res.json({ success: true, result: r });
}));
```

---

## Task 3 — TabBlocklists.tsx

**File:** `src/pages/fail2ban/TabBlocklists.tsx`

Use **inline styles only** (no Tailwind). Follow the exact same color palette and pattern as TabIPSet.tsx.

### Visual layout

```
┌─────────────────────────────────────────────────────────┐
│ 🛡 Blocklists IP  (2 sources)                            │
│ Listes IPv4 malveillantes synchronisées automatiquement  │
├─────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [shield icon] Data-Shield Prod       [●ACTIF toggle]│ │
│ │ Web apps, WordPress, Nginx/Apache                   │ │
│ │ 95 432 IPs  •  Mis à jour il y a 2h                │ │
│ │ jsDelivr CDN                                       │ │
│ │ [🔄 Rafraîchir]                                    │ │
│ └─────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ [shield icon] Data-Shield Critical   [○INACTIF tog] │ │
│ │ DMZ, APIs, infrastructure sensible                  │ │
│ │ Non chargée                                        │ │
│ │ [🔄 Rafraîchir]                                    │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                         │
│ ⓘ Note: Les règles iptables sont ajoutées sur INPUT     │
│   (trafic entrant uniquement). Redémarrage = regénéré.  │
└─────────────────────────────────────────────────────────┘
```

### State
```typescript
interface ListState {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  lastUpdate: string | null;
  count: number;
  error: string | null;
  updating: boolean;
}

const [lists, setLists] = useState<ListState[]>([]);
const [loading, setLoading] = useState(true);
```

### API calls (using `api` from `../../api/client`)
- `GET /api/plugins/fail2ban/blocklists/status` → `{ success, result: { lists } }`
- `POST /api/plugins/fail2ban/blocklists/refresh` body `{ id }` → `{ success, result: { ok, count?, error? } }`
- `POST /api/plugins/fail2ban/blocklists/toggle` body `{ id, enabled }` → `{ success, result: { ok } }`

### Toggle behavior
- Clicking toggle → set local `updating: true` on that item → POST toggle → re-fetch status
- Show spinner in toggle area while updating
- Show error in red below description if `error !== null`

### Colors
- Enabled badge/toggle: `#3fb950` (green, same as filters tab)
- Disabled: `#555d69` (muted gray)
- Card header border-left accent: `#e86a65` (red, matches ban tab — blocklist is security-related)
- Shield icon color: `#e86a65`
- Refresh button: `background: rgba(88,166,255,.1), border: 1px solid rgba(88,166,255,.3), color: #58a6ff`
- Error text: `#f85149`

### Refresh button behavior
- Click → POST refresh → set `updating: true` locally → refresh status after done
- Show spinner icon while updating
- Disable button while `updating === true`

### Note at bottom
Small info box explaining iptables INPUT rule + recommending a cron for auto-update:
```
💡 Mise à jour automatique : ajoutez un cron sur la machine hôte ou laissez LogviewR 
   rafraîchir automatiquement toutes les 6h tant qu'une liste est activée.
   Les règles iptables sont recréées au prochain rafraîchissement si elles disparaissent.
```

---

## Task 4 — Integration: types, Fail2banPage, i18n

### 4a. `src/pages/fail2ban/types.ts`

Add `'blocklists'` to the TabId type:
```typescript
export type TabId =
    | 'jails' | 'filtres' | 'actions' | 'tracker' | 'ban' | 'stats' | 'carte'
    | 'iptables' | 'ipset' | 'nftables' | 'blocklists' | 'config' | 'audit' | 'aide' | 'backup';
```

### 4b. `src/pages/Fail2banPage.tsx`

1. Add import: `import { TabBlocklists } from './fail2ban/TabBlocklists';`
2. Add import for icon: `Shield` from lucide-react (check if already imported — it is, at line ~10)
3. Add tab to NAV_GROUPS in the `firewall` group (after `nftables`):
   ```typescript
   { id: 'blocklists' as TabId, labelKey: 'fail2ban.tabs.blocklists', icon: Shield, color: '#e86a65' },
   ```
4. Add render in the tab content area (after `{tab === 'nftables' && <TabNFTables />}`):
   ```typescript
   {tab === 'blocklists' && <TabBlocklists />}
   ```

### 4c. i18n keys

**`src/locales/en.json`** — add under `fail2ban.tabs`:
```json
"blocklists": "Blocklists"
```

**`src/locales/fr.json`** — add under `fail2ban.tabs`:
```json
"blocklists": "Blocklists"
```

---

## Verification

After all tasks, run in worktree:
```bash
npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

Then check the output:
```bash
grep "BlocklistService\|TabBlocklists\|blocklists" src/pages/Fail2banPage.tsx
grep "'blocklists'" src/pages/fail2ban/types.ts
grep "blocklists" src/locales/en.json src/locales/fr.json
```
