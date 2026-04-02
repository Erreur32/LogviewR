/**
 * TabIPSet — gestionnaire IPSet structuré.
 * Design inspiré de /home/www-adm1n/666/Fail2ban-web/tabs/ipset.php
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Database, AlertTriangle, Trash2, Plus, Search, CheckCircle } from 'lucide-react';
import { api } from '../../api/client';
import { card, cardH, cardB, F2bTooltip } from './helpers';

const _cache: Record<string, { data: unknown; ts: number }> = {};
const CACHE_TTL = 60_000;
function getCached<T>(key: string): T | null {
    const e = _cache[key];
    return (e && Date.now() - e.ts < CACHE_TTL) ? e.data as T : null;
}
function setCached(key: string, data: unknown) { _cache[key] = { data, ts: Date.now() }; }

// ── Types ──────────────────────────────────────────────────────────────────────

interface IpsetInfo { name: string; type: string; size: number; maxelem: number; entries: number }

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtSize(bytes: number): string {
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    if (bytes >= 1024)    return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
}

function TypeBadge({ type }: { type: string }) {
    return <span style={{ background: 'rgba(188,140,255,.1)', border: '1px solid rgba(188,140,255,.3)', color: '#bc8cff', borderRadius: 3, padding: '.08rem .38rem', fontSize: '.7rem', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{type}</span>;
}

// ── Set List (left panel) ──────────────────────────────────────────────────────

function SetList({ sets, selected, onSelect, loading }: {
    sets: IpsetInfo[];
    selected: string | null;
    onSelect: (name: string) => void;
    loading: boolean;
}) {
    return (
        <div style={card}>
            <div style={{ ...cardH, justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600, fontSize: '.88rem' }}>
                    <Database style={{ width: 14, height: 14, color: '#bc8cff' }} />
                    Sets IPSet
                    <span style={{ fontSize: '.72rem', color: '#8b949e', fontWeight: 400 }}>({sets.length})</span>
                </span>
                {sets.length > 0 && (
                    <span style={{ fontSize: '.72rem', color: '#555d69' }}>
                        Total: <span style={{ color: '#bc8cff', fontWeight: 600 }}>{sets.reduce((s, x) => s + x.entries, 0).toLocaleString()}</span> IPs
                    </span>
                )}
            </div>
            <div style={cardB}>
                {loading && <div style={{ color: '#8b949e', fontSize: '.82rem' }}>Chargement…</div>}
                {!loading && sets.length === 0 && (
                    <div style={{ color: '#555d69', fontSize: '.8rem' }}>Aucun set IPSet détecté</div>
                )}
                {sets.map(s => {
                    const pct  = s.maxelem > 0 ? Math.min(100, Math.round(s.entries / s.maxelem * 100)) : 0;
                    const isSelected = s.name === selected;
                    const barColor = pct > 90 ? '#e86a65' : pct > 70 ? '#e3b341' : '#bc8cff';
                    return (
                        <div key={s.name}
                            onClick={() => onSelect(s.name)}
                            style={{ cursor: 'pointer', borderRadius: 5, padding: '.55rem .75rem', marginBottom: '.35rem', background: isSelected ? 'rgba(188,140,255,.08)' : 'transparent', border: `1px solid ${isSelected ? 'rgba(188,140,255,.35)' : 'transparent'}`, transition: 'background .1s' }}
                            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.03)'; }}
                            onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.3rem', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 600, fontSize: '.82rem', color: isSelected ? '#bc8cff' : '#e6edf3', fontFamily: 'monospace' }}>{s.name}</span>
                                <TypeBadge type={s.type} />
                                <span style={{ marginLeft: 'auto', fontSize: '.72rem', color: '#8b949e', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                    {s.entries.toLocaleString()} / {s.maxelem.toLocaleString()}
                                </span>
                            </div>
                            {/* Progress bar */}
                            <div style={{ background: '#2d333b', borderRadius: 3, height: 4, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width .3s' }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.25rem', fontSize: '.67rem', color: '#555d69' }}>
                                <span>{fmtSize(s.size)}</span>
                                <span>{pct}% utilisé</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const PAGE_SIZE = 30;

// ── Entries Panel (right panel) ────────────────────────────────────────────────

function EntriesPanel({ setName, onEntryDeleted, onIpClick }: { setName: string; onEntryDeleted: () => void; onIpClick?: (ip: string) => void }) {
    const [entries, setEntries]   = useState<string[]>([]);
    const [loading, setLoading]   = useState(false);
    const [query, setQuery]       = useState('');
    const [page, setPage]         = useState(0);
    const [newEntry, setNewEntry] = useState('');
    const [adding, setAdding]     = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);
    const [msg, setMsg]           = useState<{ ok: boolean; text: string } | null>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState<{ added: number; skipped: number } | null>(null);

    const fetchEntries = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get<{ ok: boolean; entries: string[]; error?: string }>(
                `/api/plugins/fail2ban/ipset/entries/${encodeURIComponent(setName)}`
            );
            if (res.success && res.result?.ok) setEntries(res.result.entries ?? []);
        } finally { setLoading(false); }
    }, [setName]);

    useEffect(() => { setQuery(''); setPage(0); setMsg(null); fetchEntries(); }, [fetchEntries]);

    // Reset page when query changes
    useEffect(() => { setPage(0); }, [query]);

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !setName) return;

        setImporting(true);
        setImportResult(null);
        try {
            const text = await file.text();
            const ipv4Re = /^(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)\.(25[0-5]|2[0-4]\d|[01]?\d\d?)$/;
            const ips = text.split('\n').map(l => l.trim()).filter(l => ipv4Re.test(l));

            const res = await api.post<{ ok: boolean; added: number; skipped: number; errors: string[] }>(
                '/api/plugins/fail2ban/ipset/import',
                { set: setName, ips }
            );
            if (res.result?.ok) {
                setImportResult({ added: res.result.added, skipped: res.result.skipped });
                fetchEntries();
                onEntryDeleted();
            }
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const addEntry = async () => {
        const e = newEntry.trim();
        if (!e) return;
        setAdding(true); setMsg(null);
        try {
            const res = await api.post<{ ok: boolean; output?: string; error?: string }>(
                '/api/plugins/fail2ban/ipset/add', { set: setName, entry: e }
            );
            if (res.success && res.result?.ok) {
                setMsg({ ok: true, text: `${e} ajouté` });
                setNewEntry('');
                fetchEntries();
                onEntryDeleted();
            } else {
                setMsg({ ok: false, text: res.result?.error ?? 'Erreur' });
            }
        } finally { setAdding(false); }
    };

    const deleteEntry = async (entry: string) => {
        if (!confirm(`Retirer "${entry}" de ${setName} ?`)) return;
        setDeleting(entry); setMsg(null);
        try {
            const res = await api.post<{ ok: boolean; error?: string }>(
                '/api/plugins/fail2ban/ipset/del', { set: setName, entry }
            );
            if (res.success && res.result?.ok) {
                setMsg({ ok: true, text: `${entry} retiré` });
                fetchEntries();
                onEntryDeleted();
            } else {
                setMsg({ ok: false, text: res.result?.error ?? 'Erreur' });
            }
        } finally { setDeleting(null); }
    };

    const filtered   = query ? entries.filter(e => e.includes(query)) : entries;
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    const paginated  = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    const inputStyle: React.CSSProperties = {
        background: '#0d1117', border: '1px solid #30363d', borderRadius: 4,
        color: '#e6edf3', fontSize: '.8rem', padding: '.35rem .6rem', outline: 'none', fontFamily: 'monospace',
    };

    return (
        <div style={card}>
            {/* ── Header ── */}
            <div style={{ ...cardH, justifyContent: 'space-between', flexWrap: 'wrap', gap: '.4rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600, fontSize: '.88rem' }}>
                    <Database style={{ width: 14, height: 14, color: '#bc8cff' }} />
                    Entrées — <span style={{ fontFamily: 'monospace', color: '#bc8cff' }}>{setName}</span>
                    <span style={{ fontSize: '.72rem', color: '#8b949e', fontWeight: 400 }}>
                        ({filtered.length !== entries.length ? `${filtered.length} / ` : ''}{entries.length})
                    </span>
                </span>
            </div>

            {/* ── Search bar — always visible at top ── */}
            <div style={{ padding: '.55rem 1rem', borderBottom: '1px solid #30363d', background: 'rgba(0,0,0,.15)' }}>
                <div style={{ position: 'relative' }}>
                    <Search style={{ position: 'absolute', left: '.6rem', top: '50%', transform: 'translateY(-50%)', width: 13, height: 13, color: '#555d69', pointerEvents: 'none' }} />
                    <input
                        ref={searchRef}
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder={`Rechercher parmi ${entries.length.toLocaleString()} entrées…`}
                        style={{ ...inputStyle, paddingLeft: '2rem', width: '100%', boxSizing: 'border-box', fontSize: '.82rem' }}
                    />
                    {query && (
                        <button onClick={() => setQuery('')}
                            style={{ position: 'absolute', right: '.5rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#555d69', cursor: 'pointer', padding: 0, fontSize: '1rem', lineHeight: 1 }}>
                            ×
                        </button>
                    )}
                </div>
            </div>

            <div style={{ ...cardB, display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                {/* Add entry form */}
                <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input value={newEntry} onChange={e => setNewEntry(e.target.value)}
                        placeholder="Ajouter IP ou CIDR (ex: 1.2.3.4)"
                        style={{ ...inputStyle, flex: 1 }}
                        onKeyDown={e => { if (e.key === 'Enter') addEntry(); }} />
                    <button onClick={addEntry} disabled={adding || !newEntry.trim()} style={{
                        background: 'rgba(188,140,255,.12)', border: '1px solid rgba(188,140,255,.3)', color: '#bc8cff',
                        borderRadius: 4, cursor: adding || !newEntry.trim() ? 'default' : 'pointer',
                        padding: '.35rem .75rem', fontSize: '.8rem', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: '.3rem', opacity: adding || !newEntry.trim() ? .5 : 1,
                    }}>
                        <Plus style={{ width: 12, height: 12 }} /> Ajouter
                    </button>

                    {/* Hidden file input for import */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".txt"
                        style={{ display: 'none' }}
                        onChange={handleImport}
                    />

                    {/* Import button */}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importing}
                        style={{
                            background: 'rgba(88,166,255,.1)', border: '1px solid rgba(88,166,255,.3)',
                            color: importing ? '#555d69' : '#58a6ff',
                            borderRadius: 4, padding: '.3rem .75rem',
                            fontSize: '.8rem', cursor: importing ? 'default' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: '.35rem',
                        }}
                    >
                        {importing ? '⟳ Import…' : '↑ Importer .txt'}
                    </button>

                    {importResult && (
                        <span style={{ fontSize: '.78rem', color: '#3fb950', marginLeft: '.5rem' }}>
                            ✓ {importResult.added} ajoutées
                            {importResult.skipped > 0 && `, ${importResult.skipped} ignorées`}
                        </span>
                    )}
                </div>

                {msg && (
                    <div style={{ fontSize: '.78rem', color: msg.ok ? '#3fb950' : '#e86a65', display: 'flex', gap: '.4rem', alignItems: 'center' }}>
                        {msg.ok ? <CheckCircle style={{ width: 12, height: 12 }} /> : <AlertTriangle style={{ width: 12, height: 12 }} />}
                        {msg.text}
                    </div>
                )}

                {/* Pagination — top */}
                {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.35rem', flexWrap: 'wrap' }}>
                        <button onClick={() => setPage(0)} disabled={page === 0}
                            style={{ background: 'none', border: '1px solid #30363d', color: page === 0 ? '#555d69' : '#8b949e', borderRadius: 4, cursor: page === 0 ? 'default' : 'pointer', padding: '.18rem .45rem', fontSize: '.72rem' }}>«</button>
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                            style={{ background: 'none', border: '1px solid #30363d', color: page === 0 ? '#555d69' : '#8b949e', borderRadius: 4, cursor: page === 0 ? 'default' : 'pointer', padding: '.18rem .45rem', fontSize: '.72rem' }}>‹</button>
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            const start = Math.max(0, Math.min(page - 2, totalPages - 5));
                            const p = start + i;
                            return (
                                <button key={p} onClick={() => setPage(p)}
                                    style={{ background: p === page ? 'rgba(188,140,255,.15)' : 'none', border: `1px solid ${p === page ? 'rgba(188,140,255,.4)' : '#30363d'}`, color: p === page ? '#bc8cff' : '#8b949e', borderRadius: 4, cursor: 'pointer', padding: '.18rem .5rem', fontSize: '.72rem', fontWeight: p === page ? 700 : 400, minWidth: 30 }}>
                                    {p + 1}
                                </button>
                            );
                        })}
                        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                            style={{ background: 'none', border: '1px solid #30363d', color: page === totalPages - 1 ? '#555d69' : '#8b949e', borderRadius: 4, cursor: page === totalPages - 1 ? 'default' : 'pointer', padding: '.18rem .45rem', fontSize: '.72rem' }}>›</button>
                        <button onClick={() => setPage(totalPages - 1)} disabled={page === totalPages - 1}
                            style={{ background: 'none', border: '1px solid #30363d', color: page === totalPages - 1 ? '#555d69' : '#8b949e', borderRadius: 4, cursor: page === totalPages - 1 ? 'default' : 'pointer', padding: '.18rem .45rem', fontSize: '.72rem' }}>»</button>
                        <span style={{ fontSize: '.7rem', color: '#555d69', marginLeft: '.25rem' }}>
                            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} / {filtered.length.toLocaleString()}
                        </span>
                    </div>
                )}

                {/* Entries table */}
                {loading && <div style={{ color: '#8b949e', fontSize: '.82rem' }}>Chargement…</div>}
                {!loading && filtered.length === 0 && (
                    <div style={{ color: '#555d69', fontSize: '.8rem' }}>{query ? 'Aucun résultat pour cette recherche' : 'Aucune entrée'}</div>
                )}
                {!loading && filtered.length > 0 && (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.78rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid #30363d', color: '#8b949e', fontSize: '.67rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                <th style={{ textAlign: 'left', padding: '.3rem .5rem .3rem 0' }}>Entrée (IP / CIDR)</th>
                                <th style={{ width: 36 }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginated.map(entry => (
                                <tr key={entry}
                                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.025)'}
                                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                                    style={{ borderBottom: '1px solid rgba(48,54,61,.4)' }}>
                                    <td style={{ padding: '.38rem .5rem .38rem 0', fontFamily: 'monospace', fontSize: '.8rem' }}>
                                        {onIpClick
                                            ? <span onClick={() => onIpClick(entry.replace(/\/\d+$/, ''))} style={{ color: '#58a6ff', cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 2 }}>{entry}</span>
                                            : <span style={{ color: '#e6edf3' }}>{entry}</span>
                                        }
                                    </td>
                                    <td style={{ textAlign: 'right', padding: '.3rem 0 .3rem .3rem' }}>
                                        <F2bTooltip title="Retirer" body={`Supprimer ${entry} de ${setName}`} color="red">
                                            <button onClick={() => deleteEntry(entry)} disabled={deleting === entry}
                                                style={{ background: 'rgba(232,106,101,.08)', border: '1px solid rgba(232,106,101,.2)', color: '#e86a65', borderRadius: 3, cursor: deleting === entry ? 'default' : 'pointer', padding: '.18rem .3rem', display: 'inline-flex', alignItems: 'center', opacity: deleting === entry ? .5 : 1 }}>
                                                <Trash2 style={{ width: 11, height: 11 }} />
                                            </button>
                                        </F2bTooltip>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.35rem', paddingTop: '.25rem', flexWrap: 'wrap' }}>
                        <button onClick={() => setPage(0)} disabled={page === 0}
                            style={{ background: 'none', border: '1px solid #30363d', color: page === 0 ? '#555d69' : '#8b949e', borderRadius: 4, cursor: page === 0 ? 'default' : 'pointer', padding: '.18rem .45rem', fontSize: '.72rem' }}>
                            «
                        </button>
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                            style={{ background: 'none', border: '1px solid #30363d', color: page === 0 ? '#555d69' : '#8b949e', borderRadius: 4, cursor: page === 0 ? 'default' : 'pointer', padding: '.18rem .45rem', fontSize: '.72rem' }}>
                            ‹
                        </button>

                        {/* Page buttons — show window of 5 around current */}
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                            const start = Math.max(0, Math.min(page - 2, totalPages - 5));
                            const p = start + i;
                            return (
                                <button key={p} onClick={() => setPage(p)}
                                    style={{ background: p === page ? 'rgba(188,140,255,.15)' : 'none', border: `1px solid ${p === page ? 'rgba(188,140,255,.4)' : '#30363d'}`, color: p === page ? '#bc8cff' : '#8b949e', borderRadius: 4, cursor: 'pointer', padding: '.18rem .5rem', fontSize: '.72rem', fontWeight: p === page ? 700 : 400, minWidth: 30 }}>
                                    {p + 1}
                                </button>
                            );
                        })}

                        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
                            style={{ background: 'none', border: '1px solid #30363d', color: page === totalPages - 1 ? '#555d69' : '#8b949e', borderRadius: 4, cursor: page === totalPages - 1 ? 'default' : 'pointer', padding: '.18rem .45rem', fontSize: '.72rem' }}>
                            ›
                        </button>
                        <button onClick={() => setPage(totalPages - 1)} disabled={page === totalPages - 1}
                            style={{ background: 'none', border: '1px solid #30363d', color: page === totalPages - 1 ? '#555d69' : '#8b949e', borderRadius: 4, cursor: page === totalPages - 1 ? 'default' : 'pointer', padding: '.18rem .45rem', fontSize: '.72rem' }}>
                            »
                        </button>

                        <span style={{ fontSize: '.7rem', color: '#555d69', marginLeft: '.25rem' }}>
                            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} / {filtered.length.toLocaleString()}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Not installed banner ───────────────────────────────────────────────────────

function NotInstalledBanner() {
    return (
        <div style={{ background: 'rgba(227,179,65,.07)', border: '1px solid rgba(227,179,65,.25)', borderRadius: 6, padding: '.85rem 1.1rem' }}>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', color: '#e3b341', fontWeight: 600, fontSize: '.85rem', marginBottom: '.4rem' }}>
                <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0 }} /> IPSet non disponible
            </div>
            <div style={{ fontSize: '.78rem', color: '#8b949e', lineHeight: 1.6 }}>
                La commande <code style={{ color: '#c9d1d9', fontFamily: 'monospace' }}>ipset</code> n&apos;est pas accessible.<br />
                Vérifiez que <code style={{ color: '#c9d1d9', fontFamily: 'monospace' }}>NET_ADMIN</code> est activé dans docker-compose.yml et qu&apos;ipset est installé dans le container.
            </div>
            <pre style={{ marginTop: '.65rem', background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: '.5rem .75rem', fontSize: '.75rem', fontFamily: 'monospace', color: '#8b949e', whiteSpace: 'pre-wrap' }}>{`cap_add:\n  - NET_ADMIN\n# Dockerfile:\nRUN apk add --no-cache ipset`}</pre>
        </div>
    );
}

// ── Main component ─────────────────────────────────────────────────────────────

export const TabIPSet: React.FC<{ onIpClick?: (ip: string) => void }> = ({ onIpClick }) => {
    const [sets, setSets]           = useState<IpsetInfo[]>([]);
    const [selected, setSelected]   = useState<string | null>(null);
    const [loading, setLoading]     = useState(false);
    const [installed, setInstalled] = useState<boolean | null>(null);

    const fetchSets = useCallback(async () => {
        const cached = getCached<IpsetInfo[]>('ipset:sets');
        if (cached) {
            setSets(cached);
            setInstalled(true);
            if (!selected && cached.length > 0) setSelected(cached[0].name);
            setLoading(false);
        }
        try {
            const res = await api.get<{ ok: boolean; sets: IpsetInfo[]; error?: string }>('/api/plugins/fail2ban/ipset/info');
            if (res.success) {
                if (res.result?.ok) {
                    setCached('ipset:sets', res.result.sets ?? []);
                    setSets(res.result.sets ?? []);
                    setInstalled(true);
                    // Auto-select first set
                    if (!selected && (res.result.sets?.length ?? 0) > 0) {
                        setSelected(res.result.sets![0].name);
                    }
                } else {
                    setInstalled(false);
                }
            }
        } finally { setLoading(false); }
    }, [selected]);

    useEffect(() => { fetchSets(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    if (installed === false) {
        return <NotInstalledBanner />;
    }

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) minmax(0, 2fr)', gap: '1rem', alignItems: 'start' }}>
            <SetList
                sets={sets}
                selected={selected}
                onSelect={setSelected}
                loading={loading}
            />
            {selected
                ? <EntriesPanel key={selected} setName={selected} onEntryDeleted={fetchSets} onIpClick={onIpClick} />
                : (
                    <div style={{ ...card }}>
                        <div style={cardB}>
                            <div style={{ color: '#555d69', fontSize: '.82rem' }}>
                                Sélectionnez un set pour voir ses entrées.
                            </div>
                        </div>
                    </div>
                )}
        </div>
    );
};
