/**
 * Plugins Management Section
 * 
 * Component for managing plugins within Administration settings
 */

import React, { useEffect, useState, useMemo } from 'react';
import { Settings, Power, CheckCircle, XCircle, AlertCircle, ExternalLink, Archive } from 'lucide-react';
import { usePluginStore, type Plugin } from '../stores/pluginStore';
import { Section, SettingRow } from './SettingsSection';
import { PluginOptionsPanel } from './PluginOptionsPanel';
import { getPluginIcon } from '../utils/pluginIcons';
import { api } from '../api/client';
import { Tooltip } from './ui/Tooltip';

export const PluginsManagementSection: React.FC = () => {
    const { plugins, pluginStats, isLoading, fetchPlugins, updatePluginConfig } = usePluginStore();
    const [expandedPluginId, setExpandedPluginId] = useState<string | null>(null);
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
                console.warn('[PluginsManagementSection] Failed to get OS type:', err);
            });
    }, []);

    // Load plugins once on mount (with cache check)
    useEffect(() => {
        fetchPlugins();
    }, []); // Empty deps - load once only

    // Sort plugins: host-system, apache, npm, nginx, then others
    const sortedPlugins = useMemo(() => {
        const order = ['host-system', 'apache', 'npm', 'nginx'];
        const sorted = [...plugins].sort((a, b) => {
            const aIndex = order.indexOf(a.id);
            const bIndex = order.indexOf(b.id);
            
            // If both are in the order array, sort by their position
            if (aIndex !== -1 && bIndex !== -1) {
                return aIndex - bIndex;
            }
            // If only a is in the order array, it comes first
            if (aIndex !== -1) return -1;
            // If only b is in the order array, it comes first
            if (bIndex !== -1) return 1;
            // If neither is in the order array, maintain original order
            return 0;
        });
        return sorted;
    }, [plugins]);

    const handleToggle = async (pluginId: string, enabled: boolean) => {
        // updatePluginConfig already refreshes plugins internally, no need to call fetchPlugins again
        await updatePluginConfig(pluginId, { enabled });
    };

    const handleToggleCompressed = async (pluginId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const plugin = plugins.find(p => p.id === pluginId);
        if (!plugin) return;
        
        const currentValue = (plugin.settings?.readCompressed as boolean) ?? false;
        const newValue = !currentValue;
        
        await updatePluginConfig(pluginId, {
            enabled: plugin.enabled,
            settings: {
                ...plugin.settings,
                readCompressed: newValue
            }
        });
    };


    const handleToggleOptions = (pluginId: string) => {
        if (expandedPluginId === pluginId) {
            setExpandedPluginId(null);
        } else {
            setExpandedPluginId(pluginId);
        }
    };

    const handleOptionsClose = () => {
        setExpandedPluginId(null);
        // Force refresh plugins after config change to get updated settings
        (fetchPlugins as (force?: boolean) => Promise<void>)(true); // Force refresh
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-gray-600 border-t-cyan-400 rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <>
            <Section title="Gestion des plugins" icon={Settings} iconColor="emerald">
                <div className="space-y-3">
                    {sortedPlugins.map((plugin) => (
                        <div key={plugin.id}>
                            <div
                                className={`rounded-lg p-3 border transition-all hover:shadow-lg flex flex-col cursor-pointer ${
                                    plugin.enabled && plugin.connectionStatus
                                        ? 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/50 hover:shadow-emerald-500/20'
                                        : plugin.enabled
                                            ? 'bg-yellow-500/10 border-yellow-500/30 hover:border-yellow-500/50 hover:shadow-yellow-500/20'
                                            : 'bg-gray-500/10 border-gray-500/30 hover:border-gray-500/50 hover:shadow-gray-500/20'
                                } ${expandedPluginId === plugin.id ? 'border-purple-500/50' : ''}`}
                                onClick={() => handleToggleOptions(plugin.id)}
                            >
                            {/* Header */}
                            <div className="flex items-center justify-between mb-2.5">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden ${
                                        plugin.enabled && plugin.connectionStatus 
                                            ? 'bg-emerald-500/20 border border-emerald-500/30' 
                                            : plugin.enabled 
                                                ? 'bg-yellow-500/20 border border-yellow-500/30'
                                                : 'bg-gray-500/20 border border-gray-500/30'
                                    }`}>
                                        {['host-system', 'nginx', 'apache', 'npm'].includes(plugin.id) ? (
                                            <img 
                                                src={getPluginIcon(plugin.id, plugin.id === 'host-system' ? osType : undefined)} 
                                                alt={plugin.name}
                                                className="w-6 h-6 object-contain"
                                            />
                                        ) : (
                                            <Settings size={16} className={
                                                plugin.enabled && plugin.connectionStatus 
                                                    ? 'text-emerald-400' 
                                                    : plugin.enabled 
                                                        ? 'text-yellow-400'
                                                        : 'text-gray-400'
                                            } />
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-semibold text-theme-primary text-sm truncate">{plugin.name}</h4>
                                        <p className="text-[10px] text-theme-tertiary">v{plugin.version}</p>
                                    </div>
                                </div>
                                {/* Status badge - top right */}
                                <div className="flex-shrink-0">
                                    {plugin.connectionStatus ? (
                                        <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded text-emerald-400 text-[10px] font-medium">
                                            <CheckCircle size={11} />
                                            <span>Connecté</span>
                                        </div>
                                    ) : plugin.enabled ? (
                                        <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-yellow-500/20 border border-yellow-500/30 rounded text-yellow-400 text-[10px] font-medium">
                                            <AlertCircle size={11} />
                                            <span>Non connecté</span>
                                        </div>
                                    ) : (
                                        <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-gray-500/20 border border-gray-500/30 rounded text-gray-400 text-[10px] font-medium">
                                            <XCircle size={11} />
                                            <span>Désactivé</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Plugin-specific info */}
                            {plugin.connectionStatus && (
                                <div className="mb-2.5 flex flex-wrap gap-1.5">
                                    {/* Plugin-specific badges will be added for LogviewR plugins in Phase 2 */}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex items-center justify-between pt-2.5 mt-auto">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-theme-tertiary font-medium">Actif</span>
                                    <button
                                        onClick={() => handleToggle(plugin.id, !plugin.enabled)}
                                        className={`relative w-9 h-5 rounded-full transition-all ${
                                            plugin.enabled ? 'bg-emerald-500 shadow-lg shadow-emerald-500/30' : 'bg-gray-600'
                                        }`}
                                    >
                                        <span
                                            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-md ${
                                                plugin.enabled ? 'translate-x-4' : 'translate-x-0'
                                            }`}
                                        />
                                    </button>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {['host-system', 'apache', 'nginx', 'npm'].includes(plugin.id) && (
                                        <Tooltip content={(plugin.settings?.readCompressed as boolean) 
                                            ? 'Désactiver la lecture des fichiers compressés (.gz)' 
                                            : 'Activer la lecture des fichiers compressés (.gz)'}>
                                            <button
                                                onClick={(e) => handleToggleCompressed(plugin.id, e)}
                                                className={`p-1.5 rounded-lg transition-all hover:shadow-lg cursor-help ${
                                                    (plugin.settings?.readCompressed as boolean) 
                                                        ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-400 hover:bg-cyan-500/30 hover:shadow-cyan-500/20' 
                                                        : 'bg-theme-secondary border border-theme text-theme-tertiary hover:bg-theme-primary hover:text-theme-primary'
                                                }`}
                                            >
                                                <Archive size={12} />
                                            </button>
                                        </Tooltip>
                                    )}
                                    <Tooltip content={expandedPluginId === plugin.id ? 'Fermer les options de configuration' : 'Ouvrir les options de configuration'}>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleToggleOptions(plugin.id);
                                            }}
                                            className={`p-1.5 bg-theme-secondary border border-theme hover:bg-theme-primary hover:border-emerald-500/50 rounded-lg text-theme-primary transition-all hover:shadow-lg hover:shadow-emerald-500/10 cursor-help ${
                                                expandedPluginId === plugin.id ? 'bg-emerald-500/20 border-emerald-500/50' : ''
                                            }`}
                                        >
                                            <Settings size={12} className={expandedPluginId === plugin.id ? 'text-emerald-400' : ''} />
                                        </button>
                                    </Tooltip>
                                </div>
                            </div>
                        </div>
                        
                        {/* Expanded Options Panel */}
                        {expandedPluginId === plugin.id && (
                            <PluginOptionsPanel
                                pluginId={plugin.id}
                                onClose={handleOptionsClose}
                            />
                        )}
                    </div>
                    ))}
                </div>
            </Section>

        </>
    );
};

