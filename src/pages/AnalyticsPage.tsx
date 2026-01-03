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
  Archive,
  HardDrive,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { useUserAuthStore } from '../stores/userAuthStore';
import { usePluginStore } from '../stores/pluginStore';
import { LogPluginStatsCard } from '../components/widgets/LogPluginStatsCard';
import { api } from '../api/client';
import type { LogPluginStats } from '../types/logViewer';
import { Badge } from '../components/ui/Badge';
import { getPluginIcon } from '../utils/pluginIcons';
import { Tooltip } from '../components/ui/Tooltip';

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
  const { user } = useUserAuthStore();
  const { plugins, fetchPlugins } = usePluginStore();
  const [databaseStats, setDatabaseStats] = useState<DatabaseStats | null>(null);
  const [isLoadingDbStats, setIsLoadingDbStats] = useState(true);
  const [pluginStatsMap, setPluginStatsMap] = useState<Record<string, LogPluginStats>>({});
  const [isLoadingPluginStats, setIsLoadingPluginStats] = useState(true);
  const [largestFiles, setLargestFiles] = useState<Array<{
    path: string;
    size: number;
    pluginId: string;
    pluginName: string;
    type: string;
    modified: string;
    isCompressed: boolean;
  }>>([]);
  const [isLoadingLargestFiles, setIsLoadingLargestFiles] = useState(true);
  
  // Collapsible sections state
  const [isPluginStatsExpanded, setIsPluginStatsExpanded] = useState(true); // Open by default
  const [isLargestFilesExpanded, setIsLargestFilesExpanded] = useState(false);
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

  // Fetch largest files
  useEffect(() => {
    const fetchLargestFiles = async (quick: boolean = false) => {
      setIsLoadingLargestFiles(true);
      try {
        const quickParam = quick ? '&quick=true' : '';
        const response = await api.get<{
          files: Array<{
            path: string;
            size: number;
            pluginId: string;
            pluginName: string;
            type: string;
            modified: string;
            isCompressed: boolean;
          }>;
          total: number;
        }>(`/api/log-viewer/largest-files?limit=10${quickParam}`);
        
        if (response.success && response.result) {
          setLargestFiles(response.result.files);
          setIsLoadingLargestFiles(false);
          
          // If quick mode, load complete data in background
          if (quick) {
            fetchLargestFiles(false).catch(err => {
              console.warn('Failed to load complete largest files:', err);
            });
          }
        }
      } catch (error) {
        console.error('Failed to fetch largest files:', error);
        setIsLoadingLargestFiles(false);
      }
    };

    // Load quick first, then complete in background
    fetchLargestFiles(true);
  }, []);

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

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

  // Get role label
  const getRoleLabel = (role: string): string => {
    switch (role) {
      case 'admin':
        return 'Administrateur';
      case 'user':
        return 'Utilisateur';
      case 'viewer':
        return 'Lecteur';
      default:
        return role;
    }
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
                  <h1 className="text-xl font-bold text-white">Analytique</h1>
                  <p className="text-sm text-gray-500">Statistiques et informations détaillées</p>
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
                <h2 className="text-lg font-semibold text-white">Statistiques Rapides des Plugins</h2>
                <p className="text-sm text-gray-500">État et statistiques des plugins de logs actifs</p>
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
                  Plugins actifs
                </div>
                <div className="text-2xl font-bold text-white">{totalStats.totalPlugins}</div>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <FileText size={16} className="text-blue-400" />
                  Fichiers totaux
                </div>
                <div className="text-2xl font-bold text-white">{totalStats.totalFiles}</div>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <HardDrive size={16} className="text-yellow-400" />
                  Taille totale
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
                  Fichiers lisibles
                </div>
                <div className="text-2xl font-bold text-green-400">{totalStats.totalReadable}</div>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <XCircle size={16} className="text-red-400" />
                  Fichiers illisibles
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
                  Plugins OK
                </div>
                <div className="text-2xl font-bold text-green-400">{totalStats.pluginsOk}</div>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-yellow-500/30">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <AlertCircle size={16} className="text-yellow-400" />
                  Plugins en avertissement
                </div>
                <div className="text-2xl font-bold text-yellow-400">{totalStats.pluginsWarning}</div>
              </div>
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-red-500/30">
                <div className="flex items-center gap-2 text-gray-500 text-sm mb-2">
                  <XCircle size={16} className="text-red-400" />
                  Plugins en erreur
                </div>
                <div className="text-2xl font-bold text-red-400">{totalStats.pluginsWithErrors}</div>
              </div>
            </div>
          )}

          {/* Individual Plugin Stats Cards - Compact Grid */}
          {isLoadingPluginStats ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-6 h-6 text-gray-500 animate-spin" />
              <span className="ml-2 text-gray-500">Chargement des statistiques...</span>
            </div>
          ) : enabledLogPlugins.length === 0 ? (
            <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 text-yellow-400">
                <AlertCircle size={20} />
                <span className="text-sm">Aucun plugin de logs activé</span>
              </div>
              <p className="text-sm text-gray-500 mt-2">
                Activez au moins un plugin de logs pour voir les statistiques.
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

        {/* Largest Files Section - Collapsible - SECOND */}
        <section className="bg-[#121212] rounded-xl border border-gray-800 overflow-hidden">
          <button
            onClick={() => setIsLargestFilesExpanded(!isLargestFilesExpanded)}
            className="w-full flex items-center justify-between p-6 hover:bg-[#1a1a1a] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-500/20 rounded-lg">
                <HardDrive size={24} className="text-orange-400" />
              </div>
              <div className="text-left">
                <h2 className="text-lg font-semibold text-white">Plus gros fichiers de logs</h2>
                <p className="text-sm text-gray-500">Top 10 des fichiers les plus volumineux</p>
              </div>
            </div>
            {isLargestFilesExpanded ? (
              <ChevronUp size={20} className="text-gray-400" />
            ) : (
              <ChevronDown size={20} className="text-gray-400" />
            )}
          </button>

          {isLargestFilesExpanded && (
            <div className="px-6 pb-6">
              {isLoadingLargestFiles ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 text-gray-500 animate-spin" />
                  <span className="ml-2 text-gray-500">Chargement...</span>
                </div>
              ) : largestFiles.length === 0 ? (
                <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                  <div className="text-sm text-gray-500">Aucun fichier trouvé</div>
                </div>
              ) : (
                <div className="bg-[#0a0a0a] rounded-lg border border-gray-700 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-[#0f0f0f] border-b border-gray-800">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">#</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Plugin</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase">Chemin</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase">Taille</th>
                          <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase">Type</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {largestFiles.map((file, index) => (
                          <tr key={index} className="hover:bg-[#0f0f0f] transition-colors">
                            <td className="px-4 py-3 text-sm text-gray-400 font-mono">
                              {index + 1}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <img 
                                  src={getPluginIcon(file.pluginId)} 
                                  alt={file.pluginName}
                                  className="w-4 h-4 flex-shrink-0"
                                />
                                <span className="text-sm text-gray-300">{file.pluginName}</span>
                                {file.isCompressed && (
                                  <Tooltip content="Fichier compressé (.gz)">
                                    <Archive size={14} className="text-red-400 cursor-help" />
                                  </Tooltip>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <Tooltip content={file.path}>
                                <div className="text-sm text-gray-300 font-mono truncate max-w-md cursor-help" title={file.path}>
                                  {file.path}
                                </div>
                              </Tooltip>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm font-semibold text-white">
                                {formatFileSize(file.size)}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <Badge variant="gray" size="sm">
                                {file.type}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Database Statistics Section - Collapsible */}
        <section className="bg-[#121212] rounded-xl border border-gray-800 overflow-hidden">
          <button
            onClick={() => setIsDatabaseExpanded(!isDatabaseExpanded)}
            className="w-full flex items-center justify-between p-6 hover:bg-[#1a1a1a] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Database size={24} className="text-blue-400" />
              </div>
              <div className="text-left">
                <h2 className="text-lg font-semibold text-white">Statistiques Base de Données</h2>
                <p className="text-sm text-gray-500">Informations sur la base de données (à venir)</p>
              </div>
            </div>
            {isDatabaseExpanded ? (
              <ChevronUp size={20} className="text-gray-400" />
            ) : (
              <ChevronDown size={20} className="text-gray-400" />
            )}
          </button>

          {isDatabaseExpanded && (
            <div className="px-6 pb-6">
              {isLoadingDbStats ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 text-gray-500 animate-spin" />
                  <span className="ml-2 text-gray-500">Chargement...</span>
                </div>
              ) : (
                <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center gap-2 text-yellow-400">
                    <AlertCircle size={20} />
                    <span className="text-sm font-medium">Fonctionnalité en cours de développement</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-2">
                    Les statistiques détaillées de la base de données seront disponibles prochainement.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>

        {/* User Information Section - Collapsible */}
        <section className="bg-[#121212] rounded-xl border border-gray-800 overflow-hidden">
          <button
            onClick={() => setIsUserExpanded(!isUserExpanded)}
            className="w-full flex items-center justify-between p-6 hover:bg-[#1a1a1a] transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/20 rounded-lg">
                <User size={24} className="text-green-400" />
              </div>
              <div className="text-left">
                <h2 className="text-lg font-semibold text-white">Informations Utilisateur</h2>
                <p className="text-sm text-gray-500">Détails de votre compte</p>
              </div>
            </div>
            {isUserExpanded ? (
              <ChevronUp size={20} className="text-gray-400" />
            ) : (
              <ChevronDown size={20} className="text-gray-400" />
            )}
          </button>

          {isUserExpanded && (
            <div className="px-6 pb-6">
              {user ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* User Details Card */}
              <div className="bg-[#0a0a0a] rounded-lg p-6 border border-gray-700">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-blue-500 rounded-full flex items-center justify-center">
                    <User size={32} className="text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white">{user.username}</h3>
                    <Badge variant={getRoleBadgeVariant(user.role)} className="mt-1">
                      {getRoleLabel(user.role)}
                    </Badge>
                  </div>
                </div>

                <div className="space-y-3 mt-6">
                  <div className="flex items-center gap-3">
                    <Mail size={18} className="text-gray-500" />
                    <div>
                      <div className="text-xs text-gray-500">Email</div>
                      <div className="text-white">{user.email || 'N/A'}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Shield size={18} className="text-gray-500" />
                    <div>
                      <div className="text-xs text-gray-500">Statut</div>
                      <div className="flex items-center gap-2">
                        {user.enabled ? (
                          <>
                            <CheckCircle size={16} className="text-green-400" />
                            <span className="text-green-400">Actif</span>
                          </>
                        ) : (
                          <>
                            <XCircle size={16} className="text-red-400" />
                            <span className="text-red-400">Désactivé</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Calendar size={18} className="text-gray-500" />
                    <div>
                      <div className="text-xs text-gray-500">Compte créé le</div>
                      <div className="text-white">{formatDate(user.createdAt)}</div>
                    </div>
                  </div>

                  {user.lastLogin && (
                    <div className="flex items-center gap-3">
                      <Clock size={18} className="text-gray-500" />
                      <div>
                        <div className="text-xs text-gray-500">Dernière connexion</div>
                        <div className="text-white">{formatDate(user.lastLogin)}</div>
                        {user.lastLoginIp && (
                          <div className="text-xs text-gray-500 mt-1">IP: {user.lastLoginIp}</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* User Stats Card */}
              <div className="bg-[#0a0a0a] rounded-lg p-6 border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-4">Statistiques</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-[#121212] rounded-lg">
                    <span className="text-gray-400">ID Utilisateur</span>
                    <span className="text-white font-mono">#{user.id}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-[#121212] rounded-lg">
                    <span className="text-gray-400">Rôle</span>
                    <Badge variant={getRoleBadgeVariant(user.role)}>
                      {getRoleLabel(user.role)}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-[#121212] rounded-lg">
                    <span className="text-gray-400">Statut</span>
                    <div className="flex items-center gap-2">
                      {user.enabled ? (
                        <>
                          <CheckCircle size={16} className="text-green-400" />
                          <span className="text-green-400">Actif</span>
                        </>
                      ) : (
                        <>
                          <XCircle size={16} className="text-red-400" />
                          <span className="text-red-400">Désactivé</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[#0a0a0a] rounded-lg p-4 border border-gray-700">
              <div className="flex items-center gap-2 text-yellow-400">
                <AlertCircle size={20} />
                <span className="text-sm">Aucune information utilisateur disponible</span>
              </div>
            </div>
          )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
