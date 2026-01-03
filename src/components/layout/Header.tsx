import React, { useEffect, useState, useMemo, useRef } from 'react';
import { FileText, RefreshCw, Code, ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import logviewrLogo from '../../icons/logviewr.svg';
import { UserMenu, Clock, Tooltip } from '../ui';
import { useFavicon } from '../../hooks/useFavicon';
import { useUpdateStore } from '../../stores/updateStore';
import { usePluginStore } from '../../stores/pluginStore';
import { getVersionString } from '../../constants/version';
import { LogFileSelectorModal } from '../modals/LogFileSelectorModal';
import { RegexEditorModal } from '../modals/RegexEditorModal';
import { getPluginIcon } from '../../utils/pluginIcons';
import { api } from '../../api/client';
import type { PageType } from './Footer';
import type { LogFileInfo } from '../../types/logViewer';

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
  // Log date range for calendar button
  logDateRange?: { min?: Date; max?: Date };
  // OS type for plugin icons
  osType?: string;
  // Plugin navigation callback
  onPluginClick?: (pluginId: string) => void;
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
  // Log viewer controls
  isConnected,
  viewMode,
  onRefresh,
  onToggleViewMode,
  onPluginClick
}) => {
  const [isFileSelectorModalOpen, setIsFileSelectorModalOpen] = useState(false);
  const [isRegexEditorOpen, setIsRegexEditorOpen] = useState(false);
  const [osTypeState, setOsTypeState] = useState<string | undefined>(undefined);
  const [isPluginMenuOpen, setIsPluginMenuOpen] = useState(false);
  const [pluginMenuPosition, setPluginMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const pluginButtonRef = useRef<HTMLButtonElement>(null);
  const pluginMenuRef = useRef<HTMLDivElement>(null);

  // Use prop osType if available, otherwise use state
  const osType = osTypeProp || osTypeState;

  // Set favicon dynamically based on current page
  // invert=true to make white SVG visible on light browser tab backgrounds
  useFavicon(logviewrLogo, true);
  
  // Load OS type for plugin icons (only needed for dashboard and analytics, and if not provided as prop)
  useEffect(() => {
    if (!osTypeProp && (pageType === 'dashboard' || pageType === 'analytics')) {
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
    } else if (pageType === 'settings') {
      document.title = 'Paramètres - LogviewR';
    } else if (pageType === 'plugins') {
      document.title = 'Plugins - LogviewR';
    } else if (pageType === 'users') {
      document.title = 'Utilisateurs - LogviewR';
    } else if (pageType === 'logs') {
      document.title = 'Logs - LogviewR';
    } else {
      document.title = 'LogviewR';
    }
  }, [pageType]);
  
  // Update check info
  const { updateInfo } = useUpdateStore();
  
  // Get active plugins for dashboard and analytics pages
  const { plugins } = usePluginStore();
  const activePlugins = useMemo(() => {
    if (pageType !== 'dashboard' && pageType !== 'analytics') {
      return [];
    }
    return plugins.filter(p => p.enabled && (p.id === 'host-system' || p.id === 'nginx' || p.id === 'apache' || p.id === 'npm'));
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
    <header className="flex flex-col md:flex-row items-center justify-between p-4 bg-theme-header border-b border-theme gap-4 relative z-40" style={{ backdropFilter: 'var(--backdrop-blur)' }}>
      {/* Logo / Box identifier with Search icon */}
      <div className="flex items-center gap-2">
        {/* Logo badge - cliquable pour retour dashboard */}
        {onHomeClick && pageType !== 'dashboard' ? (
          <button
            onClick={onHomeClick}
            className="flex items-center gap-3 bg-theme-secondary px-3 py-2 rounded-lg border border-theme hover:bg-theme-primary transition-colors"
          >
            <img src={logviewrLogo} alt="LogviewR" className="w-8 h-8 flex-shrink-0" />
            <div className="flex flex-col leading-tight relative">
              <span className="font-semibold text-theme-primary">LogviewR</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400 font-normal">{getVersionString()}</span>
                {updateInfo?.updateAvailable && updateInfo.enabled && (
                  <span className="text-[9px] font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/30">
                    Nouvelle version disponible
                  </span>
                )}
              </div>
            </div>
          </button>
        ) : (
          <div className="flex items-center gap-3 bg-theme-secondary px-3 py-2 rounded-lg border border-theme">
            <img src={logviewrLogo} alt="LogviewR" className="w-8 h-8 flex-shrink-0" />
                <div className="flex flex-col leading-tight relative">
              <span className="font-semibold text-theme-primary">LogviewR</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-gray-400 font-normal">{getVersionString()}</span>
                    {updateInfo?.updateAvailable && updateInfo.enabled && (
                      <span className="text-[9px] font-semibold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded border border-amber-400/30">
                        Nouvelle version disponible
                      </span>
                    )}
                  </div>
            </div>
          </div>
        )}
      </div>

      {/* Active Plugins Icons - Only for Dashboard and Analytics pages */}
      {(pageType === 'dashboard' || pageType === 'analytics') && activePlugins.length > 0 && (
        <div className="flex items-center gap-3">
          {activePlugins
            .sort((a, b) => {
              const order = ['host-system', 'apache', 'npm', 'nginx'];
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
                className="p-2 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg transition-colors"
                title={plugin.name}
              >
                <img 
                  src={getPluginIcon(plugin.id, osType)} 
                  alt={plugin.name}
                  className="w-5 h-5 flex-shrink-0"
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
                <ChevronDown size={14} className={`text-theme-primary transition-transform ${isPluginMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Plugin Switcher Menu */}
              {isPluginMenuOpen && pluginMenuPosition && createPortal(
                <div 
                  ref={pluginMenuRef}
                  className="fixed bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-xl z-[9999] overflow-hidden min-w-[200px]"
                  style={{ 
                    top: `${pluginMenuPosition.top}px`, 
                    left: `${pluginMenuPosition.left}px`,
                    animation: 'fadeInDown 0.2s ease-out'
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
                            <span className="text-xs text-blue-400">Actif</span>
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

          {/* Log File Selector Button */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsFileSelectorModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg text-theme-primary text-sm transition-colors"
            >
              <FileText size={18} />
              <span className="hidden sm:inline">
                {selectedFilePath ? selectedFilePath.split('/').pop() : 'Fichiers de logs'}
              </span>
              <span className="sm:hidden">Fichiers</span>
            </button>
            {selectedFilePath && pluginId && (
              <Tooltip content="Éditer la regex personnalisée">
                <button
                  onClick={() => setIsRegexEditorOpen(true)}
                  className="p-2 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg text-theme-primary transition-colors"
                >
                  <Code size={18} />
                </button>
              </Tooltip>
            )}
          </div>

          {/* Control Buttons - Actualiser, Mode parsé */}
          {pageType === 'log-viewer' && (
            <div className="flex items-center gap-2">
              {/* Refresh Button - Icon only */}
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  className="p-2 bg-theme-secondary hover:bg-theme-primary border border-theme-border rounded-lg text-theme-primary transition-colors flex items-center justify-center"
                >
                  <RefreshCw size={16} />
                </button>
              )}

              {/* View Mode Toggle Button - Icon only */}
              {onToggleViewMode && (
                <button
                  onClick={onToggleViewMode}
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
          onFileSelect={onFileSelect || (() => {})}
          pluginName={pluginName}
          pluginId={pluginId}
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
    </header>
  );
};
