# Grok Patterns Documentation

This document describes the Grok patterns used in LogviewR for parsing system logs. These patterns are based on RFC 3164 (BSD syslog) and RFC 5424 (Syslog Protocol).

## Overview

Grok patterns provide a standardized way to parse log lines by defining reusable patterns for common log elements (timestamps, IP addresses, hostnames, etc.). LogviewR implements a Grok-like pattern system without external dependencies, converting patterns to JavaScript regex for efficient matching.

## Base Patterns

### Timestamp Patterns

#### `SYSLOGTIMESTAMP`
- **Pattern**: `%{MONTH:month} +%{MONTHDAY:day} +%{TIME:time}`
- **Description**: Syslog timestamp format without year
- **Example**: `Jan 15 10:30:45`
- **Regex Equivalent**: `/(\w+)\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})/`
- **Fields Extracted**: `month`, `day`, `time`

#### `ISO8601`
- **Pattern**: `%{TIMESTAMP_ISO8601:timestamp}`
- **Description**: ISO 8601 / RFC3339 timestamp format
- **Example**: `2025-01-15T10:30:45Z` or `2025-01-15T10:30:45+01:00`
- **Regex Equivalent**: `/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})?)/`
- **Fields Extracted**: `timestamp`

### Hostname Patterns

#### `HOSTNAME`
- **Pattern**: `%{HOSTNAME:hostname}`
- **Description**: Hostname or domain name
- **Example**: `hostname.example.com`
- **Regex Equivalent**: `/([\w\-\.]+)/`
- **Fields Extracted**: `hostname`

#### `IPORHOST`
- **Pattern**: `(?:%{IP:ip}|%{HOSTNAME:hostname})`
- **Description**: IP address or hostname
- **Example**: `192.168.1.1` or `hostname.example.com`
- **Fields Extracted**: `ip` or `hostname`

### IP Address Patterns

#### `IPV4`
- **Pattern**: `%{IPV4:ipv4}`
- **Description**: IPv4 address
- **Example**: `192.168.1.1`
- **Regex Equivalent**: `/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/`
- **Fields Extracted**: `ipv4`

#### `IPV6`
- **Pattern**: `(?:\[%{IPV6:ipv6}\]|%{IPV6:ipv6})`
- **Description**: IPv6 address (with or without brackets)
- **Example**: `2001:db8::1` or `[2001:db8::1]`
- **Regex Equivalent**: `/([0-9a-fA-F:]+(?:::[0-9a-fA-F:]*)?)/`
- **Fields Extracted**: `ipv6`

#### `IP`
- **Pattern**: `(?:%{IPV4:ipv4}|%{IPV6:ipv6})`
- **Description**: IPv4 or IPv6 address
- **Example**: `192.168.1.1` or `2001:db8::1`
- **Fields Extracted**: `ipv4` or `ipv6`

### Program Patterns

#### `PROGRAM`
- **Pattern**: `%{PROG:program}`
- **Description**: Program or service name
- **Example**: `sshd`, `systemd`, `postfix/smtpd`
- **Regex Equivalent**: `/([\w\-\.\/]+)/`
- **Fields Extracted**: `program`

#### `PID`
- **Pattern**: `(?:\[%{POSINT:pid}\])?`
- **Description**: Process ID (optional, in brackets)
- **Example**: `[12345]`
- **Regex Equivalent**: `/(?:\[(\d+)\])?/`
- **Fields Extracted**: `pid` (optional)

### User Patterns

#### `USERNAME`
- **Pattern**: `%{USER:user}`
- **Description**: Username
- **Example**: `john`, `root`, `www-data`
- **Regex Equivalent**: `/([a-z_][a-z0-9_\-]*)/i`
- **Fields Extracted**: `user`

### Priority Patterns

#### `PRIORITY`
- **Pattern**: `<%{POSINT:priority}>`
- **Description**: Syslog priority (0-191)
- **Example**: `<30>`
- **Regex Equivalent**: `/<(\d+)>/`
- **Fields Extracted**: `priority`

### Data Patterns

#### `GREEDYDATA`
- **Pattern**: `%{GREEDYDATA:message}`
- **Description**: Matches everything (greedy)
- **Example**: Any remaining text
- **Regex Equivalent**: `/(.*)/`
- **Fields Extracted**: `message`

## Composite Patterns

### Syslog Patterns

#### `SYSLOGBASE`
- **Pattern**: `%{SYSLOGTIMESTAMP:timestamp} %{IPORHOST:hostname} %{PROGRAM:program}%{PID:pid}: %{GREEDYDATA:message}`
- **Description**: Standard syslog format without priority
- **Example**: `Jan 15 10:30:45 hostname sshd[12345]: Accepted password for user`
- **Fields Extracted**: `timestamp`, `hostname`, `program`, `pid` (optional), `message`

#### `SYSLOG_WITH_PRIORITY`
- **Pattern**: `<%{POSINT:priority}>%{SYSLOGTIMESTAMP:timestamp} %{IPORHOST:hostname} %{PROGRAM:program}%{PID:pid}: %{GREEDYDATA:message}`
- **Description**: Standard syslog format with priority
- **Example**: `<30>Jan 15 10:30:45 hostname sshd[12345]: Accepted password for user`
- **Fields Extracted**: `priority`, `timestamp`, `hostname`, `program`, `pid` (optional), `message`

## Usage Examples

### Parsing a Syslog Line

```typescript
import { buildSyslogPattern, parseGrokPattern } from './GrokPatterns.js';

const line = '<30>Jan 15 10:30:45 hostname sshd[12345]: Accepted password for user from 192.168.1.1';
const pattern = buildSyslogPattern(true); // with priority
const result = parseGrokPattern(line, pattern);

// Result:
// {
//   priority: '30',
//   timestamp: 'Jan 15 10:30:45',
//   hostname: 'hostname',
//   program: 'sshd',
//   pid: '12345',
//   message: 'Accepted password for user from 192.168.1.1'
// }
```

### Parsing an Auth Log Line

```typescript
import { buildSyslogPattern, parseGrokPattern } from './GrokPatterns.js';

const line = 'Jan 15 10:30:45 hostname sshd: Accepted password for user from 192.168.1.1';
const pattern = buildSyslogPattern(false); // without priority
const result = parseGrokPattern(line, pattern);

// Result:
// {
//   timestamp: 'Jan 15 10:30:45',
//   hostname: 'hostname',
//   program: 'sshd',
//   message: 'Accepted password for user from 192.168.1.1'
// }
```

## Pattern Conversion

The `grokToRegex()` function converts Grok patterns to JavaScript RegExp objects:

1. **Expand composite patterns**: Patterns that reference other patterns (e.g., `SYSLOGTIMESTAMP`, `IPORHOST`) are expanded recursively
2. **Replace base patterns**: Base patterns (e.g., `MONTH`, `IPV4`) are replaced with their regex equivalents
3. **Handle named groups**: Capture groups are preserved for field extraction
4. **Escape special characters**: Special regex characters are properly escaped

## Timestamp Parsing

The `TimestampParser` module provides robust timestamp parsing with:

- **Automatic year detection**: Syslog timestamps without year are compared with system date to determine the correct year
- **Multiple format support**: ISO 8601, RFC3339, Unix timestamp, Syslog format
- **Timezone handling**: Proper timezone offset handling for RFC3339 format

## IP Address Extraction

IP address extraction supports:

- **IPv4**: Standard dotted-decimal notation (`192.168.1.1`)
- **IPv6**: Standard IPv6 notation (`2001:db8::1`) with or without brackets (`[2001:db8::1]`)
- **IPv6 with port**: IPv6 addresses with port numbers (`[::1]:8080`)

## References

- **RFC 3164**: The BSD syslog Protocol
- **RFC 5424**: The Syslog Protocol
- **Grok Debugger**: https://grokdebug.herokuapp.com/
- **ECS (Elastic Common Schema)**: https://www.elastic.co/guide/en/ecs/current/index.html

## Implementation Notes

- Patterns are converted to JavaScript regex at runtime (no external dependencies)
- Named groups are extracted using `parseGrokPattern()` function
- Fallback to simple regex patterns for compatibility with older log formats
- Support for both standard syslog and journald formats

## Testing

To test patterns, use the `parseGrokPattern()` function:

```typescript
import { buildSyslogPattern, parseGrokPattern } from './GrokPatterns.js';

const testLine = '<30>Jan 15 10:30:45 hostname sshd[12345]: Test message';
const pattern = buildSyslogPattern(true);
const result = parseGrokPattern(testLine, pattern);

console.log(result);
// Expected output:
// {
//   priority: '30',
//   timestamp: 'Jan 15 10:30:45',
//   hostname: 'hostname',
//   program: 'sshd',
//   pid: '12345',
//   message: 'Test message'
// }
```

## Limitations

- Patterns are converted to regex, so some advanced Grok features (e.g., custom patterns, conditionals) are not supported
- Complex nested patterns may require manual regex for optimal performance
- Year detection for syslog timestamps assumes logs are recent (within 6 months)

## Future Improvements

- Support for custom pattern definitions
- Performance optimization for frequently used patterns
- Extended pattern library for application-specific logs (Apache, Nginx, etc.)
- Pattern validation and testing utilities
