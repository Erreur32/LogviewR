import React, { useState } from 'react';
import { HelpCircle, Copy, CheckCircle, ChevronDown, ChevronRight } from 'lucide-react';

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
                    {copied ? 'Copié' : 'Copier'}
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
    const [copied, setCopied] = useState(false);
    return (
        <button onClick={() => doCopy(cidr, () => { setCopied(true); setTimeout(() => setCopied(false), 1200); })}
            title={copied ? 'Copié !' : 'Copier'}
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

const IpBlocks: React.FC<{ providers: { name: string; color: string; desc?: string; ranges: string[] }[]; safe?: boolean }> = ({ providers, safe }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '.75rem', marginTop: '.25rem' }}>
        {providers.map(p => (
            <div key={p.name} style={{ background: '#0d1117', border: `1px solid rgba(${rgb(p.color)},.25)`, borderRadius: 7, overflow: 'hidden' }}>
                <div style={{ padding: '.38rem .65rem', background: `rgba(${rgb(p.color)},.07)`, borderBottom: `1px solid rgba(${rgb(p.color)},.2)`, display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    {safe && <span style={{ fontSize: '.68rem', color: p.color }}>✓</span>}
                    <span style={{ fontWeight: 700, fontSize: '.82rem', color: p.color }}>{p.name}</span>
                    <span style={{ fontSize: '.63rem', color: '#8b949e', marginLeft: 'auto' }}>{p.ranges.length} entrée{p.ranges.length > 1 ? 's' : ''}</span>
                </div>
                {p.desc && <div style={{ padding: '.3rem .65rem .1rem', fontSize: '.71rem', color: '#8b949e', lineHeight: 1.4 }}>{p.desc}</div>}
                <div style={{ padding: '.45rem .65rem', display: 'flex', flexWrap: 'wrap', gap: '.3rem' }}>
                    {p.ranges.map(r => <CidrBadge key={r} cidr={r} color={p.color} />)}
                </div>
            </div>
        ))}
    </div>
);

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

const GROUPS: Group[] = [
    {
        label: 'Dépannage & Configuration',
        icon: '🔧',
        sections: [
            {
                title: 'Socket inaccessible',
                color: '#e86a65', border: 'rgba(232,106,101,.25)', bg: 'rgba(232,106,101,.04)', collapsed: true,
                blocks: [
                    { type: 'text', v: 'Le socket fail2ban doit être chmod 660 sur le host. Créez le drop-in systemd :' },
                    { type: 'shell', v: `mkdir -p /etc/systemd/system/fail2ban.service.d/
echo "[Service]\\nExecStartPost=-/usr/bin/chmod 660 /var/run/fail2ban/fail2ban.sock" \\
  > /etc/systemd/system/fail2ban.service.d/docker-access.conf
systemctl daemon-reload && systemctl restart fail2ban` },
                ],
            },
            {
                title: 'Config jail manquante (filter/port/bantime…)',
                color: '#e86a65', border: 'rgba(232,106,101,.25)', bg: 'rgba(232,106,101,.04)', collapsed: true,
                blocks: [
                    { type: 'text', v: 'Ces métadonnées sont lues depuis /etc/fail2ban/jail.conf + jail.d/. Montez le volume :' },
                    { type: 'yaml', v: 'volumes:\n  - /etc/fail2ban:/host/etc/fail2ban:ro' },
                ],
            },
            {
                title: 'SQLite non lisible',
                color: '#e86a65', border: 'rgba(232,106,101,.25)', bg: 'rgba(232,106,101,.04)', collapsed: true,
                blocks: [
                    { type: 'text', v: 'La DB fail2ban est montée via /host/ dans Docker. Corrigez les permissions sur le host :' },
                    { type: 'shell', v: 'chmod o+r /var/lib/fail2ban/fail2ban.sqlite3' },
                    { type: 'text', v: 'Et vérifiez le volume dans docker-compose.yml :' },
                    { type: 'yaml', v: 'volumes:\n  - /var/lib/fail2ban:/host/var/lib/fail2ban:ro' },
                ],
            },
            {
                title: 'IPTables / IPSet / NFTables vides',
                color: '#e86a65', border: 'rgba(232,106,101,.25)', bg: 'rgba(232,106,101,.04)', collapsed: true,
                blocks: [
                    { type: 'text', v: 'Ces onglets nécessitent NET_ADMIN + les binaires dans le container :' },
                    { type: 'yaml', v: 'cap_add:\n  - NET_ADMIN' },
                    { type: 'shell', v: 'apk add --no-cache iptables ipset nftables' },
                ],
            },
        ],
    },
    {
        label: 'Comprendre',
        icon: '📖',
        sections: [
            {
                title: 'Bans actifs vs Tracker vs Total cumulé',
                color: '#58a6ff', border: 'rgba(88,166,255,.25)', bg: 'rgba(88,166,255,.04)', span: 2, collapsed: true,
                blocks: [
                    { type: 'text', v: 'Le dashboard affiche plusieurs compteurs qui mesurent des choses différentes — ils ne sont pas censés être identiques.' },
                    { type: 'text', v: '🔴 Bans actifs (header) — IPs actuellement en jail dont le ban n\'a pas encore expiré. Source : socket fail2ban en temps réel. Diminue quand un ban expire.' },
                    { type: 'text', v: '🟠 Tracker IPs (badge nav) — IPs uniques ayant eu au moins un ban depuis le début de l\'historique interne (f2b_events). Inclut les bans expirés. Ne fait que croître.' },
                    { type: 'text', v: '🟣 Total bans cumulé (header) — Somme de tous les événements ban enregistrés depuis l\'installation. Une même IP peut être comptée plusieurs fois.' },
                    { type: 'conf', v: `# Exemple : IP bannie 3 fois, ban actuel expiré
Bans actifs      = 0   (ban expiré → plus en jail)
Tracker IPs      = 1   (l'IP existe dans l'historique)
Total cumulé     = 3   (3 événements ban enregistrés)` },
                    { type: 'note', v: 'L\'historique interne (f2b_events) est conservé indéfiniment dans dashboard.db — même si fail2ban purge sa propre DB selon dbpurgeage.' },
                ],
            },
            {
                title: 'Logique fail2ban + ipset — tentatives après ban',
                color: '#58a6ff', border: 'rgba(88,166,255,.25)', bg: 'rgba(88,166,255,.04)',
                span: 2, collapsed: true,
                blocks: [
                    { type: 'text', v: 'Un tracker peut afficher 15 tentatives sur une IP déjà dans un ipset. C\'est normal — voici pourquoi.' },
                    { type: 'conf', v: `# ① Ordre de traitement réseau
Internet → Kernel Netfilter (ipset/iptables) → Daemon applicatif (nginx, sshd…) → fail2ban lit les logs` },
                    { type: 'note', v: 'L\'ipset opère au niveau kernel, avant que le paquet atteigne le daemon. Fail2ban ne voit que les logs — il ne peut pas bloquer ce que le kernel n\'a pas encore intercepté.' },
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
                    { type: 'note', v: 'Badge BANNI + IPSet sur une IP avec 15 tentatives = cohérent et correct. Tentatives = historique avant le ban. IPSet = état actuel, plus aucune tentative possible.' },
                    { type: 'warn', v: 'Si de nouvelles tentatives apparaissent après l\'ajout dans l\'ipset → problème de config : règle iptables mal positionnée, ou log généré avant le DROP kernel.' },
                ],
            },
            {
                title: 'fail2ban.local vs jail.local',
                color: '#58a6ff', border: 'rgba(88,166,255,.25)', bg: 'rgba(88,166,255,.04)', span: 2, collapsed: true,
                blocks: [
                    { type: 'text', v: 'fail2ban.local configure le démon global : loglevel, logtarget, dbfile, dbpurgeage, dbmaxmatches.' },
                    { type: 'text', v: 'jail.local configure les jails : enabled, bantime, findtime, maxretry, filter, action, logpath.' },
                    { type: 'note', v: 'Règle .conf vs .local : les .conf sont fournis par le package (ne jamais les éditer). Les .local sont vos overrides — ne mettre que ce que vous voulez changer.' },
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
        label: 'Commandes shell',
        icon: '💻',
        sections: [
            {
                title: 'Fail2ban — Statut, Ban/Unban, Config, Logs',
                color: '#39c5cf', border: 'rgba(57,197,207,.25)', bg: 'rgba(57,197,207,.04)',
                span: 2,
                collapsed: true,
                blocks: [
                    { type: 'cmds', subs: [
                        { title: 'Statut & Jails', cmds: [
                            { cmd: 'fail2ban-client status',              desc: 'Liste tous les jails actifs' },
                            { cmd: 'fail2ban-client status sshd',         desc: 'Détail d\'un jail (IPs bannies, compteurs)' },
                            { cmd: 'fail2ban-client ping',                desc: 'Vérifie que le service répond' },
                            { cmd: 'systemctl status fail2ban',           desc: 'Statut du service systemd' },
                        ]},
                        { title: 'Ban / Unban manuel', cmds: [
                            { cmd: 'fail2ban-client set sshd banip 1.2.3.4',   desc: 'Bannir une IP dans un jail' },
                            { cmd: 'fail2ban-client set sshd unbanip 1.2.3.4', desc: 'Débannir une IP' },
                            { cmd: 'fail2ban-client unban 1.2.3.4',            desc: 'Débannir de TOUS les jails' },
                        ]},
                        { title: 'Configuration d\'un jail', cmds: [
                            { cmd: 'fail2ban-client get sshd bantime',         desc: 'Lire bantime actuel' },
                            { cmd: 'fail2ban-client get sshd findtime' },
                            { cmd: 'fail2ban-client get sshd maxretry' },
                            { cmd: 'fail2ban-client set sshd bantime 86400',   desc: 'Changer bantime à 24h (live)' },
                        ]},
                        { title: 'Logs', cmds: [
                            { cmd: 'tail -f /var/log/fail2ban.log',                                                  desc: 'Suivre en temps réel' },
                            { cmd: 'grep "Ban " /var/log/fail2ban.log | tail -20',                                   desc: '20 derniers bans' },
                            { cmd: 'zgrep "Ban " /var/log/fail2ban.log* | wc -l',                                   desc: 'Total bans (logs archivés inclus)' },
                            { cmd: 'grep "Ban " /var/log/fail2ban.log | grep "$(date +%Y-%m-%d)" | wc -l',          desc: 'Bans aujourd\'hui' },
                        ]},
                        { title: 'Redémarrage & rechargement', cmds: [
                            { cmd: 'systemctl reload fail2ban',    desc: 'Recharger config sans perdre les bans' },
                            { cmd: 'systemctl restart fail2ban',   desc: 'Redémarrer (remet les compteurs à zéro)' },
                            { cmd: 'fail2ban-client reload',       desc: 'Équivalent reload via client' },
                        ]},
                    ]},
                ],
            },
            {
                title: 'Pare-feu — IPTables & IPSet',
                color: '#39c5cf', border: 'rgba(57,197,207,.25)', bg: 'rgba(57,197,207,.04)',
                span: 2,
                collapsed: true,
                blocks: [
                    { type: 'cmds', subs: [
                        { title: 'IPSet — Lister / Inspecter', cmds: [
                            { cmd: 'ipset list -n',              desc: 'Noms de tous les sets' },
                            { cmd: 'ipset list monset',          desc: 'Contenu complet d\'un set' },
                            { cmd: 'ipset list monset -t',       desc: 'Infos (type, taille) sans les IPs' },
                            { cmd: 'ipset list monset | wc -l',  desc: 'Nombre d\'entrées (approx.)' },
                        ]},
                        { title: 'IPSet — Créer / Modifier', cmds: [
                            { cmd: 'ipset create blacklist hash:ip',                   desc: 'Set d\'IPs simples' },
                            { cmd: 'ipset create blacklist hash:net',                  desc: 'Set d\'IPs + plages CIDR' },
                            { cmd: 'ipset create blacklist hash:net maxelem 1000000',  desc: 'Capacité étendue' },
                            { cmd: 'ipset add blacklist 1.2.3.4' },
                            { cmd: 'ipset add blacklist 1.2.0.0/16',    desc: 'Bloquer une plage entière' },
                            { cmd: 'ipset del blacklist 1.2.3.4' },
                            { cmd: 'ipset flush blacklist',              desc: 'Vider (garder la structure)' },
                            { cmd: 'ipset destroy blacklist',            desc: 'Supprimer entièrement' },
                            { cmd: 'ipset save > /etc/ipset.conf',       desc: 'Sauvegarder tous les sets' },
                            { cmd: 'ipset restore < /etc/ipset.conf',    desc: 'Restaurer' },
                        ]},
                        { title: 'IPTables — Lister', cmds: [
                            { cmd: 'iptables -L -n -v --line-numbers',          desc: 'Toutes les chaînes avec compteurs' },
                            { cmd: 'iptables -L INPUT -n -v --line-numbers',    desc: 'Chaîne INPUT uniquement' },
                            { cmd: 'iptables -S',                               desc: 'Format script (toutes les règles)' },
                            { cmd: 'iptables-save > /etc/iptables/rules.v4',    desc: 'Sauvegarder' },
                            { cmd: 'iptables-restore < /etc/iptables/rules.v4', desc: 'Restaurer' },
                        ]},
                        { title: 'IPTables — Lier un IPSet (bloquer)', cmds: [
                            { cmd: 'iptables -I INPUT -m set --match-set blacklist src -j DROP',   desc: 'Bloquer tout le set en entrée' },
                            { cmd: 'iptables -I FORWARD -m set --match-set blacklist src -j DROP', desc: 'Bloquer aussi en transit' },
                        ]},
                        { title: 'IPTables — Supprimer une règle', cmds: [
                            { cmd: 'iptables -D INPUT -m set --match-set blacklist src -j DROP', desc: 'Par contenu exact' },
                            { cmd: 'iptables -D INPUT 3',   desc: 'Par numéro de ligne' },
                            { cmd: 'iptables -F INPUT',     desc: 'Vider toute la chaîne INPUT' },
                        ]},
                    ]},
                    { type: 'note', v: 'DROP = silencieux (recommandé pour blacklists). REJECT = envoie une réponse. Utiliser hash:net pour les plages CIDR, hash:ip pour les IPs simples.' },
                    { type: 'warn', v: 'iptables -F vide TOUTES les chaînes sans confirmation — dangereux sur un serveur distant sans règle SSH de secours.' },
                ],
            },
            {
                title: 'Diagnostic & Surveillance',
                color: '#39c5cf', border: 'rgba(57,197,207,.25)', bg: 'rgba(57,197,207,.04)',
                span: 2,
                collapsed: true,
                blocks: [
                    { type: 'cmds', subs: [
                        { title: 'Vérifier si une IP est bannie', cmds: [
                            { cmd: 'fail2ban-client status sshd | grep 1.2.3.4' },
                            { cmd: 'ipset test blacklist 1.2.3.4 && echo "PRESENT" || echo "ABSENT"',  desc: 'Tester présence dans un set' },
                            { cmd: 'iptables -C INPUT -s 1.2.3.4 -j DROP 2>&1',                        desc: 'Vérifier si règle existe (exit 0 = oui)' },
                        ]},
                        { title: 'Top attaquants', cmds: [
                            { cmd: "grep \"Ban \" /var/log/fail2ban.log | awk '{print $NF}' | sort | uniq -c | sort -rn | head -20",  desc: 'Top 20 IPs les plus bannies' },
                            { cmd: "grep \"Found \" /var/log/fail2ban.log | awk '{print $NF}' | sort | uniq -c | sort -rn | head -20", desc: 'Top 20 IPs avec plus d\'échecs' },
                            { cmd: "grep \"Ban \" /var/log/fail2ban.log | grep \"$(date +%Y-%m-%d)\" | wc -l",                        desc: 'Bans aujourd\'hui' },
                        ]},
                        { title: 'Connexions actives', cmds: [
                            { cmd: "ss -tn state established | awk 'NR>1 {print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn | head -15", desc: 'Top IPs connectées' },
                            { cmd: "ss -tn | grep :22 | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn",                        desc: 'Connexions SSH par IP' },
                            { cmd: "netstat -ntu | awk '{print $5}' | cut -d: -f1 | sort | uniq -c | sort -rn | head -10",                  desc: 'Top IPs (netstat)' },
                        ]},
                    ]},
                ],
            },
        ],
    },
    {
        label: 'Référence',
        icon: '📋',
        sections: [
            {
                title: 'IPs à ne PAS bannir — Safe list',
                color: '#3fb950', border: 'rgba(63,185,80,.25)', bg: 'rgba(63,185,80,.04)',
                span: 2, collapsed: true,
                blocks: [
                    { type: 'note', v: 'Bannir ces plages bloquerait du trafic légitime ou casserait des services (proxy CDN, résolveurs DNS, crawlers SEO, monitoring). Ajoutez-les dans ignoreip de vos jails.' },
                    { type: 'ipblocks', safe: true, providers: [
                        { name: 'Cloudflare Proxy', color: '#e3b341', desc: 'Si votre domaine est derrière Cloudflare, tout le trafic passe par ces IPs — les bannir bloque tout le monde',
                          ranges: ['173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18','190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13','131.0.72.0/22'] },
                        { name: 'Cloudflare DNS', color: '#e3b341', desc: 'Résolveur DNS public 1.1.1.1 — ne pas confondre avec le proxy',
                          ranges: ['1.1.1.1/32','1.0.0.1/32','2606:4700:4700::1111/128','2606:4700:4700::1001/128'] },
                        { name: 'Google DNS', color: '#58a6ff', desc: 'Résolveur DNS public 8.8.8.8',
                          ranges: ['8.8.8.8/32','8.8.4.4/32','2001:4860:4860::8888/128','2001:4860:4860::8844/128'] },
                        { name: 'Googlebot', color: '#58a6ff', desc: 'Crawler SEO Google — ban = déréférencement',
                          ranges: ['66.249.64.0/19','66.249.80.0/20','66.249.88.0/21'] },
                        { name: 'Bingbot', color: '#39c5cf', desc: 'Crawler Microsoft Bing',
                          ranges: ['40.77.167.0/24','65.52.109.0/24','199.30.16.0/20','207.46.13.0/24'] },
                        { name: 'Let\'s Encrypt', color: '#3fb950', desc: 'Validation ACME pour renouvellement SSL — ban = certificats cassés',
                          ranges: ['66.133.109.36/32','64.78.149.164/32'] },
                        { name: 'UptimeRobot', color: '#bc8cff', desc: 'Monitoring uptime — ban = fausses alertes down',
                          ranges: ['216.245.221.80/28','69.162.124.224/28','63.143.42.240/28','216.245.221.80/28','178.62.52.237/32','54.36.148.0/24','87.248.104.0/22'] },
                        { name: 'Quad9 DNS', color: '#8b949e', desc: 'Résolveur DNS public sécurisé',
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
                title: 'IP publiques connues — CDN & Cloud',
                color: '#e3b341', border: 'rgba(227,179,65,.25)', bg: 'rgba(227,179,65,.04)',
                span: 2, collapsed: true,
                blocks: [
                    { type: 'text', v: 'Un ban sur ces plages est souvent légitime (bot/abus depuis CDN ou cloud). Repère informatif — ces IPs appartiennent à des fournisseurs reconnus. Cliquer sur un CIDR pour le copier.' },
                    { type: 'ipblocks', providers: [
                        { name: 'Cloudflare', color: '#e3b341', desc: 'CDN mondial — bots légitimes et abus fréquents',
                          ranges: ['173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18','190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13','131.0.72.0/22'] },
                        { name: 'Google', color: '#58a6ff', desc: 'Crawlers, bots publicitaires, services GCP',
                          ranges: ['66.249.64.0/19','64.233.160.0/19','72.14.192.0/18','209.85.128.0/17','216.239.32.0/19','74.125.0.0/16','108.177.0.0/17','172.217.0.0/16','142.250.0.0/15'] },
                        { name: 'Amazon AWS', color: '#e86a65', desc: 'Cloud public — source fréquente de scans',
                          ranges: ['3.0.0.0/9','18.0.0.0/8','52.0.0.0/8','54.0.0.0/8','176.32.64.0/18','205.251.192.0/18'] },
                        { name: 'Microsoft Azure', color: '#39c5cf', desc: 'Cloud Microsoft / Office 365',
                          ranges: ['13.64.0.0/11','20.36.0.0/14','40.64.0.0/10','52.96.0.0/12'] },
                    ]},
                ],
            },
            {
                title: 'Plages régionales à risque élevé',
                color: '#e3b341', border: 'rgba(227,179,65,.25)', bg: 'rgba(227,179,65,.04)',
                span: 2, collapsed: true,
                blocks: [
                    { type: 'warn', v: 'Ces plages sont statistiquement surreprésentées dans les logs de scan/brute-force. Un ban préventif réduit le bruit. À utiliser selon votre contexte — certaines peuvent héberger des utilisateurs légitimes.' },
                    { type: 'ipblocks', providers: [
                        { name: 'Chine (CN)', color: '#e86a65', desc: 'Plages APNIC principales — scans massifs, brute-force SSH/HTTP',
                          ranges: ['1.0.0.0/8','14.0.0.0/8','27.0.0.0/8','36.0.0.0/8','39.0.0.0/8','42.0.0.0/8','49.0.0.0/8','58.0.0.0/8','59.0.0.0/8','60.0.0.0/8','61.0.0.0/8','101.0.0.0/8','106.0.0.0/8','110.0.0.0/8','111.0.0.0/8','112.0.0.0/8','113.0.0.0/8','114.0.0.0/8','115.0.0.0/8','116.0.0.0/8','117.0.0.0/8','118.0.0.0/8','119.0.0.0/8','120.0.0.0/8','121.0.0.0/8','122.0.0.0/8','123.0.0.0/8','124.0.0.0/8','125.0.0.0/8','163.0.0.0/8','175.0.0.0/8','180.0.0.0/8','182.0.0.0/8','183.0.0.0/8','202.0.0.0/8','203.0.0.0/8','210.0.0.0/8','211.0.0.0/8','218.0.0.0/8','219.0.0.0/8','220.0.0.0/8','221.0.0.0/8','222.0.0.0/8','223.0.0.0/8'] },
                        { name: 'Russie (RU)', color: '#bc8cff', desc: 'Plages RIPE NCC — botnets, ransomware, phishing',
                          ranges: ['5.8.0.0/16','5.45.0.0/16','5.188.0.0/16','31.13.0.0/16','37.9.0.0/16','45.8.0.0/16','45.95.0.0/16','46.8.0.0/16','77.75.0.0/16','80.66.0.0/16','83.69.0.0/16','85.93.0.0/16','89.22.0.0/16','91.108.0.0/16','92.63.0.0/16','93.179.0.0/16','95.165.0.0/16','176.97.0.0/16','185.220.0.0/16','193.32.0.0/16','194.165.0.0/16','195.54.0.0/16'] },
                        { name: 'Corée du Nord (KP)', color: '#e3b341', desc: 'Infrastructure étatique — activité malveillante documentée',
                          ranges: ['175.45.176.0/22','210.52.109.0/24','77.94.35.0/24'] },
                        { name: 'Iran (IR)', color: '#3fb950', desc: 'Plages ARIN/RIPE — scans, espionnage ciblé',
                          ranges: ['2.176.0.0/12','5.22.0.0/15','5.52.0.0/14','5.106.0.0/15','5.200.0.0/14','31.2.0.0/15','31.24.0.0/14','31.40.0.0/13','37.98.0.0/15','37.156.0.0/14','46.36.0.0/14','46.100.0.0/14','46.143.0.0/16','78.38.0.0/15','78.157.0.0/16','80.191.0.0/16','82.99.0.0/16','85.9.0.0/16','85.15.0.0/16','85.133.0.0/16','91.98.0.0/15','91.108.0.0/16','91.238.0.0/16','94.74.0.0/15','95.38.0.0/15'] },
                    ]},
                    { type: 'note', v: 'Source : APNIC, RIPE NCC, ARIN — données publiques. Ces plages évoluent — vérifier régulièrement via whois ou les RIR.' },
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

export const TabAide: React.FC = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.25rem', width: '100%' }}>
        {GROUPS.map(g => <GroupBlock key={g.label} group={g} />)}
    </div>
);
