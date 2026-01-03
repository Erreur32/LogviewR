import React, { useMemo, useState, useEffect } from 'react';
import {
  Settings,
  BarChart2,
  Home
} from 'lucide-react';
import { usePluginStore } from '../../stores/pluginStore';
import { getPluginIcon } from '../../utils/pluginIcons';
import { api } from '../../api/client';
export type PageType = 'dashboard' | 'analytics' | 'settings' | 'plugins' | 'users' | 'logs' | 'log-viewer';

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
      <div className="flex items-center justify-between max-w-[1920px] mx-auto px-2">
        {/* Navigation tabs (sur la gauche) */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
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

        {/* Plugin buttons (sur la droite) - affichés si plugins de logs activés */}
        {enabledLogPlugins.length > 0 && (
          <div className="flex items-center gap-2 pl-4">
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