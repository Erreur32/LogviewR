/**
 * Shared building blocks for fail2ban creation modals (NewFilterModal, NewJailModal).
 */
import React, { useEffect, useRef } from 'react';
import { CheckCircle, XCircle, AlertTriangle, X, Save, Plus } from 'lucide-react';

export const inputStyle: React.CSSProperties = {
    padding: '.35rem .6rem', fontSize: '.82rem', borderRadius: 5,
    background: '#0d1117', border: '1px solid #30363d',
    color: '#e6edf3', outline: 'none', fontFamily: 'monospace',
    width: '100%',
};

export const labelStyle: React.CSSProperties = {
    fontSize: '.72rem', fontWeight: 700, color: '#8b949e',
    textTransform: 'uppercase', letterSpacing: '.05em',
    display: 'block', marginBottom: '.3rem',
};

export const hintStyle: React.CSSProperties = {
    fontSize: '.7rem', color: '#6e7681', marginTop: '.2rem',
};

interface ResultBannerProps {
    ok: boolean;
    successText: React.ReactNode;
    errorText?: string;
}

export const ResultBanner: React.FC<ResultBannerProps> = ({ ok, successText, errorText }) => (
    <div style={{ padding: '.5rem 1rem', fontSize: '.8rem', color: ok ? '#3fb950' : '#e86a65', background: ok ? 'rgba(63,185,80,.07)' : 'rgba(232,106,101,.07)', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
        {ok ? <CheckCircle style={{ width: 13, height: 13 }} /> : <XCircle style={{ width: 13, height: 13 }} />}
        <span>{ok ? successText : errorText}</span>
    </div>
);

export const NameInvalidHint: React.FC<{ text: string }> = ({ text }) => (
    <div style={{ padding: '.4rem .6rem', fontSize: '.75rem', color: '#e86a65', background: 'rgba(232,106,101,.06)', border: '1px solid rgba(232,106,101,.2)', borderRadius: 5, display: 'flex', alignItems: 'center', gap: '.35rem', marginTop: '.5rem' }}>
        <AlertTriangle style={{ width: 12, height: 12 }} />
        {text}
    </div>
);

export const F2bModalHeader: React.FC<{ title: string; onClose: () => void }> = ({ title, onClose }) => (
    <div style={{ background: '#21262d', padding: '.65rem 1rem', borderBottom: '1px solid #30363d', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <Plus style={{ width: 14, height: 14, color: '#3fb950' }} />
        <span style={{ fontWeight: 700, fontSize: '.95rem', flex: 1 }}>{title}</span>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '.2rem', display: 'flex' }}>
            <X style={{ width: 16, height: 16 }} />
        </button>
    </div>
);

export const F2bCancelButton: React.FC<{ onClick: () => void; disabled?: boolean; label: string }> = ({ onClick, disabled, label }) => (
    <button onClick={onClick} disabled={disabled}
        style={{ padding: '.35rem .85rem', fontSize: '.82rem', borderRadius: 5, background: 'transparent', border: '1px solid #30363d', color: '#8b949e', cursor: disabled ? 'default' : 'pointer' }}>
        {label}
    </button>
);

export const F2bSaveButton: React.FC<{ onClick: () => void; enabled: boolean; label: string }> = ({ onClick, enabled, label }) => (
    <button onClick={onClick} disabled={!enabled}
        style={{ display: 'flex', alignItems: 'center', gap: '.35rem', padding: '.35rem .9rem', fontSize: '.82rem', borderRadius: 5, background: enabled ? '#3fb950' : '#30363d', border: 'none', color: enabled ? '#0d1117' : '#8b949e', cursor: enabled ? 'pointer' : 'default', fontWeight: 600 }}>
        <Save style={{ width: 13, height: 13 }} />
        {label}
    </button>
);

interface F2bModalShellProps {
    onClose: () => void;
    /** CSS width — e.g. 'min(680px, 96vw)' */
    width: string;
    children: React.ReactNode;
}

export const F2bModalShell: React.FC<F2bModalShellProps> = ({ onClose, width, children }) => {
    const dialogRef = useRef<HTMLDialogElement>(null);

    useEffect(() => {
        const d = dialogRef.current;
        // !d.open guards against StrictMode double-invoke and against showModal() throwing InvalidStateError if already open
        if (d && !d.open) d.showModal();
    }, []);

    const handleClick = (e: React.MouseEvent<HTMLDialogElement>) => {
        if (e.target === dialogRef.current) onClose();
    };

    const handleCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
        e.preventDefault();
        onClose();
    };

    return (
        <dialog
            ref={dialogRef}
            className="f2b-modal"
            style={{ width, display: 'flex', flexDirection: 'column' }}
            onClick={handleClick}
            onCancel={handleCancel}
            onClose={onClose}
        >
            {children}
        </dialog>
    );
};
