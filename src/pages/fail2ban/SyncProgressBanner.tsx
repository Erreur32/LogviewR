/**
 * SyncProgressBanner — centered top banner showing fail2ban DB sync progress.
 * Polls /api/plugins/fail2ban/sync-status every 2s.
 * Visible only during active sync phases (syncing / backfilling / geo / done).
 */

import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';

type SyncPhase = 'idle' | 'syncing' | 'backfilling' | 'geo' | 'done';

interface SyncStatus {
    phase:     SyncPhase;
    message:   string;
    detail:    string;
    progress:  number;
    updatedAt: number;
}

const PHASE_COLORS: Record<SyncPhase, { bar: string; border: string; bg: string; dot: string }> = {
    idle:        { bar: '#3fb950', border: 'rgba(63,185,80,.3)',   bg: 'rgba(63,185,80,.06)',   dot: '#3fb950' },
    syncing:     { bar: '#58a6ff', border: 'rgba(88,166,255,.35)', bg: 'rgba(88,166,255,.08)',  dot: '#58a6ff' },
    backfilling: { bar: '#e3b341', border: 'rgba(227,179,65,.35)', bg: 'rgba(227,179,65,.08)',  dot: '#e3b341' },
    geo:         { bar: '#bc8cff', border: 'rgba(188,140,255,.35)', bg: 'rgba(188,140,255,.08)', dot: '#bc8cff' },
    done:        { bar: '#3fb950', border: 'rgba(63,185,80,.35)',  bg: 'rgba(63,185,80,.08)',   dot: '#3fb950' },
};

const PHASE_ICONS: Record<SyncPhase, string> = {
    idle:        '',
    syncing:     '⟳',
    backfilling: '◈',
    geo:         '◎',
    done:        '✓',
};

export const SyncProgressBanner: React.FC = () => {
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [visible, setVisible] = useState(false);
    const [animProgress, setAnimProgress] = useState(0);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        const poll = async () => {
            try {
                const res = await api.get<SyncStatus>('/api/plugins/fail2ban/sync-status');
                if (!res.success) return;
                const s = res.result;

                if (s.phase !== 'idle') {
                    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
                    setStatus(s);
                    setVisible(true);
                } else if (visible) {
                    // Wait for CSS bar transition to finish (0.5s) + brief pause (1.5s) before hiding
                    if (!hideTimer.current) {
                        hideTimer.current = setTimeout(() => {
                            setVisible(false);
                            setStatus(null);
                            hideTimer.current = null;
                        }, 2_000);
                    }
                }
            } catch { /* ignore */ }
        };

        poll();
        pollRef.current = setInterval(poll, 2_000);
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
            if (hideTimer.current) clearTimeout(hideTimer.current);
        };
    }, [visible]);

    // Sync progress to animProgress — CSS transition on the bar handles the smooth animation.
    // Previously used JS easing (prev + (target-prev)*0.3) which never actually reaches 100.
    useEffect(() => {
        if (!status || status.progress < 0) return;
        setAnimProgress(status.progress); // jump straight to target; CSS width transition does the smoothing
    }, [status?.progress]);

    // Indeterminate animation for progress < 0
    useEffect(() => {
        if (!status || status.progress >= 0) return;
        const t = setInterval(() => {
            setAnimProgress(p => (p >= 100 ? 0 : p + 2));
        }, 30);
        return () => clearInterval(t);
    }, [status?.progress]);

    if (!visible || !status || status.phase === 'idle') return null;

    const c = PHASE_COLORS[status.phase] ?? PHASE_COLORS.idle;
    const isIndeterminate = status.progress < 0;

    return (
        <div style={{
            position: 'fixed',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            minWidth: 320,
            maxWidth: 520,
            background: c.bg,
            border: `1px solid ${c.border}`,
            borderRadius: 10,
            boxShadow: '0 4px 24px rgba(0,0,0,.5)',
            overflow: 'hidden',
            animation: 'f2b-sync-in .25s ease',
        }}>
            <style>{`
                @keyframes f2b-sync-in {
                    from { opacity: 0; transform: translateX(-50%) translateY(-12px); }
                    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
                }
                @keyframes f2b-indeterminate {
                    0%   { transform: translateX(-100%); }
                    100% { transform: translateX(400%); }
                }
            `}</style>

            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', padding: '.55rem .85rem' }}>
                {/* Phase icon */}
                <span style={{
                    fontSize: '.9rem',
                    color: c.dot,
                    animation: status.phase === 'syncing' || status.phase === 'geo'
                        ? 'spin 1s linear infinite' : undefined,
                    display: 'inline-block',
                }}>
                    {PHASE_ICONS[status.phase]}
                </span>

                {/* Pulsing dot */}
                <span style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: c.dot, flexShrink: 0,
                    boxShadow: `0 0 6px ${c.dot}`,
                    animation: status.phase !== 'done'
                        ? 'pulse 1.2s ease-in-out infinite' : undefined,
                }} />

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '.78rem', fontWeight: 700, color: c.dot, whiteSpace: 'nowrap' }}>
                            {status.message}
                        </span>
                        {status.progress >= 0 && (
                            <span style={{ fontSize: '.68rem', color: '#8b949e' }}>
                                {Math.round(status.progress)}%
                            </span>
                        )}
                    </div>
                    {status.detail && (
                        <div style={{
                            fontSize: '.7rem', color: '#8b949e',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            marginTop: '.1rem',
                        }}>
                            {status.detail}
                        </div>
                    )}
                </div>
            </div>

            {/* Progress bar */}
            <div style={{ width: '100%', height: 3, background: 'rgba(255,255,255,.06)', position: 'relative', overflow: 'hidden' }}>
                {isIndeterminate ? (
                    <div style={{
                        position: 'absolute', height: '100%', width: '25%',
                        background: c.bar,
                        animation: 'f2b-indeterminate 1.4s ease-in-out infinite',
                        borderRadius: 2,
                    }} />
                ) : (
                    <div style={{
                        height: '100%',
                        width: `${animProgress}%`,
                        background: c.bar,
                        transition: 'width .4s ease',
                        borderRadius: 2,
                    }} />
                )}
            </div>

            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: .3; }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to   { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};
