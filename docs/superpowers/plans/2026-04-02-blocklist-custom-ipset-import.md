# Custom Blocklists + IPSet File Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to add custom URL-based blocklists alongside the built-in Data-Shield lists, and import IPv4 files into existing ipsets.

**Architecture:** `BlocklistService` gains a separate `data/blocklist-custom.json` for user-defined list definitions; all methods switch from the hardcoded `LISTS` constant to a `_allLists()` helper that merges built-in + custom. The ipset import is a new route in `Fail2banPlugin.ts` that loops `this.client.ipsetAdd()`.

**Tech Stack:** TypeScript, Node.js, Express, ipset/iptables (via `Fail2banClientExec`), React inline-styles.

---

## File Map

| File | Change |
|------|--------|
| `server/plugins/fail2ban/BlocklistService.ts` | Add `CustomListDef` type, `builtin` on `BlocklistStatus`, `_customDefs` map, `_allLists()`, `_loadCustomDefs()`, `_saveCustomDefs()`, `addCustomList()`, `removeCustomList()`. Replace all `LISTS[x]` / `Object.entries(LISTS)` with `_allLists()`. |
| `server/plugins/fail2ban/Fail2banPlugin.ts` | Add routes `POST /blocklists/add`, `DELETE /blocklists/remove/:id`, `POST /ipset/import`. |
| `src/pages/fail2ban/TabBlocklists.tsx` | Add `builtin` to `ListState`, add form state + UI, add delete button on custom cards. |
| `src/pages/fail2ban/TabIPSet.tsx` | Add file import button + handler. |

---

## Task 1: BlocklistService — dynamic list registry

**Files:**
- Modify: `server/plugins/fail2ban/BlocklistService.ts`

### Step 1.1 — Add `CustomListDef` interface and `builtin` to `BlocklistStatus`

Replace the existing `BlocklistStatus` interface and add `CustomListDef` right after the `LISTS` constant (around line 40):

```typescript
export interface CustomListDef {
    id: string;         // = ipsetName (user-supplied, unique)
    name: string;
    url: string;
    ipsetName: string;
    description: string;
    maxelem: number;
}

export interface BlocklistStatus {
    id: string;
    name: string;
    description: string;
    enabled: boolean;
    lastUpdate: string | null;
    count: number;
    error: string | null;
    updating: boolean;
    builtin: boolean;   // true for LISTS entries, false for user-added
}
```

### Step 1.2 — Add `_customDefsFile` and `_customDefs` fields, update constructor

Replace the class field declarations and constructor:

```typescript
export class BlocklistService {
    private _statusFile: string;
    private _customDefsFile: string;
    private _status: Map<string, BlocklistStatus>;
    private _customDefs: Map<string, CustomListDef>;
    private _refreshTimer: ReturnType<typeof setInterval> | null = null;
    private _refreshInProgress: Set<string> = new Set();

    constructor(dataDir: string) {
        this._statusFile = path.join(dataDir, 'blocklist-status.json');
        this._customDefsFile = path.join(dataDir, 'blocklist-custom.json');
        this._status = new Map();
        this._customDefs = new Map();
        this._loadCustomDefs();   // must run before _loadStatus
        this._loadStatus();
    }
```

### Step 1.3 — Add `_allLists()` helper and stub `_loadCustomDefs` / `_saveCustomDefs`

Add these three methods in the `// ── Persistence` section, right after the constructor:

```typescript
// ── Dynamic list registry ─────────────────────────────────────────────────

private _allLists(): Record<string, { name: string; url: string; ipsetName: string; description: string; maxelem: number }> {
    const custom: Record<string, { name: string; url: string; ipsetName: string; description: string; maxelem: number }> = {};
    for (const [id, def] of this._customDefs.entries()) {
        custom[id] = { name: def.name, url: def.url, ipsetName: def.ipsetName, description: def.description, maxelem: def.maxelem };
    }
    return { ...LISTS, ...custom };
}

private _loadCustomDefs(): void {
    try {
        const raw = fs.readFileSync(this._customDefsFile, 'utf8');
        const defs = JSON.parse(raw) as CustomListDef[];
        for (const def of defs) {
            this._customDefs.set(def.id, def);
        }
    } catch {
        // File absent or invalid — no custom lists
    }
}

private _saveCustomDefs(): void {
    try {
        const arr = Array.from(this._customDefs.values());
        fs.writeFileSync(this._customDefsFile, JSON.stringify(arr, null, 2), 'utf8');
    } catch (err: unknown) {
        logger.error('BlocklistService', `Failed to save custom defs: ${err instanceof Error ? err.message : String(err)}`);
    }
}
```

### Step 1.4 — Update `_loadStatus()` to use `_allLists()` and set `builtin`

Change this line in `_loadStatus()`:
```typescript
// BEFORE:
for (const [id, list] of Object.entries(LISTS)) {

// AFTER:
for (const [id, list] of Object.entries(this._allLists())) {
```

And add `builtin` to the entry object inside that loop:
```typescript
const entry: BlocklistStatus = {
    id,
    name: list.name,
    description: list.description,
    enabled: saved?.enabled ?? false,
    lastUpdate: saved?.lastUpdate ?? null,
    count: saved?.count ?? 0,
    error: saved?.error ?? null,
    updating: false,
    builtin: id in LISTS,
};
```

### Step 1.5 — Replace `LISTS[id]` with `this._allLists()[id]` in all methods

Apply these four changes (exact string replacements):

In `refresh()` (around line 169):
```typescript
// BEFORE:
const list = LISTS[id];
if (!list) {
    return { ok: false, error: `Liste inconnue: ${id}` };
}
// AFTER:
const list = this._allLists()[id];
if (!list) {
    return { ok: false, error: `Liste inconnue: ${id}` };
}
```

In `enable()` (around line 288):
```typescript
// BEFORE:
const list = LISTS[id];
if (!list) {
    return { ok: false, error: `Liste inconnue: ${id}` };
}
// AFTER:
const list = this._allLists()[id];
if (!list) {
    return { ok: false, error: `Liste inconnue: ${id}` };
}
```

In `disable()` (around line 328):
```typescript
// BEFORE:
const list = LISTS[id];
if (!list) {
    return { ok: false, error: `Liste inconnue: ${id}` };
}
// AFTER:
const list = this._allLists()[id];
if (!list) {
    return { ok: false, error: `Liste inconnue: ${id}` };
}
```

In `restoreOnStartup()` (recently added, references `LISTS[id]` and `list.ipsetName`):
```typescript
// BEFORE:
const list = LISTS[id];
if (!list) continue;
// AFTER:
const list = this._allLists()[id];
if (!list) continue;
```

In `startAutoRefresh()` (two occurrences — one `const list = LISTS[id];` and one `if (list) {`):
```typescript
// BEFORE:
const list = LISTS[id];
if (list) {
// AFTER:
const list = this._allLists()[id];
if (list) {
```

### Step 1.6 — TypeScript check

```bash
npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

### Step 1.7 — Commit

```bash
git add server/plugins/fail2ban/BlocklistService.ts
git commit -m "refactor: BlocklistService — dynamic list registry via _allLists()"
```

---

## Task 2: BlocklistService — addCustomList and removeCustomList

**Files:**
- Modify: `server/plugins/fail2ban/BlocklistService.ts`

### Step 2.1 — Add `addCustomList()` method

Add after `getStatus()` in the `// ── Public API` section:

```typescript
addCustomList(def: { name: string; url: string; ipsetName: string; description?: string; maxelem?: number }): { ok: boolean; error?: string } {
    const name = def.name.trim();
    const url = def.url.trim();
    const ipsetName = def.ipsetName.trim();
    const description = def.description?.trim() ?? '';
    const maxelem = def.maxelem ?? 150000;

    if (!name) return { ok: false, error: 'Le nom est requis' };
    if (!url || !url.startsWith('http')) return { ok: false, error: 'URL invalide (doit commencer par http)' };
    if (!ipsetName) return { ok: false, error: 'Le nom d\'ipset est requis' };
    if (!/^[a-z0-9][a-z0-9-]*$/.test(ipsetName)) {
        return { ok: false, error: 'Nom d\'ipset invalide: lettres minuscules, chiffres et tirets uniquement' };
    }

    const existing = this._allLists();
    if (ipsetName in existing) {
        return { ok: false, error: `Le nom d'ipset "${ipsetName}" est déjà utilisé` };
    }

    const id = ipsetName;
    const newDef: CustomListDef = { id, name, url, ipsetName, description, maxelem };
    this._customDefs.set(id, newDef);
    this._saveCustomDefs();

    this._status.set(id, {
        id, name, description,
        enabled: false, lastUpdate: null, count: 0, error: null, updating: false,
        builtin: false,
    });
    this._saveStatus();

    logger.info('BlocklistService', `Custom list added: ${id} (${url})`);
    return { ok: true };
}
```

### Step 2.2 — Add `removeCustomList()` method

Add right after `addCustomList()`:

```typescript
async removeCustomList(id: string): Promise<{ ok: boolean; error?: string }> {
    if (id in LISTS) {
        return { ok: false, error: 'Les listes intégrées ne peuvent pas être supprimées' };
    }
    const def = this._customDefs.get(id);
    if (!def) {
        return { ok: false, error: `Liste inconnue: ${id}` };
    }

    // Disable first (removes iptables rule — errors are silently swallowed in disable())
    await this.disable(id);

    // Destroy ipset kernel object (ignore if already absent)
    try {
        const [c, a] = priv('ipset', ['destroy', def.ipsetName]);
        await execFileAsync(c, a, { timeout: 10_000 });
    } catch { /* ignore */ }

    this._customDefs.delete(id);
    this._saveCustomDefs();
    this._status.delete(id);
    this._saveStatus();

    logger.info('BlocklistService', `Custom list removed: ${id}`);
    return { ok: true };
}
```

### Step 2.3 — TypeScript check

```bash
npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

### Step 2.4 — Commit

```bash
git add server/plugins/fail2ban/BlocklistService.ts
git commit -m "feat: BlocklistService — addCustomList() and removeCustomList()"
```

---

## Task 3: Fail2banPlugin — blocklist add/remove routes

**Files:**
- Modify: `server/plugins/fail2ban/Fail2banPlugin.ts`

### Step 3.1 — Add routes after the existing `/blocklists/toggle` route (after line 2981)

```typescript
        // POST /blocklists/add  { name, url, ipsetName, description?, maxelem? }
        router.post('/blocklists/add', requireAuth, asyncHandler(async (req, res) => {
            const { name, url, ipsetName, description, maxelem } = req.body as {
                name?: string; url?: string; ipsetName?: string; description?: string; maxelem?: number;
            };
            if (!name || !url || !ipsetName) {
                return res.json({ success: true, result: { ok: false, error: 'name, url et ipsetName sont requis' } });
            }
            const r = this.blocklistService?.addCustomList({ name, url, ipsetName, description, maxelem })
                ?? { ok: false, error: 'service non initialisé' };
            res.json({ success: true, result: r });
        }));

        // DELETE /blocklists/remove/:id
        router.delete('/blocklists/remove/:id', requireAuth, asyncHandler(async (req, res) => {
            const { id } = req.params as { id: string };
            if (!id) return res.json({ success: true, result: { ok: false, error: 'id manquant' } });
            const r = await this.blocklistService?.removeCustomList(id)
                ?? { ok: false, error: 'service non initialisé' };
            res.json({ success: true, result: r });
        }));
```

### Step 3.2 — TypeScript check

```bash
npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

### Step 3.3 — Commit

```bash
git add server/plugins/fail2ban/Fail2banPlugin.ts
git commit -m "feat: routes POST /blocklists/add and DELETE /blocklists/remove/:id"
```

---

## Task 4: Fail2banPlugin — ipset bulk import route

**Files:**
- Modify: `server/plugins/fail2ban/Fail2banPlugin.ts`

### Step 4.1 — Add route after the existing `/ipset/add` route (after line 2875)

```typescript
        // POST /ipset/import  { set: string, ips: string[] }
        // Bulk-adds pre-parsed IPv4 addresses to an existing ipset.
        router.post('/ipset/import', requireAuth, asyncHandler(async (req, res) => {
            if (!this.isEnabled()) return res.json({ success: true, result: { ok: false, error: 'Plugin désactivé' } });
            const { set, ips } = req.body as { set?: string; ips?: string[] };
            if (!set || !Array.isArray(ips) || ips.length === 0) {
                return res.json({ success: true, result: { ok: false, error: 'set et ips[] requis' } });
            }

            const safeSet = set.replace(/[^a-zA-Z0-9_.-]/g, '');
            if (!safeSet) return res.json({ success: true, result: { ok: false, error: 'Nom de set invalide' } });

            // Validate ipset exists before attempting to add
            const listCheck = await this.client?.ipsetEntries(safeSet)
                ?? { ok: false, entries: [], error: 'client not initialized' };
            if (!listCheck.ok) {
                return res.json({ success: true, result: { ok: false, error: `Set "${safeSet}" introuvable` } });
            }

            // Server-side IPv4 validation (client already filters, but re-validate for safety)
            const ipv4Re = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
            const valid = ips.map(ip => ip.trim()).filter(ip => ipv4Re.test(ip));
            const skipped = ips.length - valid.length;

            let added = 0;
            const errors: string[] = [];

            for (const ip of valid) {
                const r = await this.client?.ipsetAdd(safeSet, ip)
                    ?? { ok: false, output: '', error: 'client not initialized' };
                if (r.ok) {
                    added++;
                } else if (r.error?.includes('already added') || r.error?.includes('Element cannot be added')) {
                    // Duplicate — count as skipped, not error
                    // skipped is already set from invalid IPs; treat duplicates separately
                } else if (r.error) {
                    errors.push(`${ip}: ${r.error}`);
                }
            }

            res.json({ success: true, result: { ok: true, added, skipped, errors } });
        }));
```

### Step 4.2 — Check if `ipsetEntries` exists on the client

```bash
grep -n "ipsetEntries\|ipsetList\b" server/plugins/fail2ban/Fail2banClientExec.ts
```

If `ipsetEntries` doesn't exist, use `ipsetList()` which returns the full raw output. In that case replace the set existence check with:

```typescript
const listCheck = await this.client?.ipsetList()
    ?? { ok: false, output: '', error: 'client not initialized' };
if (!listCheck.ok) {
    return res.json({ success: true, result: { ok: false, error: `Impossible de vérifier le set` } });
}
// Verify the named set is present in the output
if (!listCheck.output.includes(`Name: ${safeSet}`)) {
    return res.json({ success: true, result: { ok: false, error: `Set "${safeSet}" introuvable` } });
}
```

### Step 4.3 — TypeScript check

```bash
npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`. If errors, run `npx tsc 2>&1 | grep "error TS"` to see details.

### Step 4.4 — Commit

```bash
git add server/plugins/fail2ban/Fail2banPlugin.ts
git commit -m "feat: route POST /ipset/import — bulk IPv4 add from file"
```

---

## Task 5: TabBlocklists — add form + delete button

**Files:**
- Modify: `src/pages/fail2ban/TabBlocklists.tsx`

### Step 5.1 — Update `ListState` and add form state

Replace the `ListState` interface and update the component's state:

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
  builtin: boolean;
}
```

Add these state variables inside `TabBlocklists`:

```typescript
const [showAddForm, setShowAddForm] = useState(false);
const [adding, setAdding] = useState(false);
const [addError, setAddError] = useState<string | null>(null);
const [newName, setNewName] = useState('');
const [newUrl, setNewUrl] = useState('');
const [newIpset, setNewIpset] = useState('');
const [newDesc, setNewDesc] = useState('');
```

### Step 5.2 — Add `handleAdd` and `handleRemove` handlers

Add after `handleRefresh`:

```typescript
const handleAdd = async () => {
  // Inline ipset name uniqueness check
  if (lists.some(l => l.id === newIpset)) {
    setAddError(`Le nom d'ipset "${newIpset}" est déjà utilisé`);
    return;
  }
  setAdding(true);
  setAddError(null);
  try {
    const res = await api.post<{ ok: boolean; error?: string }>(
      '/api/plugins/fail2ban/blocklists/add',
      { name: newName, url: newUrl, ipsetName: newIpset, description: newDesc }
    );
    if (res.result?.ok) {
      setShowAddForm(false);
      setNewName(''); setNewUrl(''); setNewIpset(''); setNewDesc('');
      await fetchStatus();
    } else {
      setAddError(res.result?.error ?? 'Erreur inconnue');
    }
  } finally {
    setAdding(false);
  }
};

const handleRemove = async (id: string) => {
  try {
    await api.delete<{ ok: boolean }>(`/api/plugins/fail2ban/blocklists/remove/${id}`);
  } finally {
    await fetchStatus();
  }
};
```

### Step 5.3 — Add `api.delete` if not present

Check if the api client has a `delete` method:

```bash
grep -n "delete\b" src/api/client.ts | head -10
```

If absent, add to `src/api/client.ts` following the same pattern as `api.post`:

```typescript
delete: async <T>(url: string): Promise<ApiResponse<T>> => {
  const response = await fetch(url, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  return handleResponse<T>(response);
},
```

### Step 5.4 — Update card rendering: builtin border color and delete button

In the card `<div>`, change the `borderLeft` to use the `builtin` flag:

```typescript
borderLeft: `4px solid ${list.builtin ? '#e86a65' : '#58a6ff'}`,
```

Add the delete button inside the card header div (after the toggle button), shown only for custom lists:

```typescript
{!list.builtin && (
  <button
    onClick={() => handleRemove(list.id)}
    disabled={list.updating}
    title="Supprimer cette liste"
    style={{
      background: 'rgba(248,81,73,.1)',
      border: '1px solid rgba(248,81,73,.3)',
      color: '#f85149',
      borderRadius: 4,
      padding: '.2rem .5rem',
      fontSize: '.75rem',
      cursor: 'pointer',
      lineHeight: 1,
    }}
  >
    ✕
  </button>
)}
```

### Step 5.5 — Add the "+ Ajouter une liste" button and form

Add at the bottom, before the `// ── Info note ──` section:

```tsx
{/* ── Add custom list ── */}
{!showAddForm ? (
  <button
    onClick={() => setShowAddForm(true)}
    style={{
      display: 'flex', alignItems: 'center', gap: '.4rem',
      background: 'rgba(88,166,255,.08)', border: '1px dashed rgba(88,166,255,.3)',
      color: '#58a6ff', borderRadius: 6, padding: '.5rem 1rem',
      fontSize: '.82rem', cursor: 'pointer', width: '100%', justifyContent: 'center',
      marginBottom: '.75rem',
    }}
  >
    + Ajouter une liste
  </button>
) : (
  <div style={{
    background: '#161b22', border: '1px solid rgba(88,166,255,.3)',
    borderLeft: '4px solid #58a6ff', borderRadius: 6,
    padding: '1rem', marginBottom: '.75rem',
  }}>
    <div style={{ fontWeight: 600, color: '#e6edf3', marginBottom: '.75rem', fontSize: '.9rem' }}>
      Nouvelle liste personnalisée
    </div>

    {/* Name */}
    <div style={{ marginBottom: '.5rem' }}>
      <label style={{ display: 'block', fontSize: '.78rem', color: '#8b949e', marginBottom: '.2rem' }}>Nom *</label>
      <input value={newName} onChange={e => setNewName(e.target.value)}
        placeholder="Ex: Spamhaus DROP"
        style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: '.3rem .5rem', color: '#e6edf3', fontSize: '.85rem', boxSizing: 'border-box' }} />
    </div>

    {/* URL */}
    <div style={{ marginBottom: '.5rem' }}>
      <label style={{ display: 'block', fontSize: '.78rem', color: '#8b949e', marginBottom: '.2rem' }}>URL *</label>
      <input value={newUrl} onChange={e => setNewUrl(e.target.value)}
        placeholder="https://..."
        style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: '.3rem .5rem', color: '#e6edf3', fontSize: '.85rem', boxSizing: 'border-box' }} />
    </div>

    {/* ipset name */}
    <div style={{ marginBottom: '.5rem' }}>
      <label style={{ display: 'block', fontSize: '.78rem', color: '#8b949e', marginBottom: '.2rem' }}>Nom d'ipset * <span style={{ color: '#555d69' }}>(lettres minuscules, chiffres, tirets)</span></label>
      <input value={newIpset} onChange={e => { setNewIpset(e.target.value); setAddError(null); }}
        placeholder="Ex: spamhaus-drop"
        style={{
          width: '100%', background: '#0d1117',
          border: `1px solid ${lists.some(l => l.id === newIpset) && newIpset ? '#f85149' : '#30363d'}`,
          borderRadius: 4, padding: '.3rem .5rem', color: '#e6edf3', fontSize: '.85rem', boxSizing: 'border-box',
        }} />
      {lists.some(l => l.id === newIpset) && newIpset && (
        <div style={{ color: '#f85149', fontSize: '.75rem', marginTop: '.2rem' }}>Nom déjà utilisé</div>
      )}
    </div>

    {/* Description */}
    <div style={{ marginBottom: '.75rem' }}>
      <label style={{ display: 'block', fontSize: '.78rem', color: '#8b949e', marginBottom: '.2rem' }}>Description</label>
      <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
        placeholder="Optionnel"
        style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: '.3rem .5rem', color: '#e6edf3', fontSize: '.85rem', boxSizing: 'border-box' }} />
    </div>

    {addError && (
      <div style={{ color: '#f85149', fontSize: '.78rem', marginBottom: '.5rem', padding: '.3rem .5rem', background: 'rgba(248,81,73,.1)', borderRadius: 4, border: '1px solid rgba(248,81,73,.2)' }}>
        ⚠ {addError}
      </div>
    )}

    <div style={{ display: 'flex', gap: '.5rem' }}>
      <button
        onClick={handleAdd}
        disabled={adding || !newName.trim() || !newUrl.trim() || !newIpset.trim() || lists.some(l => l.id === newIpset)}
        style={{
          background: 'rgba(88,166,255,.15)', border: '1px solid rgba(88,166,255,.4)',
          color: '#58a6ff', borderRadius: 4, padding: '.3rem .85rem',
          fontSize: '.82rem', cursor: 'pointer', opacity: adding ? 0.6 : 1,
        }}
      >
        {adding ? 'Ajout…' : 'Ajouter'}
      </button>
      <button
        onClick={() => { setShowAddForm(false); setAddError(null); setNewName(''); setNewUrl(''); setNewIpset(''); setNewDesc(''); }}
        style={{
          background: 'transparent', border: '1px solid #30363d',
          color: '#8b949e', borderRadius: 4, padding: '.3rem .75rem',
          fontSize: '.82rem', cursor: 'pointer',
        }}
      >
        Annuler
      </button>
    </div>
  </div>
)}
```

### Step 5.6 — TypeScript check

```bash
npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

### Step 5.7 — Commit

```bash
git add src/pages/fail2ban/TabBlocklists.tsx src/api/client.ts
git commit -m "feat: TabBlocklists — custom list add form + delete button"
```

---

## Task 6: TabIPSet — file import UI

**Files:**
- Modify: `src/pages/fail2ban/TabIPSet.tsx`

### Step 6.1 — Locate the add-IP section

```bash
grep -n "Ajouter\|handleAdd\|ipset/add\|useState" src/pages/fail2ban/TabIPSet.tsx | head -20
```

Identify the line number where the "add IP" button/input area is rendered. The import button will be placed next to it.

### Step 6.2 — Add import state variables inside `TabIPSet`

Find the existing `useState` declarations block and add:

```typescript
const fileInputRef = React.useRef<HTMLInputElement>(null);
const [importing, setImporting] = useState(false);
const [importResult, setImportResult] = useState<{ added: number; skipped: number } | null>(null);
```

### Step 6.3 — Add `handleImport` handler

Add after the existing ipset add handler:

```typescript
const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file || !selectedSet) return;  // selectedSet = the currently active ipset name; adjust variable name to match existing code

  setImporting(true);
  setImportResult(null);
  try {
    const text = await file.text();
    const ipv4Re = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
    const ips = text.split('\n').map(l => l.trim()).filter(l => ipv4Re.test(l));

    const res = await api.post<{ ok: boolean; added: number; skipped: number; errors: string[] }>(
      '/api/plugins/fail2ban/ipset/import',
      { set: selectedSet, ips }
    );
    if (res.result?.ok) {
      setImportResult({ added: res.result.added, skipped: res.result.skipped });
    }
  } finally {
    setImporting(false);
    // Reset file input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }
};
```

> **Note:** Replace `selectedSet` with the actual variable name holding the current ipset — check the existing `useState` for the selected set name in this component.

### Step 6.4 — Add import button and feedback to the UI

In the add-IP section of the JSX, add next to the existing add button:

```tsx
{/* Hidden file input */}
<input
  ref={fileInputRef}
  type="file"
  accept=".txt"
  style={{ display: 'none' }}
  onChange={handleImport}
/>

{/* Import button */}
<button
  onClick={() => fileInputRef.current?.click()}
  disabled={importing || !selectedSet}
  style={{
    background: 'rgba(88,166,255,.1)', border: '1px solid rgba(88,166,255,.3)',
    color: importing ? '#555d69' : '#58a6ff',
    borderRadius: 4, padding: '.3rem .75rem',
    fontSize: '.8rem', cursor: importing || !selectedSet ? 'default' : 'pointer',
    display: 'flex', alignItems: 'center', gap: '.35rem',
  }}
>
  {importing ? '⟳ Import…' : '↑ Importer .txt'}
</button>

{/* Result feedback */}
{importResult && (
  <span style={{ fontSize: '.78rem', color: '#3fb950', marginLeft: '.5rem' }}>
    ✓ {importResult.added} ajoutées
    {importResult.skipped > 0 && `, ${importResult.skipped} ignorées`}
  </span>
)}
```

### Step 6.5 — TypeScript check

```bash
npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

### Step 6.6 — Commit

```bash
git add src/pages/fail2ban/TabIPSet.tsx
git commit -m "feat: TabIPSet — bulk import from .txt file"
```

---

## Self-review checklist

- [x] Custom list add: name, url, ipsetName, description fields — Task 5 ✓
- [x] ipsetName uniqueness check (frontend + backend) — Task 5.2 + Task 2.1 ✓
- [x] Custom list delete: auto-disable + ipset destroy — Task 2.2 ✓
- [x] Built-in lists unmodifiable/undeletable — Task 2.2 guard ✓
- [x] `builtin` flag on all cards, blue border for custom — Task 5.4 ✓
- [x] Auto-refresh + restoreOnStartup cover custom lists — Task 1.5 (LISTS → _allLists()) ✓
- [x] ipset import: .txt, one IP/line, feedback — Task 6 ✓
- [x] Server-side re-validation on import — Task 4.1 ✓
- [x] `api.delete()` method verified/added — Task 5.3 ✓
