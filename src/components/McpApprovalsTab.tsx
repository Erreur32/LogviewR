/**
 * MCP Approvals tab
 *
 * Human approval queue for MCP write actions (mcp_pending_actions). The agent
 * can only queue a request, approving it is only possible here, from an
 * admin session: an injected prompt in a log line cannot approve itself.
 * Approve runs the stored action server-side, after re-checking guardrails.
 */

import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldQuestion, Loader2, RefreshCw, Check, X, Info, AlertTriangle } from 'lucide-react';
import { Section } from './SettingsSection';
import { api } from '../api/client';
import { useNotificationStore } from '../stores/notificationStore';
import { usePolling } from '../hooks/usePolling';

type PendingStatus = 'pending' | 'executing' | 'executed' | 'failed' | 'rejected' | 'expired';

export interface McpPendingAction {
    id: number;
    toolName: string;
    params: { jail?: string; ip?: string; reason?: string };
    actor: string;
    status: PendingStatus;
    createdAt: number;
    expiresAt: number;
    decidedAt: number | null;
    decidedBy: string | null;
    resultMessage: string | null;
}

interface DecisionResult {
    ok: boolean;
    error?: string;
}

const STATUS_BADGE: Record<PendingStatus, string> = {
    pending: 'bg-amber-500/15 text-amber-400 border-amber-700/40',
    executing: 'bg-cyan-500/15 text-cyan-400 border-cyan-700/40',
    executed: 'bg-emerald-500/15 text-emerald-400 border-emerald-700/40',
    failed: 'bg-red-500/15 text-red-400 border-red-700/40',
    rejected: 'bg-gray-500/15 text-gray-400 border-gray-700/40',
    expired: 'bg-gray-500/15 text-gray-500 border-gray-700/40',
};

/** Weakening actions get a red frame: they are what an injected prompt would try to get approved. */
const WEAKENING_TOOLS = new Set(['f2b_unban_ip', 'f2b_jail_stop']);

const POLL_INTERVAL_MS = 15_000;

const formatDate = (ms: number) => new Date(ms).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
});

export const McpApprovalsTab: React.FC<{ onCountChange?: (count: number) => void }> = ({ onCountChange }) => {
    const { t } = useTranslation();
    const { addAction } = useNotificationStore();
    const [actions, setActions] = useState<McpPendingAction[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | null>(null);

    const load = useCallback(async () => {
        try {
            const res = await api.get<{ actions: McpPendingAction[]; pendingCount: number }>('/api/mcp/pending?limit=50');
            if (res.success && res.result) {
                setActions(res.result.actions);
                onCountChange?.(res.result.pendingCount);
            }
        } catch {
            addAction(t('mcp.loadError'), false);
        } finally {
            setLoading(false);
        }
    }, [addAction, t, onCountChange]);

    usePolling(load, { interval: POLL_INTERVAL_MS });

    const decide = async (id: number, decision: 'approve' | 'reject') => {
        setBusyId(id);
        try {
            const res = await api.post<DecisionResult>(`/api/mcp/pending/${id}/${decision}`, {});
            if (res.success && res.result?.ok) {
                addAction(t(decision === 'approve' ? 'mcp.approvals.approveSuccess' : 'mcp.approvals.rejectSuccess'), true);
            } else {
                addAction(`${t('mcp.approvals.decisionError')}${res.result?.error ? ` : ${res.result.error}` : ''}`, false);
            }
        } catch {
            addAction(t('mcp.approvals.decisionError'), false);
        } finally {
            setBusyId(null);
            load();
        }
    };

    const pending = actions.filter((a) => a.status === 'pending');
    const history = actions.filter((a) => a.status !== 'pending');

    const renderParams = (a: McpPendingAction) => (
        <div className="text-xs text-gray-300 font-mono mt-1 space-x-3">
            {a.params.jail && <span>{t('mcp.approvals.jail')}: <span className="text-white">{a.params.jail}</span></span>}
            {a.params.ip && <span>IP: <span className="text-white">{a.params.ip}</span></span>}
        </div>
    );

    return (
        <div className="space-y-6">
            <Section title={t('mcp.approvals.pendingTitle')} icon={ShieldQuestion} iconColor="amber">
                <div className="mb-4 p-3 bg-blue-900/10 border border-blue-700/30 rounded-lg flex items-start gap-2">
                    <Info size={14} className="text-blue-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-gray-400">{t('mcp.approvals.intro')}</p>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 size={24} className="text-gray-400 animate-spin" />
                    </div>
                ) : pending.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <Check size={28} className="text-green-400 mx-auto mb-2" />
                        <p className="text-sm">{t('mcp.approvals.empty')}</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {pending.map((a) => {
                            const weakening = WEAKENING_TOOLS.has(a.toolName);
                            return (
                                <div
                                    key={a.id}
                                    className={`p-3 rounded-lg border ${weakening ? 'bg-red-950/20 border-red-800/40' : 'bg-[#1a1a1a] border-gray-800'}`}
                                >
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <div className="flex items-center gap-2">
                                            {weakening && <AlertTriangle size={14} className="text-red-400" />}
                                            <span className="text-sm font-medium text-white font-mono">#{a.id} {a.toolName}</span>
                                            <span className="text-xs text-gray-500">{a.actor}</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => decide(a.id, 'approve')}
                                                disabled={busyId !== null}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700/30 hover:bg-emerald-700/50 text-emerald-300 text-xs rounded-lg border border-emerald-700/40 transition-colors disabled:opacity-50"
                                            >
                                                {busyId === a.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                {t('mcp.approvals.approve')}
                                            </button>
                                            <button
                                                onClick={() => decide(a.id, 'reject')}
                                                disabled={busyId !== null}
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/20 hover:bg-red-900/40 text-red-400 text-xs rounded-lg border border-red-800/40 transition-colors disabled:opacity-50"
                                            >
                                                <X size={12} />
                                                {t('mcp.approvals.reject')}
                                            </button>
                                        </div>
                                    </div>
                                    {renderParams(a)}
                                    {a.params.reason && (
                                        <div className="text-xs text-gray-400 mt-1">
                                            {t('mcp.approvals.reason')} <span className="italic">({t('mcp.approvals.reasonUntrusted')})</span> : {a.params.reason}
                                        </div>
                                    )}
                                    {weakening && <p className="text-xs text-red-300/80 mt-2">{t('mcp.approvals.weakeningWarning')}</p>}
                                    <div className="text-xs text-gray-500 mt-1">
                                        {formatDate(a.createdAt)} · {t('mcp.approvals.expiresAt', { time: formatDate(a.expiresAt) })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Section>

            <Section title={t('mcp.approvals.historyTitle')} icon={ShieldQuestion} iconColor="cyan">
                <div className="flex justify-end mb-3">
                    <button
                        onClick={load}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors"
                    >
                        <RefreshCw size={12} />
                        <span>{t('security.refresh')}</span>
                    </button>
                </div>
                {history.length === 0 ? (
                    <p className="text-center py-6 text-sm text-gray-500">{t('mcp.approvals.historyEmpty')}</p>
                ) : (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {history.map((a) => (
                            <div key={a.id} className="p-3 bg-[#1a1a1a] rounded-lg border border-gray-800">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span className="text-sm text-white font-mono">#{a.id} {a.toolName}</span>
                                    <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_BADGE[a.status]}`}>
                                        {t(`mcp.approvals.status.${a.status}`)}
                                    </span>
                                </div>
                                {renderParams(a)}
                                <div className="text-xs text-gray-500 mt-1">
                                    {a.actor}
                                    {a.decidedBy && ` · ${t('mcp.approvals.decidedBy', { user: a.decidedBy })}`}
                                    {a.decidedAt && ` · ${formatDate(a.decidedAt)}`}
                                </div>
                                {a.resultMessage && (
                                    <div className={`text-xs mt-1 ${a.status === 'failed' ? 'text-red-400' : 'text-gray-400'}`}>{a.resultMessage}</div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </Section>
        </div>
    );
};
