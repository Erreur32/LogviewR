# NGINX Parser - Guide d'aide

> 🇬🇧 [Read in English](./NGINX_PARSER_HELP.md)

## Vue d'ensemble

Le parser NGINX supporte les formats de logs NGINX standards avec détection automatique.

---

## 📋 Formats de logs NGINX standards

### 1️⃣ Format `combined` (par défaut)

**Définition NGINX** :
```nginx
log_format combined
'$remote_addr - $remote_user [$time_local] '
'"$request" $status $body_bytes_sent '
'"$http_referer" "$http_user_agent"';
```

**Format réel** :
```
IP - user [timestamp] "request" status bytes "referer" "user-agent"
```

**Exemple** :
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0"
```

**Regex exacte (compatible fail2ban / grok / regex)** :
```regex
^(?<ip>\S+)\s+-\s+(?<user>\S+)\s+\[(?<time>[^\]]+)\]\s+"(?<request>[^"]+)"\s+(?<status>\d{3})\s+(?<bytes>\d+)\s+"(?<referer>[^"]*)"\s+"(?<agent>[^"]*)"
```

**Champs extraits** :
- `ip` : Adresse IP du client (`$remote_addr`)
- `user` : Utilisateur distant (`$remote_user`, souvent `-`)
- `time` : Timestamp (`$time_local`)
- `request` : Requête complète (`$request` : méthode + URI + protocole)
- `status` : Code de statut HTTP (`$status`)
- `bytes` : Taille de la réponse (`$body_bytes_sent`)
- `referer` : Referer HTTP (`$http_referer`)
- `agent` : User-Agent (`$http_user_agent`)

---

### 2️⃣ Format `common`

**Définition NGINX** :
```nginx
log_format common
'$remote_addr - $remote_user [$time_local] '
'"$request" $status $body_bytes_sent';
```

**Format réel** :
```
IP - user [timestamp] "request" status bytes
```

**Exemple** :
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234
```

**Regex exacte** :
```regex
^(?<ip>\S+)\s+-\s+(?<user>\S+)\s+\[(?<time>[^\]]+)\]\s+"(?<request>[^"]+)"\s+(?<status>\d{3})\s+(?<bytes>\d+)
```

**Champs extraits** :
- `ip` : Adresse IP du client
- `user` : Utilisateur distant (souvent `-`)
- `time` : Timestamp
- `request` : Requête complète
- `status` : Code de statut HTTP
- `bytes` : Taille de la réponse

---

### 3️⃣ Format `main`

➡️ Généralement **alias de `combined`**

**Format réel** :
```
IP - user [timestamp] "request" status bytes "referer" "user-agent"
```

**Regex** :
```regex
^(?<ip>\S+)\s+-\s+(?<user>\S+)\s+\[(?<time>[^\]]+)\]\s+"(?<request>[^"]+)"\s+(?<status>\d{3})\s+(?<bytes>\d+)\s+"(?<referer>[^"]*)"\s+"(?<agent>[^"]*)"
```

---

### 4️⃣ Format avec `upstream` (extended)

**Format réel** :
```
IP - user [timestamp] "request" status bytes "referer" "user-agent" "upstream"
```

**Exemple** :
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0" "http://backend:8080"
```

**Regex** :
```regex
^(?<ip>\S+)\s+-\s+(?<user>\S+)\s+\[(?<time>[^\]]+)\]\s+"(?<request>[^"]+)"\s+(?<status>\d{3})\s+(?<bytes>\d+)\s+"(?<referer>[^"]*)"\s+"(?<agent>[^"]*)"\s+"(?<upstream>[^"]*)"
```

---

## 🔍 Formats Error Log

### Format standard

**Format réel** :
```
timestamp [level] message
```

**Exemple** :
```
2024/01/01 12:00:00 [error] connect() failed (111: Connection refused)
```

**Regex** :
```regex
^(?<time>\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(?<level>\w+)\]\s+(?<message>.+)$
```

### Format avec PID/TID

**Format réel** :
```
timestamp [level] pid#tid: message
```

**Exemple** :
```
2024/01/01 12:00:00 [error] 123#456: connect() failed (111: Connection refused)
```

**Regex** :
```regex
^(?<time>\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(?<level>\w+)\]\s+(?<pid>\d+)#(?<tid>\d+):\s+(?<message>.+)$
```

---

## 🛠️ Regex FAIL2BAN (optimisée)

### Pour bloquer les erreurs HTTP

```regex
^<HOST> - .* \[.*\] ".*" (401|403|404|444|500) .*
```

### Pour bloquer les tentatives d'injection SQL

```regex
^<HOST> - .* \[.*\] ".*" .* ".*" ".*(union|select|insert|delete|update|drop|exec|script).*"
```

---

## 📊 GROK (ELK / Logstash)

### Pattern GROK pour format combined

```grok
%{IPORHOST:clientip} - %{DATA:user} \[%{HTTPDATE:timestamp}\] "%{DATA:request}" %{INT:status} %{INT:bytes} "%{DATA:referrer}" "%{DATA:agent}"
```

### Pattern GROK pour format common

```grok
%{IPORHOST:clientip} - %{DATA:user} \[%{HTTPDATE:timestamp}\] "%{DATA:request}" %{INT:status} %{INT:bytes}
```

---

## 🔧 GoAccess

### Format combined

```bash
goaccess access.log --log-format=COMBINED
```

### Format common

```bash
goaccess access.log --log-format=COMMON
```

---

## 📝 Fonctions du parser

### `parseAccessLine(line: string): ParsedLogEntry | null`

Parse une ligne de log d'accès NGINX.

**Paramètres** :
- `line` : Ligne de log à parser

**Retour** :
- `ParsedLogEntry | null` : Entrée parsée ou `null` si la ligne ne correspond à aucun format

**Exemple d'utilisation** :
```typescript
const entry = NginxParser.parseAccessLine('192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0"');
```

**Champs retournés** :
- `timestamp` : Date parsée
- `ip` : Adresse IP du client
- `method` : Méthode HTTP (extrait de `request`)
- `url` : URI de la requête (extrait de `request`)
- `protocol` : Protocole HTTP (extrait de `request`)
- `status` : Code de statut HTTP
- `size` : Taille de la réponse en bytes
- `referer` : Referer HTTP
- `userAgent` : User-Agent
- `upstream` : Serveur upstream (si présent)
- `level` : Niveau de log dérivé du code de statut

### `parseErrorLine(line: string): ParsedLogEntry | null`

Parse une ligne de log d'erreur NGINX.

**Paramètres** :
- `line` : Ligne de log d'erreur à parser

**Retour** :
- `ParsedLogEntry | null` : Entrée parsée ou `null` si la ligne ne correspond à aucun format

**Champs retournés** :
- `timestamp` : Date parsée
- `level` : Niveau de log (error, warn, info, etc.)
- `message` : Message d'erreur
- `pid` : Process ID (si présent)
- `tid` : Thread ID (si présent)

---

## 🔄 Ordre de détection

Le parser tente les formats dans cet ordre :
1. Format avec upstream (extended)
2. Format combined (standard)
3. Format common (simplifié)

Le premier format qui correspond est utilisé.

---

## ✅ Notes importantes

- ✅ Compatible IPv4 (IPv6 supporté via regex améliorée)
- ✅ Regex testées avec logs NGINX réels
- ✅ Support des timestamps avec timezone (`+0000`, `-0500`)
- ✅ Parsing automatique de la requête (`method`, `url`, `protocol`)
- ✅ Gestion des champs optionnels (`-` ou vides)
- ✅ Extraction automatique du niveau de log depuis le code de statut HTTP

---

## 📌 Exemples de logs réels

### Format combined
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET /api/users HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
```

### Format common
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET /api/users HTTP/1.1" 200 1234
```

### Format avec upstream
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET /api/users HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0" "http://backend:8080"
```

### Error log
```
2024/01/01 12:00:00 [error] 123#456: connect() failed (111: Connection refused) while connecting to upstream, client: 192.168.1.1, server: example.com, request: "GET /api/users HTTP/1.1", upstream: "http://127.0.0.1:8080/api/users", host: "example.com"
```

---

## 🔗 Références

- [Documentation NGINX - log_format](http://nginx.org/en/docs/http/ngx_http_log_module.html#log_format)
- [Guide général des parsers](../PARSERS_HELP.fr.md)
