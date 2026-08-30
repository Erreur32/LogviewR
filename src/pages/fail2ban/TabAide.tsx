import React, { useState } from 'react';
import { HelpCircle, Copy, CheckCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// ── Block types ───────────────────────────────────────────────────────────────

interface CmdEntry { cmd: string; desc?: string }
interface CmdSub   { title?: string; cmds: CmdEntry[] }

type Block =
    | { type: 'text'; v: string }
    | { type: 'note'; v: string }
    | { type: 'warn'; v: string }
    | { type: 'shell' | 'yaml' | 'conf'; v: string }
    | { type: 'cmds'; subs: CmdSub[] }
    | { type: 'ipblocks'; providers: { name: string; color: string; desc?: string; ranges: string[] }[]; safe?: boolean };

interface Section {
    title: string;
    color: string; border: string; bg: string;
    span?: 1 | 2;
    collapsed?: boolean;
    blocks: Block[];
}
interface Group { label: string; icon: string; sections: Section[] }

// ── Syntax highlighters ───────────────────────────────────────────────────────

const SHELL_KW = /^(RUN|CMD|ENTRYPOINT|FROM|ARG|ENV|COPY|ADD|mkdir|chmod|echo|cat|systemctl|apk|apt|apt-get|yarn|npm|pip|cp|mv|rm|ln|sed|awk|grep|find|curl|wget|sudo|chown|chgrp|touch|tee|export|source|set|unset|exec|ipset|iptables|iptables-save|iptables-restore|fail2ban-client|netstat|ss|zgrep|uniq|sort|wc|head|tail|date)\b/;

function ShellLine({ line }: { line: string }) {
    const trimmed = line.trimStart();
    const indent  = line.slice(0, line.length - trimmed.length);
    if (!trimmed) return <div style={{ minHeight: '1em' }} />;
    if (/^#/.test(trimmed)) return <div><span style={{ color: '#555d69' }}>{line}</span></div>;
    const parts: React.ReactNode[] = [];
    if (indent) parts.push(<span key="i" style={{ color: '#e6edf3' }}>{indent}</span>);
    if (!indent) parts.push(<span key="$" style={{ color: '#555d69', userSelect: 'none' }}>$ </span>);
    let rest = trimmed;
    const kwM = rest.match(SHELL_KW);
    if (kwM) { parts.push(<span key="kw" style={{ color: '#39c5cf', fontWeight: 600 }}>{kwM[0]}</span>); rest = rest.slice(kwM[0].length); }
    rest.split(/(\s+|"[^"]*"|'[^']*'|--?[\w-]+=?[\w./:-]*|\/[\w./_-]+)/g).forEach((tok, i) => {
        if (!tok) return;
        if (/^".*"$|^'.*'$/.test(tok)) { parts.push(<span key={i} style={{ color: '#3fb950' }}>{tok}</span>); return; }
        if (/^--?/.test(tok))          { parts.push(<span key={i} style={{ color: '#e3b341' }}>{tok}</span>); return; }
        if (/^\/[\w]/.test(tok))       { parts.push(<span key={i} style={{ color: '#58a6ff' }}>{tok}</span>); return; }
        parts.push(<span key={i} style={{ color: '#e6edf3' }}>{tok}</span>);
    });
    return <div>{parts}</div>;
}

function YamlLine({ line }: { line: string }) {
    const m = line.match(/^(\s*)(- )?([A-Za-z_][\w-]*:)(\s.*)?$/);
    if (m) return <div><span style={{ color: '#e6edf3' }}>{m[1]}</span>{m[2] && <span style={{ color: '#8b949e' }}>- </span>}<span style={{ color: '#e3b341' }}>{m[3]}</span>{m[4] && <span style={{ color: '#3fb950' }}>{m[4]}</span>}</div>;
    const lM = line.match(/^(\s*)(- )(.+)$/);
    if (lM) return <div><span style={{ color: '#e6edf3' }}>{lM[1]}</span><span style={{ color: '#8b949e' }}>- </span><span style={{ color: '#3fb950' }}>{lM[3]}</span></div>;
    if (/^\s*#/.test(line)) return <div><span style={{ color: '#555d69' }}>{line}</span></div>;
    return <div><span style={{ color: '#e6edf3' }}>{line}</span></div>;
}

function ConfLine({ line }: { line: string }) {
    const trimmed = line.trimStart();
    if (!trimmed) return <div style={{ minHeight: '1em' }} />;
    if (/^[#;]/.test(trimmed)) return <div><span style={{ color: '#555d69' }}>{line}</span></div>;
    const secM = trimmed.match(/^(\[)([^\]]+)(\].*)$/);
    if (secM) return <div><span style={{ color: '#8b949e' }}>[</span><span style={{ color: '#58a6ff', fontWeight: 600 }}>{secM[2]}</span><span style={{ color: '#8b949e' }}>{secM[3]}</span></div>;
    const kvM = trimmed.match(/^([A-Za-z_][\w./:-]*)(\s*=\s*)(.*)/);
    if (kvM) return <div>
        <span style={{ color: '#e6edf3' }}>{line.slice(0, line.length - trimmed.length)}</span>
        <span style={{ color: '#e3b341' }}>{kvM[1]}</span>
        <span style={{ color: '#8b949e' }}>{kvM[2]}</span>
        <span style={{ color: '#3fb950' }}>{kvM[3]}</span>
    </div>;
    return <div><span style={{ color: '#8b949e' }}>{line}</span></div>;
}

// ── Clipboard helper ──────────────────────────────────────────────────────────

function doCopy(text: string, onDone: () => void) {
    const fallback = () => {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        try { document.execCommand('copy'); onDone(); } catch { /* silent */ }
        document.body.removeChild(ta);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(onDone).catch(fallback);
    else fallback();
}

// ── Code block with copy ──────────────────────────────────────────────────────

const CodeBlock: React.FC<{ type: 'shell' | 'yaml' | 'conf'; code: string }> = ({ type, code }) => {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);
    const label = type === 'yaml' ? 'YAML' : type === 'conf' ? 'INI/CONF' : 'SHELL';
    const labelColor = type === 'yaml' ? '#e3b341' : type === 'conf' ? '#58a6ff' : '#39c5cf';
    return (
        <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, overflow: 'hidden', marginTop: '.4rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '.22rem .65rem', background: '#161b22', borderBottom: '1px solid #21262d' }}>
                <span style={{ fontSize: '.62rem', fontFamily: 'monospace', color: labelColor, fontWeight: 700, letterSpacing: '.05em' }}>{label}</span>
                <span style={{ flex: 1 }} />
                <button onClick={() => doCopy(code, () => { setCopied(true); setTimeout(() => setCopied(false), 1400); })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#3fb950' : '#555d69', padding: 0, display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.68rem' }}>
                    {copied ? <CheckCircle style={{ width: 11, height: 11 }} /> : <Copy style={{ width: 11, height: 11 }} />}
                    {copied ? t('fail2ban.aide.copied') : t('fail2ban.aide.copy')}
                </button>
            </div>
            <pre style={{ margin: 0, padding: '.6rem .85rem', fontSize: '.74rem', fontFamily: 'monospace', lineHeight: 1.7, overflowX: 'auto' }}>
                {code.split('\n').map((line, i) =>
                    type === 'shell' ? <ShellLine key={i} line={line} /> :
                    type === 'yaml'  ? <YamlLine  key={i} line={line} /> :
                                       <ConfLine  key={i} line={line} />
                )}
            </pre>
        </div>
    );
};

// ── CmdList block (individually copyable commands) ────────────────────────────

const CmdRow: React.FC<{ cmd: string; desc?: string }> = ({ cmd, desc }) => {
    const [copied, setCopied] = useState(false);
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', padding: '.3rem 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
            <code style={{ flex: 1, fontFamily: 'monospace', fontSize: '.73rem', color: '#c9d1d9', background: '#0d1117', border: '1px solid #21262d', borderRadius: 4, padding: '.2rem .5rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd}</code>
            {desc && <span style={{ fontSize: '.71rem', color: '#8b949e', flexShrink: 0, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</span>}
            <button onClick={() => doCopy(cmd, () => { setCopied(true); setTimeout(() => setCopied(false), 1400); })}
                style={{ background: 'none', border: '1px solid #30363d', borderRadius: 3, cursor: 'pointer', color: copied ? '#3fb950' : '#555d69', padding: '.1rem .3rem', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                {copied ? <CheckCircle style={{ width: 10, height: 10 }} /> : <Copy style={{ width: 10, height: 10 }} />}
            </button>
        </div>
    );
};

// ── IP blocks (CDN/Cloud ranges) ──────────────────────────────────────────────

const CidrBadge: React.FC<{ cidr: string; color: string }> = ({ cidr, color }) => {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);
    return (
        <button onClick={() => doCopy(cidr, () => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
            title={copied ? t('fail2ban.aide.copiedBang') : t('fail2ban.aide.copy')}
            style={{ fontFamily: 'monospace', fontSize: '.71rem', color: copied ? color : '#c9d1d9', background: '#161b22', border: `1px solid ${copied ? color : '#21262d'}`, borderRadius: 4, padding: '.12rem .4rem', cursor: 'pointer', transition: 'border-color .15s, color .15s', whiteSpace: 'nowrap' }}>
            {cidr}
        </button>
    );
};

const PALETTE_RGB: Record<string, string> = {
    '#e3b341': '227,179,65',
    '#58a6ff': '88,166,255',
    '#39c5cf': '57,197,207',
    '#e86a65': '232,106,101',
    '#3fb950': '63,185,80',
    '#bc8cff': '188,140,255',
    '#8b949e': '139,148,158',
};
const rgb = (c: string) => PALETTE_RGB[c] ?? '139,148,158';

const IpBlocks: React.FC<{ providers: { name: string; color: string; desc?: string; ranges: string[] }[]; safe?: boolean }> = ({ providers, safe }) => {
    const { t } = useTranslation();
    return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '.75rem', marginTop: '.25rem' }}>
        {providers.map(p => (
            <div key={p.name} style={{ background: '#0d1117', border: `1px solid rgba(${rgb(p.color)},.25)`, borderRadius: 7, overflow: 'hidden' }}>
                <div style={{ padding: '.38rem .65rem', background: `rgba(${rgb(p.color)},.07)`, borderBottom: `1px solid rgba(${rgb(p.color)},.2)`, display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    {safe && <span style={{ fontSize: '.68rem', color: p.color }}>✓</span>}
                    <span style={{ fontWeight: 700, fontSize: '.82rem', color: p.color }}>{p.name}</span>
                    <span style={{ fontSize: '.63rem', color: '#8b949e', marginLeft: 'auto' }}>{t('fail2ban.aide.entries', { count: p.ranges.length })}</span>
                </div>
                {p.desc && <div style={{ padding: '.3rem .65rem .1rem', fontSize: '.71rem', color: '#8b949e', lineHeight: 1.4 }}>{p.desc}</div>}
                <div style={{ padding: '.45rem .65rem', display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                    {p.ranges.map(r => <CidrBadge key={r} cidr={r} color={p.color} />)}
                </div>
            </div>
        ))}
    </div>
    );
};

const CmdList: React.FC<{ subs: CmdSub[] }> = ({ subs }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.25rem 2rem', marginTop: '.5rem' }}>
        {subs.map((sub, si) => (
            <div key={si}>
                {sub.title && <div style={{ fontSize: '.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: '#8b949e', marginBottom: '.35rem', paddingBottom: '.25rem', borderBottom: '1px solid #21262d' }}>{sub.title}</div>}
                {sub.cmds.map((c, ci) => <CmdRow key={ci} cmd={c.cmd} desc={c.desc} />)}
            </div>
        ))}
    </div>
);

// ── Section card (collapsible) ────────────────────────────────────────────────

const SectionCard: React.FC<{ section: Section }> = ({ section: s }) => {
    const [open, setOpen] = useState(!s.collapsed);
    return (
        <div style={{ borderRadius: 8, border: `1px solid ${s.border}`, background: s.bg, overflow: 'hidden' }}>
            <div onClick={() => setOpen(o => !o)} role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
                style={{ padding: '.52rem .9rem', borderBottom: open ? `1px solid ${s.border}` : 'none', display: 'flex', alignItems: 'center', gap: '.4rem', cursor: 'pointer', userSelect: 'none' }}>
                <HelpCircle style={{ width: 12, height: 12, color: s.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 600, fontSize: '.84rem', color: s.color, flex: 1 }}>{s.title}</span>
                {open ? <ChevronDown style={{ width: 12, height: 12, color: '#555d69' }} /> : <ChevronRight style={{ width: 12, height: 12, color: '#555d69' }} />}
            </div>
            {open && (
                <div style={{ padding: '1rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    {s.blocks.map((b, i) => {
                        if (b.type === 'text') return <p key={i} style={{ margin: 0, fontSize: '.79rem', color: '#8b949e', lineHeight: 1.6 }}>{b.v}</p>;
                        if (b.type === 'note') return (
                            <div key={i} style={{ display: 'flex', gap: '.4rem', background: 'rgba(88,166,255,.05)', border: '1px solid rgba(88,166,255,.2)', borderRadius: 5, padding: '.38rem .65rem', fontSize: '.75rem', color: '#8b949e', lineHeight: 1.5 }}>
                                <span style={{ color: '#58a6ff', flexShrink: 0 }}>ℹ</span>
                                <span>{b.v}</span>
                            </div>
                        );
                        if (b.type === 'warn') return (
                            <div key={i} style={{ display: 'flex', gap: '.4rem', background: 'rgba(232,106,101,.05)', border: '1px solid rgba(232,106,101,.2)', borderRadius: 5, padding: '.38rem .65rem', fontSize: '.75rem', color: '#e86a65', lineHeight: 1.5 }}>
                                <span style={{ flexShrink: 0 }}>⚠</span>
                                <span>{b.v}</span>
                            </div>
                        );
                        if (b.type === 'shell' || b.type === 'yaml' || b.type === 'conf') return <CodeBlock key={i} type={b.type} code={b.v} />;
                        if (b.type === 'cmds') return <CmdList key={i} subs={b.subs} />;
                        if (b.type === 'ipblocks') return <IpBlocks key={i} providers={b.providers} safe={b.safe} />;
                        return null;
                    })}
                </div>
            )}
        </div>
    );
};

// ── Sections data ─────────────────────────────────────────────────────────────

const buildGroups = (t: (k: string) => string): Group[] => [
    {
        label: t('fail2ban.aide.groupTroubleshooting'),
        icon: '🔧',
        sections: [
            {
                title: t('fail2ban.aide.socketTitle'),
                color: '#e86a65', border: 'rgba(232,106,101,.25)', bg: 'rgba(232,106,101,.04)', collapsed: true,
                blocks: [
                    { type: 'text', v: t('fail2ban.aide.socketText1') },
                    { type: 'shell', v: `mkdir -p /etc/systemd/system/fail2ban.service.d/
echo "[Service]\\nExecStartPost=-/usr/bin/chmod 660 /var/run/fail2ban/fail2ban.sock" \\
  > /etc/systemd/system/fail2ban.service.d/docker-access.conf
systemctl daemon-reload && systemctl restart fail2ban` },
                ],
            },
            {
                title: t('fail2ban.aide.jailMissingTitle'),
                color: '#e86a65', border: 'rgba(232,106,101,.25)', bg: 'rgba(232,106,101,.04)', collapsed: true,
                blocks: [
                    { type: 'text', v: t('fail2ban.aide.jailMissingText1') },
                    { type: 'yaml', v: 'volumes:\n  - /etc/fail2ban:/host/etc/fail2ban:ro' },
                ],
            },
            {
                title: t('fail2ban.aide.sqliteTitle'),
                color: '#e86a65', border: 'rgba(232,106,101,.25)', bg: 'rgba(232,106,101,.04)', collapsed: true,
                blocks: [
                    { type: 'text', v: t('fail2ban.aide.sqliteText1') },
                    { type: 'shell', v: 'chmod o+r /var/lib/fail2ban/fail2ban.sqlite3' },
                    { type: 'text', v: t('fail2ban.aide.sqliteText2') },
                    { type: 'yaml', v: 'volumes:\n  - /var/lib/fail2ban:/host/var/lib/fail2ban:ro' },
                ],
            },
            {
                title: t('fail2ban.aide.fwEmptyTitle'),
                color: '#e86a65', border: 'rgba(232,106,101,.25)', bg: 'rgba(232,106,101,.04)', collapsed: true,
                blocks: [
                    { type: 'text', v: t('fail2ban.aide.fwEmptyText1') },
                    { type: 'yaml', v: 'cap_add:\n  - NET_ADMIN' },
                    { type: 'shell', v: 'apk add --no-cache iptables ipset nftables' },
                ],
            },
        ],
    },
    {
        label: t('fail2ban.aide.groupUnderstand'),
        icon: '📖',
        sections: [
            {
                title: t('fail2ban.aide.countersTitle'),
                color: '#58a6ff', border: 'rgba(88,166,255,.25)', bg: 'rgba(88,166,255,.04)', span: 2, collapsed: true,
                blocks: [
                    { type: 'text', v: t('fail2ban.aide.countersText1') },
                    { type: 'text', v: t('fail2ban.aide.countersText2') },
                    { type: 'text', v: t('fail2ban.aide.countersText3') },
                    { type: 'text', v: t('fail2ban.aide.countersText4') },
                    { type: 'conf', v: `# Exemple : IP bannie 3 fois, ban actuel expiré
Bans actifs      = 0   (ban expiré → plus en jail)
Tracker IPs      = 1   (l'IP existe dans l'historique)
Total cumulé     = 3   (3 événements ban enregistrés)` },
                    { type: 'note', v: t('fail2ban.aide.countersNote') },
                ],
            },
            {
                title: t('fail2ban.aide.logicTitle'),
                color: '#58a6ff', border: 'rgba(88,166,255,.25)', bg: 'rgba(88,166,255,.04)',
                span: 2, collapsed: true,
                blocks: [
                    { type: 'text', v: t('fail2ban.aide.logicText1') },
                    { type: 'conf', v: `# ① Ordre de traitement réseau
Internet → Kernel Netfilter (ipset/iptables) → Daemon applicatif (nginx, sshd…) → fail2ban lit les logs` },
                    { type: 'note', v: t('fail2ban.aide.logicNote1') },
                    { type: 'conf', v: `# ② Pourquoi le compteur de tentatives reste à 15 malgré l'ipset
#    L'ipset ne bloque pas rétroactivement les logs déjà écrits.

IP fait 15 tentatives sur npm-4xx
       ↓
fail2ban détecte → ban iptables + ajout dans ipset blacklist
       ↓
À partir de maintenant : paquets droppés au niveau kernel
       ↓
Les 15 tentatives sont déjà dans f2b_events → compteur reste à 15` },
                    { type: 'conf', v: `# ③ Pourquoi une IP apparaît dans 2 jails (ex: npm-4xx + blacklist)
#    Flux recidive/blacklist classique :

[npm-4xx]    ban l'IP X minutes (bantime court)
       ↓
[blacklist]  si l'IP récidive → jail à bantime long (semaines/∞) + action ipset
       ↓
Résultat : IP dans ipset = bloquée définitivement au niveau kernel` },
                    { type: 'conf', v: `# ④ iptables seul vs + ipset
#
# Règle par IP  iptables = 1 règle/IP              ipset = 1 règle iptables → hash O(1)
# Performance   se dégrade avec 1000+ IPs          constant, même avec 100k IPs
# Niveau        Netfilter (avant routing)           Netfilter (avant routing)` },
                    { type: 'note', v: t('fail2ban.aide.logicNote2') },
                    { type: 'warn', v: t('fail2ban.aide.logicWarn') },
                ],
            },
            {
                title: t('fail2ban.aide.localTitle'),
                color: '#58a6ff', border: 'rgba(88,166,255,.25)', bg: 'rgba(88,166,255,.04)', span: 2, collapsed: true,
                blocks: [
                    { type: 'text', v: t('fail2ban.aide.localText1') },
                    { type: 'text', v: t('fail2ban.aide.localText2') },
                    { type: 'note', v: t('fail2ban.aide.localNote') },
                    { type: 'conf', v: `# fail2ban.local — exemple minimal
[Definition]
loglevel   = INFO
logtarget  = /var/log/fail2ban.log
dbpurgeage = 604800` },
                    { type: 'conf', v: `# jail.local — exemple
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true` },
                ],
            },
        ],
    },
    {
        label: t('fail2ban.aide.groupCommands'),
        icon: '💻',
        sections: [
            {
                title: t('fail2ban.aide.f2bCmdsTitle'),
                color: '#39c5cf', border: 'rgba(57,197,207,.25)', bg: 'rgba(57,197,207,.04)',
                span: 2,
                collapsed: true,
                blocks: [
                    { type: 'cmds', subs: [
                        { title: t('fail2ban.aide.subStatusJails'), cmds: [
                            { cmd: 'fail2ban-client status',              desc: t('fail2ban.aide.cmdStatusList') },
                            { cmd: 'fail2ban-client status sshd',         desc: t('fail2ban.aide.cmdStatusDetail') },
                            { cmd: 'fail2ban-client ping',                desc: t('fail2ban.aide.cmdPing') },
                            { cmd: 'systemctl status fail2ban',           desc: t('fail2ban.aide.cmdSystemdStatus') },
                        ]},
                        { title: t('fail2ban.aide.subBan'), cmds: [
                            { cmd: 'fail2ban-client set sshd banip 1.2.3.4',   desc: t('fail2ban.aide.cmdBanip') },
                            { cmd: 'fail2ban-client set sshd unbanip 1.2.3.4', desc: t('fail2ban.aide.cmdUnbanip') },
                            { cmd: 'fail2ban-client unban 1.2.3.4',            desc: t('fail2ban.aide.cmdUnbanAll') },
                        ]},
                        { title: t('fail2ban.aide.subConfig'), cmds: [
                            { cmd: 'fail2ban-client get sshd bantime',         desc: t('fail2ban.aide.cmdGetBantime') },
                            { cmd: 'fail2ban-client get sshd findtime' },
                            { cmd: 'fail2ban-client get sshd maxretry' },
                            { cmd: 'fail2ban-client set sshd bantime 86400',   desc: t('fail2ban.aide.cmdSetBantime') },
                        ]},
                        { title: t('fail2ban.aide.subLogs'), cmds: [
                            { cmd: 'tail -f /var/log/fail2ban.log',                                                  desc: t('fail2ban.aide.cmdTailF') },
                            { cmd: 'grep "Ban " /var/log/fail2ban.log | tail -20',                                   desc: t('fail2ban.aide.cmdLastBans') },
                            { cmd: 'zgrep "Ban " /var/log/fail2ban.log* | wc -l',                                   desc: t('fail2ban.aide.cmdTotalBans') },
                            { cmd: 'grep "Ban " /var/log/fail2ban.log | grep "$(date +%Y-%m-%d)" | wc -l',          desc: t('fail2ban.aide.cmdTodayBans') },
                        ]},
                        { title: t('fail2ban.aide.subRestart'), cmds: [
                            { cmd: 'systemctl reload fail2ban',    desc: t('fail2ban.aide.cmdReload') },
                            { cmd: 'systemctl restart fail2ban',   desc: t('fail2ban.aide.cmdRestart') },
                            { cmd: 'fail2ban-client reload',       desc: t('fail2ban.aide.cmdReloadClient') },
                        ]},
                    ]},
                ],
            },
            {
                title: t('fail2ban.aide.fwCmdsTitle'),
                color: '#39c5cf', border: 'rgba(57,197,207,.25)', bg: 'rgba(57,197,207,.04)',
                span: 2,
                collapsed: true,
                blocks: [
                    { type: 'cmds', subs: [
                        { title: t('fail2ban.aide.subIpsetList'), cmds: [
                            { cmd: 'ipset list -n',              desc: t('fail2ban.aide.cmdIpsetNames') },
                            { cmd: 'ipset list monset',          desc: t('fail2ban.aide.cmdIpsetContent') },
                            { cmd: 'ipset list monset -t',       desc: t('fail2ban.aide.cmdIpsetInfo') },
                            { cmd: 'ipset list monset | wc -l',  desc: t('fail2ban.aide.cmdIpsetCount') },
                        ]},
                        { title: t('fail2ban.aide.subIpsetCreate'), cmds: [
                            { cmd: 'ipset create blacklist hash:ip',                   desc: t('fail2ban.aide.cmdIpsetSimple') },
                            { cmd: 'ipset create blacklist hash:net',                  desc: t('fail2ban.aide.cmdIpsetCidr') },
                            { cmd: 'ipset create blacklist hash:net maxelem 1000000',  desc: t('fail2ban.aide.cmdIpsetExtended') },
                            { cmd: 'ipset add blacklist 1.2.3.4' },
                            { cmd: 'ipset add blacklist 1.2.0.0/16',    desc: t('fail2ban.aide.cmdIpsetRange') },
                            { cmd: 'ipset del blacklist 1.2.3.4' },
                            { cmd: 'ipset flush blacklist',              desc: t('fail2ban.aide.cmdIpsetFlush') },
                            { cmd: 'ipset destroy blacklist',            desc: t('fail2ban.aide.cmdIpsetDestroy') },
                            { cmd: 'ipset save > /etc/ipset.conf',       desc: t('fail2ban.aide.cmdIpsetSave') },
                            { cmd: 'ipset restore < /etc/ipset.conf',    desc: t('fail2ban.aide.cmdIpsetRestore') },
                        ]},
                        { title: t('fail2ban.aide.subIptablesList'), cmds: [
                            { cmd: 'iptables -L -n -v --line-numbers',          desc: t('fail2ban.aide.cmdIptablesAll') },
                            { cmd: 'iptables -L INPUT -n -v --line-numbers',    desc: t('fail2ban.aide.cmdIptablesInput') },
                            { cmd: 'iptables -S',                               desc: t('fail2ban.aide.cmdIptablesScript') },
                            { cmd: 'iptables-save > /etc/iptables/rules.v4',    desc: t('fail2ban.aide.cmdIptablesSave') },
                            { cmd: 'iptables-restore < /etc/iptables/rules.v4', desc: t('fail2ban.aide.cmdIptablesRestore') },
                        ]},
                        { title: t('fail2ban.aide.subIptablesLink'), cmds: [
                            { cmd: 'iptables -I INPUT -m set --match-set blacklist src -j DROP',   desc: t('fail2ban.aide.cmdIptablesDropInput') },
                            { cmd: 'iptables -I FORWARD -m set --match-set blacklist src -j DROP', desc: t('fail2ban.aide.cmdIptablesDropForward') },
                        ]},
                        { title: t('fail2ban.aide.subIptablesDel'), cmds: [
                            { cmd: 'iptables -D INPUT -m set --match-set blacklist src -j DROP', desc: t('fail2ban.aide.cmdIptablesDelExact') },
                            { cmd: 'iptables -D INPUT 3',   desc: t('fail2ban.aide.cmdIptablesDelLine') },
                            { cmd: 'iptables -F INPUT',     desc: t('fail2ban.aide.cmdIptablesFlush') },
                        ]},
                    ]},
                    { type: 'note', v: t('fail2ban.aide.fwCmdsNote') },
                    { type: 'warn', v: t('fail2ban.aide.fwCmdsWarn') },
                ],
            },
            {
                title: t('fail2ban.aide.diagTitle'),
                color: '#39c5cf', border: 'rgba(57,197,207,.25)', bg: 'rgba(57,197,207,.04)',
                span: 2,
                collapsed: true,
                blocks: [
                    { type: 'cmds', subs: [
                        { title: t('fail2ban.aide.subDiagBanned'), cmds: [
                            { cmd: 'fail2ban-client status sshd | grep 1.2.3.4' },
                            { cmd: 'ipset test blacklist 1.2.3.4 && echo "PRESENT" || echo "ABSENT"',  desc: t('fail2ban.aide.cmdDiagTestPresence') },
                            { cmd: 'iptables -C INPUT -s 1.2.3.4 -j DROP 2>&1',                        desc: t('fail2ban.aide.cmdDiagRuleExists') },
                        ]},
                        { title: t('fail2ban.aide.subDiagTop'), cmds: [
                            { cmd: "grep \"Ban \" /var/log/fail2ban.log | awk '{print $NF}' | sort | uniq -c | sort -rn | head -20",  desc: t('fail2ban.aide.cmdDiagTopBanned') },
                            { cmd: "grep \"Found \" /var/log/fail2ban.log | awk '{print $NF}' | sort | uniq -c | sort -rn | head -20", desc: t('fail2ban.aide.cmdDiagTopFailures') },
                            { cmd: "grep \"Ban \" /var/log/fail2ban.log | grep \"$(date +%Y-%m-%d)\" | wc -l",                        desc: t('fail2ban.aide.cmdDiagTodayBans') },
                        ]},
                        { title: t('fail2ban.aide.subDiagConns'), cmds: [
                            { cmd: "ss -tn state established | awk 'NR>1 {print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn | head -15", desc: t('fail2ban.aide.cmdDiagTopConns') },
                            { cmd: "ss -tn | grep :22 | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn",                        desc: t('fail2ban.aide.cmdDiagSshByIp') },
                            { cmd: "netstat -ntu | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn | head -10",                  desc: t('fail2ban.aide.cmdDiagNetstat') },
                        ]},
                    ]},
                ],
            },
        ],
    },
    {
        label: t('fail2ban.aide.groupReference'),
        icon: '📋',
        sections: [
            {
                title: t('fail2ban.aide.safeTitle'),
                color: '#3fb950', border: 'rgba(63,185,80,.25)', bg: 'rgba(63,185,80,.04)',
                span: 2, collapsed: true,
                blocks: [
                    { type: 'note', v: t('fail2ban.aide.safeNote') },
                    { type: 'ipblocks', safe: true, providers: [
                        { name: t('fail2ban.aide.providerCloudflareProxy'), color: '#e3b341', desc: t('fail2ban.aide.providerCloudflareProxyDesc'),
                          ranges: ['173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18','190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13','131.0.72.0/22'] },
                        { name: t('fail2ban.aide.providerCloudflareDns'), color: '#e3b341', desc: t('fail2ban.aide.providerCloudflareDnsDesc'),
                          ranges: ['1.1.1.1/32','1.0.0.1/32','2606:4700:4700::1111/128','2606:4700:4700::1001/128'] },
                        { name: t('fail2ban.aide.providerGoogleDns'), color: '#58a6ff', desc: t('fail2ban.aide.providerGoogleDnsDesc'),
                          ranges: ['8.8.8.8/32','8.8.4.4/32','2001:4860:4860::8888/128','2001:4860:4860::8844/128'] },
                        { name: t('fail2ban.aide.providerGooglebot'), color: '#58a6ff', desc: t('fail2ban.aide.providerGooglebotDesc'),
                          ranges: ['66.249.64.0/19','66.249.80.0/20','66.249.88.0/21'] },
                        { name: t('fail2ban.aide.providerBingbot'), color: '#39c5cf', desc: t('fail2ban.aide.providerBingbotDesc'),
                          ranges: ['40.77.167.0/24','65.52.109.0/24','199.30.16.0/20','207.46.13.0/24'] },
                        { name: t('fail2ban.aide.providerLetsEncrypt'), color: '#3fb950', desc: t('fail2ban.aide.providerLetsEncryptDesc'),
                          ranges: ['66.133.109.36/32','64.78.149.164/32'] },
                        { name: t('fail2ban.aide.providerUptimeRobot'), color: '#bc8cff', desc: t('fail2ban.aide.providerUptimeRobotDesc'),
                          ranges: ['216.245.221.80/28','69.162.124.224/28','63.143.42.240/28','216.245.221.80/28','178.62.52.237/32','54.36.148.0/24','87.248.104.0/22'] },
                        { name: t('fail2ban.aide.providerQuad9'), color: '#8b949e', desc: t('fail2ban.aide.providerQuad9Desc'),
                          ranges: ['9.9.9.9/32','149.112.112.112/32','2620:fe::fe/128','2620:fe::9/128'] },
                    ]},
                    { type: 'conf', v: `# jail.local — ajouter dans [DEFAULT] ou par jail
ignoreip = 127.0.0.1/8 ::1
           173.245.48.0/20 103.21.244.0/22 162.158.0.0/15 104.16.0.0/13
           66.249.64.0/19
           8.8.8.8 8.8.4.4 1.1.1.1 1.0.0.1` },
                ],
            },
            {
                title: t('fail2ban.aide.publicIpsTitle'),
                color: '#e3b341', border: 'rgba(227,179,65,.25)', bg: 'rgba(227,179,65,.04)',
                span: 2, collapsed: true,
                blocks: [
                    { type: 'text', v: t('fail2ban.aide.publicIpsText1') },
                    { type: 'ipblocks', providers: [
                        { name: t('fail2ban.aide.providerCloudflare'), color: '#e3b341', desc: t('fail2ban.aide.providerCloudflareDesc'),
                          ranges: ['173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18','190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13','131.0.72.0/22'] },
                        { name: t('fail2ban.aide.providerGoogle'), color: '#58a6ff', desc: t('fail2ban.aide.providerGoogleDesc'),
                          ranges: ['66.249.64.0/19','64.233.160.0/19','72.14.192.0/18','209.85.128.0/17','216.239.32.0/19','74.125.0.0/16','108.177.0.0/17','172.217.0.0/16','142.250.0.0/15'] },
                        { name: t('fail2ban.aide.providerAws'), color: '#e86a65', desc: t('fail2ban.aide.providerAwsDesc'),
                          ranges: ['3.0.0.0/9','18.0.0.0/8','52.0.0.0/8','54.0.0.0/8','176.32.64.0/18','205.251.192.0/18'] },
                        { name: t('fail2ban.aide.providerAzure'), color: '#39c5cf', desc: t('fail2ban.aide.providerAzureDesc'),
                          ranges: ['13.64.0.0/11','20.36.0.0/14','40.64.0.0/10','52.96.0.0/12'] },
                    ]},
                ],
            },
            {
                title: t('fail2ban.aide.regionalTitle'),
                color: '#e3b341', border: 'rgba(227,179,65,.25)', bg: 'rgba(227,179,65,.04)',
                span: 2, collapsed: true,
                blocks: [
                    { type: 'warn', v: t('fail2ban.aide.regionalWarn') },
                    { type: 'ipblocks', providers: [
                        { name: t('fail2ban.aide.providerChina'), color: '#e86a65', desc: t('fail2ban.aide.providerChinaDesc'),
                          ranges: ['1.0.0.0/8','14.0.0.0/8','27.0.0.0/8','36.0.0.0/8','39.0.0.0/8','42.0.0.0/8','49.0.0.0/8','58.0.0.0/8','59.0.0.0/8','60.0.0.0/8','61.0.0.0/8','101.0.0.0/8','106.0.0.0/8','110.0.0.0/8','111.0.0.0/8','112.0.0.0/8','113.0.0.0/8','114.0.0.0/8','115.0.0.0/8','116.0.0.0/8','117.0.0.0/8','118.0.0.0/8','119.0.0.0/8','120.0.0.0/8','121.0.0.0/8','122.0.0.0/8','123.0.0.0/8','124.0.0.0/8','125.0.0.0/8','163.0.0.0/8','175.0.0.0/8','180.0.0.0/8','182.0.0.0/8','183.0.0.0/8','202.0.0.0/8','203.0.0.0/8','210.0.0.0/8','211.0.0.0/8','218.0.0.0/8','219.0.0.0/8','220.0.0.0/8','221.0.0.0/8','222.0.0.0/8','223.0.0.0/8'] },
                        { name: t('fail2ban.aide.providerRussia'), color: '#bc8cff', desc: t('fail2ban.aide.providerRussiaDesc'),
                          ranges: ['5.8.0.0/16','5.45.0.0/16','5.188.0.0/16','31.13.0.0/16','37.9.0.0/16','45.8.0.0/16','45.95.0.0/16','46.8.0.0/16','77.75.0.0/16','80.66.0.0/16','83.69.0.0/16','85.93.0.0/16','89.22.0.0/16','91.108.0.0/16','92.63.0.0/16','93.179.0.0/16','95.165.0.0/16','176.97.0.0/16','185.220.0.0/16','193.32.0.0/16','194.165.0.0/16','195.54.0.0/16'] },
                        { name: t('fail2ban.aide.providerNorthKorea'), color: '#e3b341', desc: t('fail2ban.aide.providerNorthKoreaDesc'),
                          ranges: ['175.45.176.0/22','210.52.109.0/24','77.94.35.0/24'] },
                        { name: t('fail2ban.aide.providerIran'), color: '#3fb950', desc: t('fail2ban.aide.providerIranDesc'),
                          ranges: ['2.176.0.0/12','5.22.0.0/15','5.52.0.0/14','5.106.0.0/15','5.200.0.0/14','31.2.0.0/15','31.24.0.0/14','31.40.0.0/13','37.98.0.0/15','37.156.0.0/14','46.36.0.0/14','46.100.0.0/14','46.143.0.0/16','78.38.0.0/15','78.157.0.0/16','80.191.0.0/16','82.99.0.0/16','85.9.0.0/16','85.15.0.0/16','85.133.0.0/16','91.98.0.0/15','91.108.0.0/16','91.238.0.0/16','94.74.0.0/15','95.38.0.0/15'] },
                    ]},
                    { type: 'note', v: t('fail2ban.aide.regionalNote') },
                ],
            },
        ],
    },
];

// ── Group renderer ────────────────────────────────────────────────────────────

const GroupBlock: React.FC<{ group: Group }> = ({ group }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <span style={{ fontSize: '.73rem', fontWeight: 700, color: '#8b949e', letterSpacing: '.07em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                {group.icon} {group.label}
            </span>
            <div style={{ flex: 1, height: 1, background: '#21262d' }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.1rem' }}>
            {group.sections.map(s => (
                <div key={s.title} style={{ gridColumn: s.span === 2 ? 'span 2' : undefined }}>
                    <SectionCard section={s} />
                </div>
            ))}
        </div>
    </div>
);

// ── Main component ────────────────────────────────────────────────────────────

export const TabAide: React.FC = () => {
    const { t } = useTranslation();
    const GROUPS = buildGroups(t);
    return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.25rem', width: '100%' }}>
        {GROUPS.map(g => <GroupBlock key={g.label} group={g} />)}
    </div>
    );
};
