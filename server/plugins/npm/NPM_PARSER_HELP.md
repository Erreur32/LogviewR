# NPM (Nginx Proxy Manager) Parser - Help Guide

> 🇫🇷 [Lire en français](./NPM_PARSER_HELP.fr.md)

## Overview

The NPM parser supports several Nginx Proxy Manager log formats with automatic detection.

## Supported formats

### 1️⃣ Standard NPM format (with cache and upstream)

**Real format**:
```
[time] cache upstream status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] [Sent-to server] "UA" "Referer"
```

**Example**:
```
[01/Jan/2024:12:00:00 +0000] HIT 200 200 - GET https example.com "/api/test" [Client 192.168.1.1] [Length 1234] [Gzip 75%] [Sent-to 10.0.0.1:8080] "Mozilla/5.0" "https://example.com"
```

**fail2ban / grok / regex compatible regex**:
```regex
^\[(?<time>[^\]]+)\]\s+(?<cache>\S+)\s+(?<upstream_status>\S+)\s+(?<status>\d+)\s+-\s+(?<method>\S+)\s+(?<scheme>\S+)\s+(?<host>\S+)\s+"(?<uri>[^"]+)"\s+\[Client\s+(?<ip>[\d\.]+)\]\s+\[Length\s+(?<bytes>\d+)\]\s+\[Gzip\s+(?<gzip>[^\]]+)\]\s+\[Sent-to\s+(?<server>[^\]]+)\]\s+"(?<ua>[^"]*)"\s+"(?<ref>[^"]*)"
```

**Extracted fields**:
- `time`: Timestamp
- `cache`: Cache status (HIT, MISS, BYPASS, etc.)
- `upstream_status`: Upstream status
- `status`: HTTP code
- `method`: HTTP method (GET, POST, etc.)
- `scheme`: Scheme (http, https)
- `host`: Hostname
- `uri`: Request URI
- `ip`: Client IP
- `bytes`: Response size
- `gzip`: Gzip compression ratio
- `server`: Upstream server
- `ua`: User-Agent
- `ref`: Referer

---

### 2️⃣ Standard NPM format (without cache)

**Real format**:
```
[time] status - METHOD scheme host "uri" [Client ip] [Length bytes] [Gzip ratio] "UA" "Referer"
```

**Example**:
```
[01/Jan/2024:12:00:00 +0000] 200 - GET https example.com "/api/test" [Client 192.168.1.1] [Length 1234] [Gzip 75%] "Mozilla/5.0" "https://example.com"
```

**Regex**:
```regex
^\[(?<time>[^\]]+)\]\s+(?<status>\d+)\s+-\s+(?<method>\S+)\s+(?<scheme>\S+)\s+(?<host>\S+)\s+"(?<uri>[^"]+)"\s+\[Client\s+(?<ip>[\d\.]+)\]\s+\[Length\s+(?<bytes>\d+)\]\s+\[Gzip\s+(?<gzip>[^\]]+)\]\s+"(?<ua>[^"]*)"\s+"(?<ref>[^"]*)"
```

**Extracted fields**:
- `time`: Timestamp
- `status`: HTTP code
- `method`: HTTP method
- `scheme`: Scheme
- `host`: Hostname
- `uri`: URI
- `ip`: Client IP
- `bytes`: Size
- `gzip`: Gzip ratio
- `ua`: User-Agent
- `ref`: Referer

---

### 3️⃣ Custom format (combined type)

**Real format**:
```
IP - host [time] "request" status bytes "Referer" "UA"
```

**Example**:
```
192.168.1.1 - example.com [01/Jan/2024:12:00:00 +0000] "GET /api/test HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0"
```

**Regex (simple & universal)**:
```regex
^(?<ip>[\d\.]+)\s+-\s+(?<host>\S+)\s+\[(?<time>[^\]]+)\]\s+"(?<request>[^"]+)"\s+(?<status>\d+)\s+(?<bytes>\d+)\s+"(?<ref>[^"]*)"\s+"(?<ua>[^"]*)"
```

**Extracted fields**:
- `ip`: Client IP
- `host`: Hostname
- `time`: Timestamp
- `request`: Full request (method + URI + protocol)
- `status`: HTTP code
- `bytes`: Size
- `ref`: Referer
- `ua`: User-Agent

---

## Parser functions

### `parseAccessLine(line: string): ParsedLogEntry | null`

Parses an NPM access log line.

**Parameters**:
- `line`: The log line to parse

**Returns**:
- `ParsedLogEntry | null`: Parsed entry, or `null` if the line doesn't match any format

**Usage example**:
```typescript
const entry = NpmParser.parseAccessLine('[01/Jan/2024:12:00:00 +0000] 200 - GET https example.com "/api/test" [Client 192.168.1.1] [Length 1234] [Gzip 75%] "Mozilla/5.0" "https://example.com"');
```

### `parseErrorLine(line: string): ParsedLogEntry | null`

Parses an NPM error log line (standard Nginx format).

**Parameters**:
- `line`: The error log line to parse

**Returns**:
- `ParsedLogEntry | null`: Parsed entry, or `null` if the line doesn't match any format

---

## Detection order

The parser tries formats in this order:
1. Standard NPM format with cache (format 1)
2. Standard NPM format without cache (format 2)
3. Custom combined format (format 3)
4. Standard Nginx format (fallback)

The first matching format is used.

---

## Important notes

- Optional fields may be `-` or empty
- The parser automatically handles multiple spaces
- Timestamps are parsed with timezone support
- IPs can be IPv4 or IPv6 (in some formats)
