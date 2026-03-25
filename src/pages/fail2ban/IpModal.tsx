/**
 * IpModal — Modal détail IP partagé.
 * Utilisé depuis TabTracker, TabJailsEvents, TabJails (JailCard).
 * Auto-fetche la géoloc + historique interne. Permet de bannir dans recidive.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { X, Clock } from 'lucide-react';
import { api } from '../../api/client';

// ── Types exportés ─────────────────────────────────────────────────────────────

export interface GeoInfo {
    country: string;
    countryCode: string;
    city: string;
    org: string;
    isp: string;
    as: string;
}

interface IpHistEntry {
    ip: string;
    jail: string;
    timeofban: number;
    bantime: number | null;
    failures: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export const toFlag = (cc: string) =>
    cc.toUpperCase().split('').map(c => String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 65)).join('');

const fmtDate = (ts: number) => {
    const d = new Date(ts * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const fmtBantime = (s: number | null) => {
    if (s === null) return '—';
    if (s === -1)   return '∞ permanent';
    if (s < 60)     return `${s}s`;
    if (s < 3600)   return `${Math.round(s / 60)}m`;
    if (s < 86400)  return `${Math.round(s / 3600)}h`;
    return `${Math.round(s / 86400)}j`;
};

// ── Mini helpers UI ────────────────────────────────────────────────────────────

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '.4rem', fontSize: '.8rem' }}>
        <span style={{ color: '#8b949e', flexShrink: 0, minWidth: 120, fontSize: '.75rem' }}>{label}</span>
        <span style={{ color: '#e6edf3', fontFamily: 'inherit' }}>{children}</span>
    </div>
);

const JailPill: React.FC<{ jail: string }> = ({ jail }) => {
    const isRecidive = /recidive/i.test(jail);
    return (
        <span style={{ padding: '.08rem .4rem', borderRadius: 4, fontSize: '.72rem', fontWeight: 600,
            background: isRecidive ? 'rgba(232,106,101,.15)' : 'rgba(63,185,80,.1)',
            color: isRecidive ? '#e86a65' : '#3fb950',
            border: `1px solid ${isRecidive ? 'rgba(232,106,101,.35)' : 'rgba(63,185,80,.25)'}`,
            marginRight: '.25rem' }}>
            {jail}
        </span>
    );
};

// ── Main component ─────────────────────────────────────────────────────────────

export const IpModal: React.FC<{
    ip: string;
    onClose: () => void;
    /** Géoloc pré-chargée (TabTracker la passe déjà) — auto-fetch si absent */
    geo?: GeoInfo | null;
    /** Jails connus à l'ouverture (pré-remplis depuis le contexte appelant) */
    jails?: string[];
}> = ({ ip, onClose, geo: geoProp, jails: jailsProp }) => {
    const [history, setHistory]       = useState<IpHistEntry[]>([]);
    const [loading, setLoading]       = useState(true);
    const [geo, setGeo]               = useState<GeoInfo | null>(geoProp ?? null);
    const [actionMsg, setActionMsg]   = useState<{ ok: boolean; text: string } | null>(null);
    const [banning, setBanning]       = useState(false);

    useEffect(() => {
        setHistory([]); setLoading(true); setActionMsg(null);

        api.get<{ ok: boolean; bans: IpHistEntry[] }>(
            `/api/plugins/fail2ban/audit/internal?ip=${encodeURIComponent(ip)}&limit=100`
        ).then(res => {
            if (res.success && res.result?.ok) setHistory(res.result.bans ?? []);
            setLoading(false);
        });

        if (!geoProp) {
            api.get<{ ok: boolean; geo: GeoInfo }>(
                `/api/plugins/fail2ban/geo/${encodeURIComponent(ip)}`
            ).then(res => {
                if (res.success && res.result?.ok) setGeo(res.result.geo);
            });
        }
    }, [ip, geoProp]);

    const jails = useMemo(
        () => jailsProp ?? [...new Set(history.map(h => h.jail))],
        [history, jailsProp]
    );
    const inRecidive  = jails.some(j => /recidive/i.test(j));
    const totalBans   = history.filter(h => (h.bantime ?? 0) > 0).length;
    const lastBan     = history[0] ?? null;
    const firstBan    = history.length > 1 ? history[history.length - 1] : null;

    const banRecidive = async () => {
        setBanning(true); setActionMsg(null);
        const res = await api.post<{ ok: boolean; error?: string }>(
            '/api/plugins/fail2ban/ban', { jail: 'recidive', ip }
        );
        setActionMsg(res.success && res.result?.ok
            ? { ok: true,  text: `✓ ${ip} banni dans recidive` }
            : { ok: false, text: '✗ ' + (res.result?.error ?? res.error?.message ?? 'Erreur') }
        );
        setBanning(false);
    };

    const hasInfo = !loading && history.length > 0;

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
                width: '100%', maxWidth: 740, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>

                {/* ── Header ── */}
                <div style={{ background: '#21262d', padding: '.75rem 1rem',
                    borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center',
                    gap: '.65rem', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '1.05rem', fontWeight: 700, color: '#e86a65' }}>
                        {ip}
                    </span>
                    {inRecidive && (
                        <span style={{ padding: '.1rem .45rem', borderRadius: 4, fontSize: '.72rem', fontWeight: 700,
                            background: 'rgba(232,106,101,.2)', color: '#e86a65', border: '1px solid rgba(232,106,101,.4)' }}>
                            ⚠ récidiviste
                        </span>
                    )}
                    {geo && (
                        <span style={{ fontSize: '.82rem', color: '#8b949e', flex: 1, minWidth: 0 }}>
                            {geo.countryCode ? toFlag(geo.countryCode) + ' ' : ''}{[geo.city, geo.country].filter(Boolean).join(', ')}
                            {geo.org && <span style={{ marginLeft: '.5rem', fontSize: '.72rem' }}>· {geo.org}</span>}
                        </span>
                    )}
                    <button onClick={onClose}
                        style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                            color: '#8b949e', padding: '.2rem', borderRadius: 4, display: 'flex', flexShrink: 0 }}>
                        <X style={{ width: 16, height: 16 }} />
                    </button>
                </div>

                {/* ── 2-col: Stats | Whois ── */}
                {hasInfo && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
                        borderBottom: '1px solid #30363d', flexShrink: 0 }}>
                        {/* Stats */}
                        <div style={{ padding: '.7rem 1rem', borderRight: '1px solid #30363d',
                            display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                            <div style={{ fontWeight: 700, fontSize: '.68rem', textTransform: 'uppercase',
                                letterSpacing: '.06em', color: '#8b949e', marginBottom: '.2rem' }}>
                                Statistiques
                            </div>
                            <Row label="Total bans">
                                <strong style={{ color: '#e86a65' }}>{totalBans}</strong>
                                {history.length > totalBans &&
                                    <span style={{ color: '#8b949e', fontSize: '.72rem', marginLeft: '.35rem' }}>
                                        · {history.length - totalBans} unban/tentative
                                    </span>}
                            </Row>
                            <Row label="Jail(s)">
                                <span>{jails.map(j => <JailPill key={j} jail={j} />)}</span>
                            </Row>
                            {lastBan && (
                                <Row label="Dernier ban">
                                    <span style={{ fontFamily: 'monospace', fontSize: '.75rem', color: '#58a6ff' }}>
                                        {fmtDate(lastBan.timeofban)}
                                    </span>
                                </Row>
                            )}
                            {firstBan && (
                                <Row label="1er ban">
                                    <span style={{ fontFamily: 'monospace', fontSize: '.75rem', color: '#8b949e' }}>
                                        {fmtDate(firstBan.timeofban)}
                                    </span>
                                </Row>
                            )}
                            {(lastBan?.failures ?? 0) > 0 && (
                                <Row label="Tentatives (dernier)">
                                    <strong style={{ color: '#e3b341' }}>{lastBan!.failures}</strong>
                                </Row>
                            )}
                        </div>

                        {/* Whois */}
                        <div style={{ padding: '.7rem 1rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                            <div style={{ fontWeight: 700, fontSize: '.68rem', textTransform: 'uppercase',
                                letterSpacing: '.06em', color: '#8b949e', marginBottom: '.2rem' }}>
                                Whois / Réseau
                            </div>
                            {geo ? (<>
                                {geo.country && (
                                    <Row label="Pays">
                                        {geo.countryCode ? toFlag(geo.countryCode) + ' ' : ''}{geo.country}
                                    </Row>
                                )}
                                {geo.org && <Row label="Organisation"><span style={{ fontFamily: 'monospace', fontSize: '.75rem' }}>{geo.org}</span></Row>}
                                {geo.as  && <Row label="ASN"><span style={{ fontFamily: 'monospace', fontSize: '.75rem' }}>{geo.as}</span></Row>}
                                {geo.isp && geo.isp !== geo.org && (
                                    <Row label="ISP"><span style={{ fontFamily: 'monospace', fontSize: '.75rem' }}>{geo.isp}</span></Row>
                                )}
                                {geo.city && <Row label="Ville">{geo.city}</Row>}
                            </>) : (
                                <div style={{ color: '#8b949e', fontSize: '.78rem', fontStyle: 'italic' }}>
                                    Chargement géoloc…
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Actions ── */}
                <div style={{ padding: '.45rem 1rem', borderBottom: '1px solid #30363d',
                    display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap', flexShrink: 0 }}>
                    {!inRecidive && (
                        <button onClick={banRecidive} disabled={banning}
                            style={{ padding: '.22rem .75rem', borderRadius: 5,
                                background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.35)',
                                color: '#e86a65', cursor: banning ? 'default' : 'pointer',
                                fontSize: '.78rem', fontWeight: 600, opacity: banning ? .6 : 1 }}>
                            ⚖ Bannir dans recidive
                        </button>
                    )}
                    {actionMsg && (
                        <span style={{ fontSize: '.78rem', color: actionMsg.ok ? '#3fb950' : '#e86a65' }}>
                            {actionMsg.text}
                        </span>
                    )}
                </div>

                {/* ── Historique ── */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e' }}>Chargement…</div>
                    ) : history.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#3fb950', fontSize: '.85rem' }}>
                            Aucun historique interne trouvé
                        </div>
                    ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ position: 'sticky', top: 0, background: '#21262d' }}>
                                    {['Date du ban', 'Jail', 'Durée', 'Tentatives'].map(h => (
                                        <th key={h} style={{ padding: '.4rem .75rem', borderBottom: '1px solid #30363d',
                                            fontSize: '.67rem', fontWeight: 700, textTransform: 'uppercase',
                                            letterSpacing: '.05em', color: '#8b949e', textAlign: 'left', whiteSpace: 'nowrap' }}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {history.map((h, i) => (
                                    <tr key={i} style={{ borderBottom: '1px solid rgba(48,54,61,.5)' }}
                                        onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                        onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.background = 'transparent'}>
                                        <td style={{ padding: '.4rem .75rem', fontSize: '.78rem', whiteSpace: 'nowrap' }}>
                                            <Clock style={{ width: 11, height: 11, color: '#8b949e', marginRight: '.3rem', verticalAlign: 'middle' }} />
                                            <span style={{ color: '#e6edf3' }}>{fmtDate(h.timeofban)}</span>
                                        </td>
                                        <td style={{ padding: '.4rem .75rem' }}>
                                            <JailPill jail={h.jail} />
                                        </td>
                                        <td style={{ padding: '.4rem .75rem', fontSize: '.78rem', color: '#58a6ff', fontFamily: 'monospace' }}>
                                            {fmtBantime(h.bantime)}
                                        </td>
                                        <td style={{ padding: '.4rem .75rem', fontSize: '.78rem', color: '#e3b341', fontWeight: 600 }}>
                                            {h.failures ?? '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div style={{ padding: '.45rem 1rem', borderTop: '1px solid #30363d',
                    fontSize: '.7rem', color: '#8b949e', textAlign: 'right', flexShrink: 0 }}>
                    Historique long terme · base interne conservée au-delà du dbpurge
                </div>
            </div>
        </div>
    );
};
