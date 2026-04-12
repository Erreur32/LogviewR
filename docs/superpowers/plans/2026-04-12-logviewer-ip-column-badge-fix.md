# LogViewer IP Column & Badge Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix IP column overflow caused by the ShieldAlert ban icon and improve badge readability in LogViewer tables.

**Architecture:** Three surgical CSS/layout edits in two files. No logic changes, no new files.

**Tech Stack:** React, Tailwind CSS, inline styles

**Spec:** `docs/superpowers/specs/2026-04-12-logviewer-table-ip-column-badge-fix-design.md`

---

### Task 1: Widen IP columns in COLUMN_WIDTHS

**Files:**
- Modify: `src/components/log-viewer/LogTable.tsx:140-143`

- [ ] **Step 1: Update IP column widths**

In `COLUMN_WIDTHS` (line 140-143), change all four IP entries from `114px` to `145px`:

```ts
    // IP columns
    ip: '145px',
    ipaddress: '145px',
    clientip: '145px',
    remoteip: '145px',
```

- [ ] **Step 2: Add overflow protection to IP cell**

In the `case 'ip'` renderer (~line 592), add `overflow: 'hidden'` to the outer `<span>`:

```tsx
                const content = (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%', overflow: 'hidden' }}>
```

- [ ] **Step 3: Run type check**

```bash
cd /home/tools/Project/LogviewR && npx tsc --noEmit
```

Expected: no errors related to LogTable.tsx

- [ ] **Step 4: Commit**

```bash
git add src/components/log-viewer/LogTable.tsx
git commit -m "fix(ui): widen IP columns to 145px to fit ShieldAlert ban icon"
```

---

### Task 2: Increase badge background opacity

**Files:**
- Modify: `src/components/ui/Badge.tsx:23-29`

- [ ] **Step 1: Update variant classes**

In `variantClasses` (line 23-29), change `/10` to `/20` for four variants:

```ts
  const variantClasses = {
    default: 'bg-gray-800 text-gray-400',
    success: 'bg-green-500/20 text-green-400',
    warning: 'bg-orange-500/20 text-orange-400',
    error: 'bg-red-500/20 text-red-400',
    info: 'bg-blue-500/20 text-blue-400',
    purple: 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
  };
```

Note: `default` and `purple` stay unchanged (default uses gray-800, purple is already at /20).

- [ ] **Step 2: Run type check**

```bash
cd /home/tools/Project/LogviewR && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Badge.tsx
git commit -m "fix(ui): increase badge background opacity for better readability"
```

---

### Task 3: Visual verification

- [ ] **Step 1: Start dev server**

```bash
cd /home/tools/Project/LogviewR && npm run dev
```

- [ ] **Step 2: Verify in browser**

Check these points:
- Open a log viewer page with IP columns visible
- Confirm IP + ShieldAlert icon fits inside the IP column without overflow
- Confirm badges (level, status, method) have slightly more opaque backgrounds
- Confirm no visual regression on other columns
