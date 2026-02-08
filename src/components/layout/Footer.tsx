import React, { useMemo, useState, useEffect } from 'react';
import {
  Settings,
  BarChart2,
  Home,
  FileText,
  HardDrive,
  Archive
} from 'lucide-react';
import { usePluginStore } from '../../stores/pluginStore';
import { getPluginIcon } from '../../utils/pluginIcons';
import { api } from '../../api/client';
import { Tooltip } from '../ui/Tooltip';
import type { LogPluginStats } from '../../types/logViewer';

export type PageType = 'dashboard' | 'analytics' | 'settings' | 'plugins' | 'users' | 'logs' | 'log-viewer';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

interface FooterProps {
  currentPage?: PageType;
  onPageChange?: (page: PageType) => void;
  onLogout?: () => void;
  userRole?: 'admin' | 'user' | 'viewer';
}

// Internal pages (handled within the dashboard)
// Only tabs that are actually displayed in the footer
const allTabs: { id: PageType; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: 'dashboard', label: 'LogviewR', icon: Home },
  { id: 'analytics', label: 'Analytique', icon: BarChart2 }
];

export const Footer: React.FC<FooterProps> = ({
  currentPage = 'dashboard',
  onPageChange,
  onLogout,
  userRole
}) => {
  const { plugins } = usePluginStore();
  const [osType, setOsType] = useState<string | undefined>(undefined);
  const [logStats, setLogStats] = useState<{ readableFiles: number; totalSize: number; totalSizeGz: number } | null>(null);

  // Load OS type for host-system plugin
  useEffect(() => {
    api.get<{ type: string }>('/api/log-viewer/os-type')
      .then(response => {
        if (response.success && response.result) {
          setOsType(response.result.type);
        }
      })
      .catch(err => {
        console.warn('[Footer] Failed to get OS type:', err);
      });
  }, []);

  // Filter tabs based on user role
  const visibleTabs = useMemo(() => {
    return allTabs.filter(tab => {
      // Hide admin-only tabs for non-admin users
      if (tab.adminOnly && userRole !== 'admin') {
        return false;
      }
      
      return true;
    });
  }, [userRole]);

  // Get enabled log source plugins, sorted in specific order
  const enabledLogPlugins = useMemo(() => {
    const order = ['host-system', 'apache', 'npm', 'nginx'];
    return plugins
      .filter(p => p.enabled && order.includes(p.id))
      .sort((a, b) => {
        const aIndex = order.indexOf(a.id);
        const bIndex = order.indexOf(b.id);
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
        return 0;
      });
  }, [plugins]);

  // Aggregate log stats: readable files count, total size (sans .gz), total size des .gz
  useEffect(() => {
    if (enabledLogPlugins.length === 0) {
      setLogStats(null);
      return;
    }
    let cancelled = false;
    const fetchAll = async () => {
      let totalReadable = 0;
      let totalSizeNoGz = 0;
      let totalSizeWithGz = 0;
      try {
        const quickResults = await Promise.all(
          enabledLogPlugins.map((plugin) =>
            api.get<LogPluginStats>(`/api/log-viewer/plugins/${plugin.id}/stats?quick=true`)
          )
        );
        if (cancelled) return;
        quickResults.forEach((res) => {
          if (res.success && res.result) {
            totalReadable += res.result.readableFiles ?? 0;
            totalSizeNoGz += res.result.totalSize ?? 0;
          }
        });
        const fullResults = await Promise.all(
          enabledLogPlugins.map((plugin) =>
            api.get<LogPluginStats>(`/api/log-viewer/plugins/${plugin.id}/stats`)
          )
        );
        if (cancelled) return;
        fullResults.forEach((res) => {
          if (res.success && res.result) {
            totalSizeWithGz += res.result.totalSize ?? 0;
          }
        });
        const totalSizeGz = Math.max(0, totalSizeWithGz - totalSizeNoGz);
        if (!cancelled) {
          setLogStats({
            readableFiles: totalReadable,
            totalSize: totalSizeNoGz,
            totalSizeGz
          });
        }
      } catch (err) {
        console.warn('[Footer] Failed to fetch log stats:', err);
        if (!cancelled) setLogStats(null);
      }
    };
    fetchAll();
    return () => { cancelled = true; };
  }, [enabledLogPlugins]);

  // Get plugin display name
  const getPluginName = (pluginId: string): string => {
    switch (pluginId) {
      case 'host-system':
        return 'System';
      case 'nginx':
        return 'Nginx';
      case 'apache':
        return 'Apache';
      case 'npm':
        return 'NPM';
      default:
        return 'Plugin';
    }
  };

  const handleTabClick = (tabId: PageType) => {
    // Les paramètres de l'application (Administration) restent toujours la page "settings"
    onPageChange?.(tabId);
  };

  const handlePluginClick = (pluginId: string) => {
    // Store selected plugin in sessionStorage BEFORE changing page
    // This ensures it's available when handlePageChange reads it
    sessionStorage.setItem('selectedPluginId', pluginId);
    // Navigate to log-viewer page with plugin selected
    onPageChange?.('log-viewer');
  };

  return (
    <footer className="fixed bottom-0 left-0 right-0 bg-theme-footer backdrop-blur-md border-t border-theme p-3 z-50" style={{ backdropFilter: 'var(--backdrop-blur)' }}>
      <div className="flex items-center justify-between max-w-[1920px] mx-auto px-2 gap-4">
        {/* Navigation tabs (gauche) */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar flex-1 min-w-0">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentPage === tab.id;

            // Pour bien séparer :
            // - Onglet "settings" (Administration globale) est géré via le bouton dédié sur le dashboard
            // - Ici, on garde simplement le label défini dans allTabs
            const displayLabel = tab.label;

            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all ${
                  isActive
                    ? 'btn-theme-active border-theme-hover text-theme-primary'
                    : 'btn-theme border-transparent text-theme-secondary hover:bg-theme-tertiary hover:text-theme-primary'
                }`}
              >
                <Icon size={18} />
                <span className="text-sm font-medium whitespace-nowrap">{displayLabel}</span>
              </button>
            );
          })}
          
          {/* Show "Administration" button if settings tab is hidden */}
          {!visibleTabs.find(t => t.id === 'settings') && (
            <button
              onClick={() => {
                sessionStorage.setItem('adminMode', 'true');
                onPageChange?.('settings');
              }}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border transition-all btn-theme border-transparent text-theme-secondary hover:bg-theme-tertiary hover:text-theme-primary"
            >
              <Settings size={18} />
              <span className="text-sm font-medium whitespace-nowrap">Administration</span>
            </button>
          )}
        </div>

        {/* Stats logs (centre) - nombre de fichiers lisibles + taille totale */}
        <div className="flex items-center justify-center gap-3 flex-shrink-0">
          {logStats !== null && (
            <>
              <Tooltip
                content="Nombre de fichiers de logs accessibles en lecture (tous les plugins de logs activés)"
                position="top"
              >
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400 text-sm font-medium">
                  <FileText size={16} className="flex-shrink-0" />
                  {logStats.readableFiles} fichier{logStats.readableFiles !== 1 ? 's' : ''}
                </span>
              </Tooltip>
              <Tooltip
                content="Taille totale des fichiers de logs non compressés (tous les plugins)."
                position="top"
              >
                <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm font-medium">
                  <HardDrive size={16} className="flex-shrink-0" />
                  {formatBytes(logStats.totalSize)}
                </span>
              </Tooltip>
              {logStats.totalSizeGz > 0 && (
                <Tooltip
                  content="Taille totale des fichiers de logs compressés (.gz)."
                  position="top"
                >
                  <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium">
                    <Archive size={16} className="flex-shrink-0" />
                    {formatBytes(logStats.totalSizeGz)} .gz
                  </span>
                </Tooltip>
              )}
            </>
          )}
        </div>

        {/* Plugin buttons (droite) - affichés si plugins de logs activés */}
        {enabledLogPlugins.length > 0 && (
          <div className="flex items-center gap-2 pl-2 flex-1 min-w-0 justify-end">
            {enabledLogPlugins.map((plugin) => {
              const pluginName = getPluginName(plugin.id);
              const isActive = currentPage === 'log-viewer' && sessionStorage.getItem('selectedPluginId') === plugin.id;
              const pluginIconSrc = getPluginIcon(plugin.id, plugin.id === 'host-system' ? osType : undefined);

              return (
                <button
                  key={plugin.id}
                  onClick={() => handlePluginClick(plugin.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${
                    isActive
                      ? 'btn-theme-active border-theme-hover text-theme-primary bg-theme-tertiary'
                      : 'btn-theme border-transparent text-theme-secondary hover:bg-theme-tertiary hover:text-theme-primary'
                  }`}
                  title={`Voir les logs ${pluginName}`}
                >
                  <img 
                    src={pluginIconSrc} 
                    alt={pluginName}
                    className="w-5 h-5 object-contain flex-shrink-0"
                  />
                  <span className="hidden sm:inline text-sm font-medium whitespace-nowrap">{pluginName}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </footer>
  );
};