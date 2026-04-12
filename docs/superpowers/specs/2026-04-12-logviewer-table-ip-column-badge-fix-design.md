# LogViewer Table — IP Column & Badge Readability Fix

**Date:** 2026-04-12
**Scope:** LogViewer tables only (not fail2ban pages)

## Problem

The recent addition of a ShieldAlert icon (banned IP indicator) inside the IP column causes layout issues:

1. **IP column overflow:** `COLUMN_WIDTHS` sets IP columns to `114px`, but when the ShieldAlert icon (12px + 4px gap) appears next to the IP text, content overflows into the next column. The table uses `table-layout: fixed` with `<colgroup>`, so the column cannot grow.
2. **Badge readability:** Badge backgrounds use 10% opacity (`500/10`), which can lack contrast on hover rows or varied backgrounds in dark theme.

## Solution — Approach A (Targeted Fix)

### 1. Widen IP columns

**File:** `src/components/log-viewer/LogTable.tsx` (COLUMN_WIDTHS, lines 140-143)

All IP column entries change from `114px` to `145px`:

```ts
ip: '145px',
ipaddress: '145px',
clientip: '145px',
remoteip: '145px',
```

**Rationale:** IPv4 max width in monospace ~120px + ShieldAlert 12px + gap 4px + safety margin = ~145px. IPv6 is already truncated by `truncateIPv6ForDisplay()`.

### 2. Overflow protection on IP cell

**File:** `src/components/log-viewer/LogTable.tsx` (case 'ip', ~line 592)

Add `overflow: hidden` to the outer `<span>` wrapper so content never bleeds into the adjacent column:

```tsx
<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', overflow: 'hidden' }}>
```

### 3. Increase badge background opacity

**File:** `src/components/ui/Badge.tsx` (variantClasses, lines 23-29)

Change background opacity from `/10` to `/20` for better contrast:

| Variant   | Before               | After                |
|-----------|----------------------|----------------------|
| success   | `bg-green-500/10`    | `bg-green-500/20`    |
| warning   | `bg-orange-500/10`   | `bg-orange-500/20`   |
| error     | `bg-red-500/10`      | `bg-red-500/20`      |
| info      | `bg-blue-500/10`     | `bg-blue-500/20`     |

Text colors remain unchanged. The higher opacity background creates better contrast without changing the overall dark-theme aesthetic.

## Files Modified

| File | Change |
|------|--------|
| `src/components/log-viewer/LogTable.tsx` | IP column widths 114→145px, overflow: hidden on IP cell |
| `src/components/ui/Badge.tsx` | Badge background opacity 10%→20% |

## Out of Scope

- Fail2ban page tables (TabTracker, TabStats, etc.) — not touched
- Column padding — stays as-is
- Badge text colors — unchanged
