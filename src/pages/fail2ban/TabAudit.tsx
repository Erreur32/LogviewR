import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, RefreshCw, AlertTriangle, Shield, Network, Layers, Database, Server } from 'lucide-react';
import { api } from '../../api/client';
import { card, cardH } from './helpers';
import { TabJailsFiles } from './TabJails';

// ── Couleurs ───────────────────────────────────────────────────────────────────
const C = {
    bg1: '#0d1117', bg2: '#161b22', bg3: '#21262d',
    border: '#30363d', text: '#e6edf3', muted: '#8b949e',
    green: '#3fb950', red: '#e86a65', orange: '#e3b341',
    blue: '#58a6ff', cyan: '#39c5cf', purple: '#bc8cff',
};

// ── Section header (same style as TabBackup) ──────────────────────────────────
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
            <CheckCircle style={{ width: 10, height: 10 }} /> Accessible
        </span>
    );
    if (status === 'error') return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}>
            <XCircle style={{ width: 10, height: 10 }} /> Non disponible
        </span>
    );
    return null;
};

// ── Component ─────────────────────────────────────────────────────────────────

export const TabAudit: React.FC = () => {
    // Fail2ban service check
    const [f2bStatus,  setF2bStatus]  = useState<CheckStatus>('idle');
    const [f2bResult,  setF2bResult]  = useState<F2bCheckResult | null>(null);
    const [f2bLoading, setF2bLoading] = useState(false);

    // Firewall checks
    const [fwStatuses, setFwStatuses] = useState<Record<string, CheckStatus>>({});
    const [fwErrors,   setFwErrors]   = useState<Record<string, string>>({});
    const [fwLoading,  setFwLoading]  = useState(false);

    // Log access check
    const [logAvail, setLogAvail] = useState<boolean | null>(null);

    const checkF2b = useCallback(async () => {
        setF2bLoading(true);
        setF2bStatus('loading');
        try {
            const res = await api.get<F2bCheckResult>('/api/plugins/fail2ban/check');
            if (res.success && res.result) {
                setF2bResult(res.result);
                const allOk = Object.values(res.result.checks ?? {}).every(c => c.ok);
                setF2bStatus(allOk ? 'ok' : 'error');
            } else {
                setF2bStatus('error');
            }
        } catch {
            setF2bStatus('error');
        } finally {
            setF2bLoading(false);
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
    }, []);

    useEffect(() => {
        checkF2b();
        checkFirewall();
        api.get<{ ok: boolean; files?: string[] }>('/api/plugins/fail2ban/logs')
            .then(r => setLogAvail(r.success && r.result?.ok === true && (r.result.files?.length ?? 0) > 0))
            .catch(() => setLogAvail(false));
    }, [checkF2b, checkFirewall]);

    const allFwOk  = FW_CHECKS.every(c => fwStatuses[c.key] === 'ok');
    const anyFwErr = FW_CHECKS.some(c => fwStatuses[c.key] === 'error');
    const anyFwLoading = FW_CHECKS.some(c => fwStatuses[c.key] === 'loading') || fwLoading;

    // Fail2ban check rows
    const f2bChecks: { key: string; label: string; icon: React.ReactNode; ok: boolean; fix?: string | null }[] = f2bResult ? [
        { key: 'daemon',  label: 'Daemon fail2ban', icon: <Server style={{ width: 12, height: 12 }} />,   ok: f2bResult.checks.daemon.ok,  fix: f2bResult.checks.daemon.fix  },
        { key: 'socket',  label: 'Socket Unix',     icon: <Shield style={{ width: 12, height: 12 }} />,   ok: f2bResult.checks.socket.ok,  fix: f2bResult.checks.socket.fix  },
        { key: 'sqlite',  label: 'Base SQLite',     icon: <Database style={{ width: 12, height: 12 }} />, ok: f2bResult.checks.sqlite.ok,  fix: f2bResult.checks.sqlite.fix  },
        { key: 'dropin',  label: 'Drop-in systemd', icon: <Shield style={{ width: 12, height: 12 }} />,   ok: f2bResult.checks.dropin.ok,  fix: f2bResult.checks.dropin.fix  },
    ] : [];

    const anyF2bErr = f2bChecks.some(c => !c.ok);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

            {/* ══ Section : Service Fail2ban ════════════════════════════════════ */}
            <SectionHeader icon={<Shield style={{ width: 13, height: 13 }} />} label="Service Fail2ban" color={C.blue} sub="socket · daemon · SQLite" />

            <div style={card}>
                <div style={{ ...cardH }}>
                    <Shield style={{ width: 14, height: 14, color: C.blue }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>Fail2ban — Vérifications</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <button onClick={checkF2b} disabled={f2bLoading}
                            style={{ padding: '.2rem .5rem', borderRadius: 4, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', fontSize: '.72rem', display: 'inline-flex', alignItems: 'center', gap: '.25rem', opacity: f2bLoading ? .5 : 1 }}>
                            <RefreshCw style={{ width: 10, height: 10 }} /> Relancer
                        </button>
                        <StatusBadge status={f2bStatus} />
                    </span>
                </div>

                {f2bStatus === 'loading' && (
                    <div style={{ padding: '.75rem 1rem', color: C.muted, fontSize: '.8rem' }}>Vérification en cours…</div>
                )}

                {f2bChecks.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        {f2bChecks.map((c, i) => (
                            <div key={c.key} style={{ borderBottom: i < f2bChecks.length - 1 ? `1px solid ${C.border}` : undefined }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.5rem 1rem' }}>
                                    <span style={{ color: c.ok ? C.green : C.red }}>{c.icon}</span>
                                    <span style={{ fontWeight: 600, fontSize: '.82rem', color: C.text, minWidth: 130 }}>{c.label}</span>
                                    <span style={{ marginLeft: 'auto' }}>
                                        {c.ok ? (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.green }}>
                                                <CheckCircle style={{ width: 11, height: 11 }} /> OK
                                            </span>
                                        ) : (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.72rem', color: C.red }}>
                                                <XCircle style={{ width: 11, height: 11 }} /> Erreur
                                            </span>
                                        )}
                                    </span>
                                </div>
                                {!c.ok && c.fix && (
                                    <div style={{ padding: '0 1rem .7rem 2.6rem' }}>
                                        <pre style={{ margin: 0, fontSize: '.72rem', fontFamily: 'monospace', color: C.orange, background: 'rgba(227,179,65,.06)', borderRadius: 4, padding: '.35rem .6rem', border: '1px solid rgba(227,179,65,.2)', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{c.fix}</pre>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {anyF2bErr && (
                    <div style={{ margin: '0 1rem 1rem', borderRadius: 6, border: '1px solid rgba(88,166,255,.25)', background: 'rgba(88,166,255,.05)', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem .75rem', background: 'rgba(88,166,255,.08)', borderBottom: '1px solid rgba(88,166,255,.2)' }}>
                            <AlertTriangle style={{ width: 11, height: 11, color: C.blue }} />
                            <span style={{ fontWeight: 600, fontSize: '.8rem', color: C.blue }}>Script de configuration rapide</span>
                        </div>
                        <div style={{ padding: '.55rem .85rem' }}>
                            <pre style={{ margin: 0, fontSize: '.72rem', fontFamily: 'monospace', color: C.cyan, background: C.bg1, borderRadius: 4, padding: '.35rem .6rem', border: `1px solid ${C.border}` }}>{SETUP_SCRIPT}</pre>
                        </div>
                    </div>
                )}
            </div>

            {/* ══ Section : Pare-feu — Netfilter ════════════════════════════════ */}
            <SectionHeader icon={<Layers style={{ width: 13, height: 13 }} />} label="Pare-feu — Netfilter" color={C.cyan} sub="IPTables · IPSet · NFTables" />

            <div style={card}>
                <div style={{ ...cardH }}>
                    <Layers style={{ width: 14, height: 14, color: C.cyan }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem' }}>IPTables · IPSet · NFTables</span>
                    <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <button onClick={checkFirewall} disabled={fwLoading}
                            style={{ padding: '.2rem .5rem', borderRadius: 4, background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, cursor: 'pointer', fontSize: '.72rem', display: 'inline-flex', alignItems: 'center', gap: '.25rem', opacity: fwLoading ? .5 : 1 }}>
                            <RefreshCw style={{ width: 10, height: 10 }} /> Relancer
                        </button>
                        {anyFwLoading ? (
                            <span style={{ fontSize: '.72rem', color: C.muted, display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                <RefreshCw style={{ width: 11, height: 11, animation: 'spin 1s linear infinite' }} /> Vérification…
                            </span>
                        ) : allFwOk ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(63,185,80,.12)', color: C.green, border: '1px solid rgba(63,185,80,.3)' }}>
                                <CheckCircle style={{ width: 10, height: 10 }} /> Tout accessible
                            </span>
                        ) : anyFwErr ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(232,106,101,.12)', color: C.red, border: '1px solid rgba(232,106,101,.3)' }}>
                                <AlertTriangle style={{ width: 10, height: 10 }} /> Non disponible
                            </span>
                        ) : null}
                    </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
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
                    <div style={{ margin: '0 1rem 1rem', borderRadius: 6, border: '1px solid rgba(88,166,255,.25)', background: 'rgba(88,166,255,.05)', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.4rem .75rem', background: 'rgba(88,166,255,.08)', borderBottom: '1px solid rgba(88,166,255,.2)' }}>
                            <AlertTriangle style={{ width: 11, height: 11, color: C.blue }} />
                            <span style={{ fontWeight: 600, fontSize: '.8rem', color: C.blue }}>Prérequis Docker</span>
                            <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: C.muted }}>requis pour les onglets Pare-feu</span>
                        </div>
                        <pre style={{ margin: 0, fontSize: '.72rem', fontFamily: 'monospace', color: C.text, lineHeight: 1.6, padding: '.6rem .85rem', whiteSpace: 'pre-wrap' }}>{DOCKER_PREREQ}</pre>
                    </div>
                )}
            </div>

            {/* ══ Section : Fichiers de config ══════════════════════════════════ */}
            <SectionHeader icon={<Database style={{ width: 13, height: 13 }} />} label="Fail2ban service log" color={C.muted} avail={logAvail} />
            <TabJailsFiles />
        </div>
    );
};
