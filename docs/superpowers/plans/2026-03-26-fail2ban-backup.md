# Fail2ban Backup Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Backup tab to the Fail2ban page with JSON export (all config files + runtime state) and restore (`.local` files only).

**Architecture:** Two new Express routes in `Fail2banPlugin.ts` handle export (streams JSON blob) and restore (validates, path-guards, writes `.local` files). A new `TabBackup.tsx` provides the 2-card UI: export via async fetch+blob, restore via FileReader preview then POST. The tab is wired into `Fail2banPage.tsx` under the Outils nav group.

**Tech Stack:** TypeScript, Express, React (inline styles + PHP hex palette), Node `fs`/`path`/`os`, `fail2ban-client` CLI via existing `Fail2banClientExec`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/pages/fail2ban/types.ts` | Modify line 61 | Add `'backup'` to `TabId` union |
| `server/plugins/fail2ban/Fail2banPlugin.ts` | Modify `getRoutes()` + add `import * as os` | Two new routes: GET backup/full, POST backup/restore |
| `src/pages/fail2ban/TabBackup.tsx` | **Create** | 2-card backup UI (export + restore) |
| `src/pages/Fail2banPage.tsx` | Modify imports + NAV_GROUPS + render block | Wire TabBackup into the page |

---

## Task 1: Add `'backup'` to `TabId`

**Files:**
- Modify: `src/pages/fail2ban/types.ts:59-61`

- [ ] **Step 1: Edit the union**

Open `src/pages/fail2ban/types.ts`. The current last line of the union is:

```ts
    | 'iptables' | 'ipset' | 'nftables' | 'config' | 'audit' | 'aide';
```

Change it to:

```ts
    | 'iptables' | 'ipset' | 'nftables' | 'config' | 'audit' | 'aide' | 'backup';
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 3: Commit**

```bash
git add src/pages/fail2ban/types.ts
git commit -m "feat(fail2ban): add 'backup' to TabId"
```

---

## Task 2: Backend — `GET /backup/full`

**Files:**
- Modify: `server/plugins/fail2ban/Fail2banPlugin.ts`

- [ ] **Step 1: Add `os` import**

At the top of `Fail2banPlugin.ts`, alongside the other `import *` lines (after `import * as path from 'path'`), add:

```ts
import * as os from 'os';
```

- [ ] **Step 2: Add the export route**

Inside `getRoutes()`, after all existing routes and before `return router;`, add:

```ts
// ── GET /backup/full ──────────────────────────────────────────────────────────
router.get('/backup/full', requireAuth, asyncHandler(async (_req, res) => {
    const confBase = this.resolveDockerPathSync('/etc/fail2ban');

    // Check config dir is accessible
    try { fs.accessSync(confBase); } catch {
        res.status(503).json({ success: false, error: `Config dir not accessible: ${confBase}` });
        return;
    }

    // Root-level files to include
    const ROOT_FILES = [
        'fail2ban.conf', 'fail2ban.local',
        'jail.conf', 'jail.local',
        'paths-common.conf', 'paths-debian.conf',
    ];

    // Subdirectories to read (non-recursive, direct children only)
    const SUB_DIRS = ['jail.d', 'filter.d', 'action.d'];

    const files: Record<string, string> = {};

    // Read root files (skip silently if missing)
    for (const name of ROOT_FILES) {
        const abs = path.join(confBase, name);
        try { files[`/etc/fail2ban/${name}`] = fs.readFileSync(abs, 'utf8'); } catch { /* skip */ }
    }

    // Read subdir files (non-recursive)
    for (const sub of SUB_DIRS) {
        const dir = path.join(confBase, sub);
        try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
                if (!e.isFile()) continue;
                const abs = path.join(dir, e.name);
                try { files[`/etc/fail2ban/${sub}/${e.name}`] = fs.readFileSync(abs, 'utf8'); } catch { /* skip */ }
            }
        } catch { /* dir missing — skip */ }
    }

    // Runtime state — best-effort, skip on any error
    const runtime: Record<string, unknown> = { total_banned: 0, jails: {} };
    try {
        const jailNames = await this.client.listJails();
        let totalBanned = 0;
        const jailsMap: Record<string, unknown> = {};
        for (const jail of jailNames) {
            const st = await this.client.getJailStatus(jail);
            if (st) {
                totalBanned += st.currentlyBanned;
                jailsMap[jail] = { currently_banned: st.currentlyBanned, banned_ips: st.bannedIps };
            }
        }
        runtime.total_banned = totalBanned;
        runtime.jails = jailsMap;
    } catch { /* best-effort */ }

    const payload = {
        version: 1,
        type: 'f2b_full_backup',
        exported_at: new Date().toISOString(),
        exported_by: 'LogviewR',
        host: os.hostname(),
        files,
        runtime,
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment');
    res.json(payload);
}));
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 4: Smoke-test the route (optional but recommended)**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/plugins/fail2ban/backup/full
```

Expected: `200` (or `401` if unauthenticated — that means the route is registered correctly).

- [ ] **Step 5: Commit**

```bash
git add server/plugins/fail2ban/Fail2banPlugin.ts
git commit -m "feat(fail2ban): GET /backup/full — export all config + runtime state"
```

---

## Task 3: Backend — `POST /backup/restore`

**Files:**
- Modify: `server/plugins/fail2ban/Fail2banPlugin.ts`

- [ ] **Step 1: Add the restore route**

Immediately after the export route (before `return router;`), add:

```ts
// ── POST /backup/restore ──────────────────────────────────────────────────────
router.post('/backup/restore', requireAuth, asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>;

    // Validate backup envelope
    if (body?.type !== 'f2b_full_backup' || body?.version !== 1) {
        res.status(400).json({ success: false, error: 'Invalid backup: type or version mismatch' });
        return;
    }

    const files = body.files as Record<string, string> | undefined;
    if (!files || typeof files !== 'object') {
        res.status(400).json({ success: false, error: 'Invalid backup: missing files map' });
        return;
    }

    const doReload = req.query['reload'] === '1';
    const confBase = this.resolveDockerPathSync('/etc/fail2ban');

    const written: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const [key, content] of Object.entries(files)) {
        // Security layer 1: no path traversal
        if (key.includes('..')) {
            errors.push(`${key}: path traversal rejected`);
            continue;
        }

        // Only restore .local files
        if (!key.endsWith('.local')) {
            skipped.push(key);
            continue;
        }

        // Derive the relative path under /etc/fail2ban/
        const rel = key.replace(/^\/etc\/fail2ban\//, '');
        const resolved = path.join(confBase, rel);

        // Security layer 2: resolved path must stay within confBase
        if (!resolved.startsWith(confBase + path.sep) && resolved !== confBase) {
            errors.push(`${key}: outside confBase, rejected`);
            continue;
        }

        try {
            const dir = path.dirname(resolved);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(resolved, content, 'utf8');
            written.push(key);
        } catch (err: unknown) {
            errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // ok = true if no write errors (reload failure does not affect ok)
    const ok = errors.length === 0;

    let reloadOk: boolean | undefined;
    let reloadOut: string | undefined;

    if (doReload) {
        try {
            const result = await this.client.reload();
            reloadOk = result.ok;
            reloadOut = result.output || result.error;
        } catch (err: unknown) {
            reloadOk = false;
            reloadOut = err instanceof Error ? err.message : String(err);
        }
    }

    res.json({ success: true, result: { ok, written, skipped, errors, ...(doReload ? { reloadOk, reloadOut } : {}) } });
}));
```

- [ ] **Step 2: Verify `reload()` exists in `Fail2banClientExec.ts`**

Check `server/plugins/fail2ban/Fail2banClientExec.ts` — `reload()` is already a public method at line 129. No changes needed to that file.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add server/plugins/fail2ban/Fail2banPlugin.ts server/plugins/fail2ban/Fail2banClientExec.ts
git commit -m "feat(fail2ban): POST /backup/restore — write .local files, optional reload"
```

---

## Task 4: Frontend — Create `TabBackup.tsx`

**Files:**
- Create: `src/pages/fail2ban/TabBackup.tsx`

- [ ] **Step 1: Create the file**

```tsx
import React, { useState, useRef } from 'react';
import { Archive, UploadCloud, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

// ── Design tokens (matches Fail2banPage.tsx inline palette) ──────────────────

const card: React.CSSProperties = {
    background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden',
};
const cardH: React.CSSProperties = {
    background: '#21262d', padding: '.65rem 1rem', borderBottom: '1px solid #30363d',
    display: 'flex', alignItems: 'center', gap: '.5rem',
};
const cardB: React.CSSProperties = { padding: '1rem' };

// ── Backup file shape (validated client-side) ─────────────────────────────────

interface BackupFile {
    version: number;
    type: string;
    exported_at: string;
    exported_by: string;
    host: string;
    files: Record<string, string>;
    runtime?: {
        total_banned?: number;
        jails?: Record<string, { currently_banned?: number; banned_ips?: string[] }>;
    };
}

function padZ(n: number) { return String(n).padStart(2, '0'); }
function nowStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${padZ(d.getMonth()+1)}-${padZ(d.getDate())}_${padZ(d.getHours())}${padZ(d.getMinutes())}${padZ(d.getSeconds())}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const TabBackup: React.FC = () => {
    // Export state
    const [exporting, setExporting] = useState(false);
    const [exportErr, setExportErr] = useState<string | null>(null);

    // Restore state
    const [backup, setBackup] = useState<BackupFile | null>(null);
    const [fileErr, setFileErr] = useState<string | null>(null);
    const [reload, setReload] = useState(true);
    const [restoring, setRestoring] = useState(false);
    const [restoreErr, setRestoreErr] = useState<string | null>(null);
    const [restoreResult, setRestoreResult] = useState<{
        ok: boolean; written: string[]; skipped: string[]; errors: string[];
        reloadOk?: boolean; reloadOut?: string;
    } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // ── Export ────────────────────────────────────────────────────────────────

    const handleExport = async () => {
        setExporting(true);
        setExportErr(null);
        try {
            const resp = await fetch('/api/plugins/fail2ban/backup/full', { credentials: 'include' });
            if (!resp.ok) {
                const txt = await resp.text();
                throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 200)}`);
            }
            const blob = await resp.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `fail2ban-backup-${nowStamp()}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err: unknown) {
            setExportErr(err instanceof Error ? err.message : String(err));
        } finally {
            setExporting(false);
        }
    };

    // ── Restore — file selection ───────────────────────────────────────────────

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setBackup(null);
        setFileErr(null);
        setRestoreResult(null);
        setRestoreErr(null);
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const d = JSON.parse(ev.target?.result as string) as BackupFile;
                if (d.type !== 'f2b_full_backup' || d.version !== 1) {
                    setFileErr('Fichier invalide — type ou version non reconnu');
                    return;
                }
                setBackup(d);
            } catch {
                setFileErr('Impossible de lire le fichier JSON');
            }
        };
        reader.readAsText(file);
    };

    // ── Restore — launch ──────────────────────────────────────────────────────

    const handleRestore = async () => {
        if (!backup) return;
        const localFiles = Object.keys(backup.files).filter(k => k.endsWith('.local'));
        if (!window.confirm(
            `Restaurer ${localFiles.length} fichier(s) .local depuis le backup du ${new Date(backup.exported_at).toLocaleString('fr-FR')} ?\n\nCette action écrase les fichiers existants.`
        )) return;

        setRestoring(true);
        setRestoreErr(null);
        setRestoreResult(null);
        try {
            const resp = await fetch(`/api/plugins/fail2ban/backup/restore?reload=${reload ? 1 : 0}`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backup),
            });
            const json = await resp.json() as { success: boolean; error?: string; result?: typeof restoreResult };
            if (!json.success) throw new Error(json.error ?? 'Erreur inconnue');
            setRestoreResult(json.result ?? null);
        } catch (err: unknown) {
            setRestoreErr(err instanceof Error ? err.message : String(err));
        } finally {
            setRestoring(false);
        }
    };

    // ── Derived preview values ─────────────────────────────────────────────────

    const totalFiles   = backup ? Object.keys(backup.files).length : 0;
    const localCount   = backup ? Object.keys(backup.files).filter(k => k.endsWith('.local')).length : 0;
    const jailNames    = backup?.runtime?.jails ? Object.keys(backup.runtime.jails) : [];

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: 700 }}>

            {/* ── Card 1: Export ── */}
            <div style={card}>
                <div style={cardH}>
                    <Archive style={{ width: 14, height: 14, color: '#58a6ff' }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Backup complet</span>
                    <span style={{ marginLeft: 'auto', fontSize: '.7rem', padding: '.1rem .5rem', borderRadius: 4, background: 'rgba(88,166,255,.15)', color: '#58a6ff', border: '1px solid rgba(88,166,255,.3)' }}>Export</span>
                </div>
                <div style={cardB}>
                    <ul style={{ margin: '0 0 1rem', padding: '0 0 0 1.2rem', fontSize: '.82rem', color: '#8b949e', lineHeight: 1.8 }}>
                        <li><code style={{ color: '#e6edf3' }}>fail2ban.conf</code> / <code style={{ color: '#e6edf3' }}>fail2ban.local</code></li>
                        <li><code style={{ color: '#e6edf3' }}>jail.conf</code> / <code style={{ color: '#e6edf3' }}>jail.local</code></li>
                        <li><code style={{ color: '#e6edf3' }}>jail.d/</code> — tous les fichiers</li>
                        <li><code style={{ color: '#e6edf3' }}>filter.d/</code> — tous les fichiers</li>
                        <li><code style={{ color: '#e6edf3' }}>action.d/</code> — tous les fichiers</li>
                        <li>État runtime (IPs bannies par jail)</li>
                    </ul>

                    {exportErr && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.5rem .75rem', background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.3)', borderRadius: 6, marginBottom: '.75rem', fontSize: '.82rem', color: '#e86a65' }}>
                            <XCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                            {exportErr}
                        </div>
                    )}

                    <button
                        onClick={() => { void handleExport(); }}
                        disabled={exporting}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                            padding: '.45rem 1rem', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                            background: exporting ? 'rgba(88,166,255,.1)' : 'rgba(88,166,255,.15)',
                            border: '1px solid rgba(88,166,255,.4)', color: '#58a6ff',
                            cursor: exporting ? 'not-allowed' : 'pointer', opacity: exporting ? .7 : 1,
                        }}
                    >
                        {exporting
                            ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(88,166,255,.3)', borderTopColor: '#58a6ff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} /> Préparation…</>
                            : <><Archive style={{ width: 13, height: 13 }} /> Télécharger le backup JSON</>
                        }
                    </button>
                </div>
            </div>

            {/* ── Card 2: Restore ── */}
            <div style={card}>
                <div style={cardH}>
                    <UploadCloud style={{ width: 14, height: 14, color: '#bc8cff' }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Restaurer un backup</span>
                    <span style={{ marginLeft: 'auto', fontSize: '.7rem', padding: '.1rem .5rem', borderRadius: 4, background: 'rgba(188,140,255,.15)', color: '#bc8cff', border: '1px solid rgba(188,140,255,.3)' }}>Restaurer</span>
                </div>
                <div style={cardB}>
                    {/* Warning banner */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', padding: '.5rem .75rem', background: 'rgba(227,179,65,.08)', border: '1px solid rgba(227,179,65,.25)', borderRadius: 6, marginBottom: '1rem', fontSize: '.8rem', color: '#e3b341' }}>
                        <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0, marginTop: 2 }} />
                        <span>Seuls les fichiers <code>.local</code> sont restaurés — les <code>.conf</code> système ne sont jamais écrasés.</span>
                    </div>

                    {/* File picker */}
                    <div style={{ marginBottom: '1rem' }}>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".json"
                            onChange={handleFileChange}
                            style={{ fontSize: '.82rem', color: '#e6edf3' }}
                        />
                    </div>

                    {/* File error */}
                    {fileErr && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.5rem .75rem', background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.3)', borderRadius: 6, marginBottom: '.75rem', fontSize: '.82rem', color: '#e86a65' }}>
                            <XCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                            {fileErr}
                        </div>
                    )}

                    {/* Preview panel */}
                    {backup && (
                        <div style={{ padding: '.65rem .85rem', background: 'rgba(63,185,80,.06)', border: '1px solid rgba(63,185,80,.25)', borderRadius: 6, marginBottom: '1rem', fontSize: '.82rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.4rem', color: '#3fb950', fontWeight: 600 }}>
                                <CheckCircle style={{ width: 13, height: 13 }} /> Backup valide
                            </div>
                            <div style={{ color: '#8b949e', lineHeight: 1.7 }}>
                                <div>Exporté le <span style={{ color: '#e6edf3' }}>{new Date(backup.exported_at).toLocaleString('fr-FR')}</span> depuis <code style={{ color: '#e6edf3' }}>{backup.host}</code></div>
                                <div><span style={{ color: '#e6edf3' }}>{totalFiles} fichier(s)</span> au total · <span style={{ color: '#58a6ff' }}>{localCount} fichier(s) .local</span> seront restaurés</div>
                                {jailNames.length > 0 && (
                                    <div>Jails : <span style={{ color: '#e6edf3' }}>{jailNames.join(', ')}</span></div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Reload checkbox */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.82rem', color: '#8b949e', marginBottom: '1rem', cursor: 'pointer' }}>
                        <input type="checkbox" checked={reload} onChange={e => setReload(e.target.checked)} />
                        Recharger Fail2ban après restauration (<code>fail2ban-client reload</code>)
                    </label>

                    {/* Restore error */}
                    {restoreErr && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.5rem .75rem', background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.3)', borderRadius: 6, marginBottom: '.75rem', fontSize: '.82rem', color: '#e86a65' }}>
                            <XCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                            {restoreErr}
                        </div>
                    )}

                    {/* Launch button */}
                    <button
                        onClick={() => { void handleRestore(); }}
                        disabled={!backup || restoring}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: '.4rem',
                            padding: '.45rem 1rem', borderRadius: 6, fontSize: '.82rem', fontWeight: 600,
                            background: (!backup || restoring) ? 'rgba(188,140,255,.05)' : 'rgba(188,140,255,.15)',
                            border: '1px solid rgba(188,140,255,.4)', color: '#bc8cff',
                            cursor: (!backup || restoring) ? 'not-allowed' : 'pointer',
                            opacity: (!backup || restoring) ? .5 : 1,
                        }}
                    >
                        {restoring
                            ? <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid rgba(188,140,255,.3)', borderTopColor: '#bc8cff', borderRadius: '50%', animation: 'spin .7s linear infinite' }} /> Restauration…</>
                            : <><UploadCloud style={{ width: 13, height: 13 }} /> Lancer la restauration</>
                        }
                    </button>

                    {/* Result panel */}
                    {restoreResult && (
                        <div style={{ marginTop: '1rem', padding: '.65rem .85rem', background: restoreResult.ok ? 'rgba(63,185,80,.06)' : 'rgba(232,106,101,.06)', border: `1px solid ${restoreResult.ok ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}`, borderRadius: 6, fontSize: '.82rem' }}>
                            <div style={{ fontWeight: 600, marginBottom: '.4rem', color: restoreResult.ok ? '#3fb950' : '#e86a65' }}>
                                {restoreResult.ok ? '✓ Restauration réussie' : '⚠ Restauration avec erreurs'}
                            </div>
                            {restoreResult.written.length > 0 && (
                                <div style={{ marginBottom: '.25rem', color: '#8b949e' }}>
                                    Écrits : {restoreResult.written.map(f => <code key={f} style={{ color: '#3fb950', marginRight: '.4rem' }}>{f}</code>)}
                                </div>
                            )}
                            {restoreResult.skipped.length > 0 && (
                                <div style={{ marginBottom: '.25rem', color: '#8b949e' }}>
                                    Ignorés : {restoreResult.skipped.map(f => <code key={f} style={{ color: '#8b949e', marginRight: '.4rem' }}>{f}</code>)}
                                </div>
                            )}
                            {restoreResult.errors.length > 0 && (
                                <div style={{ marginBottom: '.25rem', color: '#e86a65' }}>
                                    Erreurs : {restoreResult.errors.map((e, i) => <div key={i}><code>{e}</code></div>)}
                                </div>
                            )}
                            {restoreResult.reloadOk !== undefined && (
                                <div style={{ marginTop: '.35rem', color: restoreResult.reloadOk ? '#3fb950' : '#e3b341' }}>
                                    Reload : {restoreResult.reloadOk ? '✓ OK' : `⚠ ${restoreResult.reloadOut ?? 'échec'}`}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Spinner keyframes */}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 3: Commit**

```bash
git add src/pages/fail2ban/TabBackup.tsx
git commit -m "feat(fail2ban): TabBackup — export + restore UI"
```

---

## Task 5: Wire `TabBackup` into `Fail2banPage.tsx`

**Files:**
- Modify: `src/pages/Fail2banPage.tsx`

- [ ] **Step 1: Add `Archive` to lucide-react import**

Current import line (line 8-13):

```ts
import {
    Shield, AlertTriangle, CheckCircle,
    Ban, Activity,
    List, Filter, Zap, Settings,
    Network, Server, ClipboardList, HelpCircle, Database, Map as MapIcon,
} from 'lucide-react';
```

Add `Archive` to it:

```ts
import {
    Shield, AlertTriangle, CheckCircle,
    Ban, Activity,
    List, Filter, Zap, Settings,
    Network, Server, ClipboardList, HelpCircle, Database, Map as MapIcon,
    Archive,
} from 'lucide-react';
```

- [ ] **Step 2: Add `TabBackup` import**

After the existing tab imports (near line 28), add:

```ts
import { TabBackup }      from './fail2ban/TabBackup';
```

- [ ] **Step 3: Add nav entry in Outils group**

Current Outils group (lines 58-64):

```ts
{
    label: 'Outils',
    items: [
        { id: 'config' as TabId, label: 'Config', icon: Settings,      color: '#8b949e' },
        { id: 'audit'  as TabId, label: 'Audit',  icon: ClipboardList, color: '#8b949e' },
        { id: 'aide'   as TabId, label: 'Aide',   icon: HelpCircle,    color: '#8b949e' },
    ],
},
```

Replace with:

```ts
{
    label: 'Outils',
    items: [
        { id: 'config'  as TabId, label: 'Config',  icon: Settings,      color: '#8b949e' },
        { id: 'audit'   as TabId, label: 'Audit',   icon: ClipboardList, color: '#8b949e' },
        { id: 'backup'  as TabId, label: 'Backup',  icon: Archive,       color: '#58a6ff' },
        { id: 'aide'    as TabId, label: 'Aide',    icon: HelpCircle,    color: '#8b949e' },
    ],
},
```

- [ ] **Step 4: Add render branch**

Current last render lines (~439-441):

```tsx
                    {tab === 'config'   && <TabConfig />}
                    {tab === 'audit'    && <TabAudit />}
                    {tab === 'aide'     && <TabAide />}
```

Replace with:

```tsx
                    {tab === 'config'   && <TabConfig />}
                    {tab === 'audit'    && <TabAudit />}
                    {tab === 'backup'   && <TabBackup />}
                    {tab === 'aide'     && <TabAide />}
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add src/pages/Fail2banPage.tsx
git commit -m "feat(fail2ban): wire Backup tab into nav + render block"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full TypeScript check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: `0`

- [ ] **Step 2: Verify the tab appears in the UI**

Start the dev server (`npm run dev`) and navigate to the Fail2ban page. Confirm:
1. "Backup" appears in the Outils nav group, between Audit and Aide
2. Clicking it renders the 2-card layout
3. Clicking "Télécharger le backup JSON" triggers a file download
4. Picking a valid `.json` file shows the preview panel
5. Picking a non-backup JSON shows the red error message
