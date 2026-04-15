/**
 * Exporter Section Component
 *
 * Configuration for metrics export (Prometheus and InfluxDB)
 * and overview stats (files count, .gz, active plugins, errors/anomalies placeholder).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Share2, Server, Database, Save, Loader2, ExternalLink, AlertCircle, CheckCircle, Wifi, RefreshCw, Send } from 'lucide-react';
import { Section, SettingRow } from './SettingsSection';
import { api } from '../api/client';

interface MetricsConfig {
    prometheus: {
        enabled: boolean;
        port?: number; // Port réel du serveur (3003 en dev, 3000 en prod)
        path?: string;
    };
    influxdb: {
        enabled: boolean;
        url?: string;
        database?: string;
        username?: string;
        password?: string;
        retention?: string;
    };
}

export const ExporterSection: React.FC = () => {
    // Get default port based on environment
    // In production (Docker), default port is 7505 (mapped from container port 3000)
    const getDefaultPort = () => {
        const isDev = import.meta.env.DEV;
        return isDev ? 3003 : 7505; // Docker default port is 7505
    };
    
    const [config, setConfig] = useState<MetricsConfig>({
        prometheus: { enabled: false, port: getDefaultPort(), path: '/metrics' },
        influxdb: { enabled: false, url: 'http://localhost:8086', database: 'logviewr', username: '', password: '', retention: '30d' }
    });
    const [activeTab, setActiveTab] = useState<'prometheus' | 'influxdb' | 'mqtt'>('mqtt');
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [prometheusUrl, setPrometheusUrl] = useState('');
    const [isAuditing, setIsAuditing] = useState(false);
    const [auditResult, setAuditResult] = useState<{ summary: { total: number; success: number; errors: number }; results: any[] } | null>(null);
    const [initialConfig, setInitialConfig] = useState<MetricsConfig | null>(null);
    const [publicUrl, setPublicUrl] = useState<string>('');

    const { t } = useTranslation();

    useEffect(() => {
        // Load config first
        loadConfig();
        // Load public URL from system settings
        loadPublicUrl();
    }, []);

    // Load public URL from system settings
    const loadPublicUrl = async () => {
        try {
            const response = await api.get<{ publicUrl: string }>('/api/system/general');
            if (response.success && response.result) {
                setPublicUrl(response.result.publicUrl || '');
            }
        } catch (error) {
            console.error('Failed to load public URL:', error);
        }
    };

    // Check if there are unsaved changes
    const hasUnsavedChanges = initialConfig && JSON.stringify(config) !== JSON.stringify(initialConfig);

    // Update Prometheus URL when config changes
    useEffect(() => {
        if (!config.prometheus.enabled) {
            setPrometheusUrl('');
            return;
        }
        
        const configuredPort = config.prometheus.port || getDefaultPort();
        
        // If public URL (domain) is configured, use HTTPS + domain without port
        if (publicUrl && publicUrl.trim()) {
            try {
                const url = new URL(publicUrl.trim());
                // Remove port from domain URL (use standard HTTPS port 443)
                const domain = url.hostname;
                const prometheusUrl = `https://${domain}/api/metrics/prometheus`;
                setPrometheusUrl(prometheusUrl);
                return;
            } catch {
                // Invalid URL, fallback to IP + port
            }
        }
        
        // No public URL configured: use HTTP + IP + port
        const hostname = window.location.hostname;
        const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/.test(hostname);
        
        const url = `http://${hostname}:${configuredPort}/api/metrics/prometheus`;
        setPrometheusUrl(url);
    }, [config.prometheus.port, config.prometheus.enabled, publicUrl]);

    const loadConfig = async () => {
        setIsLoading(true);
        try {
            const response = await api.get<MetricsConfig>('/api/metrics/config');
            if (response.success && response.result) {
                const loadedConfig = response.result;
                // If port is 9090 (old default) or undefined, replace with current default
                // Update port to Docker default (7505) if not set or using old defaults
                if (loadedConfig.prometheus && (!loadedConfig.prometheus.port || loadedConfig.prometheus.port === 9090 || loadedConfig.prometheus.port === 3000)) {
                    loadedConfig.prometheus.port = getDefaultPort();
                }
                setConfig(loadedConfig);
                // Store initial config (deep copy)
                setInitialConfig(JSON.parse(JSON.stringify(loadedConfig)));
            }
        } catch (error) {
            console.error('Failed to load metrics config:', error);
            setMessage({ type: 'error', text: t('exporter.loadError') });
        } finally {
            setIsLoading(false);
        }
    };

    const saveConfig = async () => {
        setIsSaving(true);
        setMessage(null);
        try {
            const response = await api.post('/api/metrics/config', { config });
            if (response.success) {
                setMessage({ type: 'success', text: t('exporter.saveSuccess') });
                // Update initial config after save
                setInitialConfig(JSON.parse(JSON.stringify(config)));
            } else {
                setMessage({ type: 'error', text: response.error?.message || t('exporter.saveError') });
            }
        } catch (error) {
            setMessage({ type: 'error', text: error instanceof Error ? error.message : t('exporter.saveError') });
        } finally {
            setIsSaving(false);
        }
    };

    const testPrometheus = () => {
        window.open(prometheusUrl, '_blank');
    };

    const auditPrometheus = async () => {
        setIsAuditing(true);
        setAuditResult(null);
        setMessage(null);
        
        try {
            const response = await api.get<{
                auditDate: string;
                results: Array<{
                    endpoint: string;
                    status: 'success' | 'error';
                    message: string;
                    metricsCount?: number;
                    sampleMetrics?: string[];
                    errors?: string[];
                }>;
                summary: {
                    total: number;
                    success: number;
                    errors: number;
                };
            }>('/api/metrics/prometheus/audit');
            
            if (response.success && response.result) {
                setAuditResult(response.result);
                if (response.result.summary.errors === 0) {
                    setMessage({ 
                        type: 'success', 
                        text: t('exporter.auditSuccess', { success: response.result.summary.success, total: response.result.summary.total }) 
                    });
                } else {
                    setMessage({ 
                        type: 'error', 
                        text: t('exporter.auditPartial', { count: response.result.summary.errors }) 
                    });
                }
            } else {
                throw new Error(response.error?.message || t('exporter.auditError'));
            }
        } catch (error) {
            setMessage({ 
                type: 'error', 
                text: error instanceof Error ? error.message : t('exporter.auditErrorGeneric') 
            });
        } finally {
            setIsAuditing(false);
        }
    };

    const testInfluxDB = async () => {
        try {
            const response = await api.get('/api/metrics/influxdb');
            if (response.success) {
                // Show success message
                setMessage({ type: 'success', text: t('exporter.influxTestSuccess') });
            }
        } catch (error) {
            setMessage({ type: 'error', text: t('exporter.influxTestError') });
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-16">
                <Loader2 size={32} className="text-gray-400 animate-spin" />
            </div>
        );
    }

    // ── Tab definitions ────────────────────────────────────────────────────────
    const TABS = [
        { id: 'mqtt'       as const, label: 'MQTT / HA',  icon: Wifi,      activeColor: 'bg-teal-500/20 text-teal-300 border-teal-500/40' },
        { id: 'prometheus' as const, label: 'Prometheus', icon: Server,    activeColor: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
        { id: 'influxdb'   as const, label: 'InfluxDB',   icon: Database,  activeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
    ] as const;

    return (
        <div className="space-y-4">
            {/* Tab bar */}
            <div className="flex gap-1 p-1 bg-[#111] border border-gray-800 rounded-lg w-fit">
                {TABS.map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                                isActive
                                    ? tab.activeColor
                                    : 'border-transparent text-gray-400 hover:text-gray-200'
                            }`}>
                            <Icon size={12} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* MQTT tab */}
            {activeTab === 'mqtt' && (
                <Section title="MQTT / Home Assistant" icon={Wifi} iconColor="teal">
                    <MqttSection />
                </Section>
            )}

            {/* Prometheus tab */}
            {activeTab === 'prometheus' && (
            <div className="space-y-6">
            {/* Unsaved Changes Notification */}
            {hasUnsavedChanges && (
                <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg flex items-start gap-3">
                    <AlertCircle size={20} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <h4 className="text-sm font-medium text-amber-400 mb-1">
                            {t('exporter.unsavedTitle')}
                        </h4>
                        <p className="text-xs text-amber-300">
                            {t('exporter.unsavedHint')}
                        </p>
                    </div>
                </div>
            )}
            {message && activeTab === 'prometheus' && (
                <div className={`p-3 rounded text-sm ${message.type === 'success' ? 'bg-emerald-900/30 border border-emerald-700 text-emerald-400' : 'bg-red-900/30 border border-red-700 text-red-400'}`}>
                    {message.text}
                </div>
            )}

            {/* Prometheus Section */}
            <Section title={t('exporter.prometheusTitle')} icon={Server} iconColor="orange">
                <SettingRow
                    label={t('exporter.enablePrometheus')}
                    description={t('exporter.prometheusDesc')}
                >
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={config.prometheus.enabled}
                            onChange={(e) => setConfig({
                                ...config,
                                prometheus: { ...config.prometheus, enabled: e.target.checked }
                            })}
                            className="w-4 h-4 text-blue-600 bg-[#1a1a1a] border-gray-700 rounded focus:ring-0"
                        />
                        <span className="text-sm text-gray-400">
                            {config.prometheus.enabled ? (
                                <span className="flex items-center gap-1 text-green-400">
                                    <CheckCircle size={14} />
                                    {t('exporter.enabled')}
                                </span>
                            ) : (
                                t('exporter.disabled')
                            )}
                        </span>
                    </div>
                </SettingRow>

                {config.prometheus.enabled && (
                    <>
                        <SettingRow
                            label={t('exporter.serverPort')}
                            description={t('exporter.serverPortDesc')}
                        >
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    min="1024"
                                    max="65535"
                                    value={config.prometheus.port || getDefaultPort()}
                                    onChange={(e) => {
                                        const port = Number.parseInt(e.target.value) || getDefaultPort();
                                        setConfig({
                                            ...config,
                                            prometheus: { ...config.prometheus, port }
                                        });
                                    }}
                                    className="w-32 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-400">{t('exporter.port')}</span>
                                <span className="text-xs text-gray-500">
                                    {t('exporter.defaultPort', { port: getDefaultPort() })}
                                </span>
                            </div>
                        </SettingRow>

                        <SettingRow
                            label={t('exporter.endpointPath')}
                            description={t('exporter.endpointPathDesc')}
                        >
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={config.prometheus.path || '/metrics'}
                                    onChange={(e) => setConfig({
                                        ...config,
                                        prometheus: { ...config.prometheus, path: e.target.value }
                                    })}
                                    className="flex-1 px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:outline-none"
                                    placeholder="/metrics"
                                />
                            </div>
                        </SettingRow>

                        <SettingRow
                            label={t('exporter.endpointUrl')}
                            description={t('exporter.endpointUrlDesc')}
                        >
                            <div className="w-full">
                                <div className="flex items-center gap-2 w-full">
                                    <input
                                        type="text"
                                        value={prometheusUrl}
                                        readOnly
                                        className="flex-1 px-4 py-3 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-base opacity-90 cursor-not-allowed font-mono"
                                        style={{ width: '100%', minWidth: '600px' }}
                                    />
                                    <button
                                        onClick={testPrometheus}
                                        className="px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white text-sm transition-colors flex items-center gap-2 flex-shrink-0 whitespace-nowrap"
                                    >
                                        <ExternalLink size={16} />
                                        {t('exporter.test')}
                                    </button>
                                    <button
                                        onClick={auditPrometheus}
                                        disabled={isAuditing}
                                        className="px-4 py-3 bg-orange-600 hover:bg-orange-700 rounded-lg text-white text-sm transition-colors flex items-center gap-2 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                    >
                                        {isAuditing ? <Loader2 size={16} className="animate-spin" /> : <AlertCircle size={16} />}
                                        {t('exporter.audit')}
                                    </button>
                                </div>
                            </div>
                        </SettingRow>
                        
                        {auditResult && (
                            <div className="mt-4 p-4 bg-gray-900/50 border border-gray-700 rounded-lg">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-sm font-semibold text-gray-300">{t('exporter.auditResultsTitle')}</h4>
                                    <span className={`text-xs px-2 py-1 rounded ${
                                        auditResult.summary.errors === 0 
                                            ? 'bg-green-900/40 text-green-400' 
                                            : 'bg-orange-900/40 text-orange-400'
                                    }`}>
                                        {t('exporter.auditPassed', { success: auditResult.summary.success, total: auditResult.summary.total })}
                                    </span>
                                </div>
                                <div className="space-y-2">
                                    {auditResult.results.map((result, index) => (
                                        <div key={index} className={`p-2 rounded text-xs ${
                                            result.status === 'success' 
                                                ? 'bg-green-900/20 border border-green-700/50' 
                                                : 'bg-red-900/20 border border-red-700/50'
                                        }`}>
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="font-medium text-gray-300">{result.endpoint}</span>
                                                <span className={`px-2 py-0.5 rounded text-[10px] ${
                                                    result.status === 'success' 
                                                        ? 'bg-green-700/50 text-green-300' 
                                                        : 'bg-red-700/50 text-red-300'
                                                }`}>
                                                    {result.status === 'success' ? t('exporter.ok') : t('exporter.error')}
                                                </span>
                                            </div>
                                            <p className="text-gray-400">{result.message}</p>
                                            {result.metricsCount !== undefined && (
                                                <p className="text-gray-500 mt-1">{t('exporter.metricsCount', { count: result.metricsCount })}</p>
                                            )}
                                            {result.sampleMetrics && result.sampleMetrics.length > 0 && (
                                                <div className="mt-1">
                                                    <p className="text-gray-500 text-[10px]">{t('exporter.samples')} {result.sampleMetrics.slice(0, 5).join(', ')}</p>
                                                </div>
                                            )}
                                            {result.errors && result.errors.length > 0 && (
                                                <div className="mt-1 text-red-400 text-[10px]">
                                                    {result.errors.map((err: string, i: number) => (
                                                        <div key={i}>{err}</div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mt-4 p-3 bg-blue-900/20 border border-blue-700/50 rounded-lg">
                            <p className="text-xs text-blue-300 mb-2">
                                <strong>{t('exporter.prometheusConfigTitle')}</strong>
                            </p>
                            <pre className="text-xs text-gray-400 overflow-x-auto">
{`scrape_configs:
  - job_name: 'logviewr'
    scrape_interval: 30s
    static_configs:
      - targets: ['${window.location.hostname}:${config.prometheus.port || getDefaultPort()}']
    metrics_path: '/api/metrics/prometheus'`}
                            </pre>
                            <p className="text-xs text-blue-400 mt-2">
                                <strong>{t('exporter.prometheusNote', { port: config.prometheus.port || getDefaultPort() })}</strong>
                            </p>
                        </div>
                    </>
                )}
            </Section>

            {/* Save Button */}
            <div className="flex justify-end pt-4">
                <button
                    onClick={saveConfig}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    <span>{t('exporter.saveConfig')}</span>
                </button>
            </div>
        </div>
        )}

        {/* InfluxDB tab */}
        {activeTab === 'influxdb' && (
        <div className="space-y-6">
            {hasUnsavedChanges && (
                <div className="p-4 bg-amber-900/20 border border-amber-700/50 rounded-lg flex items-start gap-3">
                    <AlertCircle size={20} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <h4 className="text-sm font-medium text-amber-400 mb-1">
                            {t('exporter.unsavedTitle')}
                        </h4>
                        <p className="text-xs text-amber-300">
                            {t('exporter.unsavedHint')}
                        </p>
                    </div>
                </div>
            )}
            {message && activeTab === 'influxdb' && (
                <div className={`p-3 rounded text-sm ${message.type === 'success' ? 'bg-emerald-900/30 border border-emerald-700 text-emerald-400' : 'bg-red-900/30 border border-red-700 text-red-400'}`}>
                    {message.text}
                </div>
            )}

            {/* InfluxDB Section */}
            <Section title={t('exporter.influxTitle')} icon={Database} iconColor="cyan">
                <SettingRow
                    label={t('exporter.enableInflux')}
                    description={t('exporter.influxDesc')}
                >
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            checked={config.influxdb.enabled}
                            onChange={(e) => setConfig({
                                ...config,
                                influxdb: { ...config.influxdb, enabled: e.target.checked }
                            })}
                            className="w-4 h-4 text-blue-600 bg-[#1a1a1a] border-gray-700 rounded focus:ring-0"
                        />
                        <span className="text-sm text-gray-400">
                            {config.influxdb.enabled ? (
                                <span className="flex items-center gap-1 text-green-400">
                                    <CheckCircle size={14} />
                                    {t('exporter.enabled')}
                                </span>
                            ) : (
                                t('exporter.disabled')
                            )}
                        </span>
                    </div>
                </SettingRow>

                {config.influxdb.enabled && (
                    <>
                        <SettingRow
                            label={t('exporter.influxUrl')}
                            description={t('exporter.influxUrlDesc')}
                        >
                            <input
                                type="text"
                                value={config.influxdb.url || ''}
                                onChange={(e) => setConfig({
                                    ...config,
                                    influxdb: { ...config.influxdb, url: e.target.value }
                                })}
                                placeholder="http://localhost:8086"
                                className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:outline-none transition-colors"
                            />
                        </SettingRow>

                        <SettingRow
                            label={t('exporter.influxDatabase')}
                            description={t('exporter.influxDatabaseDesc')}
                        >
                            <input
                                type="text"
                                value={config.influxdb.database || ''}
                                onChange={(e) => setConfig({
                                    ...config,
                                    influxdb: { ...config.influxdb, database: e.target.value }
                                })}
                                placeholder="logviewr"
                                className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:outline-none transition-colors"
                            />
                        </SettingRow>

                        <SettingRow
                            label={t('exporter.influxUsername')}
                            description={t('exporter.influxUsernameDesc')}
                        >
                            <input
                                type="text"
                                value={config.influxdb.username || ''}
                                onChange={(e) => setConfig({
                                    ...config,
                                    influxdb: { ...config.influxdb, username: e.target.value }
                                })}
                                placeholder="admin"
                                className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:outline-none transition-colors"
                            />
                        </SettingRow>

                        <SettingRow
                            label={t('exporter.influxPassword')}
                            description={t('exporter.influxPasswordDesc')}
                        >
                            <input
                                type="password"
                                value={config.influxdb.password || ''}
                                onChange={(e) => setConfig({
                                    ...config,
                                    influxdb: { ...config.influxdb, password: e.target.value }
                                })}
                                placeholder="••••••••"
                                className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:outline-none transition-colors"
                            />
                        </SettingRow>

                        <SettingRow
                            label={t('exporter.retention')}
                            description={t('exporter.retentionDesc')}
                        >
                            <input
                                type="text"
                                value={config.influxdb.retention || ''}
                                onChange={(e) => setConfig({
                                    ...config,
                                    influxdb: { ...config.influxdb, retention: e.target.value }
                                })}
                                placeholder="30d"
                                className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:outline-none transition-colors"
                            />
                        </SettingRow>

                        <div className="mt-4 p-3 bg-purple-900/20 border border-purple-700/50 rounded-lg">
                            <p className="text-xs text-purple-300 mb-2">
                                <strong>{t('exporter.influxNote')}</strong>
                            </p>
                            <button
                                onClick={testInfluxDB}
                                className="mt-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-white text-xs transition-colors flex items-center gap-2"
                            >
                                <ExternalLink size={12} />
                                {t('exporter.testExport')}
                            </button>
                        </div>
                    </>
                )}
            </Section>

            {/* Save Button */}
            <div className="flex justify-end pt-4">
                <button
                    onClick={saveConfig}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    <span>{t('exporter.saveConfig')}</span>
                </button>
            </div>
        </div>
        )}

    </div>
    );
};

// ── MQTT Section ──────────────────────────────────────────────────────────────────

interface MqttStatSelection {
    bansToday:   boolean;
    uniqueIps:   boolean;
    activeBans:  boolean;
    jailDetails: boolean;
    dbSizeMb:    boolean;
    systemLoad:  boolean;
}

interface MqttConfig {
    enabled:         boolean;
    broker:          string;
    username?:       string;
    password?:       string;
    topicPrefix:     string;
    intervalMinutes: number;
    discovery:       boolean;
    stats:           MqttStatSelection;
}

const STAT_LABELS: { key: keyof MqttStatSelection; label: string; desc: string }[] = [
    { key: 'bansToday',   label: 'Bans aujourd\'hui',    desc: 'Total des bans depuis minuit' },
    { key: 'uniqueIps',   label: 'IPs uniques bannies',  desc: 'Nombre d\'IPs distinctes bannies aujourd\'hui' },
    { key: 'activeBans',  label: 'Bans actifs',           desc: 'Bans permanents + non expirés en cours' },
    { key: 'jailDetails', label: 'Détail par jail',       desc: 'JSON {jail: count} publié sur logviewr/jails' },
    { key: 'dbSizeMb',    label: 'Taille base de données', desc: 'Taille SQLite en Mo' },
    { key: 'systemLoad',  label: 'CPU / Mémoire serveur', desc: 'Charge CPU % et RAM utilisée en Mo' },
];

const INTERVAL_OPTIONS = [
    { value: 1,  label: '1 minute' },
    { value: 5,  label: '5 minutes' },
    { value: 10, label: '10 minutes' },
    { value: 30, label: '30 minutes' },
];

const DEFAULT_MQTT: MqttConfig = {
    enabled: false, broker: 'mqtt://localhost:1883', topicPrefix: 'logviewr',
    intervalMinutes: 5, discovery: true,
    stats: { bansToday: true, uniqueIps: true, activeBans: true, jailDetails: false, dbSizeMb: true, systemLoad: false },
};

const MqttSection: React.FC = () => {
    const [config, setConfig] = useState<MqttConfig>(DEFAULT_MQTT);
    const [loading, setLoading]       = useState(true);
    const [saving, setSaving]         = useState(false);
    const [testing, setTesting]       = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [connected, setConnected]   = useState(false);
    const [msg, setMsg]               = useState<{ ok: boolean; text: string } | null>(null);
    const [showPass, setShowPass]     = useState(false);

    const loadConfig = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<MqttConfig>('/api/metrics/mqtt/config');
            if (res.result) setConfig(res.result);
            const st = await api.get<{ connected: boolean }>('/api/metrics/mqtt/status');
            if (st.result) setConnected(st.result.connected);
        } catch { /* ignore */ }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { loadConfig(); }, [loadConfig]);

    const save = async () => {
        setSaving(true); setMsg(null);
        try {
            await api.post('/api/metrics/mqtt/config', config);
            setMsg({ ok: true, text: 'Configuration enregistrée.' });
            setTimeout(async () => {
                const st = await api.get<{ connected: boolean }>('/api/metrics/mqtt/status');
                if (st.result) setConnected(st.result.connected);
            }, 2000);
        } catch (e: unknown) {
            setMsg({ ok: false, text: e instanceof Error ? e.message : 'Erreur' });
        } finally { setSaving(false); }
    };

    const test = async () => {
        setTesting(true); setMsg(null);
        try {
            await api.post('/api/metrics/mqtt/test', { broker: config.broker, username: config.username, password: config.password });
            setMsg({ ok: true, text: 'Connexion broker réussie !' });
            setConnected(true);
        } catch (e: unknown) {
            setMsg({ ok: false, text: e instanceof Error ? e.message : 'Erreur de connexion' });
            setConnected(false);
        } finally { setTesting(false); }
    };

    const publishNow = async () => {
        setPublishing(true); setMsg(null);
        try {
            await api.post('/api/metrics/mqtt/publish', {});
            setMsg({ ok: true, text: 'Stats publiées avec succès.' });
        } catch (e: unknown) {
            setMsg({ ok: false, text: e instanceof Error ? e.message : 'Erreur de publication' });
        } finally { setPublishing(false); }
    };

    const setStat = (key: keyof MqttStatSelection, val: boolean) =>
        setConfig(c => ({ ...c, stats: { ...c.stats, [key]: val } }));

    if (loading) return (
        <div className="flex items-center gap-2 text-gray-500 text-sm py-3">
            <Loader2 size={14} className="animate-spin" /> Chargement…
        </div>
    );

    return (
        <div className="space-y-5">
            {/* Header row: enable toggle + status badge */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                            config.enabled ? 'bg-teal-500' : 'bg-gray-700'
                        }`}>
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-gray-100 shadow transition duration-200 ${
                            config.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                    </button>
                    <span className="text-sm text-gray-300 cursor-pointer select-none"
                        role="button" tabIndex={0}
                        onClick={() => setConfig(c => ({ ...c, enabled: !c.enabled }))}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setConfig(c => ({ ...c, enabled: !c.enabled })); } }}>
                        Activer la publication MQTT
                    </span>
                </div>
                <span className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium ${
                    connected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-700/40 text-gray-500'
                }`}>
                    <Wifi size={11} />
                    {connected ? 'Connecté' : 'Déconnecté'}
                </span>
            </div>

            {/* Connection */}
            <div className="grid grid-cols-1 gap-3">
                <div>
                    <label htmlFor="mqtt-broker-url" className="block text-xs text-gray-400 mb-1">URL du broker</label>
                    <input id="mqtt-broker-url" type="text" value={config.broker}
                        onChange={e => setConfig(c => ({ ...c, broker: e.target.value }))}
                        placeholder="mqtt://192.168.1.1:1883"
                        className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                    <p className="mt-1 text-xs text-gray-500">Formats : <code>mqtt://</code> · <code>mqtts://</code> · <code>ws://</code></p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label htmlFor="mqtt-username" className="block text-xs text-gray-400 mb-1">Utilisateur (optionnel)</label>
                        <input id="mqtt-username" type="text" value={config.username ?? ''}
                            onChange={e => setConfig(c => ({ ...c, username: e.target.value }))}
                            placeholder="user"
                            className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                    </div>
                    <div>
                        <label htmlFor="mqtt-password" className="block text-xs text-gray-400 mb-1">Mot de passe (optionnel)</label>
                        <div className="relative">
                            <input id="mqtt-password" type={showPass ? 'text' : 'password'} value={config.password ?? ''}
                                onChange={e => setConfig(c => ({ ...c, password: e.target.value }))}
                                placeholder="••••••••"
                                className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 pr-8" />
                            <button type="button" onClick={() => setShowPass(v => !v)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs">
                                {showPass ? 'hide' : 'show'}
                            </button>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label htmlFor="mqtt-topic-prefix" className="block text-xs text-gray-400 mb-1">Préfixe de topic</label>
                        <input id="mqtt-topic-prefix" type="text" value={config.topicPrefix}
                            onChange={e => setConfig(c => ({ ...c, topicPrefix: e.target.value }))}
                            placeholder="logviewr"
                            className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                        <p className="mt-1 text-xs text-gray-500">Topic état : <code className="text-gray-400">{config.topicPrefix || 'logviewr'}/sensor/bans_today/state</code></p>
                    </div>
                    <div>
                        <label htmlFor="mqtt-interval" className="block text-xs text-gray-400 mb-1">Intervalle de publication</label>
                        <select id="mqtt-interval" value={config.intervalMinutes}
                            onChange={e => setConfig(c => ({ ...c, intervalMinutes: Number(e.target.value) }))}
                            className="w-full px-3 py-2 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-cyan-500/50">
                            {INTERVAL_OPTIONS.map(o => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* HA auto-discovery */}
            <div className="p-3 bg-[#0d1117] border border-gray-800 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-200">Auto-discovery Home Assistant</span>
                    <button type="button" onClick={() => setConfig(c => ({ ...c, discovery: !c.discovery }))}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                            config.discovery ? 'bg-teal-500' : 'bg-gray-700'
                        }`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-gray-100 shadow transition duration-200 ${
                            config.discovery ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                    </button>
                </div>
                <p className="text-xs text-gray-500">
                    Publie automatiquement les entités sur <code className="text-gray-400">homeassistant/sensor/logviewr_*/config</code> au démarrage.
                    Les sensors apparaissent sans configuration dans HA.
                </p>
            </div>

            {/* Stat selection */}
            <div>
                <p className="text-xs font-medium text-gray-400 mb-2">Données à publier</p>
                <div className="space-y-2">
                    {STAT_LABELS.map(s => (
                        <div key={s.key} className="flex items-center justify-between gap-3 cursor-pointer group"
                            role="button" tabIndex={0}
                            onClick={() => setStat(s.key, !config.stats[s.key])}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStat(s.key, !config.stats[s.key]); } }}>
                            <div>
                                <span className="text-sm text-gray-300 group-hover:text-gray-100 transition-colors">{s.label}</span>
                                <span className="text-xs text-gray-600 block">{s.desc}</span>
                            </div>
                            <button type="button"
                                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                                    config.stats[s.key] ? 'bg-teal-500' : 'bg-gray-700'
                                }`}>
                                <span className={`inline-block h-4 w-4 transform rounded-full bg-gray-100 shadow transition duration-200 ${
                                    config.stats[s.key] ? 'translate-x-4' : 'translate-x-0'
                                }`} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Feedback */}
            {msg && (
                <div className={`flex items-center gap-2 text-xs p-2.5 rounded-lg ${
                    msg.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                }`}>
                    {msg.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
                    {msg.text}
                </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
                <button onClick={test} disabled={testing || !config.broker}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-teal-700/50 text-teal-400 bg-teal-500/10 hover:bg-teal-500/20 disabled:opacity-40 transition-colors">
                    {testing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                    Tester la connexion
                </button>
                <button onClick={publishNow} disabled={publishing || !connected}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-cyan-700/50 text-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-40 transition-colors">
                    {publishing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                    Publier maintenant
                </button>
                <div className="flex-1" />
                <button onClick={save} disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 text-gray-100 disabled:opacity-40 transition-colors">
                    {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Enregistrer
                </button>
            </div>
        </div>
    );
};


