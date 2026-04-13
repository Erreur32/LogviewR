/**
 * IP Context Menu
 *
 * Dropdown menu shown on IP cell click in LogTable.
 * Options: Exclude from logs, IP details.
 */

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ShieldOff, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface IpContextMenuProps {
    ip: string;
    x: number;
    y: number;
    onExclude: (ip: string) => void;
    onDetails: (ip: string) => void;
    onClose: () => void;
}

const menuStyle: React.CSSProperties = {
    position: 'fixed',
    zIndex: 100000,
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,.5)',
    minWidth: 220,
    overflow: 'hidden',
};

const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 12px',
    border: 'none',
    background: 'transparent',
    color: '#e6edf3',
    fontSize: '.82rem',
    cursor: 'pointer',
    textAlign: 'left',
};

export const IpContextMenu: React.FC<IpContextMenuProps> = ({ ip, x, y, onExclude, onDetails, onClose }) => {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKey);
        };
    }, [onClose]);

    // Clamp position so menu doesn't overflow viewport
    const top = Math.min(y, window.innerHeight - 120);
    const left = Math.min(x, window.innerWidth - 240);

    const hoverIn = (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.04)'; };
    const hoverOut = (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; };

    return createPortal(
        <div ref={ref} style={{ ...menuStyle, top, left }}>
            {/* IP header */}
            <div style={{ padding: '6px 12px', borderBottom: '1px solid #30363d', background: '#21262d' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '.8rem', color: '#e6edf3', fontWeight: 600 }}>{ip}</span>
            </div>

            {/* Exclude option */}
            <button
                type="button"
                style={itemStyle}
                onClick={() => { onExclude(ip); onClose(); }}
                onMouseEnter={hoverIn}
                onMouseLeave={hoverOut}
            >
                <ShieldOff size={14} style={{ color: '#e3b341' }} />
                {t('logViewer.ipMenu.exclude')}
            </button>

            {/* Details option */}
            <button
                type="button"
                style={itemStyle}
                onClick={() => { onDetails(ip); onClose(); }}
                onMouseEnter={hoverIn}
                onMouseLeave={hoverOut}
            >
                <Search size={14} style={{ color: '#58a6ff' }} />
                {t('logViewer.ipMenu.details')}
            </button>
        </div>,
        document.body
    );
};
