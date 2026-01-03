# Guide d'aide - Parsers LogviewR

Ce document décrit les formats de logs supportés et les regex utilisées pour chaque parser.

---

## 📋 Table des matières

1. [NPM (Nginx Proxy Manager)](#npm-nginx-proxy-manager)
2. [Apache](#apache)
3. [Nginx](#nginx)
4. [Host System (Syslog)](#host-system-syslog)

---

## 🔷 NPM (Nginx Proxy Manager)

**Fichier** : `server/plugins/npm/NpmParser.ts`  
**Documentation détaillée** : [NPM_PARSER_HELP.md](./npm/NPM_PARSER_HELP.md)

### Formats supportés

1. **Format NPM standard avec cache** : `[time] cache upstream status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] [Sent-to server] "UA" "Referer"`
2. **Format NPM standard sans cache** : `[time] status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] "UA" "Referer"`
3. **Format custom combined** : `IP - host [time] "request" status bytes "Referer" "UA"`

Voir [NPM_PARSER_HELP.md](./npm/NPM_PARSER_HELP.md) pour les regex détaillées.

---

## 🔷 Apache

**Fichier** : `server/plugins/apache/ApacheParser.ts`

### Formats supportés

#### 1. VHost Combined
**Format** : `vhost:port IP - user [timestamp] "method path protocol" status size "referer" "user-agent"`

**Exemple** :
```
example.com:443 192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0"
```

**Regex** :
```regex
^([^:]+):(\d+)\s+(?:[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|[0-9a-fA-F:]+(?:::[0-9a-fA-F:]*)?)\s+-\s+-\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+([^"]+)"\s+(\d+)\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"
```

#### 2. VHost Common
**Format** : `vhost:port IP - user [timestamp] "method path protocol" status size`

**Exemple** :
```
example.com:80 192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234
```

#### 3. VHost Simple
**Format** : `vhost IP - user [timestamp] "method path protocol" status size`

**Exemple** :
```
example.com 192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234
```

#### 4. Combined (standard)
**Format** : `IP - user [timestamp] "method path protocol" status size "referer" "user-agent"`

**Exemple** :
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0"
```

**Regex** :
```regex
^(?:[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|[0-9a-fA-F:]+(?:::[0-9a-fA-F:]*)?)\s+-\s+-\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+([^"]+)"\s+(\d+)\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"
```

#### 5. Common (standard)
**Format** : `IP - user [timestamp] "method path protocol" status size`

**Exemple** :
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234
```

### Fonctions

- `parseAccessLine(line: string): ParsedLogEntry | null` - Parse les logs d'accès
- `parseErrorLine(line: string): ParsedLogEntry | null` - Parse les logs d'erreur

### Caractéristiques

- ✅ Support IPv6
- ✅ Support Virtual Host (vhost)
- ✅ Parsing timezone amélioré
- ✅ Détection automatique du format

---

## 🔷 Nginx

**Fichier** : `server/plugins/nginx/NginxParser.ts`  
**Documentation détaillée** : [NGINX_PARSER_HELP.md](./nginx/NGINX_PARSER_HELP.md)

### Formats supportés

1. **Format combined** : `IP - user [timestamp] "request" status bytes "referer" "user-agent"`
2. **Format common** : `IP - user [timestamp] "request" status bytes`
3. **Format extended** : `IP - user [timestamp] "request" status bytes "referer" "user-agent" "upstream"`

Voir [NGINX_PARSER_HELP.md](./nginx/NGINX_PARSER_HELP.md) pour les regex détaillées, formats FAIL2BAN, GROK, et GoAccess.

### Fonctions

- `parseAccessLine(line: string): ParsedLogEntry | null` - Parse les logs d'accès
- `parseErrorLine(line: string): ParsedLogEntry | null` - Parse les logs d'erreur

---

## 🔷 Host System (Syslog)

**Fichier** : `server/plugins/host-system/SyslogParser.ts`

### Formats supportés

#### ISO 8601 (Debian 12, systemd)
**Format** : `timestamp hostname tag[pid]: message`

**Exemple** :
```
2025-12-28T00:00:02.098394+01:00 Home32-Cloud CRON[2175971]: (root) CMD (command)
```

**Regex** :
```regex
^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s+(\S+)\s+(\S+)(?:\[(\d+)\])?:\s*(.*)$
```

#### Syslog avec priorité (RFC 3164)
**Format** : `<priority>timestamp hostname tag[pid]: message`

**Exemple** :
```
<30>Jan 1 12:00:00 hostname app[1234]: message
```

#### Syslog sans priorité
**Format** : `timestamp hostname tag[pid]: message`

**Exemple** :
```
Jan 1 12:00:00 hostname app[1234]: message
```

### Parsers spécialisés

- **SyslogParser** : Logs syslog généraux
- **AuthLogParser** : Logs d'authentification (`/var/log/auth.log`)
- **KernLogParser** : Logs kernel (`/var/log/kern.log`)
- **DaemonLogParser** : Logs daemon (`/var/log/daemon.log`)
- **MailLogParser** : Logs mail (`/var/log/mail.log`)

### Fonctions

- `parseSyslogLine(line: string): ParsedLogEntry | null` - Parse les logs syslog
- Utilise des patterns Grok pour un parsing robuste

### Caractéristiques

- ✅ Support ISO 8601
- ✅ Support RFC 3164 / RFC 5424
- ✅ Patterns Grok
- ✅ Extraction automatique du niveau de log

---

## 📝 Notes générales

- Tous les parsers gèrent les lignes vides ou invalides en retournant `null`
- Les timestamps sont convertis en objets `Date` JavaScript
- Les champs optionnels peuvent être `-` ou vides
- Les regex supportent IPv4 et IPv6 (selon le parser)
- L'ordre de détection est important : les formats les plus spécifiques sont testés en premier

---

## 🔗 Références

- [Documentation Grok Patterns](./host-system/GROK_PATTERNS.md)
- [NPM Parser Help](./npm/NPM_PARSER_HELP.md)
- [Apache Améliorations](../.cursor/plans/02-backend/apache_ameliorations.md)
