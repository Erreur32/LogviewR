import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import {
  Settings,
  Wifi,
  Network,
  HardDrive,
  Shield,
  Server,
  Monitor,
  Database,
  ChevronLeft,
  Loader2,
  AlertCircle,
  Save,
  RefreshCw,
  Globe,
  Lock,
  Power,
  Clock as ClockIcon,
  Users,
  Share2,
  ExternalLink,
  Plus,
  Trash2,
  Edit2,
  Calendar,
  Lightbulb,
  FileText,
  Plug,
  User as UserIcon,
  Mail,
  Key,
  Eye,
  EyeOff,
  Info,
  Github,
  Sparkles,
  Download,
  Code,
  BarChart3,
  Bell,
  Star,
  GitFork
} from 'lucide-react';
import { api } from '../api/client';
import { API_ROUTES, formatBytes } from '../utils/constants';
import { getPermissionErrorMessage } from '../utils/permissions';
import { usePluginStore } from '../stores/pluginStore';
import { useUserAuthStore, type User } from '../stores/userAuthStore';
import { ExporterSection } from '../components/ExporterSection';
import { PluginsManagementSection } from '../components/PluginsManagementSection';
import { LogsManagementSection } from '../components/LogsManagementSection';
import { RegexManagementSection } from '../components/RegexManagementSection';
import logviewrLogo from '../icons/logviewr.svg';
import { APP_VERSION, getVersionString } from '../constants/version';
import { SecuritySection } from '../components/SecuritySection';
import { ThemeSection } from '../components/ThemeSection';
import { Section, SettingRow } from '../components/SettingsSection';
import { useUpdateStore } from '../stores/updateStore';
import { UserMenu, Clock } from '../components/ui';
import { useTranslation } from 'react-i18next';
import { setAppLanguage, getAppLanguage } from '../i18n';

interface SettingsPageProps {
  onBack: () => void;
  mode?: 'administration';
  initialAdminTab?: 'general' | 'users' | 'plugins' | 'security' | 'exporter' | 'theme' | 'debug' | 'info' | 'analysis' | 'notifications';
  onNavigateToPage?: (page: 'plugins' | 'users') => void;
  onUsersClick?: () => void;
  onSettingsClick?: () => void;
  onAdminClick?: () => void;
  onProfileClick?: () => void;
  onLogout?: () => void;
}

type AdminTab = 'general' | 'plugins' | 'security' | 'exporter' | 'theme' | 'debug' | 'info' | 'database' | 'regex' | 'analysis' | 'notifications';

// Toggle component
const Toggle: React.FC<{
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}> = ({ enabled, onChange, disabled }) => (
  <button
    onClick={() => !disabled && onChange(!enabled)}
    disabled={disabled}
    className={`relative w-11 h-6 rounded-full transition-colors ${
      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
    } ${enabled ? 'bg-emerald-500' : 'bg-gray-600'}`}
  >
    <span
      className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
        enabled ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);

// Types for API responses
interface PurgeResponse {
  deleted: number;
  retentionDays?: number;
}

interface PurgeAllResponse {
  totalDeleted?: number;
  historyDeleted?: number;
  scansDeleted?: number;
  offlineDeleted?: number;
  latencyMeasurementsDeleted?: number;
}

interface DatabaseStatsResponse {
  scansCount?: number;
  historyCount?: number;
  oldestScan?: string;
  oldestHistory?: string;
  totalSize?: number;
}

// Plugin Priority Configuration Section Component
const PluginPrioritySection: React.FC = () => {
  const { plugins } = usePluginStore();
  const [config, setConfig] = useState({
    hostnamePriority: [] as string[],
    vendorPriority: [] as string[],
    overwriteExisting: {
      hostname: true,
      vendor: true
    }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/api/network-scan/plugin-priority-config');
      if (response.success && response.result) {
        setConfig(response.result);
        setMessage(null);
      } else {
        setMessage({ type: 'error', text: response.error?.message || 'Erreur lors du chargement de la configuration' });
      }
    } catch (error: any) {
      console.error('Failed to load plugin priority config:', error);
      setMessage({ type: 'error', text: 'Erreur lors du chargement de la configuration' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await api.post('/api/network-scan/plugin-priority-config', config);
      if (response.success) {
        setMessage({ type: 'success', text: 'Configuration sauvegardée avec succès' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: response.error?.message || 'Erreur lors de la sauvegarde' });
      }
    } catch (error: any) {
      console.error('Failed to save plugin priority config:', error);
      setMessage({ type: 'error', text: 'Erreur lors de la sauvegarde' });
    } finally {
      setIsSaving(false);
    }
  };

  const movePriority = (type: 'hostname' | 'vendor', index: number, direction: 'up' | 'down') => {
    const priority = [...config[`${type}Priority`]];
    if (direction === 'up' && index > 0) {
      [priority[index], priority[index - 1]] = [priority[index - 1], priority[index]];
    } else if (direction === 'down' && index < priority.length - 1) {
      [priority[index], priority[index + 1]] = [priority[index + 1], priority[index]];
    }
    setConfig({ ...config, [`${type}Priority`]: priority });
  };

  const getPluginLabel = (pluginId: string): string => {
    const plugin = plugins.find(p => p.id === pluginId);
    return plugin?.name || pluginId;
  };

  const isPluginEnabled = (pluginId: string): boolean => {
    const plugin = plugins.find(p => p.id === pluginId);
    return plugin?.enabled || false;
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-3 rounded-lg ${
          message.type === 'success' ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-400' : 'bg-red-500/20 border border-red-500/50 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      <div className="p-4 bg-[#1a1a1a] rounded-lg border border-gray-800">
        <p className="text-sm text-gray-400 mb-4">
          Configurez l'ordre de priorité des plugins pour la détection des hostnames et vendors.
          Le plugin en première position a la priorité la plus élevée.
        </p>

        {/* Hostname Priority */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Network size={16} />
            Priorité Hostname
          </h4>
          <div className="space-y-2">
            {config.hostnamePriority.map((pluginId, index) => (
              <div key={pluginId} className="flex items-center gap-2 p-2 bg-[#0f0f0f] rounded border border-gray-800">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs text-gray-500 w-6">{index + 1}.</span>
                  <span className={`text-sm ${isPluginEnabled(pluginId) ? 'text-gray-200' : 'text-gray-500'}`}>
                    {getPluginLabel(pluginId)}
                  </span>
                  {!isPluginEnabled(pluginId) && pluginId !== 'scanner' && (
                    <span className="text-xs text-orange-400">(désactivé)</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => movePriority('hostname', index, 'up')}
                    disabled={index === 0}
                    className="p-1 hover:bg-blue-500/10 text-blue-400 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Monter"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => movePriority('hostname', index, 'down')}
                    disabled={index === config.hostnamePriority.length - 1}
                    className="p-1 hover:bg-blue-500/10 text-blue-400 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Descendre"
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Vendor Priority */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <HardDrive size={16} />
            Priorité Vendor
          </h4>
          <div className="space-y-2">
            {config.vendorPriority.map((pluginId, index) => (
              <div key={pluginId} className="flex items-center gap-2 p-2 bg-[#0f0f0f] rounded border border-gray-800">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs text-gray-500 w-6">{index + 1}.</span>
                  <span className={`text-sm ${isPluginEnabled(pluginId) ? 'text-gray-200' : 'text-gray-500'}`}>
                    {getPluginLabel(pluginId)}
                  </span>
                  {!isPluginEnabled(pluginId) && pluginId !== 'scanner' && (
                    <span className="text-xs text-orange-400">(désactivé)</span>
                  )}
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => movePriority('vendor', index, 'up')}
                    disabled={index === 0}
                    className="p-1 hover:bg-blue-500/10 text-blue-400 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Monter"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => movePriority('vendor', index, 'down')}
                    disabled={index === config.vendorPriority.length - 1}
                    className="p-1 hover:bg-blue-500/10 text-blue-400 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Descendre"
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Overwrite Options */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-gray-300 mb-3">Écrasement des données existantes</h4>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.overwriteExisting.hostname}
                onChange={(e) => setConfig({
                  ...config,
                  overwriteExisting: { ...config.overwriteExisting, hostname: e.target.checked }
                })}
                className="w-4 h-4 rounded border-gray-600 bg-[#1a1a1a] text-blue-500 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm text-gray-200">Écraser les hostnames existants</span>
                <p className="text-xs text-gray-400">
                  Si activé, les hostnames détectés par les plugins remplaceront les hostnames existants même s'ils sont déjà renseignés.
                  <br />
                  <span className="text-gray-500">Recommandé : Activé pour toujours avoir les hostnames les plus récents depuis vos équipements réseau.</span>
                </p>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={config.overwriteExisting.vendor}
                onChange={(e) => setConfig({
                  ...config,
                  overwriteExisting: { ...config.overwriteExisting, vendor: e.target.checked }
                })}
                className="w-4 h-4 rounded border-gray-600 bg-[#1a1a1a] text-blue-500 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm text-gray-200">Écraser les vendors existants</span>
                <p className="text-xs text-gray-400">
                  Si activé, les vendors détectés par les plugins remplaceront les vendors existants même s'ils sont déjà renseignés.
                  <br />
                  <span className="text-gray-500">Note : Les vendors vides ou invalides seront toujours recherchés depuis la base Wireshark/OUI, même si cette option est désactivée.</span>
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white flex items-center gap-2"
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Sauvegarder
          </button>
          <button
            onClick={loadConfig}
            disabled={isLoading}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white flex items-center gap-2"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            Actualiser
          </button>
        </div>
      </div>
    </div>
  );
};

// Database Performance Section Component
const DatabasePerformanceSection: React.FC = () => {
  const [dbConfig, setDbConfig] = useState({
    walMode: 'WAL' as 'WAL' | 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'OFF',
    walCheckpointInterval: 1000,
    walAutoCheckpoint: true,
    synchronous: 1 as 0 | 1 | 2,
    cacheSize: -64000,
    busyTimeout: 5000,
    tempStore: 0 as 0 | 1 | 2,
    optimizeForDocker: true
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadDbConfig();
  }, []);

  const loadDbConfig = async () => {
    setIsLoading(true);
    try {
      const response = await api.get('/api/database/config');
      if (response.success && response.result) {
        setDbConfig(response.result);
      } else {
        setMessage({ type: 'error', text: response.error?.message || 'Erreur lors du chargement de la configuration' });
      }
    } catch (error: any) {
      console.error('Failed to load DB config:', error);
      setMessage({ type: 'error', text: 'Erreur lors du chargement de la configuration' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await api.post('/api/database/config', dbConfig);
      if (response.success && response.result) {
        setDbConfig(response.result);
        setMessage({ type: 'success', text: 'Configuration de performance sauvegardée' });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: response.error?.message || 'Erreur lors de la sauvegarde' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: 'Erreur lors de la sauvegarde' });
    } finally {
      setIsSaving(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  if (isLoading) {
    return (
      <div className="py-4 text-center text-gray-500">
        <Loader2 size={24} className="animate-spin mx-auto mb-2" />
        Chargement de la configuration...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className={`p-3 rounded-lg ${
          message.type === 'success' 
            ? 'bg-emerald-900/20 border border-emerald-700/50 text-emerald-400' 
            : 'bg-red-900/20 border border-red-700/50 text-red-400'
        }`}>
          {message.text}
        </div>
      )}


      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-6">
          <SettingRow
            label="Optimisations Docker"
            description="Active les optimisations spécifiques pour Docker (checkpoint WAL automatique toutes les 5 min)"
          >
            <Toggle
              enabled={dbConfig.optimizeForDocker}
              onChange={(enabled) => setDbConfig({ ...dbConfig, optimizeForDocker: enabled })}
            />
          </SettingRow>

          <SettingRow
            label="Checkpoint WAL automatique"
            description="Active le checkpoint WAL automatique (recommandé pour Docker)"
          >
            <Toggle
              enabled={dbConfig.walAutoCheckpoint}
              onChange={(enabled) => setDbConfig({ ...dbConfig, walAutoCheckpoint: enabled })}
            />
          </SettingRow>

          <SettingRow
            label="Mode WAL"
            description="Mode de journalisation (WAL recommandé pour Docker)"
          >
            <select
              value={dbConfig.walMode}
              onChange={(e) => setDbConfig({ ...dbConfig, walMode: e.target.value as any })}
              className="px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            >
              <option value="WAL">WAL (Recommandé)</option>
              <option value="DELETE">DELETE</option>
              <option value="TRUNCATE">TRUNCATE</option>
              <option value="PERSIST">PERSIST</option>
              <option value="MEMORY">MEMORY</option>
              <option value="OFF">OFF</option>
            </select>
          </SettingRow>
        </div>

        <div className="space-y-6">
          <SettingRow
            label="Mode synchrone"
            description="0=OFF (rapide, risqué), 1=NORMAL (équilibré), 2=FULL (sûr, lent)"
          >
            <select
              value={dbConfig.synchronous}
              onChange={(e) => setDbConfig({ ...dbConfig, synchronous: parseInt(e.target.value) as 0 | 1 | 2 })}
              className="px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            >
              <option value="0">OFF (Rapide)</option>
              <option value="1">NORMAL (Recommandé)</option>
              <option value="2">FULL (Sûr)</option>
            </select>
          </SettingRow>

          <SettingRow
            label="Taille du cache (KB)"
            description="Cache SQLite en KB (négatif = KB, positif = pages). Défaut: -64000 (64 MB)"
          >
            <div className="flex items-center gap-3">
              <input
                type="number"
                value={dbConfig.cacheSize}
                onChange={(e) => setDbConfig({ ...dbConfig, cacheSize: parseInt(e.target.value) || -64000 })}
                className="w-32 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500"
              />
              <span className="text-sm text-gray-400">
                ({formatBytes(Math.abs(dbConfig.cacheSize) * 1024)})
              </span>
            </div>
          </SettingRow>

          <SettingRow
            label="Timeout de verrouillage (ms)"
            description="Temps d'attente pour les verrous de base de données (défaut: 5000ms)"
          >
            <input
              type="number"
              min="1000"
              max="60000"
              step="1000"
              value={dbConfig.busyTimeout}
              onChange={(e) => setDbConfig({ ...dbConfig, busyTimeout: parseInt(e.target.value) || 5000 })}
              className="w-32 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            />
          </SettingRow>

 
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-white flex items-center gap-2"
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Sauvegarder
        </button>
      </div>
  </div>
  );
};

// App Logs Section Component (for Administration > Debug tab)
const AppLogsSection: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<Array<{
    timestamp: string;
    level: 'error' | 'warn' | 'info' | 'debug' | 'verbose';
    prefix: string;
    message: string;
    args?: any[];
  }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [liveMode] = useState(false); // Live mode disabled - button removed
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info' | 'debug' | 'verbose'>('all');
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [totalLogs, setTotalLogs] = useState(0);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll removed (live mode disabled)

  // Load initial logs when component mounts or filter changes
  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, showAllLogs]);

  // Scroll to bottom when logs are updated
  useEffect(() => {
    if (logs.length > 0 && logsContainerRef.current) {
            setTimeout(() => {
        if (logsContainerRef.current) {
          logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
      }, 100);
    }
  }, [logs]);

  // Live mode removed - no auto-refresh polling

  const loadLogs = async () => {
    setIsLoading(true);
    try {
      // Load all logs if showAllLogs is true, otherwise limit to 500
      const limit = showAllLogs ? '10000' : '500'; // Max 10000 for performance
      const params = new URLSearchParams({ limit });
      if (filter !== 'all') {
        params.append('level', filter);
      }
      const response = await api.get<{ logs: any[]; total: number }>(`/api/debug/logs?${params}`);
      if (response.success && response.result) {
        setLogs(response.result.logs);
        setTotalLogs(response.result.total || 0);
        // Scroll to bottom after logs are loaded
          setTimeout(() => {
          if (logsContainerRef.current) {
            logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
            }
        }, 100);
      }
    } catch (error) {
      console.error('[AppLogsSection] Error loading logs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const clearLogs = async () => {
    if (!confirm(t('debug.clearConfirm'))) return;
    try {
      await api.delete('/api/debug/logs');
      setLogs([]);
      setTotalLogs(0);
    } catch (error) {
      console.error('[AppLogsSection] Error clearing logs:', error);
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'text-red-400';
      case 'warn':
        return 'text-yellow-400';
      case 'info':
        return 'text-cyan-400';
      case 'debug':
        return 'text-blue-400';
      case 'verbose':
        return 'text-magenta-400';
      default:
        return 'text-gray-400';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('fr-FR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  // Memoize filtered logs to ensure updates when logs or filter change
  const filteredLogs = useMemo(() => {
    if (filter === 'all') {
      return logs;
    }
    return logs.filter(log => log.level === filter);
  }, [logs, filter]);

  return (
    <>
      <div className="flex items-center justify-between mb-4 mt-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'all'
                ? 'bg-gray-600 text-white border-2 border-gray-500'
                : 'bg-[#1a1a1a] text-gray-400 border border-gray-700 hover:bg-gray-800 hover:text-gray-300'
            }`}
            title={t('debug.filterAllTitle')}
          >
            {t('debug.filterAll')}
          </button>
          <button
            onClick={() => setFilter('error')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'error'
                ? 'bg-red-600 text-white border-2 border-red-400'
                : 'bg-[#1a1a1a] text-red-400 border border-red-800/50 hover:bg-red-900/20 hover:text-red-300'
            }`}
            title={t('debug.filterErrorTitle')}
          >
            {t('debug.filterError')}
          </button>
          <button
            onClick={() => setFilter('warn')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'warn'
                ? 'bg-yellow-600 text-white border-2 border-yellow-400'
                : 'bg-[#1a1a1a] text-yellow-400 border border-yellow-800/50 hover:bg-yellow-900/20 hover:text-yellow-300'
            }`}
            title={t('debug.filterWarnTitle')}
          >
            {t('debug.filterWarn')}
          </button>
          <button
            onClick={() => setFilter('info')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'info'
                ? 'bg-cyan-600 text-white border-2 border-cyan-400'
                : 'bg-[#1a1a1a] text-cyan-400 border border-cyan-800/50 hover:bg-cyan-900/20 hover:text-cyan-300'
            }`}
            title={t('debug.filterInfoTitle')}
          >
            {t('debug.filterInfo')}
          </button>
          <button
            onClick={() => setFilter('debug')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'debug'
                ? 'bg-blue-600 text-white border-2 border-blue-400'
                : 'bg-[#1a1a1a] text-blue-400 border border-blue-800/50 hover:bg-blue-900/20 hover:text-blue-300'
            }`}
            title={t('debug.filterDebugTitle')}
          >
            {t('debug.filterDebug')}
          </button>
          <button
            onClick={() => setFilter('verbose')}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              filter === 'verbose'
                ? 'bg-purple-600 text-white border-2 border-purple-400'
                : 'bg-[#1a1a1a] text-purple-400 border border-purple-800/50 hover:bg-purple-900/20 hover:text-purple-300'
            }`}
            title={t('debug.filterVerboseTitle')}
          >
            {t('debug.filterVerbose')}
          </button>
          <span 
            className="text-xs text-gray-500 ml-2"
            title={totalLogs > filteredLogs.length ? t('debug.logsCountTotal', { shown: filteredLogs.length, total: totalLogs }) : t('debug.logsCount', { count: filteredLogs.length })}
          >
            {totalLogs > filteredLogs.length ? t('debug.logsCountTotal', { shown: filteredLogs.length, total: totalLogs }) : t('debug.logsCount', { count: filteredLogs.length })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const newShowAll = !showAllLogs;
              setShowAllLogs(newShowAll);
            }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              showAllLogs
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
            title={showAllLogs ? t('debug.showLast500') : t('debug.showAllTitle', { total: totalLogs })}
          >
            <FileText size={14} />
            <span>{showAllLogs ? t('debug.showLast500Short') : t('debug.showAllShort')}</span>
          </button>
          <button
            onClick={loadLogs}
            disabled={isLoading}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
            title={t('debug.refreshTitle')}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={clearLogs}
            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
            title={t('debug.clearTitle')}
          >
            <Sparkles size={14} />
            <span>{t('debug.clearButton')}</span>
          </button>
        </div>
      </div>

      {showAllLogs && filteredLogs.length > 1000 && (
        <div className="mb-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-center gap-2 text-yellow-400 text-sm">
            <AlertCircle size={16} />
            <span>
              {t('debug.warningManyLogs', { count: filteredLogs.length.toLocaleString() })}
            </span>
          </div>
        </div>
      )}
      <div className="bg-[#0a0a0a] border border-gray-800 rounded-lg overflow-hidden mt-2">
        <div ref={logsContainerRef} className="h-96 overflow-y-auto p-4 font-mono text-xs">
          {filteredLogs.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              <FileText size={32} className="mx-auto mb-2 opacity-50" />
              <p>{t('debug.noLogsAvailable')}</p>
              <p className="text-xs text-gray-400 mt-2">{t('debug.noLogsHint')}</p>
            </div>
          ) : (
            <>
              {filteredLogs.map((log, index) => (
                <div
                  key={`${log.timestamp}-${index}`}
                  className={`mb-1 flex items-start gap-2 ${getLevelColor(log.level)}`}
                >
                  <span className="text-gray-600 min-w-[80px]">{formatTimestamp(log.timestamp)}</span>
                  <span className="text-gray-500 min-w-[80px]">[{log.prefix}]</span>
                  <span className="flex-1">{log.message}</span>
                  {log.args && log.args.length > 0 && (
                    <span className="text-gray-600 text-[10px]">
                      {JSON.stringify(log.args).substring(0, 100)}
                    </span>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
};

// Debug Log Section Component (for Administration > Debug tab)
const DebugLogSection: React.FC = () => {
  const { t } = useTranslation();
  const [debugConfig, setDebugConfig] = useState<{ debug: boolean; verbose: boolean } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const response = await api.get<{ debug: boolean; verbose: boolean }>('/api/debug/config');
      if (response.success && response.result) {
        setDebugConfig(response.result);
      }
    } catch (error) {
      console.error('[DebugLogSection] Error loading config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggle = async (field: 'debug' | 'verbose', enabled: boolean) => {
    if (!debugConfig) return;
    
    setIsSaving(true);
    try {
      const newConfig = { ...debugConfig, [field]: enabled };
      const response = await api.post<{ debug: boolean; verbose: boolean }>('/api/debug/config', newConfig);
      if (response.success && response.result) {
        setDebugConfig(response.result);
      }
    } catch (error) {
      console.error('[DebugLogSection] Error setting config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || !debugConfig) {
    return (
      <div className="py-4 text-center text-gray-500">
        <Loader2 size={20} className="mx-auto mb-2 animate-spin" />
        <p className="text-sm">{t('debug.loading')}</p>
      </div>
    );
  }

  return (
    <>
      <SettingRow
        label={t('debug.debugLogsLabel')}
        description={t('debug.debugLogsDesc')}
      >
        <Toggle
          enabled={debugConfig.debug}
          onChange={(enabled) => handleToggle('debug', enabled)}
          disabled={isSaving}
        />
      </SettingRow>
      <SettingRow
        label={t('debug.verboseLogsLabel')}
        description={t('debug.verboseLogsDesc')}
      >
        <Toggle
          enabled={debugConfig.verbose}
          onChange={(enabled) => handleToggle('verbose', enabled)}
          disabled={isSaving || !debugConfig.debug}
        />
      </SettingRow>
      {!debugConfig.debug && (
        <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <p className="text-xs text-blue-400">
            {t('debug.debugDisabledMessage')}
          </p>
        </div>
      )}
      {debugConfig.debug && (
        <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <p className="text-xs text-amber-400">
            {t('debug.debugEnabledMessage')}
          </p>
        </div>
      )}
    </>
  );
};

// Update Check Section Component (for Administration > General tab)
const UpdateCheckSection: React.FC = () => {
  const { updateConfig, updateInfo, loadConfig, setConfig, checkForUpdates, isLoading } = useUpdateStore();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadConfig();
    if (updateConfig?.enabled) {
      checkForUpdates();
    }
  }, []);

  const handleToggle = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await setConfig(enabled);
    } catch (error) {
      console.error('[UpdateCheckSection] Error setting config:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <SettingRow
        label="Vérification automatique des mises à jour"
        description="Active la vérification des nouvelles versions disponibles sur GitHub Container Registry"
      >
        <Toggle
          enabled={updateConfig?.enabled ?? true}
          onChange={handleToggle}
          disabled={isSaving}
        />
      </SettingRow>
      {updateConfig?.enabled && (
        <>
          <div className="py-3 border-t border-gray-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-400">Version actuelle</span>
              <span className="text-sm font-mono text-white">{updateInfo?.currentVersion || '0.0.0'}</span>
            </div>
            {updateInfo?.latestVersion && (
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">Dernière version disponible</span>
                <span className="text-sm font-mono text-amber-400">{updateInfo.latestVersion}</span>
              </div>
            )}
            {updateInfo?.updateAvailable && (
              <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                <p className="text-xs text-amber-400 font-semibold mb-1">Nouvelle version disponible !</p>
                <p className="text-xs text-gray-400">
                  Une mise à jour est disponible. Pour mettre à jour, utilisez :
                </p>
                <code className="block mt-2 text-xs text-cyan-300 bg-[#0a0a0a] p-2 rounded border border-gray-800">
                  docker-compose pull && docker-compose up -d
                </code>
              </div>
            )}
            {updateInfo?.error && (
              <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-xs text-red-400">Erreur lors de la vérification : {updateInfo.error}</p>
              </div>
            )}
            <div className="mt-3 p-3 bg-gray-500/10 border border-gray-500/30 rounded-lg">
              <p className="text-xs text-gray-400">
                La vérification manuelle des mises à jour est temporairement désactivée.
              </p>
            </div>
            <button
              onClick={() => {}}
              disabled={true}
              className="mt-3 flex items-center gap-2 px-3 py-1.5 bg-gray-600 text-gray-400 text-sm rounded-lg transition-colors opacity-50 cursor-not-allowed"
            >
              <RefreshCw size={14} />
              Vérifier maintenant
            </button>
          </div>
        </>
      )}
    </>
  );
};

// Backup Section Component (for Administration > Backup tab)
const BackupSection: React.FC = () => {
  // Simplified for LogviewR
  

  return (
    <div className="space-y-6">
      {/* Information Alert */}
      <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
        <div className="flex items-start gap-3">
          <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-amber-400 mb-2">
              Important : Sauvegardes manuelles recommandées
            </h3>
            <p className="text-sm text-gray-300">
              Les sauvegardes de LogviewR incluent la configuration de l'application, les paramètres utilisateurs, et les configurations de plugins.
              Utilisez la section Export pour sauvegarder vos données.
            </p>
          </div>
        </div>
      </div>

                </div>
  );
};

// Default Page Configuration Section Component
const DefaultPageSection: React.FC = () => {
  const { t } = useTranslation();
  const { plugins } = usePluginStore();
  const [defaultPage, setDefaultPage] = useState<string>('dashboard');
  const [defaultPluginId, setDefaultPluginId] = useState<string>('');
  const [defaultLogFile, setDefaultLogFile] = useState<string>('');
  const [rememberLastFile, setRememberLastFile] = useState<boolean>(true);
  const [availableLogFiles, setAvailableLogFiles] = useState<Array<{ path: string; type: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await api.get<{ 
          defaultPage?: string; 
          defaultPluginId?: string; 
          defaultLogFile?: string;
          rememberLastFile?: boolean;
        }>('/api/system/general');
        if (response.success && response.result) {
          setDefaultPage(response.result.defaultPage || 'dashboard');
          setDefaultPluginId(response.result.defaultPluginId || '');
          setDefaultLogFile(response.result.defaultLogFile || '');
          setRememberLastFile(response.result.rememberLastFile !== undefined ? response.result.rememberLastFile : true);
        }
      } catch (error) {
        console.error('Failed to fetch default page settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, []);

  // Load available log files when plugin changes
  useEffect(() => {
    const loadLogFiles = async () => {
      if (!defaultPluginId) {
        setAvailableLogFiles([]);
        return;
      }
      setIsLoadingFiles(true);
      try {
        const response = await api.get<{ files: Array<{ path: string; type: string }> }>(
          `/api/log-viewer/plugins/${defaultPluginId}/files-direct`
        );
        if (response.success && response.result) {
          const data = response.result as any;
          const filesArray = data.files || (Array.isArray(data) ? data : []);
          setAvailableLogFiles(filesArray.map((f: any) => ({ path: f.path, type: f.type })));
        }
      } catch (error) {
        console.error('Failed to load log files:', error);
        setAvailableLogFiles([]);
      } finally {
        setIsLoadingFiles(false);
      }
    };
    loadLogFiles();
  }, [defaultPluginId]);

  // Auto-save function with debounce
  const autoSave = useCallback(async () => {
    // Clear existing timeout
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    // Set new timeout for debounce (500ms)
    autoSaveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        const response = await api.put<{ message?: string }>('/api/system/general', {
          defaultPage: defaultPage === 'dashboard' ? undefined : defaultPage,
          defaultPluginId: defaultPage === 'log-viewer' ? defaultPluginId : undefined,
          defaultLogFile: defaultPage === 'log-viewer' && defaultPluginId ? defaultLogFile : undefined,
          rememberLastFile
        });
        if (!response.success) {
          console.error('Auto-save failed:', response);
        }
      } catch (error: any) {
        console.error('Auto-save error:', error);
      } finally {
        setIsSaving(false);
      }
    }, 500);
  }, [defaultPage, defaultPluginId, defaultLogFile, rememberLastFile]);

  // Auto-save on changes
  useEffect(() => {
    if (!isLoading) {
      autoSave();
    }
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [defaultPage, defaultPluginId, defaultLogFile, rememberLastFile, autoSave, isLoading]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="animate-spin text-blue-400" size={20} />
              </div>
    );
  }

  const logSourcePlugins = plugins.filter(p => 
    p.enabled && ['host-system', 'nginx', 'apache', 'npm'].includes(p.id)
  );

  return (
    <div className="space-y-4">
      {isSaving && (
        <div className="p-2 rounded-lg text-sm bg-blue-900/30 border border-blue-700 text-blue-400 flex items-center gap-2">
          <Loader2 className="animate-spin" size={16} />
          <span>{t('admin.general.defaultPageSection.autoSaveInProgress')}</span>
        </div>
      )}

      <div className="py-3 border-b border-gray-800">
        <h4 className="text-sm font-medium text-white mb-2">{t('admin.general.defaultPageSection.defaultPageTitle')}</h4>
        <select
          value={defaultPage}
          onChange={(e) => {
            setDefaultPage(e.target.value);
            if (e.target.value !== 'log-viewer') {
              setDefaultPluginId('');
              setDefaultLogFile('');
            }
          }}
          className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="dashboard">{t('admin.general.defaultPageSection.dashboard')}</option>
          <option value="log-viewer">{t('admin.general.defaultPageSection.logViewer')}</option>
        </select>
        <p className="text-xs text-gray-400 mt-2">
          {t('admin.general.defaultPageSection.defaultPageDescription')}
        </p>
                </div>

      {defaultPage === 'log-viewer' && (
        <>
          <div className="py-3 border-b border-gray-800">
            <h4 className="text-sm font-medium text-white mb-2">{t('admin.general.defaultPageSection.defaultPlugin')}</h4>
            <select
              value={defaultPluginId}
              onChange={(e) => {
                setDefaultPluginId(e.target.value);
                setDefaultLogFile('');
              }}
              className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">{t('admin.general.defaultPageSection.selectPlugin')}</option>
              {logSourcePlugins.map(plugin => (
                <option key={plugin.id} value={plugin.id}>{plugin.name}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-2">
              {t('admin.general.defaultPageSection.defaultPluginDescription')}
            </p>
          </div>

          {defaultPluginId && (
            <div className="py-3 border-b border-gray-800">
              <h4 className="text-sm font-medium text-white mb-2">{t('admin.general.defaultPageSection.defaultLogFile')}</h4>
              {isLoadingFiles ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm">
                  <Loader2 className="animate-spin" size={16} />
                  <span>{t('admin.general.defaultPageSection.loadingFiles')}</span>
              </div>
            ) : (
                <>
                  <select
                    value={defaultLogFile}
                    onChange={(e) => setDefaultLogFile(e.target.value)}
                    className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">{t('admin.general.defaultPageSection.selectFile')}</option>
                    {availableLogFiles.map(file => (
                      <option key={file.path} value={file.path}>
                        {file.path} ({file.type})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-400 mt-2">
                    {t('admin.general.defaultPageSection.defaultLogFileDescription')}
                  </p>
                </>
            )}
          </div>
          )}
        </>
      )}

      <div className="py-3 border-b border-gray-800">
        <h4 className="text-sm font-medium text-white mb-2">{t('admin.general.defaultPageSection.rememberLastFile')}</h4>
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-xs text-gray-400 mb-2">
              {t('admin.general.defaultPageSection.rememberLastFileDescription')}
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={rememberLastFile}
              onChange={(e) => setRememberLastFile(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>
      </div>
    </div>
  );
};

// General Network Configuration Section Component (for Administration > General tab)
const GeneralNetworkSection: React.FC = () => {
  const { t } = useTranslation();
  const [publicUrl, setPublicUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [initialPublicUrl, setInitialPublicUrl] = useState('');

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const response = await api.get<{ publicUrl: string }>('/api/system/general');
        if (response.success && response.result) {
          const url = response.result.publicUrl || '';
          setPublicUrl(url);
          setInitialPublicUrl(url);
        }
      } catch (error) {
        console.error('Failed to fetch general settings:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSettings();
  }, []);

  const hasUnsavedChanges = publicUrl !== initialPublicUrl;

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await api.put<{ publicUrl: string; message?: string }>('/api/system/general', {
        publicUrl: publicUrl.trim() || ''
      });
      if (response.success) {
        setMessage({ type: 'success', text: response.result?.message || 'Configuration sauvegardée avec succès' });
        setTimeout(() => setMessage(null), 3000);
        // Update initial values after save
        setInitialPublicUrl(publicUrl.trim() || '');
      }
    } catch (error: any) {
      setMessage({ 
        type: 'error', 
        text: error?.response?.data?.error?.message || 'Erreur lors de la sauvegarde' 
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="animate-spin text-blue-400" size={20} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Unsaved Changes Notification */}
      {hasUnsavedChanges && (
        <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg flex items-start gap-3">
          <AlertCircle size={20} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h4 className="text-sm font-medium text-amber-400 mb-1">
              {t('admin.general.network.unsavedChanges')}
            </h4>
            <p className="text-xs text-amber-300">
              {t('admin.general.network.unsavedChangesHint')}
            </p>
          </div>
        </div>
      )}

      {message && (
        <div className={`p-3 rounded-lg text-sm ${
          message.type === 'success' 
            ? 'bg-green-900/30 border border-green-700 text-green-400' 
            : 'bg-red-900/30 border border-red-700 text-red-400'
        }`}>
          {message.text}
        </div>
      )}
      
      <div className="py-3 border-b border-gray-800">
        <h4 className="text-sm font-medium text-white mb-2">{t('admin.general.network.publicUrlLabel')}</h4>
        <div className="flex items-center gap-2 w-full">
          <input
            type="url"
            value={publicUrl}
            onChange={(e) => setPublicUrl(e.target.value)}
            placeholder={t('admin.general.network.publicUrlPlaceholder')}
            className="flex-1 w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            {isSaving ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                <span>{t('admin.general.network.saving')}</span>
              </>
            ) : (
              <>
                <Save size={16} />
                <span>{t('admin.general.network.save')}</span>
              </>
            )}
          </button>
        </div>
      </div>
      
      <div className="text-xs text-gray-500 mt-2 p-3 bg-[#1a1a1a] rounded-lg border border-gray-800">
        <p className="font-medium text-gray-400 mb-1">💡 {t('admin.general.network.note')}</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>{t('admin.general.network.formatExpected')}</li>
          <li>{t('admin.general.network.leaveEmptyForLocal')}</li>
        </ul>
      </div>
    </div>
  );
};

// User Profile Section Component (for Administration > General tab)
const UserProfileSection: React.FC = () => {
  const { t } = useTranslation();
  const { user: currentUser, checkAuth } = useUserAuthStore();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showPasswordFields, setShowPasswordFields] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setUsername(currentUser.username);
      setEmail(currentUser.email || '');
      // Set avatar preview if user has avatar
      if (currentUser.avatar) {
        setAvatarPreview(currentUser.avatar);
      } else {
        setAvatarPreview(null);
      }
    }
  }, [currentUser]);

  // Validate email format
  const validateEmail = (emailValue: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(emailValue);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value;
    setEmail(newEmail);
    
    // Clear error if email is cleared
    if (!newEmail || newEmail.trim().length === 0) {
      setEmailError(null);
      return;
    }
    
    // Validate format only if email is provided
    if (!validateEmail(newEmail)) {
      setEmailError('Format d\'email invalide');
    } else {
      setEmailError(null);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    setEmailError(null);

    try {
      // Check if user is logged in
      if (!currentUser || !currentUser.id) {
        setError('Vous devez être connecté pour modifier votre profil');
        setIsSaving(false);
        return;
      }

      // Validate username
      if (!username || username.trim().length === 0) {
        setError('Le nom d\'utilisateur ne peut pas être vide');
        setIsSaving(false);
        return;
      }

      if (username.length < 3) {
        setError('Le nom d\'utilisateur doit contenir au moins 3 caractères');
        setIsSaving(false);
        return;
      }

      // Validate email format BEFORE making any API call
      // If email is provided and different from current, it must be valid
      if (email !== currentUser?.email) {
        if (!email || email.trim().length === 0) {
          setEmailError('L\'email ne peut pas être vide');
          setError('Veuillez corriger les erreurs avant de sauvegarder');
          setIsSaving(false);
          return;
        }
        if (!validateEmail(email)) {
          setEmailError('Format d\'email invalide');
          setError('Veuillez corriger les erreurs avant de sauvegarder');
          setIsSaving(false);
          return;
        }
      }

      // Validate password if changing
      if (showPasswordFields && newPassword) {
        if (newPassword.length < 8) {
          setError('Le mot de passe doit contenir au moins 8 caractères');
          setIsSaving(false);
          return;
        }
        if (newPassword !== confirmPassword) {
          setError('Les mots de passe ne correspondent pas');
          setIsSaving(false);
          return;
        }
        if (!oldPassword) {
          setError('Veuillez entrer votre mot de passe actuel');
          setIsSaving(false);
          return;
        }
      }

      const updateData: any = {};
      
      // Update username if changed
      if (username !== currentUser?.username) {
        updateData.username = username;
      }
      
      // Update email if changed (only if valid - already validated above)
      if (email !== currentUser?.email && email && validateEmail(email)) {
        updateData.email = email;
      }

      // Update password if provided
      if (showPasswordFields && newPassword && oldPassword) {
        updateData.password = newPassword;
        updateData.oldPassword = oldPassword;
      }

      if (Object.keys(updateData).length === 0) {
        setError('Aucune modification à sauvegarder');
        setIsSaving(false);
        return;
      }

      // Log request details in development
      if (import.meta.env.DEV) {
        console.log('[UserProfile] Saving profile:', { userId: currentUser?.id, updateData });
      }
      
      const response = await api.put(`/api/users/${currentUser?.id}`, updateData);
      
      if (import.meta.env.DEV) {
        console.log('[UserProfile] Response:', response);
      }
      
      if (response.success) {
        setSuccessMessage('Profil mis à jour avec succès');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setShowPasswordFields(false);
        setShowOldPassword(false);
        setShowNewPassword(false);
        setShowConfirmPassword(false);
        // Refresh user data
        await checkAuth();
      } else {
        // Show detailed error message
        const errorMsg = response.error?.message || 'Échec de la mise à jour';
        setError(errorMsg);
        console.error('[UserProfile] Update failed:', response.error);
      }
    } catch (err) {
      // Enhanced error handling
      console.error('[UserProfile] Exception during save:', err);
      if (err instanceof Error) {
        if (err.message.includes('fetch') || err.message.includes('network')) {
          setError('Impossible de contacter le serveur. Vérifiez que le serveur backend est démarré.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Erreur lors de la mise à jour du profil');
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm flex items-center gap-2">
          <AlertCircle size={16} className="text-red-400" />
          {error}
        </div>
      )}
      {successMessage && (
        <div className="mb-4 p-3 bg-emerald-900/30 border border-emerald-700 rounded-lg text-emerald-400 text-sm flex items-center gap-2">
          <Save size={16} className="text-emerald-400" />
          {successMessage}
        </div>
      )}

      {/* Avatar Section */}
      <SettingRow
        label={t('admin.general.profile.avatar')}
        description={t('admin.general.profile.avatarDescription')}
      >
        <div className="flex items-center gap-4 w-full">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-xl overflow-hidden">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <span>
                  {currentUser?.username
                    ?.split(' ')
                    .map(n => n[0])
                    .join('')
                    .toUpperCase()
                    .slice(0, 2) || 'U'}
                </span>
              )}
            </div>
            {avatarFile && (
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[#1a1a1a]">
                <Save size={12} className="text-white" />
              </div>
            )}
          </div>
          <div className="flex-1">
            <label className="block">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setAvatarFile(file);
                    const reader = new FileReader();
                    reader.onloadend = () => {
                      setAvatarPreview(reader.result as string);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
                className="hidden"
              />
              <span className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm cursor-pointer transition-colors">
                {t('admin.general.profile.chooseImage')}
              </span>
            </label>
            {avatarFile && (
              <button
                onClick={async () => {
                  if (!currentUser || isUploadingAvatar) return;
                  
                  setIsUploadingAvatar(true);
                  setError(null);
                  setSuccessMessage(null);
                  
                  try {
                    // Convert file to base64 using Promise
                    const base64String = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onerror = () => reject(new Error('Erreur lors de la lecture du fichier'));
                      reader.onloadend = () => {
                        if (reader.result && typeof reader.result === 'string') {
                          resolve(reader.result);
                        } else {
                          reject(new Error('Impossible de convertir le fichier en base64'));
                        }
                      };
                      reader.readAsDataURL(avatarFile);
                    });
                    
                    // Check if base64 string is too large (should not happen with 5MB limit, but double-check)
                    if (base64String.length > 10 * 1024 * 1024) { // ~10MB base64
                      setError('L\'image est trop volumineuse après conversion');
                      setIsUploadingAvatar(false);
                      return;
                    }
                    
                    // Upload to server
                    const response = await api.put(`/api/users/${currentUser.id}`, {
                      avatar: base64String
                    });
                    
                    if (response.success) {
                      setSuccessMessage(t('admin.general.profile.avatarUpdatedSuccess'));
                      setAvatarFile(null);
                      // Keep preview to show new avatar
                      await checkAuth();
                    } else {
                      // Handle API error
                      const errorMessage = response.error?.message || 'Échec de la mise à jour de l\'avatar';
                      setError(errorMessage);
                    }
                  } catch (err) {
                    // Handle conversion or network errors
                    if (err instanceof Error) {
                      if (err.message.includes('Network') || err.message.includes('fetch')) {
                        setError('Impossible de contacter le serveur. Vérifiez votre connexion réseau.');
                      } else {
                        setError(err.message);
                      }
                    } else {
                      setError('Erreur lors de la mise à jour de l\'avatar');
                    }
                  } finally {
                    setIsUploadingAvatar(false);
                  }
                }}
                disabled={isUploadingAvatar}
                className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm transition-colors flex items-center gap-2"
              >
                {isUploadingAvatar ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>{t('admin.general.profile.saving')}</span>
                  </>
                ) : (
                  <span>{t('admin.general.profile.saveAvatar')}</span>
                )}
              </button>
            )}
          </div>
        </div>
      </SettingRow>

      <SettingRow
        label={t('admin.general.profile.username')}
        description={t('admin.general.profile.usernameDescription')}
      >
        <div className="flex items-center gap-3 w-full">
          <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20 flex-shrink-0">
            <UserIcon size={18} className="text-blue-400" />
          </div>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:outline-none transition-colors"
            placeholder={t('admin.general.profile.usernamePlaceholder')}
          />
        </div>
      </SettingRow>

      <SettingRow
        label={t('admin.general.profile.email')}
        description={t('admin.general.profile.emailDescription')}
      >
        <div className="flex flex-col gap-2 w-full">
          <div className="flex items-center gap-3 w-full">
            <div className="p-2 bg-purple-500/10 rounded-lg border border-purple-500/20 flex-shrink-0">
              <Mail size={18} className="text-purple-400" />
            </div>
            <input
              type="email"
              value={email}
              onChange={handleEmailChange}
              className={`flex-1 px-3 py-2 bg-[#1a1a1a] border rounded-lg text-white text-sm focus:outline-none transition-colors ${
                emailError ? 'border-red-500 focus:border-red-500' : 'border-gray-700 focus:border-purple-500'
              }`}
              placeholder={t('admin.general.profile.emailPlaceholder')}
            />
          </div>
          {emailError && (
            <p className="text-xs text-red-400 ml-12">{emailError}</p>
          )}
        </div>
      </SettingRow>

      <SettingRow
        label={t('admin.general.profile.password')}
        description={showPasswordFields ? t('admin.general.profile.passwordEdit') : t('admin.general.profile.passwordClickToEdit')}
      >
        <div className="flex flex-col gap-3 w-full">
          {!showPasswordFields ? (
            <button
              onClick={() => setShowPasswordFields(true)}
              className="flex items-center gap-3 px-4 py-3 bg-[#1a1a1a] hover:bg-[#252525] border border-gray-700 rounded-lg text-white text-sm transition-colors group"
            >
              <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20 group-hover:bg-amber-500/20 transition-colors">
                <Key size={18} className="text-amber-400" />
              </div>
              <span className="flex-1 text-left">{t('admin.general.profile.editPassword')}</span>
              <Edit2 size={16} className="text-gray-400 group-hover:text-amber-400 transition-colors" />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-3 w-full">
                <div className="p-2 bg-amber-500/10 rounded-lg border border-amber-500/20 flex-shrink-0">
                  <Key size={18} className="text-amber-400" />
                </div>
                <input
                  type={showOldPassword ? 'text' : 'password'}
                  placeholder={t('admin.general.profile.currentPasswordPlaceholder')}
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-amber-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowOldPassword(!showOldPassword)}
                  className="p-2 text-gray-400 hover:text-amber-400 transition-colors"
                  title={showOldPassword ? t('admin.general.profile.hidePassword') : t('admin.general.profile.showPassword')}
                >
                  {showOldPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div className="flex items-center gap-3 w-full">
                <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20 flex-shrink-0">
                  <Key size={18} className="text-emerald-400" />
                </div>
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  placeholder={t('admin.general.profile.newPasswordPlaceholder')}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="p-2 text-gray-400 hover:text-emerald-400 transition-colors"
                  title={showNewPassword ? t('admin.general.profile.hidePassword') : t('admin.general.profile.showPassword')}
                >
                  {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div className="flex items-center gap-3 w-full">
                <div className="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20 flex-shrink-0">
                  <Key size={18} className="text-emerald-400" />
                </div>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder={t('admin.general.profile.confirmPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="p-2 text-gray-400 hover:text-emerald-400 transition-colors"
                  title={showConfirmPassword ? t('admin.general.profile.hidePassword') : t('admin.general.profile.showPassword')}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <Save size={16} />
                  {isSaving ? t('admin.general.profile.saving') : t('admin.general.profile.save')}
                </button>
                <button
                  onClick={() => {
                    setShowPasswordFields(false);
                    setOldPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                    setError(null);
                  }}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white text-sm transition-colors"
                >
                  {t('admin.general.profile.cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      </SettingRow>

      {!showPasswordFields && (
        <div className="flex justify-end pt-4">
          <button
            onClick={handleSave}
            disabled={isSaving || (email === currentUser?.email && username === currentUser?.username) || !!emailError}
            className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-medium transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20"
          >
            <Save size={18} />
            {isSaving ? t('admin.general.profile.saving') : t('admin.general.profile.saveChanges')}
          </button>
        </div>
      )}
    </>
  );
};

// Database stats from /api/database/stats (engine stats, not purge)
interface DbEngineStats {
  pageSize: number;
  pageCount: number;
  cacheSize: number;
  synchronous: number;
  journalMode: string;
  walSize: number;
  dbSize: number;
}

// Database Section Component (Administration > Base de données)
const DatabaseSection: React.FC = () => {
  const { t } = useTranslation();
  const [dbStats, setDbStats] = useState<DbEngineStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      setStatsLoading(true);
      try {
        const response = await api.get<DbEngineStats>('/api/database/stats');
        if (!cancelled && response.success && response.result) {
          setDbStats(response.result);
        }
      } catch {
        if (!cancelled) setDbStats(null);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    };
    fetchStats();
    return () => { cancelled = true; };
  }, []);

  const syncLabel = dbStats?.synchronous === 0 ? 'OFF' : dbStats?.synchronous === 1 ? 'NORMAL' : dbStats?.synchronous === 2 ? 'FULL' : String(dbStats?.synchronous ?? '-');

  return (
    <div className="space-y-6">
      <Section title={t('database.title')} icon={Database} iconColor="purple">
        <div className="space-y-4">
          <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
            <div className="flex items-start gap-3">
              <Info size={20} className="text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-sm font-semibold text-blue-400 mb-2">{t('database.defaultDbTitle')}</h4>
                <p className="text-xs text-gray-400 mb-3">
                  {t('database.defaultDbDesc')}
                </p>
                <div className="space-y-2 text-xs text-gray-300">
                  <div><strong className="text-blue-400">{t('database.tablesUsed')}</strong></div>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li><code className="text-cyan-400">users</code> - {t('database.tableUsers')}</li>
                    <li><code className="text-cyan-400">plugin_configs</code> - {t('database.tablePluginConfigs')}</li>
                    <li><code className="text-cyan-400">log_sources</code> - {t('database.tableLogSources')}</li>
                    <li><code className="text-cyan-400">log_files</code> - {t('database.tableLogFiles')}</li>
                    <li><code className="text-cyan-400">logs</code> - {t('database.tableLogs')}</li>
                    <li><code className="text-cyan-400">user_plugin_permissions</code> - {t('database.tableUserPluginPermissions')}</li>
                    <li><code className="text-cyan-400">app_config</code> - {t('database.tableAppConfig')}</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 bg-theme-secondary rounded-lg border border-theme">
            <h4 className="text-sm font-semibold text-theme-primary mb-3">{t('database.statsTitle')}</h4>
            {statsLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 size={16} className="animate-spin" />
                {t('database.loading')}
              </div>
            ) : dbStats ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between py-1.5 border-b border-gray-700/50">
                  <span className="text-gray-400">{t('database.type')}</span>
                  <span className="font-mono text-theme-primary">SQLite</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-gray-700/50">
                  <span className="text-gray-400">{t('database.sizeEstimate')}</span>
                  <span className="font-mono text-theme-primary">{formatBytes(dbStats.dbSize)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-gray-700/50">
                  <span className="text-gray-400">{t('database.journalMode')}</span>
                  <span className="font-mono text-theme-primary">{dbStats.journalMode}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-gray-700/50">
                  <span className="text-gray-400">{t('database.pageSize')}</span>
                  <span className="font-mono text-theme-primary">{dbStats.pageSize} B</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-gray-700/50">
                  <span className="text-gray-400">{t('database.pageCount')}</span>
                  <span className="font-mono text-theme-primary">{dbStats.pageCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-gray-700/50">
                  <span className="text-gray-400">{t('database.cache')}</span>
                  <span className="font-mono text-theme-primary">
                    {dbStats.cacheSize < 0 ? formatBytes(Math.abs(dbStats.cacheSize) * 1024) : t('database.cachePages', { count: dbStats.cacheSize })}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-gray-700/50">
                  <span className="text-gray-400">{t('database.synchronous')}</span>
                  <span className="font-mono text-theme-primary">{syncLabel}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">{t('database.statsNotAvailable')}</p>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
};

// GitHub repo stats (public API)
const GITHUB_REPO = 'Erreur32/LogviewR';
interface RepoStats {
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  watchers_count?: number;
}

// Info Section Component (for Administration > Info tab)
const InfoSection: React.FC = () => {
  const { t } = useTranslation();
  const [changelogRaw, setChangelogRaw] = useState<string | null>(null);
  const [changelogLoading, setChangelogLoading] = useState(false);
  const [changelogView, setChangelogView] = useState<'latest' | 'full'>('latest');
  const [repoStats, setRepoStats] = useState<RepoStats | null>(null);
  const [repoStatsLoading, setRepoStatsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchChangelog = async () => {
      setChangelogLoading(true);
      try {
        const response = await api.get<{ content: string }>('/api/info/changelog');
        if (!cancelled && response.success && response.result?.content) {
          setChangelogRaw(response.result.content);
        }
      } catch {
        if (!cancelled) setChangelogRaw(null);
      } finally {
        if (!cancelled) setChangelogLoading(false);
      }
    };
    fetchChangelog();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchRepoStats = async () => {
      setRepoStatsLoading(true);
      try {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, { headers: { Accept: 'application/vnd.github.v3+json' } });
        if (!cancelled && res.ok) {
          const data = await res.json();
          setRepoStats({
            stargazers_count: data.stargazers_count ?? 0,
            forks_count: data.forks_count ?? 0,
            open_issues_count: data.open_issues_count ?? 0,
            watchers_count: data.watchers_count
          });
        }
      } catch {
        if (!cancelled) setRepoStats(null);
      } finally {
        if (!cancelled) setRepoStatsLoading(false);
      }
    };
    fetchRepoStats();
    return () => { cancelled = true; };
  }, []);

  // Parse changelog: extract version blocks ## [x.y.z] - date
  const versionBlocks = useMemo(() => {
    if (!changelogRaw) return [];
    const sections: { version: string; date: string; body: string }[] = [];
    const re = /##\s*\[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(changelogRaw)) !== null) {
      if (lastIndex > 0) {
        const prev = sections[sections.length - 1];
        prev.body = changelogRaw.slice(lastIndex, m.index).trim();
      }
      sections.push({ version: m[1], date: m[2], body: '' });
      lastIndex = m.index + m[0].length;
    }
    if (sections.length > 0) {
      sections[sections.length - 1].body = changelogRaw.slice(lastIndex).trim();
    }
    return sections;
  }, [changelogRaw]);

  const displayContent = changelogView === 'latest' && versionBlocks.length > 0
    ? versionBlocks[0]
    : null;
  const fullContent = changelogRaw ?? '';

  // Simple markdown-like render: ###, **, -, list
  const renderChangelogBlock = (body: string) => {
    const lines = body.split(/\n/);
    const out: React.ReactNode[] = [];
    let key = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('### ')) {
        out.push(<h4 key={key++} className="text-sm font-semibold text-cyan-400 mt-3 mb-1">{line.slice(4)}</h4>);
      } else if (line.startsWith('#### ')) {
        out.push(<h5 key={key++} className="text-xs font-semibold text-gray-300 mt-2 mb-0.5">{line.slice(5)}</h5>);
      } else if (/^-\s+/.test(line) || /^\*\s+/.test(line)) {
        const text = line.replace(/^[-*]\s+/, '').replace(/\*\*([^*]+)\*\*/g, (_, t) => `\u0000${t}\u0000`);
        const parts = text.split(/\u0000/);
        out.push(
          <li key={key++} className="text-sm text-gray-300 ml-4 list-disc">
            {parts.map((p, j) => (j % 2 === 1 ? <strong key={j} className="text-gray-200">{p}</strong> : p))}
          </li>
        );
      } else if (line.trim() === '---') {
        out.push(<hr key={key++} className="border-gray-600 my-2" />);
      } else if (line.trim()) {
        out.push(<p key={key++} className="text-sm text-gray-400 mb-1">{line}</p>);
      }
    }
    return <ul className="list-none pl-0 space-y-0.5">{out}</ul>;
  };

  return (
    <div className="space-y-6">
      <Section title={t('info.title')} icon={Info} iconColor="teal">
        <div className="space-y-4">
          <div className="p-4 bg-theme-secondary rounded-lg border border-theme flex flex-col items-center text-center">
            <img src={logviewrLogo} alt="LogviewR" className="h-16 w-auto mb-4 object-contain" />
            <h3 className="text-lg font-semibold text-theme-primary mb-2">LogviewR</h3>
            <p className="text-sm text-theme-secondary mb-4 max-w-lg">
              {t('info.tagline')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 py-2 border-y border-gray-700 w-full max-w-md">
              <span className="text-sm text-gray-400">{t('info.version')}</span>
              <span className="text-sm font-mono text-theme-primary">{getVersionString()}</span>
              <span className="text-gray-600">|</span>
              <span className="text-sm text-gray-400">{t('info.license')}</span>
              <span className="text-sm text-theme-primary">{t('info.licenseValue')}</span>
            </div>
            <a
              href="https://github.com/Erreur32/LogviewR"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
            >
              <Github size={16} />
              <span>{t('info.viewOnGitHub')}</span>
              <ExternalLink size={14} />
            </a>

            {/* Repo stats */}
            <div className="mt-4 pt-4 border-t border-gray-700 w-full max-w-md">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t('info.repoStats')}</h4>
              {repoStatsLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 size={14} className="animate-spin" />
                  {t('info.loading')}
                </div>
              ) : repoStats ? (
                <div className="flex flex-wrap justify-center gap-4">
                  <a href={`https://github.com/${GITHUB_REPO}/stargazers`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors text-sm">
                    <Star size={16} />
                    <span className="font-mono">{repoStats.stargazers_count.toLocaleString()}</span>
                  </a>
                  <a href={`https://github.com/${GITHUB_REPO}/forks`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors text-sm">
                    <GitFork size={16} />
                    <span className="font-mono">{repoStats.forks_count.toLocaleString()}</span>
                  </a>
                  <a href={`https://github.com/${GITHUB_REPO}/issues`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-600/30 border border-gray-500/50 text-gray-300 hover:bg-gray-600/50 transition-colors text-sm">
                    <span className="font-mono">{repoStats.open_issues_count.toLocaleString()}</span>
                    <span className="text-xs">{t('info.issues')}</span>
                  </a>
                </div>
              ) : (
                <p className="text-xs text-gray-500">{t('info.statsNotAvailable')}</p>
              )}
            </div>
          </div>

          <div className="p-4 bg-theme-secondary rounded-lg border border-theme">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-lg bg-teal-500/10 border border-teal-500/30">
                <FileText size={20} className="text-teal-400" />
              </div>
              <h3 className="text-lg font-semibold text-theme-primary">{t('info.about')}</h3>
            </div>
            <p className="text-sm text-theme-secondary mb-2">
              {t('info.aboutDescription')}
            </p>
            <p className="text-sm text-gray-400">
              {t('info.aboutReadmeBefore')}
              <a href="https://github.com/Erreur32/LogviewR" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">{t('info.aboutReadmeLink')}</a>
              {t('info.aboutReadmeAfter')}
            </p>
          </div>

          <div className="p-4 bg-theme-secondary rounded-lg border border-theme">
            <h3 className="text-lg font-semibold text-theme-primary mb-3">{t('info.author')}</h3>
            <p className="text-sm text-theme-secondary">
              {t('info.developedByBefore')}<span className="text-theme-primary font-medium">Erreur32</span>
            </p>
          </div>

          <div className="p-4 bg-theme-secondary rounded-lg border border-theme">
            <h3 className="text-lg font-semibold text-theme-primary mb-3">{t('info.technologies')}</h3>
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 bg-blue-900/30 border border-blue-700 rounded text-xs text-blue-400">React</span>
              <span className="px-3 py-1 bg-blue-900/30 border border-blue-700 rounded text-xs text-blue-400">TypeScript</span>
              <span className="px-3 py-1 bg-green-900/30 border border-green-700 rounded text-xs text-green-400">Node.js</span>
              <span className="px-3 py-1 bg-cyan-900/30 border border-cyan-700 rounded text-xs text-cyan-400">Express</span>
              <span className="px-3 py-1 bg-purple-900/30 border border-purple-700 rounded text-xs text-purple-400">SQLite</span>
              <span className="px-3 py-1 bg-yellow-900/30 border border-yellow-700 rounded text-xs text-yellow-400">Docker</span>
            </div>
          </div>

          <div className="p-4 bg-theme-secondary rounded-lg border border-theme">
            <h3 className="text-lg font-semibold text-theme-primary mb-3">{t('info.changelog')}</h3>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setChangelogView('latest')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${changelogView === 'latest' ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                {t('info.latestVersion')}
              </button>
              <button
                type="button"
                onClick={() => setChangelogView('full')}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${changelogView === 'full' ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                {t('info.fullChangelog')}
              </button>
            </div>
            {changelogLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-400">
                <Loader2 size={16} className="animate-spin" />
                {t('info.changelogLoading')}
              </div>
            ) : displayContent ? (
              <div className="rounded-lg bg-gray-900/50 border border-gray-700 p-4 text-left">
                <h4 className="text-base font-bold text-cyan-400 mb-1">{t('info.versionLabel', { version: displayContent.version })}</h4>
                <p className="text-xs text-gray-500 mb-3">{displayContent.date}</p>
                {renderChangelogBlock(displayContent.body)}
              </div>
            ) : changelogView === 'full' && versionBlocks.length > 0 ? (
              <div className="rounded-lg bg-gray-900/50 border border-gray-700 p-4 text-left max-h-96 overflow-y-auto space-y-4">
                {versionBlocks.map((block) => (
                  <div key={block.version + block.date}>
                    <h4 className="text-base font-bold text-cyan-400 mb-1">{t('info.versionLabel', { version: block.version })}</h4>
                    <p className="text-xs text-gray-500 mb-2">{block.date}</p>
                    {renderChangelogBlock(block.body)}
                  </div>
                ))}
              </div>
            ) : changelogView === 'full' && fullContent ? (
              <div className="rounded-lg bg-gray-900/50 border border-gray-700 p-4 text-left max-h-96 overflow-y-auto whitespace-pre-wrap text-sm text-gray-300 font-mono">
                {fullContent}
              </div>
            ) : !changelogRaw ? (
              <p className="text-sm text-gray-400">{t('info.changelogNotAvailable')}</p>
            ) : null}
          </div>
        </div>
      </Section>
    </div>
  );
};

// Users Management Section Component (for Administration tab)
const UsersManagementSection: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user: currentUser } = useUserAuthStore();
  const dateLocale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-US';
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser?.role === 'admin') {
      fetchUsers();
    }
  }, [currentUser]);

  const fetchUsers = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<User[]>('/api/users');
      if (response.success && response.result) {
        setUsers(response.result);
      } else {
        const errorMsg = response.error?.message || 'Échec du chargement des utilisateurs';
        setError(errorMsg);
      }
    } catch (err: any) {
      // Handle network/socket errors
      let errorMessage = 'Échec du chargement des utilisateurs';
      
      if (err.message) {
        if (err.message.includes('socket') || err.message.includes('ended') || err.message.includes('ECONNRESET')) {
          errorMessage = 'Connexion interrompue. Veuillez réessayer.';
        } else if (err.message.includes('timeout') || err.message.includes('TIMEOUT')) {
          errorMessage = 'La requête a expiré. Veuillez réessayer.';
        } else if (err.error?.message) {
          errorMessage = err.error.message;
        } else {
          errorMessage = err.message;
        }
      } else if (err.error?.message) {
        errorMessage = err.error.message;
      }
      
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (userId: number) => {
    if (!confirm(`Voulez-vous vraiment supprimer cet utilisateur ?`)) {
      return;
    }

    try {
      const response = await api.delete(`/api/users/${userId}`);
      if (response.success) {
        await fetchUsers();
      } else {
        const errorMsg = response.error?.message || 'Échec de la suppression';
        alert(errorMsg);
      }
    } catch (err: any) {
      // Handle network/socket errors
      let errorMessage = 'Échec de la suppression';
      
      if (err.message) {
        if (err.message.includes('socket') || err.message.includes('ended') || err.message.includes('ECONNRESET')) {
          errorMessage = 'Connexion interrompue. Veuillez réessayer.';
        } else if (err.message.includes('timeout') || err.message.includes('TIMEOUT')) {
          errorMessage = 'La requête a expiré. Veuillez réessayer.';
        } else if (err.error?.message) {
          errorMessage = err.error.message;
        } else {
          errorMessage = err.message;
        }
      } else if (err.error?.message) {
        errorMessage = err.error.message;
      }
      
      alert(errorMessage);
    }
  };

  return (
    <>
      {error && (
        <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-gray-500">
          <Loader2 size={24} className="mx-auto mb-2 animate-spin" />
          <p>Chargement des utilisateurs...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {users.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Users size={32} className="mx-auto mb-2" />
              <p>Aucun utilisateur trouvé</p>
            </div>
          ) : (
            users.map((user) => {
              // Get user initials for avatar
              const getInitials = (username: string): string => {
                if (!username) return 'U';
                return username
                  .split(' ')
                  .map(n => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2) || 'U';
              };
              const initials = getInitials(user.username);

              return (
                <div key={user.id} className="flex items-start gap-3 py-3 px-4 bg-theme-secondary rounded-lg border border-theme">
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    {user.avatar ? (
                      <img 
                        src={user.avatar} 
                        alt={user.username}
                        className="w-12 h-12 rounded-full object-cover border-2 border-gray-700"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm border-2 border-gray-700">
                        {initials}
                      </div>
                    )}
                  </div>
                  
                  {/* User Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-medium text-theme-primary">{user.username}</span>
                      {user.role === 'admin' && (
                        <span className="px-2 py-0.5 bg-blue-900/30 border border-blue-700 rounded text-xs text-blue-400 whitespace-nowrap">
                          {t('admin.general.users.admin')}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-theme-secondary truncate">{user.email}</p>
                    <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-theme-tertiary">
                      <span>{t('admin.general.users.createdAt')} {new Date(user.createdAt).toLocaleDateString(dateLocale)}</span>
                      {user.lastLogin && (
                        <>
                          <span className="text-gray-600">•</span>
                          <span>{t('admin.general.users.lastLogin')}: {new Date(user.lastLogin).toLocaleDateString(dateLocale, { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(user.lastLogin).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}</span>
                        </>
                      )}
                      {user.lastLoginIp && (
                        <>
                          <span className="text-gray-600">•</span>
                          <span className="font-mono text-gray-400">{t('admin.general.users.ip')}: {user.lastLoginIp}</span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {user.id !== currentUser?.id && (
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="p-2 hover:bg-red-900/20 rounded text-red-400 hover:text-red-300 transition-colors"
                        title={t('admin.general.users.delete')}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </>
  );
};

export const SettingsPage: React.FC<SettingsPageProps> = ({ 
  onBack, 
  mode = 'administration',
  initialAdminTab = 'general',
  onNavigateToPage,
  onUsersClick,
  onSettingsClick,
  onAdminClick,
  onProfileClick,
  onLogout
}) => {
  const { t } = useTranslation();
  const { user: currentUser } = useUserAuthStore();
  // Check sessionStorage on mount in case initialAdminTab wasn't passed correctly
  const storedAdminTab = sessionStorage.getItem('adminTab') as AdminTab | null;
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>(storedAdminTab || initialAdminTab);

  // Update activeAdminTab when initialAdminTab changes (e.g., from navigation)
  // Also check sessionStorage on mount
  useEffect(() => {
    const tabFromStorage = sessionStorage.getItem('adminTab') as AdminTab | null;
    if (tabFromStorage) {
      setActiveAdminTab(tabFromStorage);
      sessionStorage.removeItem('adminTab'); // Clear after reading
    } else if (initialAdminTab && initialAdminTab !== 'general') {
      setActiveAdminTab(initialAdminTab);
    }
    // Clean URL hash if present
    if (window.location.hash === '#admin') {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [initialAdminTab]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);


  // Devices and permissions removed - not available in LogviewR
  const devices: any[] = [];

  // Helper to check if a permission is granted (simplified for LogviewR)
  const hasPermission = (_permission: string): boolean => {
    return true; // All permissions granted for LogviewR
  };

 

  const showSuccess = (message: string) => {
    setSuccessMessage(message);
    setTimeout(() => setSuccessMessage(null), 3000);
  };

 
 

  const adminTabs: { id: AdminTab; label: string; icon: React.ElementType; color: string }[] = [
    { id: 'general', label: t('admin.tabs.general'), icon: Settings, color: 'blue' },
    { id: 'plugins', label: t('admin.tabs.plugins'), icon: Plug, color: 'emerald' },
    { id: 'regex', label: t('admin.tabs.regex'), icon: Code, color: 'purple' },
    { id: 'theme', label: t('admin.tabs.theme'), icon: Lightbulb, color: 'yellow' },
    { id: 'security', label: t('admin.tabs.security'), icon: Shield, color: 'red' },
    { id: 'exporter', label: t('admin.tabs.exporter'), icon: Share2, color: 'amber' },
    { id: 'database', label: t('admin.tabs.database'), icon: Database, color: 'purple' },
    { id: 'analysis', label: t('admin.tabs.analysis'), icon: BarChart3, color: 'cyan' },
    { id: 'notifications', label: t('admin.tabs.notifications'), icon: Bell, color: 'amber' },
    { id: 'debug', label: t('admin.tabs.debug'), icon: Monitor, color: 'violet' },
    { id: 'info', label: t('admin.tabs.info'), icon: Info, color: 'teal' }
  ];

  return (
    <div className="min-h-screen bg-theme-primary text-theme-primary">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-theme-header backdrop-blur-sm border-b border-theme" style={{ backdropFilter: 'var(--backdrop-blur)' }}>
        <div className="max-w-[1920px] mx-auto px-4 py-4">
          <div className="flex items-center justify-between relative">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                  className="p-2 hover:bg-theme-tertiary rounded-lg transition-colors"
              >
                <ChevronLeft size={24} />
              </button>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-theme-secondary/50 rounded-lg">
                  <Settings size={24} className="text-theme-primary" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-theme-primary">
                    {mode === 'administration' ? t('settings.administration') : t('settings.title')}
                  </h1>
                  <p className="text-sm text-theme-secondary">
                    {t('settings.appManagement')}
                  </p>
                </div>
              </div>
            </div>

            {/* Logo centré - uniquement en mode administration */}
            {mode === 'administration' && (
              <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-3">
                <img src={logviewrLogo} alt="LogviewR" className="w-12 h-12 flex-shrink-0" />
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-theme-primary text-lg">LogviewR</span>
                  {import.meta.env.DEV ? (
                    <span className="px-2 py-0.5 bg-amber-500/20 border border-amber-500/40 rounded text-xs font-semibold text-amber-400 flex items-center gap-1">
                      <span>🔧</span>
                      <span>DEV</span>
                      <span className="text-amber-500/70 font-mono">v{APP_VERSION}</span>
                    </span>
                  ) : (
                    <span className="text-sm text-theme-secondary font-mono">v{APP_VERSION}</span>
                  )}
                </div>
              </div>
            )}

            {mode === 'administration' && (
              <div className="flex items-center gap-3">
                <Clock />
                {/* User Menu */}
                {currentUser && (
                  <UserMenu
                    user={currentUser}
                    onSettingsClick={onSettingsClick}
                    onAdminClick={onAdminClick}
                    onProfileClick={onProfileClick}
                    onUsersClick={onUsersClick}
                    onLogout={onLogout}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1920px] mx-auto px-4 py-6 pb-24">
        {/* Tabs */}
        {mode === 'administration' ? (
          <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
            {adminTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeAdminTab === tab.id;
              const colorClasses: Record<string, { active: string; inactive: string; icon: string }> = {
                blue: {
                  active: 'bg-blue-500/20 border-blue-500/50 text-blue-400',
                  inactive: 'border-gray-700 text-gray-400 hover:border-blue-500/50 hover:text-blue-400',
                  icon: 'text-blue-400'
                },
                purple: {
                  active: 'bg-purple-500/20 border-purple-500/50 text-purple-400',
                  inactive: 'border-gray-700 text-gray-400 hover:border-purple-500/50 hover:text-purple-400',
                  icon: 'text-purple-400'
                },
                emerald: {
                  active: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400',
                  inactive: 'border-gray-700 text-gray-400 hover:border-emerald-500/50 hover:text-emerald-400',
                  icon: 'text-emerald-400'
                },
                cyan: {
                  active: 'bg-cyan-500/20 border-cyan-500/50 text-cyan-400',
                  inactive: 'border-gray-700 text-gray-400 hover:border-cyan-500/50 hover:text-cyan-400',
                  icon: 'text-cyan-400'
                },
                red: {
                  active: 'bg-red-500/20 border-red-500/50 text-red-400',
                  inactive: 'border-gray-700 text-gray-400 hover:border-red-500/50 hover:text-red-400',
                  icon: 'text-red-400'
                },
                amber: {
                  active: 'bg-amber-500/20 border-amber-500/50 text-amber-400',
                  inactive: 'border-gray-700 text-gray-400 hover:border-amber-500/50 hover:text-amber-400',
                  icon: 'text-amber-400'
                },
                yellow: {
                  active: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400',
                  inactive: 'border-gray-700 text-gray-400 hover:border-yellow-500/50 hover:text-yellow-400',
                  icon: 'text-yellow-400'
                },
                violet: {
                  active: 'bg-violet-500/20 border-violet-500/50 text-violet-300',
                  inactive: 'border-gray-700 text-gray-400 hover:border-violet-500/50 hover:text-violet-300',
                  icon: 'text-violet-300'
                },
                teal: {
                  active: 'bg-teal-500/20 border-teal-500/50 text-teal-300',
                  inactive: 'border-gray-700 text-gray-400 hover:border-teal-500/50 hover:text-teal-300',
                  icon: 'text-teal-300'
                }
              };
              const colors = colorClasses[tab.color] || colorClasses.blue;
              
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveAdminTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all whitespace-nowrap ${
                    isActive
                      ? `${colors.active} shadow-lg shadow-${tab.color}-500/20`
                      : `bg-theme-secondary ${colors.inactive}`
                  }`}
                >
                  <Icon size={16} className={isActive ? 'text-white' : 'text-gray-400'} />
                  <span className="text-sm font-medium">{tab.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-2">
           
          </div>
        )}

        {/* Success message */}
        {successMessage && (
          <div className="mb-6 p-4 bg-emerald-900/20 border border-emerald-700/50 rounded-xl flex items-center gap-3">
            <Save className="text-emerald-400" size={18} />
            <p className="text-emerald-400">{successMessage}</p>
          </div>
        )}

        {/* Administration Mode Content */}
        {mode === 'administration' && (
          <>
            {activeAdminTab === 'general' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {/* Colonne 1 */}
                <div className="space-y-6">
                  <Section title={t('admin.general.myProfile')} icon={Users} iconColor="blue">
                    <UserProfileSection />
                  </Section>
                </div>

                {/* Colonne 2 */}
                <div className="space-y-6">

                  <Section title={t('admin.general.defaultPage')} icon={FileText} iconColor="cyan">
                    <DefaultPageSection />
                  </Section>

                  <Section title={t('admin.general.networkConfig')} icon={Network} iconColor="blue">
                    <GeneralNetworkSection />
                  </Section>




                </div>

                {/* Colonne 3 */}
                <div className="space-y-6">
                  {/* Gestion des utilisateurs (Admin only) — anciennement en colonne 1, à la place du cadre Mises à jour */}
                  {currentUser?.role === 'admin' && (
                    <Section title={t('admin.general.userManagement')} icon={Users} iconColor="purple">
                      <UsersManagementSection />
                    </Section>
                  )}
                  <Section title={t('admin.general.informations')} icon={Key} iconColor="purple">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="p-3 bg-[#1a1a1a] rounded-lg border border-gray-800">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-400">{t('admin.general.version')}</span>
                          <span className="text-sm text-white font-mono">{getVersionString()}</span>
                        </div>
                      </div>
                      <div className="p-3 bg-[#1a1a1a] rounded-lg border border-gray-800">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-400">{t('admin.general.database')}</span>
                          <span className="text-sm text-white">SQLite</span>
                        </div>
                      </div>
                      <div className="p-3 bg-[#1a1a1a] rounded-lg border border-gray-800">
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-400">{t('admin.general.authentication')}</span>
                          <span className="text-sm text-white">JWT</span>
                        </div>
                      </div>
                    </div>
                  </Section>

                  <Section title={t('admin.general.localization')} icon={Globe} iconColor="cyan">
                    <SettingRow
                      label={t('admin.general.timezone')}
                      description={t('admin.general.timezoneDescription')}
                    >
                      <select className="px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm">
                        <option value="Europe/Paris">Europe/Paris (UTC+1)</option>
                        <option value="UTC">UTC (UTC+0)</option>
                        <option value="America/New_York">America/New_York (UTC-5)</option>
                      </select>
                    </SettingRow>
                  </Section>

                  <Section title={t('admin.general.language')} icon={Globe} iconColor="cyan">
                    <SettingRow
                      label={t('admin.general.languageLabel')}
                      description={t('admin.general.languageDescription')}
                    >
                      <select
                        value={getAppLanguage()}
                        onChange={(e) => setAppLanguage(e.target.value)}
                        className="px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm"
                      >
                        <option value="fr">{t('admin.languageOptions.fr')}</option>
                        <option value="en">{t('admin.languageOptions.en')}</option>
                      </select>
                    </SettingRow>
                  </Section>
                </div>
              </div>
            )}

            {activeAdminTab === 'theme' && (
              <div className="space-y-6">
                <ThemeSection />
              </div>
            )}


            {/* Plugins Management Section */}
            {activeAdminTab === 'plugins' && (
              <div className="space-y-6">
                <PluginsManagementSection />
              </div>
            )}


            {/* Regex Management Section */}
            {activeAdminTab === 'regex' && (
              <div className="space-y-6">
                <RegexManagementSection />
              </div>
            )}
          

            {/* Security Section */}
            {activeAdminTab === 'security' && (
              <div className="space-y-6">
                <SecuritySection />
                <LogsManagementSection />
              </div>
            )}

            {/* Exporter Section */}
            {activeAdminTab === 'exporter' && (
              <ExporterSection />
            )}

            {/* Database Management Section */}
            {activeAdminTab === 'database' && (
              <DatabaseSection />
            )}

            {/* Info Section */}
            {activeAdminTab === 'info' && (
              <InfoSection />
            )}

            {/* Analysis Section */}
            {activeAdminTab === 'analysis' && (
              <div className="space-y-6">
                <Section title={t('analysis.title')} icon={BarChart3} iconColor="cyan">
                  <div className="space-y-4">
                    <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                      <div className="flex items-start gap-3">
                        <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <h4 className="text-sm font-semibold text-amber-400 mb-1">{t('analysis.inDevTitle')}</h4>
                          <p className="text-xs text-gray-400">
                            {t('analysis.inDevDesc')}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <SettingRow label={t('analysis.autoAnalysis')} description={t('analysis.autoAnalysisDesc')}>
                        <Toggle enabled={false} onChange={() => {}} disabled />
                      </SettingRow>
                      
                      <SettingRow label={t('analysis.anomalyDetection')} description={t('analysis.anomalyDetectionDesc')}>
                        <Toggle enabled={false} onChange={() => {}} disabled />
                      </SettingRow>
                      
                      <SettingRow label={t('analysis.smartAlerts')} description={t('analysis.smartAlertsDesc')}>
                        <Toggle enabled={false} onChange={() => {}} disabled />
                      </SettingRow>
                    </div>
                  </div>
                </Section>
              </div>
            )}

            {/* Notifications Section */}
            {activeAdminTab === 'notifications' && (
              <div className="space-y-6">
                <Section title={t('notifications.title')} icon={Bell} iconColor="amber">
                  <div className="space-y-4">
                    <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                      <div className="flex items-start gap-3">
                        <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <h4 className="text-sm font-semibold text-amber-400 mb-1">{t('notifications.inDevTitle')}</h4>
                          <p className="text-xs text-gray-400">
                            {t('notifications.inDevDesc')}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <SettingRow label={t('notifications.inApp')} description={t('notifications.inAppDesc')}>
                        <Toggle enabled={false} onChange={() => {}} disabled />
                      </SettingRow>
                      
                      <SettingRow label={t('notifications.webhooks')} description={t('notifications.webhooksDesc')}>
                        <Toggle enabled={false} onChange={() => {}} disabled />
                      </SettingRow>
                      
                      <div className="pt-2 border-t border-gray-800">
                        <h4 className="text-sm font-medium text-white mb-3">{t('notifications.webhookConfigTitle')}</h4>
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">{t('notifications.webhookUrl')}</label>
                            <input
                              type="text"
                              disabled
                              placeholder={t('notifications.webhookUrlPlaceholder')}
                              className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">{t('notifications.webhookSecret')}</label>
                            <input
                              type="password"
                              disabled
                              placeholder={t('notifications.webhookSecretPlaceholder')}
                              className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Section>
              </div>
            )}

            {/* Debug Section */}
            {activeAdminTab === 'debug' && (
              <div className="space-y-6">

                <Section title={t('debug.appLogsTitle')} icon={FileText} iconColor="cyan">
                  <AppLogsSection />
                </Section>
                <Section title={t('debug.logLevelsTitle')} icon={Monitor} iconColor="violet">
                  <DebugLogSection />
                </Section>

                <Section title={t('debug.debugDiagnosticsTitle')} icon={Monitor} iconColor="violet">
                  <div className="py-4 space-y-2 text-xs text-gray-400">
                    <p>
                      {t('debug.debugIntro')}
                    </p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>{t('debug.debugBullet1')}</li>
                      <li>{t('debug.debugBullet2')}</li>
                      <li>{t('debug.debugBullet3')}</li>
                      <li>{t('debug.debugBullet4')}</li>
                    </ul>
 
                  </div>
                </Section>
              </div>
            )}

          </> 
        )}

 
      </main>
    </div>
  );
};

export default SettingsPage;