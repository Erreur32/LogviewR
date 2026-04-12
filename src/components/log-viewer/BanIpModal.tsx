/**
 * Ban IP Modal
 *
 * Modal for banning an IP via fail2ban jail.
 * Uses inline styles with fail2ban PHP palette.
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, AlertTriangle, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client.js';
import { useNotificationStore } from '../../stores/notificationStore.js';

interface JailStatus {
    jail: string;
    currentlyBanned: number;
    bannedIps: string[];
    active?: boolean;
}

interface StatusResponse {
    ok: boolean;
    jails?: JailStatus[];
}

interface BanIpModalProps {
    ip: string;
    onClose: () => void;
    onBanned: (jail: string, ip: string) => void;
}

// Fail2ban PHP palette
const card: React.CSSProperties = { background: '#161b22', border: '1px solid #30363d', borderRadius: 8, overflow: 'hidden', maxWidth: 440, width: '100%' };
const cardH: React.CSSProperties = { background: '#21262d', padding: '.65rem 1rem', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.5rem' };
const cardB: React.CSSProperties = { padding: '1rem' };

export const BanIpModal: React.FC<BanIpModalProps> = ({ ip, onClose, onBanned }) => {
    const { t } = useTranslation();
    const addAction = useNotificationStore(s => s.addAction);

    const [jails, setJails] = useState<JailStatus[]>([]);
    const [selectedJail, setSelectedJail] = useState('');
    const [loading, setLoading] = useState(true);
    const [banning, setBanning] = useState(false);
    const [error, setError] = useState('');

    // Jails where IP is already banned
    const alreadyBannedIn = jails
        .filter(j => j.bannedIps?.includes(ip))
        .map(j => j.jail);

    // Fetch jails on mount
    useEffect(() => {
        let cancelled = false;
        api.get<StatusResponse>('/api/plugins/fail2ban/status?days=1')
            .then(res => {
                if (cancelled) return;
                if (res.success && res.result?.ok && res.result.jails) {
                    const active = res.result.jails.filter(j => j.active !== false);
                    setJails(active);
                    // Pre-select first jail not already banning this IP
                    const firstAvailable = active.find(j => !j.bannedIps?.includes(ip));
                    if (firstAvailable) setSelectedJail(firstAvailable.jail);
                    else if (active.length > 0) setSelectedJail(active[0].jail);
                } else {
                    setError(t('logViewer.banModal.errorLoadJails'));
                }
            })
            .catch(() => {
                if (!cancelled) setError(t('logViewer.banModal.errorLoadJails'));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [ip, t]);

    const handleBan = async () => {
        if (!selectedJail) return;
        setBanning(true);
        setError('');
        try {
            const res = await api.post<{ ok: boolean; error?: string }>('/api/plugins/fail2ban/ban', { jail: selectedJail, ip });
            if (res.success && res.result?.ok) {
                addAction(t('logViewer.banModal.success', { ip, jail: selectedJail }), true);
                onBanned(selectedJail, ip);
                onClose();
            } else {
                setError(res.result?.error || t('logViewer.banModal.errorGeneric'));
            }
        } catch {
            setError(t('logViewer.banModal.errorGeneric'));
        } finally {
            setBanning(false);
        }
    };

    return createPortal(
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)' }}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div style={card} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={cardH}>
                    <ShieldAlert style={{ width: 16, height: 16, color: '#e86a65' }} />
                    <span style={{ fontWeight: 600, fontSize: '.9rem', color: '#e6edf3', flex: 1 }}>
                        {t('logViewer.banModal.title')}
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: '#8b949e', borderRadius: 4 }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body */}
                <div style={cardB}>
                    {/* IP */}
                    <div style={{ marginBottom: 16 }}>
                        <div style={{ fontSize: '.75rem', color: '#8b949e', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>IP</div>
                        <div style={{ fontFamily: 'monospace', fontSize: '.95rem', color: '#e6edf3', fontWeight: 600, background: '#0d1117', padding: '6px 10px', borderRadius: 4, border: '1px solid #30363d' }}>
                            {ip}
                        </div>
                    </div>

                    {/* Already banned warning */}
                    {alreadyBannedIn.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', marginBottom: 16, background: 'rgba(227,179,65,.08)', border: '1px solid rgba(227,179,65,.25)', borderRadius: 6, fontSize: '.8rem', color: '#e3b341' }}>
                            <AlertTriangle size={14} />
                            <span>{t('logViewer.banModal.alreadyBanned', { jails: alreadyBannedIn.join(', ') })}</span>
                        </div>
                    )}

                    {/* Jail selector */}
                    {loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#8b949e', fontSize: '.85rem', padding: '12px 0' }}>
                            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                            {t('common.loading')}
                        </div>
                    ) : jails.length > 0 ? (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: '.75rem', color: '#8b949e', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                                {t('logViewer.banModal.selectJail')}
                            </div>
                            <select
                                value={selectedJail}
                                onChange={e => setSelectedJail(e.target.value)}
                                style={{
                                    width: '100%', padding: '8px 10px', background: '#0d1117', color: '#e6edf3',
                                    border: '1px solid #30363d', borderRadius: 4, fontSize: '.85rem', outline: 'none',
                                }}
                            >
                                {jails.map(j => (
                                    <option key={j.jail} value={j.jail}>
                                        {j.jail}
                                        {j.bannedIps?.includes(ip) ? ` (${t('logViewer.banModal.alreadyTag')})` : ''}
                                        {` — ${j.currentlyBanned} ban${j.currentlyBanned !== 1 ? 's' : ''}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                    ) : null}

                    {/* Error */}
                    {error && (
                        <div style={{ padding: '8px 10px', marginBottom: 12, background: 'rgba(232,106,101,.08)', border: '1px solid rgba(232,106,101,.25)', borderRadius: 6, fontSize: '.8rem', color: '#e86a65' }}>
                            {error}
                        </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 4 }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{ padding: '6px 16px', border: '1px solid #30363d', borderRadius: 6, background: 'transparent', color: '#8b949e', fontSize: '.82rem', cursor: 'pointer' }}
                        >
                            {t('logViewer.banModal.cancel')}
                        </button>
                        <button
                            type="button"
                            onClick={handleBan}
                            disabled={banning || !selectedJail || loading}
                            style={{
                                padding: '6px 16px', border: '1px solid rgba(232,106,101,.4)', borderRadius: 6,
                                background: banning ? 'rgba(232,106,101,.15)' : 'rgba(232,106,101,.2)',
                                color: '#e86a65', fontSize: '.82rem', fontWeight: 600, cursor: banning || !selectedJail ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: 6, opacity: banning || !selectedJail ? .6 : 1,
                            }}
                        >
                            {banning ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ShieldAlert size={14} />}
                            {t('logViewer.banModal.ban')}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
};
