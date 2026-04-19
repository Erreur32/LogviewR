import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Loader2 } from 'lucide-react';
import { api } from '../api/client';

type VersionBlock = { version: string; date: string; body: string };

const VERSION_HEADER_RE = /##\s*\[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/g;

function parseVersions(raw: string): VersionBlock[] {
  const sections: VersionBlock[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  VERSION_HEADER_RE.lastIndex = 0;
  while ((match = VERSION_HEADER_RE.exec(raw)) !== null) {
    const prev = sections.at(-1);
    if (prev) prev.body = raw.slice(lastIndex, match.index).trim();
    sections.push({ version: match[1], date: match[2], body: '' });
    lastIndex = match.index + match[0].length;
  }
  const last = sections.at(-1);
  if (last) last.body = raw.slice(lastIndex).trim();
  return sections;
}

const INLINE_MD_RE = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  INLINE_MD_RE.lastIndex = 0;
  while ((match = INLINE_MD_RE.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    if (match[2] !== undefined) {
      parts.push(
        <strong key={`${keyBase}-b${i++}`} className="font-semibold text-amber-300">{match[2]}</strong>
      );
    } else if (match[3] !== undefined) {
      parts.push(
        <code key={`${keyBase}-c${i++}`} className="bg-gray-800 text-teal-300 px-1.5 py-0.5 rounded border border-gray-700 text-[0.75rem] font-mono">
          {match[3]}
        </code>
      );
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

// Per-line handlers — keeps renderBody under the cognitive-complexity limit.
// Each returns the JSX node to append to the main output (or null if the line
// belongs to an ongoing list/fence buffer, which the caller handles).

function renderLineNode(line: string, key: number): React.ReactNode | null {
  if (line.startsWith('### ')) {
    return (
      <h4 key={`h3-${key}`} className="text-base font-semibold text-cyan-400 mt-3 mb-1.5 border-b border-cyan-500/20 pb-0.5">
        {renderInline(line.slice(4), `h3-${key}`)}
      </h4>
    );
  }
  if (line.startsWith('#### ')) {
    return (
      <h5 key={`h4-${key}`} className="text-sm font-medium text-emerald-400 mt-2 mb-1">
        {renderInline(line.slice(5), `h4-${key}`)}
      </h5>
    );
  }
  if (line.trim() === '---') {
    return <hr key={`hr-${key}`} className="border-gray-700 my-3" />;
  }
  if (line.trim()) {
    return (
      <p key={`p-${key}`} className="text-sm text-gray-400 my-2 leading-relaxed">
        {renderInline(line, `p-${key}`)}
      </p>
    );
  }
  return null;
}

function renderBody(body: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let listBuffer: React.ReactNode[] = [];
  let fenceBuffer: string[] | null = null;
  let key = 0;

  const flushList = () => {
    if (listBuffer.length) {
      out.push(<ul key={`ul-${key++}`} className="list-disc pl-5 my-2 space-y-0.5">{listBuffer}</ul>);
      listBuffer = [];
    }
  };
  const flushFence = () => {
    if (fenceBuffer) {
      out.push(
        <pre key={`pre-${key++}`} className="bg-gray-900 border border-gray-700 border-l-4 border-l-teal-500 rounded-lg p-3 my-3 overflow-x-auto text-xs text-gray-200 font-mono">
          <code>{fenceBuffer.join('\n')}</code>
        </pre>
      );
      fenceBuffer = null;
    }
  };

  for (const line of body.split(/\n/)) {
    if (line.startsWith('```')) {
      if (fenceBuffer) flushFence();
      else { flushList(); fenceBuffer = []; }
      continue;
    }
    if (fenceBuffer) { fenceBuffer.push(line); continue; }

    if (/^[-*]\s+/.test(line)) {
      listBuffer.push(
        <li key={`li-${key++}`} className="text-sm text-gray-300 leading-relaxed">
          {renderInline(line.replace(/^[-*]\s+/, ''), `li-${key}`)}
        </li>
      );
      continue;
    }

    flushList();
    const node = renderLineNode(line, key++);
    if (node) out.push(node);
  }
  flushList();
  flushFence();
  return <>{out}</>;
}

interface ChangelogBlockProps {
  /** When true, renders a clickable header with chevron; body collapsed by default. */
  collapsible?: boolean;
}

export const ChangelogBlock: React.FC<ChangelogBlockProps> = ({ collapsible = false }) => {
  const { t } = useTranslation();
  const [raw, setRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [open, setOpen] = useState(!collapsible);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!open || fetched) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await api.get<{ content: string }>('/api/info/changelog');
        if (!cancelled && response.success && response.result?.content) {
          setRaw(response.result.content);
          setSelectedIndex(0);
        }
      } catch {
        if (!cancelled) setRaw(null);
      } finally {
        if (!cancelled) { setLoading(false); setFetched(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [open, fetched]);

  const versions = useMemo(() => (raw ? parseVersions(raw) : []), [raw]);
  const current = versions[selectedIndex];

  const inner = (
    <>
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 size={14} className="animate-spin" />
          <span>{t('info.changelogLoading')}</span>
        </div>
      )}
      {!loading && versions.length === 0 && (
        <p className="text-sm text-gray-400">{t('info.changelogNotAvailable')}</p>
      )}
      {!loading && versions.length > 0 && current && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs text-gray-500">{t('info.version')}</span>
            <select
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
              className="px-2.5 py-1 bg-[#0d0d0d] border border-gray-700 rounded text-xs font-mono text-gray-300 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            >
              {versions.map((v, i) => (
                <option key={v.version} value={i}>
                  {v.version}{v.date ? `  —  ${v.date}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="rounded-lg bg-gray-900/50 border border-gray-700 p-3 max-h-[480px] overflow-y-auto">
            <h4 className="text-sm font-bold text-cyan-400 mb-0.5">
              {t('info.versionLabel', { version: current.version })}
            </h4>
            {current.date && <p className="text-xs text-gray-500 mb-2">{current.date}</p>}
            {renderBody(current.body)}
          </div>
        </>
      )}
    </>
  );

  if (!collapsible) return <div>{inner}</div>;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-left px-1 py-1 hover:bg-gray-800/30 rounded transition-colors"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-cyan-400">{t('info.changelogHistoryTitle')}</span>
        <ChevronDown size={14} className={`text-cyan-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="mt-3">{inner}</div>}
    </div>
  );
};
