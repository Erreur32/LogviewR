/**
 * TabNFTables — viewer colorisé pour `nft list ruleset`.
 *
 * NFTables est le successeur d'iptables. Sur les systèmes modernes (Ubuntu 22+, Debian 11+),
 * `iptables` est souvent un wrapper autour de nftables. Les deux peuvent coexister.
 *
 * Syntaxe nft :
 *   table inet filter { chain input { type filter hook input priority 0; policy drop; ... } }
 */

import React, { useState, useCallback, useEffect } from 'react';
import { Server, RefreshCw, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { card, cardH, cardB } from './helpers';

// ── NFT colorizer ──────────────────────────────────────────────────────────────

type Token = { text: string; color?: string; bold?: boolean };

const NFT_KEYWORDS = new Set(['table', 'chain', 'set', 'map', 'flowtable', 'type', 'hook', 'priority', 'policy', 'flags', 'elements']);
const NFT_TARGETS  = new Set(['accept', 'drop', 'reject', 'return', 'jump', 'goto', 'continue', 'log']);
const NFT_MATCH    = new Set(['ct', 'ip', 'ip6', 'tcp', 'udp', 'icmp', 'icmpv6', 'meta', 'iif', 'oif', 'iifname', 'oifname', 'saddr', 'daddr', 'sport', 'dport', 'state', 'l4proto']);

function colorizeNftLine(line: string): Token[] {
    const trimmed = line.trimStart();
    const indent  = line.slice(0, line.length - trimmed.length);

    // Empty
    if (!trimmed) return [{ text: line }];
    // Comment
    if (trimmed.startsWith('#')) return [{ text: indent }, { text: trimmed, color: '#555d69' }];
    // Closing brace
    if (trimmed === '}') return [{ text: indent }, { text: '}', color: '#555d69' }];

    const tokens: Token[] = [{ text: indent }];
    const words = trimmed.split(/(\s+|[{}();,])/g);

    for (let i = 0; i < words.length; i++) {
        const w = words[i];
        if (!w) continue;

        // Delimiters
        if (w === '{') { tokens.push({ text: w, color: '#8b949e' }); continue; }
        if (w === ';' || w === ',' || w === ')') { tokens.push({ text: w, color: '#555d69' }); continue; }
        // Whitespace
        if (/^\s+$/.test(w)) { tokens.push({ text: w }); continue; }

        // IP address
        if (/^(\d{1,3}\.){3}\d{1,3}(\/\d+)?$/.test(w) || /^[0-9a-f:]+\/\d+$/i.test(w)) {
            tokens.push({ text: w, color: '#39c5cf' }); continue;
        }
        // Port / number
        if (/^\d+$/.test(w)) { tokens.push({ text: w, color: '#e3b341' }); continue; }

        const lc = w.toLowerCase();

        // Targets (accept/drop/etc.)
        if (NFT_TARGETS.has(lc)) {
            const color = lc === 'accept' ? '#3fb950' : (lc === 'drop' || lc === 'reject') ? '#e86a65' : lc === 'log' ? '#e3b341' : '#bc8cff';
            tokens.push({ text: w, color, bold: true }); continue;
        }
        // Structure keywords (table, chain, …)
        if (NFT_KEYWORDS.has(lc)) { tokens.push({ text: w, color: '#39c5cf' }); continue; }
        // Match keywords
        if (NFT_MATCH.has(lc)) { tokens.push({ text: w, color: '#e3b341' }); continue; }
        // inet / ip / ip6 / arp / bridge (address families)
        if (['inet', 'ip6', 'arp', 'bridge', 'netdev'].includes(lc)) {
            tokens.push({ text: w, color: '#bc8cff' }); continue;
        }
        // Table/chain name (after "table <family>" or "chain")
        const prev = words.slice(0, i).filter(t => t.trim()).at(-1)?.toLowerCase() ?? '';
        if (['inet', 'ip', 'ip6', 'arp', 'bridge', 'netdev', 'chain', 'table', 'jump', 'goto'].includes(prev)) {
            tokens.push({ text: w, color: '#58a6ff', bold: true }); continue;
        }

        tokens.push({ text: w, color: '#e6edf3' });
    }
    return tokens;
}

function NftLine({ line }: { line: string }) {
    const tokens = colorizeNftLine(line);
    return (
        <div>
            {tokens.map((t, i) => (
                <span key={i} style={{ color: t.color, fontWeight: t.bold ? 700 : undefined }}>{t.text}</span>
            ))}
        </div>
    );
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend() {
    const { t } = useTranslation();
    const items = [
        { color: '#3fb950', label: t('fail2ban.nftables.legendAccept') },
        { color: '#e86a65', label: t('fail2ban.nftables.legendDropReject') },
        { color: '#39c5cf', label: t('fail2ban.nftables.legendKeyword') },
        { color: '#e3b341', label: t('fail2ban.nftables.legendMatchPort') },
        { color: '#58a6ff', label: t('fail2ban.nftables.legendName') },
        { color: '#bc8cff', label: t('fail2ban.nftables.legendFamily') },
    ];
    return (
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', padding: '.4rem 0' }}>
            {items.map(it => (
                <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '.25rem', fontSize: '.67rem', color: '#8b949e' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: it.color, flexShrink: 0 }} />
                    {it.label}
                </span>
            ))}
        </div>
    );
}

// ── Info panel ────────────────────────────────────────────────────────────────

function InfoPanel() {
    const { t } = useTranslation();
    return (
        <div style={{ background: 'rgba(88,166,255,.05)', border: '1px solid rgba(88,166,255,.2)', borderRadius: 6, padding: '.55rem .85rem', fontSize: '.76rem', color: '#8b949e', lineHeight: 1.6 }}>
            <span style={{ color: '#58a6ff', fontWeight: 600 }}>NFTables</span> {t('fail2ban.nftables.infoSuccessor')}
            {t('fail2ban.nftables.infoApt')} <code style={{ color: '#c9d1d9' }}>iptables</code> {t('fail2ban.nftables.infoWrapper')}
            {t('fail2ban.nftables.infoSyntax')}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export const TabNFTables: React.FC = () => {
    const { t } = useTranslation();
    const [output, setOutput]   = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState<string | null>(null);
    const [lastLoaded, setLastLoaded] = useState(0);

    const fetchRules = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await api.get<{ ok: boolean; output: string; error?: string }>('/api/plugins/fail2ban/nftables');
            if (res.success && res.result?.ok) {
                setOutput(res.result.output ?? '');
                setLastLoaded(Date.now());
            } else {
                setError(res.result?.error ?? res.error?.message ?? t('fail2ban.nftables.error'));
            }
        } finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchRules(); }, [fetchRules]);

    const lines = output.split('\n');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <InfoPanel />
            <div style={card}>
                <div style={{ ...cardH, justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontWeight: 600, fontSize: '.88rem' }}>
                        <Server style={{ width: 14, height: 14, color: '#e3b341' }} />
                        {t('fail2ban.nftables.rulesetTitle')}
                        <span style={{ fontSize: '.7rem', color: '#555d69', fontFamily: 'monospace', fontWeight: 400 }}>nft list ruleset</span>
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {lastLoaded > 0 && !loading && <span style={{ fontSize: '.67rem', color: '#555d69' }}>{new Date(lastLoaded).toLocaleTimeString('fr-FR')}</span>}
                        <button onClick={fetchRules} disabled={loading}
                            style={{ background: 'none', border: '1px solid #30363d', borderRadius: 4, color: '#8b949e', cursor: loading ? 'default' : 'pointer', padding: '.12rem .4rem', display: 'flex', alignItems: 'center' }}>
                            <RefreshCw style={{ width: 12, height: 12 }} />
                        </button>
                    </div>
                </div>
                <div style={{ ...cardB, paddingTop: '.6rem' }}>
                    {loading && <div style={{ color: '#8b949e', fontSize: '.82rem' }}>{t('fail2ban.nftables.loading')}</div>}
                    {error && (
                        <div style={{ background: 'rgba(227,179,65,.07)', border: '1px solid rgba(227,179,65,.25)', borderRadius: 6, padding: '.75rem 1rem' }}>
                            <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center', color: '#e3b341', fontSize: '.82rem', marginBottom: '.4rem' }}>
                                <AlertTriangle style={{ width: 13, height: 13 }} /> {t('fail2ban.nftables.commandUnavailable')}
                            </div>
                            <pre style={{ fontSize: '.75rem', color: '#8b949e', fontFamily: 'monospace', margin: 0, whiteSpace: 'pre-wrap' }}>{error}</pre>
                        </div>
                    )}
                    {!loading && !error && output && (
                        <>
                            <Legend />
                            <pre style={{ fontFamily: 'monospace', fontSize: '.78rem', lineHeight: 1.75, margin: '.4rem 0 0', overflowX: 'auto', maxHeight: '60vh' }}>
                                {lines.map((line, i) => <NftLine key={i} line={line} />)}
                            </pre>
                        </>
                    )}
                    {!loading && !error && !output && lastLoaded > 0 && (
                        <div style={{ color: '#555d69', fontSize: '.8rem' }}>{t('fail2ban.nftables.noActiveRules')}</div>
                    )}
                </div>
            </div>
        </div>
    );
};
