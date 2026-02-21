import React, { useEffect, useState, Suspense, lazy, useMemo } from 'react';
import { Header, Footer, type PageType } from './components/layout';
import {
  Card,
  BarChart,
  DevicesList,
  HistoryLog,
  LogHistoryCard,
  ErrorFilesCard
} from './components/widgets';
import { ActionButton, UnsupportedFeature } from './components/ui';
import { UserLoginModal, UserRegistrationModal } from './components/modals';

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
import { fetchEnvironmentInfo } from './constants/version';
import {
  useUserAuthStore,
  useSystemStore,
  useConnectionStore,
  useHistoryStore
} from './stores';
import { api } from './api/client';
import { usePluginStore } from './stores/pluginStore';
import { useUpdateStore } from './stores/updateStore';
import {
  Settings,
  FileText
} from 'lucide-react';
import { initTheme } from './utils/themeManager';
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

  // Data stores
  const { info: systemInfo, fetchSystemInfo } = useSystemStore();

  // Local state
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [defaultLogFile, setDefaultLogFile] = useState<string | null>(null);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [checkingUsers, setCheckingUsers] = useState(true);
  const [pluginHeaderData, setPluginHeaderData] = useState<{
    pluginId: string;
    pluginName: string;
    availableFiles: Array<{
      path: string;
      type: string;
      size: number;
      modified: Date | string;
      enabled?: boolean;
      readable?: boolean;
    }>;
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

  // Check user auth on mount and clean URL hash
  useEffect(() => {
    // Clean URL hash if present (legacy support)
    if (window.location.hash === '#admin') {
      window.history.replaceState(null, '', window.location.pathname);
      sessionStorage.setItem('adminMode', 'true');
    }
    checkUserAuth();
    
    // Listen for theme changes to force re-render
    const handleThemeChange = () => {
      // Force component re-render when theme changes by updating a dummy state
      setCurrentPage(prev => prev);
    };
    
    window.addEventListener('themechange', handleThemeChange);
    window.addEventListener('themeupdate', handleThemeChange);
    
    return () => {
      window.removeEventListener('themechange', handleThemeChange);
      window.removeEventListener('themeupdate', handleThemeChange);
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
  const { loadConfig, checkForUpdates } = useUpdateStore();

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



  const handleLogout = () => {
    userLogout();
  };

  const handlePageChange = (page: PageType) => {
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
    
    // Change page after state is updated
    setCurrentPage(page);
  };

  const handleHomeClick = () => {
    setCurrentPage('dashboard');
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
    sessionStorage.setItem('adminMode', 'true');
    setCurrentPage('settings');
    // SettingsPage will open with 'general' tab (Mon Profil)
    sessionStorage.setItem('adminTab', 'general');
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

  // Helper: wrap content with animated background and animation params provider (ThemeSection needs the provider)
  const wrapWithBackground = (content: React.ReactNode) => (
    <AnimationParametersContext.Provider value={animationParameters}>
      <div className="relative min-h-screen">
        <AnimatedBackground
          variant={bgVariant}
          disabled={prefersReducedMotion}
          animationSpeed={animationSpeed}
          animationParameters={backgroundParams}
        />
        <div className={`relative z-0 ${mainContentBgClass}`}>
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
          onSettingsClick={handleSettingsClick}
          onAdminClick={handleAdminClick}
          onProfileClick={handleProfileClick}
          onUsersClick={handleUsersClick}
          onLogout={handleLogout}
          onPluginClick={(pluginId) => {
            setSelectedPluginId(pluginId);
            setCurrentPage('log-viewer');
          }}
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
          onSettingsClick={handleSettingsClick}
          onAdminClick={handleAdminClick}
          onProfileClick={handleProfileClick}
          onUsersClick={handleUsersClick}
          onLogout={handleLogout}
          onPluginClick={(pluginId) => {
            setSelectedPluginId(pluginId);
            setCurrentPage('log-viewer');
          }}
        />
        <AnalyticsPage onBack={() => setCurrentPage('dashboard')} />
      </>
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
    // Check if we should open a specific admin tab (from sessionStorage)
    // Read it immediately to ensure it's available
    const adminTab = sessionStorage.getItem('adminTab') as 'general' | 'users' | 'plugins' | 'security' | 'exporter' | 'theme' | 'debug' | 'info' | undefined;
    // Only clear if we're actually using it (to avoid clearing it before SettingsPage reads it)
    // We'll let SettingsPage handle clearing it via useEffect
    return wrapWithBackground(renderPageWithFooter(
      <SettingsPage 
        onBack={() => setCurrentPage('dashboard')} 
        mode={showAdmin ? 'administration' : 'settings'}
        initialAdminTab={adminTab || 'general'}
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
            setCurrentPage('dashboard');
            setSelectedPluginId(null);
            setPluginHeaderData(null);
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
        />
      </div>
    );
  }

  // Render Dashboard (default)
  if (currentPage === 'dashboard') {
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
          onPluginClick={(pluginId) => {
            setSelectedPluginId(pluginId);
            setCurrentPage('log-viewer');
          }}
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
              {/* Fichiers avec erreurs (error logs) – remplace les cartes plugins sur le dashboard */}
              <div className="mb-8">
                <ErrorFilesCard
                  onOpenFile={(pluginId, filePath, _logType) => {
                    setSelectedPluginId(pluginId);
                    setDefaultLogFile(filePath);
                    setCurrentPage('log-viewer');
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
        systemInfo={systemInfo} 
        pageType="dashboard"
        user={user || undefined}
        onSettingsClick={handleSettingsClick}
        onAdminClick={handleAdminClick}
        onProfileClick={handleProfileClick}
        onUsersClick={handleUsersClick}
        onLogout={handleLogout}
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