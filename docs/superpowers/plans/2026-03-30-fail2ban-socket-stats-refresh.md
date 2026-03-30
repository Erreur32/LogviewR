# Fail2ban socket recovery + stats period freeze fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the stats period filter freeze (stale concurrent requests) and add a retry button to the "Source indisponible" socket error banner.

**Architecture:** Three targeted changes — (1) AbortController in `fetchStatus` (Fail2banPage), (2) AbortController in `fetchTops` + IpSetsSection history fetch + extract `HistChart` to module scope (TabStats), (3) retry button in the error banner (Fail2banPage). No server changes.

**Tech Stack:** React 18, TypeScript, fetch AbortController (native browser API)

---

## File map

| File | What changes |
|---|---|
| `src/pages/Fail2banPage.tsx` | Add `fetchStatusAbortRef`, abort guard in `fetchStatus`, retry button in error banner |
| `src/pages/fail2ban/TabStats.tsx` | Add `topsAbortRef` + abort guard in `fetchTops`, add AbortController to IpSetsSection history effect, extract `HistChart` to module scope with explicit props |

---

## Task 1 — AbortController in `fetchStatus` (Fail2banPage.tsx)

**Files:**
- Modify: `src/pages/Fail2banPage.tsx`

### Context

`fetchStatus` fires two concurrent `api.get()` calls (status + history). When `statsDays` changes, the old requests stay in-flight and can overwrite state with stale data, blocking new requests via the browser's 6-connection limit. We add one `useRef<AbortController | null>` and abort the previous wave at the start of each call.

`api.get(endpoint, init?)` already accepts `RequestInit` as its second argument — pass `{ signal: ac.signal }` directly.

- [ ] **1.1 — Add the abort ref** near the other refs (around line 148, after `hasBootstrappedRef`):

```tsx
const fetchStatusAbortRef = useRef<AbortController | null>(null);
```

- [ ] **1.2 — Replace the top of `fetchStatus`** (lines 279–294, the lines before the two `api.get` calls) with this block that aborts any previous wave and adds an abort guard to `waveDone`:

```tsx
const fetchStatus = useCallback(() => {
    // Cancel any previous in-flight wave before starting a new one
    fetchStatusAbortRef.current?.abort();
    const ac = new AbortController();
    fetchStatusAbortRef.current = ac;

    const firstWave = !hasBootstrappedRef.current;
    if (firstWave) {
        setHistoryLoading(true);
    }
    setRefreshBusy(true);

    let pending = 2;
    const waveDone = () => {
        if (ac.signal.aborted) return; // stale wave — don't touch shared state
        pending -= 1;
        if (pending === 0) {
            setRefreshBusy(false);
            hasBootstrappedRef.current = true;
            setLastRefreshed(Date.now());
        }
    };
```

- [ ] **1.3 — Pass the signal to the `/status` request** (the `api.get` for `/status`, around line 296):

```tsx
api.get<StatusResponse>(`/api/plugins/fail2ban/status?days=${statsDays}`, { signal: ac.signal })
```

- [ ] **1.4 — Pass the signal to the `/history` request** (the `api.get` for `/history`, around line 322):

```tsx
api.get<{ ok?: boolean; history?: HistoryEntry[]; byJail?: Record<string, Record<string, number>>; jailNames?: string[] }>(`/api/plugins/fail2ban/history?days=${statsDays}`, { signal: ac.signal })
```

- [ ] **1.5 — Verify TypeScript**

```bash
cd /home/tools/Project/LogviewR && npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

- [ ] **1.6 — Commit**

```bash
cd /home/tools/Project/LogviewR
git add src/pages/Fail2banPage.tsx
git commit -m "fix: abort stale fetchStatus requests on period change"
```

---

## Task 2 — Retry button in the "Source indisponible" banner (Fail2banPage.tsx)

**Files:**
- Modify: `src/pages/Fail2banPage.tsx`

### Context

The error banner renders when `statusHydrated && status && !status.ok` (around line 893). There is no way to recover without a page reload. Adding a "Réessayer" button that calls `fetchStatus()` is enough — the server-side cache TTL is 8s, so a fresh check arrives quickly after the user has run `chmod 660`.

- [ ] **2.1 — Replace the banner `<div>` contents** (the inner `<div>` starting at line 896) to add the retry button:

```tsx
{statusHydrated && status && !status.ok && (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem', padding: '.6rem 1rem', background: 'rgba(227,179,65,.07)', borderBottom: '1px solid rgba(227,179,65,.25)', fontSize: '.78rem', color: '#e3b341', flexShrink: 0 }}>
        <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0, marginTop: 2 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
            <strong>Source indisponible</strong>
            {' — '}{status.error ?? 'fail2ban-client et SQLite inaccessibles'}{'. '}
            <code style={{ fontFamily: 'monospace', fontSize: '.75rem' }}>sudo chmod 660 /var/run/fail2ban/fail2ban.sock</code>
        </div>
        <button
            onClick={fetchStatus}
            style={{ flexShrink: 0, padding: '.15rem .6rem', fontSize: '.72rem', borderRadius: 4, cursor: 'pointer', border: '1px solid rgba(227,179,65,.4)', background: 'rgba(227,179,65,.12)', color: '#e3b341' }}
        >
            Réessayer
        </button>
    </div>
)}
```

- [ ] **2.2 — Verify TypeScript**

```bash
cd /home/tools/Project/LogviewR && npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

- [ ] **2.3 — Commit**

```bash
cd /home/tools/Project/LogviewR
git add src/pages/Fail2banPage.tsx
git commit -m "feat: add retry button to fail2ban socket error banner"
```

---

## Task 3 — Extract `HistChart` out of `IpSetsSection` (TabStats.tsx)

**Files:**
- Modify: `src/pages/fail2ban/TabStats.tsx`

### Context

`HistChart` is currently defined as a component function **inside** `IpSetsSection`. React treats it as a new component type on every render of `IpSetsSection`, causing unmount → remount → state loss (`hiddenLines`, `svgW`) and spurious ResizeObserver registrations. Moving it to module scope (before `IpSetsSection`) fixes this.

The current `HistChart` closes over `days` and `onDaysChange` from `IpSetsSection`'s scope. These become explicit props.

- [ ] **3.1 — Find the exact location of `HistChart`** to know where to cut:

`HistChart` starts at `const HistChart: React.FC = () => {` (around line 259) and ends just before line 659 (end of `IpSetsSection`). It uses `hist`, `days`, and `onDaysChange` from the parent scope.

- [ ] **3.2 — Add the `HistChart` interface and move the component** to module scope, just before `IpSetsSection` (around line 203). Replace the inlined definition with a top-level one that accepts props:

```tsx
// ── IPSet historical line chart (module-level to avoid React remount on each IpSetsSection render) ──
interface HistChartProps {
    hist: { ipset_names: string[]; ipset_days: Record<string, Record<string, number>> } | null;
    days: number;
    onDaysChange: (d: number) => void;
}

const HistChart: React.FC<HistChartProps> = ({ hist, days, onDaysChange }) => {
    const names = hist?.ipset_names ?? [];
    const days_map = hist?.ipset_days ?? {};
    // ... (rest of the existing HistChart body, unchanged)
};
```

The body of the function is **identical** to the existing one — only the signature changes from `React.FC = () =>` to `React.FC<HistChartProps> = ({ hist, days, onDaysChange }) =>`.

- [ ] **3.3 — Delete the old inlined `HistChart`** (the `const HistChart: React.FC = () => { ... }` block inside `IpSetsSection`).

- [ ] **3.4 — Update the call site inside `IpSetsSection`** — find `<HistChart />` (no props) and replace with:

```tsx
<HistChart hist={hist} days={days} onDaysChange={onDaysChange} />
```

- [ ] **3.5 — Verify TypeScript**

```bash
cd /home/tools/Project/LogviewR && npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

- [ ] **3.6 — Commit**

```bash
cd /home/tools/Project/LogviewR
git add src/pages/fail2ban/TabStats.tsx
git commit -m "refactor: extract HistChart to module scope to prevent React remounts"
```

---

## Task 4 — AbortController in `fetchTops` (TabStats.tsx)

**Files:**
- Modify: `src/pages/fail2ban/TabStats.tsx`

### Context

`fetchTops` is a `useCallback([days])` inside `TabStats`. It's called immediately when `days` changes and again every 60s via `setInterval`. Without cancellation, stale `/tops` responses can overwrite fresh state when the user changes period quickly.

We add a `topsAbortRef` to `TabStats` and abort at the start of each `fetchTops` call.

- [ ] **4.1 — Add the abort ref** inside `TabStats` (after `topsWasLoadingRef`, around line 1344):

```tsx
const topsAbortRef = useRef<AbortController | null>(null);
```

- [ ] **4.2 — Replace `fetchTops`** (lines 1346–1364) with the abort-aware version:

```tsx
const fetchTops = useCallback(() => {
    topsAbortRef.current?.abort();
    const ac = new AbortController();
    topsAbortRef.current = ac;

    api.get<TopsData>(`/api/plugins/fail2ban/tops?days=${days}&limit=100&compare=1`, { signal: ac.signal })
        .then(res => {
            if (ac.signal.aborted) return;
            if (res.success && res.result?.ok) {
                setCached(`tops:all:${days}`, res.result);
                setTopsData(res.result);
                primeTopsPrevTotalFromFullFetch(days, res.result.prevSummary?.totalBans ?? null);
            }
        })
        .catch(() => {})
        .finally(() => {
            if (ac.signal.aborted) return;
            setTopsLoading(false);
            if (topsWasLoadingRef.current) {
                topsWasLoadingRef.current = false;
                dispatchTabLoaded();
            }
        });
}, [days]);
```

- [ ] **4.3 — Add abort cleanup to the `useEffect`** (lines 1366–1379). Replace it:

```tsx
useEffect(() => {
    const cached = getCached<TopsData>(`tops:all:${days}`);
    if (cached) {
        setTopsData(cached);
        setTopsLoading(false);
        primeTopsPrevTotalFromFullFetch(days, cached.prevSummary?.totalBans ?? null);
    } else {
        setTopsLoading(true);
        topsWasLoadingRef.current = true;
    }
    fetchTops();
    const id = setInterval(fetchTops, 60_000);
    return () => {
        clearInterval(id);
        topsAbortRef.current?.abort();
    };
}, [days, fetchTops]);
```

- [ ] **4.4 — Verify TypeScript**

```bash
cd /home/tools/Project/LogviewR && npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

- [ ] **4.5 — Commit**

```bash
cd /home/tools/Project/LogviewR
git add src/pages/fail2ban/TabStats.tsx
git commit -m "fix: abort stale fetchTops requests on period change in TabStats"
```

---

## Task 5 — AbortController in `IpSetsSection` history fetch (TabStats.tsx)

**Files:**
- Modify: `src/pages/fail2ban/TabStats.tsx`

### Context

The `useEffect([days])` in `IpSetsSection` fetches `/ipset/history?days=X` with no cleanup. When `days` changes, the old request stays in-flight and can write stale `hist` state. A local `AbortController` inside the effect handles this with one line of cleanup.

- [ ] **5.1 — Replace the history `useEffect` in `IpSetsSection`** (lines 229–236):

```tsx
// Historical data for the line chart — synced with global period
useEffect(() => {
    const ac = new AbortController();
    const key = `ipset:history:${days}`;
    const cached = getCached<{ ipset_names: string[]; ipset_days: Record<string, Record<string, number>> }>(key);
    if (cached) setHist(cached);
    api.get<{ ok: boolean; ipset_names: string[]; ipset_days: Record<string, Record<string, number>> }>(
        `/api/plugins/fail2ban/ipset/history?days=${days}`,
        { signal: ac.signal }
    )
        .then(res => {
            if (!ac.signal.aborted && res.success && res.result?.ok) {
                setCached(key, res.result);
                setHist(res.result);
            }
        })
        .catch(() => {});
    return () => ac.abort();
}, [days]);
```

- [ ] **5.2 — Verify TypeScript**

```bash
cd /home/tools/Project/LogviewR && npx tsc 2>&1 | grep -c "error TS"
```
Expected: `0`

- [ ] **5.3 — Commit**

```bash
cd /home/tools/Project/LogviewR
git add src/pages/fail2ban/TabStats.tsx
git commit -m "fix: abort stale IpSetsSection history fetch on period change"
```

---

## Manual verification checklist

After all tasks:

- [ ] Ouvrir le dashboard fail2ban, aller sur l'onglet **Stats**
- [ ] Cliquer rapidement sur les boutons de période (1j → 7j → 30j → 7j) — les données doivent se mettre à jour en 1-2s, pas de freeze
- [ ] Ouvrir les DevTools réseau — vérifier que les requêtes anciennes sont bien annulées (statut `canceled`) quand on change de période
- [ ] Simuler un socket indisponible en vérifiant que le banner "Source indisponible" affiche bien le bouton "Réessayer"
- [ ] Cliquer "Réessayer" après avoir corrigé les perms → le dashboard récupère sans F5
