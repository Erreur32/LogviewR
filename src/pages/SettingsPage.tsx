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
  GitFork,
  X,
  CheckCircle,
  Archive,
  AlertTriangle,
  Upload,
  HardDriveDownload,
  Zap,
  Send
} from 'lucide-react';
import { api } from '../api/client';
import { API_ROUTES, formatBytes } from '../utils/constants';
import { usePluginStore } from '../stores/pluginStore';
import { useNotificationStore, type NotifPrefs } from '../stores/notificationStore';
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
import { getPluginIcon } from '../utils/pluginIcons';
import { useUpdateStore } from '../stores/updateStore';
import { UserMenu, Clock } from '../components/ui';
import { useTranslation } from 'react-i18next';
import { setAppLanguage, getAppLanguage } from '../i18n';

export interface SettingsPageProps {
  onBack: () => void;
  mode?: 'administration';
  /** Legacy `debug` is mapped to `info` via toAdminTab */
  initialAdminTab?: 'general' | 'users' | 'plugins' | 'security' | 'exporter' | 'theme' | 'info' | 'analysis' | 'notifications' | 'database' | 'debug';
  onNavigateToPage?: (page: 'plugins' | 'users' | 'fail2ban') => void;
  onUsersClick?: () => void;
  onSettingsClick?: () => void;
  onAdminClick?: () => void;
  onProfileClick?: () => void;
  onLogout?: () => void;
}

type AdminTab = 'general' | 'plugins' | 'security' | 'exporter' | 'theme' | 'info' | 'database' | 'analysis' | 'notifications';

const ADMIN_TAB_IDS: AdminTab[] = ['general', 'plugins', 'analysis', 'notifications', 'theme', 'security', 'exporter', 'database', 'info'];

function toAdminTab(value: string | null | undefined): AdminTab {
  if (!value) return 'general';
  if (value === 'regex') return 'plugins';
  if (value === 'debug') return 'info';
  if (ADMIN_TAB_IDS.includes(value as AdminTab)) return value as AdminTab;
  return 'general';
}

// Modern toggle switch (used in Analysis and other sections)
const Toggle: React.FC<{
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}> = ({ enabled, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={enabled}
    onClick={() => !disabled && onChange(!enabled)}
    disabled={disabled}
    className={`
      relative inline-flex h-6 w-11 shrink-0 rounded-full border border-transparent
      transition-all duration-200 ease-out focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:ring-offset-2 focus:ring-offset-theme-bg
      ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-90'}
      ${enabled ? 'bg-emerald-500' : 'bg-gray-600'}
    `}
  >
    <span
      className={`
        pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm
        transition-transform duration-200 ease-out
        ${enabled ? 'translate-x-5' : 'translate-x-0'}
      `}
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
type PluginPriorityConfig = {
  hostnamePriority: string[];
  vendorPriority: string[];
  overwriteExisting: { hostname: boolean; vendor: boolean };
};

const PluginPrioritySection: React.FC = () => {
  const { t } = useTranslation();
  const { plugins } = usePluginStore();
  const [config, setConfig] = useState<PluginPriorityConfig>({
    hostnamePriority: [],
    vendorPriority: [],
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
      const response = await api.get<PluginPriorityConfig>('/api/network-scan/plugin-priority-config');
      if (response.success && response.result) {
        setConfig(response.result);
        setMessage(null);
      } else {
        setMessage({ type: 'error', text: response.error?.message || t('common.errors.loadFailed') });
      }
    } catch (error: any) {
      console.error('Failed to load plugin priority config:', error);
      setMessage({ type: 'error', text: t('common.errors.loadFailed') });
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
        setMessage({ type: 'success', text: t('common.savedSuccessfully') });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: response.error?.message || t('common.errors.saveFailed') });
      }
    } catch (error: any) {
      console.error('Failed to save plugin priority config:', error);
      setMessage({ type: 'error', text: t('common.errors.saveFailed') });
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
type DatabaseConfig = {
  walMode: 'WAL' | 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'OFF';
  walCheckpointInterval: number;
  walAutoCheckpoint: boolean;
  synchronous: 0 | 1 | 2;
  cacheSize: number;
  busyTimeout: number;
  tempStore: 0 | 1 | 2;
  optimizeForDocker: boolean;
};

const DatabasePerformanceSection: React.FC = () => {
  const { t } = useTranslation();
  const [dbConfig, setDbConfig] = useState<DatabaseConfig>({
    walMode: 'WAL',
    walCheckpointInterval: 1000,
    walAutoCheckpoint: true,
    synchronous: 1,
    cacheSize: -64000,
    busyTimeout: 5000,
    tempStore: 0,
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
      const response = await api.get<DatabaseConfig>('/api/database/config');
      if (response.success && response.result) {
        setDbConfig(response.result);
      } else {
        setMessage({ type: 'error', text: response.error?.message || t('common.errors.loadFailed') });
      }
    } catch (error: any) {
      console.error('Failed to load DB config:', error);
      setMessage({ type: 'error', text: t('common.errors.loadFailed') });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage(null);
    try {
      const response = await api.post<DatabaseConfig>('/api/database/config', dbConfig);
      if (response.success && response.result) {
        setDbConfig(response.result);
        setMessage({ type: 'success', text: t('common.savedSuccessfully') });
        setTimeout(() => setMessage(null), 3000);
      } else {
        setMessage({ type: 'error', text: response.error?.message || t('common.errors.saveFailed') });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: t('common.errors.saveFailed') });
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
        {t('common.loadingConfig')}
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
              {t('debug.warningManyLogs', { count: filteredLogs.length })}
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

// ── Frequency options for update check ────────────────────────────────────────

const UPDATE_FREQUENCIES = [
  { value: 1,   label: '1h' },
  { value: 6,   label: '6h' },
  { value: 12,  label: '12h' },
  { value: 24,  label: '24h' },
  { value: 168, label: '7 jours' },
];

// Update Check Section Component (for Administration > General tab)
const UpdateCheckSection: React.FC = () => {
  const { t } = useTranslation();
  const { updateConfig, updateInfo, loadConfig, setConfig, checkForUpdates, isLoading, lastCheck } = useUpdateStore();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  useEffect(() => {
    if (updateConfig?.enabled) checkForUpdates();
  }, [updateConfig?.enabled]);

  const handleToggle = async (enabled: boolean) => {
    setIsSaving(true);
    try {
      await setConfig(enabled, updateConfig?.frequency ?? 24);
    } catch (e) {
      console.error('[UpdateCheckSection] toggle error:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleFrequency = async (freq: number) => {
    setIsSaving(true);
    try {
      await setConfig(updateConfig?.enabled ?? false, freq);
    } catch (e) {
      console.error('[UpdateCheckSection] frequency error:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const enabled   = updateConfig?.enabled ?? false;
  const frequency = updateConfig?.frequency ?? 24;

  return (
    <div className="space-y-3">
      {/* Enable + Frequency row */}
      <div className="flex items-center gap-3 flex-wrap">
        <Toggle enabled={enabled} onChange={handleToggle} disabled={isSaving} />
        <span className="text-sm text-gray-300 flex-1">
          Vérifier les mises à jour automatiquement
        </span>
        {enabled && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-500">Fréquence :</span>
            <div className="flex gap-1">
              {UPDATE_FREQUENCIES.map(f => (
                <button
                  key={f.value}
                  onClick={() => handleFrequency(f.value)}
                  disabled={isSaving}
                  className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                    frequency === f.value
                      ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                      : 'bg-transparent border-gray-700 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Status block — only when enabled */}
      {enabled && (
        <div className="rounded-lg border border-gray-800 bg-[#0d0d0d] divide-y divide-gray-800">
          {/* Versions */}
          <div className="px-3 py-2 flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Version actuelle</span>
              <span className="font-mono text-gray-300">{updateInfo?.currentVersion || getVersionString()}</span>
            </div>
            {updateInfo?.latestVersion && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Dernière version (GitHub)</span>
                <span className="font-mono text-amber-400">{updateInfo.latestVersion}</span>
              </div>
            )}
            {/* Docker build status */}
            {updateInfo?.latestVersion && updateInfo.latestVersion !== updateInfo.currentVersion && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Image Docker GHCR</span>
                {updateInfo.dockerReady === true ? (
                  <span className="text-green-400 font-semibold">✓ Disponible</span>
                ) : updateInfo.dockerReady === false ? (
                  <span className="text-orange-400">⟳ Build en cours…</span>
                ) : (
                  <span className="text-gray-600">—</span>
                )}
              </div>
            )}
            {lastCheck && (
              <div className="flex justify-between text-xs">
                <span className="text-gray-600">Dernière vérification</span>
                <span className="text-gray-600">{lastCheck.toLocaleTimeString('fr-FR')}</span>
              </div>
            )}
          </div>

          {/* Update available */}
          {updateInfo?.updateAvailable && updateInfo.dockerReady && (
            <div className="px-3 py-2 bg-amber-500/5">
              <p className="text-xs text-amber-400 font-semibold mb-1">
                🚀 Mise à jour disponible — v{updateInfo.latestVersion}
              </p>
              <code className="block text-xs text-cyan-300 bg-black/50 px-2 py-1.5 rounded border border-gray-800 font-mono">
                docker compose pull && docker compose up -d
              </code>
            </div>
          )}

          {/* New tag but build not ready */}
          {updateInfo?.latestVersion &&
            updateInfo.latestVersion !== updateInfo.currentVersion &&
            !updateInfo.dockerReady &&
            !updateInfo.error && (
            <div className="px-3 py-2 bg-orange-500/5">
              <p className="text-xs text-orange-400">
                Tag v{updateInfo.latestVersion} trouvé sur GitHub — en attente de la fin du build Docker.
              </p>
            </div>
          )}

          {/* Error */}
          {updateInfo?.error && (
            <div className="px-3 py-2">
              <p className="text-xs text-red-400">{`${t('common.error')} : ${updateInfo.error}`}</p>
            </div>
          )}

          {/* Check now button */}
          <div className="px-3 py-2 flex justify-end">
            <button
              onClick={() => checkForUpdates()}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-1 text-xs rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
              {isLoading ? 'Vérification…' : 'Vérifier maintenant'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};


// Module-level cache so DefaultPageSection keeps its values across tab switches
let _defaultPageCache: { defaultPage: string; defaultPluginId: string; defaultLogFile: string; defaultFail2banTab: string; rememberLastFile: boolean } | null = null;

const FAIL2BAN_TABS = [
  { id: 'jails',   label: 'Jails' },
  { id: 'tracker', label: 'Tracker IPs' },
  { id: 'stats',   label: 'Stats' },
  { id: 'filtres', label: 'Filtres' },
  { id: 'actions', label: 'Actions' },
  { id: 'ban',     label: 'Ban Manager' },
  { id: 'carte',   label: 'Carte' },
  { id: 'iptables',label: 'IPTables' },
  { id: 'ipset',   label: 'IPSet' },
  { id: 'nftables',label: 'NFTables' },
  { id: 'config',  label: 'Config' },
  { id: 'audit',   label: 'Audit' },
];

// Default Page Configuration Section Component
const DefaultPageSection: React.FC = () => {
  const { t } = useTranslation();
  const { plugins } = usePluginStore();
  const [defaultPage, setDefaultPage] = useState<string>(_defaultPageCache?.defaultPage ?? 'dashboard');
  const [defaultPluginId, setDefaultPluginId] = useState<string>(_defaultPageCache?.defaultPluginId ?? '');
  const [defaultLogFile, setDefaultLogFile] = useState<string>(_defaultPageCache?.defaultLogFile ?? '');
  const [defaultFail2banTab, setDefaultFail2banTab] = useState<string>(_defaultPageCache?.defaultFail2banTab ?? 'jails');
  const [rememberLastFile, setRememberLastFile] = useState<boolean>(_defaultPageCache?.rememberLastFile ?? true);
  const fail2banActive = plugins.some(p => p.id === 'fail2ban' && p.enabled);
  const [availableLogFiles, setAvailableLogFiles] = useState<Array<{ path: string; type: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
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
          defaultFail2banTab?: string;
          rememberLastFile?: boolean;
        }>('/api/system/general');
        if (response.success && response.result) {
          const dp = response.result.defaultPage || 'dashboard';
          const dpi = response.result.defaultPluginId || '';
          const dlf = response.result.defaultLogFile || '';
          const dft = response.result.defaultFail2banTab || 'jails';
          const rlf = response.result.rememberLastFile !== undefined ? response.result.rememberLastFile : true;
          _defaultPageCache = { defaultPage: dp, defaultPluginId: dpi, defaultLogFile: dlf, defaultFail2banTab: dft, rememberLastFile: rlf };
          setDefaultPage(dp);
          setDefaultPluginId(dpi);
          setDefaultLogFile(dlf);
          setDefaultFail2banTab(dft);
          setRememberLastFile(rlf);
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
          defaultPage,
          defaultPluginId: defaultPage === 'log-viewer' ? defaultPluginId : undefined,
          defaultLogFile: defaultPage === 'log-viewer' && defaultPluginId ? defaultLogFile : undefined,
          defaultFail2banTab: defaultPage === 'fail2ban' ? defaultFail2banTab : undefined,
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
  }, [defaultPage, defaultPluginId, defaultLogFile, defaultFail2banTab, rememberLastFile]);

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
  }, [defaultPage, defaultPluginId, defaultLogFile, defaultFail2banTab, rememberLastFile, autoSave, isLoading]);

  const logSourcePlugins = plugins.filter(p =>
    p.enabled && ['host-system', 'nginx', 'apache', 'npm'].includes(p.id)
  );

  return (
    <div className="space-y-4">
      <div className="py-3 border-b border-gray-800">
        <h4 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
          {t('admin.general.defaultPageSection.defaultPageTitle')}
          {isSaving && <Loader2 className="animate-spin text-blue-400" size={12} />}
        </h4>
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
          {fail2banActive && <option value="fail2ban">Fail2ban</option>}
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

      {defaultPage === 'fail2ban' && (
        <div className="py-3 border-b border-gray-800">
          <h4 className="text-sm font-medium text-white mb-2">Tab par défaut</h4>
          <select
            value={defaultFail2banTab}
            onChange={(e) => setDefaultFail2banTab(e.target.value)}
            className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          >
            {FAIL2BAN_TABS.map(tab => (
              <option key={tab.id} value={tab.id}>{tab.label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-400 mt-2">Tab affiché à l'ouverture de la page Fail2ban</p>
        </div>
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
        setMessage({ type: 'success', text: response.result?.message || t('common.savedSuccessfully') });
        setTimeout(() => setMessage(null), 3000);
        // Update initial values after save
        setInitialPublicUrl(publicUrl.trim() || '');
      }
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error?.response?.data?.error?.message || t('common.errors.saveFailed')
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

// ── Notification Section ──────────────────────────────────────────────────────────

interface WebhookEntry {
  id: string;
  name: string;
  type: 'discord' | 'telegram' | 'generic';
  enabled: boolean;
  url?: string;
  token?: string;
  chatId?: string;
  method?: 'POST' | 'PUT';
  events?: { ban: boolean; attempt: boolean; action: boolean };
  batchWindow?: number;   // 0 = immediate, 5/15/30 = minutes
  maxPerBatch?: number;
}

const WEBHOOK_TYPE_LABELS: Record<string, string> = {
  discord:  'Discord',
  telegram: 'Telegram',
  generic:  'Générique',
};
const WEBHOOK_TYPE_COLORS: Record<string, string> = {
  discord:  '#5865F2',
  telegram: '#2AABEE',
  generic:  '#8b949e',
};
const WEBHOOK_TYPE_ICONS: Record<string, string | null> = {
  discord:  '/icons/services/discord.svg',
  telegram: '/icons/services/telegram.svg',
  generic:  null,
};

const DEFAULT_WEBHOOK_EVENTS = { ban: true, attempt: false, action: false };
const DEFAULT_FORM = { name: '', url: '', token: '', chatId: '', events: DEFAULT_WEBHOOK_EVENTS, batchWindow: 0, maxPerBatch: 10 };

const NotificationsSection: React.FC = () => {
  const { setPrefs: storeSetPrefs } = useNotificationStore();

  // ── Tabs ──────────────────────────────────────────────────────────────────────
  const [activeNotifTab, setActiveNotifTab] = useState<'internal' | 'webhooks'>('internal');

  // ── Prefs ────────────────────────────────────────────────────────────────────
  const [prefs, setPrefsLocal] = useState<NotifPrefs>({ ban: true, attempt: true, action: true });
  const [prefsSaving, setPrefsSaving] = useState(false);

  // ── Webhooks ─────────────────────────────────────────────────────────────────
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [wLoading, setWLoading]     = useState(true);
  const [showForm, setShowForm]     = useState<'discord' | 'telegram' | 'generic' | null>(null);
  const [editId, setEditId]         = useState<string | null>(null);
  const [form, setForm]             = useState(DEFAULT_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError]   = useState('');
  const [testingId, setTestingId]   = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadPrefs = useCallback(async () => {
    try {
      const res = await api.get<NotifPrefs>('/api/notifications/prefs');
      if (res.result) { setPrefsLocal(res.result); storeSetPrefs(res.result); }
    } catch { /* use defaults */ }
  }, [storeSetPrefs]);

  const loadWebhooks = useCallback(async () => {
    setWLoading(true);
    try {
      const res = await api.get<WebhookEntry[]>('/api/notifications/webhooks');
      if (res.result) setWebhooks(res.result);
    } catch { /* ignore */ }
    finally { setWLoading(false); }
  }, []);

  useEffect(() => { loadPrefs(); loadWebhooks(); }, [loadPrefs, loadWebhooks]);

  const savePref = async (key: keyof NotifPrefs, val: boolean) => {
    const next = { ...prefs, [key]: val };
    setPrefsLocal(next);
    storeSetPrefs(next);
    setPrefsSaving(true);
    try { await api.post('/api/notifications/prefs', next); }
    finally { setPrefsSaving(false); }
  };

  const openAddForm = (type: 'discord' | 'telegram' | 'generic') => {
    setForm({ ...DEFAULT_FORM });
    setFormError('');
    setEditId(null);
    setShowForm(type);
  };

  const openEditForm = (wh: WebhookEntry) => {
    setForm({
      name: wh.name, url: wh.url || '', token: wh.token || '', chatId: wh.chatId || '',
      events: wh.events ?? { ...DEFAULT_WEBHOOK_EVENTS },
      batchWindow: wh.batchWindow ?? 0,
      maxPerBatch: wh.maxPerBatch ?? 10,
    });
    setFormError('');
    setEditId(wh.id);
    setShowForm(wh.type);
  };

  const submitForm = async () => {
    if (!showForm) return;
    setFormError('');
    setFormSaving(true);
    try {
      const payload = { name: form.name, type: showForm, url: form.url, token: form.token, chatId: form.chatId, events: form.events, batchWindow: form.batchWindow, maxPerBatch: form.maxPerBatch };
      if (editId) {
        const res = await api.put<WebhookEntry>(`/api/notifications/webhooks/${editId}`, payload);
        if (res.result) setWebhooks(ws => ws.map(w => w.id === editId ? res.result! : w));
      } else {
        const res = await api.post<WebhookEntry>('/api/notifications/webhooks', payload);
        if (res.result) setWebhooks(ws => [...ws, res.result!]);
      }
      setShowForm(null); setEditId(null);
    } catch (e: any) {
      setFormError(e?.message || 'Erreur lors de l\'enregistrement');
    } finally { setFormSaving(false); }
  };

  const deleteWh = async (id: string) => {
    setDeletingId(id);
    try {
      await api.delete(`/api/notifications/webhooks/${id}`);
      setWebhooks(ws => ws.filter(w => w.id !== id));
      setTestResults(r => { const n = { ...r }; delete n[id]; return n; });
    } finally { setDeletingId(null); }
  };

  const testWh = async (id: string) => {
    setTestingId(id);
    setTestResults(r => { const n = { ...r }; delete n[id]; return n; });
    try {
      await api.post(`/api/notifications/webhooks/${id}/test`, {});
      setTestResults(r => ({ ...r, [id]: { ok: true, msg: 'Envoyé !' } }));
    } catch (e: any) {
      setTestResults(r => ({ ...r, [id]: { ok: false, msg: e?.message || 'Erreur' } }));
    } finally { setTestingId(null); }
  };

  const toggleWh = async (id: string, enabled: boolean) => {
    setWebhooks(ws => ws.map(w => w.id === id ? { ...w, enabled } : w));
    try { await api.put(`/api/notifications/webhooks/${id}`, { enabled }); }
    catch { setWebhooks(ws => ws.map(w => w.id === id ? { ...w, enabled: !enabled } : w)); }
  };

  return (
    <div className="space-y-4">

      {/* ── Tab bar ─────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 bg-[#111] border border-gray-800 rounded-lg w-fit">
        {([
          { id: 'internal' as const, label: 'Notifications internes', icon: Bell,   activeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
          { id: 'webhooks' as const, label: 'Webhooks',               icon: Share2, activeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
        ]).map(tab => {
          const Icon = tab.icon;
          const isActive = activeNotifTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveNotifTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                isActive ? tab.activeColor : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}>
              <Icon size={12} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Notifications internes ──────────────────────────────────────────────── */}
      {activeNotifTab === 'internal' && (
        <div className="space-y-3 p-4 bg-[#0d1117] border border-gray-800 rounded-lg">
          <p className="text-xs text-gray-400">
            Choisissez quels types de notifications s'affichent dans la barre centrale de l'interface.
            {prefsSaving && <span className="ml-2 text-cyan-400"><Loader2 size={10} className="inline animate-spin mr-1" />Enregistrement…</span>}
          </p>
          <div className="space-y-1">
            <SettingRow label="Bannissements IP" description="Alerte quand une IP est bannie par Fail2ban">
              <Toggle enabled={prefs.ban} onChange={v => savePref('ban', v)} disabled={prefsSaving} />
            </SettingRow>
            <SettingRow label="Tentatives de connexion" description="Alerte quand de nouvelles tentatives échouées sont détectées">
              <Toggle enabled={prefs.attempt} onChange={v => savePref('attempt', v)} disabled={prefsSaving} />
            </SettingRow>
            <SettingRow label="Retours d'actions" description="Confirmation ou erreur après une action (ban manuel, config, etc.)">
              <Toggle enabled={prefs.action} onChange={v => savePref('action', v)} disabled={prefsSaving} />
            </SettingRow>
          </div>
        </div>
      )}

      {/* ── Webhooks ────────────────────────────────────────────────────────────── */}
      {activeNotifTab === 'webhooks' && (
        <div className="space-y-4 p-4 bg-[#0d1117] border border-gray-800 rounded-lg">
          <p className="text-xs text-gray-400">
            Envoyez des alertes vers Discord, Telegram ou un endpoint HTTP personnalisé.
          </p>

          {/* Add buttons */}
          <div className="flex flex-wrap gap-2">
            {(['discord', 'telegram', 'generic'] as const).map(type => (
              <button key={type} onClick={() => openAddForm(type)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
                style={{ color: WEBHOOK_TYPE_COLORS[type], borderColor: `${WEBHOOK_TYPE_COLORS[type]}55`, background: `${WEBHOOK_TYPE_COLORS[type]}18` }}>
                {WEBHOOK_TYPE_ICONS[type]
                  ? <img src={WEBHOOK_TYPE_ICONS[type]!} alt={type} style={{ width: 13, height: 13, objectFit: 'contain' }} />
                  : <Plus size={12} />
                } {WEBHOOK_TYPE_LABELS[type]}
              </button>
            ))}
          </div>

          {/* Add / Edit form */}
          {showForm && (
            <div className="p-4 bg-[#0d1117] border border-gray-700 rounded-lg space-y-4">
              <h4 className="text-sm font-semibold text-white">
                {editId ? `Modifier — ${WEBHOOK_TYPE_LABELS[showForm]}` : `Ajouter — ${WEBHOOK_TYPE_LABELS[showForm]}`}
              </h4>

              {/* Name */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Nom</label>
                <input type="text" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={`Mon webhook ${WEBHOOK_TYPE_LABELS[showForm]}`}
                  className="w-full px-3 py-2 bg-[#161b22] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
              </div>

              {/* Discord / Generic URL */}
              {(showForm === 'discord' || showForm === 'generic') && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    {showForm === 'discord' ? 'URL Webhook Discord' : 'URL Endpoint'}
                  </label>
                  <input type="url" value={form.url}
                    onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
                    placeholder={showForm === 'discord' ? 'https://discord.com/api/webhooks/…' : 'https://example.com/webhook'}
                    className="w-full px-3 py-2 bg-[#161b22] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                  {showForm === 'discord' && (
                    <p className="mt-1 text-xs text-gray-500">Paramètres du serveur → Intégrations → Webhooks dans Discord.</p>
                  )}
                </div>
              )}

              {/* Telegram */}
              {showForm === 'telegram' && (
                <>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Token du Bot</label>
                    <input type="text" value={form.token}
                      onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
                      placeholder="123456789:AAFabcXYZ…"
                      className="w-full px-3 py-2 bg-[#161b22] border border-gray-700 rounded-lg text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                    <p className="mt-1 text-xs text-gray-500">Obtenu via @BotFather sur Telegram.</p>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Chat ID</label>
                    <input type="text" value={form.chatId}
                      onChange={e => setForm(f => ({ ...f, chatId: e.target.value }))}
                      placeholder="-100123456789"
                      className="w-full px-3 py-2 bg-[#161b22] border border-gray-700 rounded-lg text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                    <p className="mt-1 text-xs text-gray-500">ID du chat ou groupe. Utilisez @userinfobot pour le trouver.</p>
                  </div>
                </>
              )}

              {/* Event triggers */}
              <div className="p-3 bg-[#161b22] border border-gray-800 rounded-lg space-y-2">
                <p className="text-xs font-medium text-gray-300 mb-2">Événements déclencheurs</p>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-300">Bannissements IP</span>
                    <span className="text-xs text-gray-600 block">Envoi quand une IP est bannie par Fail2ban</span>
                  </div>
                  <Toggle enabled={form.events.ban} onChange={v => setForm(f => ({ ...f, events: { ...f.events, ban: v } }))} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-300">Tentatives de connexion</span>
                    <span className="text-xs text-gray-600 block">Envoi quand de nouvelles tentatives sont détectées</span>
                  </div>
                  <Toggle enabled={form.events.attempt} onChange={v => setForm(f => ({ ...f, events: { ...f.events, attempt: v } }))} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-300">Retours d'actions</span>
                    <span className="text-xs text-gray-600 block">Ban manuel, débannissement, modification de config</span>
                  </div>
                  <Toggle enabled={form.events.action} onChange={v => setForm(f => ({ ...f, events: { ...f.events, action: v } }))} />
                </div>
              </div>

              {/* Frequency / batching */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Regroupement d'envoi</label>
                <select value={form.batchWindow}
                  onChange={e => setForm(f => ({ ...f, batchWindow: Number(e.target.value) }))}
                  className="w-full px-3 py-2 bg-[#161b22] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500/50">
                  <option value={0}>Immédiat — 1 message par événement</option>
                  <option value={5}>Regrouper — toutes les 5 minutes</option>
                  <option value={15}>Regrouper — toutes les 15 minutes</option>
                  <option value={30}>Regrouper — toutes les 30 minutes</option>
                </select>
                {form.batchWindow > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-400">Maximum</span>
                    <input type="number" min={1} max={50} value={form.maxPerBatch}
                      onChange={e => setForm(f => ({ ...f, maxPerBatch: Number(e.target.value) }))}
                      className="w-20 px-2 py-1.5 bg-[#161b22] border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-cyan-500/50" />
                    <span className="text-xs text-gray-400">événements par message</span>
                  </div>
                )}
              </div>

              {formError && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle size={12} /> {formError}
                </p>
              )}
              {editId && testResults[editId] && (
                <p className={`text-xs flex items-center gap-1 ${testResults[editId].ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {testResults[editId].ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                  {testResults[editId].msg}
                </p>
              )}
              <div className="flex justify-between items-center pt-1">
                {editId ? (
                  <button onClick={() => testWh(editId)} disabled={testingId === editId}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-cyan-500/40 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-40 transition-colors">
                    {testingId === editId ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Envoyer un test
                  </button>
                ) : <span />}
                <div className="flex items-center gap-2">
                  <button onClick={() => { setShowForm(null); setEditId(null); setFormError(''); }}
                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-white transition-colors">
                    Annuler
                  </button>
                  <button onClick={submitForm} disabled={formSaving}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-cyan-600 hover:bg-cyan-500 text-gray-100 disabled:opacity-50 transition-colors">
                    {formSaving && <Loader2 size={12} className="animate-spin" />}
                    {editId ? 'Enregistrer' : 'Ajouter'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Webhook list */}
          {wLoading ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
              <Loader2 size={14} className="animate-spin" /> Chargement…
            </div>
          ) : webhooks.length === 0 ? (
            <p className="text-sm text-gray-500 py-1">Aucun webhook configuré.</p>
          ) : (
            <div className="space-y-2">
              {webhooks.map(wh => (
                <div key={wh.id} className="p-3 bg-[#0d1117] border border-gray-800 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: wh.enabled ? WEBHOOK_TYPE_COLORS[wh.type] : '#374151' }} />
                    <span className="flex items-center gap-1 text-xs font-semibold px-1.5 py-0.5 rounded flex-shrink-0" style={{
                      background: `${WEBHOOK_TYPE_COLORS[wh.type]}22`, color: WEBHOOK_TYPE_COLORS[wh.type], border: `1px solid ${WEBHOOK_TYPE_COLORS[wh.type]}44`,
                    }}>
                      {WEBHOOK_TYPE_ICONS[wh.type] && (
                        <img src={WEBHOOK_TYPE_ICONS[wh.type]!} alt={wh.type} style={{ width: 12, height: 12, objectFit: 'contain' }} />
                      )}
                      {WEBHOOK_TYPE_LABELS[wh.type]}
                    </span>
                    <span className="text-sm text-white flex-1 min-w-0 truncate">{wh.name}</span>
                    {testResults[wh.id] && (
                      <span className={`text-xs flex-shrink-0 ${testResults[wh.id].ok ? 'text-emerald-400' : 'text-red-400'}`}>
                        {testResults[wh.id].ok ? <CheckCircle size={12} className="inline mr-1" /> : <AlertCircle size={12} className="inline mr-1" />}
                        {testResults[wh.id].msg}
                      </span>
                    )}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Toggle enabled={wh.enabled} onChange={v => toggleWh(wh.id, v)} />
                      <button onClick={() => testWh(wh.id)} disabled={testingId === wh.id || !wh.enabled}
                        title="Envoyer un message de test"
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-40 transition-colors ml-1">
                        {testingId === wh.id ? <Loader2 size={11} className="animate-spin" /> : <Zap size={11} />}
                        Test
                      </button>
                      <button onClick={() => openEditForm(wh)} title="Modifier"
                        className="p-1.5 text-gray-500 hover:text-white transition-colors">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => deleteWh(wh.id)} disabled={deletingId === wh.id}
                        title="Supprimer"
                        className="p-1.5 text-gray-500 hover:text-red-400 disabled:opacity-40 transition-colors">
                        {deletingId === wh.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  </div>
                  {/* Event badges + frequency */}
                  <div className="flex flex-wrap gap-1 mt-2 pl-6">
                    {wh.events?.ban     && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">Ban</span>}
                    {wh.events?.attempt && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">Tentative</span>}
                    {wh.events?.action  && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">Action</span>}
                    {!wh.events?.ban && !wh.events?.attempt && !wh.events?.action && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/60 text-gray-500">Aucun événement</span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700/60 text-gray-400">
                      {wh.batchWindow ? `Regroupé /${wh.batchWindow}min` : 'Immédiat'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── BackupSection — Sauvegardes tab in Database ──────────────────────────────────

interface F2bCounts {
  configSnapshots: number;
  dbSnapshots: number;
  iptablesBackups: number;
  ipsetBackups: number;
}

const BackupSection: React.FC<{
  fail2banEnabled: boolean;
  onNavigateToPage?: (page: 'plugins' | 'users' | 'fail2ban') => void;
}> = ({ fail2banEnabled, onNavigateToPage }) => {
  // ── Config export/import ─────────────────────────────────────────────────
  const [isExporting, setIsExporting]     = useState(false);
  const [selectedFile, setSelectedFile]   = useState<File | null>(null);
  const [configMsg, setConfigMsg]         = useState<{ ok: boolean; text: string } | null>(null);

  // ── Fail2ban counts ──────────────────────────────────────────────────────
  const [f2bCounts, setF2bCounts]         = useState<F2bCounts | null>(null);
  const [f2bLoading, setF2bLoading]       = useState(false);

  useEffect(() => {
    if (!fail2banEnabled) return;
    setF2bLoading(true);
    const base = '/api/plugins/fail2ban';
    Promise.all([
      api.get<{ snapshots: unknown[] }>(`${base}/backup/snapshots`),
      api.get<{ snapshots: unknown[] }>(`${base}/db-snapshots`),
      api.get<unknown[]>(`${base}/iptables/backups`),
      api.get<unknown[]>(`${base}/ipset/backups`),
    ]).then(([cfg, db, ipt, ips]) => {
      setF2bCounts({
        configSnapshots:  (cfg.result?.snapshots ?? []).length,
        dbSnapshots:      (db.result?.snapshots  ?? []).length,
        iptablesBackups:  Array.isArray(ipt.result) ? ipt.result.length : 0,
        ipsetBackups:     Array.isArray(ips.result) ? ips.result.length : 0,
      });
    }).catch(() => setF2bCounts(null))
      .finally(() => setF2bLoading(false));
  }, [fail2banEnabled]);

  const handleExport = async () => {
    setIsExporting(true); setConfigMsg(null);
    try {
      const res = await api.get<{ content: string }>('/api/config/export');
      if (!res.result) throw new Error('Réponse vide');
      const blob = new Blob([res.result.content], { type: 'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = 'logviewr.conf';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      setConfigMsg({ ok: true, text: 'Configuration exportée avec succès.' });
    } catch (e: any) {
      setConfigMsg({ ok: false, text: e?.message || 'Erreur lors de l\'export.' });
    } finally { setIsExporting(false); }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file); setConfigMsg(null);
    try {
      const content = await file.text();
      const res = await api.post<{ imported: number; message: string }>('/api/config/import', { content });
      if (!res.success) throw new Error(res.error?.message || 'Import échoué');
      setConfigMsg({ ok: true, text: res.result?.message || `${res.result?.imported} paramètres importés — rechargement…` });
      setTimeout(() => window.location.reload(), 2000);
    } catch (err: any) {
      setConfigMsg({ ok: false, text: err?.message || 'Erreur lors de l\'import.' });
      setSelectedFile(null);
    }
    e.target.value = '';
  };

  // Badge helper
  const CountBadge = ({ n, label }: { n: number; label: string }) => (
    <div className="flex items-center justify-between py-1 border-b border-gray-800/60 last:border-0">
      <span className="text-xs text-gray-400">{label}</span>
      <span className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded ${
        n > 0 ? 'bg-emerald-500/12 text-emerald-400' : 'bg-gray-700/40 text-gray-500'
      }`}>{n}</span>
    </div>
  );

  return (
    <Section title="Sauvegardes" icon={Archive} iconColor="amber" collapsible>
      <div className="space-y-5">

        {/* ── 1. Configuration logviewr.conf ─────────────────────────────── */}
        <div className="p-3 bg-[#0d1117] border border-gray-800 rounded-lg space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <FileText size={13} className="text-amber-400" />
            <span className="text-sm font-medium text-white">Configuration application</span>
            <span className="text-xs text-gray-500 ml-1">logviewr.conf</span>
          </div>
          <p className="text-xs text-gray-400">
            Exporte tous les paramètres de l'application dans un fichier texte. Utile pour migrer ou restaurer une configuration.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handleExport} disabled={isExporting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600/80 hover:bg-amber-500/80 text-white disabled:opacity-50 transition-colors">
              {isExporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              Exporter .conf
            </button>
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-700 text-gray-300 bg-gray-800/50 hover:bg-gray-700/50 transition-colors cursor-pointer">
              <Upload size={12} />
              {selectedFile ? selectedFile.name : 'Importer .conf'}
              <input type="file" accept=".conf" onChange={handleImport} className="hidden" />
            </label>
          </div>
          {configMsg && (
            <div className={`flex items-center gap-2 text-xs p-2 rounded ${
              configMsg.ok ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
            }`}>
              {configMsg.ok ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
              {configMsg.text}
            </div>
          )}
        </div>

        {/* ── 2. Fail2ban snapshots ──────────────────────────────────────── */}
        <div className={`p-3 border rounded-lg space-y-2 ${
          fail2banEnabled ? 'bg-[#0d1117] border-gray-800' : 'bg-amber-500/5 border-amber-500/20'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield size={13} className={fail2banEnabled ? 'text-emerald-400' : 'text-amber-400'} />
              <span className="text-sm font-medium text-white">Fail2ban</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                fail2banEnabled
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-amber-500/15 text-amber-400'
              }`}>{fail2banEnabled ? 'actif' : 'inactif'}</span>
            </div>
            {fail2banEnabled && (
              <button onClick={() => onNavigateToPage?.('fail2ban')}
                className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
                Ouvrir <ExternalLink size={11} />
              </button>
            )}
          </div>

          {fail2banEnabled ? (
            <>
              <p className="text-xs text-gray-400">Snapshots & exports gérés dans le plugin Fail2ban → onglet <strong className="text-gray-300">Sauvegardes</strong>.</p>
              {f2bLoading ? (
                <div className="flex items-center gap-1.5 text-xs text-gray-500 py-1">
                  <Loader2 size={11} className="animate-spin" /> Chargement des compteurs…
                </div>
              ) : f2bCounts ? (
                <div className="mt-1 grid grid-cols-2 gap-x-6">
                  <CountBadge n={f2bCounts.configSnapshots} label="Snapshots config" />
                  <CountBadge n={f2bCounts.dbSnapshots}     label="Snapshots base de données" />
                  <CountBadge n={f2bCounts.iptablesBackups} label="Backups iptables" />
                  <CountBadge n={f2bCounts.ipsetBackups}    label="Backups ipset" />
                </div>
              ) : null}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-amber-300/80">
                Le plugin Fail2ban fournit les sauvegardes automatiques (snapshots config, DB, iptables, ipset).
              </p>
              <button onClick={() => onNavigateToPage?.('plugins')}
                className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors">
                Activer dans Plugins <ExternalLink size={11} />
              </button>
            </div>
          )}
        </div>

        {/* ── 3. SQLite manuel ──────────────────────────────────────────── */}
        <div className="p-3 bg-[#0d1117] border border-gray-800 rounded-lg space-y-2">
          <div className="flex items-center gap-2">
            <HardDriveDownload size={13} className="text-purple-400" />
            <span className="text-sm font-medium text-white">Base de données SQLite</span>
            <span className="text-xs text-gray-500 ml-1">sauvegarde manuelle</span>
          </div>
          <p className="text-xs text-gray-400">
            Le fichier SQLite principal contient toute la configuration persistante (utilisateurs, paramètres, logs analysés).
            Copiez-le régulièrement pour garantir une restauration complète.
          </p>
          <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-900/60 rounded border border-gray-700/50">
            <Server size={11} className="text-gray-500 shrink-0" />
            <code className="text-xs text-gray-400 font-mono">/data/logviewr.db</code>
            <span className="text-xs text-gray-600 ml-auto">(volume Docker)</span>
          </div>
        </div>

      </div>
    </Section>
  );
};

// Database Section Component (Administration > Base de données)
interface DbHealthResult {
  ok: boolean;
  full: boolean;
  checks: Record<string, string>[];
  freelistCount: number;
  pageCount: number;
  pageSize: number;
  fragmentation: number;
}
interface VacuumResult { ok: boolean; beforeSize: number; afterSize: number; saved: number }

const DatabaseSection: React.FC<{
  onNavigateToPage?: (page: 'plugins' | 'users' | 'fail2ban') => void;
}> = ({ onNavigateToPage }) => {
  const { t } = useTranslation();
  const { plugins } = usePluginStore();

  // ── Stats ──────────────────────────────────────────────────────────────────
  const [dbStats, setDbStats]       = useState<DbEngineStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // ── Health ─────────────────────────────────────────────────────────────────
  const [health, setHealth]         = useState<DbHealthResult | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthErr, setHealthErr]   = useState<string | null>(null);

  // ── VACUUM ─────────────────────────────────────────────────────────────────
  const [vacuuming, setVacuuming]   = useState(false);
  const [vacuumResult, setVacuumResult] = useState<VacuumResult | null>(null);
  const [vacuumErr, setVacuumErr]   = useState<string | null>(null);

  const fail2banEnabled = plugins.some(p => p.id === 'fail2ban' && p.enabled);

  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      setStatsLoading(true);
      try {
        const r = await api.get<DbEngineStats>('/api/database/stats');
        if (!cancelled && r.success && r.result) setDbStats(r.result);
      } finally { if (!cancelled) setStatsLoading(false); }
    };
    const fetchHealth = async () => {
      setHealthLoading(true);
      try {
        const r = await api.get<DbHealthResult>('/api/database/health');
        if (!cancelled && r.success && r.result) setHealth(r.result);
        else if (!cancelled) setHealthErr('Impossible de lancer le check');
      } catch { if (!cancelled) setHealthErr('Erreur réseau'); }
      finally { if (!cancelled) setHealthLoading(false); }
    };
    fetchStats();
    fetchHealth();
    return () => { cancelled = true; };
  }, []);

  const runCheck = async (full = false) => {
    setHealthLoading(true); setHealthErr(null); setHealth(null);
    try {
      const r = await api.get<DbHealthResult>(`/api/database/health${full ? '?full=1' : ''}`);
      if (r.success && r.result) setHealth(r.result);
      else setHealthErr('Erreur serveur');
    } catch { setHealthErr('Erreur réseau'); }
    finally { setHealthLoading(false); }
  };

  const runVacuum = async () => {
    if (!window.confirm('Lancer VACUUM ?\n\nOpération bloquante (~quelques secondes). La base sera compactée et défragmentée.')) return;
    setVacuuming(true); setVacuumResult(null); setVacuumErr(null);
    try {
      const r = await api.post<VacuumResult>('/api/database/vacuum', {});
      if (r.success && r.result) setVacuumResult(r.result);
      else setVacuumErr('Erreur serveur');
    } catch { setVacuumErr('Erreur réseau'); }
    finally { setVacuuming(false); }
  };

  const syncLabel = dbStats?.synchronous === 0 ? 'OFF' : dbStats?.synchronous === 1 ? 'NORMAL' : dbStats?.synchronous === 2 ? 'FULL' : String(dbStats?.synchronous ?? '-');

  // Health badge for section header
  const healthBadge = health
    ? health.ok && health.fragmentation <= 10
      ? <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">OK</span>
      : <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400">{health.ok ? `Fragmenté ${health.fragmentation}%` : 'Erreur'}</span>
    : null;

  const hasHealthIssue = !!health && (!health.ok || health.fragmentation > 10);

  return (
    <div className="space-y-4">

      {/* ── 1. Informations ──────────────────────────────────────────────────── */}
      <Section title={t('database.defaultDbTitle')} icon={Info} iconColor="blue" collapsible defaultCollapsed>
        <p className="text-xs text-gray-400 mb-3">{t('database.defaultDbDesc')}</p>
        <div className="space-y-1 text-xs">
          <div className="text-blue-400 font-semibold mb-1">{t('database.tablesUsed')}</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {[
              ['users',                   t('database.tableUsers')],
              ['plugin_configs',          t('database.tablePluginConfigs')],
              ['log_sources',             t('database.tableLogSources')],
              ['log_files',               t('database.tableLogFiles')],
              ['logs',                    t('database.tableLogs')],
              ['user_plugin_permissions', t('database.tableUserPluginPermissions')],
              ['app_config',              t('database.tableAppConfig')],
            ].map(([name, desc]) => (
              <div key={name} className="flex items-baseline gap-2">
                <code className="text-cyan-400 shrink-0">{name}</code>
                <span className="text-gray-500">— {desc}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ── 2. Statistiques ──────────────────────────────────────────────────── */}
      <Section
        title={t('database.statsTitle')}
        icon={BarChart3}
        iconColor="purple"
        collapsible
        badge={dbStats ? <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-400 font-mono">{formatBytes(dbStats.dbSize)}</span> : undefined}
      >
        {statsLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400"><Loader2 size={14} className="animate-spin" />{t('database.loading')}</div>
        ) : dbStats ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-8 gap-y-0 text-sm">
            {[
              [t('database.type'),        'SQLite'],
              [t('database.sizeEstimate'), formatBytes(dbStats.dbSize)],
              [t('database.journalMode'), dbStats.journalMode.toUpperCase()],
              [t('database.pageSize'),    `${dbStats.pageSize} B`],
              [t('database.pageCount'),   dbStats.pageCount.toLocaleString()],
              [t('database.synchronous'), syncLabel],
              [t('database.cache'),       dbStats.cacheSize < 0 ? formatBytes(Math.abs(dbStats.cacheSize) * 1024) : t('database.cachePages', { count: dbStats.cacheSize })],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-1.5 border-b border-gray-700/40">
                <span className="text-gray-400">{label}</span>
                <span className="font-mono text-theme-primary">{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">{t('database.statsNotAvailable')}</p>
        )}
      </Section>

      {/* ── 3. Santé & Intégrité ─────────────────────────────────────────────── */}
      <Section
        title="Santé & Intégrité"
        icon={Shield}
        iconColor={hasHealthIssue ? 'amber' : 'emerald'}
        collapsible
        defaultCollapsed={!hasHealthIssue}
        badge={healthBadge}
      >
        <div className="space-y-4">
          {/* Check buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { void runCheck(false); }}
              disabled={healthLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors"
            >
              {healthLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle size={13} />}
              Vérification rapide
            </button>
            <button
              onClick={() => { void runCheck(true); }}
              disabled={healthLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 disabled:opacity-50 transition-colors"
            >
              {healthLoading ? <Loader2 size={13} className="animate-spin" /> : <Shield size={13} />}
              Intégrité complète
            </button>
            <button
              onClick={() => { void runVacuum(); }}
              disabled={vacuuming || healthLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
            >
              {vacuuming ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              VACUUM
            </button>
          </div>

          {/* Health result */}
          {healthErr && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <AlertCircle size={13} />
              {healthErr}
            </div>
          )}
          {health && (
            <div className={`rounded-lg border px-4 py-3 text-sm space-y-2 ${health.ok ? 'bg-emerald-500/8 border-emerald-500/25' : 'bg-red-500/8 border-red-500/25'}`}>
              <div className={`flex items-center gap-2 font-medium ${health.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {health.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                {health.full ? 'Intégrité complète' : 'Vérification rapide'} — {health.ok ? 'Aucun problème détecté' : 'Problèmes détectés'}
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs pt-1">
                <div className="flex flex-col gap-0.5">
                  <span className="text-gray-500 uppercase tracking-wider text-[10px]">Pages libres</span>
                  <span className={`font-mono font-semibold ${health.freelistCount > 0 ? 'text-amber-400' : 'text-gray-300'}`}>{health.freelistCount.toLocaleString()}</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-gray-500 uppercase tracking-wider text-[10px]">Fragmentation</span>
                  <span className={`font-mono font-semibold ${health.fragmentation > 20 ? 'text-red-400' : health.fragmentation > 10 ? 'text-amber-400' : 'text-emerald-400'}`}>{health.fragmentation}%</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-gray-500 uppercase tracking-wider text-[10px]">Pages totales</span>
                  <span className="font-mono font-semibold text-gray-300">{health.pageCount.toLocaleString()}</span>
                </div>
              </div>
              {health.fragmentation > 10 && (
                <p className="text-xs text-amber-400/80 mt-1">Fragmentation élevée — un VACUUM permettrait de récupérer {formatBytes(health.freelistCount * health.pageSize)}.</p>
              )}
              {!health.ok && health.checks.length > 1 && (
                <div className="mt-2 space-y-1 text-xs text-red-300 font-mono bg-red-900/20 rounded px-2 py-1.5 max-h-32 overflow-y-auto">
                  {health.checks.slice(0, 20).map((row, i) => <div key={i}>{Object.values(row)[0]}</div>)}
                </div>
              )}
            </div>
          )}

          {/* VACUUM result */}
          {vacuumErr && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              <AlertCircle size={13} /> {vacuumErr}
            </div>
          )}
          {vacuumResult && (
            <div className="flex items-center gap-3 text-sm text-emerald-400 bg-emerald-500/8 border border-emerald-500/25 rounded-lg px-4 py-2">
              <CheckCircle size={14} />
              VACUUM terminé — {vacuumResult.saved > 0 ? `${formatBytes(vacuumResult.saved)} récupérés` : 'aucun espace récupéré'}
              <span className="text-gray-500 text-xs ml-auto">{formatBytes(vacuumResult.beforeSize)} → {formatBytes(vacuumResult.afterSize)}</span>
            </div>
          )}

          <p className="text-xs text-gray-500">
            Le VACUUM compacte le fichier SQLite et récupère les pages fragmentées. Il bloque brièvement les écritures.
          </p>
        </div>
      </Section>

      {/* ── 4. Performances ──────────────────────────────────────────────────── */}
      <Section title="Performances" icon={HardDrive} iconColor="cyan" collapsible defaultCollapsed>
        <DatabasePerformanceSection />
      </Section>

      {/* ── 5. Sauvegardes ───────────────────────────────────────────────────── */}
      <BackupSection fail2banEnabled={fail2banEnabled} onNavigateToPage={onNavigateToPage} />

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
    <>
      {/* ── LogviewR — identity card + about/author/tech ── */}
      <Section title="LogviewR" icon={Info} iconColor="teal" collapsible>
        <div className="flex gap-8 items-start">

          {/* Left — logo, version, GitHub, stats */}
          <div className="flex flex-col items-center text-center shrink-0 w-56">
            <img src={logviewrLogo} alt="LogviewR" className="h-16 w-auto mb-3 object-contain" />
            <h3 className="text-base font-semibold text-theme-primary mb-1">LogviewR</h3>
            <p className="text-xs text-theme-secondary mb-3 leading-relaxed">
              {t('info.tagline')}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2 border-y border-gray-700 w-full text-xs">
              <span className="text-gray-400">{t('info.version')}</span>
              <span className="font-mono text-theme-primary">{getVersionString()}</span>
              <span className="text-gray-600">·</span>
              <span className="text-gray-400">{t('info.license')}</span>
              <span className="text-theme-primary">{t('info.licenseValue')}</span>
            </div>
            <a
              href="https://github.com/Erreur32/LogviewR"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-xs transition-colors"
            >
              <Github size={13} />
              <span>{t('info.viewOnGitHub')}</span>
              <ExternalLink size={11} />
            </a>
            <div className="mt-3 pt-3 border-t border-gray-700 w-full">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{t('info.repoStats')}</p>
              {repoStatsLoading ? (
                <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                  <Loader2 size={12} className="animate-spin" />
                  {t('info.loading')}
                </div>
              ) : repoStats ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <a href={`https://github.com/${GITHUB_REPO}/stargazers`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 transition-colors text-xs">
                    <Star size={12} />
                    <span className="font-mono">{repoStats.stargazers_count.toLocaleString()}</span>
                  </a>
                  <a href={`https://github.com/${GITHUB_REPO}/forks`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors text-xs">
                    <GitFork size={12} />
                    <span className="font-mono">{repoStats.forks_count.toLocaleString()}</span>
                  </a>
                  <a href={`https://github.com/${GITHUB_REPO}/issues`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-600/30 border border-gray-500/50 text-gray-300 hover:bg-gray-600/50 transition-colors text-xs">
                    <span className="font-mono">{repoStats.open_issues_count.toLocaleString()}</span>
                    <span>{t('info.issues')}</span>
                  </a>
                </div>
              ) : (
                <p className="text-xs text-gray-500">{t('info.statsNotAvailable')}</p>
              )}
            </div>
          </div>

          {/* Divider */}
          <div className="w-px self-stretch bg-gray-700/60 shrink-0" />

          {/* Right — about, author, technologies stacked */}
          <div className="flex-1 min-w-0 space-y-5">

            {/* About */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText size={14} className="text-cyan-400 shrink-0" />
                <h4 className="text-sm font-semibold text-theme-primary">{t('info.about')}</h4>
              </div>
              <p className="text-sm text-theme-secondary mb-1">{t('info.aboutDescription')}</p>
              <p className="text-sm text-gray-400">
                {t('info.aboutReadmeBefore')}
                <a href="https://github.com/Erreur32/LogviewR" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">{t('info.aboutReadmeLink')}</a>
                {t('info.aboutReadmeAfter')}
              </p>
            </div>

            <div className="border-t border-gray-700/50" />

            {/* Author */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Users size={14} className="text-blue-400 shrink-0" />
                <h4 className="text-sm font-semibold text-theme-primary">{t('info.author')}</h4>
              </div>
              <p className="text-sm text-theme-secondary">
                {t('info.developedByBefore')}<span className="text-theme-primary font-medium">Erreur32</span>
              </p>
            </div>

            <div className="border-t border-gray-700/50" />

            {/* Technologies */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Code size={14} className="text-violet-400 shrink-0" />
                <h4 className="text-sm font-semibold text-theme-primary">{t('info.technologies')}</h4>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-blue-900/30 border border-blue-700 rounded text-xs text-blue-400">React</span>
                <span className="px-3 py-1 bg-blue-900/30 border border-blue-700 rounded text-xs text-blue-400">TypeScript</span>
                <span className="px-3 py-1 bg-green-900/30 border border-green-700 rounded text-xs text-green-400">Node.js</span>
                <span className="px-3 py-1 bg-cyan-900/30 border border-cyan-700 rounded text-xs text-cyan-400">Express</span>
                <span className="px-3 py-1 bg-purple-900/30 border border-purple-700 rounded text-xs text-purple-400">SQLite</span>
                <span className="px-3 py-1 bg-yellow-900/30 border border-yellow-700 rounded text-xs text-yellow-400">Docker</span>
              </div>
            </div>

            <div className="border-t border-gray-700/50" />

            {/* Changelog */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Download size={14} className="text-amber-400 shrink-0" />
                <h4 className="text-sm font-semibold text-theme-primary">{t('info.changelog')}</h4>
                <div className="flex gap-1.5 ml-auto">
                  <button
                    type="button"
                    onClick={() => setChangelogView('latest')}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${changelogView === 'latest' ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                  >
                    {t('info.latestVersion')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setChangelogView('full')}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${changelogView === 'full' ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                  >
                    {t('info.fullChangelog')}
                  </button>
                </div>
              </div>
              {changelogLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Loader2 size={16} className="animate-spin" />
                  {t('info.changelogLoading')}
                </div>
              ) : displayContent ? (
                <div className="rounded-lg bg-gray-900/50 border border-gray-700 p-3 text-left">
                  <h4 className="text-sm font-bold text-cyan-400 mb-0.5">{t('info.versionLabel', { version: displayContent.version })}</h4>
                  <p className="text-xs text-gray-500 mb-2">{displayContent.date}</p>
                  {renderChangelogBlock(displayContent.body)}
                </div>
              ) : changelogView === 'full' && versionBlocks.length > 0 ? (
                <div className="rounded-lg bg-gray-900/50 border border-gray-700 p-3 text-left max-h-80 overflow-y-auto space-y-4">
                  {versionBlocks.map((block) => (
                    <div key={block.version + block.date}>
                      <h4 className="text-sm font-bold text-cyan-400 mb-0.5">{t('info.versionLabel', { version: block.version })}</h4>
                      <p className="text-xs text-gray-500 mb-2">{block.date}</p>
                      {renderChangelogBlock(block.body)}
                    </div>
                  ))}
                </div>
              ) : changelogView === 'full' && fullContent ? (
                <div className="rounded-lg bg-gray-900/50 border border-gray-700 p-3 text-left max-h-80 overflow-y-auto whitespace-pre-wrap text-sm text-gray-300 font-mono">
                  {fullContent}
                </div>
              ) : !changelogRaw ? (
                <p className="text-sm text-gray-400">{t('info.changelogNotAvailable')}</p>
              ) : null}
            </div>

          </div>
        </div>
      </Section>
    </>
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
  mode,
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
  const storedAdminTab = sessionStorage.getItem('adminTab');
  const [activeAdminTab, setActiveAdminTab] = useState<AdminTab>(() => toAdminTab(storedAdminTab || initialAdminTab));
  const [pluginSubTab, setPluginSubTab]     = useState<'plugins' | 'regex'>('plugins');
  const [infoSubTab, setInfoSubTab]         = useState<'logviewr' | 'applogs'>('logviewr');
  const [securitySubTab, setSecuritySubTab] = useState<'users' | 'protection' | 'network' | 'logs'>('users');

  // Update activeAdminTab when initialAdminTab changes (e.g., from navigation)
  // Also check sessionStorage on mount
  useEffect(() => {
    const tabFromStorage = sessionStorage.getItem('adminTab');
    if (tabFromStorage) {
      setActiveAdminTab(toAdminTab(tabFromStorage));
      sessionStorage.removeItem('adminTab'); // Clear after reading
    } else if (initialAdminTab && initialAdminTab !== 'general') {
      setActiveAdminTab(toAdminTab(initialAdminTab));
    }
    // Clean URL hash if present
    if (window.location.hash === '#admin') {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [initialAdminTab]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Analysis tab: error summary + security check config
  const [analysisConfig, setAnalysisConfig] = useState<{
    errorSummaryEnabled: boolean;
    enabledPlugins: string[];
    maxFilesPerPlugin: number;
    linesPerFile: number;
    maxFileSizeBytes: number;
    securityCheckEnabled: boolean;
    securityCheckDepth: 'light' | 'normal' | 'deep';
    useExternalSecurityBases: boolean;
    analyzeArchives: boolean;
  }>({
    errorSummaryEnabled: false,
    enabledPlugins: ['host-system'],
    maxFilesPerPlugin: 30,
    linesPerFile: 1000,
    maxFileSizeBytes: 200 * 1024 * 1024,
    securityCheckEnabled: true,
    securityCheckDepth: 'normal',
    useExternalSecurityBases: false,
    analyzeArchives: false
  });
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisSaving, setAnalysisSaving] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [searchInfoDismissed, setSearchInfoDismissed] = useState(() => !!sessionStorage.getItem('analysis.searchInfoDismissed'));
  const analysisJustLoadedRef = useRef(false);
  const analysisSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [logViewerMaxLines, setLogViewerMaxLines] = useState<number>(50000);

  useEffect(() => {
    if (activeAdminTab !== 'analysis') return;
    let cancelled = false;
    setAnalysisLoading(true);
    Promise.all([
      api.get<typeof analysisConfig>('/api/settings/analysis'),
      api.get<{ logViewerMaxLines?: number }>('/api/system/general')
    ])
      .then(([analysisRes, generalRes]) => {
        if (cancelled) return;
        if (analysisRes.success && analysisRes.result) {
          setAnalysisConfig({
            errorSummaryEnabled: analysisRes.result.errorSummaryEnabled === true,
            enabledPlugins: analysisRes.result.enabledPlugins ?? ['host-system'],
            maxFilesPerPlugin: analysisRes.result.maxFilesPerPlugin ?? 30,
            linesPerFile: analysisRes.result.linesPerFile ?? 1000,
            maxFileSizeBytes: analysisRes.result.maxFileSizeBytes ?? 200 * 1024 * 1024,
            securityCheckEnabled: analysisRes.result.securityCheckEnabled !== false,
            securityCheckDepth: analysisRes.result.securityCheckDepth ?? 'normal',
            useExternalSecurityBases: analysisRes.result.useExternalSecurityBases === true,
            analyzeArchives: analysisRes.result.analyzeArchives === true
          });
          analysisJustLoadedRef.current = true;
        } else if (!analysisRes.success && !cancelled) {
          setAnalysisMessage({ type: 'error', text: 'Failed to load analysis config' });
        }
        if (generalRes.success && generalRes.result && typeof generalRes.result.logViewerMaxLines === 'number') {
          setLogViewerMaxLines(generalRes.result.logViewerMaxLines);
        }
      })
      .catch(() => {
        if (!cancelled) setAnalysisMessage({ type: 'error', text: 'Failed to load analysis config' });
      })
      .finally(() => { if (!cancelled) setAnalysisLoading(false); });
    return () => { cancelled = true; };
  }, [activeAdminTab]);

  // Auto-save analysis config on change (debounced), with notification
  useEffect(() => {
    if (activeAdminTab !== 'analysis' || analysisLoading) return;
    if (analysisJustLoadedRef.current) {
      analysisJustLoadedRef.current = false;
      return;
    }
    if (analysisSaveTimeoutRef.current) clearTimeout(analysisSaveTimeoutRef.current);
    analysisSaveTimeoutRef.current = setTimeout(() => {
      analysisSaveTimeoutRef.current = null;
      setAnalysisSaving(true);
      setAnalysisMessage(null);
      Promise.all([
        api.put('/api/settings/analysis', analysisConfig),
        api.put('/api/system/general', { logViewerMaxLines })
      ])
        .then(([analysisRes, generalRes]) => {
          if (analysisRes.success && generalRes.success) {
            setAnalysisMessage({ type: 'success', text: t('analysis.savedRefreshDashboard') });
            setTimeout(() => setAnalysisMessage(null), 5000);
          } else {
            setAnalysisMessage({
              type: 'error',
              text: analysisRes.error?.message ?? generalRes.error?.message ?? 'Save failed'
            });
          }
        })
        .catch((err) => setAnalysisMessage({ type: 'error', text: err?.message ?? 'Save failed' }))
        .finally(() => setAnalysisSaving(false));
    }, 500);
    return () => {
      if (analysisSaveTimeoutRef.current) {
        clearTimeout(analysisSaveTimeoutRef.current);
        analysisSaveTimeoutRef.current = null;
      }
    };
  }, [analysisConfig, logViewerMaxLines, activeAdminTab, analysisLoading, t]);

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
    { id: 'analysis', label: t('admin.tabs.analysis'), icon: BarChart3, color: 'cyan' },
    { id: 'notifications', label: t('admin.tabs.notifications'), icon: Bell, color: 'amber' },
    { id: 'theme', label: t('admin.tabs.theme'), icon: Lightbulb, color: 'yellow' },
    { id: 'security', label: t('admin.tabs.security'), icon: Shield, color: 'red' },
    { id: 'exporter', label: t('admin.tabs.exporter'), icon: Share2, color: 'amber' },
    { id: 'database', label: t('admin.tabs.database'), icon: Database, color: 'purple' },
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
            <div style={{ display: activeAdminTab === 'general' ? '' : 'none' }}>
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
                  <Section title="Mises à jour" icon={Download} iconColor="amber">
                    <UpdateCheckSection />
                  </Section>

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
            </div>

            {activeAdminTab === 'theme' && (
              <div className="space-y-6">
                <ThemeSection />
              </div>
            )}


            {/* Plugins Management Section */}
            {activeAdminTab === 'plugins' && (
              <div className="space-y-4">
                {/* Sub-tab bar */}
                <div className="flex gap-1 p-1 bg-[#111] border border-gray-800 rounded-lg w-fit">
                  {([
                    { id: 'plugins' as const, label: 'Gestion des plugins' },
                    { id: 'regex'   as const, label: 'Regex' },
                  ] as const).map(st => (
                    <button
                      key={st.id}
                      onClick={() => setPluginSubTab(st.id)}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        pluginSubTab === st.id
                          ? 'bg-blue-500/15 border border-blue-500/40 text-blue-400'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>

                {pluginSubTab === 'plugins' && <PluginsManagementSection />}
                {pluginSubTab === 'regex'   && <RegexManagementSection />}
              </div>
            )}
          

            {/* Security Section */}
            {activeAdminTab === 'security' && (
              <div className="space-y-4">
                {/* Sub-tab bar */}
                <div className="flex gap-1 p-1 bg-[#111] border border-gray-800 rounded-lg w-fit">
                  {([
                    { id: 'users'      as const, label: 'Utilisateurs', icon: Users,    activeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
                    { id: 'protection' as const, label: 'Protection',   icon: Shield,   activeColor: 'bg-red-500/20 text-red-300 border-red-500/40' },
                    { id: 'network'    as const, label: 'Réseau',       icon: Globe,    activeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
                    { id: 'logs'       as const, label: 'Journaux',     icon: FileText, activeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
                  ]).map(tab => {
                    const Icon = tab.icon;
                    const isActive = securitySubTab === tab.id;
                    return (
                      <button key={tab.id} onClick={() => setSecuritySubTab(tab.id)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                          isActive ? tab.activeColor : 'border-transparent text-gray-400 hover:text-gray-200'
                        }`}>
                        <Icon size={12} />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {/* Utilisateurs */}
                {securitySubTab === 'users' && currentUser?.role === 'admin' && (
                  <div className="space-y-6">
                    <Section title={t('admin.general.userManagement')} icon={Users} iconColor="purple">
                      <UsersManagementSection />
                    </Section>
                    <SecuritySection view="auth" />
                  </div>
                )}
                {securitySubTab === 'users' && currentUser?.role !== 'admin' && (
                  <p className="text-sm text-gray-500 py-4">Accès administrateur requis.</p>
                )}

                {/* Protection */}
                {securitySubTab === 'protection' && <SecuritySection view="protection" />}

                {/* Réseau */}
                {securitySubTab === 'network' && <SecuritySection view="network" />}

                {/* Journaux */}
                {securitySubTab === 'logs' && <LogsManagementSection />}
              </div>
            )}

            {/* Exporter Section */}
            {activeAdminTab === 'exporter' && (
              <ExporterSection />
            )}

            {/* Database Management Section */}
            {activeAdminTab === 'database' && (
              <DatabaseSection onNavigateToPage={onNavigateToPage} />
            )}

            {/* Info Section (includes Debug as a sub-category) */}
            {activeAdminTab === 'info' && (
              <div className="space-y-4">
                {/* Sub-tab bar */}
                <div className="flex gap-1 p-1 bg-[#111] border border-gray-800 rounded-lg w-fit">
                  {([
                    { id: 'logviewr' as const, label: 'LogviewR', icon: Info },
                    { id: 'applogs'  as const, label: t('debug.appLogsTitle'), icon: FileText },
                  ] as const).map(st => (
                    <button
                      key={st.id}
                      onClick={() => setInfoSubTab(st.id)}
                      className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        infoSubTab === st.id
                          ? 'bg-teal-500/15 border border-teal-500/40 text-teal-400'
                          : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                      }`}
                    >
                      <st.icon size={14} />
                      {st.label}
                    </button>
                  ))}
                </div>

                {infoSubTab === 'logviewr' && <InfoSection />}

                {infoSubTab === 'applogs' && (
                  <Section title={t('debug.appLogsTitle')} icon={FileText} iconColor="cyan" collapsible>
                    <AppLogsSection />
                    <div className="border-t border-gray-700/60 my-4" />
                    <div className="flex items-center gap-2 mb-3">
                      <Monitor size={15} className="text-violet-300 shrink-0" />
                      <h4 className="text-sm font-medium theme-section-title">{t('debug.logLevelsTitle')}</h4>
                    </div>
                    <DebugLogSection />
                  </Section>
                )}
              </div>
            )}

            {/* Analysis Section */}
            {activeAdminTab === 'analysis' && (
              <div className="space-y-6">
                <Section title={t('analysis.title')} icon={BarChart3} iconColor="cyan">
                  {analysisLoading ? (
                    <div className="flex items-center gap-2 py-4 text-gray-400">
                      <Loader2 size={20} className="animate-spin" />
                      <span>{t('admin.loading') || 'Chargement...'}</span>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {analysisMessage && (
                        <div className={`p-3 rounded-lg text-sm ${analysisMessage.type === 'success' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                          {analysisMessage.text}
                        </div>
                      )}

                      {/* Explanatory text: what the current scan does (warn/error only) - dismissible */}
                      {!searchInfoDismissed && (
                        <div className="relative text-xs text-cyan-400/90 bg-cyan-500/10 border border-cyan-500/30 rounded-lg px-3 py-2 pr-10">
                          <p>{t('analysis.currentSearchWhatIsSearched')}</p>
                          <button
                            type="button"
                            onClick={() => {
                              sessionStorage.setItem('analysis.searchInfoDismissed', '1');
                              setSearchInfoDismissed(true);
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-cyan-500/20 text-cyan-400/80 hover:text-cyan-300 transition-colors"
                            title={t('common.close') || 'Fermer'}
                          >
                            <X size={16} />
                          </button>
                        </div>
                      )}

                      {/* Two-column layout: Error summary | Security check */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Error summary (dashboard) */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold text-theme-primary">{t('analysis.errorSummarySection')}</h4>
                          <p className="text-xs text-gray-400">{t('analysis.errorSummaryDesc')}</p>
                          <SettingRow label={t('analysis.enableErrorSummary')} description={t('analysis.enableErrorSummaryDesc')}>
                            <Toggle
                              enabled={analysisConfig.errorSummaryEnabled}
                              onChange={(enabled) => setAnalysisConfig((prev) => ({ ...prev, errorSummaryEnabled: enabled }))}
                            />
                          </SettingRow>
                          <SettingRow label={t('analysis.pluginsToInclude')} description="">
                            <p className="text-xs text-gray-500 mb-2">{t('analysis.pluginsMustBeEnabled')}</p>
                            <div className="flex flex-wrap gap-6">
                              {['host-system', 'apache', 'npm', 'nginx'].map((id) => (
                                <label key={id} className="flex items-center gap-3 cursor-pointer group">
                                  <Toggle
                                    enabled={analysisConfig.enabledPlugins.includes(id)}
                                    onChange={(checked) => {
                                      setAnalysisConfig((prev) => ({
                                        ...prev,
                                        enabledPlugins: checked
                                          ? [...prev.enabledPlugins, id]
                                          : prev.enabledPlugins.filter((p) => p !== id)
                                      }));
                                    }}
                                  />
                                  <img
                                    src={getPluginIcon(id)}
                                    alt=""
                                    className="w-5 h-5 opacity-90 shrink-0"
                                  />
                                  <span className="text-sm text-theme-primary capitalize select-none group-hover:text-theme-secondary transition-colors">{id === 'host-system' ? 'Host System' : id}</span>
                                </label>
                              ))}
                            </div>
                          </SettingRow>
                          <SettingRow label={t('analysis.maxFilesPerPlugin')} description={t('analysis.maxFilesPerPluginDesc')}>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={analysisConfig.maxFilesPerPlugin}
                              onChange={(e) => setAnalysisConfig((prev) => ({ ...prev, maxFilesPerPlugin: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)) }))}
                              className="w-24 px-2 py-1.5 rounded-lg bg-theme-tertiary border border-theme-border text-theme-primary text-sm"
                            />
                          </SettingRow>
                          <SettingRow label={t('analysis.maxFileSizeMb')} description={t('analysis.maxFileSizeMbDesc')}>
                            <input
                              type="number"
                              min={1}
                              max={512}
                              value={Math.round(analysisConfig.maxFileSizeBytes / 1024 / 1024)}
                              onChange={(e) =>
                                setAnalysisConfig((prev) => ({
                                  ...prev,
                                  maxFileSizeBytes: Math.max(1, Math.min(512, parseInt(e.target.value, 10) || 1)) * 1024 * 1024
                                }))
                              }
                              className="w-24 px-2 py-1.5 rounded-lg bg-theme-tertiary border border-theme-border text-theme-primary text-sm"
                            />
                          </SettingRow>
                          <SettingRow
                            label={t('admin.general.defaultPageSection.logViewerMaxLinesTitle')}
                            description={t('admin.general.defaultPageSection.logViewerMaxLinesDescription')}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={1000}
                                max={100000}
                                step={1000}
                                value={logViewerMaxLines}
                                onChange={(e) => {
                                  const parsed = parseInt(e.target.value, 10) || 0;
                                  const clamped = Math.max(1000, Math.min(100000, parsed));
                                  setLogViewerMaxLines(clamped);
                                }}
                                className="w-28 px-2 py-1.5 rounded-lg bg-theme-tertiary border border-theme-border text-theme-primary text-sm"
                              />
                              <span className="text-xs text-gray-400">
                                {t('admin.general.defaultPageSection.logViewerMaxLinesUnit')}
                              </span>
                            </div>
                          </SettingRow>
                          <SettingRow label={t('analysis.analyzeArchives')} description={t('analysis.analyzeArchivesDesc')}>
                            <Toggle enabled={analysisConfig.analyzeArchives} onChange={() => {}} disabled />
                          </SettingRow>
                        </div>

                        {/* Security check */}
                        <div className="space-y-3 md:border-l md:border-theme-border md:pl-6">
                          <h4 className="text-sm font-semibold text-theme-primary">{t('analysis.securityCheckSection')}</h4>
                          <p className="text-xs text-gray-400">{t('analysis.securityCheckSectionDesc')}</p>
                          <p className="text-xs text-gray-400">{t('analysis.webPluginsErrorsAlways')}</p>
                          <SettingRow label={t('analysis.suspiciousEnabled')} description={t('analysis.suspiciousEnabledDesc')}>
                            <Toggle
                              enabled={analysisConfig.securityCheckEnabled}
                              onChange={(enabled) => setAnalysisConfig((prev) => ({ ...prev, securityCheckEnabled: enabled }))}
                            />
                          </SettingRow>
                          <p className="text-xs text-amber-400/90 pl-1">{t('analysis.suspiciousOptionsComingSoon')}</p>
                          <SettingRow label={t('analysis.suspiciousOption403')} description="">
                            <Toggle enabled={false} onChange={() => {}} disabled />
                          </SettingRow>
                          <SettingRow label={t('analysis.suspiciousOptionInjection')} description="">
                            <Toggle enabled={false} onChange={() => {}} disabled />
                          </SettingRow>
                          <SettingRow label={t('analysis.suspiciousOptionBruteforce')} description="">
                            <Toggle enabled={false} onChange={() => {}} disabled />
                          </SettingRow>
                          <SettingRow label={t('analysis.securityCheckDepth')} description={t('analysis.securityCheckDepthDesc')}>
                            <select
                              value={analysisConfig.securityCheckDepth}
                              onChange={(e) => setAnalysisConfig((prev) => ({ ...prev, securityCheckDepth: e.target.value as 'light' | 'normal' | 'deep' }))}
                              className="px-3 py-1.5 rounded-lg bg-theme-tertiary border border-theme-border text-theme-primary text-sm"
                            >
                              <option value="light">{t('analysis.depthLight')}</option>
                              <option value="normal">{t('analysis.depthNormal')}</option>
                              <option value="deep">{t('analysis.depthDeep')}</option>
                            </select>
                          </SettingRow>
                          <p className="text-xs text-gray-500 pt-1">{t('analysis.systemLogsLater')}</p>
                          <SettingRow label={t('analysis.useExternalBases')} description={t('analysis.useExternalBasesComingSoon')}>
                            <Toggle enabled={false} onChange={() => {}} disabled />
                          </SettingRow>
                        </div>
                      </div>

                      {analysisSaving && (
                        <p className="text-xs text-cyan-500 mt-2 flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" />
                          {t('analysis.saving')}
                        </p>
                      )}
                    </div>
                  )}
                </Section>
              </div>
            )}

            {/* Notifications Section */}
            {activeAdminTab === 'notifications' && <NotificationsSection />}

          </> 
        )}

 
      </main>
    </div>
  );
};

export default SettingsPage;