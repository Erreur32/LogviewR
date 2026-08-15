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

const LINE_REGEX = /^(\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}),(\d{3})\s+(?:\S+)\s+\[(?:\d+)\]:\s+(\S+)\s+\[([^\]]+)\]\s*(.*)$/;

const KNOWN_ACTIONS = ['Restore Ban', 'Ban', 'Unban', 'Found', 'Ignore'];

const IPV4_REGEX = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
const IPV6_REGEX = /\b([0-9a-fA-F]{0,4}(?::[0-9a-fA-F]{0,4}){2,7})\b/;

export class Fail2banHostLogParser {
    static parseFail2banLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) return null;
        // ReDoS guard (S5852): cap input before running the parsing regex below.
        if (line.length > MAX_LINE_LENGTH) return { message: line.slice(0, MAX_LINE_LENGTH), level: 'info' };

        const match = LINE_REGEX.exec(line);
        if (!match) {
            return { message: line.trim(), level: 'info' };
        }

        const [, date, ms, level, jail, rest] = match;
        const message = rest.trim();

        return {
            timestamp: parseTimestamp(`${date.replace(' ', 'T')}.${ms}`),
            level: level.toLowerCase(),
            jail,
            action: this.extractAction(message),
            ipAddress: this.extractIpAddress(message),
            message,
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
