import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plug,
  CheckCircle,
  AlertCircle,
  XCircle,
  FileText,
  RefreshCw,
  HardDrive,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { usePluginStore } from '../../stores/pluginStore';
import { LogPluginStatsCard } from './LogPluginStatsCard';
import { api } from '../../api/client';
import type { LogPluginStats } from '../../types/logViewer';
import { getCachedPluginStats, setCachedPluginStats } from '../../utils/pluginStatsCache';

const LOG_SOURCE_PLUGIN_IDS = ['host-system', 'nginx', 'apache', 'npm'];

export const QuickPluginStatsCard: React.FC = () => {
  const { t } = useTranslation();
  const { plugins, fetchPlugins } = usePluginStore();
  const [isExpanded, setIsExpanded] = useState(false);
  const [pluginStatsMap, setPluginStatsMap] = useState<Record<string, LogPluginStats>>({});
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  const enabledLogPlugins = useMemo(
    () => plugins.filter(p => p.enabled && LOG_SOURCE_PLUGIN_IDS.includes(p.id)),
    [plugins]
  );

  // Fetched lazily on first expand, not on mount, so the dashboard doesn't pay
  // for 4 plugin-stats API calls until the user actually opens this section.
  const fetchStats = useCallback(() => {
    const cacheKey = enabledLogPlugins.map(p => p.id).sort().join(',');
    const cached = getCachedPluginStats(cacheKey);
    if (cached) {
      setPluginStatsMap(cached);
      return;
    }

    setIsLoadingStats(true);
    const statsMap: Record<string, LogPluginStats> = {};

    const run = async (): Promise<void> => {
      // Phase 1: quick stats (non-compressed files only) for fast display
      const quickStatsPromises = enabledLogPlugins.map(async (plugin) => {
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
      setIsLoadingStats(false);

      // Phase 2: complete stats (including compressed files) in the background
      const completeStatsPromises = enabledLogPlugins.map(async (plugin) => {
        try {
          const response = await api.get<LogPluginStats>(`/api/log-viewer/plugins/${plugin.id}/stats`);
          if (response.success && response.result) {
            statsMap[plugin.id] = response.result;
            setPluginStatsMap(prev => ({ ...prev, [plugin.id]: response.result! }));
          }
        } catch (error) {
          console.error(`Failed to fetch complete stats for plugin ${plugin.id}:`, error);
        }
      });
      await Promise.all(completeStatsPromises);
      setCachedPluginStats(cacheKey, statsMap);
    };

    run().catch(error => {
      console.error('Failed to fetch plugin stats:', error);
      setIsLoadingStats(false);
    });
  }, [enabledLogPlugins]);

  useEffect(() => {
    if (isExpanded && !hasFetched && enabledLogPlugins.length > 0) {
      setHasFetched(true);
      fetchStats();
    }
  }, [isExpanded, hasFetched, enabledLogPlugins.length, fetchStats]);

  const totalStats = useMemo(() => {
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
    <section className="bg-theme-tertiary rounded-xl border border-theme-border overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(prev => !prev)}
        className="w-full flex items-center justify-between p-4 md:p-5 hover:bg-theme-secondary transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-lg">
            <Plug size={22} className="text-purple-400" />
          </div>
          <div className="text-left">
            <h2 className="text-sm md:text-base font-semibold text-theme-primary">{t('analytics.pluginStatsTitle')}</h2>
            <p className="text-xs text-gray-500">{t('analytics.pluginStatsDesc')}</p>
          </div>
        </div>
        {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>

      {isExpanded && (
        <div className="px-4 md:px-6 pb-4 md:pb-6">
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

          {isLoadingStats ? (
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
              <p className="text-sm text-gray-500 mt-2">{t('analytics.enablePluginHint')}</p>
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
  );
};
