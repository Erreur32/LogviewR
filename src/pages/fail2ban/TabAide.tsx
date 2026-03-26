import React from 'react';
import { HelpCircle, Copy, CheckCircle } from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

type BlockType = 'text' | 'shell' | 'yaml' | 'conf';
interface Block { type: BlockType; v: string }
interface Section { title: string; color: string; border: string; bg: string; blocks: Block[] }

// ── Syntax highlighters ───────────────────────────────────────────────────────

const SHELL_KW = /^(RUN|CMD|ENTRYPOINT|FROM|ARG|ENV|COPY|ADD|mkdir|chmod|echo|cat|systemctl|apk|apt|apt-get|yarn|npm|pip|cp|mv|rm|ln|sed|awk|grep|find|curl|wget|sudo|chown|chgrp|touch|tee|export|source|set|unset|exec)\b/;

function ShellLine({ line }: { line: string }) {
    const trimmed = line.trimStart();
    const indent = line.slice(0, line.length - trimmed.length);

    if (!trimmed) return <div style={{ minHeight: '1em' }} />;
    if (/^#/.test(trimmed)) return (
        <div><span style={{ color: '#555d69' }}>{line}</span></div>
    );

    const parts: React.ReactNode[] = [];
    if (indent) parts.push(<span key="i" style={{ color: '#e6edf3' }}>{indent}</span>);

    // Prompt $ if no indent
    if (!indent) parts.push(<span key="$" style={{ color: '#555d69', userSelect: 'none' }}>$ </span>);

    let rest = trimmed;

    // Command keyword
    const kwM = rest.match(SHELL_KW);
    if (kwM) {
        parts.push(<span key="kw" style={{ color: '#39c5cf', fontWeight: 600 }}>{kwM[0]}</span>);
        rest = rest.slice(kwM[0].length);
    }

    // Tokenize rest: flags, paths, quoted strings, rest
    const tokens = rest.split(/(\s+|"[^"]*"|'[^']*'|--?[\w-]+=?[\w./:-]*|\/[\w./_-]+)/g);
    tokens.forEach((tok, i) => {
        if (!tok) return;
        if (/^".*"$|^'.*'$/.test(tok)) { parts.push(<span key={i} style={{ color: '#3fb950' }}>{tok}</span>); return; }
        if (/^--?/.test(tok)) { parts.push(<span key={i} style={{ color: '#e3b341' }}>{tok}</span>); return; }
        if (/^\/[\w]/.test(tok)) { parts.push(<span key={i} style={{ color: '#58a6ff' }}>{tok}</span>); return; }
        parts.push(<span key={i} style={{ color: '#e6edf3' }}>{tok}</span>);
    });

    return <div>{parts}</div>;
}

function YamlLine({ line }: { line: string }) {
    const m = line.match(/^(\s*)(- )?([A-Za-z_][\w-]*:)(\s.*)?$/);
    if (m) return (
        <div>
            <span style={{ color: '#e6edf3' }}>{m[1]}</span>
            {m[2] && <span style={{ color: '#8b949e' }}>- </span>}
            <span style={{ color: '#e3b341' }}>{m[3]}</span>
            {m[4] && <span style={{ color: '#3fb950' }}>{m[4]}</span>}
        </div>
    );
    const listM = line.match(/^(\s*)(- )(.+)$/);
    if (listM) return (
        <div>
            <span style={{ color: '#e6edf3' }}>{listM[1]}</span>
            <span style={{ color: '#8b949e' }}>- </span>
            <span style={{ color: '#3fb950' }}>{listM[3]}</span>
        </div>
    );
    if (/^\s*#/.test(line)) return <div><span style={{ color: '#555d69' }}>{line}</span></div>;
    return <div><span style={{ color: '#e6edf3' }}>{line}</span></div>;
}

function ConfLine({ line }: { line: string }) {
    const trimmed = line.trimStart();
    if (!trimmed) return <div style={{ minHeight: '1em' }} />;
    if (/^[#;]/.test(trimmed)) return <div><span style={{ color: '#555d69' }}>{line}</span></div>;
    const secM = trimmed.match(/^(\[)([^\]]+)(\].*)$/);
    if (secM) return (
        <div>
            <span style={{ color: '#8b949e' }}>[</span>
            <span style={{ color: '#58a6ff', fontWeight: 600 }}>{secM[2]}</span>
            <span style={{ color: '#8b949e' }}>{secM[3]}</span>
        </div>
    );
    const kvM = trimmed.match(/^([A-Za-z_][\w./:-]*)(\s*=\s*)(.*)/);
    if (kvM) return (
        <div>
            <span style={{ color: line.length - trimmed.length > 0 ? '#e6edf3' : '' }}>{line.slice(0, line.length - trimmed.length)}</span>
            <span style={{ color: '#e3b341' }}>{kvM[1]}</span>
            <span style={{ color: '#8b949e' }}>{kvM[2]}</span>
            <span style={{ color: '#3fb950' }}>{kvM[3]}</span>
        </div>
    );
    return <div><span style={{ color: '#8b949e' }}>{line}</span></div>;
}

// ── Clipboard helper ──────────────────────────────────────────────────────────

function fallbackCopy(text: string, onDone: () => void) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); onDone(); } catch { /* silent */ }
    document.body.removeChild(ta);
}

// ── Code block with copy button ───────────────────────────────────────────────

const CodeBlock: React.FC<{ type: BlockType; code: string }> = ({ type, code }) => {
    const [copied, setCopied] = React.useState(false);
    const copy = () => {
        const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1400); };
        if (navigator.clipboard) {
            navigator.clipboard.writeText(code).then(done).catch(() => fallbackCopy(code, done));
        } else {
            fallbackCopy(code, done);
        }
    };
    const label = type === 'yaml' ? 'YAML' : type === 'conf' ? 'INI/CONF' : 'SHELL';
    const labelColor = type === 'yaml' ? '#e3b341' : type === 'conf' ? '#58a6ff' : '#39c5cf';

    return (
        <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, overflow: 'hidden', marginTop: '.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '.25rem .65rem', background: '#161b22', borderBottom: '1px solid #21262d', gap: '.5rem' }}>
                <span style={{ fontSize: '.62rem', fontFamily: 'monospace', color: labelColor, fontWeight: 700, letterSpacing: '.05em' }}>{label}</span>
                <span style={{ flex: 1 }} />
                <button onClick={copy} style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied ? '#3fb950' : '#555d69', padding: 0, display: 'flex', alignItems: 'center', gap: '.3rem', fontSize: '.68rem' }}>
                    {copied ? <CheckCircle style={{ width: 11, height: 11 }} /> : <Copy style={{ width: 11, height: 11 }} />}
                    {copied ? 'Copié' : 'Copier'}
                </button>
            </div>
            <pre style={{ margin: 0, padding: '.65rem .85rem', fontSize: '.74rem', fontFamily: 'monospace', lineHeight: 1.7, overflowX: 'auto' }}>
                {code.split('\n').map((line, i) => (
                    type === 'shell' ? <ShellLine key={i} line={line} /> :
                    type === 'yaml'  ? <YamlLine  key={i} line={line} /> :
                                       <ConfLine  key={i} line={line} />
                ))}
            </pre>
        </div>
    );
};

// ── Sections data ─────────────────────────────────────────────────────────────

const SECTIONS: Section[] = [
    {
        title: 'IPTables / IPSet / NFTables vides',
        color: '#58a6ff', border: 'rgba(88,166,255,.25)', bg: 'rgba(88,166,255,.05)',
        blocks: [
            { type: 'text', v: 'Ces onglets nécessitent NET_ADMIN dans docker-compose.yml :' },
            { type: 'yaml', v: 'cap_add:\n  - NET_ADMIN' },
        ],
    },
    {
        title: 'Socket inaccessible',
        color: '#e86a65', border: 'rgba(232,106,101,.25)', bg: 'rgba(232,106,101,.05)',
        blocks: [
            { type: 'text', v: 'Le socket fail2ban doit être chmod 660 sur le host. Créez le drop-in systemd :' },
            { type: 'shell', v: `mkdir -p /etc/systemd/system/fail2ban.service.d/
echo "[Service]\\nExecStartPost=-/usr/bin/chmod 660 /var/run/fail2ban/fail2ban.sock" \\
  > /etc/systemd/system/fail2ban.service.d/docker-access.conf
systemctl daemon-reload && systemctl restart fail2ban` },
        ],
    },
    {
        title: 'SQLite non lisible',
        color: '#bc8cff', border: 'rgba(188,140,255,.25)', bg: 'rgba(188,140,255,.05)',
        blocks: [
            { type: 'text', v: 'La DB fail2ban est montée en lecture seule via /host/ dans Docker. Si indisponible, corrigez les permissions sur le host :' },
            { type: 'shell', v: 'chmod o+r /var/lib/fail2ban/fail2ban.sqlite3' },
            { type: 'text', v: 'Et vérifiez que le volume est bien monté dans docker-compose.yml :' },
            { type: 'yaml', v: 'volumes:\n  - /var/lib/fail2ban:/host/var/lib/fail2ban:ro' },
        ],
    },
    {
        title: 'Config jail manquante (filter/port/bantime…)',
        color: '#3fb950', border: 'rgba(63,185,80,.25)', bg: 'rgba(63,185,80,.05)',
        blocks: [
            { type: 'text', v: 'Ces métadonnées sont lues depuis /etc/fail2ban/jail.conf + jail.d/. En Docker, montez le volume en lecture seule :' },
            { type: 'yaml', v: 'volumes:\n  - /etc/fail2ban:/host/etc/fail2ban:ro' },
            { type: 'text', v: 'Si les badges filter/port restent vides, vérifiez que le volume est bien monté et que les fichiers sont lisibles.' },
        ],
    },
    {
        title: 'Comprendre les compteurs — Bans actifs vs Tracker vs Total cumulé',
        color: '#bc8cff', border: 'rgba(188,140,255,.25)', bg: 'rgba(188,140,255,.05)',
        blocks: [
            { type: 'text', v: 'Le dashboard affiche plusieurs compteurs qui mesurent des choses différentes. Ils ne sont pas censés être identiques.' },
            { type: 'text', v: '🔴 Bans actifs (header) — IPs actuellement en jail dont le ban n\'a pas encore expiré. Source : fail2ban socket en temps réel. Ce chiffre diminue quand un ban expire.' },
            { type: 'text', v: '🟠 Tracker IPs (badge nav) — Nombre d\'IPs uniques ayant eu au moins un ban depuis le début de l\'historique interne (f2b_events). Inclut les bans expirés. Ce chiffre ne fait que croître.' },
            { type: 'text', v: '🟣 Total bans cumulé (header) — Somme brute de tous les événements ban enregistrés par fail2ban depuis son installation. Une même IP peut être comptée plusieurs fois si elle a été bannie, débannie, puis rebannie.' },
            { type: 'text', v: 'Exemple concret :' },
            { type: 'conf', v: `# Une IP bannie 3 fois sur 6 mois, ban actuel expiré :
Bans actifs      = 0   (ban expiré → plus en jail)
Tracker IPs      = 1   (l'IP existe dans l'historique)
Total cumulé     = 3   (3 événements ban enregistrés)` },
            { type: 'text', v: 'L\'historique interne (f2b_events) est conservé indéfiniment dans dashboard.db — même si fail2ban purge sa propre DB selon dbpurgeage (par défaut 24h ou 7j).' },
        ],
    },
    {
        title: 'fail2ban.local vs jail.local — à quoi ça sert ?',
        color: '#39c5cf', border: 'rgba(57,197,207,.25)', bg: 'rgba(57,197,207,.05)',
        blocks: [
            { type: 'text', v: 'fail2ban.local configure le démon (le processus global) : loglevel, logtarget, dbfile, dbpurgeage, dbmaxmatches.' },
            { type: 'text', v: 'jail.local configure les jails (règles de détection et de ban) : enabled, bantime, findtime, maxretry, filter, action, logpath.' },
            { type: 'text', v: 'Règle .conf vs .local : les .conf sont fournis par le package (ne jamais les éditer). Les .local sont vos overrides — ne mettre que ce que vous voulez changer.' },
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
            { type: 'text', v: "Si fail2ban.local est absent → c'est normal, tout vient des défauts de fail2ban.conf." },
        ],
    },
];

// ── Component ─────────────────────────────────────────────────────────────────

export const TabAide: React.FC = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem', maxWidth: 760 }}>
        {SECTIONS.map(s => (
            <div key={s.title} style={{ borderRadius: 8, border: `1px solid ${s.border}`, background: s.bg, overflow: 'hidden' }}>
                <div style={{ padding: '.6rem 1rem', borderBottom: `1px solid ${s.border}`, display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <HelpCircle style={{ width: 13, height: 13, color: s.color, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: '.88rem', color: s.color }}>{s.title}</span>
                </div>
                <div style={{ padding: '.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                    {s.blocks.map((b, i) =>
                        b.type === 'text'
                            ? <p key={i} style={{ margin: 0, fontSize: '.8rem', color: '#8b949e', lineHeight: 1.6 }}>{b.v}</p>
                            : <CodeBlock key={i} type={b.type} code={b.v} />
                    )}
                </div>
            </div>
        ))}
    </div>
);
