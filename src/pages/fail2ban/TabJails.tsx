/**
 * TabJails — Onglet Jails.
 * Vue Cartes / Tableau (4-col expand) / Événements / Fichiers log.
 * Aligné sur tabs/jails.php du projet PHP Fail2ban-web.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Shield, Ban, Unlock, RotateCcw, AlertTriangle,
    LayoutGrid, Table2, ScrollText, List, ChevronRight, ChevronDown,
    Settings, Terminal, Clock, Plus,
} from 'lucide-react';
import { api } from '../../api/client';
import { card, cardH, Badge, StatusDot, fmtSecs, fmtTs, F2bTooltip, type F2bTtColor } from './helpers';
import { ConfEditorModal } from './ConfEditorModal';
import type { ConfEditorTarget } from './ConfEditorModal';
import { JailConfigModal } from './JailConfigModal';
import { NewJailModal } from './NewJailModal';
import type { JailStatus, BanEntry, AttemptEntry } from './types';
import { DomainInitial } from './DomainInitial';
import { FlagImg } from './FlagImg';

// ── Module-level cache (survives tab navigation) ──────────────────────────────
const _cache: Record<string, { data: unknown; ts: number }> = {};
const CACHE_TTL  = 30_000;
const ENRICH_TTL = 300_000; // 5 min — jail configs rarely change
function isValidIpOrCidr(s: string): boolean {
    const v = s.trim();
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return v.split('.').every(n => +n >= 0 && +n <= 255);
    const m4 = v.match(/^((\d{1,3}\.){3}\d{1,3})\/(\d{1,2})$/);
    if (m4) return m4[1].split('.').every(n => +n <= 255) && +m4[3] <= 32;
    if (v.includes(':') && /^[0-9a-fA-F:]{2,39}$/.test(v)) return true;
    const m6 = v.match(/^([0-9a-fA-F:]+)\/(\d{1,3})$/);
    if (m6 && m6[1].includes(':')) return +m6[2] <= 128;
    return false;
}
function getCached<T>(key: string): T | null { const e = _cache[key]; return (e && Date.now() - e.ts < CACHE_TTL) ? e.data as T : null; }
function getCachedTTL<T>(key: string, ttl: number): T | null { const e = _cache[key]; return (e && Date.now() - e.ts < ttl) ? e.data as T : null; }
function setCached(key: string, data: unknown) { _cache[key] = { data, ts: Date.now() }; }

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TabJailsProps {
    jails: JailStatus[];
    inactiveJails?: JailStatus[];
    /** After the first /status response (success or failure); avoids blocking on /history. */
    statusHydrated: boolean;
    statusOk?: boolean;
    statusError?: string;
    actionLoading: string | null;
    days?: number;
    onUnban: (jail: string, ip: string) => void;
    onBan:   (jail: string, ip: string) => void;
    onReload: (jail: string) => void;
    onIpClick?: (ip: string) => void;
    onJailCreated?: () => void;
}

type JailsViewMode = 'cards' | 'table' | 'events';
const STORAGE_KEY = 'logviewr-fail2ban-jails-view';


// ── Shared helpers ────────────────────────────────────────────────────────────

const timingBadge = (label: string, value: string | number, color: string): React.ReactNode => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.18rem', padding: '2px 6px', borderRadius: 4, fontSize: '.67rem', border: `1px solid rgba(${color === '#e86a65' ? '232,106,101' : color === '#e3b341' ? '227,179,65' : '88,166,255'},.3)`, background: `rgba(${color === '#e86a65' ? '232,106,101' : color === '#e3b341' ? '227,179,65' : '88,166,255'},.08)`, color }}>
        <span style={{ color: '#8b949e' }}>{label}</span>
        <strong>{value}</strong>
    </span>
);

// ── Rules toggle (Règles de détection) ────────────────────────────────────────

const RulesToggle: React.FC<{ filter: string }> = ({ filter }) => {
    const { t } = useTranslation();
    const [open, setOpen]       = useState(false);
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        const res = await api.get<{ ok: boolean; content: string }>(`/api/plugins/fail2ban/filters/${filter}.conf`);
        setContent(res.success && res.result?.ok ? res.result.content : t('fail2ban.errors.fileNotAvailable'));
        setLoading(false);
    }, [filter, t]);

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
                <span>{t('fail2ban.jails.rulesToggle')}</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: '.68rem', color: '#30363d' }}>{filter}.conf</span>
                {open ? <ChevronDown style={{ width: 11, height: 11 }} /> : <ChevronRight style={{ width: 11, height: 11 }} />}
            </button>
            {open && (
                <div style={{ padding: '.5rem .75rem .75rem', background: 'rgba(13,17,23,.4)' }}>
                    {loading ? (
                        <div style={{ color: '#8b949e', fontSize: '.77rem' }}>{t('fail2ban.status.loading')}</div>
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
    bansInPeriodLabel: string;
    onUnban: (ip: string) => void;
    onBan:   (ip: string) => void;
    onReload: () => void;
    onIpClick?: (ip: string) => void;
}> = ({ jail, actionLoading, bansInPeriodLabel, onUnban, onBan, onReload, onIpClick }) => {
    const { t } = useTranslation();
    const [banIp, setBanIp] = useState('');
    const [ipFilter, setIpFilter] = useState('');
    const [editor, setEditor] = useState<ConfEditorTarget | null>(null);
    const [configOpen, setConfigOpen] = useState(false);
    const [hostnames, setHostnames] = useState<Record<string, string>>({});
    const [logModal, setLogModal] = useState(false);
    const [recentBans, setRecentBans] = useState<BanEntry[]>([]);
    const reloadKey = `reload-${jail.jail}`;

    useEffect(() => {
        if (!jail.bannedIps.length) return;
        const ips = jail.bannedIps.join(',');
        api.get<Record<string, string>>(`/api/plugins/fail2ban/dns/batch?ips=${encodeURIComponent(ips)}`)
            .then(res => { if (res.success && res.result) setHostnames(res.result); });
    }, [jail.bannedIps.join(',')]);

    useEffect(() => {
        const since = Math.floor(Date.now() / 1000) - 300;
        api.get<{ ok: boolean; bans: BanEntry[] }>(`/api/plugins/fail2ban/audit?limit=50&jail=${encodeURIComponent(jail.jail)}`)
            .then(res => {
                if (res.success && res.result?.ok) {
                    setRecentBans((res.result.bans ?? []).filter(b => b.timeofban >= since));
                }
            });
    }, [jail.jail]);

    const PILLS = {
        red:    { bg: 'rgba(248,81,73,.18)',   color: '#e86a65', border: 'rgba(248,81,73,.35)'   },
        orange: { bg: 'rgba(210,153,34,.18)',  color: '#e3b341', border: 'rgba(210,153,34,.35)'  },
        green:  { bg: 'rgba(63,185,80,.15)',   color: '#3fb950', border: 'rgba(63,185,80,.3)'    },
        blue:   { bg: 'rgba(88,166,255,.15)',  color: '#58a6ff', border: 'rgba(88,166,255,.3)'   },
        purple: { bg: 'rgba(188,140,255,.15)', color: '#bc8cff', border: 'rgba(188,140,255,.3)'  },
    };
    const pill = (_p: keyof typeof PILLS, _icon: React.ReactNode, lbl: string, val: React.ReactNode) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.18rem', padding: '2px 6px', borderRadius: 4, fontSize: '.67rem', border: `1px solid ${PILLS[_p].border}`, background: PILLS[_p].bg, color: PILLS[_p].color }}>
            <span style={{ color: '#8b949e' }}>{lbl}</span>
            <strong>{val}</strong>
        </span>
    );

    const hasThreat   = jail.currentlyFailed > 0 && (jail.maxretry ?? 0) > 0;
    const threatRatio = hasThreat ? Math.min(1, jail.currentlyFailed / jail.maxretry!) : 0;
    const threatPct   = Math.round(threatRatio * 100);
    const threatColor = threatRatio < .5 ? '#3fb950' : threatRatio < 1 ? '#e3b341' : '#e86a65';

    const totalDisplay   = jail.totalBannedSqlite !== undefined ? jail.totalBannedSqlite : jail.totalBanned;
    const bansInPeriod   = jail.bansInPeriod;
    const filteredIps    = ipFilter ? jail.bannedIps.filter(ip => ip.includes(ipFilter)) : jail.bannedIps;
    const stateColor     = jail.currentlyBanned > 0 ? '#e86a65' : jail.currentlyFailed > 0 ? '#e3b341' : '#238636';

    return (
        <>
        {editor && <ConfEditorModal target={editor} onClose={() => setEditor(null)} />}
        {configOpen && <JailConfigModal jailName={jail.jail} isActive onClose={() => setConfigOpen(false)} />}
        {logModal && jail.fileList && (() => {
            const files = jail.fileList.split(/\s+/).filter(Boolean);
            return (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
                    onClick={() => setLogModal(false)}>
                    <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, maxWidth: 560, width: '100%', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.6)' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ background: '#21262d', padding: '.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #30363d' }}>
                            <span style={{ fontWeight: 700, fontSize: '.9rem', color: '#e6edf3', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                                📄 {t('fail2ban.jails.logFiles')} — <span style={{ color: '#58a6ff' }}>{jail.jail.toUpperCase()}</span>
                                <span style={{ fontWeight: 400, fontSize: '.75rem', color: '#8b949e' }}>({t('fail2ban.jails.fileCount', { count: files.length })})</span>
                            </span>
                            <button onClick={() => setLogModal(false)} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>✕</button>
                        </div>
                        <div style={{ padding: '.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '.4rem', maxHeight: 360, overflowY: 'auto' }}>
                            {files.map((f, i) => (
                                <div key={i} style={{ padding: '.35rem .65rem', borderRadius: 5, background: 'rgba(88,166,255,.05)', border: '1px solid rgba(88,166,255,.15)', fontFamily: 'monospace', fontSize: '.78rem', color: '#e6edf3', wordBreak: 'break-all' }}>
                                    <span style={{ color: '#8b949e' }}>{f.replace(/\/[^/]+$/, '/')}</span><span style={{ color: '#58a6ff', fontWeight: 600 }}>{f.replace(/.*\//, '')}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            );
        })()}
        <div style={{ ...card, borderLeft: `4px solid ${stateColor}`, display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ ...cardH, background: '#21262d' }}>
                <StatusDot banned={jail.currentlyBanned} failed={jail.currentlyFailed} />
                <Shield style={{ width: 13, height: 13, color: jail.currentlyBanned > 0 ? '#e86a65' : '#58a6ff', flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: '.88rem', flex: 1 }}>{jail.jail.toUpperCase()}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.72rem', color: '#8b949e' }}>
                    {jail.bantime  !== undefined && <F2bTooltip title={t('fail2ban.labels.bantime')}  body={t('fail2ban.tooltips.bantime')}  color="cyan"><span>⏱ {fmtSecs(jail.bantime, t)}</span></F2bTooltip>}
                    {jail.findtime !== undefined && <F2bTooltip title={t('fail2ban.labels.findtime')} body={t('fail2ban.tooltips.findtime')} color="orange"><span>👁 {fmtSecs(jail.findtime, t)}</span></F2bTooltip>}
                    {jail.maxretry !== undefined && <F2bTooltip title={t('fail2ban.labels.maxretry')} body={t('fail2ban.tooltips.maxretry')} color="blue"><span>{jail.maxretry}×</span></F2bTooltip>}
                </div>
            </div>

            {/* Stats pills */}
            <div style={{ padding: '.45rem .75rem', borderBottom: '1px solid #30363d', display: 'flex', gap: '.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {pill('purple', <Shield style={{ width: 10, height: 10 }} />,        t('fail2ban.jails.total'),   totalDisplay || '—')}
                {pill('red',    <Ban style={{ width: 10, height: 10 }} />,           t('fail2ban.jails.activeOnly'),  jail.currentlyBanned)}
                {pill('orange', <AlertTriangle style={{ width: 10, height: 10 }} />, t('fail2ban.labels.failures'),  jail.currentlyFailed)}
                {pill('green',  <Clock style={{ width: 10, height: 10 }} />,         t('fail2ban.jails.last5min'),   recentBans.length || '—')}
                <span style={{ color: '#30363d', margin: '0 2px' }}>·</span>
                {pill('blue',   <Clock style={{ width: 10, height: 10 }} />,         bansInPeriodLabel, bansInPeriod !== undefined ? bansInPeriod : '—')}
            </div>

            {/* Threat bar */}
            {hasThreat && (
                <div style={{ padding: '.45rem 1rem .3rem', borderBottom: '1px solid #30363d' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.2rem', fontSize: '.73rem' }}>
                        <span style={{ color: threatColor, fontWeight: 600 }}>{jail.currentlyFailed} / {jail.maxretry} {t('fail2ban.jails.attemptsWord')}</span>
                        {threatRatio >= 1
                            ? <span style={{ color: '#e86a65', fontWeight: 700 }}>{t('fail2ban.jails.imminentBan')}</span>
                            : <span style={{ color: threatColor }}>{t('fail2ban.jails.remaining', { count: jail.maxretry! - jail.currentlyFailed })}</span>}
                    </div>
                    <div style={{ background: '#2d333b', borderRadius: 3, height: 5, overflow: 'hidden' }}>
                        <div style={{ width: `${threatPct}%`, height: '100%', background: threatColor, borderRadius: 3, transition: 'width .2s' }} />
                    </div>
                </div>
            )}

            {/* Meta badges */}
            {(jail.filter || jail.port || (jail.actions?.length ?? 0) > 0 || jail.banaction || jail.fileList) && (
                <div style={{ padding: '.4rem .75rem', borderBottom: '1px solid #30363d', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                    {jail.filter && (
                        <div>
                            <span onClick={() => setEditor({ type: 'filter', name: jail.filter!, jails: [jail.jail] })} style={{ cursor: 'pointer' }} title={t('fail2ban.jails.editFilter')}>
                                <Badge color="green">{jail.filter}</Badge>
                            </span>
                        </div>
                    )}
                    {jail.port && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                            {jail.port.split(/[\s,]+/).filter(Boolean).map(p => p === '0:65535'
                                ? <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: '.2rem', padding: '1px 6px', borderRadius: 4, fontSize: '.72rem', fontWeight: 600, background: 'rgba(88,166,255,.18)', border: '1px solid rgba(88,166,255,.5)', color: '#58a6ff', letterSpacing: '.02em' }}>⬡ all ports</span>
                                : <Badge key={p} color="blue">⬡ {p}</Badge>
                            )}
                        </div>
                    )}
                    {(jail.actions?.length || jail.banaction) && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                            {jail.actions?.map(a => (
                                <span key={a} onClick={() => setEditor({ type: 'action', name: a, jails: [jail.jail] })} style={{ cursor: 'pointer' }} title={t('fail2ban.jails.editAction')}>
                                    <Badge color="orange">⚡ {a}</Badge>
                                </span>
                            ))}
                            {!jail.actions?.length && jail.banaction && (
                                <span onClick={() => setEditor({ type: 'action', name: jail.banaction!, jails: [jail.jail] })} style={{ cursor: 'pointer' }} title={t('fail2ban.jails.editAction')}>
                                    <Badge color="red">⚡ {jail.banaction}</Badge>
                                </span>
                            )}
                        </div>
                    )}
                    {jail.fileList && (() => {
                        const files = jail.fileList.split(/\s+/).filter(Boolean);
                        return (
                            <div>
                                <span onClick={e => { e.stopPropagation(); setLogModal(true); }} style={{ cursor: 'pointer' }}>
                                    <Badge color="muted">📄 {t('fail2ban.jails.logCount', { count: files.length })}</Badge>
                                </span>
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* Paramètres bar */}
            <div style={{ padding: '.3rem .75rem', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                {jail.bantime  !== undefined && timingBadge('ban',   fmtSecs(jail.bantime, t),  '#e86a65')}
                {jail.findtime !== undefined && timingBadge('find',  fmtSecs(jail.findtime, t), '#e3b341')}
                {jail.maxretry !== undefined && timingBadge('retry', `${jail.maxretry}×`,    '#58a6ff')}
            </div>

            {/* Banned IPs table */}
            {jail.bannedIps.length > 0 ? (
                <div>
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
                                        <td style={{ padding: '.3rem .5rem' }}>
                                            <button onClick={() => onIpClick?.(ip)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: '.8rem', color: '#e6edf3', fontWeight: 600 }}>
                                                {ip}
                                            </button>
                                        </td>
                                        <td style={{ padding: '.3rem .5rem', textAlign: 'right' }}>
                                            <button onClick={() => onUnban(ip)} disabled={actionLoading === `unban-${jail.jail}-${ip}`}
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: '.2rem', padding: '.18rem .4rem', borderRadius: 4, background: 'rgba(63,185,80,.1)', border: '1px solid rgba(63,185,80,.25)', color: '#3fb950', cursor: 'pointer', fontSize: '.68rem', opacity: actionLoading === `unban-${jail.jail}-${ip}` ? .5 : 1 }}>
                                                <Unlock style={{ width: 9, height: 9 }} /> Unban
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {filteredIps.length === 0 && ipFilter && (
                                    <tr><td colSpan={3} style={{ padding: '.5rem', textAlign: 'center', color: '#8b949e', fontSize: '.77rem' }}>{t('fail2ban.jails.noResults')}</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                <div style={{ padding: '.75rem 1rem', color: '#8b949e', fontSize: '.8rem', fontStyle: 'italic', textAlign: 'center' }}>
                    ✓ {t('fail2ban.jails.noClientBanned')}
                </div>
            )}

            {/* Ban IP form — always at bottom */}
            <div style={{ padding: '.5rem .75rem', borderTop: '1px solid #30363d', background: 'rgba(13,17,23,.3)', marginTop: 'auto' }}>
                <form onSubmit={e => {
                    e.preventDefault();
                    const ip = banIp.trim();
                    if (!ip || !isValidIpOrCidr(ip)) return;
                    onBan(ip); setBanIp('');
                }} style={{ display: 'flex', gap: '.4rem', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', gap: '.4rem' }}>
                    <input type="text" value={banIp} onChange={e => setBanIp(e.target.value)}
                        placeholder={t('fail2ban.placeholders.ipToBan')}
                        style={{ flex: 1, padding: '.28rem .55rem', fontSize: '.78rem', fontFamily: 'monospace', borderRadius: 4, background: '#161b22', border: `1px solid ${banIp.trim() && !isValidIpOrCidr(banIp.trim()) ? '#e86a65' : '#30363d'}`, borderBottom: `1px solid ${banIp.trim() && !isValidIpOrCidr(banIp.trim()) ? '#e86a65' : '#555'}`, color: '#e6edf3', outline: 'none', minWidth: 0, boxShadow: 'inset 0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(0,0,0,.4), inset 0 -1px 0 rgba(255,255,255,.04)', transition: 'border-color .15s' }}
                        onFocus={e => (e.currentTarget.style.borderColor = '#58a6ff')}
                        onBlur={e => (e.currentTarget.style.borderColor = banIp.trim() && !isValidIpOrCidr(banIp.trim()) ? '#e86a65' : '#30363d')} />
                    <button type="submit" disabled={!banIp.trim() || !isValidIpOrCidr(banIp.trim()) || !!actionLoading}
                        style={{ display: 'flex', alignItems: 'center', gap: '.25rem', padding: '.28rem .65rem', borderRadius: 4, background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.25)', color: '#e86a65', cursor: 'pointer', fontSize: '.75rem', opacity: !banIp.trim() || !isValidIpOrCidr(banIp.trim()) || !!actionLoading ? .5 : 1 }}>
                        <Ban style={{ width: 10, height: 10 }} /> Ban
                    </button>
                    </div>
                    {banIp.trim() && !isValidIpOrCidr(banIp.trim()) && (
                        <span style={{ fontSize: '.68rem', color: '#e86a65' }}>{t('fail2ban.jails.invalidFormat')}</span>
                    )}
                    <button type="button" onClick={() => setConfigOpen(true)}
                        style={{ display: 'flex', alignItems: 'center', gap: '.25rem', padding: '.28rem .55rem', borderRadius: 4, background: 'rgba(188,140,255,.08)', border: '1px solid rgba(188,140,255,.3)', color: '#bc8cff', cursor: 'pointer', fontSize: '.72rem' }}>
                        <Settings style={{ width: 10, height: 10 }} />
                    </button>
                </form>
            </div>
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
    onIpClick?: (ip: string) => void;
}> = ({ jail, actionLoading, bansInPeriodLabel, onUnban, onBan, onReload, onUnbanAll, onOpenConfig, onIpClick }) => {
    const { t } = useTranslation();
    const [banIp, setBanIp]               = useState('');
    const [showAllIps, setShowAllIps]     = useState(false);
    const [showAllRecent, setShowAllRecent] = useState(false);
    const [recentBans, setRecentBans] = useState<BanEntry[]>([]);
    const [logsOpen, setLogsOpen]     = useState(false);
    const [hostnames, setHostnames]   = useState<Record<string, string>>({});
    const [editor, setEditor]         = useState<ConfEditorTarget | null>(null);
    const reloadKey = `reload-${jail.jail}`;

    useEffect(() => {
        if (!jail.bannedIps.length) return;
        const ips = jail.bannedIps.join(',');
        api.get<Record<string, string>>(`/api/plugins/fail2ban/dns/batch?ips=${encodeURIComponent(ips)}`)
            .then(res => { if (res.success && res.result) setHostnames(res.result); });
    }, [jail.bannedIps.join(',')]);

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

    const bannedShow = jail.bannedIps.slice(0, 10);
    const bannedRest = jail.bannedIps.slice(10);

    // Exact PHP .jdp-pill style
    const PILLS = {
        red:    { bg: 'rgba(248,81,73,.18)',   color: '#e86a65', border: 'rgba(248,81,73,.35)'   },
        orange: { bg: 'rgba(210,153,34,.18)',  color: '#e3b341', border: 'rgba(210,153,34,.35)'  },
        green:  { bg: 'rgba(63,185,80,.15)',   color: '#3fb950', border: 'rgba(63,185,80,.3)'    },
        blue:   { bg: 'rgba(88,166,255,.15)',  color: '#58a6ff', border: 'rgba(88,166,255,.3)'   },
        purple: { bg: 'rgba(188,140,255,.15)', color: '#bc8cff', border: 'rgba(188,140,255,.3)'  },
    };
    const pill = (_p: keyof typeof PILLS, _icon: React.ReactNode, lbl: string, val: React.ReactNode) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.18rem', padding: '2px 6px', borderRadius: 4, fontSize: '.67rem', border: `1px solid ${PILLS[_p].border}`, background: PILLS[_p].bg, color: PILLS[_p].color }}>
            <span style={{ color: '#8b949e' }}>{lbl}</span>
            <strong>{val}</strong>
        </span>
    );

    const colTitle = (text: string, color: string, icon: React.ReactNode): React.ReactNode => (
        <div style={{ fontSize: '.75rem', fontWeight: 700, color, marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: '.35rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {icon} {text}
        </div>
    );

    return (
        <>
        {editor && <ConfEditorModal target={editor} onClose={() => setEditor(null)} />}
        <div style={{ background: 'rgba(20,30,48,.95)', padding: '0' }}>

            {/* 4-column grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0', borderBottom: '1px solid #30363d' }}>

                {/* Col 1: Configuration */}
                <div style={{ padding: '.75rem 1rem', borderRight: '1px solid #30363d' }}>
                    <div style={{ fontSize: '.75rem', fontWeight: 700, color: '#8b949e', marginBottom: '.6rem', display: 'flex', alignItems: 'center', gap: '.35rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        <Settings style={{ width: 11, height: 11 }} /> {t('fail2ban.jails.configuration')}
                        <button onClick={onOpenConfig}
                            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.25rem', padding: '.2rem .5rem', borderRadius: 4, background: 'rgba(188,140,255,.08)', border: '1px solid rgba(188,140,255,.3)', color: '#bc8cff', cursor: 'pointer', fontSize: '.7rem', fontWeight: 600, textTransform: 'none', letterSpacing: 'normal' }}>
                            <Settings style={{ width: 9, height: 9 }} /> {t('fail2ban.jails.configure')}
                        </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.78rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: '#8b949e' }}>{t('fail2ban.jails.filter')}</span>
                            {jail.filter
                                ? <span onClick={() => setEditor({ type: 'filter', name: jail.filter!, jails: [jail.jail] })} style={{ cursor: 'pointer' }} title={t('fail2ban.jails.editFilter')}><Badge color="green">{jail.filter}</Badge></span>
                                : <span style={{ color: '#8b949e' }}>—</span>}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '.3rem' }}>
                            <span style={{ color: '#8b949e', flexShrink: 0 }}>{t('fail2ban.jails.action')}</span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.2rem', justifyContent: 'flex-end' }}>
                                {jail.actions?.map(a => <span key={a} onClick={() => setEditor({ type: 'action', name: a, jails: [jail.jail] })} style={{ cursor: 'pointer' }} title={t('fail2ban.jails.editAction')}><Badge color="orange">⚡ {a}</Badge></span>)}
                                {!jail.actions?.length && jail.banaction && <span onClick={() => setEditor({ type: 'action', name: jail.banaction!, jails: [jail.jail] })} style={{ cursor: 'pointer' }} title={t('fail2ban.jails.editAction')}><Badge color="orange">⚡ {jail.banaction}</Badge></span>}
                                {!jail.actions?.length && !jail.banaction && <span style={{ color: '#8b949e' }}>—</span>}
                            </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span style={{ color: '#8b949e' }}>{t('fail2ban.jails.status')}</span>
                            <span style={{ color: '#3fb950', fontSize: '.72rem', display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#3fb950', flexShrink: 0 }} /> {t('fail2ban.jails.active')}
                            </span>
                        </div>
                    </div>
                    <div style={{ borderTop: '1px solid #30363d', margin: '.55rem 0', paddingTop: '.45rem', display: 'flex', gap: '.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {pill('purple', <Shield style={{ width: 10, height: 10 }} />,        t('fail2ban.jails.total'),      totalDisplay || '—')}
                        {pill('red',    <Ban style={{ width: 10, height: 10 }} />,           t('fail2ban.jails.activeCount'), jail.currentlyBanned)}
                        {pill('orange', <AlertTriangle style={{ width: 10, height: 10 }} />, t('fail2ban.jails.failuresCount'), jail.currentlyFailed)}
                        {pill('green',  <Clock style={{ width: 10, height: 10 }} />,         t('fail2ban.jails.last5min'),   recentBans.length || '—')}
                        <span style={{ color: '#30363d', margin: '0 2px' }}>·</span>
                        {pill('blue',   <Clock style={{ width: 10, height: 10 }} />,         bansInPeriodLabel, jail.bansInPeriod !== undefined ? jail.bansInPeriod : '—')}
                        <span style={{ flex: 1 }} />
                        {jail.bantime  !== undefined && timingBadge('ban',   fmtSecs(jail.bantime, t),  '#e86a65')}
                        {jail.findtime !== undefined && timingBadge('find',  fmtSecs(jail.findtime, t), '#e3b341')}
                        {jail.maxretry !== undefined && timingBadge('retry', `${jail.maxretry}×`,    '#58a6ff')}
                    </div>
                    {jail.fileList && (() => {
                        const files = jail.fileList.split(/\s+/).filter(Boolean);
                        return (
                            <div style={{ borderTop: '1px solid #30363d', paddingTop: '.45rem', marginTop: '.45rem' }}>
                                <button onClick={() => setLogsOpen(o => !o)}
                                    style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer', padding: '.2rem .5rem', fontSize: '.72rem', color: '#58a6ff', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                    <ScrollText style={{ width: 10, height: 10 }} />
                                    {t('fail2ban.jails.logMonitored', { count: files.length })}
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
                </div>

                {/* Col 2: Tentatives actives */}
                <div style={{ padding: '.75rem 1rem', borderRight: '1px solid #30363d' }}>
                    {colTitle(t('fail2ban.jails.activeAttempts'), '#e3b341', <AlertTriangle style={{ width: 11, height: 11 }} />)}
                    {jail.currentlyFailed === 0 ? (
                        <div style={{ color: '#3fb950', fontSize: '.78rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                            ✓ {t('fail2ban.jails.noAttempts')}
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
                                        <div style={{ color: '#e86a65', fontSize: '.75rem', fontWeight: 700, marginBottom: '.35rem' }}>{t('fail2ban.jails.imminentBan')}</div>
                                    )}
                                    {threatRatio >= .5 && threatRatio < 1 && (
                                        <div style={{ color: '#e3b341', fontSize: '.73rem', marginBottom: '.35rem' }}>
                                            {t('fail2ban.jails.remainingAttempts', { count: jail.maxretry! - jail.currentlyFailed })}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                    {/* Ban form */}
                    <form onSubmit={e => {
                        e.preventDefault();
                        const ip = banIp.trim();
                        if (!ip || !isValidIpOrCidr(ip)) return;
                        onBan(ip); setBanIp('');
                    }} style={{ marginTop: '.6rem', display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                        <div style={{ display: 'flex', gap: '.3rem' }}>
                        <input type="text" value={banIp} onChange={e => setBanIp(e.target.value)}
                            placeholder={t('fail2ban.placeholders.ipToBan')}
                            style={{ flex: 1, padding: '.25rem .45rem', fontSize: '.75rem', fontFamily: 'monospace', borderRadius: 4, background: '#161b22', border: `1px solid ${banIp.trim() && !isValidIpOrCidr(banIp.trim()) ? '#e86a65' : '#30363d'}`, borderBottom: `1px solid ${banIp.trim() && !isValidIpOrCidr(banIp.trim()) ? '#e86a65' : '#555'}`, color: '#e6edf3', outline: 'none', minWidth: 0, boxShadow: 'inset 0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(0,0,0,.4), inset 0 -1px 0 rgba(255,255,255,.04)', transition: 'border-color .15s' }}
                            onFocus={e => (e.currentTarget.style.borderColor = '#58a6ff')}
                            onBlur={e => (e.currentTarget.style.borderColor = banIp.trim() && !isValidIpOrCidr(banIp.trim()) ? '#e86a65' : '#30363d')} />
                        <button type="submit" disabled={!banIp.trim() || !isValidIpOrCidr(banIp.trim()) || !!actionLoading}
                            style={{ padding: '.25rem .55rem', borderRadius: 4, background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.25)', color: '#e86a65', cursor: 'pointer', fontSize: '.72rem', opacity: !banIp.trim() || !isValidIpOrCidr(banIp.trim()) || !!actionLoading ? .5 : 1 }}>
                            <Ban style={{ width: 10, height: 10 }} />
                        </button>
                        </div>
                        {banIp.trim() && !isValidIpOrCidr(banIp.trim()) && (
                            <span style={{ fontSize: '.67rem', color: '#e86a65' }}>{t('fail2ban.jails.invalidFormat')}</span>
                        )}
                    </form>
                </div>

                {/* Col 3: Bans < 5 min */}
                <div style={{ padding: '.75rem 1rem', borderRight: '1px solid #30363d' }}>
                    {colTitle(t('fail2ban.jails.recentBans'), '#3fb950', <Clock style={{ width: 11, height: 11 }} />)}
                    {recentBans.length === 0 ? (
                        <div style={{ color: '#3fb950', fontSize: '.78rem' }}>✓ {t('fail2ban.jails.noRecentBan')}</div>
                    ) : (
                        <>
                        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.72rem' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid #30363d' }}>
                                        <th style={{ textAlign: 'left', padding: '.15rem .3rem', color: '#8b949e', fontWeight: 600, fontSize: '.65rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>IP</th>
                                        <th style={{ textAlign: 'right', padding: '.15rem .3rem', color: '#8b949e', fontWeight: 600, fontSize: '.65rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>{t('fail2ban.jails.ago')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(showAllRecent ? recentBans : recentBans.slice(0, 10)).map((b, i) => {
                                        const ago = Math.floor((Date.now() / 1000) - b.timeofban);
                                        const agoStr = ago < 60 ? `${ago}s` : `${Math.floor(ago / 60)}min`;
                                        return (
                                            <tr key={i} style={{ borderBottom: '1px solid rgba(48,54,61,.5)' }}>
                                                <td style={{ padding: '.2rem .3rem' }}>
                                                    <button onClick={() => onIpClick?.(b.ip)}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: '.72rem', color: '#e6edf3', fontWeight: 600, textAlign: 'left' }}>
                                                        {b.ip}
                                                    </button>
                                                </td>
                                                <td style={{ padding: '.2rem .3rem', textAlign: 'right', color: '#8b949e', whiteSpace: 'nowrap' }}>{agoStr}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {recentBans.length > 10 && (
                            <button onClick={() => setShowAllRecent(v => !v)}
                                style={{ marginTop: '.3rem', width: '100%', padding: '.2rem', fontSize: '.72rem', borderRadius: 4, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', cursor: 'pointer' }}>
                                {showAllRecent ? t('fail2ban.jails.hide') : t('fail2ban.jails.moreBans', { count: recentBans.length - 10 })}
                            </button>
                        )}
                        </>
                    )}
                </div>

                {/* Col 4: IPs bannies actives */}
                <div style={{ padding: '.75rem 1rem' }}>
                    {colTitle(t('fail2ban.jails.currentlyBanned'), '#e86a65', <Ban style={{ width: 11, height: 11 }} />)}
                    {jail.bannedIps.length === 0 ? (
                        <div style={{ color: '#3fb950', fontSize: '.78rem' }}>✓ {t('fail2ban.jails.noBannedIp')}</div>
                    ) : (
                        <div>
                            <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.72rem' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid #30363d' }}>
                                            <th style={{ textAlign: 'left', padding: '.15rem .3rem', color: '#8b949e', fontWeight: 600, fontSize: '.65rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>IP</th>
                                            <th style={{ textAlign: 'left', padding: '.15rem .3rem', color: '#8b949e', fontWeight: 600, fontSize: '.65rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>{t('fail2ban.jails.host')}</th>
                                            <th style={{ padding: '.15rem .3rem' }} />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(showAllIps ? jail.bannedIps : bannedShow).map(ip => (
                                            <tr key={ip} style={{ borderBottom: '1px solid rgba(48,54,61,.5)' }}>
                                                <td style={{ padding: '.2rem .3rem', whiteSpace: 'nowrap' }}>
                                                    <button onClick={() => onIpClick?.(ip)}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: '.72rem', color: '#e6edf3', fontWeight: 600, textAlign: 'left' }}>
                                                        {ip}
                                                    </button>
                                                </td>
                                                <td style={{ padding: '.2rem .3rem', fontFamily: 'monospace', fontSize: '.65rem', color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
                                                    {hostnames[ip] ?? '—'}
                                                </td>
                                                <td style={{ padding: '.2rem .3rem', textAlign: 'right' }}>
                                                    <button onClick={() => onUnban(ip)} disabled={actionLoading === `unban-${jail.jail}-${ip}`}
                                                        style={{ padding: '.12rem .3rem', borderRadius: 3, background: 'rgba(63,185,80,.08)', border: '1px solid rgba(63,185,80,.2)', color: '#3fb950', cursor: 'pointer', fontSize: '.62rem', opacity: actionLoading === `unban-${jail.jail}-${ip}` ? .5 : 1 }}>
                                                        <Unlock style={{ width: 8, height: 8 }} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {bannedRest.length > 0 && (
                                <button onClick={() => setShowAllIps(v => !v)}
                                    style={{ marginTop: '.4rem', width: '100%', padding: '.2rem', fontSize: '.72rem', borderRadius: 4, border: '1px solid #30363d', background: 'transparent', color: '#8b949e', cursor: 'pointer' }}>
                                    {showAllIps ? t('fail2ban.jails.hide') : t('fail2ban.jails.moreIps', { count: bannedRest.length })}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '.5rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                <span style={{ fontSize: '.72rem', color: '#8b949e' }}>
                    {t('fail2ban.jails.footerTotal')} <strong style={{ color: '#58a6ff' }}>{totalDisplay}</strong> {t('fail2ban.jails.footerBans')} <strong style={{ color: '#e3b341' }}>{jail.totalFailed}</strong> {t('fail2ban.jails.footerFailures')}
                </span>
                {jail.currentlyBanned > 0 && (
                    <button onClick={onUnbanAll} disabled={!!actionLoading}
                        style={{ display: 'flex', alignItems: 'center', gap: '.3rem', padding: '.28rem .65rem', borderRadius: 4, background: 'rgba(232,106,101,.12)', border: '1px solid rgba(232,106,101,.3)', color: '#e86a65', cursor: 'pointer', fontSize: '.75rem', opacity: actionLoading ? .5 : 1 }}>
                        <Ban style={{ width: 10, height: 10 }} /> {t('fail2ban.jails.unbanAll', { count: jail.currentlyBanned })}
                    </button>
                )}
            </div>
        </div>
        </>
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
    onIpClick?: (ip: string) => void;
}> = ({ jails, days, actionLoading, onUnban, onBan, onReload, onIpClick }) => {
    const { t } = useTranslation();
    const [expanded,   setExpanded]   = useState<string | null>(null);
    const [editor,     setEditor]     = useState<ConfEditorTarget | null>(null);
    const [configJail, setConfigJail] = useState<string | null>(null);

    const openFilter = (name: string, jailName: string) => {
        setEditor({ type: 'filter', name, jails: [jailName] });
    };
    const openAction = (name: string, jailName: string) => {
        setEditor({ type: 'action', name, jails: [jailName] });
    };

    const bansLabel = days <= 0 ? t('fail2ban.periods.allShort') : days === 1 ? t('fail2ban.periods.last24h') : days === 7 ? t('fail2ban.periods.last7d') : days === 30 ? t('fail2ban.periods.last30d') : days === 180 ? t('fail2ban.periods.last6m') : days === 365 ? t('fail2ban.periods.last1y') : `${days}j`;

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
            <div style={{ ...card }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
                    <thead>
                        <tr style={{ background: '#21262d' }}>
                            <th style={{ ...thStyle, width: 10 }} />
                            <th style={{ ...thStyle, textAlign: 'left' }}>
                                <F2bTooltip title={t('fail2ban.jails.jail')} body={t('fail2ban.tt.jail')} color="blue" placement="bottom">
                                    <span style={{ cursor: 'default' }}>{t('fail2ban.jails.jail')}</span>
                                </F2bTooltip>
                            </th>
                            <th style={{ ...thStyle, textAlign: 'left' }}>
                                <F2bTooltip title={t('fail2ban.jails.portServiceLabel')} body={t('fail2ban.tt.portService')} color="blue" placement="bottom">
                                    <span style={{ cursor: 'default' }}>{t('fail2ban.jails.portServiceLabel')}</span>
                                </F2bTooltip>
                            </th>
                            <th style={{ ...thStyle, textAlign: 'center', width: 58 }}>
                                <F2bTooltip title={t('fail2ban.jails.activeFailuresLabel')} body={t('fail2ban.tt.activeFailures')} color="orange" placement="bottom">
                                    <span style={{ cursor: 'default' }}>{t('fail2ban.jails.failuresCount')}</span>
                                </F2bTooltip>
                            </th>
                            <th style={{ ...thStyle, textAlign: 'center', width: 58 }}>
                                <F2bTooltip title={t('fail2ban.jails.activeBansLabel')} body={t('fail2ban.tt.activeBans')} color="red" placement="bottom">
                                    <span style={{ cursor: 'default' }}>{t('fail2ban.jails.activeCount')}</span>
                                </F2bTooltip>
                            </th>
                            <th style={{ ...thStyle, textAlign: 'center', width: 72 }}>
                                <F2bTooltip title={t('fail2ban.jails.periodBansLabel', { period: bansLabel })} body={t('fail2ban.tt.periodBans', { period: bansLabel })} color="cyan" placement="bottom">
                                    <span style={{ cursor: 'default' }}>{t('fail2ban.jails.periodBansLabel', { period: bansLabel })}</span>
                                </F2bTooltip>
                            </th>
                            <th style={{ ...thStyle, textAlign: 'center', width: 58 }}>
                                <F2bTooltip title={t('fail2ban.jails.totalHistoricLabel')} body={t('fail2ban.tt.totalHistoric')} color="blue" placement="bottom">
                                    <span style={{ cursor: 'default' }}>{t('fail2ban.jails.total')}</span>
                                </F2bTooltip>
                            </th>
                            <th style={{ ...thStyle, textAlign: 'center', width: 74 }}>
                                <F2bTooltip title={t('fail2ban.labels.bantime')} body={t('fail2ban.tt.bantimeTt')} color="cyan" placement="bottom">
                                    <span style={{ cursor: 'default' }}>Bantime</span>
                                </F2bTooltip>
                            </th>
                            <th style={{ ...thStyle, textAlign: 'left', width: 1 }}>
                                <F2bTooltip title={t('fail2ban.jails.filter')} body={t('fail2ban.tt.filterTt')} color="green" placement="bottom">
                                    <span style={{ cursor: 'default' }}>{t('fail2ban.jails.filter')}</span>
                                </F2bTooltip>
                            </th>
                            <th style={{ ...thStyle, textAlign: 'left' }}>
                                <F2bTooltip title={t('fail2ban.jails.action')} body={t('fail2ban.tt.actionTt')} color="orange" placement="bottom">
                                    <span style={{ cursor: 'default' }}>{t('fail2ban.jails.action')}</span>
                                </F2bTooltip>
                            </th>
                            <th style={{ ...thStyle, width: 20 }} />
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(j => {
                            const isOpen = expanded === j.jail;
                            const isInactive = j.active === false;
                            const totalDisplay = j.totalBannedSqlite !== undefined ? j.totalBannedSqlite : j.totalBanned;
                            const portTokens = j.port ? j.port.split(/[\s,]+/).filter(Boolean) : [];
                            const stateColor = isInactive ? '#8b949e' : j.currentlyBanned > 0 ? '#e86a65' : j.currentlyFailed > 0 ? '#e3b341' : '#238636';
                            return (
                                <React.Fragment key={j.jail}>
                                    <tr
                                        style={{ background: isOpen ? 'rgba(88,166,255,.13)' : 'transparent', cursor: isInactive ? 'default' : 'pointer', borderBottom: isOpen ? 'none' : '1px solid #30363d', opacity: isInactive ? 0.5 : 1, boxShadow: `inset 4px 0 0 ${stateColor}` }}
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
                                                {isInactive && <span style={{ fontSize: '.6rem', padding: '.05rem .3rem', borderRadius: 3, background: 'rgba(139,148,158,.15)', border: '1px solid #30363d', color: '#8b949e', fontWeight: 400 }}>{t('fail2ban.jails.inactiveBadge')}</span>}
                                            </span>
                                        </td>
                                        <td style={{ padding: '.5rem .5rem', whiteSpace: 'nowrap' }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.2rem', alignItems: 'center' }}>
                                                {portTokens.map(p => p === '0:65535'
                                                    ? <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: '.2rem', padding: '1px 6px', borderRadius: 4, fontSize: '.72rem', fontWeight: 600, background: 'rgba(88,166,255,.18)', border: '1px solid rgba(88,166,255,.5)', color: '#58a6ff', letterSpacing: '.02em' }}>⬡ all ports</span>
                                                    : <Badge key={p} color="blue">{p}</Badge>
                                                )}
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
                                            {j.bantime !== undefined ? <Badge color={j.bantime < 0 || j.bantime >= 86400 * 30 ? 'red' : j.bantime >= 86400 ? 'orange' : j.bantime >= 3600 ? 'blue' : 'green'}>{fmtSecs(j.bantime, t)}</Badge> : <span style={{ color: '#8b949e' }}>—</span>}
                                        </td>
                                        <td style={{ padding: '.5rem .5rem', whiteSpace: 'nowrap' }}>
                                            {j.filter
                                                ? <span onClick={e => { e.stopPropagation(); openFilter(j.filter!, j.jail); }} style={{ cursor: 'pointer' }} title={t('fail2ban.jails.editFilter')}><Badge color="green">{j.filter}</Badge></span>
                                                : <span style={{ color: '#8b949e', fontSize: '.78rem' }}>—</span>}
                                        </td>
                                        <td style={{ padding: '.5rem .5rem', whiteSpace: 'nowrap' }}>
                                            {(j.actions?.length ?? 0) > 0
                                                ? <div style={{ display: 'flex', gap: '.2rem', flexWrap: 'nowrap' }}>
                                                    {j.actions!.slice(0, 2).map(a => (
                                                        <span key={a} onClick={e => { e.stopPropagation(); openAction(a, j.jail); }} style={{ cursor: 'pointer' }} title={t('fail2ban.jails.editAction')}>
                                                            <Badge color="orange">⚡ {a}</Badge>
                                                        </span>
                                                    ))}
                                                    {j.actions!.length > 2 && <Badge color="muted">+{j.actions!.length - 2}</Badge>}
                                                  </div>
                                                : j.banaction
                                                    ? <span onClick={e => { e.stopPropagation(); openAction(j.banaction!, j.jail); }} style={{ cursor: 'pointer' }} title={t('fail2ban.jails.editAction')}>
                                                        <Badge color="orange">⚡ {j.banaction}</Badge>
                                                      </span>
                                                    : <span style={{ color: '#8b949e', fontSize: '.78rem' }}>—</span>}
                                        </td>
                                        <td style={{ padding: '.5rem .6rem', textAlign: 'center' }}>
                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '.35rem' }}>
                                                {!isInactive && (
                                                    <button
                                                        onClick={e => { e.stopPropagation(); setConfigJail(j.jail); }}
                                                        title={t('fail2ban.jails.editJailConfig')}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '.1rem', display: 'flex', alignItems: 'center', color: '#8b949e', borderRadius: 3, lineHeight: 0 }}
                                                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#58a6ff'}
                                                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#8b949e'}>
                                                        <Settings style={{ width: 12, height: 12 }} />
                                                    </button>
                                                )}
                                                {!isInactive && <ChevronRight style={{ width: 12, height: 12, color: '#8b949e', transform: isOpen ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />}
                                            </div>
                                        </td>
                                    </tr>
                                    {isOpen && (
                                        <tr style={{ background: 'rgba(88,166,255,.05)', borderBottom: '2px solid rgba(88,166,255,.25)' }}>
                                            <td colSpan={11} style={{ padding: '.4rem .6rem' }}>
                                                <div style={{ border: '1px solid rgba(88,166,255,.2)', borderRadius: 8, overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,.3)' }}>
                                                <JailExpandedGrid
                                                    jail={j}
                                                    actionLoading={actionLoading}
                                                    bansInPeriodLabel={bansLabel}
                                                    onUnban={ip => onUnban(j.jail, ip)}
                                                    onBan={ip => onBan(j.jail, ip)}
                                                    onReload={() => onReload(j.jail)}
                                                    onUnbanAll={() => j.bannedIps.forEach(ip => onUnban(j.jail, ip))}
                                                    onOpenConfig={() => setConfigJail(j.jail)}
                                                    onIpClick={onIpClick}
                                                />
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                        {filtered.length === 0 && (
                            <tr><td colSpan={11} style={{ padding: '2rem', textAlign: 'center', color: '#8b949e', fontSize: '.85rem' }}>{t('fail2ban.jails.noFilterMatch')}</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
        </>
    );
};

// ── Vue fichiers log ──────────────────────────────────────────────────────────

// ── Log colorizer ─────────────────────────────────────────────────────────────
const LOG_TOKEN_RE = /(^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[,\.]\d*|fail2ban\.\w+(?:\.\w+)*|\[\d+\]:\s*|\bBan\b|\bUnban\b|\bFound\b|\bERROR\b|\bWARNING\b|\bWARN\b|\bNOTICE\b|\bINFO\b|\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\[[a-zA-Z][a-zA-Z0-9_-]*\])/g;

function tokenColor(tok: string): string {
    if (/^\d{4}-\d{2}-\d{2}/.test(tok))                     return '#555d68';
    if (/^fail2ban\./.test(tok))                              return '#444c56';
    if (/^\[\d+\]/.test(tok))                                 return '#444c56';
    if (tok === 'Ban')                                        return '#e86a65';
    if (tok === 'Unban')                                      return '#3fb950';
    if (tok === 'Found')                                      return '#58a6ff';
    if (tok === 'ERROR')                                      return '#e86a65';
    if (tok === 'WARNING' || tok === 'WARN')                  return '#e3b341';
    if (tok === 'NOTICE')                                     return '#39c5cf';
    if (tok === 'INFO')                                       return '#8b949e';
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tok))  return '#bc8cff';
    if (/^\[[a-zA-Z]/.test(tok))                             return '#e3b341';
    return '#e6edf3';
}

function lineBg(line: string): string | undefined {
    if (/\bBan\b/.test(line))     return 'rgba(232,106,101,.05)';
    if (/\bUnban\b/.test(line))   return 'rgba(63,185,80,.04)';
    if (/\bERROR\b/.test(line))   return 'rgba(232,106,101,.07)';
    if (/\bWARNING\b/.test(line)) return 'rgba(227,179,65,.04)';
    return undefined;
}

function colorizeLine(line: string, idx: number): React.ReactNode {
    const bg = lineBg(line);
    const parts: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    LOG_TOKEN_RE.lastIndex = 0;
    while ((m = LOG_TOKEN_RE.exec(line)) !== null) {
        if (m.index > last) parts.push(line.slice(last, m.index));
        parts.push(<span key={m.index} style={{ color: tokenColor(m[0]) }}>{m[0]}</span>);
        last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return (
        <span key={idx} style={{ display: 'block', background: bg, borderRadius: bg ? 2 : undefined }}>
            {parts}
        </span>
    );
}

interface LogFileInfo { name: string; mtime: number; size: number; }

function fmtSize(b: number): string {
    if (b < 1024)             return `${b}B`;
    if (b < 1024 * 1024)      return `${(b / 1024).toFixed(1)}K`;
    return `${(b / 1024 / 1024).toFixed(1)}M`;
}

export const TabJailsFiles: React.FC = () => {
    const { t } = useTranslation();
    const [files, setFiles]         = useState<LogFileInfo[]>([]);
    const [selected, setSelected]   = useState<string | null>(null);
    const [content, setContent]     = useState('');
    const [lines, setLines]         = useState(400);
    const [loading, setLoading]     = useState(true);
    const [tailLoading, setTailLoading] = useState(false);
    const [tailLoadedAt, setTailLoadedAt] = useState<number>(0);
    const [error, setError]         = useState<string | null>(null);
    const [truncated, setTruncated] = useState(false);

    useEffect(() => {
        const cached = getCached<{ files: LogFileInfo[] }>('logs:list');
        if (cached?.files?.length) { setFiles(cached.files); setSelected(cached.files[0].name); setLoading(false); }
        api.get<{ ok: boolean; files: LogFileInfo[]; error?: string }>('/api/plugins/fail2ban/logs').then(res => {
            if (res.success && res.result?.ok && res.result.files?.length) {
                setCached('logs:list', { files: res.result.files });
                setFiles(res.result.files);
                if (!cached?.files?.length) setSelected(res.result.files[0].name);
            } else if (!cached?.files?.length) {
                setError(res.result?.error ?? t('fail2ban.jails.noLogFileFail2ban'));
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
            setContent(res.result?.error ?? t('fail2ban.jails.readImpossible'));
            setTruncated(false);
        }
        setTailLoading(false);
        setTailLoadedAt(Date.now());
    }, []);

    useEffect(() => { if (selected) fetchTail(selected, lines); }, [selected, lines, fetchTail]);

    const selectedFile = files.find(f => f.name === selected) ?? null;
    const colorized = content ? content.split('\n').map((line, i) => colorizeLine(line, i)) : null;

    return (
        <div style={{ display: 'flex', gap: '.75rem', height: 'calc(100vh - 220px)', minHeight: 400 }}>
            <div style={{ ...card, width: 230, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ ...cardH, fontSize: '.83rem', fontWeight: 600 }}>
                    <ScrollText style={{ width: 13, height: 13, color: '#8b949e' }} />
                    {t('fail2ban.jails.logFiles')}
                    {!loading && <span style={{ marginLeft: 'auto', fontSize: '.7rem', color: '#8b949e' }}>{files.length}</span>}
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {loading ? <div style={{ padding: '1rem', fontSize: '.8rem', color: '#8b949e' }}>{t('fail2ban.status.loading')}</div>
                    : error && !files.length ? <div style={{ padding: '1rem', fontSize: '.8rem', color: '#e86a65' }}>{error}</div>
                    : files.map(f => (
                        <button key={f.name} onClick={() => setSelected(f.name)}
                            style={{ width: '100%', textAlign: 'left', padding: '.4rem .75rem', background: selected === f.name ? 'rgba(88,166,255,.08)' : 'transparent', color: selected === f.name ? '#58a6ff' : '#e6edf3', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '.15rem' }}>
                            <span style={{ fontSize: '.79rem', fontFamily: 'monospace' }}>{f.name}</span>
                            <span style={{ fontSize: '.67rem', color: selected === f.name ? 'rgba(88,166,255,.7)' : '#6e7681', fontVariantNumeric: 'tabular-nums', display: 'flex', justifyContent: 'space-between' }}>
                                <span>{new Date(f.mtime).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                                <span>{fmtSize(f.size)}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </div>
            <div style={{ ...card, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ ...cardH, fontSize: '.79rem', fontFamily: 'monospace', color: '#8b949e', flexWrap: 'wrap', gap: '.5rem' }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selected ? `/var/log/${selected}` : t('fail2ban.jails.selectFile')}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {selectedFile && (
                            <span style={{ fontSize: '.68rem', color: '#6e7681', whiteSpace: 'nowrap' }}>
                                {t('fail2ban.jails.modified')} {new Date(selectedFile.mtime).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                        {tailLoadedAt > 0 && !tailLoading && (
                            <span style={{ fontSize: '.68rem', color: '#8b949e', whiteSpace: 'nowrap' }}>
                                ↻ {new Date(tailLoadedAt).toLocaleTimeString('fr-FR')}
                            </span>
                        )}
                        <span style={{ fontSize: '.72rem' }}>{t('fail2ban.jails.lines')}</span>
                        <select value={lines} onChange={e => setLines(Number(e.target.value))}
                            style={{ padding: '.2rem .4rem', fontSize: '.72rem', borderRadius: 4, background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3' }}>
                            {[200, 400, 800, 1500].map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                    </div>
                </div>
                {truncated && (
                    <div style={{ padding: '.3rem 1rem', background: 'rgba(227,179,65,.07)', borderBottom: '1px solid rgba(227,179,65,.25)', fontSize: '.73rem', color: '#e3b341' }}>
                        {t('fail2ban.jails.largeFileWarning')}
                    </div>
                )}
                <pre style={{ flex: 1, overflowY: 'auto', padding: '1rem', fontSize: '.78rem', fontFamily: 'monospace', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap', color: '#e6edf3' }}>
                    {tailLoading && !content
                        ? t('fail2ban.status.loading')
                        : colorized ?? (selected ? '' : t('fail2ban.jails.selectFile'))}
                </pre>
            </div>
        </div>
    );
};

// ── Vue événements (bans/unbans depuis audit SQLite) ──────────────────────────

type EvtType = 'all' | 'ban' | 'unban' | 'failed';
type SortCol = 'date' | 'type' | 'ip' | 'jail' | 'failures' | 'bantime' | 'domain' | 'log' | 'country';
type SortDir = 'asc' | 'desc';
const EVT_LIMITS = [10, 25, 50, 100, 0];

// Service icon map (SVGs stored in /icons/services/)
const SERVICE_ICONS: Record<string, [string, string]> = {
    apache2: ['apache.svg',              'Apache'],
    nginx:   ['nginx.svg',               'Nginx'],
    npm:     ['nginx-proxy-manager.svg', 'Nginx Proxy Manager'],
    traefik: ['traefik-proxy.svg',       'Traefik'],
    haproxy: ['haproxy.svg',             'HAProxy'],
    lighttpd:['lighttpd.svg',            'lighttpd'],
};

interface AuditEnrichment {
    jail_actions:   Record<string, string>;
    jail_logs:      Record<string, string>;
    jail_servers:   Record<string, string>;
    jail_domains:   Record<string, string>;
}

/** Pre-rendered badge per event type — avoids a nested ternary in the row renderer. */
const EVENT_TYPE_BADGE: Record<'ban' | 'unban', React.ReactNode> = {
    ban:     <span style={{ color: '#e86a65', fontSize: '.78rem', fontWeight: 600 }}>🔨 ban</span>,
    unban:   <span style={{ color: '#3fb950', fontSize: '.78rem', fontWeight: 600 }}>🔓 unban</span>,
};

export const TabJailsEvents: React.FC<{ onIpClick?: (ip: string) => void; days?: number }> = ({ onIpClick, days }) => {
    const { t } = useTranslation();
    const [bans, setBans]              = useState<BanEntry[]>(() => getCached<BanEntry[]>(`audit:bans:${days ?? 0}`) ?? []);
    const [enrichment, setEnrich]      = useState<AuditEnrichment>(() => getCachedTTL<AuditEnrichment>('audit:enrich', ENRICH_TTL) ?? { jail_actions: {}, jail_logs: {}, jail_servers: {}, jail_domains: {} });
    const [loading, setLoading]        = useState(() => !getCached<BanEntry[]>(`audit:bans:${days ?? 0}`));
    const [enrichLoading, setEnrichLd] = useState(() => !getCachedTTL<AuditEnrichment>('audit:enrich', ENRICH_TTL));
    const [attempts, setAttempts]      = useState<AttemptEntry[]>(() => getCached<AttemptEntry[]>(`audit:attempts:${days ?? 1}`) ?? []);
    const [attemptsLoading, setAttemptsLoading] = useState(false);
    const [search, setSearch]          = useState('');
    const [type, setType]              = useState<EvtType>('all');
    const [limit, setLimit]            = useState(25);
    const [page, setPage]              = useState(0);
    const [sortCol, setSortCol]        = useState<SortCol>('date');
    const [sortDir, setSortDir]        = useState<SortDir>('desc');

    // Inject shimmer keyframes once
    useEffect(() => {
        if (document.getElementById('f2b-shimmer-kf')) return;
        const s = document.createElement('style');
        s.id = 'f2b-shimmer-kf';
        s.textContent = '@keyframes f2b-shimmer{0%,100%{opacity:.25}50%{opacity:.6}}';
        document.head.appendChild(s);
    }, []);

    const fetchAudit = useCallback(() => {
        const daysQ  = days && days > 0 ? `&days=${days}` : '';
        const bansKey = `audit:bans:${days ?? 0}`;
        type AuditResult = { ok: boolean; bans: BanEntry[] } & AuditEnrichment;

        // Restore from separate caches immediately (bans 30s, enrich 5min)
        const cachedBans   = getCached<BanEntry[]>(bansKey);
        const cachedEnrich = getCachedTTL<AuditEnrichment>('audit:enrich', ENRICH_TTL);
        if (cachedBans)   { setBans(cachedBans);     setLoading(false); }
        else               setLoading(true);
        if (cachedEnrich) { setEnrich(cachedEnrich); setEnrichLd(false); }
        else               setEnrichLd(true);

        api.get<AuditResult>(`/api/plugins/fail2ban/audit?limit=500${daysQ}`).then(res => {
            if (res.success && res.result?.ok) {
                const bansData: BanEntry[] = res.result.bans ?? [];
                const enrichData: AuditEnrichment = {
                    jail_actions: res.result.jail_actions ?? {},
                    jail_logs:    res.result.jail_logs ?? {},
                    jail_servers: res.result.jail_servers ?? {},
                    jail_domains: res.result.jail_domains ?? {},
                };
                setCached(bansKey, bansData);
                _cache['audit:enrich'] = { data: enrichData, ts: Date.now() };
                setBans(bansData);
                setEnrich(enrichData);
            }
            setLoading(false);
            setEnrichLd(false);
        });
    }, [days]);

    // Initial load + reload when days changes
    useEffect(() => { fetchAudit(); }, [fetchAudit]);

    // Auto-refresh every 30s (pauses when tab is hidden)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => {
        intervalRef.current = setInterval(() => {
            if (!document.hidden) fetchAudit();
        }, 30_000);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [fetchAudit]);

    // Tentatives count must appear in the filter badge like bans/unbans do,
    // so fetch attempts on mount (once per days change). After that the data sits in cache
    // and clicking the "tentatives" filter is instant.
    useEffect(() => {
        const key = `audit:attempts:${days ?? 1}`;
        const cached = getCached<AttemptEntry[]>(key);
        if (cached) { setAttempts(cached); return; }
        setAttemptsLoading(true);
        api.get<{ ok: boolean; attempts: AttemptEntry[] }>(
            `/api/plugins/fail2ban/audit/attempts?days=${days ?? 1}&limit=200`
        ).then(res => {
            if (res.success && res.result?.ok) {
                const list = res.result.attempts ?? [];
                setAttempts(list);
                setCached(key, list);
            }
            setAttemptsLoading(false);
        });
    }, [days]);

    const toggleSort = (col: SortCol) => {
        if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortCol(col); setSortDir('desc'); }
    };

    // Each ban in DB carries an optional unban_at (timestamp when the ban was lifted).
    // We expand every ban into up to 2 rows: one 'ban' event at timeofban,
    // one 'unban' event at unban_at if set. This preserves IP/jail/country/domain
    // on both rows so filtering and enrichment still work.
    type EventRow = BanEntry & { eventType: 'ban' | 'unban' | 'attempt'; eventTs: number };

    const expandedBans = useMemo<EventRow[]>(() => {
        const out: EventRow[] = [];
        for (const b of bans) {
            out.push({ ...b, eventType: 'ban', eventTs: b.timeofban });
            if (b.unban_at) {
                out.push({ ...b, eventType: 'unban', eventTs: b.unban_at });
            }
        }
        return out;
    }, [bans]);

    const processed = useMemo<EventRow[]>(() => {
        let rows: EventRow[];
        if (type === 'failed') {
            // Tentatives: lazy-fetched from fail2ban.log, synthesized as 'attempt' events.
            rows = attempts.map(a => ({
                ip: a.ip,
                jail: a.jail,
                timeofban: a.timeofban,
                bantime: 0,
                failures: a.failures,
                eventType: 'attempt' as const,
                eventTs: a.timeofban,
            }));
        } else {
            rows = expandedBans;
            if (type === 'ban')   rows = rows.filter(e => e.eventType === 'ban');
            if (type === 'unban') rows = rows.filter(e => e.eventType === 'unban');
        }
        if (search) rows = rows.filter(b =>
            b.ip.includes(search) || b.jail.includes(search) ||
            (enrichment.jail_domains[b.jail] ?? '').includes(search) ||
            (enrichment.jail_logs[b.jail] ?? '').includes(search) ||
            (b.countryCode ?? '').toLowerCase().includes(search.toLowerCase())
        );
        rows.sort((a, b) => {
            let va: number | string, vb: number | string;
            if      (sortCol === 'date')     { va = a.eventTs; vb = b.eventTs; }
            else if (sortCol === 'type')     { va = a.eventType; vb = b.eventType; }
            else if (sortCol === 'ip')       { va = a.ip; vb = b.ip; }
            else if (sortCol === 'jail')     { va = a.jail; vb = b.jail; }
            else if (sortCol === 'failures') { va = a.failures; vb = b.failures; }
            else if (sortCol === 'domain')   { va = enrichment.jail_domains[a.jail] ?? ''; vb = enrichment.jail_domains[b.jail] ?? ''; }
            else if (sortCol === 'log')      { va = (enrichment.jail_logs[a.jail] ?? '').replace(/.*\//, ''); vb = (enrichment.jail_logs[b.jail] ?? '').replace(/.*\//, ''); }
            else if (sortCol === 'country')  { va = a.countryCode ?? ''; vb = b.countryCode ?? ''; }
            else { va = a.bantime; vb = b.bantime; }
            if (va < vb) return sortDir === 'asc' ? -1 : 1;
            if (va > vb) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return rows;
    }, [expandedBans, attempts, type, search, sortCol, sortDir, enrichment]);

    const banCount   = bans.length;
    const unbanCount = bans.filter(b => b.unban_at != null).length;
    // Attempts count is unknown until the user activates the filter (lazy-loaded).
    const failCount  = attempts.length;

    const totalPages = limit > 0 ? Math.ceil(processed.length / limit) : 1;
    const safePage   = Math.min(page, Math.max(0, totalPages - 1));
    const displayed  = limit > 0 ? processed.slice(safePage * limit, (safePage + 1) * limit) : processed;

    const setTypeAndReset  = (t: EvtType) => { setType(t);  setPage(0); };
    const setSearchAndReset = (s: string) => { setSearch(s); setPage(0); };
    const setLimitAndReset  = (l: number) => { setLimit(l);  setPage(0); };

    const sortIcon = (col: SortCol) => (
        <span style={{ marginLeft: '.25rem', color: sortCol === col ? '#58a6ff' : '#30363d' }}>
            {sortCol === col ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
    );

    const thS = (col: SortCol, label: string, tooltip: string, textAlign: 'left' | 'center' = 'left', ttColor: F2bTtColor = 'muted'): React.ReactNode => (
        <th onClick={() => toggleSort(col)} style={{ padding: '.45rem .75rem', borderBottom: '1px solid #30363d', fontSize: '.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8b949e', textAlign, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
            <F2bTooltip title={label} body={tooltip} color={ttColor} placement="bottom">
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>{label}{sortIcon(col)}</span>
            </F2bTooltip>
        </th>
    );

    const filterBtnStyle = (active: boolean, color: string): React.CSSProperties => ({
        padding: '.1rem .45rem', fontSize: '.68rem', borderRadius: 4, cursor: 'pointer',
        border: `1px solid ${active ? color + '80' : '#30363d'}`,
        background: active ? color + '20' : 'transparent',
        color: active ? color : '#8b949e',
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
            {/* ── Toolbar unique ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', flexWrap: 'wrap', padding: '.4rem .6rem', background: '#161b22', border: '1px solid #30363d', borderRadius: 7 }}>
                {/* Title */}
                <span style={{ fontWeight: 700, fontSize: '.85rem', color: '#e6edf3', display: 'flex', alignItems: 'center', gap: '.35rem', flexShrink: 0 }}>
                    <List style={{ width: 13, height: 13, color: '#58a6ff' }} />
                    {t('fail2ban.jails.events')}
                </span>

                <div style={{ width: 1, height: 18, background: '#30363d', flexShrink: 0 }} />

                {/* Badges cliquables = filtre type */}
                <div style={{ display: 'flex', gap: '.3rem' }}>
                    <span onClick={() => setTypeAndReset(type === 'all' ? 'ban' : 'all')}
                        style={{ padding: '.12rem .5rem', borderRadius: 4, fontSize: '.68rem', fontWeight: 600, cursor: 'pointer',
                            background: type === 'ban' ? 'rgba(232,106,101,.3)' : 'rgba(232,106,101,.15)',
                            color: type === 'ban' ? '#e86a65' : '#e6edf3',
                            border: type === 'ban' ? '1px solid rgba(232,106,101,.7)' : '1px solid rgba(232,106,101,.4)',
                            outline: type === 'ban' ? '2px solid rgba(232,106,101,.35)' : 'none',
                            outlineOffset: 1 }}>
                        🔨 {banCount} bans
                    </span>
                    <span onClick={() => setTypeAndReset(type === 'unban' ? 'all' : 'unban')}
                        style={{ padding: '.12rem .5rem', borderRadius: 4, fontSize: '.68rem', fontWeight: 600, cursor: 'pointer',
                            background: type === 'unban' ? 'rgba(63,185,80,.25)' : 'rgba(63,185,80,.12)',
                            color: type === 'unban' ? '#3fb950' : '#e6edf3',
                            border: type === 'unban' ? '1px solid rgba(63,185,80,.7)' : '1px solid rgba(63,185,80,.4)',
                            outline: type === 'unban' ? '2px solid rgba(63,185,80,.3)' : 'none',
                            outlineOffset: 1 }}>
                        🔓 {unbanCount} unbans
                    </span>
                    <span onClick={() => setTypeAndReset(type === 'failed' ? 'all' : 'failed')}
                        style={{ padding: '.12rem .5rem', borderRadius: 4, fontSize: '.68rem', fontWeight: 600, cursor: 'pointer',
                            background: type === 'failed' ? 'rgba(227,179,65,.25)' : 'rgba(227,179,65,.12)',
                            color: type === 'failed' ? '#e3b341' : '#e6edf3',
                            border: type === 'failed' ? '1px solid rgba(227,179,65,.7)' : '1px solid rgba(227,179,65,.4)',
                            outline: type === 'failed' ? '2px solid rgba(227,179,65,.3)' : 'none',
                            outlineOffset: 1 }}>
                        ⚠ {failCount} {t('fail2ban.jails.attemptsWord')}
                    </span>
                </div>

                <div style={{ width: 1, height: 18, background: '#30363d', flexShrink: 0 }} />

                {/* Search — centré */}
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                    <input type="text" value={search} onChange={e => setSearchAndReset(e.target.value)}
                        placeholder={t('fail2ban.jails.searchPlaceholder')}
                        style={{ padding: '.28rem .6rem', fontSize: '.78rem', borderRadius: 5, background: '#161b22', border: '1px solid #30363d', borderBottom: '1px solid #555', color: '#e6edf3', outline: 'none', width: 210, boxShadow: 'inset 0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(0,0,0,.4), inset 0 -1px 0 rgba(255,255,255,.04)' }} />
                </div>

                {/* Per-page + pagination — droite */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '.12rem .5rem', borderRadius: 4, fontSize: '.68rem', fontWeight: 600, whiteSpace: 'nowrap', background: 'rgba(88,166,255,.12)', color: '#58a6ff', border: '1px solid rgba(88,166,255,.35)' }}>
                        {t('fail2ban.jails.eventCount', { count: processed.length })}
                    </span>
                    <div style={{ width: 1, height: 18, background: '#30363d', flexShrink: 0 }} />
                    <div style={{ display: 'flex', gap: '.2rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '.65rem', color: '#8b949e', whiteSpace: 'nowrap' }}>{t('fail2ban.jails.perPage')}</span>
                        {EVT_LIMITS.map(l => (
                            <button key={l} onClick={() => setLimitAndReset(l)} style={filterBtnStyle(limit === l, '#58a6ff')}>
                                {l === 0 ? t('fail2ban.jails.all') : l}
                            </button>
                        ))}
                    </div>
                    {limit > 0 && totalPages > 1 && (
                        <>
                            <div style={{ width: 1, height: 18, background: '#30363d', flexShrink: 0 }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                                    style={{ padding: '.15rem .45rem', borderRadius: 4, border: '1px solid #30363d', background: 'transparent', color: safePage === 0 ? '#30363d' : '#8b949e', cursor: safePage === 0 ? 'default' : 'pointer', fontSize: '.8rem', lineHeight: 1 }}>←</button>
                                <span style={{ fontSize: '.72rem', color: '#58a6ff', fontWeight: 600, minWidth: 50, textAlign: 'center', whiteSpace: 'nowrap' }}>{safePage + 1} / {totalPages}</span>
                                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1}
                                    style={{ padding: '.15rem .45rem', borderRadius: 4, border: '1px solid #30363d', background: 'transparent', color: safePage === totalPages - 1 ? '#30363d' : '#8b949e', cursor: safePage === totalPages - 1 ? 'default' : 'pointer', fontSize: '.8rem', lineHeight: 1 }}>→</button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {loading || (type === 'failed' && attemptsLoading && attempts.length === 0) ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e' }}>{t('fail2ban.status.loading')}</div>
            ) : displayed.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e' }}>
                    {search || type !== 'all' ? t('fail2ban.jails.noFilteredEvents') : t('fail2ban.jails.noDbEvents')}
                </div>
            ) : (
                <div style={{ ...card }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                        <thead>
                            <tr style={{ background: '#21262d' }}>
                                {thS('date',     t('fail2ban.jails.date'),       t('fail2ban.jails.dateTooltip'), 'left', 'muted')}
                                {thS('type',     t('fail2ban.jails.type'),       t('fail2ban.jails.typeTooltip'), 'left', 'muted')}
                                {thS('ip',       t('fail2ban.jails.ipSource'),   t('fail2ban.jails.ipSourceTooltip'), 'left', 'red')}
                                {thS('country',  t('fail2ban.jails.country'),    t('fail2ban.jails.countryTooltip'), 'center', 'cyan')}
                                {thS('jail',     t('fail2ban.jails.jail'),       t('fail2ban.jails.jailTooltip'), 'left', 'blue')}
                                {thS('failures', t('fail2ban.jails.attemptsCount'), t('fail2ban.jails.attemptsTooltip'), 'center', 'orange')}
                                {thS('domain',   t('fail2ban.jails.domain'),     t('fail2ban.jails.domainTooltip'), 'left', 'cyan')}
                                {thS('log',      t('fail2ban.jails.log'),        t('fail2ban.jails.logTooltip'), 'left', 'muted')}
                            </tr>
                        </thead>
                        <tbody>
                            {displayed.map((b, i) => {
                                const domain  = b.domain || (enrichment.jail_domains[b.jail] ?? '');
                                // Si le ban a un domaine spécifique, son logfile est déjà résolu par le backend.
                                // Sinon fallback sur le log du jail (même pour tous les bans de ce jail).
                                const logpath = b.logfile || (b.domain ? '' : (enrichment.jail_logs[b.jail] ?? ''));
                                const logbase = logpath.replace(/.*\//, '');
                                const srv     = enrichment.jail_servers[b.jail] ?? '';
                                const svcInfo = SERVICE_ICONS[srv];
                                // Age-based timestamp color (like PHP fail2ban-web).
                                // For 'unban' rows we color by when the ban was lifted, not when it started.
                                const hoursAgo = (Date.now() / 1000 - b.eventTs) / 3600;
                                const [tColor, tBg, tBorder] = hoursAgo < 1
                                    ? ['#e86a65', 'rgba(232,106,101,.15)', 'rgba(232,106,101,.4)']
                                    : hoursAgo < 6
                                    ? ['#e3b341', 'rgba(227,179,65,.12)',  'rgba(227,179,65,.35)']
                                    : hoursAgo < 24
                                    ? ['#58a6ff', 'rgba(88,166,255,.12)',  'rgba(88,166,255,.35)']
                                    : ['#8b949e', 'rgba(139,148,158,.08)', 'rgba(139,148,158,.2)'];
                                const ts = fmtTs(b.eventTs);
                                const [datePart, timePart] = ts.split(' ');
                                return (
                                <tr key={i} style={{ borderBottom: '1px solid #30363d' }}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
                                    <td style={{ padding: '.45rem .75rem', fontFamily: 'monospace', fontSize: '.77rem', whiteSpace: 'nowrap' }}>
                                        <span style={{ color: '#8b949e', marginRight: '.25rem' }}>{datePart}</span>
                                        <span style={{ display: 'inline-block', padding: '.05rem .35rem', borderRadius: 4, fontSize: '.72rem', fontWeight: 600, background: tBg, color: tColor, border: `1px solid ${tBorder}` }}>{timePart}</span>
                                    </td>
                                    {/* Type */}
                                    <td style={{ padding: '.45rem .75rem', whiteSpace: 'nowrap' }}>
                                        {b.eventType === 'attempt'
                                            ? <span style={{ color: '#e3b341', fontSize: '.78rem', fontWeight: 600 }}>⚠ {t('fail2ban.jails.attempt')}</span>
                                            : EVENT_TYPE_BADGE[b.eventType]}
                                    </td>
                                    <td style={{ padding: '.45rem .75rem' }}>
                                        <F2bTooltip title={b.ip} bodyNode={
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                                                <div style={{ color: '#8b949e' }}>{t('fail2ban.jails.clickForDetail')}</div>
                                                <div style={{ color: '#8b949e', fontSize: '.72rem' }}>{t('fail2ban.jails.clickForDetailSub')}</div>
                                            </div>
                                        } color="red" placement="bottom">
                                            <button onClick={() => onIpClick?.(b.ip)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'monospace', fontSize: '.8rem', color: '#e6edf3', fontWeight: 600, textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>
                                                {b.ip}
                                            </button>
                                        </F2bTooltip>
                                    </td>
                                    <td style={{ padding: '.45rem .75rem', textAlign: 'center' }}>
                                        {b.countryCode ? (
                                            <span title={b.countryCode} style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
                                                <FlagImg code={b.countryCode} size={16} />
                                                <span style={{ fontFamily: 'monospace', fontSize: '.7rem', color: '#8b949e' }}>{b.countryCode}</span>
                                            </span>
                                        ) : <span style={{ color: '#30363d', fontSize: '.7rem' }}>—</span>}
                                    </td>
                                    <td style={{ padding: '.45rem .75rem' }}>
                                        <Badge color={b.jail === 'recidive' ? 'orange' : 'blue'}>{b.jail}</Badge>
                                    </td>
                                    <td style={{ padding: '.45rem .75rem', textAlign: 'center' }}>
                                        {b.failures > 0 ? (
                                            <F2bTooltip title={`${b.failures} ${t('fail2ban.jails.attemptsWord')}`} bodyNode={
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                                                    <div style={{ color: '#e3b341', fontWeight: 700, fontSize: '.95rem' }}>{t('fail2ban.jails.failureCount', { count: b.failures })}</div>
                                                    <div style={{ color: '#8b949e', fontSize: '.72rem' }}>{t('fail2ban.jails.lastAttempt')}</div>
                                                    <div style={{ color: '#e6edf3', fontFamily: 'monospace', fontSize: '.78rem' }}>{fmtTs(b.timeofban)}</div>
                                                </div>
                                            } color="orange" placement="bottom">
                                                <span style={{ color: '#e3b341', fontSize: '.77rem', fontWeight: 600, cursor: 'default', borderBottom: '1px dotted #e3b341', paddingBottom: 1 }}>{b.failures}</span>
                                            </F2bTooltip>
                                        ) : <span style={{ color: '#30363d', fontSize: '.77rem' }}>—</span>}
                                    </td>
                                    {/* Domaine */}
                                    <td style={{ padding: '.45rem .75rem' }}>
                                        {enrichLoading && !domain ? (
                                            <span style={{ display: 'inline-block', height: 10, width: 80, borderRadius: 3, background: 'rgba(139,148,158,.18)', animation: 'f2b-shimmer 1.4s ease-in-out infinite' }} />
                                        ) : domain ? (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                                <DomainInitial domain={domain} size={13} />
                                                <span style={{ fontFamily: 'monospace', fontSize: '.7rem', color: '#39c5cf', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={domain}>{domain}</span>
                                            </span>
                                        ) : srv ? (
                                            <span style={{ fontFamily: 'monospace', fontSize: '.68rem', color: '#8b949e' }} title={logpath}>{srv}</span>
                                        ) : <span style={{ color: '#30363d', fontSize: '.7rem' }}>—</span>}
                                    </td>
                                    {/* Log */}
                                    <td style={{ padding: '.45rem .75rem' }}>
                                        {enrichLoading && !logbase ? (
                                            <span style={{ display: 'inline-block', height: 10, width: 100, borderRadius: 3, background: 'rgba(139,148,158,.18)', animation: 'f2b-shimmer 1.4s ease-in-out infinite', animationDelay: '.2s' }} />
                                        ) : (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                                {svcInfo && (
                                                    <img
                                                        src={`/icons/services/${svcInfo[0]}`}
                                                        width={15} height={15}
                                                        style={{ borderRadius: 2, flexShrink: 0, verticalAlign: '-3px' }}
                                                        title={svcInfo[1]} alt={svcInfo[1]}
                                                        loading="lazy"
                                                    />
                                                )}
                                                {logbase ? (
                                                    <span style={{ fontFamily: 'monospace', fontSize: '.7rem', color: '#8b949e', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={logpath}>{logbase}</span>
                                                ) : <span style={{ color: '#30363d', fontSize: '.7rem' }}>—</span>}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {limit > 0 && totalPages > 1 && (
                        <div style={{ padding: '.4rem 1rem', borderTop: '1px solid #30363d', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '.71rem', color: '#8b949e' }}>
                                {safePage * limit + 1}–{Math.min((safePage + 1) * limit, processed.length)} {t('fail2ban.jails.ofEvents', { count: processed.length })}
                            </span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                                <button onClick={() => setPage(0)} disabled={safePage === 0}
                                    style={{ padding: '.15rem .45rem', borderRadius: 4, border: '1px solid #30363d', background: 'transparent', color: safePage === 0 ? '#30363d' : '#8b949e', cursor: safePage === 0 ? 'default' : 'pointer', fontSize: '.75rem' }}>«</button>
                                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                                    style={{ padding: '.15rem .45rem', borderRadius: 4, border: '1px solid #30363d', background: 'transparent', color: safePage === 0 ? '#30363d' : '#8b949e', cursor: safePage === 0 ? 'default' : 'pointer', fontSize: '.75rem' }}>←</button>
                                <span style={{ fontSize: '.72rem', color: '#58a6ff', fontWeight: 600, padding: '0 .35rem' }}>{safePage + 1} / {totalPages}</span>
                                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage === totalPages - 1}
                                    style={{ padding: '.15rem .45rem', borderRadius: 4, border: '1px solid #30363d', background: 'transparent', color: safePage === totalPages - 1 ? '#30363d' : '#8b949e', cursor: safePage === totalPages - 1 ? 'default' : 'pointer', fontSize: '.75rem' }}>→</button>
                                <button onClick={() => setPage(totalPages - 1)} disabled={safePage === totalPages - 1}
                                    style={{ padding: '.15rem .45rem', borderRadius: 4, border: '1px solid #30363d', background: 'transparent', color: safePage === totalPages - 1 ? '#30363d' : '#8b949e', cursor: safePage === totalPages - 1 ? 'default' : 'pointer', fontSize: '.75rem' }}>»</button>
                            </div>
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
    jails, inactiveJails = [], statusHydrated, statusOk, statusError, actionLoading,
    days = 1, onUnban, onBan, onReload, onIpClick, onJailCreated,
}) => {
    const { t } = useTranslation();
    const bansLabel = days <= 0 ? t('fail2ban.periods.allShort') : days === 1 ? t('fail2ban.periods.last24h') : days === 7 ? t('fail2ban.periods.last7d') : days === 30 ? t('fail2ban.periods.last30d') : days === 180 ? t('fail2ban.periods.last6m') : days === 365 ? t('fail2ban.periods.last1y') : `${days}j`;
    const [showAll, setShowAll]     = useState(false);
    const [jailFilter, setJailFilter] = useState('');
    const [showNewJail, setShowNewJail] = useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const [view, setView] = useState<JailsViewMode>(() => {
        try {
            const v = localStorage.getItem(STORAGE_KEY);
            if (v === 'cards' || v === 'table' || v === 'events') return v;
        } catch { /* ignore */ }
        return 'table';
    });

    const changeView = (newView: JailsViewMode) => {
        setView(newView);
        // Scroll the nearest scrollable ancestor to top so the chart (above) remains visible
        let el: HTMLElement | null = containerRef.current?.parentElement ?? null;
        while (el) {
            if (el.scrollHeight > el.clientHeight + 4) { el.scrollTop = 0; break; }
            el = el.parentElement;
        }
    };

    useEffect(() => {
        try { localStorage.setItem(STORAGE_KEY, view); } catch { /* ignore */ }
    }, [view]);

    if (!statusHydrated && jails.length === 0) return <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e' }}>{t('fail2ban.status.loading')}</div>;
    if (statusHydrated && jails.length === 0) return (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#8b949e' }}>
            {statusOk === false ? (statusError ?? t('fail2ban.jails.fail2banUnavailable')) : t('fail2ban.jails.noJailFound')}
        </div>
    );

    const allJails     = showAll ? [...jails, ...inactiveJails] : jails;
    const displayJails = jailFilter
        ? allJails.filter(j => j.jail.toLowerCase().includes(jailFilter.toLowerCase()) || (j.filter ?? '').toLowerCase().includes(jailFilter.toLowerCase()))
        : allJails;

    return (
        <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Toolbar */}
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '.6rem' }}>
                {/* Actifs / Tous */}
                {inactiveJails.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.1rem', background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: '.25rem' }}>
                        <button onClick={() => setShowAll(false)} style={viewBtnStyle(!showAll)}>
                            {t('fail2ban.jails.activeOnly')}
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 16, padding: '0 .3rem', borderRadius: 10, fontSize: '.63rem', fontWeight: 700, background: !showAll ? 'rgba(88,166,255,.3)' : 'rgba(139,148,158,.2)', color: !showAll ? '#58a6ff' : '#8b949e', marginLeft: '.15rem' }}>{jails.length}</span>
                        </button>
                        <button onClick={() => setShowAll(true)} style={viewBtnStyle(showAll)}>
                            {t('fail2ban.jails.allJails')}
                            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 16, padding: '0 .3rem', borderRadius: 10, fontSize: '.63rem', fontWeight: 700, background: showAll ? 'rgba(88,166,255,.3)' : 'rgba(139,148,158,.2)', color: showAll ? '#58a6ff' : '#8b949e', marginLeft: '.15rem' }}>{jails.length + inactiveJails.length}</span>
                        </button>
                    </div>
                )}
                {/* Nouveau jail */}
                <button onClick={() => setShowNewJail(true)} title={t('fail2ban.newJail.title')}
                    style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: '.35rem .75rem', fontSize: '.78rem', fontWeight: 600, borderRadius: 6, background: 'rgba(63,185,80,.1)', border: '1px solid rgba(63,185,80,.3)', color: '#3fb950', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(63,185,80,.18)'}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(63,185,80,.1)'}>
                    <Plus style={{ width: 13, height: 13 }} />
                    {t('fail2ban.newJail.button')}
                </button>
                {/* Vue selector — à droite */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '.1rem', background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: '.25rem' }}>
                    <button style={viewBtnStyle(view === 'table')}  onClick={() => changeView('table')}><Table2 style={{ width: 13, height: 13 }} /> {t('fail2ban.views.table')}</button>
                    <button style={viewBtnStyle(view === 'cards')}  onClick={() => changeView('cards')}><LayoutGrid style={{ width: 13, height: 13 }} /> {t('fail2ban.views.cards')}</button>
                    <button style={viewBtnStyle(view === 'events')} onClick={() => changeView('events')}><List style={{ width: 13, height: 13 }} /> {t('fail2ban.views.events')}</button>
                </div>
            </div>

            {showNewJail && (
                <NewJailModal
                    onClose={() => setShowNewJail(false)}
                    onCreated={() => { setShowNewJail(false); onJailCreated?.(); }}
                />
            )}

            {/* Views */}
            {view === 'cards' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(380px,1fr))', gap: '1.25rem' }}>
                    {displayJails.map(jail => (
                        <JailCard key={jail.jail} jail={jail} actionLoading={actionLoading}
                            bansInPeriodLabel={bansLabel}
                            onUnban={ip => onUnban(jail.jail, ip)}
                            onBan={ip => onBan(jail.jail, ip)}
                            onReload={() => onReload(jail.jail)}
                            onIpClick={onIpClick} />
                    ))}
                </div>
            )}
            {view === 'table' && (
                <JailsTableView jails={displayJails} days={days} actionLoading={actionLoading}
                    onUnban={onUnban} onBan={onBan} onReload={onReload} onIpClick={onIpClick} />
            )}
            {/* TabJailsEvents reste monté pour éviter le scroll-to-top au changement de vue */}
            <div style={{ display: view === 'events' ? undefined : 'none' }}>
                <TabJailsEvents onIpClick={onIpClick} />
            </div>
        </div>
    );
};
