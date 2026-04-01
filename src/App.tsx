import React, { useEffect, useState, Suspense, lazy, useMemo, useRef } from 'react';
import { Header, Footer, type PageType } from './components/layout';
import {
  Card,
  BarChart,
  DevicesList,
  HistoryLog,
  LogHistoryCard,
  ErrorFilesCard,
  DashboardSearchCard,
  LargestFilesCard
} from './components/widgets';
import { ActionButton, UnsupportedFeature } from './components/ui';
import { UserLoginModal, UserRegistrationModal } from './components/modals';

// ── Hash-based navigation (fail2ban deep links) ───────────────────────────────

// ── Hash navigation constants ─────────────────────────────────────────────────

/** Valid fail2ban tab IDs — whitelist, never used in DOM/fetch/eval. */
const VALID_FAIL2BAN_TABS = new Set([
    'jails', 'filtres', 'actions', 'tracker', 'ban', 'stats', 'carte',
    'iptables', 'ipset', 'nftables', 'config', 'audit', 'aide', 'backup',
]);

/** Plugin IDs are lowercase alphanumeric + hyphens, max 40 chars. */
const VALID_PLUGIN_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * Validate a decoded log file path from the URL hash.
 * Rules: must start with /, no null bytes, no path traversal (..),
 * only safe chars, max 500 chars. Never used in DOM or HTML injection.
 */
function isSafeFilePath(p: string): boolean {
    if (!p || p.length > 500) return false;
    if (p.includes('\0')) return false;              // null byte
    if (!p.startsWith('/')) return false;            // must be absolute
    if (/(?:^|\/)\.\.(?:\/|$)/.test(p)) return false; // path traversal
    // Allow: letters, digits, / . - _ (no spaces, no shell metacharacters)
    if (!/^[a-zA-Z0-9/._-]+$/.test(p)) return false;
    return true;
}

/**
 * Parse window.location.hash into typed navigation intent.
 *
 * Supported formats:
 *   #fail2ban           → fail2ban page, default tab (jails)
 *   #fail2ban/TAB       → fail2ban page, TAB (whitelist-validated)
 *   #log/PLUGIN_ID      → log viewer for PLUGIN_ID
 *   #log/PLUGIN_ID/FILE → log viewer for PLUGIN_ID + encoded file path
 *
 * All values are validated/sanitized before use.
 * Returns null if the hash is not a recognized deep link.
 */
type HashNav =
    | { type: 'fail2ban'; tab: string }
    | { type: 'log'; pluginId: string; filePath: string | null }
    | { type: 'config'; tab: string; subtab: string | null };

function parseHashNav(): HashNav | null {
    const raw = window.location.hash.slice(1); // strip '#'
    if (!raw) return null;
    // Split only on the FIRST slash to separate page from rest
    const slashIdx = raw.indexOf('/');
    const page = slashIdx === -1 ? raw : raw.slice(0, slashIdx);
    const rest  = slashIdx === -1 ? '' : raw.slice(slashIdx + 1);

    if (page === 'fail2ban') {
        const slashIdx2 = rest.indexOf('/');
        const tab = slashIdx2 === -1 ? rest : rest.slice(0, slashIdx2);
        return { type: 'fail2ban', tab: VALID_FAIL2BAN_TABS.has(tab) ? tab : 'jails' };
    }

    const VALID_CONFIG_TABS = new Set(['general','plugins','analysis','notifications','theme','security','exporter','database','info']);
    const VALID_SECURITY_SUBTABS = new Set(['users','protection','network','logs']);
    if (page === 'config') {
        const slashIdx2 = rest.indexOf('/');
        const tab    = slashIdx2 === -1 ? rest : rest.slice(0, slashIdx2);
        const subtab = slashIdx2 === -1 ? null  : rest.slice(slashIdx2 + 1);
        if (!VALID_CONFIG_TABS.has(tab)) return null;
        if (subtab && !VALID_SECURITY_SUBTABS.has(subtab)) return null;
        return { type: 'config', tab, subtab };
    }

    if (page === 'log') {
        const slashIdx2 = rest.indexOf('/');
        const pluginId  = slashIdx2 === -1 ? rest : rest.slice(0, slashIdx2);
        const encodedFile = slashIdx2 === -1 ? '' : rest.slice(slashIdx2 + 1);
        if (!VALID_PLUGIN_ID_RE.test(pluginId)) return null;
        let filePath: string | null = null;
        if (encodedFile) {
            try {
                const decoded = decodeURIComponent(encodedFile);
                if (isSafeFilePath(decoded)) filePath = decoded;
            } catch { /* malformed encoding — ignore */ }
        }
        return { type: 'log', pluginId, filePath };
    }

    return null;
}

// Lazy load pages for code splitting
// Use default exports when available, otherwise use named exports
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));
const GoAccessStyleStatsPage = lazy(() => import('./pages/GoAccessStyleStatsPage').then(m => ({ default: m.GoAccessStyleStatsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const PluginsPage = lazy(() => import('./pages/PluginsPage').then(m => ({ default: m.PluginsPage })));
const UsersPage = lazy(() => import('./pages/UsersPage').then(m => ({ default: m.UsersPage })));
const LogsPage = lazy(() => import('./pages/LogsPage').then(m => ({ default: m.LogsPage })));
const LogViewerTestPage = lazy(() => import('./pages/LogViewerTestPage').then(m => ({ default: m.LogViewerTestPage })));
const LogViewerPage = lazy(() => import('./pages/LogViewerPage').then(m => ({ default: m.LogViewerPage })));
const Fail2banPage = lazy(() => import('./pages/Fail2banPage').then(m => ({ default: m.Fail2banPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
import { fetchEnvironmentInfo } from './constants/version';
import { startTabTimer, dispatchTabLoaded } from './utils/tabTimer';
import {
  useUserAuthStore,
  useConnectionStore,
  useHistoryStore
} from './stores';
import { api } from './api/client';
import { usePluginStore } from './stores/pluginStore';
import { useUpdateStore } from './stores/updateStore';
import {
  Settings,
  FileText,
} from 'lucide-react';
import { initTheme } from './utils/themeManager';
import type { SettingsPageProps } from './pages/SettingsPage';
import type { LogFileInfo } from './types/logViewer';
import { usePolling } from './hooks/usePolling';
import { POLLING_INTERVALS } from './utils/constants';
import { useBackgroundAnimation } from './hooks/useBackgroundAnimation';
import { useAnimationParameters, AnimationParametersContext } from './hooks/useAnimationParameters';
import { AnimatedBackground } from './components/AnimatedBackground';

// Loading component for lazy-loaded pages
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[400px]">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
      <p className="text-gray-400 text-sm">Chargement...</p>
    </div>
  </div>
);

const App: React.FC = () => {
  // User authentication (JWT)
  const { isAuthenticated: isUserAuthenticated, isLoading: userAuthLoading, checkAuth: checkUserAuth, logout: userLogout, user } = useUserAuthStore();

  // Background animation (for full-animation theme and AnimatedBackground)
  const { variant: bgVariant, theme: themeId, fullAnimationId, prefersReducedMotion, animationSpeed } = useBackgroundAnimation();
  // Context: params for the *selected* animation (so ThemeSection shows cycle params for "Toutes" or that animation's params)
  const animationParameters = useAnimationParameters(fullAnimationId === 'off' ? 'animation.80.particle-waves' : fullAnimationId);
  // Params for the *displayed* animation: when cycling ("Toutes"), bgVariant changes so we need that animation's stored params
  const effectiveParamsId = bgVariant === 'off' ? 'animation.80.particle-waves' : bgVariant;
  const animationParametersForBackground = useAnimationParameters(effectiveParamsId);
  // When the user has one animation selected (not "Toutes"), use the SAME params for display as for editing, so sliders update in real time
  const backgroundParams =
    fullAnimationId !== 'off' && fullAnimationId === effectiveParamsId
      ? animationParameters.parameters
      : animationParametersForBackground.parameters;
  
  // Plugin store
  const { plugins, pluginStats, fetchPlugins, fetchAllStats } = usePluginStore();

  // Tab load timer — tracks whether a timed navigation is pending dispatch
  const timedNavRef = useRef(false);

  // Local state
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [defaultLogFile, setDefaultLogFile] = useState<string | null>(null);
  const [defaultFail2banTab, setDefaultFail2banTab] = useState<string | null>(null);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [checkingUsers, setCheckingUsers] = useState(true);
  const [pluginHeaderData, setPluginHeaderData] = useState<{
    pluginId: string;
    pluginName: string;
    availableFiles: LogFileInfo[];
    selectedFilePath?: string;
    onFileSelect: (filePath: string, logType: string) => void;
    filters?: import('./types/logViewer').LogFilters;
    onFiltersChange?: (filters: Partial<import('./types/logViewer').LogFilters>) => void;
    logType?: string;
    osType?: string;
    isFollowing?: boolean;
    isConnected?: boolean;
    viewMode?: 'parsed' | 'raw';
    onRefresh?: () => void;
    onToggleFollow?: () => void;
    onToggleViewMode?: () => void;
    logDateRange?: { min?: Date; max?: Date };
    liveMode?: 'off' | 'live' | 'auto';
    onStop?: () => void;
    onToggleLive?: () => void;
    onToggleAutoRefresh?: (intervalMs: number) => void;
    autoRefreshIntervalMs?: number;
  } | null>(null);

  // Check if users exist on mount
  useEffect(() => {
    let retryCount = 0;
    const maxRetries = 10;
    const retryDelay = 2000; // 2 seconds
    
    const checkUsers = async () => {
      try {
        const response = await api.get<{ hasUsers: boolean; userCount: number }>('/api/users/check');
        if (response.success && response.result) {
          setHasUsers(response.result.hasUsers);
          setCheckingUsers(false);
        } else {
          // If backend is not ready yet, retry
          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(checkUsers, retryDelay);
          } else {
            // After max retries, default to showing login (backend might be down)
            setHasUsers(true);
            setCheckingUsers(false);
          }
        }
      } catch (error: any) {
        // If connection refused (backend not ready), retry
        if (error?.status === 503 || error?.error?.code === 'CONNECTION_REFUSED') {
          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(checkUsers, retryDelay);
          } else {
            // After max retries, default to showing login
            setHasUsers(true);
            setCheckingUsers(false);
          }
        } else {
          // Other errors: default to showing login
          setHasUsers(true);
          setCheckingUsers(false);
        }
      }
    };
    
    checkUsers();
  }, []);

  // Check user auth on mount and handle URL hash
  useEffect(() => {
    // Legacy admin hash
    if (window.location.hash === '#admin') {
      window.history.replaceState(null, '', window.location.pathname);
      sessionStorage.setItem('adminMode', 'true');
    }
    // Deep link hash: #fail2ban/TAB  or  #log/PLUGIN_ID[/FILE]
    // Store intent in sessionStorage; actual navigation happens after auth resolves.
    const hashNav = parseHashNav();
    if (hashNav?.type === 'fail2ban') {
      sessionStorage.setItem('_hashNavFail2ban', hashNav.tab);
    } else if (hashNav?.type === 'log') {
      sessionStorage.setItem('_hashNavLog', JSON.stringify({ pluginId: hashNav.pluginId, filePath: hashNav.filePath }));
    } else if (hashNav?.type === 'config') {
      sessionStorage.setItem('_hashNavConfig', JSON.stringify({ tab: hashNav.tab, subtab: hashNav.subtab }));
    }
    checkUserAuth();
    
    // Listen for theme changes to force re-render
    const handleThemeChange = () => {
      // Force component re-render when theme changes by updating a dummy state
      setCurrentPage(prev => prev);
    };
    
    window.addEventListener('themechange', handleThemeChange);
    window.addEventListener('themeupdate', handleThemeChange);

    // Show re-login modal when session expires mid-session
    const handleSessionExpired = () => {
      userLogout();
    };
    window.addEventListener('auth:session-expired', handleSessionExpired);

    return () => {
      window.removeEventListener('themechange', handleThemeChange);
      window.removeEventListener('themeupdate', handleThemeChange);
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
    
    // Fetch environment info on mount
    fetchEnvironmentInfo();
    
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Load custom theme colors when user becomes authenticated
  useEffect(() => {
    if (isUserAuthenticated) {
      // Call initTheme to load custom colors from server
      initTheme().catch(err => {
        // Silently fail - default theme colors will be used
        if (import.meta.env.DEV) {
          console.debug('[Theme] Failed to load custom colors after auth:', err);
        }
      });
    }
  }, [isUserAuthenticated]);

  // Update check store
  const { loadConfig, checkForUpdates, updateInfo } = useUpdateStore();

  // Dismissable update banner: dismissed version stored in localStorage
  const [bannerDismissed, setBannerDismissed] = useState<string | null>(
    () => localStorage.getItem('logviewr-dismissed-version')
  );
  const showUpdateBanner =
    isUserAuthenticated &&
    updateInfo?.updateAvailable === true &&
    updateInfo?.latestVersion !== bannerDismissed;

  const dismissBanner = () => {
    const v = updateInfo?.latestVersion ?? '';
    localStorage.setItem('logviewr-dismissed-version', v);
    setBannerDismissed(v);
  };

  // Fetch plugins and stats when authenticated
  useEffect(() => {
    if (isUserAuthenticated) {
      fetchPlugins();
      fetchAllStats();

      // Load update check config and check for updates if enabled
      loadConfig().then(() => {
        const { updateConfig } = useUpdateStore.getState();
        if (updateConfig?.enabled) {
          checkForUpdates();
        }
      });

      // ── Deep link priority: hash nav takes precedence over server default page ──

      // fail2ban deep link
      const hashF2b = sessionStorage.getItem('_hashNavFail2ban');
      if (hashF2b) {
        sessionStorage.removeItem('_hashNavFail2ban');
        // Re-validate: only accept known tab IDs (sessionStorage could be tampered)
        const safeTab = VALID_FAIL2BAN_TABS.has(hashF2b) ? hashF2b : 'jails';
        setDefaultFail2banTab(safeTab);
        setCurrentPage('fail2ban');
        return;
      }

      // log-viewer deep link
      const hashLog = sessionStorage.getItem('_hashNavLog');
      if (hashLog) {
        sessionStorage.removeItem('_hashNavLog');
        try {
          const nav = JSON.parse(hashLog) as { pluginId?: unknown; filePath?: unknown };
          const pluginId = typeof nav.pluginId === 'string' && VALID_PLUGIN_ID_RE.test(nav.pluginId) ? nav.pluginId : null;
          const filePath = typeof nav.filePath === 'string' && isSafeFilePath(nav.filePath) ? nav.filePath : null;
          if (pluginId) {
            setSelectedPluginId(pluginId);
            if (filePath) setDefaultLogFile(filePath);
            setCurrentPage('log-viewer');
            return;
          }
        } catch { /* malformed sessionStorage — ignore */ }
      }

      // Navigate to configured default page on login
      api.get<{ defaultPage?: string; defaultPluginId?: string; defaultLogFile?: string; defaultFail2banTab?: string }>(
        '/api/system/general'
      ).then(response => {
        if (!response.success || !response.result) return;
        const { defaultPage, defaultPluginId, defaultLogFile: dlf, defaultFail2banTab: dft } = response.result;
        if (defaultPage === 'log-viewer' && defaultPluginId) {
          setSelectedPluginId(defaultPluginId);
          if (dlf) setDefaultLogFile(dlf);
          setCurrentPage('log-viewer');
        } else if (defaultPage === 'fail2ban') {
          if (dft) setDefaultFail2banTab(dft);
          setCurrentPage('fail2ban');
        } else if (defaultPage && defaultPage !== 'dashboard') {
          setCurrentPage(defaultPage as PageType);
        }
      }).catch(() => { /* keep dashboard on error */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUserAuthenticated]); // Zustand functions are stable, no need to include them

  // Polling for stats using usePolling hook
  usePolling(() => {
    if (isUserAuthenticated) {
      fetchAllStats();
    }
  }, {
    enabled: isUserAuthenticated,
    interval: POLLING_INTERVALS.dashboard,
    immediate: false // Already fetched in useEffect above
  });

  // Periodic update check based on configured frequency
  const { updateConfig } = useUpdateStore();
  usePolling(() => {
    if (isUserAuthenticated) checkForUpdates();
  }, {
    enabled: isUserAuthenticated && (updateConfig?.enabled ?? false),
    interval: (updateConfig?.frequency ?? 24) * 3600 * 1000,
    immediate: false,
  });



  // ── Hash sync for log-viewer ─────────────────────────────────────────────────
  // When a plugin + file is open, keep the URL hash updated so it can be bookmarked/shared.
  // Uses replaceState (no history entry per file change).
  useEffect(() => {
    if (currentPage !== 'log-viewer' || !selectedPluginId) return;
    const filePath = pluginHeaderData?.selectedFilePath;
    const hash = filePath
      ? `#log/${encodeURIComponent(selectedPluginId)}/${encodeURIComponent(filePath)}`
      : `#log/${encodeURIComponent(selectedPluginId)}`;
    window.history.replaceState(null, '', hash);
  }, [currentPage, selectedPluginId, pluginHeaderData?.selectedFilePath]);

  const handleLogout = () => {
    // Clear any pending deep-link navigation so a re-login starts fresh
    sessionStorage.removeItem('_hashNavFail2ban');
    sessionStorage.removeItem('_hashNavLog');
    window.history.replaceState(null, '', window.location.pathname);
    userLogout();
  };

  const handlePageChange = (page: PageType) => {
    startTabTimer();
    timedNavRef.current = true;
    // If navigating to log-viewer, check for selectedPluginId in sessionStorage FIRST
    // This ensures selectedPluginId is set before the page renders
    if (page === 'log-viewer') {
      const storedPluginId = sessionStorage.getItem('selectedPluginId');
      if (storedPluginId) {
        setSelectedPluginId(storedPluginId);
      }
    } else {
      // Clear selectedPluginId when leaving log-viewer page
      setSelectedPluginId(null);
      sessionStorage.removeItem('selectedPluginId');
    }

    // Clear deep-link hash when leaving the page it belongs to
    const h = window.location.hash;
    if (page !== 'fail2ban' && h.startsWith('#fail2ban')) {
      window.history.replaceState(null, '', window.location.pathname);
    } else if (page !== 'log-viewer' && h.startsWith('#log')) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    // Change page after state is updated
    setCurrentPage(page);
  };

  // Dispatch tab-loaded after page render (covers non-fail2ban pages)
  useEffect(() => {
    if (!timedNavRef.current) return;
    timedNavRef.current = false;
    const id = requestAnimationFrame(() => dispatchTabLoaded());
    return () => cancelAnimationFrame(id);
  }, [currentPage]);

  const handleHomeClick = () => {
    window.history.replaceState(null, '', window.location.pathname);
    handlePageChange('dashboard');
  };

  const handleSettingsClick = () => {
    setCurrentPage('settings');
  };

  const handleAdminClick = () => {
    sessionStorage.setItem('adminMode', 'true');
    setCurrentPage('settings');
    // SettingsPage will handle showing the admin tab
  };

  const handleProfileClick = () => {
    setCurrentPage('profile');
  };

  // Handle users click (navigate to users page)
  const handleUsersClick = () => {
    setCurrentPage('users');
  };


  // Show loading state while checking authentication or users
  if (userAuthLoading || checkingUsers) {
    return (
      <div className="min-h-screen bg-theme-primary flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Chargement...</p>
        </div>
      </div>
    );
  }

  // Show registration modal if no users exist and not authenticated
  if (!isUserAuthenticated && hasUsers === false) {
    return (
      <div className="min-h-screen bg-theme-primary">
        <UserRegistrationModal 
          isOpen={true} 
          onClose={() => {}} 
          onSuccess={() => {
            // After registration, user will be auto-logged in
            setHasUsers(true);
          }}
        />
      </div>
    );
  }

  // Show user login modal if users exist but not authenticated
  if (!isUserAuthenticated && hasUsers === true) {
    return (
      <div className="min-h-screen bg-theme-primary">
        <UserLoginModal 
          isOpen={true} 
          onClose={() => {}} 
          onSuccess={() => {
            // Plugins will be fetched after user login
          }}
        />
      </div>
    );
  }


  // When animation is active on dark/glass/nightly, use semi-transparent main background so the animation shows through
  const isBlackThemeWithActiveAnimation =
    (themeId === 'dark' || themeId === 'glass' || themeId === 'nightly') && bgVariant !== 'off';
  const mainContentBgClass = isBlackThemeWithActiveAnimation
    ? 'min-h-screen pb-20 bg-black/20 text-theme-primary font-sans selection:bg-accent-primary/30'
    : 'min-h-screen pb-20 bg-theme-primary text-theme-primary font-sans selection:bg-accent-primary/30';
  // Fullscreen variant: h-screen + overflow-hidden, no pb-20 (for fixed-layout pages like Fail2ban)
  const mainContentBgClassFull = isBlackThemeWithActiveAnimation
    ? 'h-full bg-black/20 text-theme-primary font-sans selection:bg-accent-primary/30'
    : 'h-full bg-theme-primary text-theme-primary font-sans selection:bg-accent-primary/30';

  // Helper: wrap content with animated background and animation params provider (ThemeSection needs the provider)
  // fullscreen=true: uses h-screen overflow-hidden — prevents window scroll on fixed-layout pages
  const wrapWithBackground = (content: React.ReactNode, fullscreen = false) => (
    <AnimationParametersContext.Provider value={animationParameters}>
      <div className={`relative ${fullscreen ? 'h-screen overflow-hidden' : 'min-h-screen'}`}>
        <AnimatedBackground
          variant={bgVariant}
          disabled={prefersReducedMotion}
          animationSpeed={animationSpeed}
          animationParameters={backgroundParams}
        />
        <div className={`relative z-0 ${fullscreen ? mainContentBgClassFull : mainContentBgClass}`}>
          {content}
        </div>
      </div>
    </AnimationParametersContext.Provider>
  );

  // Helper component to render page with footer
  const renderPageWithFooter = (pageContent: React.ReactNode) => (
    <>
      <Suspense fallback={<PageLoader />}>
        {pageContent}
      </Suspense>
      <Footer
        currentPage={currentPage}
        onPageChange={handlePageChange}
        onLogout={handleLogout}
        userRole={user?.role}
        selectedPluginId={selectedPluginId}
      />
    </>
  );

  // Render GoAccess-style stats page
  if (currentPage === 'goaccess-stats') {
    return wrapWithBackground(renderPageWithFooter(
      <>
        <Header
          pageType="goaccess-stats"
          user={user || undefined}
          onHomeClick={handleHomeClick}
          onSettingsClick={handleSettingsClick}
          onAdminClick={handleAdminClick}
          onProfileClick={handleProfileClick}
          onUsersClick={handleUsersClick}
          onLogout={handleLogout}
          onPluginClick={(pluginId) => {
            if (pluginId === 'fail2ban') {
              setCurrentPage('fail2ban');
            } else {
              setSelectedPluginId(pluginId);
              setCurrentPage('log-viewer');
            }
          }}
          updateBanner={{ show: showUpdateBanner, latestVersion: updateInfo?.latestVersion, releaseNotes: updateInfo?.releaseNotes, onDismiss: dismissBanner }}
        />
        <GoAccessStyleStatsPage onBack={() => setCurrentPage('dashboard')} />
      </>
    ));
  }

  // Render Analytics page
  if (currentPage === 'analytics') {
    return wrapWithBackground(renderPageWithFooter(
      <>
        <Header
          pageType="analytics"
          user={user || undefined}
          onHomeClick={handleHomeClick}
          onSettingsClick={handleSettingsClick}
          onAdminClick={handleAdminClick}
          onProfileClick={handleProfileClick}
          onUsersClick={handleUsersClick}
          onLogout={handleLogout}
          onPluginClick={(pluginId) => {
            if (pluginId === 'fail2ban') {
              setCurrentPage('fail2ban');
            } else {
              setSelectedPluginId(pluginId);
              setCurrentPage('log-viewer');
            }
          }}
          updateBanner={{ show: showUpdateBanner, latestVersion: updateInfo?.latestVersion, releaseNotes: updateInfo?.releaseNotes, onDismiss: dismissBanner }}
        />
        <AnalyticsPage onBack={() => setCurrentPage('dashboard')} />
      </>
    ));
  }

  // Render Profile page
  if (currentPage === 'profile') {
    return wrapWithBackground(renderPageWithFooter(
      <ProfilePage
          onBack={() => setCurrentPage('dashboard')}
          onLogout={handleLogout}
          onSettingsClick={handleSettingsClick}
          onAdminClick={handleAdminClick}
          onUsersClick={handleUsersClick}
        />
    ));
  }

  // Render Settings page
  if (currentPage === 'settings') {
    // Check if we should show administration mode (from sessionStorage)
    // Clean URL hash if present
    if (window.location.hash === '#admin') {
      window.history.replaceState(null, '', window.location.pathname);
    }
    const showAdmin = sessionStorage.getItem('adminMode') === 'true' || false;
    const adminTab = sessionStorage.getItem('adminTab') as 'general' | 'users' | 'plugins' | 'security' | 'exporter' | 'theme' | 'debug' | 'info' | undefined;
    // Hash-based config deep link: #config/TAB[/SUBTAB]
    const configHashRaw = sessionStorage.getItem('_hashNavConfig');
    const configHash = configHashRaw ? (() => { try { return JSON.parse(configHashRaw); } catch { return null; } })() : null;
    if (configHash) sessionStorage.removeItem('_hashNavConfig');
    return wrapWithBackground(renderPageWithFooter(
      <SettingsPage
        onBack={() => setCurrentPage('dashboard')}
        mode={showAdmin ? 'administration' : undefined}
        initialAdminTab={configHash?.tab ?? adminTab ?? 'general'}
        initialSecuritySubTab={configHash?.subtab ?? undefined}
        onNavigateToPage={(page) => setCurrentPage(page)}
        onUsersClick={handleUsersClick}
        onSettingsClick={handleSettingsClick}
        onAdminClick={handleAdminClick}
        onProfileClick={handleProfileClick}
        onLogout={handleLogout}
      />
    ));
  }

  // Render Plugins page
  if (currentPage === 'plugins') {
    return wrapWithBackground(renderPageWithFooter(
      <PluginsPage 
        onBack={() => setCurrentPage('dashboard')}
        onNavigateToSettings={() => {
          sessionStorage.setItem('adminMode', 'true');
          sessionStorage.setItem('adminTab', 'plugins');
          setCurrentPage('settings');
        }}
      />
    ));
  }

  // Render Users page (admin only)
  if (currentPage === 'users') {
    return wrapWithBackground(renderPageWithFooter(
      <UsersPage onBack={() => setCurrentPage('dashboard')} />
    ));
  }

  // Render Logs page (admin only)
  if (currentPage === 'logs') {
    return wrapWithBackground(renderPageWithFooter(
      <LogsPage onBack={() => setCurrentPage('dashboard')} />
    ));
  }

  // Render Log Viewer Test page
  if (currentPage === 'log-viewer-test') {
    return wrapWithBackground(renderPageWithFooter(
      <Suspense fallback={<PageLoader />}>
        <LogViewerTestPage />
      </Suspense>
    ));
  }

  // Render Log Viewer page
  if (currentPage === 'log-viewer') {
    return wrapWithBackground(
      <div className="min-h-screen bg-theme-primary flex flex-col">
        <Header 
          pageType="log-viewer"
          user={user || undefined}
          onHomeClick={() => {
            window.history.replaceState(null, '', window.location.pathname);
            setSelectedPluginId(null);
            setPluginHeaderData(null);
            handlePageChange('dashboard');
          }}
          onSettingsClick={handleSettingsClick}
          onAdminClick={handleAdminClick}
          onProfileClick={handleProfileClick}
          onUsersClick={handleUsersClick}
          onLogout={handleLogout}
          pluginId={pluginHeaderData?.pluginId}
          pluginName={pluginHeaderData?.pluginName}
          availableFiles={pluginHeaderData?.availableFiles}
          selectedFilePath={pluginHeaderData?.selectedFilePath}
          onFileSelect={pluginHeaderData?.onFileSelect}
          logType={pluginHeaderData?.logType}
          osType={pluginHeaderData?.osType}
          isConnected={pluginHeaderData?.isConnected}
          viewMode={pluginHeaderData?.viewMode}
          onRefresh={pluginHeaderData?.onRefresh}
          onToggleViewMode={pluginHeaderData?.onToggleViewMode}
          logDateRange={pluginHeaderData?.logDateRange}
          liveMode={pluginHeaderData?.liveMode}
          onStop={pluginHeaderData?.onStop}
          onToggleLive={pluginHeaderData?.onToggleLive}
          onToggleAutoRefresh={pluginHeaderData?.onToggleAutoRefresh}
          autoRefreshIntervalMs={pluginHeaderData?.autoRefreshIntervalMs}
          onPluginClick={(pluginId) => {
            setSelectedPluginId(pluginId);
            setPluginHeaderData(null);
            // The LogViewerPage will reload with the new plugin
          }}
          updateBanner={{ show: showUpdateBanner, latestVersion: updateInfo?.latestVersion, releaseNotes: updateInfo?.releaseNotes, onDismiss: dismissBanner }}
        />
        <main className="flex-1 overflow-auto">
          <Suspense fallback={<PageLoader />}>
            <LogViewerPage 
              pluginId={selectedPluginId || undefined}
              defaultLogFile={defaultLogFile || undefined}
              onBack={() => {
                setCurrentPage('dashboard');
                setSelectedPluginId(null);
                setPluginHeaderData(null);
                setDefaultLogFile(null);
              }}
              onPluginDataChange={setPluginHeaderData}
            />
          </Suspense>
        </main>
        <Footer
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onLogout={handleLogout}
          userRole={user?.role}
          selectedPluginId={selectedPluginId}
        />
      </div>
    );
  }

  // Render Fail2ban page — full-screen flex column so sidebar fills remaining height
  if (currentPage === 'fail2ban') {
    return wrapWithBackground(
      <div className="flex flex-col h-full">
        <Header
          pageType="fail2ban"
          user={user || undefined}
          onHomeClick={handleHomeClick}
          onSettingsClick={handleSettingsClick}
          onAdminClick={handleAdminClick}
          onProfileClick={handleProfileClick}
          onUsersClick={handleUsersClick}
          onLogout={handleLogout}
          onPluginClick={(pluginId) => {
            if (pluginId === 'fail2ban') {
              setCurrentPage('fail2ban');
            } else {
              setSelectedPluginId(pluginId);
              setCurrentPage('log-viewer');
            }
          }}
          updateBanner={{ show: showUpdateBanner, latestVersion: updateInfo?.latestVersion, releaseNotes: updateInfo?.releaseNotes, onDismiss: dismissBanner }}
        />
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<PageLoader />}>
            <Fail2banPage onBack={() => setCurrentPage('dashboard')} initialTab={defaultFail2banTab as any ?? undefined} />
          </Suspense>
        </div>
        <Footer
          currentPage={currentPage}
          onPageChange={handlePageChange}
          onLogout={handleLogout}
          userRole={user?.role}
          selectedPluginId={selectedPluginId}
        />
      </div>,
      true, // fullscreen: prevent window scroll (no pb-20)
    );
  }

  // Render Dashboard (default)
  if (currentPage === 'dashboard') {
    return wrapWithBackground(renderPageWithFooter(
      <>
        <Header
          pageType="dashboard"
          user={user || undefined}
          onHomeClick={handleHomeClick}
          onSettingsClick={handleSettingsClick}
          onAdminClick={handleAdminClick}
          onProfileClick={handleProfileClick}
          onUsersClick={handleUsersClick}
          onLogout={handleLogout}
          onPluginClick={(pluginId) => {
            if (pluginId === 'fail2ban') {
              setCurrentPage('fail2ban');
            } else {
              setSelectedPluginId(pluginId);
              setCurrentPage('log-viewer');
            }
          }}
          updateBanner={{ show: showUpdateBanner, latestVersion: updateInfo?.latestVersion, releaseNotes: updateInfo?.releaseNotes, onDismiss: dismissBanner }}
        />
        <main className="p-4 md:p-6 max-w-[1920px] mx-auto">
          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-2">LogviewR Dashboard</h1>
            <p className="text-gray-400">Visualiseur de logs en temps réel</p>
          </div>

          {/* Plugin Stats Cards */}
          {plugins.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-400 mb-4">Chargement des plugins...</p>
            </div>
          ) : (
            <>
              {/* Recherche globale dans tous les logs actifs */}
              <div className="mb-8">
                <DashboardSearchCard
                  onOpenFile={(pluginId, filePath, logType) => {
                    setSelectedPluginId(pluginId);
                    setDefaultLogFile(filePath);
                    setCurrentPage('log-viewer');
                  }}
                  osType={pluginHeaderData?.osType}
                  enabledPluginIds={[
                    ...plugins
                      .filter((p) => p.enabled && ['host-system', 'apache', 'npm', 'nginx'].includes(p.id))
                      .map((p) => p.id),
                    'fail2ban'
                  ]}
                />
              </div>

              {/* Plus gros fichiers de logs (top 10, tous plugins) */}
              <div className="mb-8">
                <LargestFilesCard />
              </div>

              {/* Fichiers avec erreurs (error logs) – remplace les cartes plugins sur le dashboard */}
              <div className="mb-8">
                <ErrorFilesCard
                  onOpenFile={(pluginId, filePath, _logType) => {
                    setSelectedPluginId(pluginId);
                    setDefaultLogFile(filePath);
                    setCurrentPage('log-viewer');
                  }}
                  onNavigateToAnalysis={() => {
                    sessionStorage.setItem('adminMode', 'true');
                    sessionStorage.setItem('adminTab', 'analysis');
                    setCurrentPage('settings');
                  }}
                />
              </div>

              {/* Message si aucun plugin activé */}
              {plugins.filter(p => p.enabled && (p.id === 'host-system' || p.id === 'nginx' || p.id === 'apache' || p.id === 'npm')).length === 0 && (
                <div className="text-center py-12 bg-theme-tertiary rounded-lg border border-theme-border mb-8">
                  <FileText size={48} className="mx-auto mb-4 text-gray-500" />
                  <p className="text-gray-400 mb-2">Aucun plugin de logs activé</p>
                  <p className="text-sm text-gray-500">Activez un plugin dans les paramètres pour commencer</p>
                </div>
              )}

              {/* Historique des logs */}
              <LogHistoryCard
                onOpenLog={(entry) => {
                  setSelectedPluginId(entry.pluginId);
                  setDefaultLogFile(entry.filePath);
                  setCurrentPage('log-viewer');
                }}
              />
            </>
          )}
        </main>
      </>
    ));
  }

  // Default return - fallback to dashboard if currentPage is invalid
  console.warn('[App] Invalid currentPage, falling back to dashboard:', currentPage);
  return wrapWithBackground(renderPageWithFooter(
    <>
      <Header 
        pageType="dashboard"
        user={user || undefined}
        onSettingsClick={handleSettingsClick}
        onAdminClick={handleAdminClick}
        onProfileClick={handleProfileClick}
        onUsersClick={handleUsersClick}
        onLogout={handleLogout}
        updateBanner={{ show: showUpdateBanner, latestVersion: updateInfo?.latestVersion, releaseNotes: updateInfo?.releaseNotes, onDismiss: dismissBanner }}
      />
      <main className="p-4 md:p-6 max-w-[1920px] mx-auto">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold mb-4">LogviewR Dashboard</h1>
          <p className="text-gray-400">Visualiseur de logs en temps réel</p>
        </div>
      </main>
    </>
  ));
};

export default App;