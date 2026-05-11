/**
 * NewJailModal — create a new fail2ban jail in jail.d/<name>.local + reload.
 * Backend: POST /api/plugins/fail2ban/jails
 */
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import {
    F2bModalShell, F2bModalHeader, F2bCancelButton, F2bSaveButton,
    ResultBanner, NameInvalidHint,
    inputStyle, labelStyle, hintStyle,
} from './modalParts';

interface NewJailModalProps {
    onClose: () => void;
    onCreated: (jailName: string) => void;
    /** When set, the filter dropdown is pre-selected and the jail name is suggested to match. User can still edit. */
    prefilledFilter?: string;
}

interface CreateResult {
    ok: boolean;
    jailName?: string;
    file?: string;
    error?: string;
    reloadResult?: { ok: boolean; output?: string; error?: string } | null;
}

function loadFilterBases(setFilters: (bases: string[]) => void, setLoading: (b: boolean) => void): void {
    api.get<{ ok: boolean; files: string[] }>('/api/plugins/fail2ban/filters')
        .then(res => {
            if (res.success && res.result?.ok) {
                // Strip extension and dedup (sshd.conf + sshd.local → sshd)
                const bases = Array.from(new Set(res.result.files.map(f => f.replace(/\.(conf|local)$/, ''))))
                    .sort((a, b) => a.localeCompare(b));
                setFilters(bases);
            }
            setLoading(false);
        });
}

function isFiniteIntAtLeast(v: string, min: number): boolean {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= min;
}

function isJailNameValid(name: string): boolean {
    return /^[a-z0-9_-]{1,32}$/.test(name) && name !== 'default' && name !== 'includes';
}

interface JailFormDraft {
    name: string;
    filter: string;
    logpath: string;
    maxretry: string;
    findtime: string;
    bantime: string;
}

function isJailFormValid(d: JailFormDraft): boolean {
    const fieldsOk  = d.filter !== '' && d.logpath.trim() !== '';
    const numbersOk = isFiniteIntAtLeast(d.maxretry, 1) && isFiniteIntAtLeast(d.findtime, 1) && isFiniteIntAtLeast(d.bantime, -1);
    return isJailNameValid(d.name) && fieldsOk && numbersOk;
}

export const NewJailModal: React.FC<NewJailModalProps> = ({ onClose, onCreated, prefilledFilter }) => {
    const { t } = useTranslation();
    const [filters, setFilters]   = useState<string[]>([]);
    const [filtersLoading, setFiltersLoading] = useState(true);

    const initialFilter = (prefilledFilter ?? '').replace(/\.(conf|local)$/, '');
    // Suggest a jail name based on the filter (sanitized to fit the same regex enforced server-side)
    const suggestedName = initialFilter.toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 32);
    const [name, setName]         = useState(suggestedName);
    const [filter, setFilter]     = useState(initialFilter);
    const [logpath, setLogpath]   = useState('');
    const [port, setPort]         = useState('');
    const [maxretry, setMaxretry] = useState('5');
    const [findtime, setFindtime] = useState('600');
    const [bantime, setBantime]   = useState('3600');
    const [action, setAction]     = useState('');
    const [enabled, setEnabled]   = useState(true);

    const [saving, setSaving]     = useState(false);
    const [result, setResult]     = useState<CreateResult | null>(null);

    useEffect(() => {
        loadFilterBases(setFilters, setFiltersLoading);
    }, []);

    const nameValid = isJailNameValid(name);
    const formValid = isJailFormValid({ name, filter, logpath, maxretry, findtime, bantime });

    const submit = async () => {
        if (!formValid) return;
        setSaving(true); setResult(null);
        const res = await api.post<CreateResult>('/api/plugins/fail2ban/jails', {
            name, filter, logpath: logpath.trim(),
            port: port.trim() || undefined,
            maxretry: Number.parseInt(maxretry, 10),
            findtime: Number.parseInt(findtime, 10),
            bantime:  Number.parseInt(bantime, 10),
            action: action.trim() || undefined,
            enabled,
        });
        setSaving(false);
        if (res.success && res.result?.ok) {
            setResult(res.result);
            // Slight delay so user sees the success message before parent refreshes
            setTimeout(() => onCreated(res.result?.jailName ?? name), 800);
        } else {
            setResult({ ok: false, error: res.result?.error ?? res.error?.message ?? t('fail2ban.newJail.errorUnknown') });
        }
    };

    const submitEnabled = formValid && !saving && result?.ok !== true;

    const reloadStatus = result?.reloadResult?.ok ? t('fail2ban.newJail.reloadOk') : t('fail2ban.newJail.reloadSkipped');
    const successText  = result?.ok ? `${t('fail2ban.newJail.created', { name: result.jailName })} · ${reloadStatus}` : '';

    return (
        <F2bModalShell onClose={onClose} width="min(560px, 96vw)">
            <F2bModalHeader title={t('fail2ban.newJail.title')} onClose={onClose} />

            {result && <ResultBanner ok={result.ok} successText={successText} errorText={result.error} />}

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>

                {/* Name */}
                <div style={{ marginBottom: '.85rem' }}>
                    <label style={labelStyle}>{t('fail2ban.newJail.name')}</label>
                    <input value={name} onChange={e => setName(e.target.value.toLowerCase())} placeholder="my-jail"
                        style={{ ...inputStyle, borderColor: name && !nameValid ? '#e86a65' : '#30363d' }} autoFocus />
                    <div style={hintStyle}>{t('fail2ban.newJail.nameHint')}</div>
                </div>

                {/* Filter dropdown */}
                <div style={{ marginBottom: '.85rem' }}>
                    <label style={labelStyle}>{t('fail2ban.newJail.filter')}</label>
                    <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inputStyle, padding: '.32rem .5rem' }} disabled={filtersLoading}>
                        <option value="">{filtersLoading ? t('fail2ban.status.loading') : t('fail2ban.newJail.filterPick')}</option>
                        {filters.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <div style={hintStyle}>{t('fail2ban.newJail.filterHint')}</div>
                </div>

                {/* Logpath */}
                <div style={{ marginBottom: '.85rem' }}>
                    <label style={labelStyle}>{t('fail2ban.newJail.logpath')}</label>
                    <input value={logpath} onChange={e => setLogpath(e.target.value)} placeholder="/var/log/auth.log"
                        style={inputStyle} />
                    <div style={hintStyle}>{t('fail2ban.newJail.logpathHint')}</div>
                </div>

                {/* Port (optional) */}
                <div style={{ marginBottom: '.85rem' }}>
                    <label style={labelStyle}>{t('fail2ban.newJail.port')} <span style={{ fontWeight: 400, textTransform: 'none', color: '#6e7681' }}>· {t('fail2ban.newJail.optional')}</span></label>
                    <input value={port} onChange={e => setPort(e.target.value)} placeholder="ssh, 22, or http,https"
                        style={inputStyle} />
                </div>

                {/* Timings */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.6rem', marginBottom: '.85rem' }}>
                    <div>
                        <label style={labelStyle}>{t('fail2ban.newJail.maxretry')}</label>
                        <input type="number" min={1} value={maxretry} onChange={e => setMaxretry(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>{t('fail2ban.newJail.findtime')}</label>
                        <input type="number" min={1} value={findtime} onChange={e => setFindtime(e.target.value)} style={inputStyle} />
                    </div>
                    <div>
                        <label style={labelStyle}>{t('fail2ban.newJail.bantime')}</label>
                        <input type="number" min={-1} value={bantime} onChange={e => setBantime(e.target.value)} style={inputStyle} />
                    </div>
                </div>
                <div style={{ ...hintStyle, marginTop: '-.55rem', marginBottom: '.85rem' }}>{t('fail2ban.newJail.timingsHint')}</div>

                {/* Action (optional) */}
                <div style={{ marginBottom: '.85rem' }}>
                    <label style={labelStyle}>{t('fail2ban.newJail.action')} <span style={{ fontWeight: 400, textTransform: 'none', color: '#6e7681' }}>· {t('fail2ban.newJail.optional')}</span></label>
                    <input value={action} onChange={e => setAction(e.target.value)} placeholder="iptables-multiport[name=my-jail, port=&quot;ssh&quot;]"
                        style={inputStyle} />
                    <div style={hintStyle}>{t('fail2ban.newJail.actionHint')}</div>
                </div>

                {/* Enabled */}
                <label style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer', padding: '.4rem 0' }}>
                    <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
                        style={{ width: 14, height: 14, accentColor: '#3fb950', cursor: 'pointer' }} />
                    <span style={{ fontSize: '.85rem', color: '#e6edf3' }}>{t('fail2ban.newJail.enabled')}</span>
                    <span style={{ fontSize: '.7rem', color: '#6e7681' }}>· {t('fail2ban.newJail.enabledHint')}</span>
                </label>

                {!nameValid && name && <NameInvalidHint text={t('fail2ban.newJail.nameInvalid')} />}
            </div>

            <div style={{ padding: '.65rem 1rem', borderTop: '1px solid #30363d', display: 'flex', gap: '.5rem', justifyContent: 'flex-end', alignItems: 'center', background: '#0d1117' }}>
                <F2bCancelButton onClick={onClose} disabled={saving} label={t('common.cancel')} />
                <F2bSaveButton onClick={submit} enabled={submitEnabled}
                    label={saving ? t('fail2ban.newJail.saving') : t('fail2ban.newJail.create')} />
            </div>
        </F2bModalShell>
    );
};
