import React from 'react';
import { HelpCircle } from 'lucide-react';

const SECTIONS = [
    {
        title: 'Données vides / fail2ban indisponible',
        color: '#e3b341', border: 'rgba(227,179,65,.25)', bg: 'rgba(227,179,65,.05)',
        content: 'Vérifiez dans Paramètres → Plugins → Fail2ban → Diagnostic que le socket, le client et la DB sont OK.\nEn dev (npm run dev) : fail2ban-client doit être installé sur votre machine.\nEn Docker : rebuild le container après avoir ajouté fail2ban dans le Dockerfile.',
    },
    {
        title: 'IPTables / IPSet / NFTables vides',
        color: '#58a6ff', border: 'rgba(88,166,255,.25)', bg: 'rgba(88,166,255,.05)',
        content: 'Ces onglets nécessitent NET_ADMIN dans docker-compose.yml :\n\n  cap_add:\n    - NET_ADMIN\n\nEt les binaires dans le Dockerfile :\n  RUN apk add --no-cache iptables ipset nftables',
    },
    {
        title: 'Socket inaccessible',
        color: '#e86a65', border: 'rgba(232,106,101,.25)', bg: 'rgba(232,106,101,.05)',
        content: 'Le socket fail2ban doit être chmod 660 sur le host.\nCréez le drop-in systemd :\n\n  mkdir -p /etc/systemd/system/fail2ban.service.d/\n  echo "[Service]\\nExecStartPost=-/usr/bin/chmod 660 /var/run/fail2ban/fail2ban.sock" \\\n    > /etc/systemd/system/fail2ban.service.d/docker-access.conf\n  systemctl daemon-reload && systemctl restart fail2ban',
    },
    {
        title: 'SQLite non lisible',
        color: '#bc8cff', border: 'rgba(188,140,255,.25)', bg: 'rgba(188,140,255,.05)',
        content: 'La DB fail2ban est à /var/lib/fail2ban/fail2ban.sqlite3.\nElle est lue via /host/ (monté en ro dans Docker).\nSi indisponible : chmod o+r /var/lib/fail2ban/fail2ban.sqlite3 sur le host.',
    },
    {
        title: 'Config jail manquante (filter/port/bantime…)',
        color: '#3fb950', border: 'rgba(63,185,80,.25)', bg: 'rgba(63,185,80,.05)',
        content: 'Ces métadonnées sont lues depuis /etc/fail2ban/jail.conf + jail.d/.\nEn Docker : montez le volume en lecture seule :\n  - /etc/fail2ban:/host/etc/fail2ban:ro\nSi les badges filter/port restent vides, vérifiez que le volume est bien monté.',
    },
];

export const TabAide: React.FC = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem', maxWidth: 720 }}>
        {SECTIONS.map(s => (
            <div key={s.title} style={{ borderRadius: 8, border: `1px solid ${s.border}`, background: s.bg, overflow: 'hidden' }}>
                <div style={{ padding: '.6rem 1rem', borderBottom: `1px solid ${s.border}`, display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <HelpCircle style={{ width: 13, height: 13, color: s.color, flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, fontSize: '.88rem', color: s.color }}>{s.title}</span>
                </div>
                <pre style={{ padding: '.85rem 1rem', fontSize: '.78rem', color: '#8b949e', fontFamily: 'monospace', lineHeight: 1.65, whiteSpace: 'pre-wrap', margin: 0 }}>{s.content}</pre>
            </div>
        ))}
    </div>
);
