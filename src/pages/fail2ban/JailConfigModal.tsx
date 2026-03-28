/**
 * JailConfigModal — "Modifier la config" for a fail2ban jail.
 * Two tabs:
 *  - "À chaud"       : bantime / findtime / maxretry / ignoreip / usedns  (applied live via fail2ban-client)
 *  - "Reload requis" : logpath / port / filter / actions                   (writes jail.local then reloads)
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    X, Save, Square, Play, Settings, Terminal,
    Shield, ChevronDown, ChevronRight, Plus, Trash2, CheckCircle, XCircle,
    Zap, RefreshCw,
} from 'lucide-react';
import { api } from '../../api/client';
import { fmtSecs } from './helpers';
import { ConfEditorModal } from './ConfEditorModal';
import type { ConfEditorTarget } from './ConfEditorModal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface JailParams {
    ok: boolean;
    jailName: string;
    bantime?: number;
    findtime?: number;
    maxretry?: number;
    filter?: string;
    actions?: string[];
    banaction?: string;
    logpath?: string;
    port?: string;
    usedns?: string;
    ignoreip?: string[];
    hasLocalFile?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtHint(secs: number): string {
    if (isNaN(secs)) return '';
    if (secs < 0) return 'Permanent';
    if (secs === 0) return '0 sec';
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const parts: string[] = [];
    if (d) parts.push(`${d}j`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}min`);
    if (s) parts.push(`${s}s`);
    return parts.join(' ') || '0s';
}

const USEDNS_OPTIONS = [
    { v: 'warn',   l: 'warn — résoudre + avertir si FQDN' },
    { v: 'yes',    l: 'yes — résoudre les noms de domaine' },
    { v: 'no',     l: 'no — adresses IP uniquement' },
    { v: 'raw',    l: 'raw — ne pas résoudre du tout' },
];

const btnBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '.3rem',
    padding: '.3rem .7rem', borderRadius: 5, cursor: 'pointer',
    fontSize: '.78rem', fontWeight: 600, border: '1px solid',
};

const inputStyle: React.CSSProperties = {
    padding: '.3rem .55rem', fontSize: '.8rem', borderRadius: 5,
    background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3',
    outline: 'none', fontFamily: 'monospace',
};

// ── Failregex collapsible ─────────────────────────────────────────────────────

const FailregexSection: React.FC<{ jailName: string }> = ({ jailName }) => {
    const [open, setOpen] = useState(false);
    const [lines, setLines] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        // Try to get filter content from status, then read failregex
        const res = await api.get<{ ok: boolean; bans: unknown[] }>(`/api/plugins/fail2ban/audit?limit=1&jail=${encodeURIComponent(jailName)}`);
        // Fetch jail details via filter name stored in params
        setLoading(false);
    }, [jailName]);

    const toggle = () => {
        if (!open && lines.length === 0) load();
        setOpen(o => !o);
    };

    return (
        <div style={{ borderTop: '1px solid #30363d', marginTop: '.75rem' }}>
            <button onClick={toggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '.4rem', padding: '.4rem 0', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '.77rem' }}>
                <Terminal style={{ width: 11, height: 11, flexShrink: 0 }} />
                <span>Voir les failregex</span>
                <span style={{ marginLeft: 'auto' }}>
                    {open ? <ChevronDown style={{ width: 11, height: 11 }} /> : <ChevronRight style={{ width: 11, height: 11 }} />}
                </span>
            </button>
            {open && (
                <div style={{ color: '#8b949e', fontSize: '.77rem', fontStyle: 'italic', paddingBottom: '.5rem' }}>
                    Ouvrez le filtre via le badge ⚙ pour voir les failregex.
                </div>
            )}
        </div>
    );
};

// ── Param row ─────────────────────────────────────────────────────────────────

const ParamRow: React.FC<{ label: string; hint: string; id: string; value: string; onChange: (v: string) => void; min?: number }> = ({ label, hint, id, value, onChange, min = -1 }) => {
    const numVal = parseInt(value, 10);
    const hintStr = fmtHint(numVal);
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: '.5rem', alignItems: 'center', marginBottom: '.55rem' }}>
            <label htmlFor={id} style={{ fontSize: '.8rem', color: '#8b949e', fontWeight: 600 }}>{label}</label>
            <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
                <input id={id} type="number" min={min} value={value} onChange={e => onChange(e.target.value)}
                    style={{ ...inputStyle, width: '100%' }} />
                <span style={{ fontSize: '.7rem', color: numVal < 0 ? '#e86a65' : '#8b949e', whiteSpace: 'nowrap', minWidth: 60 }}>{hintStr}</span>
            </div>
            <div style={{ display: 'flex', gap: '.2rem' }}>
                <button type="button" onClick={() => onChange(String(Math.max(min, (parseInt(value) || 0) - (Math.abs(parseInt(value) || 60) > 3600 ? 3600 : 60))))}
                    style={{ ...btnBase, padding: '.2rem .45rem', fontSize: '.8rem', borderColor: '#30363d', background: 'transparent', color: '#8b949e' }}>−</button>
                <button type="button" onClick={() => onChange(String((parseInt(value) || 0) + (Math.abs(parseInt(value) || 60) >= 3600 ? 3600 : 60)))}
                    style={{ ...btnBase, padding: '.2rem .45rem', fontSize: '.8rem', borderColor: '#30363d', background: 'transparent', color: '#8b949e' }}>+</button>
            </div>
        </div>
    );
};

// ── Main modal ────────────────────────────────────────────────────────────────

export interface JailConfigModalProps {
    jailName: string;
    isActive?: boolean;
    onClose: () => void;
    onRefreshNeeded?: () => void;
}

export const JailConfigModal: React.FC<JailConfigModalProps> = ({ jailName, isActive = true, onClose, onRefreshNeeded }) => {
    const [tab,       setTab]       = useState<'live' | 'reload'>('live');
    const [params,    setParams]    = useState<JailParams | null>(null);
    const [loading,   setLoading]   = useState(true);
    const [saving,    setSaving]    = useState(false);
    const [opLoading, setOpLoading] = useState<string | null>(null);
    const [msg,       setMsg]       = useState<{ ok: boolean; text: string } | null>(null);
    const [editor,    setEditor]    = useState<ConfEditorTarget | null>(null);

    // Basic params
    const [bantime,  setBantime]  = useState('');
    const [findtime, setFindtime] = useState('');
    const [maxretry, setMaxretry] = useState('');

    // Advanced params
    const [ignoreipList,  setIgnoreipList]  = useState<string[]>([]);
    const [ignoreipInput, setIgnoreipInput] = useState('');
    const [usedns,        setUsedns]        = useState('warn');
    const [logpath,       setLogpath]       = useState('');
    const [port,          setPort]          = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        const res = await api.get<JailParams>(`/api/plugins/fail2ban/jails/${encodeURIComponent(jailName)}/params`);
        if (res.success && res.result?.ok) {
            const p = res.result;
            setParams(p);
            setBantime(String(p.bantime ?? 600));
            setFindtime(String(p.findtime ?? 600));
            setMaxretry(String(p.maxretry ?? 5));
            setIgnoreipList(p.ignoreip ?? []);
            setUsedns(p.usedns ?? 'warn');
            setLogpath(p.logpath ?? '');
            setPort(p.port ?? '');
        }
        setLoading(false);
    }, [jailName]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const fn = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editor) onClose(); };
        window.addEventListener('keydown', fn);
        return () => window.removeEventListener('keydown', fn);
    }, [onClose, editor]);

    const handleSave = async () => {
        setSaving(true); setMsg(null);
        const body: Record<string, unknown> = {
            bantime:  parseInt(bantime,  10),
            findtime: parseInt(findtime, 10),
            maxretry: parseInt(maxretry, 10),
            ignoreip: ignoreipList.join(' '),
            usedns,
            logpath,
            port,
        };
        const res = await api.post<{ ok: boolean; error?: string }>(
            `/api/plugins/fail2ban/jails/${encodeURIComponent(jailName)}/params`, body
        );
        if (res.success && res.result?.ok) {
            setMsg({ ok: true, text: 'Paramètres sauvegardés et jail rechargé.' });
            onRefreshNeeded?.();
        } else {
            setMsg({ ok: false, text: res.result?.error ?? 'Erreur inconnue' });
        }
        setSaving(false);
    };

    const handleOp = async (op: 'stop' | 'start') => {
        if (!window.confirm(op === 'stop'
            ? `Arrêter le jail « ${jailName} » ?\n\nLes IPs actuellement bannies seront débloquées.`
            : `Démarrer le jail « ${jailName} » ?`)) return;
        setOpLoading(op); setMsg(null);
        const res = await api.post<{ ok: boolean; error?: string; output?: string }>(
            `/api/plugins/fail2ban/jails/${encodeURIComponent(jailName)}/${op}`, {}
        );
        if (res.success && res.result?.ok) {
            setMsg({ ok: true, text: op === 'stop' ? 'Jail arrêté.' : 'Jail démarré.' });
            onRefreshNeeded?.();
        } else {
            setMsg({ ok: false, text: res.result?.error ?? res.result?.output ?? 'Erreur' });
        }
        setOpLoading(null);
    };

    const addIgnoreip = () => {
        const v = ignoreipInput.trim();
        if (!v || ignoreipList.includes(v)) return;
        setIgnoreipList(l => [...l, v]);
        setIgnoreipInput('');
    };

    return (
        <>
        {editor && <ConfEditorModal target={editor} onClose={() => setEditor(null)} />}
        <div style={{ position: 'fixed', inset: 0, zIndex: 8900, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.65)' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 10, width: 'min(680px, 96vw)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,.6)' }}>

                {/* Header */}
                <div style={{ background: '#21262d', padding: '.65rem 1rem', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0 }}>
                    <Shield style={{ width: 14, height: 14, color: '#58a6ff', flexShrink: 0 }} />
                    <span style={{ fontWeight: 700, fontSize: '.95rem', flex: 1 }}>{jailName.toUpperCase()}</span>
                    <span style={{ fontSize: '.72rem', color: isActive ? '#3fb950' : '#e3b341', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: isActive ? '#3fb950' : '#e3b341', flexShrink: 0 }} />
                        {isActive ? 'Actif' : 'Inactif'}
                    </span>
                    <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '.2rem', display: 'flex', alignItems: 'center' }}>
                        <X style={{ width: 16, height: 16 }} />
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', background: '#21262d', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
                    {([
                        { key: 'live',   label: 'À chaud',       Icon: Zap,        color: '#3fb950' },
                        { key: 'reload', label: 'Reload requis',  Icon: RefreshCw,  color: '#e3b341' },
                    ] as const).map(({ key, label, Icon: TabIcon, color }) => (
                        <button key={key} onClick={() => setTab(key)} style={{
                            padding: '.5rem 1rem', fontSize: '.8rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                            background: 'transparent', borderBottom: `2px solid ${tab === key ? color : 'transparent'}`,
                            color: tab === key ? color : '#8b949e',
                            display: 'flex', alignItems: 'center', gap: '.3rem',
                        }}>
                            <TabIcon style={{ width: 11, height: 11 }} />
                            {label}
                        </button>
                    ))}
                </div>

                {msg && (
                    <div style={{ padding: '.4rem 1rem', fontSize: '.8rem', color: msg.ok ? '#3fb950' : '#e86a65', background: msg.ok ? 'rgba(63,185,80,.07)' : 'rgba(232,106,101,.07)', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.4rem', flexShrink: 0 }}>
                        {msg.ok ? <CheckCircle style={{ width: 13, height: 13 }} /> : <XCircle style={{ width: 13, height: 13 }} />}
                        {msg.text}
                    </div>
                )}

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.25rem .75rem' }}>
                    {loading ? (
                        <div style={{ color: '#8b949e', fontSize: '.85rem' }}>Chargement…</div>
                    ) : tab === 'live' ? (
                        /* ── À chaud : bantime / findtime / maxretry / ignoreip / usedns ── */
                        <div>
                            {/* Timings */}
                            <div style={{ marginBottom: '.85rem' }}>
                                <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.65rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                                    <Settings style={{ width: 11, height: 11 }} /> Timings
                                </div>
                                <ParamRow label="Bantime" hint="" id="bantime" value={bantime} onChange={setBantime} />
                                <ParamRow label="Findtime" hint="" id="findtime" value={findtime} onChange={setFindtime} />
                                <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr auto', gap: '.5rem', alignItems: 'center' }}>
                                    <label htmlFor="maxretry" style={{ fontSize: '.8rem', color: '#8b949e', fontWeight: 600 }}>Maxretry</label>
                                    <div style={{ display: 'flex', gap: '.3rem', alignItems: 'center' }}>
                                        <input id="maxretry" type="number" min={1} value={maxretry} onChange={e => setMaxretry(e.target.value)}
                                            style={{ ...inputStyle, width: '100%' }} />
                                        <span style={{ fontSize: '.7rem', color: '#8b949e', whiteSpace: 'nowrap', minWidth: 60 }}>tentatives</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '.2rem' }}>
                                        <button type="button" onClick={() => setMaxretry(v => String(Math.max(1, (parseInt(v) || 1) - 1)))} style={{ ...btnBase, padding: '.2rem .45rem', fontSize: '.8rem', borderColor: '#30363d', background: 'transparent', color: '#8b949e' }}>−</button>
                                        <button type="button" onClick={() => setMaxretry(v => String((parseInt(v) || 1) + 1))} style={{ ...btnBase, padding: '.2rem .45rem', fontSize: '.8rem', borderColor: '#30363d', background: 'transparent', color: '#8b949e' }}>+</button>
                                    </div>
                                </div>
                            </div>

                            {/* Whitelist IP */}
                            <div style={{ borderTop: '1px solid #30363d', paddingTop: '.85rem', marginBottom: '.85rem' }}>
                                <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.55rem' }}>
                                    Whitelist IP (ignoreip)
                                </div>
                                {ignoreipList.length > 0 ? (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', marginBottom: '.5rem' }}>
                                        {ignoreipList.map(ip => (
                                            <span key={ip} style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem', padding: '.18rem .5rem', borderRadius: 4, fontSize: '.75rem', fontFamily: 'monospace', background: 'rgba(63,185,80,.1)', border: '1px solid rgba(63,185,80,.3)', color: '#3fb950' }}>
                                                {ip}
                                                <button onClick={() => setIgnoreipList(l => l.filter(x => x !== ip))}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e86a65', padding: 0, display: 'flex', alignItems: 'center' }}>
                                                    <Trash2 style={{ width: 10, height: 10 }} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '.78rem', color: '#8b949e', fontStyle: 'italic', marginBottom: '.5rem' }}>Aucune IP en whitelist</div>
                                )}
                                <div style={{ display: 'flex', gap: '.4rem' }}>
                                    <input type="text" value={ignoreipInput} onChange={e => setIgnoreipInput(e.target.value)}
                                        placeholder="IP ou CIDR (ex: 192.168.1.0/24)"
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addIgnoreip(); } }}
                                        style={{ ...inputStyle, flex: 1 }} />
                                    <button onClick={addIgnoreip} style={{ ...btnBase, borderColor: 'rgba(63,185,80,.4)', background: 'rgba(63,185,80,.1)', color: '#3fb950' }}>
                                        <Plus style={{ width: 12, height: 12 }} /> Ajouter
                                    </button>
                                </div>
                            </div>

                            {/* usedns */}
                            <div style={{ borderTop: '1px solid #30363d', paddingTop: '.75rem' }}>
                                <label style={{ fontSize: '.72rem', fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.55rem' }}>
                                    Résolution DNS (usedns)
                                </label>
                                <select value={usedns} onChange={e => setUsedns(e.target.value)}
                                    style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
                                    {USEDNS_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                                </select>
                            </div>
                        </div>
                    ) : (
                        /* ── Reload requis : logpath / port / filter / actions ── */
                        <div>
                            {/* logpath */}
                            <div style={{ marginBottom: '.85rem' }}>
                                <label htmlFor="logpath" style={{ fontSize: '.72rem', fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.55rem' }}>
                                    Logpath
                                </label>
                                <input id="logpath" type="text" value={logpath} onChange={e => setLogpath(e.target.value)}
                                    placeholder="/var/log/nginx/access.log"
                                    style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                                <div style={{ fontSize: '.68rem', color: '#8b949e', marginTop: '.3rem' }}>
                                    Chemin(s) séparés par des espaces. Écrasera la valeur dans jail.conf.
                                </div>
                            </div>

                            {/* port */}
                            <div style={{ borderTop: '1px solid #30363d', paddingTop: '.75rem', marginBottom: '.85rem' }}>
                                <label htmlFor="port-input" style={{ fontSize: '.72rem', fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em', display: 'block', marginBottom: '.55rem' }}>
                                    Port(s)
                                </label>
                                <input id="port-input" type="text" value={port} onChange={e => setPort(e.target.value)}
                                    placeholder="http,https ou 80,443"
                                    style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                            </div>

                            {/* Filter + Actions */}
                            <div style={{ borderTop: '1px solid #30363d', paddingTop: '.85rem' }}>
                                <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '.65rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                                    <Terminal style={{ width: 11, height: 11 }} /> Filtre &amp; Actions
                                </div>

                                {/* Filter */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.5rem' }}>
                                    <span style={{ fontSize: '.8rem', color: '#8b949e', fontWeight: 600, minWidth: 90 }}>Filtre</span>
                                    {params?.filter ? (
                                        <span onClick={() => setEditor({ type: 'filter', name: params.filter!, jails: [jailName] })}
                                            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.25rem', padding: '.18rem .5rem', borderRadius: 4, fontSize: '.78rem', background: 'rgba(63,185,80,.1)', border: '1px solid rgba(63,185,80,.35)', color: '#3fb950' }}
                                            title="Voir / éditer le filtre">
                                            ⚙ {params.filter}
                                        </span>
                                    ) : (
                                        <span style={{ color: '#8b949e', fontSize: '.78rem' }}>—</span>
                                    )}
                                </div>

                                {/* Actions */}
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.5rem' }}>
                                    <span style={{ fontSize: '.8rem', color: '#8b949e', fontWeight: 600, minWidth: 90, paddingTop: '.2rem' }}>Actions</span>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.3rem', flex: 1 }}>
                                        {(params?.actions?.length ?? 0) > 0
                                            ? params!.actions!.map(a => (
                                                <span key={a} onClick={() => setEditor({ type: 'action', name: a, jails: [jailName] })}
                                                    style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.25rem', padding: '.18rem .5rem', borderRadius: 4, fontSize: '.78rem', background: 'rgba(227,179,65,.1)', border: '1px solid rgba(227,179,65,.35)', color: '#e3b341' }}
                                                    title="Voir / éditer l'action">
                                                    ⚡ {a}
                                                </span>
                                            ))
                                            : params?.banaction
                                                ? <span onClick={() => setEditor({ type: 'action', name: params.banaction!, jails: [jailName] })}
                                                    style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '.25rem', padding: '.18rem .5rem', borderRadius: 4, fontSize: '.78rem', background: 'rgba(232,106,101,.1)', border: '1px solid rgba(232,106,101,.35)', color: '#e86a65' }}
                                                    title="Voir / éditer l'action">
                                                    ⚡ {params.banaction}
                                                  </span>
                                                : <span style={{ color: '#8b949e', fontSize: '.78rem' }}>—</span>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ padding: '.75rem 1.25rem', borderTop: '1px solid #30363d', background: '#21262d', display: 'flex', alignItems: 'center', gap: '.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
                    {isActive && (
                        <button onClick={() => handleOp('stop')} disabled={opLoading === 'stop'}
                            style={{ ...btnBase, borderColor: 'rgba(232,106,101,.35)', background: 'rgba(232,106,101,.1)', color: '#e86a65', opacity: opLoading === 'stop' ? .6 : 1 }}>
                            <Square style={{ width: 11, height: 11 }} /> {opLoading === 'stop' ? 'Arrêt…' : 'Arrêter le jail'}
                        </button>
                    )}
                    {!isActive && (
                        <button onClick={() => handleOp('start')} disabled={opLoading === 'start'}
                            style={{ ...btnBase, borderColor: 'rgba(63,185,80,.35)', background: 'rgba(63,185,80,.1)', color: '#3fb950', opacity: opLoading === 'start' ? .6 : 1 }}>
                            <Play style={{ width: 11, height: 11 }} /> {opLoading === 'start' ? 'Démarrage…' : 'Démarrer le jail'}
                        </button>
                    )}
                    <div style={{ flex: 1 }} />
                    <button onClick={onClose} style={{ ...btnBase, borderColor: '#30363d', background: 'transparent', color: '#8b949e' }}>
                        Annuler
                    </button>
                    <button onClick={handleSave} disabled={saving}
                        style={{ ...btnBase, borderColor: tab === 'reload' ? 'rgba(227,179,65,.4)' : 'rgba(63,185,80,.4)', background: tab === 'reload' ? 'rgba(227,179,65,.12)' : 'rgba(63,185,80,.12)', color: tab === 'reload' ? '#e3b341' : '#3fb950', opacity: saving ? .6 : 1 }}>
                        <Save style={{ width: 12, height: 12 }} /> {saving ? 'Enregistrement…' : tab === 'reload' ? 'Appliquer + Reload' : 'Appliquer'}
                    </button>
                </div>
            </div>
        </div>
        </>
    );
};
