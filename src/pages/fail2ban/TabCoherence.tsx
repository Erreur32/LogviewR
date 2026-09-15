import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, RefreshCw, AlertTriangle, AlertOctagon, Info, XCircle, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { card, cardH, cardB } from './helpers';
import { getCached, setCached } from './cacheUtils';

const C = {
    bg1: '#0d1117', bg2: '#161b22', bg3: '#21262d',
    border: '#30363d', text: '#e6edf3', muted: '#8b949e',
    green: '#3fb950', red: '#e86a65', orange: '#e3b341',
    blue: '#58a6ff', cyan: '#39c5cf', purple: '#bc8cff',
};

type IssueSeverity = 'critical' | 'warning' | 'info';
type IssueCategory = 'chain' | 'jump' | 'ipset' | 'orphan-ipset' | 'dangling-rule' | 'ip-mismatch' | 'unsupported';

interface FirewallIssue {
    id: string;
    severity: IssueSeverity;
    category: IssueCategory;
    jail?: string;
    message: string;
    fix?: string;
}

interface FirewallAuditResult {
    ok: boolean;
    generatedAt: number;
    jailsChecked: number;
    jailsSkipped: string[];
    issues: FirewallIssue[];
    summary: { critical: number; warning: number; info: number };
    error?: string;
}

const CACHE_KEY = 'firewall-audit';

const SEVERITY_STYLE: Record<IssueSeverity, { color: string; bg: string; border: string; icon: React.ReactNode }> = {
    critical: { color: C.red,    bg: 'rgba(232,106,101,.08)', border: 'rgba(232,106,101,.25)', icon: <AlertOctagon style={{ width: 13, height: 13 }} /> },
    warning:  { color: C.orange, bg: 'rgba(227,179,65,.08)',  border: 'rgba(227,179,65,.25)',  icon: <AlertTriangle style={{ width: 13, height: 13 }} /> },
    info:     { color: C.blue,   bg: 'rgba(88,166,255,.08)',  border: 'rgba(88,166,255,.25)',  icon: <Info style={{ width: 13, height: 13 }} /> },
};

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);
    return (
        <button
            onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
            title={t('fail2ban.coherence.copyFix')}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto',
                background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4,
                color: copied ? C.green : C.muted, fontSize: '.68rem', padding: '.15rem .4rem', cursor: 'pointer',
            }}
        >
            {copied ? <Check style={{ width: 10, height: 10 }} /> : <Copy style={{ width: 10, height: 10 }} />}
            {copied ? t('fail2ban.coherence.copied') : t('fail2ban.coherence.copy')}
        </button>
    );
};

const IssueRow: React.FC<{ issue: FirewallIssue }> = ({ issue }) => {
    const s = SEVERITY_STYLE[issue.severity];
    return (
        <div style={{ borderBottom: `1px solid ${C.border}`, padding: '.6rem 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.6rem' }}>
                <span style={{ color: s.color, marginTop: 2 }}>{s.icon}</span>
                <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                        {issue.jail && (
                            <span style={{ fontSize: '.68rem', fontWeight: 700, color: C.cyan, background: 'rgba(57,197,207,.1)', border: '1px solid rgba(57,197,207,.25)', borderRadius: 4, padding: '.05rem .4rem' }}>
                                {issue.jail}
                            </span>
                        )}
                        <span style={{ fontSize: '.68rem', color: s.color, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 600 }}>{issue.category}</span>
                    </div>
                    <div style={{ fontSize: '.82rem', color: C.text, marginTop: '.25rem', lineHeight: 1.5 }}>{issue.message}</div>
                    {issue.fix && (
                        <div style={{ marginTop: '.4rem', borderRadius: 4, border: `1px solid ${s.border}`, background: s.bg, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', padding: '.2rem .5rem', borderBottom: `1px solid ${s.border}` }}>
                                <CopyButton text={issue.fix} />
                            </div>
                            <pre style={{ margin: 0, fontSize: '.72rem', fontFamily: 'monospace', color: C.text, padding: '.4rem .6rem', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{issue.fix}</pre>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const SummaryChip: React.FC<{ label: string; count: number; color: string }> = ({ label, count, color }) => (
    <div style={{
        display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.5rem .8rem',
        borderRadius: 6, background: C.bg3, border: `1px solid ${C.border}`, flex: 1, minWidth: 120,
    }}>
        <span style={{ fontSize: '1.15rem', fontWeight: 700, color }}>{count}</span>
        <span style={{ fontSize: '.72rem', color: C.muted, textTransform: 'uppercase', letterSpacing: '.03em' }}>{label}</span>
    </div>
);

export const TabCoherence: React.FC = () => {
    const { t } = useTranslation();
    const [result, setResult] = useState<FirewallAuditResult | null>(() => getCached<FirewallAuditResult>(CACHE_KEY, 30_000));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [severityFilter, setSeverityFilter] = useState<IssueSeverity | 'all'>('all');

    const runAudit = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get<FirewallAuditResult>('/api/plugins/fail2ban/firewall-audit');
            if (res.success && res.result) {
                setResult(res.result);
                setCached(CACHE_KEY, res.result);
                if (!res.result.ok) setError(res.result.error ?? null);
            } else {
                setError(res.error?.message ?? t('fail2ban.coherence.loadError'));
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [t]);

    useEffect(() => {
        if (!result) runAudit();
    }, [result, runAudit]);

    const issues = result?.issues ?? [];
    const filtered = severityFilter === 'all' ? issues : issues.filter(i => i.severity === severityFilter);
    const allClear = result?.ok && issues.length === 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={card}>
                <div style={cardH}>
                    <ShieldCheck style={{ width: 14, height: 14, color: C.cyan }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{t('fail2ban.coherence.title')}</span>
                    <button
                        onClick={runAudit}
                        disabled={loading}
                        style={{
                            marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '.35rem',
                            background: C.bg2, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text,
                            fontSize: '.75rem', padding: '.3rem .7rem', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1,
                        }}
                    >
                        <RefreshCw style={{ width: 12, height: 12, animation: loading ? 'coherence-spin 1s linear infinite' : undefined }} />
                        {t('fail2ban.coherence.runAudit')}
                    </button>
                </div>
                <div style={cardB}>
                    <style>{`@keyframes coherence-spin { to { transform: rotate(360deg); } }`}</style>
                    <p style={{ margin: 0, fontSize: '.8rem', color: C.muted, lineHeight: 1.6 }}>
                        {t('fail2ban.coherence.description')}
                    </p>
                </div>
            </div>

            {error && !result?.issues.length && (
                <div style={{ ...card, borderColor: 'rgba(232,106,101,.35)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.9rem 1rem', color: C.red, fontSize: '.85rem' }}>
                        <XCircle style={{ width: 14, height: 14, flexShrink: 0 }} />
                        {error}
                    </div>
                </div>
            )}

            {result && (
                <>
                    <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                        <SummaryChip label={t('fail2ban.coherence.critical')} count={result.summary.critical} color={C.red} />
                        <SummaryChip label={t('fail2ban.coherence.warning')} count={result.summary.warning} color={C.orange} />
                        <SummaryChip label={t('fail2ban.coherence.info')} count={result.summary.info} color={C.blue} />
                        <SummaryChip label={t('fail2ban.coherence.jailsChecked')} count={result.jailsChecked} color={C.green} />
                    </div>

                    {result.jailsSkipped.length > 0 && (
                        <div style={{ fontSize: '.75rem', color: C.muted }}>
                            {t('fail2ban.coherence.jailsSkipped', { list: result.jailsSkipped.join(', ') })}
                        </div>
                    )}

                    {allClear ? (
                        <div style={{ ...card, borderColor: 'rgba(63,185,80,.3)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '1rem', color: C.green, fontSize: '.85rem' }}>
                                <ShieldCheck style={{ width: 16, height: 16, flexShrink: 0 }} />
                                {t('fail2ban.coherence.allClear')}
                            </div>
                        </div>
                    ) : issues.length > 0 && (
                        <div style={card}>
                            <div style={{ ...cardH, gap: '.4rem' }}>
                                <ShieldAlert style={{ width: 13, height: 13, color: C.orange }} />
                                <span style={{ fontWeight: 600, fontSize: '.85rem' }}>{t('fail2ban.coherence.issuesTitle')}</span>
                                <div style={{ marginLeft: 'auto', display: 'flex', gap: '.3rem' }}>
                                    {(['all', 'critical', 'warning', 'info'] as const).map(sev => (
                                        <button
                                            key={sev}
                                            onClick={() => setSeverityFilter(sev)}
                                            style={{
                                                fontSize: '.68rem', padding: '.2rem .5rem', borderRadius: 4, cursor: 'pointer',
                                                background: severityFilter === sev ? C.bg1 : 'transparent',
                                                border: `1px solid ${severityFilter === sev ? C.text : C.border}`,
                                                color: severityFilter === sev ? C.text : C.muted,
                                            }}
                                        >
                                            {sev === 'all' ? t('fail2ban.coherence.all') : t(`fail2ban.coherence.${sev}`)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div>
                                {filtered.map(issue => <IssueRow key={issue.id} issue={issue} />)}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
