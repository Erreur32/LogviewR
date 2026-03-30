import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { FileText, RefreshCw, Code, ChevronDown, History, Play, Square, Download, X as XIcon, Ban, CheckCircle, AlertTriangle } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import logviewrLogo from '../../icons/logviewr.svg';
import { UserMenu, Clock } from '../ui';
import { useFavicon } from '../../hooks/useFavicon';
import { useUpdateStore } from '../../stores/updateStore';
import { useNotificationStore } from '../../stores/notificationStore';
import type { AppNotification } from '../../stores/notificationStore';
import { usePluginStore } from '../../stores/pluginStore';
import { getVersionString } from '../../constants/version';
import { LogFileSelectorModal } from '../modals/LogFileSelectorModal';
import { LogFileHistoryModal, type LogFileHistoryEntry, LOGFILE_HISTORY_KEY } from '../modals/LogFileHistoryModal';
import { RegexEditorModal } from '../modals/RegexEditorModal';
import { getPluginIcon } from '../../utils/pluginIcons';
import { api } from '../../api/client';
import { AUTO_REFRESH_INTERVALS_MS } from '../../utils/constants';
import type { PageType } from './Footer';
import type { LogFileInfo } from '../../types/logViewer';

export type LiveMode = 'off' | 'live' | 'auto';

const LOGFILE_HISTORY_MAX = 50;

// ── Notification zone ─────────────────────────────────────────────────────────

function fmtAge(ts: number): string {
  const s = Math.floor((Date.now() - ts * 1000) / 1000);
  if (s < 5)   return 'à l\'instant';
  if (s < 60)  return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  return `${Math.floor(s / 3600)}h`;
}

const NotifCard: React.FC<{ n: AppNotification; onDismiss: () => void }> = ({ n, onDismiss }) => {
  const { t } = useTranslation();
  const isRecidive = n.type === 'ban' && n.jail === 'recidive';
  const banColor   = isRecidive ? '#e3b341' : '#e86a65';
  const banBorder  = isRecidive ? 'rgba(227,179,65,.45)' : 'rgba(232,106,101,.4)';

  const handleBanClick = () => {
    if (n.ip) window.dispatchEvent(new CustomEvent('open-ip-modal', { detail: { ip: n.ip } }));
    onDismiss();
  };

  if (n.type === 'ban') {
    return (
      <div style={{
        display: 'flex', alignItems: 'stretch',
        background: '#161b22', border: `1px solid ${banBorder}`,
        borderRadius: 8, overflow: 'hidden',
        boxShadow: '0 2px 12px rgba(0,0,0,.5)',
        animation: 'notif-slide-in .18s ease-out',
        flexShrink: 0,
        minWidth: 320,
        maxWidth: 480,
      }}>
        <div style={{ width: 3, flexShrink: 0, background: banColor }} />
        <button onClick={handleBanClick} title={t('header.seeIpDetail')}
          style={{ flex: 1, background: 'none', border: 'none', cursor: 'pointer', padding: '.45rem .6rem', textAlign: 'left', minWidth: 0, display: 'flex', alignItems: 'center', gap: '.45rem' }}>
          <Ban style={{ width: 11, height: 11, color: banColor, flexShrink: 0 }} />
          <span style={{ fontFamily: 'monospace', fontSize: '.8rem', fontWeight: 700, color: '#e6edf3', flexShrink: 0, whiteSpace: 'nowrap' }}>{n.ip}</span>
          <span style={{ fontSize: '.65rem', padding: '.05rem .3rem', borderRadius: 3, background: isRecidive ? 'rgba(227,179,65,.12)' : 'rgba(63,185,80,.1)', color: isRecidive ? '#e3b341' : '#3fb950', border: `1px solid ${isRecidive ? 'rgba(227,179,65,.25)' : 'rgba(63,185,80,.2)'}`, fontFamily: 'monospace', flexShrink: 0, whiteSpace: 'nowrap' }}>{n.jail}</span>
          {n.failures !== null && n.failures !== undefined && n.failures > 0 && (
            <span style={{ fontSize: '.62rem', color: '#8b949e', flexShrink: 0, whiteSpace: 'nowrap' }}>{n.failures}✕</span>
          )}
          <span style={{ fontSize: '.62rem', color: '#555d69', flexShrink: 0, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            {n.timeofban ? fmtAge(n.timeofban) : ''}
          </span>
        </button>
        <button onClick={onDismiss} title={t('common.hide')}
          style={{ background: 'none', border: 'none', borderLeft: '1px solid #21262d', color: '#555d69', cursor: 'pointer', padding: '0 .5rem', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <XIcon size={11} />
        </button>
      </div>
    );
  }

  // attempt notification
  if (n.type === 'attempt') {
    return (
      <div style={{
        display: 'flex', alignItems: 'stretch',
        background: '#161b22', border: '1px solid rgba(227,179,65,.4)',
        borderRadius: 8, overflow: 'hidden',
        boxShadow: '0 2px 12px rgba(0,0,0,.5)',
        animation: 'notif-slide-in .18s ease-out',
        flexShrink: 0, minWidth: 280, maxWidth: 480,
      }}>
        <div style={{ width: 3, flexShrink: 0, background: '#e3b341' }} />
        <div style={{ flex: 1, padding: '.45rem .6rem', display: 'flex', alignItems: 'center', gap: '.45rem', minWidth: 0 }}>
          <AlertTriangle style={{ width: 11, height: 11, color: '#e3b341', flexShrink: 0 }} />
          <span style={{ fontSize: '.75rem', color: '#e3b341', fontWeight: 600, flexShrink: 0 }}>
            +{n.delta} tentative{(n.delta ?? 0) > 1 ? 's' : ''}
          </span>
          <span style={{ fontSize: '.65rem', padding: '.05rem .3rem', borderRadius: 3, background: 'rgba(227,179,65,.12)', color: '#e3b341', border: '1px solid rgba(227,179,65,.25)', fontFamily: 'monospace', flexShrink: 0, whiteSpace: 'nowrap' }}>{n.jail}</span>
          <span style={{ fontSize: '.62rem', color: '#8b949e', flexShrink: 0, whiteSpace: 'nowrap' }}>{n.total} actives</span>
        </div>
        <button onClick={onDismiss} title={t('common.hide')}
          style={{ background: 'none', border: 'none', borderLeft: '1px solid #21262d', color: '#555d69', cursor: 'pointer', padding: '0 .5rem', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <XIcon size={11} />
        </button>
      </div>
    );
  }

  // action notification
  const okColor = n.ok ? '#3fb950' : '#e86a65';
  const okBg    = n.ok ? 'rgba(63,185,80,.12)' : 'rgba(232,106,101,.12)';
  const okBord  = n.ok ? 'rgba(63,185,80,.35)' : 'rgba(232,106,101,.35)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '.45rem',
      background: okBg, border: `1px solid ${okBord}`,
      borderRadius: 8, padding: '.45rem .65rem',
      boxShadow: '0 2px 12px rgba(0,0,0,.4)',
      animation: 'notif-slide-in .18s ease-out',
      flexShrink: 0, minWidth: 280, maxWidth: 480,
    }}>
      {n.ok
        ? <CheckCircle style={{ width: 12, height: 12, color: okColor, flexShrink: 0 }} />
        : <AlertTriangle style={{ width: 12, height: 12, color: okColor, flexShrink: 0 }} />}
      <span style={{ fontSize: '.78rem', color: okColor, fontWeight: 500, whiteSpace: 'nowrap' }}>{n.message}</span>
      <button onClick={onDismiss} title={t('common.hide')}
        style={{ background: 'none', border: 'none', color: '#555d69', cursor: 'pointer', padding: 0, marginLeft: '.2rem', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
        <XIcon size={11} />
      </button>
    </div>
  );
};

const NotificationZone: React.FC = () => {
  const { notifications, dismiss } = useNotificationStore();
  if (notifications.length === 0) return null;
  return (
    <div style={{
      position: 'absolute', left: '50%', top: '50%',
      transform: 'translate(-50%, -50%)',
      display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center',
      maxWidth: 'min(90vw, 1200px)',
      zIndex: 45,
      pointerEvents: 'none',
    }}>
      {notifications.slice(-5).map(n => (
        <div key={n.id} style={{ pointerEvents: 'auto' }}>
          <NotifCard n={n} onDismiss={() => dismiss(n.id)} />
        </div>
      ))}
    </div>
  );
};

interface HeaderProps {
  pageType?: PageType;
  onHomeClick?: () => void;
  user?: {
    username: string;
    email?: string;
    role: 'admin' | 'user' | 'viewer';
    avatar?: string;
  } | null;
  onSettingsClick?: () => void;
  onAdminClick?: () => void;
  onProfileClick?: () => void;
  onUsersClick?: () => void;
  onLogout?: () => void;
  // Plugin-specific options for LogViewer pages
  pluginId?: string;
  pluginName?: string;
  availableFiles?: LogFileInfo[];
  selectedFilePath?: string;
  onFileSelect?: (filePath: string, logType: string) => void;
  logType?: string;
  // Log viewer controls
  isConnected?: boolean;
  viewMode?: 'parsed' | 'raw';
  onRefresh?: () => void;
  onToggleViewMode?: () => void;
  logDateRange?: { min?: Date; max?: Date };
  osType?: string;
  onPluginClick?: (pluginId: string) => void;
  // Live / Auto-refresh mode
  liveMode?: LiveMode;
  onStop?: () => void;
  onToggleLive?: () => void;
  onToggleAutoRefresh?: (intervalMs: number) => void;
  autoRefreshIntervalMs?: number;
  // Update banner (rendered below the header bar)
  updateBanner?: {
    show: boolean;
    latestVersion?: string;
    releaseNotes?: string;
    onDismiss: () => void;
  };
}


export const Header: React.FC<HeaderProps> = ({ 
  pageType = 'dashboard',
  onHomeClick,
  user,
  onSettingsClick,
  onAdminClick,
  onProfileClick,
  onUsersClick,
  onLogout,
  // Plugin-specific props
  pluginId,
  pluginName,
  availableFiles = [],
  selectedFilePath,
  onFileSelect,
  logType,
  // OS type
  osType: osTypeProp,
  isConnected,
  viewMode,
  onRefresh,
  onToggleViewMode,
  onPluginClick,
  liveMode = 'off',
  onStop,
  onToggleLive,
  onToggleAutoRefresh,
  autoRefreshIntervalMs = 5000,
  updateBanner,
}) => {
  const { t } = useTranslation();

  const [isFileSelectorModalOpen, setIsFileSelectorModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isRegexEditorOpen, setIsRegexEditorOpen] = useState(false);
  const [isPlayMenuOpen, setIsPlayMenuOpen] = useState(false);
  const playMenuRef = useRef<HTMLDivElement>(null);
  const [osTypeState, setOsTypeState] = useState<string | undefined>(undefined);
  const [isPluginMenuOpen, setIsPluginMenuOpen] = useState(false);
  const [pluginMenuPosition, setPluginMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const pluginButtonRef = useRef<HTMLButtonElement>(null);
  const pluginMenuRef = useRef<HTMLDivElement>(null);

  // Log file history (persisted in localStorage)
  const [logFileHistory, setLogFileHistory] = useState<LogFileHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem(LOGFILE_HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as LogFileHistoryEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(LOGFILE_HISTORY_KEY, JSON.stringify(logFileHistory));
    } catch {
      // ignore quota or parse errors
    }
  }, [logFileHistory]);

  const addToLogFileHistory = useCallback((filePath: string, logType: string) => {
    if (!pluginId || !pluginName) return;
    setLogFileHistory((prev) => {
      const existing = prev.find((e) => e.filePath === filePath && e.pluginId === pluginId);
      const viewCount = (existing?.viewCount ?? 1) + 1;
      const entry: LogFileHistoryEntry = {
        filePath,
        logType,
        pluginId,
        pluginName,
        requestedAt: Date.now(),
        viewCount
      };
      const withoutDuplicate = prev.filter(
        (e) => !(e.filePath === filePath && e.pluginId === pluginId)
      );
      const next = [entry, ...withoutDuplicate].slice(0, LOGFILE_HISTORY_MAX);
      return next;
    });
  }, [pluginId, pluginName]);

  const clearLogFileHistory = useCallback(() => {
    setLogFileHistory([]);
  }, []);

  // Use prop osType if available, otherwise use state
  const osType = osTypeProp || osTypeState;

  // Set favicon dynamically based on current page
  // invert=true to make white SVG visible on light browser tab backgrounds
  useFavicon(logviewrLogo, true);
  
  // Load OS type for plugin icons (only needed for dashboard, analytics, goaccess-stats, and if not provided as prop)
  useEffect(() => {
    if (!osTypeProp && (pageType === 'dashboard' || pageType === 'analytics' || pageType === 'goaccess-stats')) {
      api.get<{ type: string }>('/api/log-viewer/os-type')
        .then(response => {
          if (response.success && response.result) {
            setOsTypeState(response.result.type);
          }
        })
        .catch(err => {
          console.warn('[Header] Failed to get OS type:', err);
        });
    }
  }, [pageType, osTypeProp]);

  // Update page title based on page type
  useEffect(() => {
    if (pageType === 'dashboard') {
      document.title = 'LogviewR - Dashboard';
    } else if (pageType === 'goaccess-stats') {
      document.title = 'Stats Logs - LogviewR';
    } else if (pageType === 'settings') {
      document.title = t('header.pageTitles.settings');
    } else if (pageType === 'plugins') {
      document.title = t('header.pageTitles.plugins');
    } else if (pageType === 'users') {
      document.title = t('header.pageTitles.users');
    } else if (pageType === 'logs') {
      document.title = t('header.pageTitles.logs');
    } else if (pageType === 'fail2ban') {
      document.title = 'Fail2ban - LogviewR';
    } else {
      document.title = 'LogviewR';
    }
  }, [pageType]);
  
  // Update check info
  const { updateInfo } = useUpdateStore();
  
  // Get active plugins for dashboard and analytics pages
  const { plugins } = usePluginStore();
  const activePlugins = useMemo(() => {
    if (pageType !== 'dashboard' && pageType !== 'analytics' && pageType !== 'goaccess-stats') {
      return [];
    }
    return plugins.filter(p => p.enabled && (p.id === 'host-system' || p.id === 'nginx' || p.id === 'apache' || p.id === 'npm' || p.id === 'fail2ban'));
  }, [plugins, pageType]);

  // Get active plugins for log-viewer page (for plugin switcher menu)
  const availablePlugins = useMemo(() => {
    return plugins.filter(p => p.enabled && (p.id === 'host-system' || p.id === 'nginx' || p.id === 'apache' || p.id === 'npm'))
      .sort((a, b) => {
        const order = ['host-system', 'apache', 'npm', 'nginx'];
        const aIndex = order.indexOf(a.id);
        const bIndex = order.indexOf(b.id);
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        if (aIndex !== -1) return -1;
        if (bIndex !== -1) return 1;
        return 0;
      });
  }, [plugins]);

  // Calculate plugin menu position when opened
  useEffect(() => {
    if (isPluginMenuOpen && pluginButtonRef.current) {
      const rect = pluginButtonRef.current.getBoundingClientRect();
      setPluginMenuPosition({
        top: rect.bottom + 8,
        left: rect.left
      });
    } else {
      setPluginMenuPosition(null);
    }
  }, [isPluginMenuOpen]);

  // Close plugin menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (pluginMenuRef.current && !pluginMenuRef.current.contains(event.target as Node) &&
          pluginButtonRef.current && !pluginButtonRef.current.contains(event.target as Node)) {
        setIsPluginMenuOpen(false);
      }
    };

    if (isPluginMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPluginMenuOpen]);

  return (
    <>
    <header className="flex flex-col md:flex-row items-center justify-between px-4 py-2 bg-theme-header border-b border-theme gap-3 relative z-40" style={{ backdropFilter: 'var(--backdrop-blur)' }}>
      {/* Logo / Box identifier with Search icon */}
      <div className="flex items-center gap-2">
        {/* Logo badge - cliquable pour retour dashboard */}
        {onHomeClick ? (
          <button
            onClick={onHomeClick}
            title={t('header.backToDashboard')}
            className="flex items-center gap-2 bg-theme-secondary px-2.5 py-1.5 rounded-lg border border-theme hover:bg-theme-primary transition-colors"
          >
            <img src={logviewrLogo} alt="LogviewR" className="w-8 h-8 flex-shrink-0" />
            <div className="flex flex-col leading-tight relative">
              <span className="font-semibold text-sm text-theme-primary">LogviewR</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400 font-normal">{getVersionString()}</span>
                {updateInfo?.updateAvailable && updateInfo.enabled && (
                  <span className="text-[9px] font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/30">
                    {t('header.newVersionAvailable')}
                  </span>
                )}
              </div>
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-2 bg-theme-secondary px-2.5 py-1.5 rounded-lg border border-theme">
            <img src={logviewrLogo} alt="LogviewR" className="w-8 h-8 flex-shrink-0" />
            <div className="flex flex-col leading-tight relative">
              <span className="font-semibold text-sm text-theme-primary">LogviewR</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400 font-normal">{getVersionString()}</span>
                {updateInfo?.updateAvailable && updateInfo.enabled && (
                  <span className="text-[9px] font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/30">
                    {t('header.newVersionAvailable')}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Active Plugins Icons - Only for Dashboard and Analytics pages */}
      {(pageType === 'dashboard' || pageType === 'analytics' || pageType === 'goaccess-stats') && activePlugins.length > 0 && (
        <div className="flex items-center gap-3">
          {activePlugins
            .sort((a, b) => {
              const order = ['host-system', 'apache', 'npm', 'nginx', 'fail2ban'];
              const aIndex = order.indexOf(a.id);
              const bIndex = order.indexOf(b.id);
              if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
              if (aIndex !== -1) return -1;
              if (bIndex !== -1) return 1;
              return 0;
            })
            .map(plugin => (
              <button
                key={plugin.id}
                onClick={() => onPluginClick?.(plugin.id)}
                className="p-1 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg transition-colors"
                title={plugin.name}
              >
                <img
                  src={getPluginIcon(plugin.id, osType)}
                  alt={plugin.name}
                  className="w-6 h-6 flex-shrink-0"
                />
              </button>
            ))}
        </div>
      )}

      {/* Log File Selector Button and Filters for LogViewer pages */}
      {pageType === 'log-viewer' && pluginId && availableFiles && availableFiles.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          {/* Plugin Name with Icon - Clickable to show plugin switcher */}
          {pluginName && (
            <div className="relative">
              <button
                ref={pluginButtonRef}
                onClick={() => setIsPluginMenuOpen(!isPluginMenuOpen)}
                className="flex items-center gap-2 px-3 py-2 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg transition-colors"
              >
                <img 
                  src={getPluginIcon(pluginId || '', osType)} 
                  alt={pluginName}
                  className="w-5 h-5 flex-shrink-0"
                />
                <span className="text-sm font-medium text-theme-primary">
                  {pluginName}
                </span>
                {availableFiles && availableFiles.length > 0 && (
                  <span className="text-xs text-gray-400 bg-gray-700/50 px-1.5 py-0.5 rounded">
                    {availableFiles.length}
                  </span>
                )}
                <ChevronDown size={14} className={`text-theme-primary ${isPluginMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Plugin Switcher Menu */}
              {isPluginMenuOpen && pluginMenuPosition && createPortal(
                <div 
                  ref={pluginMenuRef}
                  className="fixed bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-xl z-[9999] overflow-hidden min-w-[200px]"
                  style={{ 
                    top: `${pluginMenuPosition.top}px`, 
                    left: `${pluginMenuPosition.left}px`
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="py-1">
                    {availablePlugins.map((plugin) => {
                      const isCurrentPlugin = plugin.id === pluginId;
                      return (
                        <button
                          key={plugin.id}
                          onClick={() => {
                            if (!isCurrentPlugin && onPluginClick) {
                              onPluginClick(plugin.id);
                              setIsPluginMenuOpen(false);
                            }
                          }}
                          disabled={isCurrentPlugin}
                          className={`w-full px-4 py-2.5 text-left text-sm transition-colors flex items-center gap-3 ${
                            isCurrentPlugin
                              ? 'bg-blue-900/30 text-blue-300 cursor-default'
                              : 'text-gray-300 hover:bg-[#252525] hover:text-white cursor-pointer'
                          }`}
                        >
                          <img 
                            src={getPluginIcon(plugin.id, plugin.id === 'host-system' ? osType : undefined)} 
                            alt={plugin.name}
                            className="w-5 h-5 flex-shrink-0"
                          />
                          <span className="flex-1">{plugin.name}</span>
                          {isCurrentPlugin && (
                            <span className="text-xs text-blue-400">{t('header.currentPlugin')}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>,
                document.body
              )}
            </div>
          )}

          {/* Log File Selector Button + History Button - use native title to avoid Tooltip wrapper flickering */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsFileSelectorModalOpen(true)}
              title={t('header.chooseLogFile')}
              className="flex items-center gap-2 px-4 py-2 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg text-theme-primary text-sm transition-colors"
            >
              <FileText size={18} />
              <span className="hidden sm:inline">
                {selectedFilePath ? selectedFilePath.split('/').pop() : t('header.logFiles')}
              </span>
              <span className="sm:hidden">{t('header.filesShort')}</span>
            </button>
            <button
              type="button"
              onClick={() => setIsHistoryModalOpen(true)}
              title={t('header.logFileHistory')}
              className="p-2 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg text-theme-primary transition-colors"
            >
              <History size={18} />
            </button>
            {selectedFilePath && pluginId && (
              <button
                type="button"
                onClick={() => setIsRegexEditorOpen(true)}
                title={t('header.editCustomRegex')}
                className="p-2 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg text-theme-primary transition-colors"
              >
                <Code size={18} />
              </button>
            )}
          </div>

          {/* Control Buttons - Play/Stop (when file selected), Actualiser, Mode parsé / brut */}
          {pageType === 'log-viewer' && (
            <div className="flex items-center gap-2">
              {/* Play / Stop - only when a file is selected */}
              {selectedFilePath && (liveMode === 'off' ? (
                <div className="relative" ref={playMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsPlayMenuOpen((open) => !open)}
                    title={t('header.startLiveTracking')}
                    className="p-2 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg text-theme-primary transition-colors flex items-center justify-center"
                    aria-expanded={isPlayMenuOpen}
                    aria-haspopup="true"
                  >
                    <Play size={16} />
                  </button>
                  {isPlayMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        aria-hidden
                        onClick={() => setIsPlayMenuOpen(false)}
                      />
                      <div
                        className="absolute right-0 top-full mt-1 z-50 min-w-[200px] py-2 bg-theme-secondary border border-theme-border rounded-lg shadow-lg"
                        role="menu"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="w-full px-4 py-2 text-left text-sm text-theme-primary hover:bg-theme-tertiary flex items-center gap-2"
                          onClick={() => {
                            onToggleLive?.();
                            setIsPlayMenuOpen(false);
                          }}
                        >
                          <Play size={14} />
                          {t('header.liveRealtime')}
                        </button>
                        <div className="border-t border-theme-border my-2" />
                        <div className="px-4 py-2 text-xs text-theme-secondary mb-1">{t('header.autoRefresh')}</div>
                        <div className="flex flex-wrap gap-1 px-2">
                          {AUTO_REFRESH_INTERVALS_MS.map((ms) => (
                            <button
                              key={ms}
                              type="button"
                              role="menuitem"
                              className="px-3 py-1.5 text-xs rounded border border-theme-border bg-theme-primary/50 hover:bg-theme-tertiary text-theme-primary"
                              onClick={() => {
                                onToggleAutoRefresh?.(ms);
                                setIsPlayMenuOpen(false);
                              }}
                            >
                              {ms / 1000}s
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onStop}
                  title={liveMode === 'live' ? t('header.stopLive') : t('header.stopAutoRefresh', { interval: autoRefreshIntervalMs / 1000 })}
                  className="p-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 rounded-lg text-emerald-400 transition-colors flex items-center justify-center"
                >
                  <Square size={16} />
                </button>
              ))}

              {/* Refresh Button */}
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  title={t('header.reloadLogs')}
                  className="p-2 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg text-theme-primary transition-colors flex items-center justify-center"
                >
                  <RefreshCw size={16} />
                </button>
              )}

              {/* View Mode Toggle (parsed / raw) */}
              {onToggleViewMode && (
                <button
                  type="button"
                  onClick={onToggleViewMode}
                  title={viewMode === 'raw' ? t('header.switchToParsed') : t('header.switchToRaw')}
                  className={`p-2 border rounded-lg transition-colors flex items-center justify-center ${
                    viewMode === 'raw'
                      ? 'bg-purple-500/20 border-purple-500/50 text-purple-400'
                      : 'bg-theme-secondary hover:bg-theme-primary border-theme-border text-theme-primary'
                  }`}
                >
                  <FileText size={16} />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Log File Selector Modal */}
      {pageType === 'log-viewer' && pluginId && availableFiles && availableFiles.length > 0 && (
        <LogFileSelectorModal
          key={`${pluginId}-${availableFiles.map(f => f.path).join('|')}`}
          isOpen={isFileSelectorModalOpen}
          onClose={() => setIsFileSelectorModalOpen(false)}
          files={availableFiles}
          selectedFilePath={selectedFilePath}
          onFileSelect={(filePath, logType) => {
            addToLogFileHistory(filePath, logType);
            onFileSelect?.(filePath, logType);
          }}
          pluginName={pluginName}
          pluginId={pluginId}
        />
      )}

      {/* Log File History Modal - click entry to open that log */}
      {pageType === 'log-viewer' && (
        <LogFileHistoryModal
          isOpen={isHistoryModalOpen}
          onClose={() => setIsHistoryModalOpen(false)}
          entries={logFileHistory}
          onClearHistory={clearLogFileHistory}
          onSelectEntry={(entry) => {
            if (entry.pluginId === pluginId) {
              onFileSelect?.(entry.filePath, entry.logType);
            } else {
              try {
                sessionStorage.setItem('logviewer_pending_file', JSON.stringify({
                  pluginId: entry.pluginId,
                  filePath: entry.filePath,
                  logType: entry.logType
                }));
              } catch {
                // ignore
              }
              onPluginClick?.(entry.pluginId);
            }
            setIsHistoryModalOpen(false);
          }}
          osType={osType}
        />
      )}

      {/* Regex Editor Modal */}
      {pageType === 'log-viewer' && pluginId && selectedFilePath && logType && (
        <RegexEditorModal
          isOpen={isRegexEditorOpen}
          onClose={() => setIsRegexEditorOpen(false)}
          pluginId={pluginId}
          filePath={selectedFilePath}
          logType={logType}
          onSave={() => {
            // Trigger refresh if onRefresh is available
            if (onRefresh) {
              setTimeout(() => {
                onRefresh();
              }, 500);
            }
          }}
        />
      )}

      {/* Clock and User Menu */}
      <div className="flex items-center gap-2">
        <Clock />
        {user && user.username && (
          <UserMenu
            user={user}
            onSettingsClick={onSettingsClick}
            onAdminClick={onAdminClick}
            onProfileClick={onProfileClick}
            onUsersClick={onUsersClick}
            onLogout={onLogout}
          />
        )}
      </div>

      {/* Centered notification zone — absolutely positioned to avoid disturbing flex layout */}
      <NotificationZone />
      <style>{`@keyframes notif-slide-in { from { opacity:0; transform:translateY(-6px) scale(.96); } to { opacity:1; transform:translateY(0) scale(1); } }`}</style>
    </header>
    {updateBanner?.show && (
      <div style={{
        background: 'linear-gradient(90deg, rgba(245,158,11,.15) 0%, rgba(245,158,11,.08) 100%)',
        borderBottom: '1px solid rgba(245,158,11,.35)',
        padding: '.45rem 1rem', fontSize: '.82rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
          <Download size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
          <span style={{ color: '#fbbf24', fontWeight: 600 }}>
            {t('header.newVersionAvailable')} : v{updateBanner.latestVersion}
          </span>
          <span style={{ color: '#9ca3af', fontSize: '.75rem' }}>
            — Image Docker prête ·
          </span>
          <code style={{
            fontSize: '.72rem', color: '#67e8f9', fontFamily: 'monospace',
            background: 'rgba(0,0,0,.3)', padding: '.1rem .45rem', borderRadius: 4,
          }}>
            docker compose pull &amp;&amp; docker compose up -d
          </code>
          <button
            onClick={updateBanner.onDismiss}
            title={t('common.hide')}
            style={{
              marginLeft: 'auto', background: 'none', border: 'none',
              cursor: 'pointer', color: '#6b7280', padding: '.15rem',
              display: 'flex', flexShrink: 0,
            }}
          >
            <XIcon size={14} />
          </button>
        </div>
        {updateBanner.releaseNotes && (
          <div style={{
            marginTop: '.3rem', paddingLeft: '1.4rem',
            color: '#9ca3af', fontSize: '.74rem', lineHeight: 1.5,
            whiteSpace: 'pre-wrap', maxHeight: '3.5rem', overflow: 'hidden',
          }}>
            {updateBanner.releaseNotes}
          </div>
        )}
      </div>
    )}
    </>
  );
};
