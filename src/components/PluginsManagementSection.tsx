/**
 * Plugins Management Section
 * 
 * Component for managing plugins within Administration settings
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, CheckCircle, XCircle, AlertCircle, Archive, Zap, Loader2 } from 'lucide-react';
import { usePluginStore, type Plugin } from '../stores/pluginStore';
import { Section } from './SettingsSection';
import { PluginOptionsPanel } from './PluginOptionsPanel';
import { getPluginIcon } from '../utils/pluginIcons';
import { api } from '../api/client';
import { Tooltip } from './ui/Tooltip';
import { useNotificationStore } from '../stores/notificationStore';

interface F2bWarnState {
    errors: { label: string; fix: string | null }[];
}

export const PluginsManagementSection: React.FC = () => {
    const { t } = useTranslation();
    const { plugins, pluginStats, isLoading, fetchPlugins, updatePluginConfig } = usePluginStore();
    const [expandedPluginId, setExpandedPluginId] = useState<string | null>(null);
    const [osType, setOsType] = useState<string | undefined>(undefined);
    const [f2bWarn, setF2bWarn] = useState<F2bWarnState | null>(null);
    const [testingId, setTestingId]         = useState<string | null>(null);
    const [togglingId, setTogglingId]       = useState<string | null>(null);
    const [notConfiguredId, setNotConfiguredId] = useState<string | null>(null);
    const addAction = useNotificationStore(s => s.addAction);
    const { testPluginConnection } = usePluginStore();

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
        const plugin = plugins.find(p => p.id === pluginId);
        if (!plugin) return;

        if (!enabled) {
            // Disabling: no test needed
            setTogglingId(pluginId);
            const ok = await updatePluginConfig(pluginId, { enabled: false });
            setTogglingId(null);
            addAction(ok ? `${plugin.name} — désactivé` : `${plugin.name} — erreur de désactivation`, ok);
            return;
        }

        // ── Enabling ─────────────────────────────────────────────────────────

        // Block if no config at all
        if (!plugin.configured) {
            setNotConfiguredId(pluginId);
            setTimeout(() => setNotConfiguredId(null), 3000);
            addAction(`${plugin.name} — configurez d'abord le plugin`, false);
            return;
        }

        setTogglingId(pluginId);

        // Fail2ban: detailed permission check first
        if (pluginId === 'fail2ban') {
            try {
                const token = localStorage.getItem('dashboard_user_token') ?? '';
                const res = await fetch('/api/plugins/fail2ban/check', {
                    headers: { Authorization: `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    const result = data.result ?? data;
                    if (!result.ok && result.checks) {
                        const CHECK_LABELS: Record<string, string> = {
                            socket: 'Socket Unix', client: 'fail2ban-client',
                            daemon: 'Daemon fail2ban', sqlite: 'Base SQLite', dropin: 'Drop-in systemd',
                        };
                        const errors = Object.entries(result.checks as Record<string, { ok: boolean; fix?: string | null }>)
                            .filter(([, c]) => !c.ok)
                            .map(([key, c]) => ({ label: CHECK_LABELS[key] ?? key, fix: c.fix ?? null }));
                        setTogglingId(null);
                        setF2bWarn({ errors });
                        return; // Block — modal shown
                    }
                }
            } catch { /* ignore network errors — fall through to connection test */ }
        }

        // Test connection before enabling — blocks activation on failure
        try {
            const result = await testPluginConnection(pluginId);
            if (!result?.connected) {
                setTogglingId(null);
                addAction(`${plugin.name} — ${result?.message || 'connexion impossible, vérifiez la configuration'}`, false);
                return;
            }
        } catch {
            setTogglingId(null);
            addAction(`${plugin.name} — test de connexion échoué`, false);
            return;
        }

        // Connection OK → enable
        const ok = await updatePluginConfig(pluginId, { enabled: true });
        setTogglingId(null);
        addAction(ok ? `${plugin.name} — activé avec succès` : `${plugin.name} — erreur d'activation`, ok);
    };

    const handleTestPlugin = async (e: React.MouseEvent, pluginId: string) => {
        e.stopPropagation();
        setTestingId(pluginId);
        try {
            const result = await testPluginConnection(pluginId);
            if (result) {
                addAction(
                    result.connected
                        ? `${pluginId} — connexion OK`
                        : `${pluginId} — ${result.message}`,
                    result.connected
                );
            } else {
                addAction(`${pluginId} — test impossible`, false);
            }
        } catch {
            addAction(`${pluginId} — erreur de test`, false);
        } finally {
            setTestingId(null);
        }
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
            {/* ── Fail2ban enable warning modal ── */}
            {f2bWarn && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
                    <div style={{ background: '#161b22', border: '1px solid rgba(232,106,101,.4)', borderRadius: 10, maxWidth: 520, width: '100%', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}>
                        <div style={{ background: 'rgba(232,106,101,.12)', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '.75rem', borderBottom: '1px solid rgba(232,106,101,.25)' }}>
                            <AlertCircle size={20} style={{ color: '#e86a65', flexShrink: 0 }} />
                            <div>
                                <div style={{ fontWeight: 700, color: '#e86a65', fontSize: '.95rem' }}>Fail2ban — erreurs de configuration</div>
                                <div style={{ fontSize: '.75rem', color: '#8b949e', marginTop: 2 }}>Le plugin ne fonctionnera pas correctement tant que ces problèmes ne sont pas résolus.</div>
                            </div>
                        </div>
                        <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                            {f2bWarn.errors.map((e, i) => (
                                <div key={i} style={{ borderRadius: 6, border: '1px solid rgba(232,106,101,.25)', overflow: 'hidden' }}>
                                    <div style={{ padding: '.4rem .75rem', background: 'rgba(232,106,101,.08)', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                        <XCircle size={13} style={{ color: '#e86a65', flexShrink: 0 }} />
                                        <span style={{ fontWeight: 600, fontSize: '.82rem', color: '#e86a65' }}>{e.label}</span>
                                    </div>
                                    {e.fix && (
                                        <pre style={{ margin: 0, padding: '.5rem .75rem', fontSize: '.72rem', fontFamily: 'monospace', color: '#e6edf3', lineHeight: 1.55, whiteSpace: 'pre-wrap', background: '#0d1117' }}>
                                            {e.fix}
                                        </pre>
                                    )}
                                </div>
                            ))}
                        </div>
                        <div style={{ padding: '.75rem 1.25rem', borderTop: '1px solid #30363d', display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
                            <button onClick={() => setF2bWarn(null)}
                                style={{ padding: '.35rem .85rem', borderRadius: 6, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', cursor: 'pointer', fontSize: '.82rem' }}>
                                Annuler
                            </button>
                            <button onClick={async () => {
                                setF2bWarn(null);
                                const ok = await updatePluginConfig('fail2ban', { enabled: true });
                                addAction(ok ? 'Fail2ban — activé (config incomplète)' : 'Fail2ban — erreur d\'activation', ok);
                            }}
                                style={{ padding: '.35rem .85rem', borderRadius: 6, border: '1px solid rgba(232,106,101,.4)', background: 'rgba(232,106,101,.15)', color: '#e86a65', cursor: 'pointer', fontSize: '.82rem', fontWeight: 600 }}>
                                Activer quand même
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <Section title={t('admin.pluginsSection.title')} icon={Settings} iconColor="emerald">
                <div className="flex gap-3">
                    {sortedPlugins.map((plugin) => (
                        <div key={plugin.id} className="flex-1 min-w-0">
                            <div
                                className={`rounded-lg px-4 py-3 border transition-all hover:shadow-lg flex items-center gap-3 cursor-pointer ${
                                    plugin.enabled && plugin.connectionStatus
                                        ? 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/50 hover:shadow-emerald-500/20'
                                        : plugin.enabled
                                            ? 'bg-yellow-500/10 border-yellow-500/30 hover:border-yellow-500/50 hover:shadow-yellow-500/20'
                                            : 'bg-gray-500/10 border-gray-500/30 hover:border-gray-500/50 hover:shadow-gray-500/20'
                                } ${expandedPluginId === plugin.id ? 'border-blue-500/50 ring-1 ring-blue-500/30' : ''}`}
                                onClick={() => handleToggleOptions(plugin.id)}
                            >
                                {/* Icon */}
                                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden ${
                                    plugin.enabled && plugin.connectionStatus
                                        ? 'bg-emerald-500/20 border border-emerald-500/30'
                                        : plugin.enabled
                                            ? 'bg-yellow-500/20 border border-yellow-500/30'
                                            : 'bg-gray-500/20 border border-gray-500/30'
                                }`}>
                                    {['host-system', 'nginx', 'apache', 'npm'].includes(plugin.id) ? (
                                        <img src={getPluginIcon(plugin.id, plugin.id === 'host-system' ? osType : undefined)} alt={plugin.name} className="w-6 h-6 object-contain" />
                                    ) : (
                                        <Settings size={16} className={plugin.enabled && plugin.connectionStatus ? 'text-emerald-400' : plugin.enabled ? 'text-yellow-400' : 'text-gray-400'} />
                                    )}
                                </div>

                                {/* Name + status */}
                                <div className="flex-1 min-w-0">
                                    <div className="font-semibold text-theme-primary text-sm truncate">{plugin.name}</div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        {notConfiguredId === plugin.id ? (
                                            <span className="inline-flex items-center gap-1 text-orange-400 text-[10px]"><AlertCircle size={10} />Configurez d'abord</span>
                                        ) : plugin.connectionStatus ? (
                                            <span className="inline-flex items-center gap-1 text-emerald-400 text-[10px]"><CheckCircle size={10} />{t('admin.pluginsSection.connected')}</span>
                                        ) : plugin.enabled ? (
                                            <span className="inline-flex items-center gap-1 text-yellow-400 text-[10px]"><AlertCircle size={10} />{t('admin.pluginsSection.notConnected')}</span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1 text-gray-500 text-[10px]"><XCircle size={10} />{t('admin.pluginsSection.disabled')}</span>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                                    {/* Test button */}
                                    <Tooltip content="Tester la connexion">
                                        <button
                                            onClick={(e) => handleTestPlugin(e, plugin.id)}
                                            disabled={testingId === plugin.id}
                                            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-40 transition-colors"
                                        >
                                            {testingId === plugin.id
                                                ? <Loader2 size={10} className="animate-spin" />
                                                : <Zap size={10} />
                                            }
                                            Test
                                        </button>
                                    </Tooltip>

                                    {['host-system', 'apache', 'nginx', 'npm'].includes(plugin.id) && (
                                        <Tooltip content={(plugin.settings?.readCompressed as boolean) ? t('admin.pluginsSection.tooltipCompressedOn') : t('admin.pluginsSection.tooltipCompressedOff')}>
                                            <button
                                                onClick={(e) => handleToggleCompressed(plugin.id, e)}
                                                className={`p-1.5 rounded-lg transition-colors ${
                                                    (plugin.settings?.readCompressed as boolean)
                                                        ? 'bg-cyan-500/20 border border-cyan-500/50 text-cyan-400'
                                                        : 'bg-theme-secondary border border-theme text-theme-tertiary hover:text-theme-primary'
                                                }`}
                                            >
                                                <Archive size={12} />
                                            </button>
                                        </Tooltip>
                                    )}
                                    <Tooltip content={plugin.configured ? (plugin.enabled ? 'Désactiver' : 'Activer (test connexion requis)') : 'Configurez d\'abord ce plugin'}>
                                        <button
                                            onClick={() => handleToggle(plugin.id, !plugin.enabled)}
                                            disabled={togglingId === plugin.id}
                                            className={`relative w-9 h-5 rounded-full transition-all flex-shrink-0 disabled:opacity-70 ${plugin.enabled ? 'bg-emerald-500 shadow-emerald-500/30' : plugin.configured ? 'bg-gray-600' : 'bg-gray-700 opacity-60'}`}
                                        >
                                            {togglingId === plugin.id
                                                ? <Loader2 size={12} className="absolute inset-0 m-auto animate-spin text-white" />
                                                : <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-md ${plugin.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                                            }
                                        </button>
                                    </Tooltip>
                                </div>
                            </div>
                        
                    </div>
                    ))}
                </div>

                {/* Options panel — below the card row */}
                {expandedPluginId && (
                    <PluginOptionsPanel
                        pluginId={expandedPluginId}
                        onClose={handleOptionsClose}
                    />
                )}
            </Section>

        </>
    );
};

