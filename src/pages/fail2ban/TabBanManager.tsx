import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Unlock, Database, Shield, ListChecks, AlertTriangle, CheckCircle, FolderOpen, ChevronDown, Network } from 'lucide-react';
import { api } from '../../api/client';
import { card, cardH, cardB } from './helpers';
import type { JailStatus } from './types';

// ── Module-level cache ────────────────────────────────────────────────────────
const _cache: Record<string, { data: unknown; ts: number }> = {};
const CACHE_TTL = 60_000;
function getCached<T>(key: string): T | null { const e = _cache[key]; return (e && Date.now() - e.ts < CACHE_TTL) ? e.data as T : null; }
function setCached(key: string, data: unknown) { _cache[key] = { data, ts: Date.now() }; }

interface TabBanManagerProps {
    jails: JailStatus[];
    actionLoading: string | null;
    onBan:   (jail: string, ip: string) => void;
    onUnban: (jail: string, ip: string) => void;
    onIpClick?: (ip: string) => void;
}

interface IpsetEntry { name: string; entries: number }
interface BulkResult { ip: string; ok: boolean; error?: string }

// ── IP / CIDR validation ───────────────────────────────────────────────────────

function isValidIpOrCidr(v: string): boolean {
    const s = v.trim();
    // IPv4
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s))
        return s.split('.').every(n => +n >= 0 && +n <= 255);
    // IPv4 CIDR
    const m4 = s.match(/^((\d{1,3}\.){3}\d{1,3})\/(\d{1,2})$/);
    if (m4) return m4[1].split('.').every(n => +n <= 255) && +m4[3] <= 32;
    // IPv6 (simplified — contains at least one colon)
    if (s.includes(':') && /^[0-9a-fA-F:]{2,39}$/.test(s)) return true;
    // IPv6 CIDR
    const m6 = s.match(/^([0-9a-fA-F:]+)\/(\d{1,3})$/);
    if (m6 && m6[1].includes(':')) return +m6[2] <= 128;
    return false;
}

// ── Shared input / button styles ───────────────────────────────────────────────

const INPUT_BASE: React.CSSProperties = {
    width: '100%', padding: '.4rem .65rem', fontSize: '.83rem', borderRadius: 5,
    background: '#080c12', border: '1px solid #30363d', color: '#e6edf3',
    outline: 'none', boxSizing: 'border-box',
    boxShadow: 'inset 0 2px 5px rgba(0,0,0,.65), inset 0 -1px 0 rgba(255,255,255,.03)',
    transition: 'border-color .15s, box-shadow .15s',
};

function StyledInput({ value, onChange, placeholder, extraStyle, onKeyDown, hasError }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    extraStyle?: React.CSSProperties;
    onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
    hasError?: boolean;
}) {
    const [focused, setFocused] = React.useState(false);
    const borderColor = hasError ? '#e86a65' : focused ? '#58a6ff' : '#30363d';
    const shadow = hasError
        ? (focused ? 'inset 0 1px 3px rgba(0,0,0,.45), 0 0 0 3px rgba(232,106,101,.18)' : 'inset 0 1px 3px rgba(0,0,0,.45), 0 0 0 2px rgba(232,106,101,.12)')
        : (focused ? 'inset 0 1px 3px rgba(0,0,0,.45), 0 0 0 3px rgba(88,166,255,.14)' : INPUT_BASE.boxShadow as string);
    return (
        <input type="text" value={value} onChange={onChange} placeholder={placeholder}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
            style={{ ...INPUT_BASE, fontFamily: 'monospace', borderColor, boxShadow: shadow, ...extraStyle }} />
    );
}

function StyledTextarea({ value, onChange, placeholder }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
}) {
    const [focused, setFocused] = React.useState(false);
    return (
        <textarea value={value} onChange={onChange} placeholder={placeholder}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            style={{
                ...INPUT_BASE,
                fontFamily: 'monospace', resize: 'vertical', minHeight: 80,
                lineHeight: 1.45, fontSize: '.76rem',
                borderColor: focused ? '#58a6ff' : '#30363d',
                boxShadow: focused
                    ? 'inset 0 1px 3px rgba(0,0,0,.45), 0 0 0 3px rgba(88,166,255,.14)'
                    : INPUT_BASE.boxShadow as string,
            }} />
    );
}

// ── Styled select with dark chevron ───────────────────────────────────────────

function StyledSelect({ value, onChange, children }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
    children: React.ReactNode;
}) {
    const [focused, setFocused] = React.useState(false);
    return (
        <div style={{ position: 'relative', width: '100%' }}>
            <select
                value={value}
                onChange={onChange}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={{
                    width: '100%', padding: '.4rem 2rem .4rem .65rem', fontSize: '.83rem', borderRadius: 5,
                    background: '#21262d', border: `1px solid ${focused ? '#58a6ff' : '#30363d'}`,
                    color: '#e6edf3', outline: 'none', boxSizing: 'border-box',
                    appearance: 'none', cursor: 'pointer', transition: 'border-color .12s',
                }}>
                {children}
            </select>
            <ChevronDown style={{
                position: 'absolute', right: '.55rem', top: '50%', transform: 'translateY(-50%)',
                width: 13, height: 13, color: '#8b949e', pointerEvents: 'none',
            }} />
        </div>
    );
}

// ── File input button (hidden native input + styled label) ────────────────────

function FileBtn({ onChange, label = 'Charger depuis un fichier' }: {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    label?: string;
}) {
    return (
        <label style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.4rem',
            padding: '.38rem .7rem', borderRadius: 5, cursor: 'pointer', width: '100%',
            boxSizing: 'border-box', background: '#21262d', border: '1px solid #30363d',
            color: '#8b949e', fontSize: '.76rem', fontWeight: 500, transition: 'border-color .12s',
        }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#58a6ff'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = '#30363d'}>
            <input type="file" accept=".txt,.csv,text/plain" onChange={onChange} style={{ display: 'none' }} />
            <FolderOpen style={{ width: 13, height: 13, flexShrink: 0 }} />
            {label}
        </label>
    );
}

function ActionBtn({ color, border, bg, disabled, onClick, children }: {
    color: string; border: string; bg: string; disabled: boolean;
    onClick?: () => void; children: React.ReactNode;
}) {
    return (
        <button onClick={onClick} disabled={disabled}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.4rem', padding: '.45rem', borderRadius: 6, background: bg, border: `1px solid ${border}`, color, cursor: disabled ? 'default' : 'pointer', fontWeight: 600, fontSize: '.83rem', width: '100%', opacity: disabled ? .5 : 1 }}>
            {children}
        </button>
    );
}

function ResultList({ results, onIpClick }: { results: BulkResult[]; onIpClick?: (ip: string) => void }) {
    if (!results.length) return null;
    return (
        <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: '.5rem', display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
            {results.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.72rem', color: r.ok ? '#3fb950' : '#e86a65' }}>
                    {r.ok ? <CheckCircle style={{ width: 10, height: 10, flexShrink: 0 }} /> : <AlertTriangle style={{ width: 10, height: 10, flexShrink: 0 }} />}
                    <button onClick={() => onIpClick?.(r.ip)} style={{ background: 'none', border: 'none', cursor: onIpClick ? 'pointer' : 'default', padding: 0, fontFamily: 'monospace', color: '#e6edf3', fontWeight: 600 }}>{r.ip}</button>
                    {!r.ok && r.error && <span style={{ color: '#8b949e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {r.error}</span>}
                </div>
            ))}
        </div>
    );
}

// ── Section title ─────────────────────────────────────────────────────────────

function SectionTitle({ icon, color, label, avail }: { icon: React.ReactNode; color: string; label: string; avail?: boolean | null }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.65rem' }}>
            <span style={{ color }}>{icon}</span>
            <span style={{ fontWeight: 700, fontSize: '.82rem', color, letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</span>
            {avail === false && (
                <span style={{ fontSize: '.67rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(232,106,101,.1)', color: '#e86a65', border: '1px solid rgba(232,106,101,.22)' }}>Non disponible</span>
            )}
            {avail === true && (
                <span style={{ fontSize: '.67rem', padding: '.1rem .45rem', borderRadius: 4, background: 'rgba(63,185,80,.1)', color: '#3fb950', border: '1px solid rgba(63,185,80,.22)' }}>Disponible</span>
            )}
            <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${color}44 0%, transparent 100%)` }} />
        </div>
    );
}

// ── Card with pinned footer ────────────────────────────────────────────────────
// Wraps a card so the action area is always at the bottom, regardless of content height.

function ActionCard({ header, children, action }: {
    header: React.ReactNode;
    children: React.ReactNode;
    action: React.ReactNode;
}) {
    return (
        <div style={{ ...card, display: 'flex', flexDirection: 'column' }}>
            <div style={cardH}>{header}</div>
            <div style={{ ...cardB, flex: 1, display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                    {children}
                </div>
                <div style={{ paddingTop: '.5rem', borderTop: '1px solid rgba(255,255,255,.04)' }}>
                    {action}
                </div>
            </div>
        </div>
    );
}

// ── Main component ─────────────────────────────────────────────────────────────

const IPT_CHAINS = ['INPUT', 'OUTPUT', 'FORWARD'];

export const TabBanManager: React.FC<TabBanManagerProps> = ({ jails, actionLoading, onBan, onUnban, onIpClick }) => {
    const { t } = useTranslation();
    // ── Fail2ban single ────────────────────────────────────────────────────────
    const [banJail,   setBanJail]   = useState(jails[0]?.jail ?? '');
    const [banIp,     setBanIp]     = useState('');
    const [unbanJail, setUnbanJail] = useState(jails[0]?.jail ?? '');
    const [unbanIp,   setUnbanIp]   = useState('');

    // ── IPTables ───────────────────────────────────────────────────────────────
    const [iptBanChain,    setIptBanChain]    = useState('INPUT');
    const [iptBanIp,       setIptBanIp]       = useState('');
    const [iptBanLoading,  setIptBanLoading]  = useState(false);
    const [iptBanResult,   setIptBanResult]   = useState<{ ok: boolean; msg: string } | null>(null);
    const [iptUnbanChain,  setIptUnbanChain]  = useState('INPUT');
    const [iptUnbanIp,     setIptUnbanIp]     = useState('');
    const [iptUnbanLoad,   setIptUnbanLoad]   = useState(false);
    const [iptUnbanResult, setIptUnbanResult] = useState<{ ok: boolean; msg: string } | null>(null);

    const doIptBan = async () => {
        const ip = iptBanIp.trim(); if (!ip) return;
        setIptBanLoading(true); setIptBanResult(null);
        const res = await api.post<{ ok: boolean; output?: string; error?: string }>(
            '/api/plugins/fail2ban/iptables/ip/ban', { table: 'filter', chain: iptBanChain, ip }
        );
        setIptBanLoading(false);
        if (res.success && res.result?.ok) { setIptBanResult({ ok: true, msg: `${ip} bloqué dans ${iptBanChain}` }); setIptBanIp(''); }
        else setIptBanResult({ ok: false, msg: res.result?.error ?? t('fail2ban.errors.unknown') });
    };

    const doIptUnban = async () => {
        const ip = iptUnbanIp.trim(); if (!ip) return;
        setIptUnbanLoad(true); setIptUnbanResult(null);
        const res = await api.post<{ ok: boolean; output?: string; error?: string }>(
            '/api/plugins/fail2ban/iptables/ip/unban', { table: 'filter', chain: iptUnbanChain, ip }
        );
        setIptUnbanLoad(false);
        if (res.success && res.result?.ok) { setIptUnbanResult({ ok: true, msg: `${ip} débloqué dans ${iptUnbanChain}` }); setIptUnbanIp(''); }
        else setIptUnbanResult({ ok: false, msg: res.result?.error ?? t('fail2ban.errors.unknown') });
    };

    // ── Fail2ban bulk ──────────────────────────────────────────────────────────
    const [bulkJail,    setBulkJail]    = useState(jails[0]?.jail ?? '');
    const [bulkIps,     setBulkIps]     = useState('');
    const [bulkLoading, setBulkLoading] = useState(false);
    const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);

    // ── Availability checks ────────────────────────────────────────────────────
    const [f2bAvail,   setF2bAvail]   = useState<boolean | null>(null);
    const [iptAvail,   setIptAvail]   = useState<boolean | null>(null);
    const [ipsetAvail, setIpsetAvail] = useState<boolean | null>(null);

    useEffect(() => {
        // Use cached availability to show UI instantly
        const cf = getCached<boolean>('banmgr:avail:f2b');
        const ci = getCached<boolean>('banmgr:avail:ipt');
        const cs = getCached<boolean>('banmgr:avail:ipset');
        if (cf !== null) setF2bAvail(cf);
        if (ci !== null) setIptAvail(ci);
        if (cs !== null) setIpsetAvail(cs);
        // Refresh in background (already parallel — 3 independent chains)
        api.get<{ checks?: { daemon?: { ok: boolean } } }>('/api/plugins/fail2ban/check')
            .then(r => { const v = r.success && r.result?.checks?.daemon?.ok === true; setCached('banmgr:avail:f2b', v); setF2bAvail(v); })
            .catch(() => setF2bAvail(false));
        api.get<{ ok: boolean }>('/api/plugins/fail2ban/iptables')
            .then(r => { const v = r.success && r.result?.ok === true; setCached('banmgr:avail:ipt', v); setIptAvail(v); })
            .catch(() => setIptAvail(false));
        api.get<{ ok: boolean }>('/api/plugins/fail2ban/ipset/info')
            .then(r => { const v = r.success && r.result?.ok === true; setCached('banmgr:avail:ipset', v); setIpsetAvail(v); })
            .catch(() => setIpsetAvail(false));
    }, []);

    // ── IPSet ─────────────────────────────────────────────────────────────────
    const [ipsets,          setIpsets]          = useState<IpsetEntry[]>([]);
    const [ipsetsLoading,   setIpsetsLoading]   = useState(false);
    const [addSet,          setAddSet]          = useState('');
    const [addEntry,        setAddEntry]        = useState('');
    const [addLoading,      setAddLoading]      = useState(false);
    const [addResult,       setAddResult]       = useState<{ ok: boolean; msg: string } | null>(null);
    const [delSet,          setDelSet]          = useState('');
    const [delEntry,        setDelEntry]        = useState('');
    const [delLoading,      setDelLoading]      = useState(false);
    const [delResult,       setDelResult]       = useState<{ ok: boolean; msg: string } | null>(null);
    const [bulkIpsetSet,    setBulkIpsetSet]    = useState('');
    const [bulkIpsetList,   setBulkIpsetList]   = useState('');
    const [bulkIpsetLoad,   setBulkIpsetLoad]   = useState(false);
    const [bulkIpsetResult, setBulkIpsetResult] = useState<BulkResult[]>([]);

    const loadIpsets = useCallback((force = false) => {
        const cached = !force && getCached<IpsetEntry[]>('banmgr:ipsets');
        if (cached) {
            setIpsets(cached);
            if (!addSet && cached[0]) setAddSet(cached[0].name);
            if (!delSet && cached[0]) setDelSet(cached[0].name);
            if (!bulkIpsetSet && cached[0]) setBulkIpsetSet(cached[0].name);
            return;
        }
        setIpsetsLoading(true);
        api.get<{ ok: boolean; sets: IpsetEntry[] }>('/api/plugins/fail2ban/ipset/sets')
            .then(res => {
                if (res.success && res.result?.ok) {
                    setCached('banmgr:ipsets', res.result.sets);
                    setIpsets(res.result.sets);
                    if (!addSet && res.result.sets[0]) setAddSet(res.result.sets[0].name);
                    if (!delSet && res.result.sets[0]) setDelSet(res.result.sets[0].name);
                    if (!bulkIpsetSet && res.result.sets[0]) setBulkIpsetSet(res.result.sets[0].name);
                }
                setIpsetsLoading(false);
            });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { loadIpsets(); }, [loadIpsets]);

    // ── Fail2ban bulk ban ──────────────────────────────────────────────────────
    const doBulkBan = async () => {
        const lines = bulkIps.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length || !bulkJail) return;
        setBulkLoading(true); setBulkResults([]);
        const results: BulkResult[] = [];
        for (const ip of lines) {
            if (!isValidIpOrCidr(ip)) { results.push({ ip, ok: false, error: 'Format IP/CIDR invalide' }); continue; }
            const res = await api.post<{ ok: boolean; error?: string }>('/api/plugins/fail2ban/ban', { jail: bulkJail, ip });
            results.push({ ip, ok: !!(res.success && res.result?.ok), error: res.result?.error });
        }
        setBulkResults(results);
        setBulkLoading(false);
    };

    const loadBulkFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => setBulkIps((ev.target?.result as string) ?? '');
        reader.readAsText(file);
        e.target.value = '';
    };

    // ── IPSet add ──────────────────────────────────────────────────────────────
    const doIpsetAdd = async () => {
        if (!addSet || !addEntry.trim()) return;
        setAddLoading(true); setAddResult(null);
        const res = await api.post<{ ok: boolean; error?: string; output?: string }>('/api/plugins/fail2ban/ipset/add', { set: addSet, entry: addEntry.trim() });
        setAddLoading(false);
        if (res.success && res.result?.ok) {
            setAddResult({ ok: true, msg: `${addEntry.trim()} ajouté à ${addSet}` });
            setAddEntry('');
            loadIpsets(true);
        } else {
            setAddResult({ ok: false, msg: res.result?.error ?? t('fail2ban.errors.unknown') });
        }
    };

    // ── IPSet del ──────────────────────────────────────────────────────────────
    const doIpsetDel = async () => {
        if (!delSet || !delEntry.trim()) return;
        setDelLoading(true); setDelResult(null);
        const res = await api.post<{ ok: boolean; error?: string }>('/api/plugins/fail2ban/ipset/del', { set: delSet, entry: delEntry.trim() });
        setDelLoading(false);
        if (res.success && res.result?.ok) {
            setDelResult({ ok: true, msg: `${delEntry.trim()} retiré de ${delSet}` });
            setDelEntry('');
            loadIpsets(true);
        } else {
            setDelResult({ ok: false, msg: res.result?.error ?? t('fail2ban.errors.unknown') });
        }
    };

    // ── IPSet bulk add ─────────────────────────────────────────────────────────
    const doBulkIpsetAdd = async () => {
        const entries = bulkIpsetList.split('\n').map(l => l.trim()).filter(Boolean);
        if (!entries.length || !bulkIpsetSet) return;
        setBulkIpsetLoad(true); setBulkIpsetResult([]);
        const results: BulkResult[] = [];
        for (const entry of entries) {
            if (!isValidIpOrCidr(entry)) { results.push({ ip: entry, ok: false, error: 'Format IP/CIDR invalide' }); continue; }
            const res = await api.post<{ ok: boolean; error?: string }>('/api/plugins/fail2ban/ipset/add', { set: bulkIpsetSet, entry });
            results.push({ ip: entry, ok: !!(res.success && res.result?.ok), error: res.result?.error });
        }
        setBulkIpsetResult(results);
        setBulkIpsetLoad(false);
        loadIpsets();
    };

    const loadIpsetFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => setBulkIpsetList((ev.target?.result as string) ?? '');
        reader.readAsText(file);
        e.target.value = '';
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* ── Fail2ban section ── */}
            <div>
                <SectionTitle icon={<Shield style={{ width: 15, height: 15 }} />} color="#58a6ff" label="Fail2Ban" avail={f2bAvail} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,420px),1fr))', gap: '.75rem' }}>

                    {/* Ban single */}
                    <ActionCard
                        header={<><Ban style={{ width: 14, height: 14, color: '#e3b341' }} /><span style={{ fontWeight: 600, fontSize: '.88rem' }}>Bannir via Fail2Ban</span></>}
                        action={
                            <ActionBtn color="#e3b341" border="rgba(227,179,65,.25)" bg="rgba(227,179,65,.1)"
                                disabled={!banIp.trim() || !isValidIpOrCidr(banIp) || !banJail || !!actionLoading}
                                onClick={() => { if (banIp.trim() && banJail) { onBan(banJail, banIp.trim()); setBanIp(''); } }}>
                                <Ban style={{ width: 13, height: 13 }} /> Bannir l'IP
                            </ActionBtn>
                        }>
                        <p style={{ fontSize: '.78rem', color: '#8b949e', margin: 0 }}>Bannit une IP dans un jail fail2ban.</p>
                        <StyledSelect value={banJail} onChange={e => setBanJail(e.target.value)}>
                            <option value="" style={{ background: '#21262d', color: '#8b949e' }}>— Sélectionner —</option>
                            {jails.map(j => <option key={j.jail} value={j.jail} style={{ background: '#21262d', color: '#e6edf3' }}>{j.jail}</option>)}
                        </StyledSelect>
                        <StyledInput value={banIp} onChange={e => setBanIp(e.target.value)} placeholder="ex: 1.2.3.4"
                            hasError={banIp.trim().length > 0 && !isValidIpOrCidr(banIp)} />
                    </ActionCard>

                    {/* Bulk ban F2B */}
                    <ActionCard
                        header={<><ListChecks style={{ width: 14, height: 14, color: '#bc8cff' }} /><span style={{ fontWeight: 600, fontSize: '.88rem' }}>Bannir en masse (Fail2Ban)</span></>}
                        action={
                            <>
                                <ActionBtn color="#bc8cff" border="rgba(188,140,255,.25)" bg="rgba(188,140,255,.1)"
                                    disabled={bulkLoading || !bulkIps.trim() || !bulkJail}
                                    onClick={doBulkBan}>
                                    <Ban style={{ width: 13, height: 13 }} />{bulkLoading ? 'Bannissement…' : 'Bannir'}
                                </ActionBtn>
                                <ResultList results={bulkResults} onIpClick={onIpClick} />
                            </>
                        }>
                        <p style={{ fontSize: '.78rem', color: '#8b949e', margin: 0 }}>Liste d'IPs → jail fail2ban.</p>
                        <StyledSelect value={bulkJail} onChange={e => setBulkJail(e.target.value)}>
                            <option value="" style={{ background: '#21262d', color: '#8b949e' }}>— Sélectionner —</option>
                            {jails.map(j => <option key={j.jail} value={j.jail} style={{ background: '#21262d', color: '#e6edf3' }}>{j.jail}</option>)}
                        </StyledSelect>
                        <StyledTextarea value={bulkIps} onChange={e => setBulkIps(e.target.value)} placeholder={"1.2.3.4\n5.6.7.8"} />
                        <FileBtn onChange={loadBulkFile} />
                    </ActionCard>

                    {/* Unban single */}
                    <ActionCard
                        header={<><Unlock style={{ width: 14, height: 14, color: '#3fb950' }} /><span style={{ fontWeight: 600, fontSize: '.88rem' }}>Débannir via Fail2Ban</span></>}
                        action={
                            <ActionBtn color="#3fb950" border="rgba(63,185,80,.25)" bg="rgba(63,185,80,.1)"
                                disabled={!unbanIp.trim() || !isValidIpOrCidr(unbanIp) || !unbanJail || !!actionLoading}
                                onClick={() => { if (unbanIp.trim() && unbanJail) { onUnban(unbanJail, unbanIp.trim()); setUnbanIp(''); } }}>
                                <Unlock style={{ width: 13, height: 13 }} /> Débannir l'IP
                            </ActionBtn>
                        }>
                        <p style={{ fontSize: '.78rem', color: '#8b949e', margin: 0 }}>Retire l'IP du jail et de la liste de blocage.</p>
                        <StyledSelect value={unbanJail} onChange={e => setUnbanJail(e.target.value)}>
                            <option value="" style={{ background: '#21262d', color: '#8b949e' }}>— Sélectionner —</option>
                            {jails.map(j => <option key={j.jail} value={j.jail} style={{ background: '#21262d', color: '#e6edf3' }}>{j.jail}</option>)}
                        </StyledSelect>
                        <StyledInput value={unbanIp} onChange={e => setUnbanIp(e.target.value)} placeholder="ex: 1.2.3.4"
                            hasError={unbanIp.trim().length > 0 && !isValidIpOrCidr(unbanIp)} />
                    </ActionCard>
                </div>
            </div>

            {/* ── IPSet section ── */}
            <div>
                <SectionTitle icon={<Database style={{ width: 15, height: 15 }} />} color="#bc8cff" label="IPSet" avail={ipsetAvail} />
                {ipsetAvail === false ? (
                    <div style={{ ...card, padding: '1rem 1.25rem', fontSize: '.82rem', color: '#8b949e', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                        <AlertTriangle style={{ width: 13, height: 13, color: '#e3b341', flexShrink: 0 }} />
                        <span><code style={{ fontFamily: 'monospace', color: '#e6edf3' }}>ipset</code> non accessible — vérifiez <code style={{ fontFamily: 'monospace', color: '#e6edf3' }}>NET_ADMIN</code> + <code style={{ fontFamily: 'monospace', color: '#e6edf3' }}>network_mode: host</code> dans docker-compose.yml</span>
                    </div>
                ) : ipsetAvail === null ? (
                    <div style={{ color: '#8b949e', fontSize: '.8rem', padding: '.25rem .5rem' }}>Vérification…</div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,420px),1fr))', gap: '.75rem' }}>

                        {/* IPSet add */}
                        <ActionCard
                            header={<><Ban style={{ width: 14, height: 14, color: '#e86a65' }} /><span style={{ fontWeight: 600, fontSize: '.88rem' }}>Bloquer via IPSet</span></>}
                            action={
                                <>
                                    {addResult && (
                                        <div style={{ fontSize: '.75rem', marginBottom: '.45rem', color: addResult.ok ? '#3fb950' : '#e86a65', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                            {addResult.ok ? <CheckCircle style={{ width: 11, height: 11 }} /> : <AlertTriangle style={{ width: 11, height: 11 }} />}
                                            {addResult.msg}
                                        </div>
                                    )}
                                    <ActionBtn color="#e86a65" border="rgba(232,106,101,.25)" bg="rgba(232,106,101,.1)"
                                        disabled={addLoading || !addSet || !addEntry.trim() || !isValidIpOrCidr(addEntry)}
                                        onClick={doIpsetAdd}>
                                        <Ban style={{ width: 13, height: 13 }} />{addLoading ? 'Blocage…' : 'Bloquer IP / Plage'}
                                    </ActionBtn>
                                </>
                            }>
                            <p style={{ fontSize: '.78rem', color: '#8b949e', margin: 0 }}>Ajoute une IP ou plage CIDR dans un IPSet.</p>
                            <StyledSelect value={addSet} onChange={e => setAddSet(e.target.value)}>
                                <option value="" style={{ background: '#21262d', color: '#8b949e' }}>— Sélectionner —</option>
                                {ipsets.map(s => <option key={s.name} value={s.name} style={{ background: '#21262d', color: '#e6edf3' }}>{s.name} ({s.entries} entrées)</option>)}
                            </StyledSelect>
                            <StyledInput value={addEntry} onChange={e => setAddEntry(e.target.value)} placeholder="ex: 1.2.3.4 ou 1.2.0.0/16"
                                hasError={addEntry.trim().length > 0 && !isValidIpOrCidr(addEntry)} />
                        </ActionCard>

                        {/* IPSet bulk add */}
                        <ActionCard
                            header={<><ListChecks style={{ width: 14, height: 14, color: '#e86a65' }} /><span style={{ fontWeight: 600, fontSize: '.88rem' }}>Bloquer en masse (IPSet)</span></>}
                            action={
                                <>
                                    <ActionBtn color="#e86a65" border="rgba(232,106,101,.25)" bg="rgba(232,106,101,.1)"
                                        disabled={bulkIpsetLoad || !bulkIpsetList.trim() || !bulkIpsetSet}
                                        onClick={doBulkIpsetAdd}>
                                        <Ban style={{ width: 13, height: 13 }} />{bulkIpsetLoad ? 'Blocage…' : 'Bloquer'}
                                    </ActionBtn>
                                    <ResultList results={bulkIpsetResult} />
                                </>
                            }>
                            <p style={{ fontSize: '.78rem', color: '#8b949e', margin: 0 }}>Liste d'IPs ou CIDR → IPSet cible.</p>
                            <StyledSelect value={bulkIpsetSet} onChange={e => setBulkIpsetSet(e.target.value)}>
                                <option value="" style={{ background: '#21262d', color: '#8b949e' }}>— Sélectionner —</option>
                                {ipsets.map(s => <option key={s.name} value={s.name} style={{ background: '#21262d', color: '#e6edf3' }}>{s.name}</option>)}
                            </StyledSelect>
                            <StyledTextarea value={bulkIpsetList} onChange={e => setBulkIpsetList(e.target.value)} placeholder={"1.2.3.4\n10.0.0.0/24"} />
                            <FileBtn onChange={loadIpsetFile} />
                        </ActionCard>

                        {/* IPSet del */}
                        <ActionCard
                            header={<><Unlock style={{ width: 14, height: 14, color: '#3fb950' }} /><span style={{ fontWeight: 600, fontSize: '.88rem' }}>Retirer d'un IPSet</span></>}
                            action={
                                <>
                                    {delResult && (
                                        <div style={{ fontSize: '.75rem', marginBottom: '.45rem', color: delResult.ok ? '#3fb950' : '#e86a65', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                            {delResult.ok ? <CheckCircle style={{ width: 11, height: 11 }} /> : <AlertTriangle style={{ width: 11, height: 11 }} />}
                                            {delResult.msg}
                                        </div>
                                    )}
                                    <ActionBtn color="#3fb950" border="rgba(63,185,80,.25)" bg="rgba(63,185,80,.1)"
                                        disabled={delLoading || !delSet || !delEntry.trim() || !isValidIpOrCidr(delEntry)}
                                        onClick={doIpsetDel}>
                                        <Unlock style={{ width: 13, height: 13 }} />{delLoading ? 'Suppression…' : 'Retirer l\'entrée'}
                                    </ActionBtn>
                                </>
                            }>
                            <p style={{ fontSize: '.78rem', color: '#8b949e', margin: 0 }}>Supprime une IP ou CIDR d'un IPSet.</p>
                            <StyledSelect value={delSet} onChange={e => setDelSet(e.target.value)}>
                                <option value="" style={{ background: '#21262d', color: '#8b949e' }}>— Sélectionner —</option>
                                {ipsets.map(s => <option key={s.name} value={s.name} style={{ background: '#21262d', color: '#e6edf3' }}>{s.name} ({s.entries} entrées)</option>)}
                            </StyledSelect>
                            <StyledInput value={delEntry} onChange={e => setDelEntry(e.target.value)} placeholder="ex: 1.2.3.4 ou 1.2.0.0/16"
                                hasError={delEntry.trim().length > 0 && !isValidIpOrCidr(delEntry)} />
                        </ActionCard>
                    </div>
                )}
            </div>

            {/* ── IPTables section ── */}
            <div>
                <SectionTitle icon={<Network style={{ width: 15, height: 15 }} />} color="#39c5cf" label="IPTables (filter)" avail={iptAvail} />
                {iptAvail === false ? (
                    <div style={{ ...card, padding: '1rem 1.25rem', fontSize: '.82rem', color: '#8b949e', display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                        <AlertTriangle style={{ width: 13, height: 13, color: '#e3b341', flexShrink: 0 }} />
                        <span><code style={{ fontFamily: 'monospace', color: '#e6edf3' }}>iptables</code> non accessible — vérifiez <code style={{ fontFamily: 'monospace', color: '#e6edf3' }}>NET_ADMIN</code> + <code style={{ fontFamily: 'monospace', color: '#e6edf3' }}>network_mode: host</code> dans docker-compose.yml</span>
                    </div>
                ) : iptAvail === null ? (
                    <div style={{ color: '#8b949e', fontSize: '.8rem', padding: '.25rem .5rem' }}>Vérification…</div>
                ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,420px),1fr))', gap: '.75rem' }}>

                    {/* IPTables ban */}
                    <ActionCard
                        header={<><Ban style={{ width: 14, height: 14, color: '#e86a65' }} /><span style={{ fontWeight: 600, fontSize: '.88rem' }}>Bannir via IPTables</span></>}
                        action={
                            <>
                                {iptBanResult && (
                                    <div style={{ fontSize: '.75rem', marginBottom: '.45rem', color: iptBanResult.ok ? '#3fb950' : '#e86a65', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                        {iptBanResult.ok ? <CheckCircle style={{ width: 11, height: 11 }} /> : <AlertTriangle style={{ width: 11, height: 11 }} />}
                                        {iptBanResult.msg}
                                    </div>
                                )}
                                <ActionBtn color="#e86a65" border="rgba(232,106,101,.25)" bg="rgba(232,106,101,.1)"
                                    disabled={iptBanLoading || !iptBanIp.trim() || !isValidIpOrCidr(iptBanIp)}
                                    onClick={doIptBan}>
                                    <Ban style={{ width: 13, height: 13 }} />{iptBanLoading ? 'Blocage…' : 'Bloquer (DROP)'}
                                </ActionBtn>
                            </>
                        }>
                        <p style={{ fontSize: '.78rem', color: '#8b949e', margin: 0 }}>Insère <code style={{ fontFamily: 'monospace', color: '#e6edf3' }}>-s IP -j DROP</code> en tête de chaîne. Rollback 30s.</p>
                        <StyledSelect value={iptBanChain} onChange={e => setIptBanChain(e.target.value)}>
                            {IPT_CHAINS.map(c => <option key={c} value={c} style={{ background: '#21262d', color: '#e6edf3' }}>{c}</option>)}
                        </StyledSelect>
                        <StyledInput value={iptBanIp} onChange={e => setIptBanIp(e.target.value)} placeholder="ex: 1.2.3.4 ou 1.2.0.0/24"
                            onKeyDown={e => { if (e.key === 'Enter') doIptBan(); }}
                            hasError={iptBanIp.trim().length > 0 && !isValidIpOrCidr(iptBanIp)} />
                    </ActionCard>

                    {/* IPTables unban */}
                    <ActionCard
                        header={<><Unlock style={{ width: 14, height: 14, color: '#39c5cf' }} /><span style={{ fontWeight: 600, fontSize: '.88rem' }}>Débannir via IPTables</span></>}
                        action={
                            <>
                                {iptUnbanResult && (
                                    <div style={{ fontSize: '.75rem', marginBottom: '.45rem', color: iptUnbanResult.ok ? '#3fb950' : '#e86a65', display: 'flex', alignItems: 'center', gap: '.3rem' }}>
                                        {iptUnbanResult.ok ? <CheckCircle style={{ width: 11, height: 11 }} /> : <AlertTriangle style={{ width: 11, height: 11 }} />}
                                        {iptUnbanResult.msg}
                                    </div>
                                )}
                                <ActionBtn color="#39c5cf" border="rgba(57,197,207,.25)" bg="rgba(57,197,207,.1)"
                                    disabled={iptUnbanLoad || !iptUnbanIp.trim() || !isValidIpOrCidr(iptUnbanIp)}
                                    onClick={doIptUnban}>
                                    <Unlock style={{ width: 13, height: 13 }} />{iptUnbanLoad ? 'Déblocage…' : 'Retirer le blocage'}
                                </ActionBtn>
                            </>
                        }>
                        <p style={{ fontSize: '.78rem', color: '#8b949e', margin: 0 }}>Supprime la règle <code style={{ fontFamily: 'monospace', color: '#e6edf3' }}>-s IP -j DROP</code> de la chaîne.</p>
                        <StyledSelect value={iptUnbanChain} onChange={e => setIptUnbanChain(e.target.value)}>
                            {IPT_CHAINS.map(c => <option key={c} value={c} style={{ background: '#21262d', color: '#e6edf3' }}>{c}</option>)}
                        </StyledSelect>
                        <StyledInput value={iptUnbanIp} onChange={e => setIptUnbanIp(e.target.value)} placeholder="ex: 1.2.3.4 ou 1.2.0.0/24"
                            onKeyDown={e => { if (e.key === 'Enter') doIptUnban(); }}
                            hasError={iptUnbanIp.trim().length > 0 && !isValidIpOrCidr(iptUnbanIp)} />
                    </ActionCard>

                </div>
                )}
            </div>

        </div>
    );
};
