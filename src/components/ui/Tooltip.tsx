import React, { useState, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

export type TooltipColor = 'blue' | 'red' | 'orange' | 'purple' | 'green' | 'cyan' | 'muted';

const ACCENT: Record<TooltipColor, string> = {
  blue: '#388bfd', red: '#e86a65', orange: '#e3b341',
  purple: '#bc8cff', green: '#3fb950', cyan: '#39c5cf', muted: '#8b949e',
};
const BORDER: Record<TooltipColor, string> = {
  blue: 'rgba(56,139,253,.45)', red: 'rgba(232,106,101,.45)', orange: 'rgba(227,179,65,.45)',
  purple: 'rgba(188,140,255,.45)', green: 'rgba(63,185,80,.45)', cyan: 'rgba(57,197,207,.45)', muted: '#30363d',
};

interface TooltipProps {
  /** Title shown in accent color at the top */
  title?: string;
  /** Plain text body — use bodyNode for rich content */
  content?: string | React.ReactNode;
  /** Rich ReactNode body — overrides content when provided */
  bodyNode?: React.ReactNode;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  color?: TooltipColor;
  /** Min width in px (default 200) */
  width?: number;
  /** @deprecated — kept for compatibility, ignored */
  wrap?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
  title, content, bodyNode, children, position, color = 'blue', width = 200,
}) => {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [below, setBelow] = useState(false);
  const [ready, setReady] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const accent = ACCENT[color];
  const border = BORDER[color];

  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !boxRef.current) return;
    const tr = triggerRef.current.getBoundingClientRect();
    const br = boxRef.current.getBoundingClientRect();
    const margin = 10;
    let left = tr.left + tr.width / 2;
    const autoBelow = position === 'bottom' || (position !== 'top' && tr.top < window.innerHeight * 0.4);
    setBelow(autoBelow);
    const top = autoBelow ? tr.bottom + 6 : tr.top - 6;
    left = Math.max(margin + br.width / 2, Math.min(left, window.innerWidth - br.width / 2 - margin));
    setPos({ left, top });
    setReady(true);
  }, [visible, position]);

  const show = () => { setReady(false); setVisible(true); };
  const hide = () => { setVisible(false); setReady(false); };

  const body = bodyNode ?? content;

  const tooltip = visible && createPortal(
    <div
      ref={boxRef}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        transform: below ? 'translate(-50%, 0)' : 'translate(-50%, -100%) translateY(-4px)',
        zIndex: 10002,
        pointerEvents: 'none',
        opacity: ready ? 1 : 0,
        transition: 'opacity .15s ease',
        visibility: ready ? 'visible' : 'hidden',
      }}
    >
      <div style={{
        position: 'relative',
        background: '#161b22',
        borderTop: `1px solid ${border}`,
        borderRight: `1px solid ${border}`,
        borderBottom: `1px solid ${border}`,
        borderLeft: `4px solid ${border}`,
        borderRadius: 8,
        minWidth: width,
        maxWidth: 420,
        boxShadow: '0 10px 36px rgba(0,0,0,.65), 0 2px 8px rgba(0,0,0,.35)',
        fontSize: '.82rem',
        lineHeight: 1.5,
        overflow: 'hidden',
      }}>
        {title && (
          <span style={{
            display: 'block',
            fontWeight: 700,
            fontSize: '.88rem',
            color: accent,
            padding: '.4rem .85rem .3rem',
            borderBottom: '1px solid rgba(255,255,255,.06)',
            background: '#0d1117',
          }}>
            {title}
          </span>
        )}
        {body !== undefined && (
          <span style={{
            display: 'block',
            color: '#e6edf3',
            fontSize: '.8rem',
            lineHeight: 1.5,
            padding: '.35rem .85rem .5rem',
            whiteSpace: 'pre-wrap',
          }}>
            {body}
          </span>
        )}
        {/* Arrow */}
        <div style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeftWidth: 7, borderLeftStyle: 'solid', borderLeftColor: 'transparent',
          borderRightWidth: 7, borderRightStyle: 'solid', borderRightColor: 'transparent',
          ...(below
            ? { top: -7, borderBottomWidth: 7, borderBottomStyle: 'solid', borderBottomColor: '#0d1117' }
            : { bottom: -7, borderTopWidth: 7, borderTopStyle: 'solid', borderTopColor: '#161b22' }),
        }} />
      </div>
    </div>,
    document.body,
  );

  return (
    <>
      <span ref={triggerRef} onMouseEnter={show} onMouseLeave={hide} className="inline-flex">
        {children}
      </span>
      {tooltip}
    </>
  );
};
