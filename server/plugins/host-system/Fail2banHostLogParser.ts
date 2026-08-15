/**
 * Fail2ban Host Log Parser
 *
 * Parser for fail2ban's own log file (fail2ban.log) when viewed from the
 * generic host-system log viewer, including uncompressed rotated (.log.N)
 * variants — rotation discovery is handled upstream by the generic file
 * scanner. Gzipped (.log.N.gz) variants are NOT picked up: the shared
 * host-system scanner excludes .gz/.bz2/.xz files for every log type.
 *
 * Format: %(asctime)s %(name)-24s [%(process)d]: %(levelname)-7s %(message)s
 * Example: 2026-08-15 10:11:17,123 fail2ban.actions        [1]: NOTICE  [npm-4xx] Ban 34.124.139.132
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import { parseTimestamp } from './TimestampParser.js';

/** Upper bound on a single log line before regex parsing — prevents pathological ReDoS
 *  input from propagating through downstream patterns. Real fail2ban log lines are well
 *  under this size; anything larger is returned as-is. */
const MAX_LINE_LENGTH = 10_000;

// Only the timestamp header is matched by regex — it's a fixed sequence of digit-only
// groups, so there's no ambiguity between adjacent quantifiers and matching stays linear.
// Everything after it (logger name, [pid]:, level, message) is located with plain
// indexOf/slice instead of a monolithic regex, which is what let adjacent unbounded
// \S+/\s+ quantifiers backtrack polynomially on non-matching input (S5852).
const HEADER_REGEX = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}),(\d{3}) /;

const KNOWN_ACTIONS = ['Restore Ban', 'Ban', 'Unban', 'Found', 'Ignore'];

const IPV4_REGEX = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
const IPV6_REGEX = /\b([0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7})\b/;

export class Fail2banHostLogParser {
    static parseFail2banLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) return null;
        // ReDoS guard (S5852): cap input before running the parsing regex below.
        if (line.length > MAX_LINE_LENGTH) return { message: line.slice(0, MAX_LINE_LENGTH), level: 'info' };

        const header = HEADER_REGEX.exec(line);
        if (!header) return { message: line.trim(), level: 'info' };

        const [full, date, time, ms] = header;
        const afterHeader = line.slice(full.length);

        // afterHeader looks like: "<logger name>   [<pid>]: <LEVEL>  <message...>"
        const pidOpen = afterHeader.indexOf('[');
        const pidClose = pidOpen === -1 ? -1 : afterHeader.indexOf(']', pidOpen);
        if (pidOpen === -1 || pidClose === -1 || afterHeader[pidClose + 1] !== ':') {
            return { message: line.trim(), level: 'info' };
        }

        const afterPid = afterHeader.slice(pidClose + 2).trimStart();
        const levelEnd = afterPid.indexOf(' ');
        const level = (levelEnd === -1 ? afterPid : afterPid.slice(0, levelEnd)).toLowerCase();
        const message = (levelEnd === -1 ? '' : afterPid.slice(levelEnd + 1).trimStart());
        const timestamp = parseTimestamp(`${date}T${time}.${ms}`);

        // Only fail2ban.actions lines carry a leading "[jail] " prefix in the message;
        // lifecycle lines from other loggers (filter/server/jail) don't.
        if (!message.startsWith('[')) {
            return { timestamp, level, message };
        }
        const jailEnd = message.indexOf(']');
        if (jailEnd === -1) {
            return { timestamp, level, message };
        }

        const jail = message.slice(1, jailEnd);
        const rest = message.slice(jailEnd + 1).trimStart();

        return {
            timestamp,
            level,
            jail,
            action: this.extractAction(rest),
            ipAddress: this.extractIpAddress(rest),
            message: rest,
        };
    }

    /**
     * Extract the fail2ban action verb from the message (Ban/Unban/Found/Restore Ban/...)
     */
    private static extractAction(message: string): string | undefined {
        for (const action of KNOWN_ACTIONS) {
            if (message.startsWith(action)) {
                return action.toLowerCase();
            }
        }

        const firstWord = message.match(/^(\S+)/)?.[1];
        return firstWord ? firstWord.toLowerCase() : undefined;
    }

    /**
     * Extract IP address from message (IPv4 and IPv6)
     */
    private static extractIpAddress(message: string): string | undefined {
        const ipv4Match = message.match(IPV4_REGEX);
        if (ipv4Match) {
            const octets = ipv4Match[1].split('.');
            if (octets.every(oct => Number.parseInt(oct, 10) <= 255)) {
                return ipv4Match[1];
            }
        }

        const ipv6Match = message.match(IPV6_REGEX);
        if (ipv6Match) {
            return ipv6Match[1];
        }

        return undefined;
    }
}
