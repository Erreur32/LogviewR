# NPM (Nginx Proxy Manager) Parser - Guide d'aide

## Vue d'ensemble

Le parser NPM supporte plusieurs formats de logs Nginx Proxy Manager avec détection automatique.

## Formats supportés

### 1️⃣ Format NPM standard (avec cache et upstream)

**Format réel** :
```
[time] cache upstream status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] [Sent-to server] "UA" "Referer"
```

**Exemple** :
```
[01/Jan/2024:12:00:00 +0000] HIT 200 200 - GET https example.com "/api/test" [Client 192.168.1.1] [Length 1234] [Gzip 75%] [Sent-to 10.0.0.1:8080] "Mozilla/5.0" "https://example.com"
```

**Regex compatible fail2ban / grok / regex** :
```regex
^\[(?<time>[^\]]+)\]\s+(?<cache>\S+)\s+(?<upstream_status>\S+)\s+(?<status>\d+)\s+-\s+(?<method>\S+)\s+(?<scheme>\S+)\s+(?<host>\S+)\s+"(?<uri>[^"]+)"\s+\[Client\s+(?<ip>[\d\.]+)\]\s+\[Length\s+(?<bytes>\d+)\]\s+\[Gzip\s+(?<gzip>[^\]]+)\]\s+\[Sent-to\s+(?<server>[^\]]+)\]\s+"(?<ua>[^"]*)"\s+"(?<ref>[^"]*)"
```

**Champs extraits** :
- `time` : Timestamp
- `cache` : Statut cache (HIT, MISS, BYPASS, etc.)
- `upstream_status` : Statut upstream
- `status` : Code HTTP
- `method` : Méthode HTTP (GET, POST, etc.)
- `scheme` : Schéma (http, https)
- `host` : Hostname
- `uri` : URI de la requête
- `ip` : IP du client
- `bytes` : Taille de la réponse
- `gzip` : Ratio de compression Gzip
- `server` : Serveur upstream
- `ua` : User-Agent
- `ref` : Referer

---

### 2️⃣ Format NPM standard (sans cache)

**Format réel** :
```
[time] status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] "UA" "Referer"
```

**Exemple** :
```
[01/Jan/2024:12:00:00 +0000] 200 - GET https example.com "/api/test" [Client 192.168.1.1] [Length 1234] [Gzip 75%] "Mozilla/5.0" "https://example.com"
```

**Regex** :
```regex
^\[(?<time>[^\]]+)\]\s+(?<status>\d+)\s+-\s+(?<method>\S+)\s+(?<scheme>\S+)\s+(?<host>\S+)\s+"(?<uri>[^"]+)"\s+\[Client\s+(?<ip>[\d\.]+)\]\s+\[Length\s+(?<bytes>\d+)\]\s+\[Gzip\s+(?<gzip>[^\]]+)\]\s+"(?<ua>[^"]*)"\s+"(?<ref>[^"]*)"
```

**Champs extraits** :
- `time` : Timestamp
- `status` : Code HTTP
- `method` : Méthode HTTP
- `scheme` : Schéma
- `host` : Hostname
- `uri` : URI
- `ip` : IP du client
- `bytes` : Taille
- `gzip` : Ratio Gzip
- `ua` : User-Agent
- `ref` : Referer

---

### 3️⃣ Format custom (type combined)

**Format réel** :
```
IP - host [time] "request" status bytes "Referer" "UA"
```

**Exemple** :
```
192.168.1.1 - example.com [01/Jan/2024:12:00:00 +0000] "GET /api/test HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0"
```

**Regex (simple & universelle)** :
```regex
^(?<ip>[\d\.]+)\s+-\s+(?<host>\S+)\s+\[(?<time>[^\]]+)\]\s+"(?<request>[^"]+)"\s+(?<status>\d+)\s+(?<bytes>\d+)\s+"(?<ref>[^"]*)"\s+"(?<ua>[^"]*)"
```

**Champs extraits** :
- `ip` : IP du client
- `host` : Hostname
- `time` : Timestamp
- `request` : Requête complète (méthode + URI + protocole)
- `status` : Code HTTP
- `bytes` : Taille
- `ref` : Referer
- `ua` : User-Agent

---

## Fonctions du parser

### `parseAccessLine(line: string): ParsedLogEntry | null`

Parse une ligne de log d'accès NPM.

**Paramètres** :
- `line` : Ligne de log à parser

**Retour** :
- `ParsedLogEntry | null` : Entrée parsée ou `null` si la ligne ne correspond à aucun format

**Exemple d'utilisation** :
```typescript
const entry = NpmParser.parseAccessLine('[01/Jan/2024:12:00:00 +0000] 200 - GET https example.com "/api/test" [Client 192.168.1.1] [Length 1234] [Gzip 75%] "Mozilla/5.0" "https://example.com"');
```

### `parseErrorLine(line: string): ParsedLogEntry | null`

Parse une ligne de log d'erreur NPM (format Nginx standard).

**Paramètres** :
- `line` : Ligne de log d'erreur à parser

**Retour** :
- `ParsedLogEntry | null` : Entrée parsée ou `null` si la ligne ne correspond à aucun format

---

## Ordre de détection

Le parser tente les formats dans cet ordre :
1. Format NPM standard avec cache (format 1)
2. Format NPM standard sans cache (format 2)
3. Format custom combined (format 3)
4. Format Nginx standard (fallback)

Le premier format qui correspond est utilisé.

---

## Notes importantes

- Les champs optionnels peuvent être `-` ou vides
- Le parser gère automatiquement les espaces multiples
- Les timestamps sont parsés avec support timezone
- Les IPs peuvent être IPv4 ou IPv6 (dans certains formats)
