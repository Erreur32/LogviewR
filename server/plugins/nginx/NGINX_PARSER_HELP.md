# NGINX Parser - Help Guide

> 🇫🇷 [Lire en français](./NGINX_PARSER_HELP.fr.md)

## Overview

The NGINX parser supports standard NGINX log formats with automatic detection.

---

## 📋 Standard NGINX log formats

### 1️⃣ `combined` format (default)

**NGINX definition**:
```nginx
log_format combined
'$remote_addr - $remote_user [$time_local] '
'"$request" $status $body_bytes_sent '
'"$http_referer" "$http_user_agent"';
```

**Real format**:
```
IP - user [timestamp] "request" status bytes "referer" "user-agent"
```

**Example**:
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0"
```

**Exact regex (fail2ban / grok / regex compatible)**:
```regex
^(?<ip>\S+)\s+-\s+(?<user>\S+)\s+\[(?<time>[^\]]+)\]\s+"(?<request>[^"]+)"\s+(?<status>\d{3})\s+(?<bytes>\d+)\s+"(?<referer>[^"]*)"\s+"(?<agent>[^"]*)"
```

**Extracted fields**:
- `ip`: Client IP address (`$remote_addr`)
- `user`: Remote user (`$remote_user`, often `-`)
- `time`: Timestamp (`$time_local`)
- `request`: Full request (`$request`: method + URI + protocol)
- `status`: HTTP status code (`$status`)
- `bytes`: Response size (`$body_bytes_sent`)
- `referer`: HTTP Referer (`$http_referer`)
- `agent`: User-Agent (`$http_user_agent`)

---

### 2️⃣ `common` format

**NGINX definition**:
```nginx
log_format common
'$remote_addr - $remote_user [$time_local] '
'"$request" $status $body_bytes_sent';
```

**Real format**:
```
IP - user [timestamp] "request" status bytes
```

**Example**:
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234
```

**Exact regex**:
```regex
^(?<ip>\S+)\s+-\s+(?<user>\S+)\s+\[(?<time>[^\]]+)\]\s+"(?<request>[^"]+)"\s+(?<status>\d{3})\s+(?<bytes>\d+)
```

**Extracted fields**:
- `ip`: Client IP address
- `user`: Remote user (often `-`)
- `time`: Timestamp
- `request`: Full request
- `status`: HTTP status code
- `bytes`: Response size

---

### 3️⃣ `main` format

➡️ Usually an **alias for `combined`**

**Real format**:
```
IP - user [timestamp] "request" status bytes "referer" "user-agent"
```

**Regex**:
```regex
^(?<ip>\S+)\s+-\s+(?<user>\S+)\s+\[(?<time>[^\]]+)\]\s+"(?<request>[^"]+)"\s+(?<status>\d{3})\s+(?<bytes>\d+)\s+"(?<referer>[^"]*)"\s+"(?<agent>[^"]*)"
```

---

### 4️⃣ Format with `upstream` (extended)

**Real format**:
```
IP - user [timestamp] "request" status bytes "referer" "user-agent" "upstream"
```

**Example**:
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0" "http://backend:8080"
```

**Regex**:
```regex
^(?<ip>\S+)\s+-\s+(?<user>\S+)\s+\[(?<time>[^\]]+)\]\s+"(?<request>[^"]+)"\s+(?<status>\d{3})\s+(?<bytes>\d+)\s+"(?<referer>[^"]*)"\s+"(?<agent>[^"]*)"\s+"(?<upstream>[^"]*)"
```

---

## 🔍 Error Log formats

### Standard format

**Real format**:
```
timestamp [level] message
```

**Example**:
```
2024/01/01 12:00:00 [error] connect() failed (111: Connection refused)
```

**Regex**:
```regex
^(?<time>\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(?<level>\w+)\]\s+(?<message>.+)$
```

### Format with PID/TID

**Real format**:
```
timestamp [level] pid#tid: message
```

**Example**:
```
2024/01/01 12:00:00 [error] 123#456: connect() failed (111: Connection refused)
```

**Regex**:
```regex
^(?<time>\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2})\s+\[(?<level>\w+)\]\s+(?<pid>\d+)#(?<tid>\d+):\s+(?<message>.+)$
```

---

## 🛠️ FAIL2BAN regex (optimized)

### To block HTTP errors

```regex
^<HOST> - .* \[.*\] ".*" (401|403|404|444|500) .*
```

### To block SQL injection attempts

```regex
^<HOST> - .* \[.*\] ".*" .* ".*" ".*(union|select|insert|delete|update|drop|exec|script).*"
```

---

## 📊 GROK (ELK / Logstash)

### GROK pattern for combined format

```grok
%{IPORHOST:clientip} - %{DATA:user} \[%{HTTPDATE:timestamp}\] "%{DATA:request}" %{INT:status} %{INT:bytes} "%{DATA:referrer}" "%{DATA:agent}"
```

### GROK pattern for common format

```grok
%{IPORHOST:clientip} - %{DATA:user} \[%{HTTPDATE:timestamp}\] "%{DATA:request}" %{INT:status} %{INT:bytes}
```

---

## 🔧 GoAccess

### Combined format

```bash
goaccess access.log --log-format=COMBINED
```

### Common format

```bash
goaccess access.log --log-format=COMMON
```

---

## 📝 Parser functions

### `parseAccessLine(line: string): ParsedLogEntry | null`

Parses an NGINX access log line.

**Parameters**:
- `line`: The log line to parse

**Returns**:
- `ParsedLogEntry | null`: Parsed entry, or `null` if the line doesn't match any format

**Usage example**:
```typescript
const entry = NginxParser.parseAccessLine('192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET / HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0"');
```

**Returned fields**:
- `timestamp`: Parsed date
- `ip`: Client IP address
- `method`: HTTP method (extracted from `request`)
- `url`: Request URI (extracted from `request`)
- `protocol`: HTTP protocol (extracted from `request`)
- `status`: HTTP status code
- `size`: Response size in bytes
- `referer`: HTTP Referer
- `userAgent`: User-Agent
- `upstream`: Upstream server (if present)
- `level`: Log level derived from the status code

### `parseErrorLine(line: string): ParsedLogEntry | null`

Parses an NGINX error log line.

**Parameters**:
- `line`: The error log line to parse

**Returns**:
- `ParsedLogEntry | null`: Parsed entry, or `null` if the line doesn't match any format

**Returned fields**:
- `timestamp`: Parsed date
- `level`: Log level (error, warn, info, etc.)
- `message`: Error message
- `pid`: Process ID (if present)
- `tid`: Thread ID (if present)

---

## 🔄 Detection order

The parser tries formats in this order:
1. Format with upstream (extended)
2. Combined format (standard)
3. Common format (simplified)

The first matching format is used.

---

## ✅ Important notes

- ✅ IPv4 compatible (IPv6 supported via improved regex)
- ✅ Regexes tested against real NGINX logs
- ✅ Support for timestamps with timezone (`+0000`, `-0500`)
- ✅ Automatic parsing of the request (`method`, `url`, `protocol`)
- ✅ Handling of optional fields (`-` or empty)
- ✅ Automatic log level extraction from the HTTP status code

---

## 📌 Real log examples

### Combined format
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET /api/users HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
```

### Common format
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET /api/users HTTP/1.1" 200 1234
```

### Format with upstream
```
192.168.1.1 - - [01/Jan/2024:12:00:00 +0000] "GET /api/users HTTP/1.1" 200 1234 "https://example.com" "Mozilla/5.0" "http://backend:8080"
```

### Error log
```
2024/01/01 12:00:00 [error] 123#456: connect() failed (111: Connection refused) while connecting to upstream, client: 192.168.1.1, server: example.com, request: "GET /api/users HTTP/1.1", upstream: "http://127.0.0.1:8080/api/users", host: "example.com"
```

---

## 🔗 References

- [NGINX Documentation - log_format](http://nginx.org/en/docs/http/ngx_http_log_module.html#log_format)
- [General parsers guide](../PARSERS_HELP.md)
