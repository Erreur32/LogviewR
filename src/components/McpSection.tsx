/**
 * MCP Section
 *
 * Admin panel for LogviewR's MCP (Model Context Protocol) server: enable
 * toggle, derived status/heartbeat, audit trail viewer, active threats.
 *
 * The MCP process itself is a separate stdio process launched by the user's
 * MCP client (Claude Code/Desktop) — this panel can only flip the
 * `mcp_enabled` flag it polls per tool-call and read the shared SQLite
 * state it also writes to (mcp_action_audit, mcp_last_seen).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Loader2, RefreshCw, CheckCircle, XCircle, AlertTriangle, Info, ShieldAlert } from 'lucide-react';
import { Section, SettingRow } from './SettingsSection';
import { api } from '../api/client';
import { useNotificationStore } from '../stores/notificationStore';

type McpSubTab = 'overview' | 'audit' | 'threats';

interface McpStatus {
    enabled: boolean;
    lastSeenAt: number | null;
    total: number;
    success: number;
    error: number;
    rejectedUnconfirmed: number;
}

interface McpAuditEntry {
    id: number;
    actor: string;
    toolName: string;
    params: unknown;
    confirmed: boolean;
    result: string;
    errorMessage?: string | null;
    createdAt: number;
}

interface McpThreatCluster {
    type: string;
    ips: string[];
    jails: string[];
    org?: string;
    severity?: string;
    [key: string]: unknown;
}

const RESULT_BADGE: Record<string, { color: string; labelKey: string }> = {
    success: { color: 'bg-emerald-500/15 text-emerald-400 border-emerald-700/40', labelKey: 'mcp.audit.resultSuccess' },
    error: { color: 'bg-red-500/15 text-red-400 border-red-700/40', labelKey: 'mcp.audit.resultError' },
    rejected_unconfirmed: { color: 'bg-amber-500/15 text-amber-400 border-amber-700/40', labelKey: 'mcp.audit.resultRejectedUnconfirmed' },
    rejected_disabled: { color: 'bg-gray-500/15 text-gray-400 border-gray-700/40', labelKey: 'mcp.audit.resultRejectedDisabled' },
    rejected_rate_limited: { color: 'bg-orange-500/15 text-orange-400 border-orange-700/40', labelKey: 'mcp.audit.resultRejectedRateLimited' },
    dry_run: { color: 'bg-cyan-500/15 text-cyan-400 border-cyan-700/40', labelKey: 'mcp.audit.resultDryRun' },
};

function formatRelative(t: (key: string, opts?: Record<string, unknown>) => string, ms: number | null): string {
    if (!ms) return t('mcp.overview.lastSeenNever');
    const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (diffSec < 5) return t('fail2ban.timeAgo.now');
    if (diffSec < 60) return t('fail2ban.timeAgo.secondsAgo', { count: diffSec });
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return t('fail2ban.timeAgo.minutesAgo', { count: diffMin });
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return t('fail2ban.timeAgo.hoursAgo', { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    return t('fail2ban.timeAgo.daysAgo', { count: diffDays });
}

const OverviewTab: React.FC = () => {
    const { t } = useTranslation();
    const { addAction } = useNotificationStore();
    const [status, setStatus] = useState<McpStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadStatus = useCallback(async () => {
        try {
            const res = await api.get<McpStatus>('/api/mcp/status');
            if (res.success && res.result) setStatus(res.result);
        } catch {
            addAction(t('mcp.loadError'), false);
        } finally {
            setLoading(false);
        }
    }, [addAction, t]);

    useEffect(() => { loadStatus(); }, [loadStatus]);

    const toggleEnabled = async () => {
        if (!status) return;
        const next = !status.enabled;
        setSaving(true);
        try {
            const res = await api.post<{ enabled: boolean }>('/api/mcp/config', { enabled: next });
            if (res.success) {
                setStatus(s => (s ? { ...s, enabled: next } : s));
                addAction(t('mcp.saveSuccess'), true);
            } else {
                addAction(t('mcp.saveError'), false);
            }
        } catch {
            addAction(t('mcp.saveError'), false);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-gray-500 text-sm py-6">
                <Loader2 size={14} className="animate-spin" /> {t('common.loading')}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <Section title={t('mcp.overview.statusTitle')} icon={Bot} iconColor="violet">
                <div className="space-y-4">
                    <SettingRow
                        label={t('mcp.overview.enabledLabel')}
                        description={t('mcp.overview.enabledDesc')}
                    >
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                disabled={saving}
                                onClick={toggleEnabled}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                                    status?.enabled ? 'bg-violet-500' : 'bg-gray-700'
                                }`}
                            >
                                <span
                                    className={`inline-block h-5 w-5 transform rounded-full bg-gray-100 shadow transition duration-200 ${
                                        status?.enabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                            <span className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium ${
                                status?.enabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-700/40 text-gray-500'
                            }`}>
                                {status?.enabled ? <CheckCircle size={11} /> : <XCircle size={11} />}
                                {status?.enabled ? t('mcp.overview.statusEnabled') : t('mcp.overview.statusDisabled')}
                            </span>
                        </div>
                    </SettingRow>

                    <SettingRow
                        label={t('mcp.overview.lastSeenLabel')}
                        description={undefined}
                    >
                        <span className="text-sm text-gray-300 font-mono">
                            {formatRelative(t, status?.lastSeenAt ?? null)}
                        </span>
                    </SettingRow>
                </div>

                <div className="mt-4 p-3 bg-blue-900/10 border border-blue-700/30 rounded-lg">
                    <div className="flex items-start gap-2">
                        <Info size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-gray-400">{t('mcp.overview.architectureNote')}</p>
                    </div>
                </div>
            </Section>

            <Section title={t('mcp.overview.statsTitle')} icon={ShieldAlert} iconColor="cyan">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-[#1a1a1a] border border-gray-800 rounded-lg text-center">
                        <div className="text-lg font-semibold text-white">{status?.total ?? 0}</div>
                        <div className="text-xs text-gray-500 mt-1">{t('mcp.overview.statsTotal')}</div>
                    </div>
                    <div className="p-3 bg-[#1a1a1a] border border-gray-800 rounded-lg text-center">
                        <div className="text-lg font-semibold text-emerald-400">{status?.success ?? 0}</div>
                        <div className="text-xs text-gray-500 mt-1">{t('mcp.overview.statsSuccess')}</div>
                    </div>
                    <div className="p-3 bg-[#1a1a1a] border border-gray-800 rounded-lg text-center">
                        <div className="text-lg font-semibold text-red-400">{status?.error ?? 0}</div>
                        <div className="text-xs text-gray-500 mt-1">{t('mcp.overview.statsError')}</div>
                    </div>
                    <div className="p-3 bg-[#1a1a1a] border border-gray-800 rounded-lg text-center">
                        <div className="text-lg font-semibold text-amber-400">{status?.rejectedUnconfirmed ?? 0}</div>
                        <div className="text-xs text-gray-500 mt-1">{t('mcp.overview.statsRejected')}</div>
                    </div>
                </div>
                <div className="flex justify-end pt-3">
                    <button
                        onClick={loadStatus}
                        className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors"
                    >
                        <RefreshCw size={12} />
                        <span>{t('security.refresh')}</span>
                    </button>
                </div>
            </Section>
        </div>
    );
};

const AuditTab: React.FC = () => {
    const { t } = useTranslation();
    const { addAction } = useNotificationStore();
    const [entries, setEntries] = useState<McpAuditEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [toolName, setToolName] = useState('');
    const [actor, setActor] = useState('');
    const [result, setResult] = useState('');
    const [limit, setLimit] = useState(50);

    const loadAudit = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: String(limit), offset: '0' });
            if (toolName) params.append('toolName', toolName);
            if (actor) params.append('actor', actor);
            if (result) params.append('result', result);
            const res = await api.get<{ entries: McpAuditEntry[]; total: number }>(`/api/mcp/audit?${params}`);
            if (res.success && res.result) {
                setEntries(res.result.entries);
                setTotal(res.result.total);
            }
        } catch {
            addAction(t('mcp.loadError'), false);
        } finally {
            setLoading(false);
        }
    }, [limit, toolName, actor, result, addAction, t]);

    useEffect(() => { loadAudit(); }, [loadAudit]);

    const formatDate = (ms: number) => new Date(ms).toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    return (
        <Section title={t('mcp.audit.title')} icon={Bot} iconColor="violet">
            <div className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                    <input
                        type="text"
                        value={toolName}
                        onChange={(e) => setToolName(e.target.value)}
                        placeholder={t('mcp.audit.filterTool')}
                        className="w-40 px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs placeholder-gray-500 focus:outline-none focus:border-violet-500"
                    />
                    <input
                        type="text"
                        value={actor}
                        onChange={(e) => setActor(e.target.value)}
                        placeholder={t('mcp.audit.filterActor')}
                        className="w-40 px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs placeholder-gray-500 focus:outline-none focus:border-violet-500"
                    />
                    <select
                        value={result}
                        onChange={(e) => setResult(e.target.value)}
                        className="px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:border-violet-500"
                    >
                        <option value="">{t('mcp.audit.allResults')}</option>
                        {Object.keys(RESULT_BADGE).map((key) => (
                            <option key={key} value={key}>{t(RESULT_BADGE[key].labelKey)}</option>
                        ))}
                    </select>
                    <button
                        onClick={loadAudit}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                    >
                        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                        <span>{t('security.refresh')}</span>
                    </button>
                    <span className="text-xs text-gray-500 ml-auto">{total}</span>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 size={24} className="text-gray-400 animate-spin" />
                    </div>
                ) : entries.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <Info size={28} className="mx-auto mb-2" />
                        <p className="text-sm">{t('mcp.audit.empty')}</p>
                    </div>
                ) : (
                    <div className="space-y-2 max-h-[500px] overflow-y-auto">
                        {entries.map((entry) => {
                            const badge = RESULT_BADGE[entry.result] ?? RESULT_BADGE.error;
                            return (
                                <div key={entry.id} className="p-3 bg-[#1a1a1a] rounded-lg border border-gray-800">
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-white font-mono">{entry.toolName}</span>
                                            <span className="text-xs text-gray-500">{entry.actor}</span>
                                        </div>
                                        <span className={`text-xs px-2 py-0.5 rounded border ${badge.color}`}>
                                            {t(badge.labelKey)}
                                        </span>
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">{formatDate(entry.createdAt)}</div>
                                    {entry.errorMessage && (
                                        <div className="text-xs text-red-400 mt-1">{entry.errorMessage}</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}

                {entries.length > 0 && entries.length < total && (
                    <div className="flex justify-center pt-2">
                        <button
                            onClick={() => setLimit(l => l + 50)}
                            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 rounded-lg text-white transition-colors"
                        >
                            {t('mcp.audit.loadMore')}
                        </button>
                    </div>
                )}
            </div>
        </Section>
    );
};

const ThreatsTab: React.FC = () => {
    const { t } = useTranslation();
    const { addAction } = useNotificationStore();
    const [clusters, setClusters] = useState<McpThreatCluster[]>([]);
    const [loading, setLoading] = useState(true);
    const [windowHours, setWindowHours] = useState(6);

    const loadThreats = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<{ clusters: McpThreatCluster[] }>(`/api/mcp/threats?windowHours=${windowHours}`);
            if (res.success && res.result) setClusters(res.result.clusters);
        } catch {
            addAction(t('mcp.loadError'), false);
        } finally {
            setLoading(false);
        }
    }, [windowHours, addAction, t]);

    useEffect(() => { loadThreats(); }, [loadThreats]);

    return (
        <Section title={t('mcp.threats.title')} icon={ShieldAlert} iconColor="red">
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{t('mcp.threats.windowLabel')}</span>
                    <select
                        value={windowHours}
                        onChange={(e) => setWindowHours(Number.parseInt(e.target.value, 10) || 6)}
                        className="px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:border-red-500"
                    >
                        {[1, 6, 12, 24, 48].map((h) => (
                            <option key={h} value={h}>{h}h</option>
                        ))}
                    </select>
                    <button
                        onClick={loadThreats}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors disabled:opacity-50 ml-auto"
                    >
                        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                        <span>{t('security.refresh')}</span>
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 size={24} className="text-gray-400 animate-spin" />
                    </div>
                ) : clusters.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <CheckCircle size={28} className="text-green-400 mx-auto mb-2" />
                        <p className="text-sm">{t('mcp.threats.empty')}</p>
                    </div>
                ) : (
                    <div className="space-y-2 max-h-[500px] overflow-y-auto">
                        {clusters.map((cluster, idx) => (
                            <div key={idx} className="p-3 bg-red-950/20 rounded-lg border border-red-800/40">
                                <div className="flex items-center gap-2 mb-1">
                                    <AlertTriangle size={14} className="text-red-400" />
                                    <span className="text-sm font-medium text-red-300">{cluster.type}</span>
                                    {cluster.org && (
                                        <span className="text-xs px-2 py-0.5 bg-red-900/30 text-red-400 rounded">
                                            {cluster.org}
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-gray-400">
                                    {t('mcp.threats.ipsLabel')}: {cluster.ips.join(', ')}
                                </div>
                                {cluster.jails.length > 0 && (
                                    <div className="text-xs text-gray-500 mt-0.5">
                                        {t('mcp.threats.jailsLabel')}: {cluster.jails.join(', ')}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Section>
    );
};

export const McpSection: React.FC = () => {
    const { t } = useTranslation();
    const [subTab, setSubTab] = useState<McpSubTab>('overview');

    const tabs: { id: McpSubTab; label: string }[] = [
        { id: 'overview', label: t('mcp.subTabs.overview') },
        { id: 'audit', label: t('mcp.subTabs.audit') },
        { id: 'threats', label: t('mcp.subTabs.threats') },
    ];

    return (
        <div className="space-y-4">
            <div className="flex gap-1 p-1 bg-[#111] border border-gray-800 rounded-lg w-fit">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setSubTab(tab.id)}
                        className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                            subTab === tab.id
                                ? 'bg-violet-500/15 border border-violet-500/40 text-violet-300'
                                : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {subTab === 'overview' && <OverviewTab />}
            {subTab === 'audit' && <AuditTab />}
            {subTab === 'threats' && <ThreatsTab />}
        </div>
    );
};
