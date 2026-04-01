/**
 * Analytics Page - LogviewR
 * 
 * Displays:
 * - Database statistics (coming soon)
 * - User information
 * - Quick plugin statistics
 */

import React, { useEffect, useState } from 'react';
import {
  BarChart2,
  ChevronLeft,
  Database,
  User,
  Plug,
  CheckCircle,
  AlertCircle,
  XCircle,
  Clock,
  Mail,
  Shield,
  Calendar,
  Activity,
  FileText,
  RefreshCw,
  HardDrive,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useUserAuthStore } from '../stores/userAuthStore';
import { usePluginStore } from '../stores/pluginStore';
import { LogPluginStatsCard } from '../components/widgets/LogPluginStatsCard';
import { LargestFilesCard } from '../components/widgets/LargestFilesCard';
import { api } from '../api/client';
import type { LogPluginStats } from '../types/logViewer';
import { useTranslation } from 'react-i18next';

interface AnalyticsPageProps {
  onBack: () => void;
}

interface DatabaseStats {
  totalUsers: number;
  totalLogSources: number;
  totalLogFiles: number;
  databaseSize: number;
  lastBackup?: string;
}

export const AnalyticsPage: React.FC<AnalyticsPageProps> = ({ onBack }) => {
  const { t } = useTranslation();
  const { user } = useUserAuthStore();
  const { plugins, fetchPlugins } = usePluginStore();
  const [databaseStats, setDatabaseStats] = useState<DatabaseStats | null>(null);
  const [isLoadingDbStats, setIsLoadingDbStats] = useState(true);
  const [pluginStatsMap, setPluginStatsMap] = useState<Record<string, LogPluginStats>>({});
  const [isLoadingPluginStats, setIsLoadingPluginStats] = useState(true);
  // Collapsible sections state
  const [isPluginStatsExpanded, setIsPluginStatsExpanded] = useState(false);
  const [isDatabaseExpanded, setIsDatabaseExpanded] = useState(false);
  const [isUserExpanded, setIsUserExpanded] = useState(false);

  // Fetch plugins on mount
  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  // Fetch database stats (placeholder for now)
  useEffect(() => {
    const fetchDatabaseStats = async () => {
      setIsLoadingDbStats(true);
      try {
        // TODO: Create backend route for database stats
        // For now, return placeholder data
        setDatabaseStats({
          totalUsers: 0,
          totalLogSources: 0,
          totalLogFiles: 0,
          databaseSize: 0
        });
      } catch (error) {
        console.error('Failed to fetch database stats:', error);
      } finally {
        setIsLoadingDbStats(false);
      }
    };

    fetchDatabaseStats();
  }, []);

  // Fetch plugin stats for log source plugins
  useEffect(() => {
    const fetchAllPluginStats = async () => {
      setIsLoadingPluginStats(true);
      const statsMap: Record<string, LogPluginStats> = {};

      try {
        // Get only log source plugins (host-system, nginx, apache, npm)
        const logSourcePlugins = plugins.filter(p => 
          p.enabled && ['host-system', 'nginx', 'apache', 'npm'].includes(p.id)
        );

        // First: Fetch quick stats (non-compressed files only) for fast display
        const quickStatsPromises = logSourcePlugins.map(async (plugin) => {
          try {
            const response = await api.get<LogPluginStats>(`/api/log-viewer/plugins/${plugin.id}/stats?quick=true`);
            if (response.success && response.result) {
              statsMap[plugin.id] = response.result;
            }
          } catch (error) {
            console.error(`Failed to fetch quick stats for plugin ${plugin.id}:`, error);
          }
        });

        await Promise.all(quickStatsPromises);
        setPluginStatsMap({ ...statsMap });
        setIsLoadingPluginStats(false);

        // Then: Fetch complete stats (including compressed files) in background
        const completeStatsPromises = logSourcePlugins.map(async (plugin) => {
          try {
            const response = await api.get<LogPluginStats>(`/api/log-viewer/plugins/${plugin.id}/stats`);
            if (response.success && response.result) {
              setPluginStatsMap(prev => ({
                ...prev,
                [plugin.id]: response.result!
              }));
            }
          } catch (error) {
            console.error(`Failed to fetch complete stats for plugin ${plugin.id}:`, error);
          }
        });

        // Don't await - let it run in background
        Promise.all(completeStatsPromises).catch(err => {
          console.error('Error fetching complete plugin stats:', err);
        });
      } catch (error) {
        console.error('Failed to fetch plugin stats:', error);
        setIsLoadingPluginStats(false);
      }
    };

    if (plugins.length > 0) {
      fetchAllPluginStats();
    }
  }, [plugins]);

  // Format date
  const formatDate = (dateString?: string): string => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('fr-FR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return 'N/A';
    }
  };

  // Get role badge variant
  const getRoleBadgeVariant = (role: string): 'success' | 'info' | 'warning' | 'default' => {
    switch (role) {
      case 'admin':
        return 'success';
      case 'user':
        return 'info';
      case 'viewer':
        return 'warning';
      default:
        return 'default';
    }
  };

  // Get role label (translated)
  const getRoleLabel = (role: string): string => {
    const key = `analytics.roles.${role}` as const;
    const translated = t(key);
    return translated !== key ? translated : role;
  };

  // Get enabled log source plugins
  const enabledLogPlugins = plugins.filter(p => 
    p.enabled && ['host-system', 'nginx', 'apache', 'npm'].includes(p.id)
  );

  // Calculate total stats across all plugins
  const totalStats = React.useMemo(() => {
    let totalFiles = 0;
    let totalReadable = 0;
    let totalUnreadable = 0;
    let totalSize = 0;
    let pluginsWithErrors = 0;
    let pluginsOk = 0;
    let pluginsWarning = 0;

    Object.values(pluginStatsMap).forEach((stats: LogPluginStats) => {
      totalFiles += stats.totalFiles || 0;
      totalReadable += stats.readableFiles || 0;
      totalUnreadable += stats.unreadableFiles || 0;
      totalSize += stats.totalSize || 0;
      
      if (stats.status === 'ok') pluginsOk++;
      else if (stats.status === 'warning') pluginsWarning++;
      else if (stats.status === 'error') pluginsWithErrors++;
    });

    return {
      totalFiles,
      totalReadable,
      totalUnreadable,
      totalSize,
      pluginsOk,
      pluginsWarning,
      pluginsWithErrors,
      totalPlugins: enabledLogPlugins.length
    };
  }, [pluginStatsMap, enabledLogPlugins.length]);

  return (
    <div className="min-h-screen bg-[#050505] text-gray-300">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-[#0a0a0a]/95 backdrop-blur-sm border-b border-gray-800">
        <div className="max-w-[1920px] mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
              >
                <ChevronLeft size={24} />
              </button>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <BarChart2 size={24} className="text-purple-400" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">{t('analytics.title')}</h1>
                  <p className="text-sm text-gray-500">{t('analytics.subtitle')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="p-4 md:p-6 max-w-[1920px] mx-auto space-y-6">
        {/* Plugin Statistics Section - FIRST (Collapsible, open by default) */}
        <section className="bg-[#121212] rounded-xl border border-gray-800 overflow-hidden">
          <button
            onClick={() => setIsPluginStatsExpanded(!isPluginStatsExpanded)}
            className="w-full flex items-center justify-between p-6 hover:bg-[#1a1a1a] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/20 rounded-lg">
                <Plug size={24} className="text-purple-400" />
              </div>
              <div className="text-left">
                <h2 className="text-lg font-semibold text-white">{t('analytics.pluginStatsTitle')}</h2>
                <p className="text-sm text-gray-500">{t('analytics.pluginStatsDesc')}</p>
              </div>
            </div>
            {isPluginStatsExpanded ? (
              <ChevronUp size={20} className="text-gray-400" />
            ) : (
              <ChevronDown size={20} className="text-gray-400" />
            )}
          </button>

          {isPluginStatsExpanded && (
            <div className="px-6 pb-6">

          {/* Overall Stats Summary */}
          {enabledLogPlugins.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <Plug size={16} className="text-purple-400" />
                  {t('analytics.activePlugins')}
                </div>
                <div className="text-2xl font-bold text-white">{totalStats.totalPlugins}</div>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <FileText size={16} className="text-blue-400" />
                  {t('analytics.totalFiles')}
                </div>
                <div className="text-2xl font-bold text-white">{totalStats.totalFiles}</div>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <HardDrive size={16} className="text-yellow-400" />
                  {t('analytics.totalSize')}
                  {/* TODO: Add alert indicator when size limit is configured and exceeded */}
                </div>
                <div className="text-2xl font-bold text-yellow-200">
                  {totalStats.totalSize >= 1024 * 1024 * 1024
                    ? `${(totalStats.totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`
                    : totalStats.totalSize >= 1024 * 1024
                    ? `${(totalStats.totalSize / (1024 * 1024)).toFixed(2)} MB`
                    : `${(totalStats.totalSize / 1024).toFixed(2)} KB`}
                </div>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <CheckCircle size={16} className="text-green-400" />
                  {t('analytics.readableFiles')}
                </div>
                <div className="text-2xl font-bold text-green-400">{totalStats.totalReadable}</div>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <XCircle size={16} className="text-red-400" />
                  {t('analytics.unreadableFiles')}
                </div>
                <div className="text-2xl font-bold text-red-400">{totalStats.totalUnreadable}</div>
              </div>
            </div>
          )}

          {/* Plugin Status Summary */}
          {enabledLogPlugins.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-green-500/30">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <CheckCircle size={16} className="text-green-400" />
                  {t('analytics.pluginsOk')}
                </div>
                <div className="text-2xl font-bold text-green-400">{totalStats.pluginsOk}</div>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-yellow-500/30">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <AlertCircle size={16} className="text-yellow-400" />
                  {t('analytics.pluginsWarning')}
                </div>
                <div className="text-2xl font-bold text-yellow-400">{totalStats.pluginsWarning}</div>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-red-500/30">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <XCircle size={16} className="text-red-400" />
                  {t('analytics.pluginsError')}
                </div>
                <div className="text-2xl font-bold text-red-400">{totalStats.pluginsWithErrors}</div>
              </div>
            </div>
          )}

          {/* Individual Plugin Stats Cards - Compact Grid */}
          {isLoadingPluginStats ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 text-gray-500 animate-spin" />
              <span className="ml-2 text-gray-500">{t('analytics.loadingStats')}</span>
            </div>
          ) : enabledLogPlugins.length === 0 ? (
            <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 text-yellow-400">
                <AlertCircle size={20} />
                <span className="text-sm">{t('analytics.noPluginEnabled')}</span>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                {t('analytics.enablePluginHint')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {enabledLogPlugins.map((plugin) => (
                <LogPluginStatsCard
                  key={plugin.id}
                  pluginId={plugin.id}
                  pluginName={plugin.name}
                  onViewLogs={undefined}
                />
              ))}
            </div>
          )}
            </div>
          )}
        </section>

        {/* Largest Files Section */}
        <LargestFilesCard limit={50} />

      </div>
    </div>
  );
};
