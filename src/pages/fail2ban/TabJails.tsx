/**
 * TabJails — Onglet Jails.
 * Vue Cartes / Tableau (4-col expand) / Événements / Fichiers log.
 * Aligné sur tabs/jails.php du projet PHP Fail2ban-web.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Shield, Ban, Unlock, RotateCcw, AlertTriangle,
    LayoutGrid, Table2, ScrollText, List, ChevronRight, ChevronDown,
    Settings, Terminal, Clock,
} from 'lucide-react';
import { api } from '../../api/client';
import { card, cardH, Badge, StatusDot, fmtSecs, fmtTs } from './helpers';
import { ConfEditorModal } from './ConfEditorModal';
import type { ConfEditorTarget } from './ConfEditorModal';
import { JailConfigModal } from './JailConfigModal';
import type { JailStatus, BanEntry } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TabJailsProps {
    jails: JailStatus[];
    inactiveJails?: JailStatus[];
    loading: boolean;
    statusOk?: boolean;
    statusError?: string;
    actionLoading: string | null;
    days?: number;
    onUnban: (jail: string, ip: string) => void;
    onBan:   (jail: string, ip: string) => void;
    onReload: (jail: string) => void;
}

type JailsViewMode = 'cards' | 'table' | 'logs' | 'events';
const STORAGE_KEY = 'logviewr-fail2ban-jails-view';


// ── Shared helpers ────────────────────────────────────────────────────────────

const timingBadge = (label: string, value: string | number, color: string): React.ReactNode => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.2rem', padding: '.12rem .45rem', borderRadius: 4, fontSize: '.7rem', border: `1px solid rgba(${color === '#e86a65' ? '232,106,101' : color === '#e3b341' ? '227,179,65' : '88,166,255'},.3)`, background: `rgba(${color === '#e86a65' ? '232,106,101' : color === '#e3b341' ? '227,179,65' : '88,166,255'},.08)`, color }}>
        <span style={{ fontSize: '.62rem', color: '#8b949e' }}>{label}</span>
        <strong>{value}</strong>
    </span>
);

// ── Rules toggle (Règles de détection) ────────────────────────────────────────

const RulesToggle: React.FC<{ filter: string }> = ({ filter }) => {
    const [open, setOpen]       = useState(false);
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const res = await api.get<{ ok: boolean; content: string }>(`/api/plugins/fail2ban/filters/${filter}.conf`);
        setContent(res.success && res.result?.ok ? res.result.content : 'Fichier non disponible.');
        setLoading(false);
    }, [filter]);

    const toggle = () => {
        if (!open && !content) load();
        setOpen(o => !o);
    };

    // Extract failregex lines
    const failregexLines = useMemo(() => {
        if (!content) return [];
        return content.split('\n').filter(l => /^\s*failregex\s*=/.test(l) || (l.trim().startsWith('#') === false && content.includes('failregex') && /^\s{2,}/.test(l)));
    }, [content]);

    return (
        <div style={{ borderTop: '1px solid #30363d' }}>
            <button onClick={toggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.4rem .75rem', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '.77rem' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                <Terminal style={{ width: 11, height: 11, flexShrink: 0 }} />
                <span>Règles de détection</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: '.68rem', color: '#30363d' }}>{filter}.conf</span>
                {open ? <ChevronDown style={{ width: 11, height: 11 }} /> : <ChevronRight style={{ width: 11, height: 11 }} />}
            </button>
            {open && (
                <div style={{ padding: '.5rem .75rem .75rem', background: 'rgba(13,17,23,.4)' }}>
                    {loading ? (
                        <div style={{ color: '#8b949e', fontSize: '.77rem' }}>Chargement…</div>
                    ) : (
                        <pre style={{ margin: 0, fontSize: '.72rem', fontFamily: 'monospace', color: '#e6edf3', lineHeight: 1.5, whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto' }}>
                            {failregexLines.length > 0 ? failregexLines.join('\n') : content.slice(0, 600)}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
};

// ── JailCard (Cards view) ─────────────────────────────────────────────────────

export const JailCard: React.FC<{
    jail: JailStatus;
    actionLoading: string | null;
    onUnban: (ip: string) => void;
    onBan:   (ip: string) => void;
    onReload: () => void;
}> = ({ jail, actionLoading, onUnban, onBan, onReload }) => {
    const [banIp, setBanIp] = useState('');
    const [ipFilter, setIpFilter] = useState('');
    const [editor, setEditor] = useState<ConfEditorTarget | null>(null);
    const [configOpen, setConfigOpen] = useState(false);
    const reloadKey = `reload-${jail.jail}`;

    const hasThreat   = jail.currentlyFailed > 0 && (jail.maxretry ?? 0) > 0;
    const threatRatio = hasThreat ? Math.min(1, jail.currentlyFailed / jail.maxretry!) : 0;
    const threatPct   = Math.round(threatRatio * 100);
    const threatColor = threatRatio < .5 ? '#3fb950' : threatRatio < 1 ? '#e3b341' : '#e86a65';

    const totalDisplay   = jail.totalBannedSqlite !== undefined ? jail.totalBannedSqlite : jail.totalBanned;
    const bansInPeriod   = jail.bansInPeriod;
    const filteredIps    = ipFilter ? jail.bannedIps.filter(ip => ip.includes(ipFilter)) : jail.bannedIps;

    return (
        <>
        {editor && <ConfEditorModal target={editor} onClose={() => setEditor(null)} />}
        {configOpen && <JailConfigModal jailName={jail.jail} isActive onClose={() => setConfigOpen(false)} />}
        <div style={card}>
            {/* Header */}
            <div style={{ ...cardH, background: '#21262d' }}>
                <StatusDot banned={jail.currentlyBanned} failed={jail.currentlyFailed} />
                <Shield style={{ width: 13, height: 13, color: jail.currentlyBanned > 0 ? '#e86a65' : '#58a6ff', flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: '.88rem', flex: 1 }}>{jail.jail.toUpperCase()}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.72rem', color: '#8b949e' }}>
                    {jail.bantime  !== undefined && <span title="Durée de ban">⏱ {fmtSecs(jail.bantime)}</span>}
                    {jail.findtime !== undefined && <span title="Fenêtre de détection">👁 {fmtSecs(jail.findtime)}</span>}
                    {jail.maxretry !== undefined && <span title="Tentatives max">{jail.maxretry}×</span>}
                </div>
            </div>

            {/* 5-column stats grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderBottom: '1px solid #30363d' }}>
                {[
                    { v: jail.currentlyBanned, l: 'Bannis',        color: '#e86a65' },
                    { v: totalDisplay,          l: 'Total ban',      color: '#58a6ff' },
                    { v: bansInPeriod !== undefined ? bansInPeriod : '—', l: 'Bans période', color: bansInPeriod !== undefined ? '#39c5cf' : '#8b949e' },
                    { v: jail.currentlyFailed,  l: 'Échecs actifs',  color: '#e3b341' },
                    { v: jail.totalFailed,       l: 'Tot. échecs',    color: '#bc8cff' },
                ].map(({ v, l, color }, idx) => (
                    <div key={l} style={{ textAlign: 'center', padding: '.6rem .3rem', borderRight: idx < 4 ? '1px solid #30363d' : undefined }}>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700, lineHeight: 1.2, color }}>{v}</div>
                        <div style={{ fontSize: '.62rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 2 }}>{l}</div>
                    </div>
                ))}
            </div>

            {/* Threat bar */}
            {hasThreat && (
                <div style={{ padding: '.45rem 1rem .3rem', borderBottom: '1px solid #30363d' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.2rem', fontSize: '.73rem' }}>
                        <span style={{ color: threatColor, fontWeight: 600 }}>{jail.currentlyFailed} / {jail.maxretry} tentatives</span>
                        {threatRatio >= 1
                            ? <span style={{ color: '#e86a65', fontWeight: 700 }}>Ban imminent</span>
                            : <span style={{ color: threatColor }}>{jail.maxretry! - jail.currentlyFailed} restante{jail.maxretry! - jail.currentlyFailed > 1 ? 's' : ''}</span>}
                    </div>
                    <div style={{ background: '#2d333b', borderRadius: 3, height: 5, overflow: 'hidden' }}>
                        <div style={{ width: `${threatPct}%`, height: '100%', background: threatColor, borderRadius: 3, transition: 'width .2s' }} />
                    </div>
                </div>
            )}

            {/* Meta badges */}
            {(jail.filter || jail.port || (jail.actions?.length ?? 0) > 0 || jail.banaction || jail.fileList) && (
                <div style={{ padding: '.4rem .75rem', borderBottom: '1px solid #30363d', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                    {(jail.filter || jail.port) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                            {jail.filter && (
                                <span onClick={() => setEditor({ type: 'filter', name: jail.filter!, jails: [jail.jail] })} style={{ cursor: 'pointer' }} title="Voir / éditer le filtre">
                                    <Badge color="green">⚙ {jail.filter}</Badge>
                                </span>
                            )}
                            {jail.port && jail.port.split(/[\s,]+/).filter(Boolean).map(p => <Badge key={p} color="blue">⬡ {p}</Badge>)}
                        </div>
                    )}
                    {(jail.actions?.length || jail.banaction) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                            {jail.actions?.map(a => (
                                <span key={a} onClick={() => setEditor({ type: 'action', name: a, jails: [jail.jail] })} style={{ cursor: 'pointer' }} title="Voir / éditer l'action">
                                    <Badge color="orange">⚡ {a}</Badge>
                                </span>
                            ))}
                            {!jail.actions?.length && jail.banaction && (
                                <span onClick={() => setEditor({ type: 'action', name: jail.banaction!, jails: [jail.jail] })} style={{ cursor: 'pointer' }} title="Voir / éditer l'action">
                                    <Badge color="red">⚡ {jail.banaction}</Badge>
                                </span>
                            )}
                        </div>
                    )}
                    {jail.fileList && (
                        <div><Badge color="muted">📄 {jail.fileList}</Badge></div>
                    )}
                </div>
            )}

            {/* Paramètres bar */}
            <div style={{ padding: '.3rem .75rem', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                <span style={{ fontSize: '.72rem', color: '#8b949e', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                    <Settings style={{ width: 11, height: 11 }} />
                    Paramètres (bantime, findtime, maxretry)
                </span>
                <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
                    {jail.bantime  !== undefined && timingBadge('ban',   fmtSecs(jail.bantime),  '#e86a65')}
                    {jail.findtime !== undefined && timingBadge('find',  fmtSecs(jail.findtime), '#e3b341')}
                    {jail.maxretry !== undefined && timingBadge('retry', `${jail.maxretry}×`,    '#58a6ff')}
                </div>
            </div>

            {/* Banned IPs table */}
            {jail.bannedIps.length > 0 ? (
                <div>
                    {jail.bannedIps.length > 5 && (
                        <div style={{ padding: '.35rem .75rem', borderBottom: '1px solid #30363d' }}>
                            <input type="text" value={ipFilter} onChange={e => setIpFilter(e.target.value)}
                                placeholder="Filtrer les IPs…"
                                style={{ width: '100%', padding: '.25rem .5rem', fontSize: '.78rem', fontFamily: 'monospace', borderRadius: 4, background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3', outline: 'none', boxSizing: 'border-box' }} />
                        </div>
                    )}
                    <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
                            <thead>
                                <tr style={{ background: '#1c2128' }}>
                                    <th style={{ padding: '.25rem .5rem', borderBottom: '1px solid #30363d', color: '#8b949e', fontSize: '.65rem', fontWeight: 700, textTransform: 'uppercase', textAlign: 'left', width: 28 }}>#</th>
                                    <th style={{ padding: '.25rem .5rem', borderBottom: '1px solid #30363d', color: '#8b949e', fontSize: '.65rem', fontWeight: 700, textTransform: 'uppercase', textAlign: 'left' }}>IP</th>
                                    <th style={{ padding: '.25rem .5rem', borderBottom: '1px solid #30363d', width: 48 }} />
                                </tr>
                            </thead>
                            <tbody>
                                {filteredIps.map((ip, i) => (
                                    <tr key={ip} style={{ borderBottom: '1px solid #30363d' }}
                                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                                        <td style={{ padding: '.3rem .5rem', color: '#8b949e', fontSize: '.7rem' }}>{i + 1}</td>
                                        <td style={{ padding: '.3rem .5rem', fontFamily: 'monospace', color: '#e86a65', fontWeight: 600 }}>{ip}</td>
                                        <td style={{ padding: '.3rem .5rem', textAlign: 'right' }}>
                                            <button onClick={() => onUnban(ip)} disabled={actionLoading === `unban-${jail.jail}-${ip}`}
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: '.2rem', padding: '.18rem .4rem', borderRadius: 4, background: 'rgba(63,185,80,.1)', border: '1px solid rgba(63,185,80,.25)', color: '#3fb950', cursor: 'pointer', fontSize: '.68rem', opacity: actionLoading === `unban-${jail.jail}-${ip}` ? .5 : 1 }}>
                                                <Unlock style={{ width: 9, height: 9 }} /> Unban
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {filteredIps.length === 0 && ipFilter && (
                                    <tr><td colSpan={3} style={{ padding: '.5rem', textAlign: 'center', color: '#8b949e', fontSize: '.77rem' }}>Aucun résultat</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div style={{ padding: '.75rem 1rem', color: '#8b949e', fontSize: '.8rem', fontStyle: 'italic', textAlign: 'center' }}>
                    ✓ Aucun client banni
                </div>
            )}

            {/* Ban IP form */}
            <div style={{ padding: '.5rem .75rem', borderTop: '1px solid #30363d', background: 'rgba(13,17,23,.3)' }}>
                <form onSubmit={e => { e.preventDefault(); if (banIp.trim()) { onBan(banIp.trim()); setBanIp(''); } }}
                    style={{ display: 'flex', gap: '.4rem', marginBottom: '.35rem' }}>
                    <input type="text" value={banIp} onChange={e => setBanIp(e.target.value)}
                        placeholder="IP à bannir…"
                        style={{ flex: 1, padding: '.28rem .55rem', fontSize: '.78rem', fontFamily: 'monospace', borderRadius: 4, background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3', outline: 'none', minWidth: 0 }} />
                    <button type="submit" disabled={!banIp.trim() || !!actionLoading}
                        style={{ display: 'flex', alignItems: 'center', gap: '.25rem', padding: '.28rem .65rem', borderRadius: 4, background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.25)', color: '#e86a65', cursor: 'pointer', fontSize: '.75rem', opacity: !banIp.trim() || !!actionLoading ? .5 : 1 }}>
                        <Ban style={{ width: 10, height: 10 }} /> Ban
                    </button>
                    <button type="button" onClick={() => setConfigOpen(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: '.25rem', padding: '.28rem .55rem', borderRadius: 4, background: 'rgba(188,140,255,.08)', border: '1px solid rgba(188,140,255,.3)', color: '#bc8cff', cursor: 'pointer', fontSize: '.72rem' }}>
                        <Settings style={{ width: 10, height: 10 }} />
                    </button>
                </form>
            </div>

            {/* Règles de détection */}
            {jail.filter && <RulesToggle filter={jail.filter} />}
        </div>
        </>
    );
};

// ── Jail Expanded Panel — 4-column grid (Table view) ─────────────────────────

const JailExpandedGrid: React.FC<{
    jail: JailStatus;
    actionLoading: string | null;
    bansInPeriodLabel: string;
    onUnban: (ip: string) => void;
    onBan:   (ip: string) => void;
    onReload: () => void;
    onUnbanAll: () => void;
    onOpenConfig: () => void;
}> = ({ jail, actionLoading, bansInPeriodLabel, onUnban, onBan, onReload, onUnbanAll, onOpenConfig }) => {
    const [banIp, setBanIp]           = useState('');
    const [showAllIps, setShowAllIps] = useState(false);
    const [recentBans, setRecentBans] = useState<BanEntry[]>([]);
    const [logsOpen, setLogsOpen]     = useState(false);
    const reloadKey = `reload-${jail.jail}`;

    const hasThreat   = jail.currentlyFailed > 0 && (jail.maxretry ?? 0) > 0;
    const threatRatio = hasThreat ? Math.min(1, jail.currentlyFailed / jail.maxretry!) : 0;
    const threatPct   = Math.round(threatRatio * 100);
    const threatColor = threatRatio < .5 ? '#3fb950' : threatRatio < 1 ? '#e3b341' : '#e86a65';

    const totalDisplay = jail.totalBannedSqlite !== undefined ? jail.totalBannedSqlite : jail.totalBanned;

    // Fetch recent bans (<5 min) from audit for this jail
    useEffect(() => {
        const since = Math.floor(Date.now() / 1000) - 300;
        api.get<{ ok: boolean; bans: BanEntry[] }>(`/api/plugins/fail2ban/audit?limit=50&jail=${encodeURIComponent(jail.jail)}`)
            .then(res => {
                if (res.success && res.result?.ok) {
                    setRecentBans((res.result.bans ?? []).filter(b => b.timeofban >= since));
                }
            });
    }, [jail.jail]);

    const bannedShow = jail.bannedIps.slice(0, 8);
    const bannedRest = jail.bannedIps.slice(8);

    // Exact PHP .jdp-pill style
    const PILLS = {
        red:    { bg: 'rgba(248,81,73,.18)',   color: '#e86a65', border: 'rgba(248,81,73,.35)'   },
        orange: { bg: 'rgba(210,153,34,.18)',  color: '#e3b341', border: 'rgba(210,153,34,.35)'  },
        green:  { bg: 'rgba(63,185,80,.15)',   color: '#3fb950', border: 'rgba(63,185,80,.3)'    },
        blue:   { bg: 'rgba(88,166,255,.15)',  color: '#58a6ff', border: 'rgba(88,166,255,.3)'   },
        purple: { bg: 'rgba(188,140,255,.15)', color: '#bc8cff', border: 'rgba(188,140,255,.3)'  },
    };
    const pill = (p: keyof typeof PILLS, icon: React.ReactNode, lbl: string, val: React.ReactNode) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 6, fontSize: '.72rem', fontWeight: 600, border: `1px solid ${PILLS[p].border}`, background: PILLS[p].bg, color: PILLS[p].color }}>
            {icon}
            <span style={{ color: '#8b949e', fontWeight: 400, marginRight: 1 }}>{lbl}</span>
            {val}
        </span>
    );

    const colTitle = (text: string, color: string, icon: React.ReactNode): React.ReactNode => (
        <div style={{ fontSize: '.75rem', fontWeight: 700, color, marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: '.35rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {icon} {text}
        </div>
    );

    return (
        <div style={{ background: 'rgba(13,17,23,.6)', borderTop: '1px solid #30363d', padding: '0' }}>
            {/* Pills header — exact PHP .jdp-pill style */}
            <div style={{ padding: '.55rem 1rem', borderBottom: '1px solid #30363d', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {pill('red',    <Ban style={{ width: 10, height: 10 }} />,           'Actifs',  jail.currentlyBanned)}
                {pill('orange', <AlertTriangle style={{ width: 10, height: 10 }} />, 'Échecs',  jail.currentlyFailed)}
                {pill('green',  <Clock style={{ width: 10, height: 10 }} />,         '<5min',   recentBans.length || '—')}
                <span style={{ color: '#30363d', margin: '0 2px' }}>·</span>
                {pill('blue',   <Clock style={{ width: 10, height: 10 }} />,         bansInPeriodLabel, jail.bansInPeriod !== undefined ? jail.bansInPeriod : '—')}
                {pill('purple', <Shield style={{ width: 10, height: 10 }} />,        'Total',   totalDisplay || '—')}
            </div>

            {/* 4-column grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0', borderBottom: '1px solid #30363d' }}>

                {/* Col 1: Configuration */}
                <div style={{ padding: '.75rem 1rem', borderRight: '1px solid #30363d' }}>
                    {colTitle('Configuration', '#8b949e', <Settings style={{ width: 11, height: 11 }} />)}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.78rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#8b949e' }}>Filtre</span>
                            {jail.filter ? <Badge color="green">⚙ {jail.filter}</Badge> : <span style={{ color: '#8b949e' }}>—</span>}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.3rem' }}>
                            <span style={{ color: '#8b949e', flexShrink: 0 }}>Action</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.2rem', justifyContent: 'flex-end' }}>
                                {jail.actions?.map(a => <Badge key={a} color="orange">⚡ {a}</Badge>)}
                                {!jail.actions?.length && jail.banaction && <Badge color="orange">⚡ {jail.banaction}</Badge>}
                                {!jail.actions?.length && !jail.banaction && <span style={{ color: '#8b949e' }}>—</span>}
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#8b949e' }}>Statut</span>
                            <span style={{ color: '#3fb950', fontSize: '.72rem', display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3fb950', flexShrink: 0 }} /> Actif
                            </span>
                        </div>
                    </div>
                    <div style={{ borderTop: '1px solid #30363d', margin: '.55rem 0', paddingTop: '.45rem', display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
                        {jail.bantime  !== undefined && timingBadge('ban',   fmtSecs(jail.bantime),  '#e86a65')}
                        {jail.findtime !== undefined && timingBadge('find',  fmtSecs(jail.findtime), '#e3b341')}
                        {jail.maxretry !== undefined && timingBadge('retry', `${jail.maxretry}×`,    '#58a6ff')}
                    </div>
                    {jail.fileList && (() => {
                        const files = jail.fileList.split(/\s+/).filter(Boolean);
                        return (
                            <div style={{ borderTop: '1px solid #30363d', paddingTop: '.45rem', marginTop: '.45rem' }}>
                                <button onClick={() => setLogsOpen(o => !o)}
                                    style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer', padding: '.2rem .5rem', fontSize: '.72rem', color: '#58a6ff', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                    <ScrollText style={{ width: 10, height: 10 }} />
                                    {files.length} log{files.length > 1 ? 's' : ''} surveillé{files.length > 1 ? 's' : ''}
                                    {logsOpen ? <ChevronDown style={{ width: 9, height: 9 }} /> : <ChevronRight style={{ width: 9, height: 9 }} />}
                                </button>
                                {logsOpen && (
                                    <div style={{ marginTop: '.3rem', background: '#0d1117', border: '1px solid #30363d', borderRadius: 5, padding: '.4rem .6rem', maxHeight: 140, overflowY: 'auto' }}>
                                        {files.map(p => (
                                            <div key={p} title={p} style={{ fontFamily: 'monospace', fontSize: '.7rem', color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '.1rem' }}>{p}</div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                    <div style={{ marginTop: '.6rem' }}>
                        <button onClick={onOpenConfig}
                            style={{ display: 'flex', alignItems: 'center', gap: '.3rem', padding: '.3rem .65rem', borderRadius: 4, background: 'rgba(188,140,255,.08)', border: '1px solid rgba(188,140,255,.3)', color: '#bc8cff', cursor: 'pointer', fontSize: '.72rem' }}>
                            <Settings style={{ width: 10, height: 10 }} /> Configurer
                        </button>
                    </div>
                </div>

                {/* Col 2: Tentatives actives */}
                <div style={{ padding: '.75rem 1rem', borderRight: '1px solid #30363d' }}>
                    {colTitle('Tentatives actives', '#e3b341', <AlertTriangle style={{ width: 11, height: 11 }} />)}
                    {jail.currentlyFailed === 0 ? (
                        <div style={{ color: '#3fb950', fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                            ✓ Aucune tentative
                        </div>
                    ) : (
                        <div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#e3b341', lineHeight: 1.1, marginBottom: '.35rem' }}>
                                {jail.currentlyFailed}{jail.maxretry !== undefined && <span style={{ fontSize: '.85rem', color: '#8b949e' }}> / {jail.maxretry}×</span>}
                            </div>
                            {hasThreat && (
                                <>
                                    <div style={{ background: '#2d333b', borderRadius: 3, height: 5, overflow: 'hidden', marginBottom: '.35rem' }}>
                                        <div style={{ width: `${threatPct}%`, height: '100%', background: threatColor, borderRadius: 3 }} />
                                    </div>
                                    {threatRatio >= 1 && (
                                        <div style={{ color: '#e86a65', fontSize: '.75rem', fontWeight: 700, marginBottom: '.35rem' }}>Ban imminent</div>
                                    )}
                                    {threatRatio >= .5 && threatRatio < 1 && (
                                        <div style={{ color: '#e3b341', fontSize: '.73rem', marginBottom: '.35rem' }}>
                                            {jail.maxretry! - jail.currentlyFailed} tentative(s) avant ban
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    {/* Ban form */}
                    <form onSubmit={e => { e.preventDefault(); if (banIp.trim()) { onBan(banIp.trim()); setBanIp(''); } }}
                        style={{ marginTop: '.6rem', display: 'flex', gap: '.3rem' }}>
                        <input type="text" value={banIp} onChange={e => setBanIp(e.target.value)}
                            placeholder="IP à bannir…"
                            style={{ flex: 1, padding: '.25rem .45rem', fontSize: '.75rem', fontFamily: 'monospace', borderRadius: 4, background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3', outline: 'none', minWidth: 0 }} />
                        <button type="submit" disabled={!banIp.trim() || !!actionLoading}
                            style={{ padding: '.25rem .55rem', borderRadius: 4, background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.25)', color: '#e86a65', cursor: 'pointer', fontSize: '.72rem', opacity: !banIp.trim() || !!actionLoading ? .5 : 1 }}>
                            <Ban style={{ width: 10, height: 10 }} />
                        </button>
                    </form>
                </div>

                {/* Col 3: Bans < 5 min */}
                <div style={{ padding: '.75rem 1rem', borderRight: '1px solid #30363d' }}>
                    {colTitle('Bans < 5 min', '#3fb950', <Clock style={{ width: 11, height: 11 }} />)}
                    {recentBans.length === 0 ? (
                        <div style={{ color: '#3fb950', fontSize: '.78rem' }}>✓ Aucun ban récent</div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                            {recentBans.slice(0, 6).map((b, i) => (
                                <div key={i} style={{ fontFamily: 'monospace', fontSize: '.75rem', color: '#e86a65' }}>{b.ip}</div>
                            ))}
                            {recentBans.length > 6 && (
                                <span style={{ fontSize: '.7rem', color: '#8b949e' }}>+{recentBans.length - 6} autre(s)</span>
                            )}
                        </div>
                    )}
                </div>

                {/* Col 4: IPs bannies actives */}
                <div style={{ padding: '.75rem 1rem' }}>
                    {colTitle('IPs bannies actives', '#e86a65', <Ban style={{ width: 11, height: 11 }} />)}
                    {jail.bannedIps.length === 0 ? (
                        <div style={{ color: '#3fb950', fontSize: '.78rem' }}>✓ Aucune IP bannie</div>
                    ) : (
                        <div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                                {(showAllIps ? jail.bannedIps : bannedShow).map(ip => (
                                    <div key={ip} style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                                        <span style={{ fontFamily: 'monospace', fontSize: '.77rem', color: '#e86a65', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ip}</span>
                                        <button onClick={() => onUnban(ip)} disabled={actionLoading === `unban-${jail.jail}-${ip}`}
                                            style={{ flexShrink: 0, padding: '.15rem .35rem', borderRadius: 4, background: 'rgba(63,185,80,.08)', border: '1px solid rgba(63,185,80,.2)', color: '#3fb950', cursor: 'pointer', fontSize: '.65rem', opacity: actionLoading === `unban-${jail.jail}-${ip}` ? .5 : 1 }}>
                                            <Unlock style={{ width: 9, height: 9 }} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            {bannedRest.length > 0 && (
                                <button onClick={() => setShowAllIps(v => !v)}
                                    style={{ marginTop: '.4rem', width: '100%', padding: '.2rem', fontSize: '.72rem', borderRadius: 4, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', cursor: 'pointer' }}>
                                    {showAllIps ? '▲ Masquer' : `▾ + ${bannedRest.length} IP${bannedRest.length > 1 ? 's' : ''} bannies…`}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '.5rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                <span style={{ fontSize: '.72rem', color: '#8b949e' }}>
                    Total: <strong style={{ color: '#58a6ff' }}>{totalDisplay}</strong> bans · <strong style={{ color: '#e3b341' }}>{jail.totalFailed}</strong> échecs
                </span>
                {jail.currentlyBanned > 0 && (
                    <button onClick={onUnbanAll} disabled={!!actionLoading}
                        style={{ display: 'flex', alignItems: 'center', gap: '.3rem', padding: '.28rem .65rem', borderRadius: 4, background: 'rgba(232,106,101,.12)', border: '1px solid rgba(232,106,101,.3)', color: '#e86a65', cursor: 'pointer', fontSize: '.75rem', opacity: actionLoading ? .5 : 1 }}>
                        <Ban style={{ width: 10, height: 10 }} /> Tout débannir ({jail.currentlyBanned})
                    </button>
                )}
            </div>
        </div>
    );
};

// ── JailsTableView (Pulse) ────────────────────────────────────────────────────

const JailsTableView: React.FC<{
    jails: JailStatus[];
    days: number;
    actionLoading: string | null;
    onUnban: (jail: string, ip: string) => void;
    onBan:   (jail: string, ip: string) => void;
    onReload: (jail: string) => void;
}> = ({ jails, days, actionLoading, onUnban, onBan, onReload }) => {
    const [expanded,   setExpanded]   = useState<string | null>(null);
    const [editor,     setEditor]     = useState<ConfEditorTarget | null>(null);
    const [configJail, setConfigJail] = useState<string | null>(null);

    const openFilter = (name: string, jailName: string) => {
        setEditor({ type: 'filter', name, jails: [jailName] });
    };
    const openAction = (name: string, jailName: string) => {
        setEditor({ type: 'action', name, jails: [jailName] });
    };

    const bansLabel = days <= 0 ? 'Tous' : days === 1 ? '24h' : days === 7 ? '7j' : days === 30 ? '30j' : days === 180 ? '6m' : days === 365 ? '1an' : `${days}j`;

    const filtered = jails;

    const thStyle: React.CSSProperties = {
        padding: '.5rem .5rem', borderBottom: '1px solid #30363d',
        fontSize: '.67rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8b949e',
        whiteSpace: 'nowrap',
    };

    return (
        <>
        {editor && <ConfEditorModal target={editor} onClose={() => setEditor(null)} />}
        {configJail && <JailConfigModal jailName={configJail} isActive onClose={() => setConfigJail(null)} />}
        <div>
            <div style={{ ...card, overflowX: 'auto' }}>
                <table style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse', fontSize: '.84rem' }}>
                    <thead>
                        <tr style={{ background: '#21262d' }}>
                            <th style={{ ...thStyle, width: 10 }} />
                            <th style={{ ...thStyle, textAlign: 'left' }}>Jail</th>
                            <th style={{ ...thStyle, textAlign: 'left' }}>Port / Service</th>
                            <th style={{ ...thStyle, textAlign: 'center', color: '#e3b341', width: 58 }}>Échecs</th>
                            <th style={{ ...thStyle, textAlign: 'center', color: '#e86a65', width: 58 }}>Bannis</th>
                            <th style={{ ...thStyle, textAlign: 'center', color: '#39c5cf', width: 72 }}>Bans {bansLabel}</th>
                            <th style={{ ...thStyle, textAlign: 'center', color: '#58a6ff', width: 58 }}>Total</th>
                            <th style={{ ...thStyle, textAlign: 'center', width: 74 }}>Bantime</th>
                            <th style={{ ...thStyle, textAlign: 'left', width: 1 }}>Filtre</th>
                            <th style={{ ...thStyle, textAlign: 'left' }}>Action</th>
                            <th style={{ ...thStyle, width: 20 }} />
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(j => {
                            const isOpen = expanded === j.jail;
                            const isInactive = j.active === false;
                            const totalDisplay = j.totalBannedSqlite !== undefined ? j.totalBannedSqlite : j.totalBanned;
                            const portTokens = j.port ? j.port.split(/[\s,]+/).filter(Boolean) : [];
                            return (
                                <React.Fragment key={j.jail}>
                                    <tr
                                        style={{ background: isOpen ? 'rgba(88,166,255,.04)' : 'transparent', cursor: isInactive ? 'default' : 'pointer', borderBottom: '1px solid #30363d', opacity: isInactive ? 0.5 : 1 }}
                                        onClick={() => { if (!isInactive) setExpanded(e => e === j.jail ? null : j.jail); }}
                                        onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'; }}
                                        onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                                        <td style={{ padding: '.5rem .6rem' }}>
                                            <StatusDot banned={j.currentlyBanned} failed={j.currentlyFailed} />
                                        </td>
                                        <td style={{ padding: '.5rem .5rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
                                                <Shield style={{ width: 12, height: 12, color: isInactive ? '#8b949e' : j.currentlyBanned > 0 ? '#e86a65' : '#58a6ff', flexShrink: 0 }} />
                                                {j.jail}
                                                {isInactive && <span style={{ fontSize: '.6rem', padding: '.05rem .3rem', borderRadius: 3, background: 'rgba(139,148,158,.15)', border: '1px solid #30363d', color: '#8b949e', fontWeight: 400 }}>arrêté</span>}
                                            </span>
                                        </td>
                                        <td style={{ padding: '.5rem .5rem', whiteSpace: 'nowrap' }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.2rem', alignItems: 'center' }}>
                                                {portTokens.map(p => <Badge key={p} color="blue">{p}</Badge>)}
                                                {portTokens.length === 0 && <span style={{ color: '#8b949e', fontSize: '.78rem' }}>—</span>}
                                            </div>
                                        </td>
                                        <td style={{ padding: '.5rem .5rem', textAlign: 'center', whiteSpace: 'nowrap', color: j.currentlyFailed > 0 ? '#e3b341' : '#8b949e', fontWeight: j.currentlyFailed > 0 ? 700 : 400 }}>
                                            {j.currentlyFailed || '—'}
                                        </td>
                                        <td style={{ padding: '.5rem .5rem', textAlign: 'center', whiteSpace: 'nowrap', fontWeight: 700, color: j.currentlyBanned > 0 ? '#e86a65' : '#8b949e' }}>
                                            {j.currentlyBanned || '—'}
                                        </td>
                                        <td style={{ padding: '.5rem .5rem', textAlign: 'center', whiteSpace: 'nowrap', color: j.bansInPeriod !== undefined ? '#39c5cf' : '#8b949e' }}>
                                            {j.bansInPeriod !== undefined ? j.bansInPeriod : '—'}
                                        </td>
                                        <td style={{ padding: '.5rem .5rem', textAlign: 'center', whiteSpace: 'nowrap', color: '#58a6ff' }}>{totalDisplay || '—'}</td>
                                        <td style={{ padding: '.5rem .5rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                            {j.bantime !== undefined ? <Badge color="muted">{fmtSecs(j.bantime)}</Badge> : <span style={{ color: '#8b949e' }}>—</span>}
                                        </td>
                                        <td style={{ padding: '.5rem .5rem', whiteSpace: 'nowrap' }}>
                                            {j.filter
                                                ? <span onClick={e => { e.stopPropagation(); openFilter(j.filter!, j.jail); }} style={{ cursor: 'pointer' }} title="Voir / éditer le filtre"><Badge color="green">⚙ {j.filter}</Badge></span>
                                                : <span style={{ color: '#8b949e', fontSize: '.78rem' }}>—</span>}
                                        </td>
                                        <td style={{ padding: '.5rem .5rem', whiteSpace: 'nowrap' }}>
                                            {(j.actions?.length ?? 0) > 0
                                                ? <div style={{ display: 'flex', gap: '.2rem', flexWrap: 'nowrap' }}>
                                                    {j.actions!.slice(0, 2).map(a => (
                                                        <span key={a} onClick={e => { e.stopPropagation(); openAction(a, j.jail); }} style={{ cursor: 'pointer' }} title="Voir / éditer l'action">
                                                            <Badge color="orange">⚡ {a}</Badge>
                                                        </span>
                                                    ))}
                                                    {j.actions!.length > 2 && <Badge color="muted">+{j.actions!.length - 2}</Badge>}
                                                  </div>
                                                : j.banaction
                                                    ? <span onClick={e => { e.stopPropagation(); openAction(j.banaction!, j.jail); }} style={{ cursor: 'pointer' }} title="Voir / éditer l'action">
                                                        <Badge color="orange">⚡ {j.banaction}</Badge>
                                                      </span>
                                                    : <span style={{ color: '#8b949e', fontSize: '.78rem' }}>—</span>}
                                        </td>
                                        <td style={{ padding: '.5rem .6rem', textAlign: 'center' }}>
                                            {!isInactive && <ChevronRight style={{ width: 12, height: 12, color: '#8b949e', transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />}
                                        </td>
                                    </tr>
                                    {isOpen && (
                                        <tr style={{ borderBottom: '1px solid #30363d' }}>
                                            <td colSpan={11} style={{ padding: 0 }}>
                                                <JailExpandedGrid
                                                    jail={j}
                                                    actionLoading={actionLoading}
                                                    bansInPeriodLabel={bansLabel}
                                                    onUnban={ip => onUnban(j.jail, ip)}
                                                    onBan={ip => onBan(j.jail, ip)}
                                                    onReload={() => onReload(j.jail)}
                                                    onUnbanAll={() => j.bannedIps.forEach(ip => onUnban(j.jail, ip))}
                                                    onOpenConfig={() => setConfigJail(j.jail)}
                                                />
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                        {filtered.length === 0 && (
                            <tr><td colSpan={11} style={{ padding: '2rem', textAlign: 'center', color: '#8b949e', fontSize: '.85rem' }}>Aucun jail ne correspond au filtre</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
        </>
    );
};

// ── Vue fichiers log ──────────────────────────────────────────────────────────

const TabJailsFiles: React.FC = () => {
    const [files, setFiles]         = useState<string[]>([]);
    const [selected, setSelected]   = useState<string | null>(null);
    const [content, setContent]     = useState('');
    const [lines, setLines]         = useState(400);
    const [loading, setLoading]     = useState(true);
    const [tailLoading, setTailLoading] = useState(false);
    const [tailLoadedAt, setTailLoadedAt] = useState<number>(0);
    const [error, setError]         = useState<string | null>(null);
    const [truncated, setTruncated] = useState(false);

    useEffect(() => {
        api.get<{ ok: boolean; files: string[]; error?: string }>('/api/plugins/fail2ban/logs').then(res => {
            if (res.success && res.result?.ok && res.result.files?.length) {
                setFiles(res.result.files);
                setSelected(res.result.files[0]);
            } else {
                setError(res.result?.error ?? 'Aucun fichier log fail2ban sous /var/log.');
            }
            setLoading(false);
        });
    }, []);

    const fetchTail = useCallback(async (name: string, n: number) => {
        setTailLoading(true); setContent('');
        const res = await api.get<{ ok: boolean; content?: string; truncated?: boolean; error?: string }>(
            `/api/plugins/fail2ban/logs/tail?name=${encodeURIComponent(name)}&lines=${n}`
        );
        if (res.success && res.result?.ok) {
            setContent(res.result.content ?? '');
            setTruncated(!!res.result.truncated);
        } else {
            setContent(res.result?.error ?? 'Lecture impossible');
            setTruncated(false);
        }
        setTailLoading(false);
        setTailLoadedAt(Date.now());
    }, []);

    useEffect(() => { if (selected) fetchTail(selected, lines); }, [selected, lines, fetchTail]);

    return (
        <div style={{ display: 'flex', gap: '.75rem', height: 'calc(100vh - 220px)', minHeight: 400 }}>
            <div style={{ ...card, width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ ...cardH, fontSize: '.83rem', fontWeight: 600 }}>
                    <ScrollText style={{ width: 13, height: 13, color: '#8b949e' }} />
                    Fichiers log
                    {!loading && <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: '#8b949e' }}>{files.length}</span>}
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loading ? <div style={{ padding: '1rem', fontSize: '.8rem', color: '#8b949e' }}>Chargement…</div>
                    : error && !files.length ? <div style={{ padding: '1rem', fontSize: '.8rem', color: '#e86a65' }}>{error}</div>
                    : files.map(f => (
                        <button key={f} onClick={() => setSelected(f)}
                            style={{ width: '100%', textAlign: 'left', padding: '.4rem .75rem', fontSize: '.79rem', fontFamily: 'monospace', background: selected === f ? 'rgba(88,166,255,.08)' : 'transparent', color: selected === f ? '#58a6ff' : '#e6edf3', border: 'none', cursor: 'pointer' }}>
                            {f}
                        </button>
                    ))}
                </div>
            </div>
            <div style={{ ...card, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ ...cardH, fontSize: '.79rem', fontFamily: 'monospace', color: '#8b949e', flexWrap: 'wrap', gap: '.5rem' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selected ? `/var/log/${selected}` : 'Sélectionnez un fichier'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {tailLoadedAt > 0 && !tailLoading && (
                            <span style={{ fontSize: '.68rem', color: '#8b949e', whiteSpace: 'nowrap' }}>
                                ↻ {new Date(tailLoadedAt).toLocaleTimeString('fr-FR')}
                            </span>
                        )}
                        <span style={{ fontSize: '.72rem' }}>Lignes</span>
                        <select value={lines} onChange={e => setLines(Number(e.target.value))}
                            style={{ padding: '.2rem .4rem', fontSize: '.72rem', borderRadius: 4, background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3' }}>
                            {[200, 400, 800, 1500].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </div>
                </div>
                {truncated && (
                    <div style={{ padding: '.3rem 1rem', background: 'rgba(227,179,65,.07)', borderBottom: '1px solid rgba(227,179,65,.25)', fontSize: '.73rem', color: '#e3b341' }}>
                        Fichier volumineux — affichage des dernières lignes uniquement.
                    </div>
                )}
                <pre style={{ flex: 1, overflowY: 'auto', padding: '1rem', fontSize: '.78rem', fontFamily: 'monospace', color: '#e6edf3', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                    {tailLoading && !content ? 'Chargement…' : content || (selected ? '' : 'Sélectionnez un fichier')}
                </pre>
            </div>
        </div>
    );
};

// ── Vue événements (bans/unbans depuis audit SQLite) ──────────────────────────

type EvtType = 'all' | 'ban' | 'unban' | 'failed';
type SortCol = 'date' | 'ip' | 'jail' | 'failures' | 'bantime';
type SortDir = 'asc' | 'desc';
const EVT_LIMITS = [10, 25, 50, 100, 0];

const TabJailsEvents: React.FC = () => {
    const [bans, setBans]       = useState<BanEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch]   = useState('');
    const [type, setType]       = useState<EvtType>('all');
    const [limit, setLimit]     = useState(25);
    const [sortCol, setSortCol] = useState<SortCol>('date');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    useEffect(() => {
        api.get<{ ok: boolean; bans: BanEntry[] }>('/api/plugins/fail2ban/audit?limit=500').then(res => {
            if (res.success && res.result?.ok) setBans(res.result.bans ?? []);
            setLoading(false);
        });
    }, []);

    const toggleSort = (col: SortCol) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortCol(col); setSortDir('desc'); }
    };

    const processed = useMemo(() => {
        let rows = [...bans];
        // type filter (BanEntry only has ban info — treat bantime=0 as unban proxy)
        if (type === 'ban')    rows = rows.filter(b => b.bantime > 0);
        if (type === 'unban')  rows = rows.filter(b => b.bantime === 0);
        if (type === 'failed') rows = rows.filter(b => b.failures > 0 && b.bantime === 0);
        // search
        if (search) rows = rows.filter(b => b.ip.includes(search) || b.jail.includes(search));
        // sort
        rows.sort((a, b) => {
            let va: number | string, vb: number | string;
            if (sortCol === 'date')     { va = a.timeofban; vb = b.timeofban; }
            else if (sortCol === 'ip')  { va = a.ip; vb = b.ip; }
            else if (sortCol === 'jail'){ va = a.jail; vb = b.jail; }
            else if (sortCol === 'failures') { va = a.failures; vb = b.failures; }
            else { va = a.bantime; vb = b.bantime; }
            if (va < vb) return sortDir === 'asc' ? -1 : 1;
            if (va > vb) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return rows;
    }, [bans, type, search, sortCol, sortDir]);

    const banCount   = bans.filter(b => b.bantime > 0).length;
    const unbanCount = bans.filter(b => b.bantime === 0 && b.failures === 0).length;
    const failCount  = bans.filter(b => b.failures > 0 && b.bantime === 0).length;

    const displayed  = limit > 0 ? processed.slice(0, limit) : processed;

    const sortIcon = (col: SortCol) => (
        <span style={{ marginLeft: '.25rem', color: sortCol === col ? '#58a6ff' : '#30363d' }}>
            {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
    );

    const thS = (col: SortCol, label: string, textAlign: 'left' | 'center' = 'left'): React.ReactNode => (
        <th onClick={() => toggleSort(col)} style={{ padding: '.45rem .65rem', borderBottom: '1px solid #30363d', fontSize: '.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8b949e', textAlign, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
            {label}{sortIcon(col)}
        </th>
    );

    const filterBtnStyle = (active: boolean, color: string): React.CSSProperties => ({
        padding: '.1rem .45rem', fontSize: '.68rem', borderRadius: 4, cursor: 'pointer',
        border: `1px solid ${active ? color + '80' : '#30363d'}`,
        background: active ? color + '20' : 'transparent',
        color: active ? color : '#8b949e',
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {/* Header with badges + search + controls */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.5rem' }}>
                <span style={{ fontWeight: 600, fontSize: '.85rem', color: '#8b949e', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                    <List style={{ width: 13, height: 13, color: '#58a6ff' }} />
                    Derniers événements
                </span>
                {/* Badge counters */}
                <span style={{ padding: '.1rem .45rem', borderRadius: 12, fontSize: '.68rem', background: 'rgba(232,106,101,.15)', color: '#e86a65', border: '1px solid rgba(232,106,101,.4)' }}>
                    🔨 {banCount} ban
                </span>
                <span style={{ padding: '.1rem .45rem', borderRadius: 12, fontSize: '.68rem', background: 'rgba(63,185,80,.12)', color: '#3fb950', border: '1px solid rgba(63,185,80,.4)' }}>
                    🔓 {unbanCount} unban
                </span>
                <span style={{ padding: '.1rem .45rem', borderRadius: 12, fontSize: '.68rem', background: 'rgba(227,179,65,.12)', color: '#e3b341', border: '1px solid rgba(227,179,65,.4)' }}>
                    ⚠ {failCount} tentative
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap' }}>
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="IP, jail…"
                        style={{ padding: '.3rem .65rem', fontSize: '.8rem', borderRadius: 5, background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3', outline: 'none', width: 160 }} />
                    {/* Limit buttons */}
                    <div style={{ display: 'flex', gap: '.2rem' }}>
                        {EVT_LIMITS.map(l => (
                            <button key={l} onClick={() => setLimit(l)} style={filterBtnStyle(limit === l, '#58a6ff')}>
                                {l === 0 ? 'Tous' : l}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Type filter buttons */}
            <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
                <button onClick={() => setType('all')}    style={filterBtnStyle(type === 'all',    '#8b949e')}>Tous</button>
                <button onClick={() => setType('ban')}    style={filterBtnStyle(type === 'ban',    '#e86a65')}>🔨 Ban</button>
                <button onClick={() => setType('unban')}  style={filterBtnStyle(type === 'unban',  '#3fb950')}>🔓 Unban</button>
                <button onClick={() => setType('failed')} style={filterBtnStyle(type === 'failed', '#e3b341')}>⚠ Tentative</button>
                <span style={{ marginLeft: '.5rem', fontSize: '.72rem', color: '#8b949e' }}>{displayed.length} / {bans.length} événements</span>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e' }}>Chargement…</div>
            ) : displayed.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e' }}>
                    {search || type !== 'all' ? 'Aucun événement ne correspond aux filtres.' : 'Aucun événement en base SQLite.'}
                </div>
            ) : (
                <div style={{ ...card, overflowX: 'auto' }}>
                    <table style={{ width: '100%', minWidth: 600, borderCollapse: 'collapse', fontSize: '.82rem' }}>
                        <thead>
                            <tr style={{ background: '#21262d' }}>
                                {thS('date', 'Horodatage')}
                                {thS('ip', 'IP')}
                                {thS('jail', 'Jail')}
                                {thS('failures', 'Tentatives', 'center')}
                                {thS('bantime', 'Durée ban', 'center')}
                            </tr>
                        </thead>
                        <tbody>
                            {displayed.map((b, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid #30363d' }}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                                    <td style={{ padding: '.4rem .65rem', color: '#8b949e', fontFamily: 'monospace', fontSize: '.77rem', whiteSpace: 'nowrap' }}>{fmtTs(b.timeofban)}</td>
                                    <td style={{ padding: '.4rem .65rem', fontFamily: 'monospace', color: '#e86a65', fontWeight: 600 }}>{b.ip}</td>
                                    <td style={{ padding: '.4rem .65rem' }}>
                                        <Badge color="blue">{b.jail}</Badge>
                                    </td>
                                    <td style={{ padding: '.4rem .65rem', textAlign: 'center', color: '#e3b341' }}>{b.failures || '—'}</td>
                                    <td style={{ padding: '.4rem .65rem', textAlign: 'center', color: '#8b949e', fontSize: '.77rem' }}>
                                        {b.bantime > 0 ? fmtSecs(b.bantime) : <span style={{ color: '#3fb950' }}>unban</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {limit > 0 && processed.length > limit && (
                        <div style={{ padding: '.5rem 1rem', fontSize: '.73rem', color: '#8b949e', borderTop: '1px solid #30363d' }}>
                            Affichage des {limit} premiers sur {processed.length} événements.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ── TabJails (orchestrateur) ──────────────────────────────────────────────────

const viewBtnStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: '.4rem',
    padding: '.35rem .65rem', fontSize: '.78rem', fontWeight: 500,
    borderRadius: 5, border: 'none', cursor: 'pointer',
    background: active ? 'rgba(88,166,255,.15)' : 'transparent',
    color: active ? '#58a6ff' : '#8b949e',
    transition: 'color .12s, background .12s',
});

export const TabJails: React.FC<TabJailsProps> = ({
    jails, inactiveJails = [], loading, statusOk, statusError, actionLoading,
    days = 1, onUnban, onBan, onReload,
}) => {
    const [showAll, setShowAll]     = useState(false);
    const [jailFilter, setJailFilter] = useState('');
    const [view, setView] = useState<JailsViewMode>(() => {
        try {
            const v = localStorage.getItem(STORAGE_KEY);
            if (v === 'cards' || v === 'table' || v === 'logs' || v === 'events') return v;
        } catch { /* ignore */ }
        return 'table';
    });

    useEffect(() => {
        try { localStorage.setItem(STORAGE_KEY, view); } catch { /* ignore */ }
    }, [view]);

    if (loading && jails.length === 0) return <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e' }}>Chargement…</div>;
    if (!loading && jails.length === 0) return (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e' }}>
            {statusOk === false ? (statusError ?? 'fail2ban non disponible — vérifiez le plugin dans Paramètres') : 'Aucun jail trouvé'}
        </div>
    );

    const allJails     = showAll ? [...jails, ...inactiveJails] : jails;
    const displayJails = jailFilter
        ? allJails.filter(j => j.jail.toLowerCase().includes(jailFilter.toLowerCase()) || (j.filter ?? '').toLowerCase().includes(jailFilter.toLowerCase()))
        : allJails;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: '.25rem' }}>
                    <button style={viewBtnStyle(view === 'table')}  onClick={() => setView('table')}><Table2 style={{ width: 13, height: 13 }} /> Tableau</button>
                    <button style={viewBtnStyle(view === 'cards')}  onClick={() => setView('cards')}><LayoutGrid style={{ width: 13, height: 13 }} /> Cartes</button>
                    <button style={viewBtnStyle(view === 'events')} onClick={() => setView('events')}><List style={{ width: 13, height: 13 }} /> Événements</button>
                    <button style={viewBtnStyle(view === 'logs')}   onClick={() => setView('logs')}><ScrollText style={{ width: 13, height: 13 }} /> Fichiers log</button>
                </div>
                {inactiveJails.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.3rem', background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: '.25rem' }}>
                        <button onClick={() => setShowAll(false)} style={viewBtnStyle(!showAll)}>
                            Actifs
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 16, padding: '0 .3rem', borderRadius: 10, fontSize: '.63rem', fontWeight: 700, background: !showAll ? 'rgba(88,166,255,.3)' : 'rgba(139,148,158,.2)', color: !showAll ? '#58a6ff' : '#8b949e', marginLeft: '.15rem' }}>{jails.length}</span>
                        </button>
                        <button onClick={() => setShowAll(true)} style={viewBtnStyle(showAll)}>
                            Tous
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 16, padding: '0 .3rem', borderRadius: 10, fontSize: '.63rem', fontWeight: 700, background: showAll ? 'rgba(88,166,255,.3)' : 'rgba(139,148,158,.2)', color: showAll ? '#58a6ff' : '#8b949e', marginLeft: '.15rem' }}>{jails.length + inactiveJails.length}</span>
                        </button>
                    </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                    <input type="text" value={jailFilter} onChange={e => setJailFilter(e.target.value)}
                        placeholder="Filtrer jails…"
                        style={{ padding: '.3rem .6rem', fontSize: '.78rem', borderRadius: 5, background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3', outline: 'none', width: 170 }} />
                    {jailFilter && (
                        <>
                            <span style={{ fontSize: '.73rem', color: '#8b949e' }}>{displayJails.length} / {allJails.length}</span>
                            <button onClick={() => setJailFilter('')} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '.8rem', padding: '0 .2rem', lineHeight: 1 }}>✕</button>
                        </>
                    )}
                </div>
            </div>

            {/* Views */}
            {view === 'cards' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(380px,1fr))', gap: '1.25rem' }}>
                    {displayJails.map(jail => (
                        <JailCard key={jail.jail} jail={jail} actionLoading={actionLoading}
                            onUnban={ip => onUnban(jail.jail, ip)}
                            onBan={ip => onBan(jail.jail, ip)}
                            onReload={() => onReload(jail.jail)} />
                    ))}
                </div>
            )}
            {view === 'table' && (
                <JailsTableView jails={displayJails} days={days} actionLoading={actionLoading}
                    onUnban={onUnban} onBan={onBan} onReload={onReload} />
            )}
            {view === 'events' && <TabJailsEvents />}
            {view === 'logs'   && <TabJailsFiles />}
        </div>
    );
};
