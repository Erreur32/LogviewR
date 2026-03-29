import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, RefreshCw, AlertTriangle, Shield, Network, Layers, Database, Server, FileText, ChevronDown, ChevronRight, HardDrive, Cpu } from 'lucide-react';
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
const SectionHeader: React.FC<{ icon: React.ReactNode; label: string; color: string; sub?: string; avail?: boolean | null }> = ({ icon, label, color, sub, avail }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
        <span style={{ color, display: 'flex', alignItems: 'center' }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: '.82rem', color, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</span>
        {sub && <span style={{ fontSize: '.73rem', color: C.muted }}>{sub}</span>}
        <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${color}44 0%, transparent 100%)` }} />
        {avail === true  && <span style={{ fontSize: '.67rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(63,185,80,.1)',    color: C.green, border: '1px solid rgba(63,185,80,.22)'    }}>Accessible</span>}
        {avail === false && <span style={{ fontSize: '.67rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(232,106,101,.1)', color: C.red,   border: '1px solid rgba(232,106,101,.22)' }}>Non accessible</span>}
    </div>
);

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

const FW_CHECKS: FwCheck[] = [
    {
        label: 'IPTables',
        key: 'iptables',
        icon: <Shield style={{ width: 13, height: 13 }} />,
        color: C.blue,
        route: '/api/plugins/fail2ban/iptables',
        detail: 'Règles netfilter via iptables-save',
        fix: 'Requiert NET_ADMIN + network_mode: host dans docker-compose.yml',
    },
    {
        label: 'IPSet',
        key: 'ipset',
        icon: <Layers style={{ width: 13, height: 13 }} />,
        color: C.purple,
        route: '/api/plugins/fail2ban/ipset/info',
        detail: 'Sets netfilter (blacklist, f2b-*, etc.)',
        fix: 'Requiert NET_ADMIN + network_mode: host dans docker-compose.yml',
    },
    {
        label: 'NFTables',
        key: 'nftables',
        icon: <Network style={{ width: 13, height: 13 }} />,
        color: C.cyan,
        route: '/api/plugins/fail2ban/nftables',
        detail: 'Ruleset nftables du host',
        fix: 'Requiert NET_ADMIN + network_mode: host dans docker-compose.yml',
    },
];

const SETUP_SCRIPT = 'curl -fsSL https://raw.githubusercontent.com/Erreur32/LogviewR/main/scripts/setup-fail2ban-access.sh | sudo bash';

const DOCKER_PREREQ = `# docker-compose.yml
network_mode: host    # partage le namespace réseau du host
cap_add:
  - NET_ADMIN         # accès aux opérations netfilter kernel`;

// ── Sub-components ────────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: CheckStatus }> = ({ status }) => {
    if (status === 'loading') return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.muted }}>
            <RefreshCw style={{ width: 10, height: 10, animation: 'spin 1s linear infinite' }} /> Vérification…
        </span>
    );
    if (status === 'ok') return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}>
            <CheckCircle style={{ width: 10, height: 10 }} /> OK
        </span>
    );
    if (status === 'error') return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}>
            <XCircle style={{ width: 10, height: 10 }} /> Erreur
        </span>
    );
    return null;
};


const CheckRow: React.FC<{ ok: boolean; label: string; detail?: string; fix?: string | null; icon?: React.ReactNode }> = ({ ok, label, detail, fix, icon }) => (
    <div style={{ borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.5rem 1rem' }}>
            <span style={{ color: ok ? C.green : C.red, display: 'flex' }}>{icon ?? (ok ? <CheckCircle style={{ width: 12, height: 12 }} /> : <XCircle style={{ width: 12, height: 12 }} />)}</span>
            <span style={{ fontWeight: 600, fontSize: '.82rem', color: C.text, minWidth: 130 }}>{label}</span>
            {detail && <span style={{ fontSize: '.73rem', color: C.muted }}>{detail}</span>}
            <span style={{ marginLeft: 'auto' }}>
                {ok
                    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.green }}><CheckCircle style={{ width: 11, height: 11 }} /> OK</span>
                    : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.red }}><XCircle style={{ width: 11, height: 11 }} /> Erreur</span>}
            </span>
        </div>
        {!ok && fix && (
            <div style={{ padding: '0 1rem .7rem 2.6rem' }}>
                <pre style={{ margin: 0, fontSize: '.72rem', fontFamily: 'monospace', color: C.orange, background: 'rgba(227,179,65,.06)', borderRadius: 4, padding: '.35rem .6rem', border: '1px solid rgba(227,179,65,.2)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{fix}</pre>
            </div>
        )}
    </div>
);

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
                const allOk = Object.values(res.result.checks ?? {}).every(c => c.ok);
                setF2bStatus(allOk ? 'ok' : 'error');
                if (!allOk) setOpenF2b(true);
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
        { key: 'daemon', label: 'Daemon fail2ban', icon: <Server style={{ width: 12, height: 12 }} />,   ok: f2bResult.checks.daemon.ok, fix: f2bResult.checks.daemon.fix },
        { key: 'socket', label: 'Socket Unix',     icon: <Shield style={{ width: 12, height: 12 }} />,   ok: f2bResult.checks.socket.ok, fix: f2bResult.checks.socket.fix },
        { key: 'sqlite', label: 'Base SQLite',     icon: <Database style={{ width: 12, height: 12 }} />, ok: f2bResult.checks.sqlite.ok, fix: f2bResult.checks.sqlite.fix },
        { key: 'dropin', label: 'Drop-in systemd', icon: <Shield style={{ width: 12, height: 12 }} />,   ok: f2bResult.checks.dropin.ok, fix: f2bResult.checks.dropin.fix },
    ] : [];

    const anyF2bErr = f2bChecks.some(c => !c.ok);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

            {/* ══ Section : Service Fail2ban ════════════════════════════════════ */}
            <SectionHeader icon={<Shield style={{ width: 13, height: 13 }} />} label="Service Fail2ban" color={C.blue} sub="socket · daemon · SQLite" />

            <div style={{ ...card, borderColor: anyF2bErr ? 'rgba(232,106,101,.35)' : C.border }}>
                <div style={{ ...cardH, cursor: 'pointer' }} onClick={() => setOpenF2b(o => !o)}>
                    <Shield style={{ width: 14, height: 14, color: C.blue }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Fail2ban — Vérifications</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {f2bStatus === 'loading' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.muted }}>
                                <RefreshCw style={{ width: 10, height: 10, animation: 'spin 1s linear infinite' }} /> Vérification…
                            </span>
                        )}
                        {f2bStatus === 'ok' && (
                            <F2bTooltip color="green" title="Service fail2ban — OK" width={320} bodyNode={<>
                                {TT.section('Checks effectués', C.green)}
                                {TT.ok('Daemon fail2ban actif (systemd)')}
                                {TT.ok('Socket Unix accessible en lecture/écriture')}
                                {TT.ok('Base SQLite lisible')}
                                {TT.ok('Drop-in systemd en place')}
                                {TT.sep()}
                                {TT.info('Tous les prérequis sont satisfaits.')}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}>
                                    <CheckCircle style={{ width: 10, height: 10 }} /> OK
                                </span>
                            </F2bTooltip>
                        )}
                        {f2bStatus === 'error' && (
                            <F2bTooltip color="red" title="Service fail2ban — Erreur" width={320} bodyNode={<>
                                {TT.section('Vérifiez', C.red)}
                                {TT.err('Daemon fail2ban (systemctl status fail2ban)')}
                                {TT.err('Socket Unix /var/run/fail2ban/fail2ban.sock')}
                                {TT.err('Droits SQLite (chmod o+r fail2ban.sqlite3)')}
                                {TT.err('Drop-in systemd (voir script ci-dessous)')}
                                {TT.sep()}
                                {TT.info('Ouvrez ce cadre pour le détail et le script.')}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}>
                                    <XCircle style={{ width: 10, height: 10 }} /> Erreur
                                </span>
                            </F2bTooltip>
                        )}
                        <Chevron open={openF2b} />
                    </span>
                </div>

                {openF2b && <>
                    {f2bStatus === 'loading' && (
                        <div style={{ padding: '.75rem 1rem', color: C.muted, fontSize: '.8rem' }}>Vérification en cours…</div>
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
                                <span style={{ fontWeight: 600, fontSize: '.8rem', color: C.blue }}>Script de configuration rapide</span>
                            </div>
                            <div style={{ padding: '.55rem .85rem' }}>
                                <pre style={{ margin: 0, fontSize: '.72rem', fontFamily: 'monospace', color: C.cyan, background: C.bg1, borderRadius: 4, padding: '.35rem .6rem', border: `1px solid ${C.border}` }}>{SETUP_SCRIPT}</pre>
                            </div>
                        </div>
                    )}
                </>}
            </div>

            {/* ══ Section : Pare-feu — Netfilter ════════════════════════════════ */}
            <SectionHeader icon={<Layers style={{ width: 13, height: 13 }} />} label="Pare-feu — Netfilter" color={C.cyan} sub="IPTables · IPSet · NFTables" />

            <div style={{ ...card, borderColor: anyFwErr ? 'rgba(232,106,101,.35)' : C.border }}>
                <div style={{ ...cardH, cursor: 'pointer' }} onClick={() => setOpenFw(o => !o)}>
                    <Layers style={{ width: 14, height: 14, color: C.cyan }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>IPTables · IPSet · NFTables</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {anyFwLoading ? (
                            <span style={{ fontSize: '.72rem', color: C.muted, display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                <RefreshCw style={{ width: 11, height: 11, animation: 'spin 1s linear infinite' }} /> Vérification…
                            </span>
                        ) : allFwOk ? (
                            <F2bTooltip color="green" title="Pare-feu Netfilter — OK" width={340} bodyNode={<>
                                {TT.section('Outils accessibles', C.green)}
                                {TT.ok('IPTables  —  règles netfilter via iptables-save')}
                                {TT.ok('IPSet     —  sets blacklist / f2b-*')}
                                {TT.ok('NFTables  —  ruleset nftables du host')}
                                {TT.sep()}
                                {TT.info('Requiert : network_mode: host + NET_ADMIN')}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}>
                                    <CheckCircle style={{ width: 10, height: 10 }} /> OK
                                </span>
                            </F2bTooltip>
                        ) : anyFwErr ? (
                            <F2bTooltip color="orange" title="Pare-feu Netfilter — Non disponible" width={360} bodyNode={<>
                                {TT.section('Prérequis manquants', C.orange)}
                                {TT.warn('network_mode: host  dans docker-compose.yml')}
                                {TT.warn('cap_add: [ NET_ADMIN ]  dans docker-compose.yml')}
                                {TT.sep()}
                                {TT.section('Impact')}
                                {TT.info('Les onglets IPTables / IPSet / NFTables')}
                                {TT.info('seront vides ou partiellement disponibles.')}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}>
                                    <AlertTriangle style={{ width: 10, height: 10 }} /> Non disponible
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
                                                    <CheckCircle style={{ width: 11, height: 11 }} /> Accessible
                                                </span>
                                            ) : isErr ? (
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.red }}>
                                                    <XCircle style={{ width: 11, height: 11 }} /> Non disponible
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
                                <span style={{ fontWeight: 600, fontSize: '.8rem', color: C.blue }}>Prérequis Docker</span>
                                <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: C.muted }}>requis pour les onglets Pare-feu</span>
                            </div>
                            <pre style={{ margin: 0, fontSize: '.72rem', fontFamily: 'monospace', color: C.text, lineHeight: 1.6, padding: '.6rem .85rem', whiteSpace: 'pre-wrap' }}>{DOCKER_PREREQ}</pre>
                        </div>
                    )}
                </>}
            </div>

            {/* ══ Section : Application LogviewR ═══════════════════════════════ */}
            <SectionHeader icon={<HardDrive style={{ width: 13, height: 13 }} />} label="Application LogviewR" color={C.purple} sub="BDD · droits · process" />

            <div style={{ ...card, borderColor: (appAudit && !appAudit.ok) ? 'rgba(232,106,101,.35)' : C.border }}>
                <div style={{ ...cardH, cursor: 'pointer' }} onClick={() => setOpenAppAudit(o => !o)}>
                    <HardDrive style={{ width: 14, height: 14, color: C.purple }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Santé application</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {appAuditLoading ? (
                            <span style={{ fontSize: '.72rem', color: C.muted, display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                <RefreshCw style={{ width: 11, height: 11, animation: 'spin 1s linear infinite' }} /> Vérification…
                            </span>
                        ) : appAudit ? (
                            appAudit.ok
                                ? <F2bTooltip color="purple" title="Santé application — OK" width={360} bodyNode={<>
                                    {TT.section('Base de données', C.cyan)}
                                    {TT.ok('dashboard.db  —  lecture OK')}
                                    {TT.ok('dashboard.db  —  écriture OK')}
                                    {TT.ok('Répertoire data/  —  accessible')}
                                    {TT.sep()}
                                    {TT.section('Fail2ban')}
                                    {TT.ok('Socket Unix  —  accessible')}
                                    {TT.ok('fail2ban.sqlite3  —  lisible')}
                                    {TT.sep()}
                                    {TT.section('Configuration')}
                                    {TT.ok('fail2ban.conf  —  lisible')}
                                    {TT.ok('jail.local  —  lisible')}
                                  </>}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}><CheckCircle style={{ width: 10, height: 10 }} /> OK</span>
                                  </F2bTooltip>
                                : <F2bTooltip color="red" title="Santé application — Erreur" width={360} bodyNode={<>
                                    {TT.section('Vérifiez', C.red)}
                                    {TT.err('Droits sur data/dashboard.db (lecture/écriture)')}
                                    {TT.err('Répertoire data/ accessible en écriture')}
                                    {TT.err('Socket fail2ban.sock disponible')}
                                    {TT.err('Fichiers de config /etc/fail2ban/ lisibles')}
                                    {TT.sep()}
                                    {TT.info('Ouvrez ce cadre pour le détail complet.')}
                                  </>}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}><XCircle style={{ width: 10, height: 10 }} /> Erreur</span>
                                  </F2bTooltip>
                        ) : null}
                        <Chevron open={openAppAudit} />
                    </span>
                </div>

                {openAppAudit && appAudit && (
                    <div style={{ paddingTop: '.4rem' }}>
                        {/* Fichiers & droits */}
                        {[
                            { label: 'dashboard.db (lecture)',  ok: appAudit.dashboardDb.readable, detail: appAudit.dashboardDb.path, icon: <Database style={{ width: 12, height: 12 }} />,   fix: 'Vérifiez les droits : chmod 644 data/dashboard.db' },
                            { label: 'dashboard.db (écriture)', ok: appAudit.dashboardDb.writable, detail: appAudit.dashboardDb.size, icon: <Database style={{ width: 12, height: 12 }} />,   fix: 'Vérifiez les droits : chmod 664 data/dashboard.db' },
                            { label: 'Répertoire data/',        ok: appAudit.dataDir.writable,     detail: appAudit.dataDir.path,     icon: <HardDrive style={{ width: 12, height: 12 }} />,  fix: 'Vérifiez les droits : chmod 755 data/' },
                            { label: 'Répertoire backups',      ok: appAudit.backupDir.ok,          detail: appAudit.backupDir.path,   icon: <HardDrive style={{ width: 12, height: 12 }} />,  fix: 'Créez le répertoire : mkdir -p data/iptables-backups' },
                            { label: 'Socket fail2ban',         ok: appAudit.socket.writable,       detail: appAudit.socket.path,      icon: <Shield style={{ width: 12, height: 12 }} />,     fix: 'chmod 660 /var/run/fail2ban/fail2ban.sock' },
                            { label: 'fail2ban.sqlite3',        ok: appAudit.fail2banDb.readable,   detail: appAudit.fail2banDb.path,  icon: <Database style={{ width: 12, height: 12 }} />,   fix: 'chmod o+r /var/lib/fail2ban/fail2ban.sqlite3' },
                            { label: 'fail2ban.conf',           ok: appAudit.configFiles.fail2banConf, detail: '/etc/fail2ban/fail2ban.conf', icon: <FileText style={{ width: 12, height: 12 }} />, fix: 'Montez /etc/fail2ban en lecture dans docker-compose.yml' },
                            { label: 'jail.local',              ok: appAudit.configFiles.jailLocal, detail: '/etc/fail2ban/jail.local', icon: <FileText style={{ width: 12, height: 12 }} />,  fix: 'Montez /etc/fail2ban en lecture dans docker-compose.yml' },
                        ].map(c => (
                            <CheckRow key={c.label} ok={c.ok} label={c.label} detail={c.detail} icon={c.icon} fix={c.fix} />
                        ))}

                        {/* Process info */}
                        <div style={{ padding: '.75rem 1rem .5rem', borderTop: `1px solid ${C.border}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: '.55rem' }}>
                                <Cpu style={{ width: 12, height: 12, color: C.cyan }} />
                                <span style={{ fontSize: '.78rem', fontWeight: 600, color: C.cyan, textTransform: 'uppercase', letterSpacing: '.03em' }}>Processus Node.js</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.45rem' }}>
                                {[
                                    { l: 'PID',       v: String(appAudit.process.pid),          c: C.muted   },
                                    { l: 'Uptime',    v: fmtUptime(appAudit.process.uptime),    c: C.green   },
                                    { l: 'Mém. RSS',  v: `${appAudit.process.memRssMB} Mo`,     c: C.blue    },
                                    { l: 'Heap',      v: `${appAudit.process.memHeapMB} Mo`,    c: C.purple  },
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
                    <div style={{ padding: '1rem', fontSize: '.82rem', color: C.red }}>Impossible de charger les données d'audit.</div>
                )}
            </div>

            {/* ══ Section : Fail2ban service log ════════════════════════════════ */}
            <SectionHeader icon={<FileText style={{ width: 13, height: 13 }} />} label="Fail2ban service log" color={C.muted} />

            <div style={card}>
                <div style={{ ...cardH, cursor: 'pointer' }} onClick={() => setOpenLog(o => !o)}>
                    <FileText style={{ width: 14, height: 14, color: C.muted }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Fichiers de log</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {logAvail === true && (
                            <F2bTooltip color="green" title="Fichiers de log — OK" width={340} bodyNode={<>
                                {TT.section('Fichiers détectés', C.green)}
                                {TT.ok('/var/log/fail2ban.log  —  lisible')}
                                {TT.sep()}
                                {TT.section('Fonctionnalités actives')}
                                {TT.info('Lecture en temps réel des événements fail2ban')}
                                {TT.info('Onglets Logs et Historique pleinement actifs')}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}>
                                    <CheckCircle style={{ width: 10, height: 10 }} /> OK
                                </span>
                            </F2bTooltip>
                        )}
                        {logAvail === false && (
                            <F2bTooltip color="red" title="Fichiers de log — Non accessible" width={360} bodyNode={<>
                                {TT.section('Problème détecté', C.red)}
                                {TT.err('Aucun fichier de log fail2ban trouvé')}
                                {TT.err('Ou fichier non lisible depuis le conteneur')}
                                {TT.sep()}
                                {TT.section('Correction')}
                                {TT.warn('Montez /var/log en lecture dans docker-compose.yml :')}
                                {TT.info('volumes: - /var/log:/var/log:ro')}
                            </>}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}>
                                    <XCircle style={{ width: 10, height: 10 }} /> Non accessible
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
