# Design — Fail2ban socket recovery + stats period freeze fix

**Date:** 2026-03-30
**Scope:** Two independent bugs in the Fail2ban dashboard

---

## Problem summary

### Bug 1 — "Source indisponible" with no recovery path

When fail2ban restarts on the host, its socket is recreated with restrictive permissions. The LogviewR container loses access and shows "Source indisponible — fail2ban daemon not responding". There is no retry button; the user must manually run `sudo chmod 660 /var/run/fail2ban/fail2ban.sock` and then wait for the next 30s poll to recover (delayed further by the 8s server-side cache).

### Bug 2 — Period filter buttons stop working

Changing the period filter in the Statistiques de bans view fires ~6 concurrent API requests with no cancellation. The browser's HTTP/1.1 connection limit (6 per origin) means new requests queue behind old ones. Each server-side request calls `fail2ban-client` with a 10s timeout. If the user changes the period 2–3 times quickly, 12–18 requests accumulate, blocking the queue for up to 30+ seconds. The page shows stale data and the filter buttons appear unresponsive.

Aggravating factor: `HistChart` is defined as a component *inside* `IpSetsSection`, causing React to unmount and remount it on every render of `IpSetsSection`, adding unnecessary fetch traffic.

---

## Design

### Fix 1 — AbortController in `fetchStatus` (Fail2banPage.tsx)

Add a `useRef<AbortController | null>` named `fetchStatusAbortRef` to `Fail2banPage`.

At the start of each `fetchStatus()` call:
1. Call `fetchStatusAbortRef.current?.abort()` to cancel any in-flight requests.
2. Create a new `AbortController` and store it in the ref.
3. Pass `signal: fetchStatusAbortRef.current.signal` to both `api.get()` calls (`/status` and `/history`).

In both `.catch()` handlers: check `error.name === 'AbortError'` — if so, return early without calling `waveDone()`. This prevents the `pending` counter from decrementing for a cancelled wave, avoiding a `setRefreshBusy(false)` on a stale call.

The `waveDone` mechanism (`pending` counter) remains unchanged; it only fires for requests that actually complete.

**Files changed:** `src/pages/Fail2banPage.tsx`

---

### Fix 2a — AbortController in `TabStats.fetchTops`

`fetchTops` is a `useCallback([days])` inside `TabStats`. Add a `useRef<AbortController | null>` named `topsAbortRef`.

In the `useEffect([days, fetchTops])`:
- Return cleanup: `() => { topsAbortRef.current?.abort(); clearInterval(id); }`
- At the start of `fetchTops()`: abort previous + create new controller, pass `signal` to `api.get()`.
- In `.catch()`: skip `setTopsLoading(false)` and `dispatchTabLoaded()` on `AbortError`.

**Files changed:** `src/pages/fail2ban/TabStats.tsx`

---

### Fix 2b — AbortController in `IpSetsSection` history fetch

The `useEffect([days])` in `IpSetsSection` fetches `/ipset/history?days=X` with no cleanup.

Replace with a local `AbortController` inside the effect:

```ts
useEffect(() => {
    const ac = new AbortController();
    // fetch with signal: ac.signal
    return () => ac.abort();
}, [days]);
```

The existing `/ipset/info` effect is `[]`-dependent (fires once) — no change needed there.

**Files changed:** `src/pages/fail2ban/TabStats.tsx`

---

### Fix 2c — Extract `HistChart` out of `IpSetsSection`

`HistChart` is currently a component function defined inside `IpSetsSection`. React treats it as a new component type on every render of `IpSetsSection`, causing full unmount → remount → state loss → extra ResizeObserver registrations.

Move `HistChart` to module scope (same file, before `IpSetsSection`). Pass the required data as explicit props:

```ts
interface HistChartProps {
    hist: { ipset_names: string[]; ipset_days: Record<string, Record<string, number>> } | null;
    days: number;
}
const HistChart: React.FC<HistChartProps> = ({ hist, days }) => { ... };
```

Internal state (`hiddenLines`, `svgW`) is preserved across parent re-renders.

**Files changed:** `src/pages/fail2ban/TabStats.tsx`

---

### Fix 3 — Retry button in the "Source indisponible" banner

In `Fail2banPage.tsx`, the error banner renders when `statusHydrated && status && !status.ok`.

Add a "Réessayer" button (inline, right of the error text) that calls `fetchStatus()` directly. No new server endpoint needed — the 8s server-side cache TTL is short enough that a user clicking retry after running `chmod 660` will get a fresh result.

Button style: small, matches existing action button patterns in `Fail2banPage` (ghost/outline, orange accent to match the warning banner).

**Files changed:** `src/pages/Fail2banPage.tsx`

---

## Files touched

| File | Changes |
|---|---|
| `src/pages/Fail2banPage.tsx` | `fetchStatusAbortRef`, abort in `fetchStatus`, retry button in error banner |
| `src/pages/fail2ban/TabStats.tsx` | `topsAbortRef` in `TabStats`, abort in `fetchTops` + cleanup, abort in `IpSetsSection` history effect, extract `HistChart` to module scope |

No server-side changes required.

---

## Out of scope

- Debounce on `setStatsDays` (option B) — not needed if AbortController fully resolves the freeze.
- Centralized `useFail2banData` hook (option C) — future refactoring, not needed now.
- Permanent socket permission fix (systemd dropin) — already documented separately; this fix only addresses the UI recovery path.
- `periodSummary` useEffect in `Fail2banPage` — already has a `cancelled` boolean guard; not a priority.

---

## Success criteria

1. Changing the period filter while a fetch is in-flight cancels the previous requests immediately — no queue buildup, data updates within 1-2s.
2. Rapidly clicking through all period buttons (1d → 7d → 30d → 7d) produces exactly one final fetch, not 4 stacked ones.
3. After running `sudo chmod 660 /var/run/fail2ban/fail2ban.sock`, clicking "Réessayer" in the banner recovers the dashboard without a page reload.
4. `HistChart` maintains its hidden-lines state across parent re-renders (no flicker).
