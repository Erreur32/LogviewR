# Blocklist Self-Ban Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the user from accidentally banning their own IP when activating a blocklist by checking the caller's IP against the ipset before applying iptables DROP rules, and showing a warning confirmation modal in the UI.

**Architecture:** BlocklistService.enable() gains a `callerIp` + `force` parameter. After ensuring the ipset is populated (refresh if needed), it runs `ipset test` on the caller's IP. If the IP is found and `force` is false, it returns `{ ok: false, selfBan: true }` without touching iptables. The toggle route extracts the real client IP and passes it. The frontend intercepts `selfBan: true` and shows a confirmation modal; on confirm it retries with `force: true`.

**Tech Stack:** TypeScript (Express backend), React (frontend), ipset CLI

---

## Files Modified

- `server/plugins/fail2ban/BlocklistService.ts` — `enable()` signature + self-ban check
- `server/plugins/fail2ban/Fail2banPlugin.ts` — toggle route extracts callerIp, passes force
- `src/pages/fail2ban/TabBlocklists.tsx` — selfBan warning modal + force retry

---

## Task 1: Add self-ban check to BlocklistService.enable()

**Files:**
- Modify: `server/plugins/fail2ban/BlocklistService.ts` (enable method, ~line 654)

The `enable()` method signature becomes:
```ts
async enable(id: string, callerIp?: string, force?: boolean): Promise<{ ok: boolean; selfBan?: boolean; error?: string }>
```

After the ipset is populated (after the `count === 0` refresh block), and **before** the iptables loop, insert the check.

- [ ] **Step 1: Change the enable() signature**

In `BlocklistService.ts`, replace the `enable` method signature line:
```ts
async enable(id: string): Promise<{ ok: boolean; error?: string }> {
```
with:
```ts
async enable(id: string, callerIp?: string, force?: boolean): Promise<{ ok: boolean; selfBan?: boolean; error?: string }> {
```

- [ ] **Step 2: Add the self-ban check block**

After the `if (status.count === 0) { ... }` block (which ends around line 668) and **before** the iptables `for` loop, insert:

```ts
        // Self-ban guard: refuse to activate if caller's own IP is in the set (unless forced)
        if (callerIp && !force) {
            try {
                const [tc, ta] = priv('ipset', ['test', list.ipsetName, callerIp]);
                await execFileAsync(tc, ta, { timeout: 5_000 });
                // exit 0 → caller IP is in the set — refuse
                logger.warn('BlocklistService', `enable ${id}: self-ban guard triggered for IP ${callerIp}`);
                return { ok: false, selfBan: true, error: `Votre IP (${callerIp}) est dans cette liste — l'activer vous bannirait.` };
            } catch {
                // exit 1 → IP not in set — safe to continue
            }
        }
```

- [ ] **Step 3: TypeScript check**

```bash
cd /home/tools/Project/LogviewR && npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

- [ ] **Step 4: Commit**

```bash
cd /home/tools/Project/LogviewR && git add server/plugins/fail2ban/BlocklistService.ts
git commit -m "feat: blocklist self-ban guard in enable() — checks callerIp before iptables rule"
```

---

## Task 2: Extract client IP in the toggle route

**Files:**
- Modify: `server/plugins/fail2ban/Fail2banPlugin.ts` (toggle route, ~line 3043)

Express provides `req.ip` which respects the `trust proxy` setting. We also need to accept `force` from the request body.

- [ ] **Step 1: Update the toggle route**

Find the toggle route block (~line 3043-3051) and replace:
```ts
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
with:
```ts
        // POST /blocklists/toggle  { id: string, enabled: boolean, force?: boolean }
        router.post('/blocklists/toggle', requireAuth, asyncHandler(async (req, res) => {
            const { id, enabled, force } = req.body as { id?: string; enabled?: boolean; force?: boolean };
            if (!id || enabled === undefined) return res.json({ success: true, result: { ok: false, error: 'Paramètres manquants' } });
            // Extract real client IP for self-ban guard (strip ::ffff: IPv4-mapped prefix)
            const rawIp = req.ip ?? req.socket.remoteAddress ?? '';
            const callerIp = rawIp.replace(/^::ffff:/, '');
            const r = enabled
                ? await this.blocklistService?.enable(id, callerIp, force) ?? { ok: false, error: 'service non initialisé' }
                : await this.blocklistService?.disable(id) ?? { ok: false, error: 'service non initialisé' };
            res.json({ success: true, result: r });
        }));
```

- [ ] **Step 2: TypeScript check**

```bash
cd /home/tools/Project/LogviewR && npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

- [ ] **Step 3: Commit**

```bash
cd /home/tools/Project/LogviewR && git add server/plugins/fail2ban/Fail2banPlugin.ts
git commit -m "feat: pass callerIp + force to blocklist enable() from toggle route"
```

---

## Task 3: Frontend — self-ban warning modal + force retry

**Files:**
- Modify: `src/pages/fail2ban/TabBlocklists.tsx`

When `handleToggle` receives `selfBan: true` in the response, it should:
1. Not apply the toggle (list stays disabled)
2. Show a warning modal: "Votre IP est dans cette liste. L'activer vous bannirait. Forcer quand même ?"
3. Two buttons: "Annuler" and "Forcer l'activation"
4. If user confirms, retry the toggle with `force: true`

### 3a — Add selfBan modal state

- [ ] **Step 1: Add state for the confirmation modal**

At the top of the `TabBlocklists` component, after existing state declarations, add:
```tsx
  const [selfBanConfirm, setSelfBanConfirm] = useState<{ id: string; ip: string; listName: string } | null>(null);
  const [forceToggling, setForceToggling] = useState(false);
```

### 3b — Update handleToggle to detect selfBan

- [ ] **Step 2: Replace handleToggle**

Replace the existing `handleToggle` function with:
```tsx
  const handleToggle = async (id: string, currentEnabled: boolean, force?: boolean) => {
    setLists(prev => prev.map(l => l.id === id ? { ...l, updating: true } : l));
    try {
      const res = await api.post<{ ok: boolean; selfBan?: boolean; error?: string }>(
        '/api/plugins/fail2ban/blocklists/toggle',
        { id, enabled: !currentEnabled, force }
      );
      if (res.result?.selfBan) {
        // Extract IP from error message e.g. "Votre IP (1.2.3.4) est dans cette liste…"
        const match = res.result.error?.match(/\(([^)]+)\)/);
        const ip = match ? match[1] : '?';
        const listName = lists.find(l => l.id === id)?.name ?? id;
        setSelfBanConfirm({ id, ip, listName });
        // Revert optimistic updating state without re-enabling
        setLists(prev => prev.map(l => l.id === id ? { ...l, updating: false } : l));
        return;
      }
    } finally {
      if (!selfBanConfirm) await fetchStatus();
    }
  };
```

Wait — the `finally` block runs before `setSelfBanConfirm` takes effect. Replace with a cleaner version:

```tsx
  const handleToggle = async (id: string, currentEnabled: boolean, force?: boolean) => {
    setLists(prev => prev.map(l => l.id === id ? { ...l, updating: true } : l));
    try {
      const res = await api.post<{ ok: boolean; selfBan?: boolean; error?: string }>(
        '/api/plugins/fail2ban/blocklists/toggle',
        { id, enabled: !currentEnabled, force }
      );
      if (res.result?.selfBan) {
        const match = res.result.error?.match(/\(([^)]+)\)/);
        const ip = match ? match[1] : '?';
        const listName = lists.find(l => l.id === id)?.name ?? id;
        setLists(prev => prev.map(l => l.id === id ? { ...l, updating: false } : l));
        setSelfBanConfirm({ id, ip, listName });
        return;
      }
      await fetchStatus();
    } catch {
      await fetchStatus();
    }
  };
```

### 3c — Add handleForceConfirm

- [ ] **Step 3: Add the force confirm handler**

After `handleToggle`, add:
```tsx
  const handleForceConfirm = async () => {
    if (!selfBanConfirm) return;
    setForceToggling(true);
    try {
      await handleToggle(selfBanConfirm.id, false /* was disabled, now enabling */, true);
    } finally {
      setSelfBanConfirm(null);
      setForceToggling(false);
    }
  };
```

### 3d — Add the modal JSX

- [ ] **Step 4: Render the warning modal**

Inside the `return (...)` block, just before the closing `</div>`, add the modal:

```tsx
      {/* ── Self-ban warning modal ── */}
      {selfBanConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <div style={{
            background: '#161b22', border: '1px solid rgba(248,81,73,.4)',
            borderRadius: 8, padding: '1.5rem', maxWidth: 420, width: '90%',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.75rem' }}>
              <span style={{ fontSize: '1.2rem' }}>⚠️</span>
              <span style={{ fontWeight: 700, color: '#f85149', fontSize: '.95rem' }}>Risque d'auto-bannissement</span>
            </div>
            <p style={{ color: '#e6edf3', fontSize: '.85rem', margin: '0 0 .5rem' }}>
              Votre IP <strong style={{ color: '#ffa657' }}>{selfBanConfirm.ip}</strong> est présente dans la liste <strong style={{ color: '#e6edf3' }}>{selfBanConfirm.listName}</strong>.
            </p>
            <p style={{ color: '#8b949e', fontSize: '.82rem', margin: '0 0 1.25rem' }}>
              L'activer vous bannirait immédiatement de l'interface. Ajoutez votre IP en whitelist iptables avant de continuer, ou forcez si vous savez ce que vous faites.
            </p>
            <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setSelfBanConfirm(null)}
                style={{
                  background: 'rgba(139,148,158,.12)', border: '1px solid rgba(139,148,158,.3)',
                  color: '#e6edf3', borderRadius: 5, padding: '.35rem .85rem',
                  fontSize: '.82rem', cursor: 'pointer',
                }}
              >
                Annuler
              </button>
              <button
                onClick={handleForceConfirm}
                disabled={forceToggling}
                style={{
                  background: 'rgba(248,81,73,.15)', border: '1px solid rgba(248,81,73,.4)',
                  color: '#f85149', borderRadius: 5, padding: '.35rem .85rem',
                  fontSize: '.82rem', cursor: forceToggling ? 'default' : 'pointer',
                  opacity: forceToggling ? 0.6 : 1,
                }}
              >
                {forceToggling ? 'Activation…' : 'Forcer l\'activation'}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: TypeScript check**

```bash
cd /home/tools/Project/LogviewR && npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

- [ ] **Step 6: Commit**

```bash
cd /home/tools/Project/LogviewR && git add src/pages/fail2ban/TabBlocklists.tsx
git commit -m "feat: self-ban warning modal in TabBlocklists — intercepts selfBan response + force confirm"
```

---

## Task 4: Version bump

- [ ] **Step 1: Bump to v0.8.23**

```bash
cd /home/tools/Project/LogviewR && bash scripts/update-version.sh 0.8.23
```

- [ ] **Step 2: Verify 5 version files updated**

```bash
cd /home/tools/Project/LogviewR && grep -r '"version"' package.json src/version.ts server/version.ts 2>/dev/null | head -10
```

- [ ] **Step 3: Commit + tag**

```bash
cd /home/tools/Project/LogviewR && git add -A
git commit -m "chore: bump version to v0.8.23 — blocklist self-ban guard"
git tag v0.8.23
```

---

## Self-Review

**Spec coverage:**
- ✅ Check callerIp in ipset before enabling (Task 1)
- ✅ callerIp extracted from req.ip in route (Task 2)
- ✅ All lists covered — generic mechanism works for builtin + custom (same code path)
- ✅ Warning modal with IP + list name shown (Task 3)
- ✅ Force bypass if user confirms (Task 3)
- ✅ IPv4-mapped IPv6 prefix `::ffff:` stripped (Task 2)

**Edge cases covered:**
- If ipset doesn't exist yet (count === 0), refresh runs first, then the check happens on the freshly populated set
- If callerIp is empty string (no IP detected), the guard is skipped silently (safe fail-open)
- `force: true` completely bypasses the check

**Not in scope:** whitelist management (separate feature) — the modal text advises the user to add a whitelist rule manually before forcing.
