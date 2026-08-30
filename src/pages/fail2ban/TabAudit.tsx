import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, RefreshCw, AlertTriangle, Shield, Network, Layers, Database, Server, FileText, ChevronDown, ChevronRight, HardDrive, Cpu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { card, cardH, F2bTooltip, TT } from './helpers';
import { TabJailsFiles } from './TabJails';

// ── Couleurs ───────────────────────────────────────────────────────────────────
const C = {
    bg1: '#0d1117', bg2: '#161b22', bg3: '#21262d',
    border: '#30363d', text: '#e6edf3', muted: '#8b949e',
    green: '#3fb950', red: '#e86a65', orange: '#e3b341',
    blue: '#58a6ff', cyan: '#39c5cf', purple: '#bc8cff',
};

// ── Section header ────────────────────────────────────────────────────────────
const SectionHeader: React.FC<{ icon: React.ReactNode; label: string; color: string; sub?: string; avail?: boolean | null }> = ({ icon, label, color, sub, avail }) => {
    const { t } = useTranslation();
    return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
        <span style={{ color, display: 'flex', alignItems: 'center' }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: '.82rem', color, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</span>
        {sub && <span style={{ fontSize: '.73rem', color: C.muted }}>{sub}</span>}
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${color}44 0%, transparent 100%)` }} />
        {avail === true  && <span style={{ fontSize: '.67rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(63,185,80,.1)',    color: C.green, border: '1px solid rgba(63,185,80,.22)'    }}>{t('fail2ban.audit.accessible')}</span>}
        {avail === false && <span style={{ fontSize: '.67rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(232,106,101,.1)', color: C.red,   border: '1px solid rgba(232,106,101,.22)' }}>{t('fail2ban.audit.notAccessible')}</span>}
    </div>
    );
};

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckStatus = 'idle' | 'loading' | 'ok' | 'error';

interface F2bCheckResult {
    ok: boolean;
    checks: {
        socket:  { ok: boolean; fix?: string | null };
        client:  { ok: boolean; fix?: string | null };
        daemon:  { ok: boolean; fix?: string | null };
        sqlite:  { ok: boolean; fix?: string | null };
        dropin:  { ok: boolean; fix?: string | null };
    };
}

interface FwCheck {
    label: string;
    key: 'iptables' | 'ipset' | 'nftables';
    icon: React.ReactNode;
    color: string;
    route: string;
    detail: string;
    fix: string;
}

interface AppAuditResult {
    ok: boolean;
    dashboardDb:  { exists: boolean; readable: boolean; writable: boolean; size: string; path: string };
    dataDir:      { exists: boolean; writable: boolean; path: string };
    backupDir:    { ok: boolean; path: string };
    socket:       { exists: boolean; writable: boolean; path: string };
    fail2banDb:   { exists: boolean; readable: boolean; path: string };
    configFiles:  { jailLocal: boolean; fail2banConf: boolean };
    process:      { pid: number; uptime: number; memRssMB: number; memHeapMB: number; nodeVersion: string; platform: string; arch: string };
}

// ── Data ──────────────────────────────────────────────────────────────────────

const fwChecks = (t: (k: string) => string): FwCheck[] => [
    {
        label: 'IPTables',
        key: 'iptables',
        icon: <Shield style={{ width: 13, height: 13 }} />,
        color: C.blue,
        route: '/api/plugins/fail2ban/iptables',
        detail: t('fail2ban.audit.fwIptablesDetail'),
        fix: t('fail2ban.audit.requiresNetAdmin'),
    },
    {
        label: 'IPSet',
        key: 'ipset',
        icon: <Layers style={{ width: 13, height: 13 }} />,
        color: C.purple,
        route: '/api/plugins/fail2ban/ipset/info',
        detail: t('fail2ban.audit.fwIpsetDetail'),
        fix: t('fail2ban.audit.requiresNetAdmin'),
    },
    {
        label: 'NFTables',
        key: 'nftables',
        icon: <Network style={{ width: 13, height: 13 }} />,
        color: C.cyan,
        route: '/api/plugins/fail2ban/nftables',
        detail: t('fail2ban.audit.fwNftablesDetail'),
        fix: t('fail2ban.audit.requiresNetAdmin'),
    },
];

const SETUP_SCRIPT = 'curl -fsSL https://raw.githubusercontent.com/Erreur32/LogviewR/main/scripts/setup-fail2ban-access.sh | sudo bash';

const dockerPrereq = (t: (k: string) => string) => `# docker-compose.yml
network_mode: host    # ${t('fail2ban.audit.dockerPrereqComment1')}
cap_add:
  - NET_ADMIN         # ${t('fail2ban.audit.dockerPrereqComment2')}`;

// ── Sub-components ────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: CheckStatus }> = ({ status }) => {
    const { t } = useTranslation();
    if (status === 'loading') return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.muted }}>
            <RefreshCw style={{ width: 10, height: 10, animation: 'spin 1s linear infinite' }} /> {t('fail2ban.audit.checking')}
        </span>
    );
    if (status === 'ok') return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}>
            <CheckCircle style={{ width: 10, height: 10 }} /> {t('fail2ban.audit.ok')}
        </span>
    );
    if (status === 'error') return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}>
            <XCircle style={{ width: 10, height: 10 }} /> {t('fail2ban.audit.error')}
        </span>
    );
    return null;
};


const CheckRow: React.FC<{ ok: boolean; label: string; detail?: string; fix?: string | null; icon?: React.ReactNode }> = ({ ok, label, detail, fix, icon }) => {
    const { t } = useTranslation();
    return (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.5rem 1rem' }}>
            <span style={{ color: ok ? C.green : C.red, display: 'flex' }}>{icon ?? (ok ? <CheckCircle style={{ width: 12, height: 12 }} /> : <XCircle style={{ width: 12, height: 12 }} />)}</span>
            <span style={{ fontWeight: 600, fontSize: '.82rem', color: C.text, minWidth: 130 }}>{label}</span>
            {detail && <span style={{ fontSize: '.73rem', color: C.muted }}>{detail}</span>}
            <span style={{ marginLeft: 'auto' }}>
                {ok
                    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.green }}><CheckCircle style={{ width: 11, height: 11 }} /> {t('fail2ban.audit.ok')}</span>
                    : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.red }}><XCircle style={{ width: 11, height: 11 }} /> {t('fail2ban.audit.error')}</span>}
            </span>
        </div>
        {!ok && fix && (
            <div style={{ padding: '0 1rem .7rem 2.6rem' }}>
                <pre style={{ margin: 0, fontSize: '.72rem', fontFamily: 'monospace', color: C.orange, background: 'rgba(227,179,65,.06)', borderRadius: 4, padding: '.35rem .6rem', border: '1px solid rgba(227,179,65,.2)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{fix}</pre>
            </div>
        )}
    </div>
    );
};

const Chevron: React.FC<{ open: boolean }> = ({ open }) =>
    open ? <ChevronDown style={{ width: 13, height: 13, color: C.muted }} />
         : <ChevronRight style={{ width: 13, height: 13, color: C.muted }} />;

function fmtUptime(s: number): string {
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const TabAudit: React.FC = () => {
    const { t } = useTranslation();
    const FW_CHECKS = fwChecks(t);
    // Fail2ban service check
    const [f2bStatus,  setF2bStatus]  = useState<CheckStatus>('idle');
    const [f2bResult,  setF2bResult]  = useState<F2bCheckResult | null>(null);
    const [openF2b,    setOpenF2b]    = useState(false);

    // Firewall checks
    const [fwStatuses, setFwStatuses] = useState<Record<string, CheckStatus>>({});
    const [fwErrors,   setFwErrors]   = useState<Record<string, string>>({});
    const [fwLoading,  setFwLoading]  = useState(false);
    const [openFw,     setOpenFw]     = useState(false);

    // App audit
    const [appAudit,        setAppAudit]        = useState<AppAuditResult | null>(null);
    const [appAuditLoading, setAppAuditLoading] = useState(false);
    const [openAppAudit,    setOpenAppAudit]     = useState(false);

    // Log access check
    const [logAvail, setLogAvail] = useState<boolean | null>(null);
    const [openLog,  setOpenLog]  = useState(false);

    const checkF2b = useCallback(async () => {
        setF2bStatus('loading');
        try {
            const res = await api.get<F2bCheckResult>('/api/plugins/fail2ban/check');
            if (res.success && res.result) {
                setF2bResult(res.result);
                setF2bStatus(res.result.ok ? 'ok' : 'error');
                if (!res.result.ok) setOpenF2b(true);
            } else {
                setF2bStatus('error');
                setOpenF2b(true);
            }
        } catch {
            setF2bStatus('error');
            setOpenF2b(true);
        }
    }, []);

    const checkFirewall = useCallback(async () => {
        setFwLoading(true);
        setFwStatuses({ iptables: 'loading', ipset: 'loading', nftables: 'loading' });
        setFwErrors({});
        const results = await Promise.all(
            FW_CHECKS.map(async c => {
                try {
                    const res = await api.get<{ ok: boolean; error?: string }>(c.route);
                    const ok = res.success && res.result?.ok === true;
                    return { key: c.key, status: ok ? 'ok' : 'error', error: res.result?.error ?? res.error?.message ?? '' };
                } catch (e) {
                    return { key: c.key, status: 'error', error: e instanceof Error ? e.message : String(e) };
                }
            })
        );
        const statuses: Record<string, CheckStatus> = {};
        const errors: Record<string, string> = {};
        for (const r of results) {
            statuses[r.key] = r.status as CheckStatus;
            if (r.error) errors[r.key] = r.error;
        }
        setFwStatuses(statuses);
        setFwErrors(errors);
        setFwLoading(false);
        const anyErr = results.some(r => r.status === 'error');
        if (anyErr) setOpenFw(true);
    }, []);

    const checkAppAudit = useCallback(async () => {
        setAppAuditLoading(true);
        try {
            const res = await api.get<AppAuditResult>('/api/plugins/fail2ban/app-audit');
            if (res.success && res.result) {
                setAppAudit(res.result);
                if (!res.result.ok) setOpenAppAudit(true);
            }
        } catch {
            setOpenAppAudit(true);
        } finally {
            setAppAuditLoading(false);
        }
    }, []);

    useEffect(() => {
        checkF2b();
        checkFirewall();
        checkAppAudit();
        api.get<{ ok: boolean; files?: string[] }>('/api/plugins/fail2ban/logs')
            .then(r => setLogAvail(r.success && r.result?.ok === true && (r.result.files?.length ?? 0) > 0))
            .catch(() => setLogAvail(false));
    }, [checkF2b, checkFirewall, checkAppAudit]);

    const allFwOk  = FW_CHECKS.every(c => fwStatuses[c.key] === 'ok');
    const anyFwErr = FW_CHECKS.some(c => fwStatuses[c.key] === 'error');
    const anyFwLoading = FW_CHECKS.some(c => fwStatuses[c.key] === 'loading') || fwLoading;

    const f2bChecks: { key: string; label: string; icon: React.ReactNode; ok: boolean; fix?: string | null }[] = f2bResult ? [
        { key: 'daemon', label: t('fail2ban.audit.checkDaemon'),    icon: <Server   style={{ width: 12, height: 12 }} />,   ok: f2bResult.checks.daemon.ok, fix: f2bResult.checks.daemon.fix },
        { key: 'client', label: t('fail2ban.audit.checkClient'),    icon: <FileText style={{ width: 12, height: 12 }} />,   ok: f2bResult.checks.client.ok, fix: f2bResult.checks.client.fix },
        { key: 'socket', label: t('fail2ban.audit.checkSocket'),    icon: <Shield   style={{ width: 12, height: 12 }} />,   ok: f2bResult.checks.socket.ok, fix: f2bResult.checks.socket.fix },
        { key: 'sqlite', label: t('fail2ban.audit.checkSqlite'),    icon: <Database style={{ width: 12, height: 12 }} />,   ok: f2bResult.checks.sqlite.ok, fix: f2bResult.checks.sqlite.fix },
        { key: 'dropin', label: t('fail2ban.audit.checkDropin'),    icon: <Shield   style={{ width: 12, height: 12 }} />,   ok: f2bResult.checks.dropin.ok, fix: f2bResult.checks.dropin.fix },
    ] : [];

    const anyF2bErr = f2bChecks.some(c => !c.ok);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

            {/* ══ Section : Service Fail2ban ════════════════════════════════════ */}
            <SectionHeader icon={<Shield style={{ width: 13, height: 13 }} />} label={t('fail2ban.audit.sectionService')} color={C.blue} sub={t('fail2ban.audit.sectionServiceSub')} />

            <div style={{ ...card, borderColor: anyF2bErr ? 'rgba(232,106,101,.35)' : C.border }}>
                <div style={{ ...cardH, cursor: 'pointer' }} onClick={() => setOpenF2b(o => !o)}>
                    <Shield style={{ width: 14, height: 14, color: C.blue }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{t('fail2ban.audit.f2bChecksTitle')}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {f2bStatus === 'loading' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.muted }}>
                                <RefreshCw style={{ width: 10, height: 10, animation: 'spin 1s linear infinite' }} /> {t('fail2ban.audit.checking')}
                            </span>
                        )}
                        {f2bStatus === 'ok' && (
                            <F2bTooltip color="green" title={t('fail2ban.audit.f2bTtOkTitle')} width={320} bodyNode={<>
                                {TT.section(t('fail2ban.audit.ttChecksPerformed'), C.green)}
                                {TT.ok(t('fail2ban.audit.ttDaemonActive'))}
                                {TT.ok(t('fail2ban.audit.ttSocketRw'))}
                                {TT.ok(t('fail2ban.audit.ttSqliteReadable'))}
                                {TT.ok(t('fail2ban.audit.ttDropinPlaced'))}
                                {TT.sep()}
                                {TT.info(t('fail2ban.audit.ttAllPrereqOk'))}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}>
                                    <CheckCircle style={{ width: 10, height: 10 }} /> {t('fail2ban.audit.ok')}
                                </span>
                            </F2bTooltip>
                        )}
                        {f2bStatus === 'error' && (
                            <F2bTooltip color="red" title={t('fail2ban.audit.f2bTtErrTitle')} width={320} bodyNode={<>
                                {TT.section(t('fail2ban.audit.ttCheck'), C.red)}
                                {TT.err(t('fail2ban.audit.ttDaemonErr'))}
                                {TT.err(t('fail2ban.audit.ttSocketErr'))}
                                {TT.err(t('fail2ban.audit.ttSqliteErr'))}
                                {TT.err(t('fail2ban.audit.ttDropinErr'))}
                                {TT.sep()}
                                {TT.info(t('fail2ban.audit.ttOpenForDetail'))}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}>
                                    <XCircle style={{ width: 10, height: 10 }} /> {t('fail2ban.audit.error')}
                                </span>
                            </F2bTooltip>
                        )}
                        <Chevron open={openF2b} />
                    </span>
                </div>

                {openF2b && <>
                    {f2bStatus === 'loading' && (
                        <div style={{ padding: '.75rem 1rem', color: C.muted, fontSize: '.8rem' }}>{t('fail2ban.audit.checkingInProgress')}</div>
                    )}

                    {f2bChecks.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingTop: '.4rem' }}>
                            {f2bChecks.map(c => (
                                <CheckRow key={c.key} ok={c.ok} label={c.label} icon={c.icon} fix={c.fix} />
                            ))}
                        </div>
                    )}

                    {anyF2bErr && (
                        <div style={{ margin: '.75rem 1rem 1rem', borderRadius: 6, border: '1px solid rgba(88,166,255,.25)', background: 'rgba(88,166,255,.05)', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem .75rem', background: 'rgba(88,166,255,.08)', borderBottom: '1px solid rgba(88,166,255,.2)' }}>
                                <AlertTriangle style={{ width: 11, height: 11, color: C.blue }} />
                                <span style={{ fontWeight: 600, fontSize: '.8rem', color: C.blue }}>{t('fail2ban.audit.quickSetupScript')}</span>
                            </div>
                            <div style={{ padding: '.55rem .85rem' }}>
                                <pre style={{ margin: 0, fontSize: '.72rem', fontFamily: 'monospace', color: C.cyan, background: C.bg1, borderRadius: 4, padding: '.35rem .6rem', border: `1px solid ${C.border}` }}>{SETUP_SCRIPT}</pre>
                            </div>
                        </div>
                    )}
                </>}
            </div>

            {/* ══ Section : Pare-feu — Netfilter ════════════════════════════════ */}
            <SectionHeader icon={<Layers style={{ width: 13, height: 13 }} />} label={t('fail2ban.audit.sectionFirewall')} color={C.cyan} sub={t('fail2ban.audit.sectionFirewallSub')} />

            <div style={{ ...card, borderColor: anyFwErr ? 'rgba(232,106,101,.35)' : C.border }}>
                <div style={{ ...cardH, cursor: 'pointer' }} onClick={() => setOpenFw(o => !o)}>
                    <Layers style={{ width: 14, height: 14, color: C.cyan }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{t('fail2ban.audit.fwCardTitle')}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {anyFwLoading ? (
                            <span style={{ fontSize: '.72rem', color: C.muted, display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                <RefreshCw style={{ width: 11, height: 11, animation: 'spin 1s linear infinite' }} /> {t('fail2ban.audit.checking')}
                            </span>
                        ) : allFwOk ? (
                            <F2bTooltip color="green" title={t('fail2ban.audit.fwTtOkTitle')} width={340} bodyNode={<>
                                {TT.section(t('fail2ban.audit.ttToolsAccessible'), C.green)}
                                {TT.ok(t('fail2ban.audit.ttIptablesRw'))}
                                {TT.ok(t('fail2ban.audit.ttIpsetRw'))}
                                {TT.ok(t('fail2ban.audit.ttNftablesRw'))}
                                {TT.sep()}
                                {TT.info(t('fail2ban.audit.ttRequiresHostNet'))}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}>
                                    <CheckCircle style={{ width: 10, height: 10 }} /> {t('fail2ban.audit.ok')}
                                </span>
                            </F2bTooltip>
                        ) : anyFwErr ? (
                            <F2bTooltip color="orange" title={t('fail2ban.audit.fwTtErrTitle')} width={360} bodyNode={<>
                                {TT.section(t('fail2ban.audit.ttMissingPrereq'), C.orange)}
                                {TT.warn(t('fail2ban.audit.ttNetHostWarn'))}
                                {TT.warn(t('fail2ban.audit.ttNetAdminWarn'))}
                                {TT.sep()}
                                {TT.section(t('fail2ban.audit.ttImpact'))}
                                {TT.info(t('fail2ban.audit.ttTabsImpact'))}
                                {TT.info(t('fail2ban.audit.ttTabsImpact2'))}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}>
                                    <AlertTriangle style={{ width: 10, height: 10 }} /> {t('fail2ban.audit.notAvailable')}
                                </span>
                            </F2bTooltip>
                        ) : null}
                        <Chevron open={openFw} />
                    </span>
                </div>

                {openFw && <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingTop: '.4rem' }}>
                        {FW_CHECKS.map((c, i) => {
                            const st  = fwStatuses[c.key] ?? 'idle';
                            const err = fwErrors[c.key] ?? '';
                            const isOk      = st === 'ok';
                            const isErr     = st === 'error';
                            const isLoading = st === 'loading';
                            return (
                                <div key={c.key} style={{ borderBottom: i < FW_CHECKS.length - 1 ? `1px solid ${C.border}` : undefined }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.55rem 1rem' }}>
                                        <span style={{ color: c.color }}>{c.icon}</span>
                                        <span style={{ fontWeight: 600, fontSize: '.85rem', color: C.text, minWidth: 72 }}>{c.label}</span>
                                        <span style={{ fontSize: '.75rem', color: C.muted }}>{c.detail}</span>
                                        <span style={{ marginLeft: 'auto' }}>
                                            {isLoading ? (
                                                <RefreshCw style={{ width: 12, height: 12, color: C.muted, animation: 'spin 1s linear infinite' }} />
                                            ) : isOk ? (
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.green }}>
                                                    <CheckCircle style={{ width: 11, height: 11 }} /> {t('fail2ban.audit.accessible')}
                                                </span>
                                            ) : isErr ? (
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.red }}>
                                                    <XCircle style={{ width: 11, height: 11 }} /> {t('fail2ban.audit.notAccessible')}
                                                </span>
                                            ) : null}
                                        </span>
                                    </div>
                                    {isErr && (
                                        <div style={{ padding: '0 1rem .65rem 2.6rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                                            {err && (
                                                <div style={{ fontSize: '.72rem', color: C.orange, background: 'rgba(227,179,65,.06)', border: '1px solid rgba(227,179,65,.2)', borderRadius: 4, padding: '.3rem .6rem', fontFamily: 'monospace' }}>{err}</div>
                                            )}
                                            <div style={{ fontSize: '.72rem', color: C.muted }}>{c.fix}</div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {anyFwErr && !anyFwLoading && (
                        <div style={{ margin: '.75rem 1rem 1rem', borderRadius: 6, border: '1px solid rgba(88,166,255,.25)', background: 'rgba(88,166,255,.05)', overflow: 'hidden' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem .75rem', background: 'rgba(88,166,255,.08)', borderBottom: '1px solid rgba(88,166,255,.2)' }}>
                                <AlertTriangle style={{ width: 11, height: 11, color: C.blue }} />
                                <span style={{ fontWeight: 600, fontSize: '.8rem', color: C.blue }}>{t('fail2ban.audit.dockerPrereq')}</span>
                                <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: C.muted }}>{t('fail2ban.audit.dockerPrereqHint')}</span>
                            </div>
                            <pre style={{ margin: 0, fontSize: '.72rem', fontFamily: 'monospace', color: C.text, lineHeight: 1.6, padding: '.6rem .85rem', whiteSpace: 'pre-wrap' }}>{dockerPrereq(t)}</pre>
                        </div>
                    )}
                </>}
            </div>

            {/* ══ Section : Application LogviewR ═══════════════════════════════ */}
            <SectionHeader icon={<HardDrive style={{ width: 13, height: 13 }} />} label={t('fail2ban.audit.sectionApp')} color={C.purple} sub={t('fail2ban.audit.sectionAppSub')} />

            <div style={{ ...card, borderColor: (appAudit && !appAudit.ok) ? 'rgba(232,106,101,.35)' : C.border }}>
                <div style={{ ...cardH, cursor: 'pointer' }} onClick={() => setOpenAppAudit(o => !o)}>
                    <HardDrive style={{ width: 14, height: 14, color: C.purple }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{t('fail2ban.audit.appHealthTitle')}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {appAuditLoading ? (
                            <span style={{ fontSize: '.72rem', color: C.muted, display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                <RefreshCw style={{ width: 11, height: 11, animation: 'spin 1s linear infinite' }} /> {t('fail2ban.audit.checking')}
                            </span>
                        ) : appAudit ? (
                            appAudit.ok
                                ? <F2bTooltip color="purple" title={t('fail2ban.audit.appTtOkTitle')} width={360} bodyNode={<>
                                    {TT.section(t('fail2ban.audit.ttDatabase'), C.cyan)}
                                    {TT.ok(t('fail2ban.audit.ttDbReadOk'))}
                                    {TT.ok(t('fail2ban.audit.ttDbWriteOk'))}
                                    {TT.ok(t('fail2ban.audit.ttDataDirOk'))}
                                    {TT.sep()}
                                    {TT.section('Fail2ban')}
                                    {TT.ok(t('fail2ban.audit.ttSocketOk'))}
                                    {TT.ok(t('fail2ban.audit.ttSqliteOk'))}
                                    {TT.sep()}
                                    {TT.section(t('fail2ban.audit.ttConfiguration'))}
                                    {TT.ok(t('fail2ban.audit.ttF2bConfOk'))}
                                    {TT.ok(t('fail2ban.audit.ttJailLocalOk'))}
                                  </>}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}><CheckCircle style={{ width: 10, height: 10 }} /> {t('fail2ban.audit.ok')}</span>
                                  </F2bTooltip>
                                : <F2bTooltip color="red" title={t('fail2ban.audit.appTtErrTitle')} width={360} bodyNode={<>
                                    {TT.section(t('fail2ban.audit.ttCheck'), C.red)}
                                    {TT.err(t('fail2ban.audit.ttDbRights'))}
                                    {TT.err(t('fail2ban.audit.ttDataDirWritable'))}
                                    {TT.err(t('fail2ban.audit.ttSocketAvailable'))}
                                    {TT.err(t('fail2ban.audit.ttConfigReadable'))}
                                    {TT.sep()}
                                    {TT.info(t('fail2ban.audit.ttOpenForFullDetail'))}
                                  </>}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}><XCircle style={{ width: 10, height: 10 }} /> {t('fail2ban.audit.error')}</span>
                                  </F2bTooltip>
                        ) : null}
                        <Chevron open={openAppAudit} />
                    </span>
                </div>

                {openAppAudit && appAudit && (
                    <div style={{ paddingTop: '.4rem' }}>
                        {/* Fichiers & droits */}
                        {[
                            { label: t('fail2ban.audit.fileDbRead'),    ok: appAudit.dashboardDb.readable, detail: appAudit.dashboardDb.path, icon: <Database style={{ width: 12, height: 12 }} />,   fix: t('fail2ban.audit.fixDbRead') },
                            { label: t('fail2ban.audit.fileDbWrite'),   ok: appAudit.dashboardDb.writable, detail: appAudit.dashboardDb.size, icon: <Database style={{ width: 12, height: 12 }} />,   fix: t('fail2ban.audit.fixDbWrite') },
                            { label: t('fail2ban.audit.fileDataDir'),   ok: appAudit.dataDir.writable,     detail: appAudit.dataDir.path,     icon: <HardDrive style={{ width: 12, height: 12 }} />,  fix: t('fail2ban.audit.fixDataDir') },
                            { label: t('fail2ban.audit.fileBackups'),   ok: appAudit.backupDir.ok,          detail: appAudit.backupDir.path,   icon: <HardDrive style={{ width: 12, height: 12 }} />,  fix: t('fail2ban.audit.fixBackups') },
                            { label: t('fail2ban.audit.fileSocket'),    ok: appAudit.socket.writable,       detail: appAudit.socket.path,      icon: <Shield style={{ width: 12, height: 12 }} />,     fix: t('fail2ban.audit.fixSocket') },
                            { label: t('fail2ban.audit.fileFail2banDb'), ok: appAudit.fail2banDb.readable,  detail: appAudit.fail2banDb.path,  icon: <Database style={{ width: 12, height: 12 }} />,   fix: t('fail2ban.audit.fixFail2banDb') },
                            { label: t('fail2ban.audit.fileF2bConf'),   ok: appAudit.configFiles.fail2banConf, detail: '/etc/fail2ban/fail2ban.conf', icon: <FileText style={{ width: 12, height: 12 }} />, fix: t('fail2ban.audit.fixMountEtc') },
                            { label: t('fail2ban.audit.fileJailLocal'), ok: appAudit.configFiles.jailLocal, detail: '/etc/fail2ban/jail.local', icon: <FileText style={{ width: 12, height: 12 }} />,  fix: t('fail2ban.audit.fixMountEtc') },
                        ].map(c => (
                            <CheckRow key={c.label} ok={c.ok} label={c.label} detail={c.detail} icon={c.icon} fix={c.fix} />
                        ))}

                        {/* Process info */}
                        <div style={{ padding: '.75rem 1rem .5rem', borderTop: `1px solid ${C.border}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.55rem' }}>
                                <Cpu style={{ width: 12, height: 12, color: C.cyan }} />
                                <span style={{ fontSize: '.78rem', fontWeight: 600, color: C.cyan, textTransform: 'uppercase', letterSpacing: '.03em' }}>{t('fail2ban.audit.nodeProcess')}</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.45rem' }}>
                                {[
                                    { l: 'PID',       v: String(appAudit.process.pid),          c: C.muted   },
                                    { l: t('fail2ban.audit.procUptime'),    v: fmtUptime(appAudit.process.uptime),    c: C.green   },
                                    { l: t('fail2ban.audit.procMemRss'),   v: `${appAudit.process.memRssMB} Mo`,     c: C.blue    },
                                    { l: t('fail2ban.audit.procHeap'),     v: `${appAudit.process.memHeapMB} Mo`,    c: C.purple  },
                                    { l: 'Node',      v: appAudit.process.nodeVersion,          c: C.muted   },
                                    { l: 'OS',        v: appAudit.process.platform,             c: C.muted   },
                                    { l: 'Arch',      v: appAudit.process.arch,                 c: C.muted   },
                                ].map(s => (
                                    <div key={s.l} style={{ background: C.bg2, borderRadius: 5, padding: '.4rem .45rem', textAlign: 'center', border: `1px solid ${C.border}` }}>
                                        <div style={{ fontSize: '.82rem', fontWeight: 700, color: s.c, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.v}</div>
                                        <div style={{ fontSize: '.58rem', color: C.muted, textTransform: 'uppercase', marginTop: 2, letterSpacing: '.04em' }}>{s.l}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {openAppAudit && !appAudit && !appAuditLoading && (
                    <div style={{ padding: '1rem', fontSize: '.82rem', color: C.red }}>{t('fail2ban.audit.auditLoadError')}</div>
                )}
            </div>

            {/* ══ Section : Fail2ban service log ════════════════════════════════ */}
            <SectionHeader icon={<FileText style={{ width: 13, height: 13 }} />} label="Fail2ban service log" color={C.muted} />

            <div style={card}>
                <div style={{ ...cardH, cursor: 'pointer' }} onClick={() => setOpenLog(o => !o)}>
                    <FileText style={{ width: 14, height: 14, color: C.muted }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>{t('fail2ban.audit.logFiles')}</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {logAvail === true && (
                            <F2bTooltip color="green" title={t('fail2ban.audit.logTtOkTitle')} width={340} bodyNode={<>
                                {TT.section(t('fail2ban.audit.ttFilesDetected'), C.green)}
                                {TT.ok(t('fail2ban.audit.ttLogReadable'))}
                                {TT.sep()}
                                {TT.section(t('fail2ban.audit.ttActiveFeatures'))}
                                {TT.info(t('fail2ban.audit.ttRealtimeEvents'))}
                                {TT.info(t('fail2ban.audit.ttTabsActive'))}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}>
                                    <CheckCircle style={{ width: 10, height: 10 }} /> {t('fail2ban.audit.ok')}
                                </span>
                            </F2bTooltip>
                        )}
                        {logAvail === false && (
                            <F2bTooltip color="red" title={t('fail2ban.audit.logTtErrTitle')} width={360} bodyNode={<>
                                {TT.section(t('fail2ban.audit.ttProblemDetected'), C.red)}
                                {TT.err(t('fail2ban.audit.ttNoLogFound'))}
                                {TT.err(t('fail2ban.audit.ttLogNotReadable'))}
                                {TT.sep()}
                                {TT.section(t('fail2ban.audit.ttCorrection'))}
                                {TT.warn(t('fail2ban.audit.ttMountVarLog'))}
                                {TT.info(t('fail2ban.audit.ttVolumesLine'))}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}>
                                    <XCircle style={{ width: 10, height: 10 }} /> {t('fail2ban.audit.notAccessible')}
                                </span>
                            </F2bTooltip>
                        )}
                        <Chevron open={openLog} />
                    </span>
                </div>
                {openLog && (
                    <div style={{ paddingTop: '.5rem' }}>
                        <TabJailsFiles />
                    </div>
                )}
            </div>
        </div>
    );
};
