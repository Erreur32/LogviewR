# Parser Help Guide - LogviewR

> 🇫🇷 [Lire en français](./PARSERS_HELP.fr.md)

This document describes the supported log formats and the regexes used by each parser.

---

## 📋 Table of contents

1. [NPM (Nginx Proxy Manager)](#npm-nginx-proxy-manager)
2. [Apache](#apache)
3. [Nginx](#nginx)
4. [Host System (Syslog)](#host-system-syslog)

---

## 🔷 NPM (Nginx Proxy Manager)

**File**: `server/plugins/npm/NpmParser.ts`
**Detailed documentation**: [NPM_PARSER_HELP.md](./npm/NPM_PARSER_HELP.md)

### Supported formats

1. **Standard NPM format with cache**: `[time] cache upstream status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] [Sent-to server] "UA" "Referer"`
2. **Standard NPM format without cache**: `[time] status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] "UA" "Referer"`
3. **Custom combined format**: `IP - host [time] "request" status bytes "Referer" "UA"`

See [NPM_PARSER_HELP.md](./npm/NPM_PARSER_HELP.md) for the detailed regexes.

---

## 🔷 Apache

**File**: `server/plugins/apache/ApacheParser.ts`

### Supported formats

#### 1. VHost Combined
**Format**: `vhost:port IP - user [timestamp] "method path protocol" status size "referer" "user-agent"`

**Example**:
```
example.com:443 192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0"
```

**Regex**:
```regex
^([^:]+):(\d+)\s+(?:[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|[0-9a-fA-F:]+(?:::[0-9a-fA-F:]*)?)\s+-\s+-\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+([^"]+)"\s+(\d+)\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"
```

#### 2. VHost Common
**Format**: `vhost:port IP - user [timestamp] "method path protocol" status size`

**Example**:
```
example.com:80 192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234
```

#### 3. VHost Simple
**Format**: `vhost IP - user [timestamp] "method path protocol" status size`

**Example**:
```
example.com 192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234
```

#### 4. Combined (standard)
**Format**: `IP - user [timestamp] "method path protocol" status size "referer" "user-agent"`

**Example**:
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234 "-" "Mozilla/5.0"
```

**Regex**:
```regex
^(?:[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|[0-9a-fA-F:]+(?:::[0-9a-fA-F:]*)?)\s+-\s+-\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+([^"]+)"\s+(\d+)\s+(\S+)\s+"([^"]*)"\s+"([^"]*)"
```

#### 5. Common (standard)
**Format**: `IP - user [timestamp] "method path protocol" status size`

**Example**:
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234
```

### Functions

- `parseAccessLine(line: string): ParsedLogEntry | null` - Parses access logs
- `parseErrorLine(line: string): ParsedLogEntry | null` - Parses error logs

### Features

- ✅ IPv6 support
- ✅ Virtual Host (vhost) support
- ✅ Improved timezone parsing
- ✅ Automatic format detection

---

## 🔷 Nginx

**File**: `server/plugins/nginx/NginxParser.ts`
**Detailed documentation**: [NGINX_PARSER_HELP.md](./nginx/NGINX_PARSER_HELP.md)

### Supported formats

1. **Combined format**: `IP - user [timestamp] "request" status bytes "referer" "user-agent"`
2. **Common format**: `IP - user [timestamp] "request" status bytes`
3. **Extended format**: `IP - user [timestamp] "request" status bytes "referer" "user-agent" "upstream"`

See [NGINX_PARSER_HELP.md](./nginx/NGINX_PARSER_HELP.md) for the detailed regexes, FAIL2BAN, GROK, and GoAccess formats.

### Functions

- `parseAccessLine(line: string): ParsedLogEntry | null` - Parses access logs
- `parseErrorLine(line: string): ParsedLogEntry | null` - Parses error logs

---

## 🔷 Host System (Syslog)

**File**: `server/plugins/host-system/SyslogParser.ts`

### Supported formats

#### ISO 8601 (Debian 12, systemd)
**Format**: `timestamp hostname tag[pid]: message`

**Example**:
```
2025-12-28T00:00:02.098394+01:00 Home32-Cloud CRON[2175971]: (root) CMD (command)
```

**Regex**:
```regex
^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s+(\S+)\s+(\S+)(?:\[(\d+)\])?:\s*(.*)$
```

#### Syslog with priority (RFC 3164)
**Format**: `<priority>timestamp hostname tag[pid]: message`

**Example**:
```
<30>Jan 1 12:00:00 hostname app[1234]: message
```

#### Syslog without priority
**Format**: `timestamp hostname tag[pid]: message`

**Example**:
```
Jan 1 12:00:00 hostname app[1234]: message
```

### Specialized parsers

- **SyslogParser**: General syslog logs
- **AuthLogParser**: Authentication logs (`/var/log/auth.log`)
- **KernLogParser**: Kernel logs (`/var/log/kern.log`)
- **DaemonLogParser**: Daemon logs (`/var/log/daemon.log`)
- **MailLogParser**: Mail logs (`/var/log/mail.log`)

### Functions

- `parseSyslogLine(line: string): ParsedLogEntry | null` - Parses syslog logs
- Uses Grok patterns for robust parsing

### Features

- ✅ ISO 8601 support
- ✅ RFC 3164 / RFC 5424 support
- ✅ Grok patterns
- ✅ Automatic log level extraction

---

## 📝 General notes

- All parsers handle empty or invalid lines by returning `null`
- Timestamps are converted to JavaScript `Date` objects
- Optional fields may be `-` or empty
- Regexes support IPv4 and IPv6 (depending on the parser)
- Detection order matters: the most specific formats are tested first

---

## 🔗 References

- [Grok Patterns Documentation](./host-system/GROK_PATTERNS.md)
- [NPM Parser Help](./npm/NPM_PARSER_HELP.md)
- [Apache Improvements](../.cursor/plans/02-backend/apache_ameliorations.md)
