import React, { useState, useEffect, useMemo } from 'react';
import { Download, FileText, Pencil, X, Save, CheckCircle, AlertTriangle, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { card, cardH } from './helpers';
import { getCached, setCached } from './cacheUtils';
import type { JailStatus } from './types';

interface TabActionsProps {
    jails: JailStatus[];
}

interface ActionRow {
    name: string;
    usedByJails: string[];
}

interface ReloadResult {
    jail: string;
    ok: boolean;
    output: string;
    error?: string;
}

// ── Modal ──────────────────────────────────────────────────────────────────────

interface ActionModalProps {
    name: string;
    jailsUsingIt: string[];
    onClose: () => void;
    onSaved: () => void;
}

const ActionModal: React.FC<ActionModalProps> = ({ name, jailsUsingIt, onClose, onSaved }) => {
    const { t } = useTranslation();
    const [content, setContent]     = useState('');
    const [edited, setEdited]       = useState('');
    const [loading, setLoading]     = useState(true);
    const [editing, setEditing]     = useState(false);
    const [saving, setSaving]       = useState(false);
    const [results, setResults]     = useState<ReloadResult[] | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        api.get<{ ok: boolean; content: string }>(`/api/plugins/fail2ban/actions/${encodeURIComponent(name)}`)
            .then(res => {
                if (res.success && res.result?.ok) {
                    setContent(res.result.content);
                    setEdited(res.result.content);
                }
                setLoading(false);
            });
    }, [name]);

    const handleSave = async () => {
        setSaving(true); setSaveError(null); setResults(null);
        const res = await api.post<{ ok: boolean; reloadResults?: ReloadResult[]; error?: string }>(
            `/api/plugins/fail2ban/actions/${encodeURIComponent(name)}/save`,
            { content: edited, jails: jailsUsingIt },
        );
        setSaving(false);
        if (res.success && res.result?.ok) {
            setContent(edited);
            setEditing(false);
            setResults(res.result.reloadResults ?? []);
            onSaved();
        } else {
            setSaveError(res.result?.error ?? res.error?.message ?? t('fail2ban.fbActions.errorUnknown'));
        }
    };

    const dirty = editing && edited !== content;

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(3px)' }}
             onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={{ ...card, width: 'min(820px, 95vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>

                {/* Header */}
                <div style={{ ...cardH, justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <Zap style={{ width: 14, height: 14, color: '#e3b341' }} />
                        <code style={{ fontSize: '.85rem', color: '#e6edf3' }}>action.d/{name}</code>
                        {jailsUsingIt.length > 0 && (
                            <span style={{ fontSize: '.7rem', color: '#8b949e' }}>
                                · {t('fail2ban.fbActions.usedByJails', { count: jailsUsingIt.length })}
                            </span>
                        )}
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '.2rem', display: 'flex' }}>
                        <X style={{ width: 16, height: 16 }} />
                    </button>
                </div>

                {/* Reload results */}
                {results !== null && (
                    <div style={{ padding: '.6rem 1rem', borderBottom: '1px solid #30363d', display: 'flex', flexWrap: 'wrap', gap: '.4rem', alignItems: 'center' }}>
                        <span style={{ fontSize: '.75rem', color: '#8b949e', marginRight: '.25rem' }}>{t('fail2ban.fbActions.reload')} :</span>
                        {results.length === 0
                            ? <span style={{ fontSize: '.75rem', color: '#8b949e' }}>{t('fail2ban.fbActions.noJailAffected')}</span>
                            : results.map(r => (
                                <span key={r.jail} title={r.error ?? r.output} style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.72rem', padding: '.15rem .5rem', borderRadius: 4, background: r.ok ? 'rgba(63,185,80,.12)' : 'rgba(232,106,101,.12)', color: r.ok ? '#3fb950' : '#e86a65', border: `1px solid ${r.ok ? 'rgba(63,185,80,.25)' : 'rgba(232,106,101,.25)'}` }}>
                                    {r.ok ? <CheckCircle style={{ width: 10, height: 10 }} /> : <AlertTriangle style={{ width: 10, height: 10 }} />}
                                    {r.jail}
                                </span>
                            ))
                        }
                    </div>
                )}

                {/* Error */}
                {saveError && (
                    <div style={{ padding: '.5rem 1rem', borderBottom: '1px solid #30363d', fontSize: '.78rem', color: '#e86a65', background: 'rgba(232,106,101,.07)', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                        <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0 }} />{saveError}
                    </div>
                )}

                {/* Content */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {loading
                        ? <div style={{ padding: '2rem', textAlign: 'center', color: '#8b949e', fontSize: '.85rem' }}>{t('fail2ban.fbActions.loading')}</div>
                        : editing
                            ? <textarea value={edited} onChange={e => setEdited(e.target.value)}
                                style={{ flex: 1, resize: 'none', padding: '1rem', background: '#161b22', color: '#e6edf3', border: 'none', borderBottom: '1px solid #555', fontFamily: 'monospace', fontSize: '.78rem', lineHeight: 1.6, outline: 'none', overflowY: 'auto', boxShadow: 'inset 0 2px 4px rgba(0,0,0,.55), inset 0 1px 0 rgba(0,0,0,.4)' }} />
                            : <pre style={{ flex: 1, overflowY: 'auto', padding: '1rem', fontSize: '.78rem', fontFamily: 'monospace', color: '#e6edf3', lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>{content}</pre>
                    }
                </div>

                {/* Footer */}
                {!loading && (
                    <div style={{ padding: '.65rem 1rem', borderTop: '1px solid #30363d', display: 'flex', gap: '.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                        {editing ? (
                            <>
                                <button onClick={() => { setEditing(false); setEdited(content); setSaveError(null); }}
                                    style={{ padding: '.3rem .75rem', fontSize: '.8rem', borderRadius: 5, background: 'transparent', border: '1px solid #30363d', color: '#8b949e', cursor: 'pointer' }}>
                                    {t('fail2ban.fbActions.cancel')}
                                </button>
                                <button onClick={handleSave} disabled={saving || !dirty}
                                    style={{ display: 'flex', alignItems: 'center', gap: '.35rem', padding: '.3rem .85rem', fontSize: '.8rem', borderRadius: 5, background: dirty ? '#e3b341' : '#30363d', border: 'none', color: dirty ? '#0d1117' : '#8b949e', cursor: dirty ? 'pointer' : 'default', fontWeight: 600, opacity: saving ? .7 : 1 }}>
                                    <Save style={{ width: 13, height: 13 }} />{saving ? t('fail2ban.fbActions.saving') : t('fail2ban.fbActions.save')}
                                    {!saving && dirty && jailsUsingIt.length > 0 && (
                                        <span style={{ fontSize: '.7rem', fontWeight: 400, opacity: .85 }}>+ {t('fail2ban.fbActions.reloadCount', { count: jailsUsingIt.length })}</span>
                                    )}
                                </button>
                            </>
                        ) : (
                            <button onClick={() => { setEditing(true); setResults(null); setSaveError(null); }}
                                style={{ display: 'flex', alignItems: 'center', gap: '.35rem', padding: '.3rem .85rem', fontSize: '.8rem', borderRadius: 5, background: 'rgba(227,179,65,.1)', border: '1px solid rgba(227,179,65,.25)', color: '#e3b341', cursor: 'pointer' }}>
                                <Pencil style={{ width: 13, height: 13 }} />{t('fail2ban.fbActions.edit')}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

// ── Main tab ───────────────────────────────────────────────────────────────────

export const TabActions: React.FC<TabActionsProps> = ({ jails }) => {
    const { t } = useTranslation();
    const [files, setFiles]     = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState<string | null>(null);
    const [showAll, setShowAll] = useState(false);
    const [search, setSearch]   = useState('');
    const [modal, setModal]     = useState<string | null>(null);

    useEffect(() => {
        const cached = getCached<string[]>('actions:list');
        if (cached) { setFiles(cached); setLoading(false); }
        api.get<{ ok: boolean; files: string[]; error?: string }>('/api/plugins/fail2ban/actions')
            .then(res => {
                if (res.success && res.result?.ok) {
                    setCached('actions:list', res.result.files);
                    setFiles(res.result.files);
                } else if (!cached) setError(res.result?.error ?? t('fail2ban.fbActions.errorReadAct'));

                setLoading(false);
            });
    }, []);

    // Build action→jails map from parent jails (via actions[] and banaction)
    const actionMap = useMemo(() => {
        const m: Record<string, Set<string>> = {};
        const add = (actionName: string, jail: string) => {
            const base = actionName.replace(/\.(conf|local)$/, '');
            if (!m[base]) m[base] = new Set();
            m[base].add(jail);
        };
        for (const j of jails) {
            if (j.banaction) add(j.banaction, j.jail);
            if (Array.isArray(j.actions)) {
                for (const a of j.actions) { if (a) add(a, j.jail); }
            }
        }
        return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]));
    }, [jails]);

    const rows: ActionRow[] = useMemo(() => {
        return files.map(name => {
            const base = name.replace(/\.(conf|local)$/, '');
            return { name, usedByJails: actionMap[base] ?? [] };
        });
    }, [files, actionMap]);

    const filtered = useMemo(() => {
        let r = showAll ? rows : rows.filter(r => r.usedByJails.length > 0);
        if (search.trim()) {
            const q = search.toLowerCase();
            r = r.filter(row => row.name.toLowerCase().includes(q) || row.usedByJails.some(j => j.toLowerCase().includes(q)));
        }
        return r;
    }, [rows, showAll, search]);

    const activeCount = rows.filter(r => r.usedByJails.length > 0).length;

    const downloadAction = async (name: string) => {
        const res = await api.get<{ ok: boolean; content: string }>(`/api/plugins/fail2ban/actions/${encodeURIComponent(name)}`);
        if (!res.success || !res.result?.ok) return;
        const blob = new Blob([res.result.content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = name;
        a.click(); URL.revokeObjectURL(url);
    };

    const modalRow = modal ? rows.find(r => r.name === modal) : null;

    if (loading) return <div style={{ padding: '2rem', color: '#8b949e', fontSize: '.85rem' }}>{t('fail2ban.fbActions.loading')}</div>;
    if (error)   return <div style={{ padding: '2rem', color: '#e86a65', fontSize: '.85rem' }}>{error}</div>;

    return (
        <>
            {modal && modalRow && (
                <ActionModal
                    name={modal}
                    jailsUsingIt={modalRow.usedByJails}
                    onClose={() => setModal(null)}
                    onSaved={() => {}}
                />
            )}

            {/* Toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.75rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: '.2rem', background: '#21262d', borderRadius: 6, padding: '.2rem', border: '1px solid #30363d' }}>
                    {[{ label: t('fail2ban.fbActions.active'), value: false }, { label: t('fail2ban.fbActions.all'), value: true }].map(({ label, value }) => (
                        <button key={label} onClick={() => setShowAll(value)}
                            style={{ padding: '.2rem .7rem', fontSize: '.78rem', borderRadius: 4, border: 'none', background: showAll === value ? 'rgba(227,179,65,.15)' : 'transparent', color: showAll === value ? '#e3b341' : '#8b949e', cursor: 'pointer', fontWeight: showAll === value ? 600 : 400 }}>
                            {label}
                        </button>
                    ))}
                </div>

                <span style={{ fontSize: '.78rem', color: '#8b949e' }}>
                    <strong style={{ color: '#e3b341' }}>{activeCount}</strong>/{rows.length}
                </span>

                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', background: '#21262d', border: '1px solid #30363d', borderRadius: 6, padding: '.3rem .65rem', width: 260 }}>
                        <span style={{ color: '#8b949e', fontSize: '.8rem' }}>⌕</span>
                        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('fail2ban.fbActions.searchPlaceholder')}
                            style={{ background: 'none', border: 'none', outline: 'none', color: '#e6edf3', fontSize: '.82rem', flex: 1, minWidth: 0 }} />
                        {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>}
                    </div>
                </div>
            </div>

            {/* Table */}
            <div style={card}>
                <div style={{ display: 'grid', gridTemplateColumns: '220px 56px minmax(0,1fr) auto', gap: 0, ...cardH, borderBottom: '1px solid #30363d', fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8b949e' }}>
                    <div>{t('fail2ban.fbActions.colAction')}</div>
                    <div style={{ textAlign: 'center' }}>{t('fail2ban.fbActions.colJails')}</div>
                    <div>{t('fail2ban.fbActions.colUsedBy')}</div>
                    <div />
                </div>

                {filtered.length === 0 && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#8b949e', fontSize: '.85rem' }}>
                        {t('fail2ban.fbActions.noMatch')}
                    </div>
                )}

                {filtered.map(row => (
                    <div key={row.name}
                        style={{ display: 'grid', gridTemplateColumns: '220px 56px minmax(0,1fr) auto', alignItems: 'start', borderBottom: '1px solid #30363d', padding: '.45rem 1rem', gap: 0 }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.02)'}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>

                        {/* Name */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', minWidth: 0, paddingTop: '.1rem' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', padding: '.12rem .45rem', borderRadius: 4, fontSize: '.72rem', fontWeight: 600, background: 'rgba(227,179,65,.1)', color: '#e3b341', border: '1px solid rgba(227,179,65,.2)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}
                                title={row.name}>
                                {row.name}
                            </span>
                        </div>

                        {/* Jail count */}
                        <div style={{ textAlign: 'center', fontSize: '.82rem', color: row.usedByJails.length > 0 ? '#e3b341' : '#8b949e', fontWeight: row.usedByJails.length > 0 ? 600 : 400 }}>
                            {row.usedByJails.length || '—'}
                        </div>

                        {/* Jail badges */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.25rem', alignItems: 'flex-start', minWidth: 0, paddingTop: '.1rem' }}>
                            {row.usedByJails.map(j => (
                                <span key={j} style={{ padding: '.1rem .4rem', borderRadius: 4, fontSize: '.68rem', background: 'rgba(63,185,80,.1)', color: '#3fb950', border: '1px solid rgba(63,185,80,.2)', whiteSpace: 'nowrap' }}>{j}</span>
                            ))}
                            {row.usedByJails.length === 0 && (
                                <span style={{ fontSize: '.78rem', color: '#8b949e' }}>—</span>
                            )}
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem', flexShrink: 0, paddingLeft: '.5rem', paddingTop: '.1rem' }}>
                            <button onClick={() => setModal(row.name)}
                                style={{ display: 'flex', alignItems: 'center', gap: '.3rem', padding: '.28rem .65rem', fontSize: '.75rem', borderRadius: 5, background: 'rgba(227,179,65,.08)', border: '1px solid rgba(227,179,65,.2)', color: '#e3b341', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                <FileText style={{ width: 11, height: 11 }} />{t('fail2ban.fbActions.viewEdit')}
                            </button>
                            <button onClick={() => downloadAction(row.name)} title={t('fail2ban.fbActions.download')}
                                style={{ display: 'flex', alignItems: 'center', padding: '.28rem .45rem', fontSize: '.75rem', borderRadius: 5, background: 'transparent', border: '1px solid #30363d', color: '#8b949e', cursor: 'pointer' }}>
                                <Download style={{ width: 12, height: 12 }} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </>
    );
};
