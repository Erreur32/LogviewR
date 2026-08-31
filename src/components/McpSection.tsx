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
import { Bot, Loader2, RefreshCw, CheckCircle, XCircle, AlertTriangle, Info, ShieldAlert, BookOpen, Key, Copy, Trash2, Globe } from 'lucide-react';
import { Section, SettingRow } from './SettingsSection';
import { api } from '../api/client';
import { useNotificationStore } from '../stores/notificationStore';

type McpSubTab = 'overview' | 'audit' | 'threats' | 'tokens';

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

type McpTokenScope = 'read' | 'read_write';

interface McpApiTokenRecord {
    id: number;
    name: string;
    tokenPrefix: string;
    scope: McpTokenScope;
    createdBy: string;
    createdAt: number;
    expiresAt: number;
    lastUsedAt: number | null;
    revokedAt: number | null;
}

interface McpHttpConfig {
    httpEnabled: boolean;
    allowedIps: string[];
}

const RESULT_BADGE: Record<string, { color: string; labelKey: string }> = {
    success: { color: 'bg-emerald-500/15 text-emerald-400 border-emerald-700/40', labelKey: 'mcp.audit.resultSuccess' },
    error: { color: 'bg-red-500/15 text-red-400 border-red-700/40', labelKey: 'mcp.audit.resultError' },
    rejected_unconfirmed: { color: 'bg-amber-500/15 text-amber-400 border-amber-700/40', labelKey: 'mcp.audit.resultRejectedUnconfirmed' },
    rejected_disabled: { color: 'bg-gray-500/15 text-gray-400 border-gray-700/40', labelKey: 'mcp.audit.resultRejectedDisabled' },
    rejected_rate_limited: { color: 'bg-orange-500/15 text-orange-400 border-orange-700/40', labelKey: 'mcp.audit.resultRejectedRateLimited' },
    rejected_insufficient_scope: { color: 'bg-pink-500/15 text-pink-400 border-pink-700/40', labelKey: 'mcp.audit.resultRejectedInsufficientScope' },
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
    const [httpConfig, setHttpConfig] = useState<McpHttpConfig | null>(null);
    const [httpSaving, setHttpSaving] = useState(false);
    const [allowlistDraft, setAllowlistDraft] = useState('');

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

    const loadHttpConfig = useCallback(async () => {
        try {
            const res = await api.get<McpHttpConfig>('/api/mcp/http-config');
            if (res.success && res.result) {
                setHttpConfig(res.result);
                setAllowlistDraft(res.result.allowedIps.join(', '));
            }
        } catch {
            addAction(t('mcp.loadError'), false);
        }
    }, [addAction, t]);

    useEffect(() => { loadStatus(); loadHttpConfig(); }, [loadStatus, loadHttpConfig]);

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

    const toggleHttpEnabled = async () => {
        if (!httpConfig) return;
        const next = !httpConfig.httpEnabled;
        setHttpSaving(true);
        try {
            const res = await api.post<McpHttpConfig>('/api/mcp/http-config', { httpEnabled: next });
            if (res.success && res.result) {
                setHttpConfig(res.result);
                addAction(t('mcp.saveSuccess'), true);
            } else {
                addAction(t('mcp.saveError'), false);
            }
        } catch {
            addAction(t('mcp.saveError'), false);
        } finally {
            setHttpSaving(false);
        }
    };

    const saveAllowlist = async () => {
        setHttpSaving(true);
        try {
            const ips = allowlistDraft.split(',').map((s) => s.trim()).filter(Boolean);
            const res = await api.post<McpHttpConfig>('/api/mcp/http-config', { allowedIps: ips });
            if (res.success && res.result) {
                setHttpConfig(res.result);
                setAllowlistDraft(res.result.allowedIps.join(', '));
                addAction(t('mcp.saveSuccess'), true);
            } else {
                addAction(t('mcp.saveError'), false);
            }
        } catch {
            addAction(t('mcp.saveError'), false);
        } finally {
            setHttpSaving(false);
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

                {!status?.enabled && (
                    <div className="mt-4 p-3 bg-amber-900/10 border border-amber-700/30 rounded-lg">
                        <div className="flex items-start gap-2">
                            <BookOpen size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                            <div className="space-y-2">
                                <p className="text-xs font-medium text-amber-300">{t('mcp.overview.enableGuideTitle')}</p>
                                <p className="text-xs text-gray-400">{t('mcp.overview.enableGuideIntro')}</p>
                                <p className="text-xs text-gray-400 whitespace-pre-line">{t('mcp.overview.enableGuideSteps')}</p>
                                <p className="text-xs text-gray-500 italic">{t('mcp.overview.enableGuideDocLink')}</p>
                            </div>
                        </div>
                    </div>
                )}
            </Section>

            <Section title={t('mcp.overview.httpTitle')} icon={Globe} iconColor="cyan">
                <div className="space-y-4">
                    <SettingRow
                        label={t('mcp.overview.httpEnabledLabel')}
                        description={t('mcp.overview.httpEnabledDesc')}
                    >
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                disabled={httpSaving || !httpConfig}
                                onClick={toggleHttpEnabled}
                                className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                                    httpConfig?.httpEnabled ? 'bg-cyan-500' : 'bg-gray-700'
                                }`}
                            >
                                <span
                                    className={`inline-block h-5 w-5 transform rounded-full bg-gray-100 shadow transition duration-200 ${
                                        httpConfig?.httpEnabled ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                />
                            </button>
                            <span className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full font-medium ${
                                httpConfig?.httpEnabled ? 'bg-emerald-500/15 text-emerald-400' : 'bg-gray-700/40 text-gray-500'
                            }`}>
                                {httpConfig?.httpEnabled ? <CheckCircle size={11} /> : <XCircle size={11} />}
                                {httpConfig?.httpEnabled ? t('mcp.overview.httpStatusEnabled') : t('mcp.overview.httpStatusDisabled')}
                            </span>
                        </div>
                    </SettingRow>

                    <SettingRow
                        label={t('mcp.overview.httpAllowlistLabel')}
                        description={t('mcp.overview.httpAllowlistDesc')}
                    >
                        <div className="flex items-center gap-2 w-full max-w-md">
                            <input
                                type="text"
                                value={allowlistDraft}
                                onChange={(e) => setAllowlistDraft(e.target.value)}
                                placeholder={t('mcp.overview.httpAllowlistPlaceholder')}
                                className="flex-1 px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs placeholder-gray-500 focus:outline-none focus:border-cyan-500"
                            />
                            <button
                                onClick={saveAllowlist}
                                disabled={httpSaving}
                                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                            >
                                {t('mcp.overview.httpAllowlistSave')}
                            </button>
                        </div>
                    </SettingRow>
                </div>

                {httpConfig?.httpEnabled && httpConfig.allowedIps.length === 0 && (
                    <div className="mt-4 p-3 bg-amber-900/10 border border-amber-700/30 rounded-lg">
                        <div className="flex items-start gap-2">
                            <AlertTriangle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-gray-400">{t('mcp.overview.httpAllowlistWarning')}</p>
                        </div>
                    </div>
                )}
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

const TokensTab: React.FC = () => {
    const { t } = useTranslation();
    const { addAction } = useNotificationStore();
    const [tokens, setTokens] = useState<McpApiTokenRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [scope, setScope] = useState<McpTokenScope>('read');
    const [expiresInDays, setExpiresInDays] = useState(90);
    const [newToken, setNewToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const loadTokens = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<{ tokens: McpApiTokenRecord[] }>('/api/mcp/tokens');
            if (res.success && res.result) setTokens(res.result.tokens);
        } catch {
            addAction(t('mcp.loadError'), false);
        } finally {
            setLoading(false);
        }
    }, [addAction, t]);

    useEffect(() => { loadTokens(); }, [loadTokens]);

    const createToken = async () => {
        if (!name.trim()) return;
        setCreating(true);
        try {
            const res = await api.post<{ token: McpApiTokenRecord & { token: string } }>('/api/mcp/tokens', {
                name: name.trim(),
                scope,
                expiresInDays,
            });
            if (res.success && res.result) {
                setNewToken(res.result.token.token);
                setName('');
                addAction(t('mcp.tokens.createSuccess'), true);
                loadTokens();
            } else {
                addAction(t('mcp.tokens.createError'), false);
            }
        } catch {
            addAction(t('mcp.tokens.createError'), false);
        } finally {
            setCreating(false);
        }
    };

    const revokeToken = async (id: number) => {
        try {
            const res = await api.delete<{ revoked: boolean }>(`/api/mcp/tokens/${id}`);
            if (res.success) {
                addAction(t('mcp.tokens.revokeSuccess'), true);
                loadTokens();
            } else {
                addAction(t('mcp.tokens.revokeError'), false);
            }
        } catch {
            addAction(t('mcp.tokens.revokeError'), false);
        }
    };

    const copyToken = () => {
        if (!newToken) return;
        navigator.clipboard.writeText(newToken);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const formatDate = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });

    return (
        <div className="space-y-6">
            <Section title={t('mcp.tokens.createTitle')} icon={Key} iconColor="violet">
                {newToken ? (
                    <div className="p-4 bg-emerald-900/10 border border-emerald-700/30 rounded-lg space-y-3">
                        <p className="text-xs font-medium text-emerald-300">{t('mcp.tokens.newTokenTitle')}</p>
                        <p className="text-xs text-gray-400">{t('mcp.tokens.newTokenWarning')}</p>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 px-3 py-2 bg-[#0d1117] border border-gray-700 rounded-lg text-xs text-emerald-300 font-mono break-all">
                                {newToken}
                            </code>
                            <button
                                onClick={copyToken}
                                className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors whitespace-nowrap"
                            >
                                <Copy size={12} />
                                {copied ? t('mcp.tokens.copied') : t('mcp.tokens.copyButton')}
                            </button>
                        </div>
                        <button
                            onClick={() => setNewToken(null)}
                            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors"
                        >
                            {t('mcp.tokens.doneButton')}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 flex-wrap">
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('mcp.tokens.namePlaceholder')}
                                className="w-48 px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs placeholder-gray-500 focus:outline-none focus:border-violet-500"
                            />
                            <select
                                value={scope}
                                onChange={(e) => setScope(e.target.value as McpTokenScope)}
                                className="px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:border-violet-500"
                            >
                                <option value="read">{t('mcp.tokens.scopeRead')}</option>
                                <option value="read_write">{t('mcp.tokens.scopeReadWrite')}</option>
                            </select>
                            <input
                                type="number"
                                min={1}
                                max={365}
                                value={expiresInDays}
                                onChange={(e) => setExpiresInDays(Number.parseInt(e.target.value, 10) || 90)}
                                className="w-24 px-3 py-1.5 bg-[#1a1a1a] border border-gray-700 rounded-lg text-white text-xs focus:outline-none focus:border-violet-500"
                            />
                            <span className="text-xs text-gray-500">{t('mcp.tokens.expiryLabel')}</span>
                            <button
                                onClick={createToken}
                                disabled={creating || !name.trim()}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                            >
                                {creating ? <Loader2 size={12} className="animate-spin" /> : <Key size={12} />}
                                {t('mcp.tokens.createButton')}
                            </button>
                        </div>
                        <p className="text-xs text-gray-500">{t('mcp.tokens.expiryDesc')}</p>
                    </div>
                )}
            </Section>

            <Section title={t('mcp.tokens.listTitle')} icon={Bot} iconColor="cyan">
                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 size={24} className="text-gray-400 animate-spin" />
                    </div>
                ) : tokens.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <Info size={28} className="mx-auto mb-2" />
                        <p className="text-sm">{t('mcp.tokens.empty')}</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {tokens.map((tok) => {
                            const isRevoked = tok.revokedAt !== null;
                            const isExpired = !isRevoked && tok.expiresAt < Date.now();
                            return (
                                <div key={tok.id} className="p-3 bg-[#1a1a1a] rounded-lg border border-gray-800 flex items-center justify-between gap-2 flex-wrap">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-medium text-white">{tok.name}</span>
                                            <code className="text-xs text-gray-500 font-mono">{tok.tokenPrefix}...</code>
                                            <span className={`text-xs px-2 py-0.5 rounded border ${
                                                tok.scope === 'read_write'
                                                    ? 'bg-amber-500/15 text-amber-400 border-amber-700/40'
                                                    : 'bg-gray-500/15 text-gray-400 border-gray-700/40'
                                            }`}>
                                                {tok.scope === 'read_write' ? t('mcp.tokens.scopeReadWrite') : t('mcp.tokens.scopeRead')}
                                            </span>
                                            {isRevoked && (
                                                <span className="text-xs px-2 py-0.5 rounded border bg-red-500/15 text-red-400 border-red-700/40">
                                                    {t('mcp.tokens.revoked')}
                                                </span>
                                            )}
                                            {isExpired && (
                                                <span className="text-xs px-2 py-0.5 rounded border bg-gray-500/15 text-gray-400 border-gray-700/40">
                                                    {t('mcp.tokens.expired')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">
                                            {t('mcp.tokens.columnExpires')}: {formatDate(tok.expiresAt)}
                                            {' · '}
                                            {t('mcp.tokens.columnLastUsed')}: {tok.lastUsedAt ? formatDate(tok.lastUsedAt) : t('mcp.tokens.lastUsedNever')}
                                        </div>
                                    </div>
                                    {!isRevoked && (
                                        <button
                                            onClick={() => revokeToken(tok.id)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/20 hover:bg-red-900/40 text-red-400 text-xs rounded-lg transition-colors border border-red-800/40"
                                        >
                                            <Trash2 size={12} />
                                            {t('mcp.tokens.revokeButton')}
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Section>
        </div>
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
        { id: 'tokens', label: t('mcp.subTabs.tokens') },
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
            {subTab === 'tokens' && <TokensTab />}
            {subTab === 'audit' && <AuditTab />}
            {subTab === 'threats' && <ThreatsTab />}
        </div>
    );
};
