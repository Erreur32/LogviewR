/**
 * Plugins Management Page
 * 
 * Page for managing plugins: view, configure, enable/disable
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Settings, CheckCircle, XCircle, RefreshCw, AlertCircle, Code } from 'lucide-react';
import { usePluginStore, type Plugin } from '../stores/pluginStore';
import { Card } from '../components/widgets/Card';
import { Toggle } from '../components/ui/Toggle';
import { getPluginIcon } from '../utils/pluginIcons';
import { api } from '../api/client';
import { Badge } from '../components/ui/Badge';

interface PluginsPageProps {
    onBack: () => void;
    onNavigateToSettings?: () => void;
}

export const PluginsPage: React.FC<PluginsPageProps> = ({ onBack, onNavigateToSettings }) => {
    const { t } = useTranslation();
    const { plugins, isLoading, fetchPlugins, updatePluginConfig, testPluginConnection } = usePluginStore();
    const [testingPlugin, setTestingPlugin] = useState<string | null>(null);
    const [osType, setOsType] = useState<string | undefined>(undefined);
    const [customRegexCounts, setCustomRegexCounts] = useState<Record<string, number>>({});

    // Load OS type for host-system plugin
    useEffect(() => {
        api.get<{ type: string }>('/api/log-viewer/os-type')
            .then(response => {
                if (response.success && response.result) {
                    setOsType(response.result.type);
                }
            })
            .catch(err => {
                console.warn('[PluginsPage] Failed to get OS type:', err);
            });
    }, []);

    useEffect(() => {
        fetchPlugins();
    }, [fetchPlugins]);

    // Fetch custom regex counts for log source plugins
    useEffect(() => {
        const fetchRegexCounts = async () => {
            const counts: Record<string, number> = {};
            const logSourcePlugins = ['host-system', 'nginx', 'apache', 'npm'];
            
            for (const pluginId of logSourcePlugins) {
                try {
                    const response = await api.get<{ count: number }>(`/api/log-viewer/plugins/${pluginId}/custom-regex-count`);
                    if (response.success && response.result) {
                        counts[pluginId] = response.result.count;
                    }
                } catch (err) {
                    // Silently fail - regex count is optional
                    console.warn(`[PluginsPage] Failed to fetch regex count for ${pluginId}:`, err);
                }
            }
            setCustomRegexCounts(counts);
        };

        if (plugins.length > 0) {
            fetchRegexCounts();
        }
    }, [plugins]);

    const handleToggle = async (pluginId: string, enabled: boolean) => {
        await updatePluginConfig(pluginId, { enabled });
        await fetchPlugins(); // Refresh plugins to get updated state
    };

    const [lastTestMessage, setLastTestMessage] = useState<string | null>(null);
    const [lastTestSuccess, setLastTestSuccess] = useState<boolean | null>(null);

    const handleTest = async (pluginId: string) => {
        setTestingPlugin(pluginId);
        const result = await testPluginConnection(pluginId);
        if (result) {
            setLastTestSuccess(result.connected);
            setLastTestMessage(result.message);
        } else {
            setLastTestSuccess(false);
            setLastTestMessage(t('plugins.testImpossible'));
        }
        setTimeout(() => setTestingPlugin(null), 2000);
        await fetchPlugins(); // Refresh to update connection status
    };

    return (
        <div className="min-h-screen bg-[#050505] text-gray-300">
            <div className="max-w-7xl mx-auto p-6">
                {/* Header */}
                <div className="flex items-center gap-4 mb-6">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-[#1a1a1a] rounded transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <h1 className="text-2xl font-semibold">{t('plugins.pageTitle')}</h1>
                    <button
                        onClick={() => fetchPlugins()}
                        className="ml-auto p-2 hover:bg-[#1a1a1a] rounded transition-colors"
                        title={t('plugins.refresh')}
                    >
                        <RefreshCw size={20} />
                    </button>
                </div>

                {/* Plugins List */}
                {isLoading ? (
                    <div className="text-center py-12 text-gray-500">{t('plugins.loading')}</div>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                        {lastTestMessage && (
                            <div
                                className={`md:col-span-2 mb-4 px-4 py-3 rounded-lg border-2 flex items-center gap-3 ${
                                    lastTestSuccess
                                        ? 'border-green-600 bg-green-900/40 text-green-100'
                                        : 'border-red-600 bg-red-900/40 text-red-100'
                                }`}
                            >
                                {lastTestSuccess ? (
                                    <CheckCircle size={18} className="text-green-400 flex-shrink-0" />
                                ) : (
                                    <XCircle size={18} className="text-red-400 flex-shrink-0" />
                                )}
                                <div className="flex-1">
                                    <div className="font-semibold text-sm mb-0.5">
                                        {lastTestSuccess ? t('plugins.testSuccess') : t('plugins.testFailed')}
                                    </div>
                                    <div className="text-xs opacity-90">{lastTestMessage}</div>
                                </div>
                            </div>
                        )}
                        {plugins.map((plugin) => (
                            <Card 
                                key={plugin.id} 
                                title={
                                    <div className="flex items-center gap-3">
                                        {['host-system', 'nginx', 'apache', 'npm'].includes(plugin.id) ? (
                                            <img 
                                                src={getPluginIcon(plugin.id, plugin.id === 'host-system' ? osType : undefined)} 
                                                alt={plugin.name}
                                                className="w-6 h-6 object-contain"
                                            />
                                        ) : null}
                                        <span>{plugin.name}</span>
                                    </div>
                                }
                                actions={
                                    <div className="flex items-center gap-2">
                                        {/* Status badge - top right */}
                                        {plugin.connectionStatus ? (
                                            <span className="flex items-center gap-1 text-xs text-green-400 px-2 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded">
                                                <CheckCircle size={12} />
                                                {t('plugins.connected')}
                                            </span>
                                        ) : plugin.enabled ? (
                                            <span className="flex items-center gap-1 text-xs text-yellow-400 px-2 py-1 bg-yellow-500/20 border border-yellow-500/30 rounded">
                                                <AlertCircle size={12} />
                                                {t('plugins.notConnected')}
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-xs text-gray-400 px-2 py-1 bg-gray-500/20 border border-gray-500/30 rounded">
                                                <XCircle size={12} />
                                                {t('plugins.disabled')}
                                            </span>
                                        )}
                                    </div>
                                }
                            >
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm text-gray-400">{t('plugins.version')} {plugin.version}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleTest(plugin.id)}
                                                disabled={testingPlugin === plugin.id}
                                                className="p-2 hover:bg-[#1a1a1a] rounded transition-colors disabled:opacity-50"
                                                title={t('plugins.testConnection')}
                                            >
                                                <RefreshCw 
                                                    size={16} 
                                                    className={testingPlugin === plugin.id ? 'animate-spin' : ''}
                                                />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-2 border-t border-gray-700">
                                        <span className="text-sm text-gray-400">{t('plugins.enable')}</span>
                                        <Toggle
                                            checked={plugin.enabled}
                                            onChange={(checked) => handleToggle(plugin.id, checked)}
                                        />
                                    </div>

                                    {/* Configure Button - Redirect to admin/plugins */}
                                        <button
                                            onClick={() => {
                                                // Navigate to settings with plugins tab
                                                sessionStorage.setItem('adminMode', 'true');
                                                sessionStorage.setItem('adminTab', 'plugins');
                                                // Navigate to settings page
                                                if (onNavigateToSettings) {
                                                    onNavigateToSettings();
                                                } else {
                                                    // Fallback: use onBack and navigate manually
                                                    onBack();
                                                }
                                            }}
                                            className="w-full mt-3 px-3 py-2 bg-[#1a1a1a] hover:bg-[#252525] border border-gray-700 rounded-lg text-sm text-gray-300 hover:text-white transition-colors flex items-center justify-center gap-2"
                                        >
                                            <Settings size={14} />
                                            {t('plugins.configure')}
                                        </button>

                                    {/* Custom Regex Badge - Centered at bottom */}
                                    {customRegexCounts[plugin.id] && customRegexCounts[plugin.id] > 0 && (
                                        <div className="mt-4 pt-4 border-t border-gray-700 flex justify-center">
                                            <Badge 
                                                variant="purple" 
                                                size="md"
                                                className="w-full max-w-fit flex items-center justify-center gap-2 px-4 py-2"
                                            >
                                                <Code size={14} />
                                                <span>{customRegexCounts[plugin.id]} {customRegexCounts[plugin.id] > 1 ? t('plugins.customRegexPlural') : t('plugins.customRegex')}</span>
                                            </Badge>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

