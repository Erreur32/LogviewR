# React Router Migration + Rybbit Analytics — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate LogviewR from hash-based navigation to React Router (BrowserRouter) with URL sub-tabs, and integrate Rybbit analytics for automatic pageview tracking.

**Architecture:** Replace `window.location.hash` + `useState<PageType>` with `react-router-dom` v7. Derive page/tab state from URL (`useLocation`, `useParams`, `useNavigate`). Inject Rybbit script tag (opt-in via env vars) — auto-captures pushState from React Router. Keep existing component structure (Header/Footer receive callbacks/props from App.tsx).

**Tech Stack:** react-router-dom v7, Rybbit (script tag injection), existing Express 5 SPA fallback

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src/main.tsx` | Wrap App with BrowserRouter, inject Rybbit script |
| Modify | `src/App.tsx` | Core routing: derive page from URL, navigate() instead of setState |
| Modify | `src/pages/Fail2banPage.tsx` | Derive tab from URL params, navigate for tab changes |
| Modify | `src/pages/SettingsPage.tsx` | Derive tab/subtab from URL params |
| Modify | `src/components/layout/Footer.tsx` | PageType export stays, no functional changes needed |
| Modify | `server/index.ts` | Add Rybbit domain to CSP headers |
| Modify | `.env` | Add VITE_ANALYTICS_HOST + VITE_ANALYTICS_SITE_ID |

**Not changed:** Footer.tsx (still receives callbacks from App), Header.tsx (same), LogViewerPage.tsx (pluginId + file derived in App.tsx then passed as props — simpler than refactoring LogViewerPage's internal state which manages pluginHeaderData callback), vite.config.ts (base already defaults to `/`).

---

### Task 1: Install react-router-dom + add env vars

**Files:**
- Modify: `package.json` (via npm)
- Modify: `.env`

- [ ] **Step 1: Install react-router-dom**

```bash
cd /home/tools/Project/LogviewR && npm install react-router-dom
```

- [ ] **Step 2: Add Rybbit env vars to .env**

Append to `.env`:
```
VITE_ANALYTICS_HOST=https://way.myoueb.fr
VITE_ANALYTICS_SITE_ID=f0ad16b8f4ba
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json .env
git commit -m "feat: add react-router-dom + Rybbit analytics env vars"
```

---

### Task 2: BrowserRouter + Rybbit script injection in main.tsx

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Add BrowserRouter wrapper and Rybbit script injection**

In `src/main.tsx`, add import and wrap the render:

```typescript
import { BrowserRouter } from 'react-router-dom';
```

Replace the `ReactDOM.createRoot(...)` block (lines 69-75) with:

```typescript
// Rybbit analytics — opt-in: only active when env vars are set
const analyticsHost = import.meta.env.VITE_ANALYTICS_HOST;
const analyticsSiteId = import.meta.env.VITE_ANALYTICS_SITE_ID;
if (analyticsHost && analyticsSiteId && !document.querySelector('script[data-site-id]')) {
  const s = document.createElement('script');
  s.src = `${analyticsHost}/api/script.js`;
  s.dataset.siteId = analyticsSiteId;
  s.dataset.disableSessionReplay = 'true';
  s.defer = true;
  document.head.appendChild(s);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);
```

- [ ] **Step 2: Type check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: 0

- [ ] **Step 3: Commit**

```bash
git add src/main.tsx
git commit -m "feat: wrap App with BrowserRouter, inject Rybbit analytics script"
```

---

### Task 3: Update CSP headers in server/index.ts

**Files:**
- Modify: `server/index.ts:168`

- [ ] **Step 1: Add Rybbit domain to CSP**

In `server/index.ts` line 168, the CSP header string. Update `script-src` and `connect-src` to include `https://way.myoueb.fr`:

Replace the current CSP line:
```typescript
res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://icons.duckduckgo.com https://www.google.com; connect-src 'self' ws: wss: https://api.github.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'");
```

With:
```typescript
res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://way.myoueb.fr; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://icons.duckduckgo.com https://www.google.com; connect-src 'self' ws: wss: https://api.github.com https://way.myoueb.fr; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'");
```

Changes: added `https://way.myoueb.fr` to `script-src` and `connect-src`.

- [ ] **Step 2: Commit**

```bash
git add server/index.ts
git commit -m "feat: add Rybbit analytics domain to CSP headers"
```

---

### Task 4: Core routing migration in App.tsx

This is the biggest task. Replace hash-based navigation with React Router.

**Files:**
- Modify: `src/App.tsx`

**What gets removed:**
- `parseHashNav()` function and `HashNav` type (lines 16-106)
- `VALID_FAIL2BAN_TABS` set, `VALID_PLUGIN_ID_RE` regex, `isSafeFilePath()` (lines 21-42)
- `defaultFail2banTab` state (line 180)
- `defaultLogFile` state (line 179) — replaced by URL search params
- Hash sync useEffect for log-viewer (lines 420-428)
- `hashchange` listener useEffect (lines 431-447)
- sessionStorage deep link code in auth useEffect (lines 262-268, 346-371)
- All `window.history.replaceState(null, '', ...)` hash cleanup calls
- All `window.location.hash` references

**What gets added:**
- React Router imports: `useLocation`, `useNavigate`
- `currentPage` derived from `location.pathname` via useMemo
- `selectedPluginId` derived from URL for `/log/:pluginId` paths
- Helper: `pageToPath(page: PageType): string`
- All `setCurrentPage(x)` calls become `navigate(path)`

- [ ] **Step 1: Replace imports and remove hash navigation code**

At the top of `src/App.tsx`, add React Router imports:

```typescript
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
```

Remove the entire hash navigation block (lines 16-106): the comment `// ── Hash-based navigation`, `VALID_FAIL2BAN_TABS`, `VALID_PLUGIN_ID_RE`, `isSafeFilePath()`, `HashNav` type, and `parseHashNav()`.

- [ ] **Step 2: Add page-to-path helper and derive state from URL**

Add a helper function before the App component (after the lazy imports, around line 120):

```typescript
// ── URL-based navigation (React Router) ─────────────────────────────────────

/** Map PageType to URL path */
function pageToPath(page: PageType, pluginId?: string): string {
    switch (page) {
        case 'fail2ban':       return '/fail2ban';
        case 'log-viewer':     return pluginId ? `/log/${pluginId}` : '/log';
        case 'settings':       return '/settings';
        case 'goaccess-stats': return '/goaccess';
        case 'analytics':      return '/analytics';
        case 'plugins':        return '/plugins';
        case 'users':          return '/users';
        case 'logs':           return '/logs';
        case 'log-viewer-test': return '/log-test';
        case 'profile':        return '/profile';
        default:               return '/';
    }
}

/** Derive PageType from URL pathname */
function pathToPage(pathname: string): PageType {
    if (pathname.startsWith('/fail2ban')) return 'fail2ban';
    if (pathname.startsWith('/log-test')) return 'log-viewer-test';
    if (pathname.startsWith('/log'))      return 'log-viewer';
    if (pathname.startsWith('/settings')) return 'settings';
    if (pathname.startsWith('/goaccess')) return 'goaccess-stats';
    if (pathname.startsWith('/analytics')) return 'analytics';
    if (pathname.startsWith('/plugins'))  return 'plugins';
    if (pathname.startsWith('/users'))    return 'users';
    if (pathname.startsWith('/logs'))     return 'logs';
    if (pathname.startsWith('/profile'))  return 'profile';
    return 'dashboard';
}
```

- [ ] **Step 3: Replace state declarations in App component**

Inside the `App` component, replace the navigation state lines (lines 177-180):

Remove:
```typescript
const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
const [defaultLogFile, setDefaultLogFile] = useState<string | null>(null);
const [defaultFail2banTab, setDefaultFail2banTab] = useState<string | null>(null);
```

Add:
```typescript
const location = useLocation();
const navigate = useNavigate();
const [searchParams] = useSearchParams();

// Derive navigation state from URL
const currentPage: PageType = useMemo(() => pathToPage(location.pathname), [location.pathname]);
const selectedPluginId: string | null = useMemo(() => {
    if (!location.pathname.startsWith('/log/')) return null;
    const id = location.pathname.split('/')[2];
    return id || null;
}, [location.pathname]);
const defaultLogFile: string | null = searchParams.get('file');
```

Keep `pluginHeaderData` state — it's runtime data, not navigation state.

- [ ] **Step 4: Update the auth/deep-link useEffect**

Replace the useEffect at lines 253-296 (the one that checks hash and stores in sessionStorage). Remove hash-related code, keep theme/auth listeners:

```typescript
useEffect(() => {
    checkUserAuth();

    const handleThemeChange = () => {
        // Force component re-render when theme changes
        // (no-op setState triggers re-render)
    };

    window.addEventListener('themechange', handleThemeChange);
    window.addEventListener('themeupdate', handleThemeChange);

    const handleSessionExpired = () => {
        userLogout();
    };
    window.addEventListener('auth:session-expired', handleSessionExpired);

    return () => {
        window.removeEventListener('themechange', handleThemeChange);
        window.removeEventListener('themeupdate', handleThemeChange);
        window.removeEventListener('auth:session-expired', handleSessionExpired);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

Note: remove the `sessionStorage.setItem('_hashNav...')` lines and the `#admin` hash check. The `#admin` legacy hash is no longer needed — admin mode can be accessed via `/settings`.

- [ ] **Step 5: Update the isUserAuthenticated useEffect (default page redirect)**

Replace the useEffect at lines 330-392 that handles deep links + default page. Remove sessionStorage deep link checks (URL handles this now). Only keep the default page redirect when on root:

```typescript
useEffect(() => {
    if (isUserAuthenticated) {
        fetchPlugins();
        fetchAllStats();

        // Load update check config
        loadConfig().then(() => {
            const { updateConfig } = useUpdateStore.getState();
            if (updateConfig?.enabled) {
                checkForUpdates();
            }
        });

        // Default page redirect — only when on root URL (no deep link)
        if (location.pathname === '/') {
            api.get<{ defaultPage?: string; defaultPluginId?: string; defaultLogFile?: string; defaultFail2banTab?: string }>(
                '/api/system/general'
            ).then(response => {
                if (!response.success || !response.result) return;
                const { defaultPage, defaultPluginId, defaultLogFile: dlf, defaultFail2banTab: dft } = response.result;
                if (defaultPage === 'log-viewer' && defaultPluginId) {
                    const url = dlf
                        ? `/log/${defaultPluginId}?file=${encodeURIComponent(dlf)}`
                        : `/log/${defaultPluginId}`;
                    navigate(url, { replace: true });
                } else if (defaultPage === 'fail2ban') {
                    navigate(dft ? `/fail2ban/${dft}` : '/fail2ban', { replace: true });
                } else if (defaultPage && defaultPage !== 'dashboard') {
                    navigate(pageToPath(defaultPage as PageType), { replace: true });
                }
            }).catch(() => { /* keep dashboard on error */ });
        }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [isUserAuthenticated]);
```

- [ ] **Step 6: Remove hash sync useEffects**

Delete the log-viewer hash sync useEffect (lines 420-428):
```typescript
// DELETE: useEffect for hash sync (#log/plugin/file)
```

Delete the hashchange listener useEffect (lines 431-447):
```typescript
// DELETE: useEffect for hashchange listener
```

- [ ] **Step 7: Update handleLogout**

Replace (lines 449-455):
```typescript
const handleLogout = () => {
    userLogout();
    navigate('/', { replace: true });
};
```

- [ ] **Step 8: Update handlePageChange**

Replace (lines 457-483):
```typescript
const handlePageChange = (page: PageType) => {
    startTabTimer();
    timedNavRef.current = true;
    if (page === 'log-viewer') {
        const storedPluginId = sessionStorage.getItem('selectedPluginId');
        if (storedPluginId) {
            navigate(`/log/${storedPluginId}`);
            return;
        }
    } else {
        sessionStorage.removeItem('selectedPluginId');
    }
    navigate(pageToPath(page));
};
```

- [ ] **Step 9: Update handleHomeClick and other navigation handlers**

```typescript
const handleHomeClick = () => {
    handlePageChange('dashboard');
};

const handleSettingsClick = () => {
    navigate('/settings');
};

const handleAdminClick = () => {
    sessionStorage.setItem('adminMode', 'true');
    navigate('/settings');
};

const handleProfileClick = () => {
    navigate('/profile');
};

const handleUsersClick = () => {
    navigate('/users');
};
```

- [ ] **Step 10: Update onPluginClick callbacks throughout render blocks**

In every Header's `onPluginClick` callback, replace:
```typescript
onPluginClick={(pluginId) => {
    if (pluginId === 'fail2ban') {
        setCurrentPage('fail2ban');
    } else {
        setSelectedPluginId(pluginId);
        setCurrentPage('log-viewer');
    }
}}
```

With:
```typescript
onPluginClick={(pluginId) => {
    if (pluginId === 'fail2ban') {
        navigate('/fail2ban');
    } else {
        navigate(`/log/${pluginId}`);
    }
}}
```

This appears in ~6 places: dashboard, analytics, goaccess-stats, fail2ban, log-viewer, and profile Header blocks.

- [ ] **Step 11: Update onBack callbacks and inline navigation**

Replace all `onBack={() => setCurrentPage('dashboard')}` with `onBack={() => navigate('/')}`.

Replace inline navigation in dashboard cards:
```typescript
// DashboardSearchCard onOpenFile
onOpenFile={(pluginId, filePath, logType) => {
    navigate(`/log/${pluginId}?file=${encodeURIComponent(filePath)}`);
}}

// ErrorFilesCard onOpenFile
onOpenFile={(pluginId, filePath, _logType) => {
    navigate(`/log/${pluginId}?file=${encodeURIComponent(filePath)}`);
}}

// ErrorFilesCard onNavigateToAnalysis
onNavigateToAnalysis={() => {
    sessionStorage.setItem('adminMode', 'true');
    sessionStorage.setItem('adminTab', 'analysis');
    navigate('/settings');
}}

// LogHistoryCard onOpenLog
onOpenLog={(entry) => {
    navigate(`/log/${entry.pluginId}?file=${encodeURIComponent(entry.filePath)}`);
}}

// PluginsPage onNavigateToSettings
onNavigateToSettings={() => {
    sessionStorage.setItem('adminMode', 'true');
    sessionStorage.setItem('adminTab', 'plugins');
    navigate('/settings');
}}
```

- [ ] **Step 12: Update log-viewer Header's onHomeClick**

Replace (line 749-754):
```typescript
onHomeClick={() => {
    setPluginHeaderData(null);
    navigate('/');
}}
```

- [ ] **Step 13: Update Fail2banPage props**

Replace (line 835):
```typescript
<Fail2banPage onBack={() => navigate('/')} initialTab={defaultFail2banTab as any ?? undefined} />
```

With:
```typescript
<Fail2banPage onBack={() => navigate('/')} />
```

The `initialTab` prop is no longer needed — Fail2banPage reads from URL (Task 5).

- [ ] **Step 14: Update SettingsPage render block**

Replace the settings render block (lines 677-703). Remove hash check and configHash parsing:

```typescript
if (currentPage === 'settings') {
    const showAdmin = sessionStorage.getItem('adminMode') === 'true' || false;
    const adminTab = sessionStorage.getItem('adminTab') as 'general' | 'users' | 'plugins' | 'security' | 'exporter' | 'theme' | 'debug' | 'info' | undefined;
    return wrapWithBackground(renderPageWithFooter(
        <SettingsPage
            onBack={() => navigate('/')}
            mode={showAdmin ? 'administration' : undefined}
            initialAdminTab={adminTab ?? 'general'}
            onNavigateToPage={(page) => navigate(pageToPath(page))}
            onUsersClick={handleUsersClick}
            onSettingsClick={handleSettingsClick}
            onAdminClick={handleAdminClick}
            onProfileClick={handleProfileClick}
            onLogout={handleLogout}
        />
    ));
}
```

Note: SettingsPage tab/subtab URL migration is in Task 6. For now, keep `initialAdminTab` prop — it will be replaced by URL params in Task 6.

- [ ] **Step 15: Type check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: 0 (may have a few type errors from removed state — fix them)

- [ ] **Step 16: Commit**

```bash
git add src/App.tsx
git commit -m "feat: migrate App.tsx from hash navigation to React Router"
```

---

### Task 5: Migrate Fail2banPage tabs to URL params

**Files:**
- Modify: `src/pages/Fail2banPage.tsx`

- [ ] **Step 1: Update imports and component signature**

Add React Router imports:
```typescript
import { useParams, useNavigate } from 'react-router-dom';
```

Change component signature from:
```typescript
export const Fail2banPage: React.FC<{ onBack?: () => void; initialTab?: TabId }> = ({ initialTab }) => {
```

To:
```typescript
export const Fail2banPage: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
```

- [ ] **Step 2: Replace tab state with URL-derived state**

Add valid tabs set (needed for validation — was in App.tsx, now here):
```typescript
const VALID_TABS = new Set<TabId>([
    'jails', 'filtres', 'actions', 'tracker', 'ban', 'stats', 'carte',
    'iptables', 'ipset', 'nftables', 'config', 'audit', 'aide', 'backup',
]);
```

Replace tab state (line 133):
```typescript
const [tab, setTab] = useState<TabId>(initialTab ?? 'jails');
```

With:
```typescript
const { tab: urlTab } = useParams<{ tab?: string }>();
const navigateRouter = useNavigate();
const tab: TabId = (urlTab && VALID_TABS.has(urlTab as TabId)) ? urlTab as TabId : 'jails';
const setTab = useCallback((newTab: TabId) => {
    navigateRouter(`/fail2ban/${newTab}`);
}, [navigateRouter]);
```

This preserves the `setTab` API so all existing tab-change code continues to work.

- [ ] **Step 3: Remove hash sync useEffect**

Delete the hash sync useEffect (around line 244-247):
```typescript
// DELETE:
// useEffect(() => {
//     window.history.replaceState(null, '', `#fail2ban/${tab}`);
// }, [tab]);
```

- [ ] **Step 4: Type check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: 0

- [ ] **Step 5: Commit**

```bash
git add src/pages/Fail2banPage.tsx
git commit -m "feat: Fail2banPage tabs driven by URL params (/fail2ban/:tab)"
```

---

### Task 6: Migrate SettingsPage tabs to URL params

**Files:**
- Modify: `src/pages/SettingsPage.tsx`

- [ ] **Step 1: Add React Router imports**

```typescript
import { useParams, useNavigate } from 'react-router-dom';
```

- [ ] **Step 2: Derive tab and subtab from URL**

In the AdminPage component (around line 3834), add:
```typescript
const { tab: urlTab, subtab: urlSubtab } = useParams<{ tab?: string; subtab?: string }>();
const navigateRouter = useNavigate();
```

Replace the `activeAdminTab` initialization (line 3841):
```typescript
const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>(() => toAdminTab(storedAdminTab || initialAdminTab));
```

With:
```typescript
const resolvedTab = urlTab || storedAdminTab || initialAdminTab;
const [activeAdminTab, setActiveAdminTabState] = useState<AdminTab>(() => toAdminTab(resolvedTab));
const setActiveAdminTab = useCallback((newTab: AdminTab) => {
    setActiveAdminTabState(newTab);
    navigateRouter(`/settings/${newTab}`);
}, [navigateRouter]);
```

Replace `securitySubTab` initialization (line 3855):
```typescript
const [securitySubTab, setSecuritySubTab] = useState<'users' | 'protection' | 'network' | 'logs'>(initialSecuritySubTab ?? 'users');
```

With:
```typescript
const resolvedSubtab = (urlSubtab as 'users' | 'protection' | 'network' | 'logs') || initialSecuritySubTab || 'users';
const [securitySubTab, setSecuritySubTabState] = useState<'users' | 'protection' | 'network' | 'logs'>(resolvedSubtab);
const setSecuritySubTab = useCallback((st: 'users' | 'protection' | 'network' | 'logs') => {
    setSecuritySubTabState(st);
    navigateRouter(`/settings/security/${st}`);
}, [navigateRouter]);
```

- [ ] **Step 3: Remove hash sync useEffect**

Delete the hash sync useEffect (lines 3876-3882):
```typescript
// DELETE:
// useEffect(() => {
//     const hash = activeAdminTab === 'security'
//       ? `#config/security/${securitySubTab}`
//       : `#config/${activeAdminTab}`;
//     window.history.replaceState(null, '', hash);
//     return () => { window.history.replaceState(null, '', window.location.pathname); };
// }, [activeAdminTab, securitySubTab]);
```

Also remove the `#admin` hash check in the `initialAdminTab` useEffect (line 3871):
```typescript
// DELETE:
// if (window.location.hash === '#admin') {
//     window.history.replaceState(null, '', window.location.pathname);
// }
```

- [ ] **Step 4: Type check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: 0

- [ ] **Step 5: Commit**

```bash
git add src/pages/SettingsPage.tsx
git commit -m "feat: SettingsPage tabs driven by URL params (/settings/:tab, /settings/security/:subtab)"
```

---

### Task 7: Update App.tsx Route structure for settings subtabs

**Files:**
- Modify: `src/App.tsx`

The settings page needs to match both `/settings/:tab` and `/settings/security/:subtab`. Since App.tsx uses conditional rendering (not `<Routes>`), we need to ensure the SettingsPage component receives the URL params. Since we added `useParams()` inside SettingsPage itself (Task 6), the App.tsx conditional `if (currentPage === 'settings')` already works — `pathToPage('/settings/security/users')` returns `'settings'`, and SettingsPage reads its own params.

However, React Router needs actual Route definitions to make `useParams` work. We need to add a minimal Routes wrapper.

- [ ] **Step 1: Add Routes wrapper in App.tsx**

Import Routes and Route:
```typescript
import { useLocation, useNavigate, useSearchParams, Routes, Route } from 'react-router-dom';
```

Wrap the entire authenticated content (from the goaccess-stats check to the end) in a Routes/Route structure. Replace the series of `if (currentPage === ...)` return statements with a single return using Routes:

After all the auth loading/login checks (after line 559), replace the rendering section with:

```typescript
// ── Authenticated app — route-based rendering ─────────────────────────────

const renderContent = () => {
    // (move all the existing if-blocks here, unchanged, using currentPage)
    // ... existing conditional rendering ...
};

return (
    <Routes>
        <Route path="/fail2ban/:tab?" element={renderContent()} />
        <Route path="/settings/security/:subtab?" element={renderContent()} />
        <Route path="/settings/:tab?" element={renderContent()} />
        <Route path="/log/:pluginId?" element={renderContent()} />
        <Route path="*" element={renderContent()} />
    </Routes>
);
```

**Important:** The `renderContent()` function still uses the `currentPage` derived from `location.pathname`. The Routes structure just enables `useParams()` inside child components. The `element` prop always renders the same conditional tree — the Route matching gives us params, not rendering decisions.

- [ ] **Step 2: Type check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: 0

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add Routes wrapper for useParams support in page components"
```

---

### Task 8: Final verification and cleanup

**Files:**
- All modified files

- [ ] **Step 1: Full type check**

```bash
npx tsc 2>&1 | grep -c "error TS"
```

Expected: 0. If errors, fix them.

- [ ] **Step 2: Search for leftover hash references**

```bash
cd /home/tools/Project/LogviewR && grep -rn "window.location.hash\|#fail2ban\|#config\|#log/\|#admin\|parseHashNav\|_hashNav" src/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v ".d.ts"
```

Expected: no matches (all hash navigation code removed).

- [ ] **Step 3: Search for leftover setCurrentPage**

```bash
grep -rn "setCurrentPage" src/ --include="*.ts" --include="*.tsx"
```

Expected: no matches.

- [ ] **Step 4: Verify SPA fallback exists in server**

Confirm `server/index.ts` lines 244-252 still have the SPA fallback middleware. No changes needed — it already serves `index.html` for non-API routes.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: cleanup leftover hash navigation references"
```

---

## URL Structure Summary

| URL | Page | Tab/Param |
|-----|------|-----------|
| `/` | Dashboard | — |
| `/fail2ban` | Fail2ban | default tab (jails) |
| `/fail2ban/:tab` | Fail2ban | tab validated against VALID_TABS |
| `/settings` | Settings | default tab (general) |
| `/settings/:tab` | Settings | validated admin tab |
| `/settings/security/:subtab` | Settings | security sub-tab |
| `/log/:pluginId` | Log Viewer | plugin ID |
| `/log/:pluginId?file=/path` | Log Viewer | plugin + file path |
| `/analytics` | Analytics | — |
| `/goaccess` | GoAccess Stats | — |
| `/plugins` | Plugins | — |
| `/users` | Users | — |
| `/logs` | Logs | — |
| `/profile` | Profile | — |
| `/log-test` | Log Viewer Test | — |

## Rybbit Dashboard Expected Data

After deployment, `way.myoueb.fr` will show pageviews like:
```
/                           — Dashboard
/fail2ban/stats             — Fail2ban Stats tab
/fail2ban/tracker           — Fail2ban Tracker tab
/settings/security/users    — Settings Security > Users
/log/nginx?file=/var/log/nginx/access.log  — Log viewer
```
