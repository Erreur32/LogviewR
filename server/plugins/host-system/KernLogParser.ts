/**
 * Kernel Log Parser
 * 
 * Parser for kernel logs (kern.log)
 * Format: timestamp hostname kernel: message
 * Example: Jan 1 12:00:00 hostname kernel: [12345.678] CPU: Temperature above threshold
 * Uses Grok patterns for robust parsing
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import { buildSyslogPattern, parseGrokPattern } from './GrokPatterns.js';
import { parseTimestamp } from './TimestampParser.js';

export class KernLogParser {
    /**
     * Parse a kernel log line
     * Format: timestamp hostname kernel: message
     * Uses Grok patterns for robust parsing
     */
    private static buildEntry(
        timestamp: string,
        rawMessage: string,
        opts: { hostname?: string; kernelTimestampOverride?: string } = {}
    ): ParsedLogEntry {
        const message = rawMessage.trim();
        const ktsRaw = opts.kernelTimestampOverride ?? /\[([\d.]+)\]/.exec(message)?.[1];
        return {
            timestamp: parseTimestamp(timestamp),
            hostname: opts.hostname || undefined,
            level: this.extractLevelFromMessage(message),
            message,
            component: this.extractComponent(message),
            kernelTimestamp: ktsRaw ? Number.parseFloat(ktsRaw) : undefined,
        };
    }

    static parseKernLine(line: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) return null;

        // Try ISO8601 format first: 2026-01-03T00:16:25.101453+01:00 hostname kernel: message
        const iso8601Match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s+(.+)$/.exec(line);
        if (iso8601Match) {
            const [, timestamp, rest] = iso8601Match;
            const withHost = /^(\S+)\s+kernel:\s*(.*)$/.exec(rest);
            if (withHost) return this.buildEntry(timestamp, withHost[2], { hostname: withHost[1] });
            const noHost = /^kernel:\s*(.*)$/.exec(rest);
            if (noHost) return this.buildEntry(timestamp, noHost[1]);
        }

        // Grok syslog pattern
        const match = parseGrokPattern(line, buildSyslogPattern(false));
        if (match?.timestamp && match.program && match.message) {
            return this.buildEntry(match.timestamp, match.message, { hostname: match.hostname });
        }

        // Fallback regex (captures explicit kernel timestamp group)
        const regexMatch = /^(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+kernel:\s*(?:\[([\d.]+)\]\s*)?(.*)$/.exec(line);
        if (regexMatch) {
            const [, timestamp, hostname, kernelTimestamp, message] = regexMatch;
            return this.buildEntry(timestamp, message, { hostname, kernelTimestampOverride: kernelTimestamp });
        }

        return { message: line.trim(), level: 'info' };
    }

    /**
     * Extract log level from message content
     */
    private static extractLevelFromMessage(message: string): string {
        const lowerMessage = message.toLowerCase();
        
        if (lowerMessage.includes('error') || lowerMessage.includes('panic') || lowerMessage.includes('oops')) {
            return 'error';
        }
        if (lowerMessage.includes('warning') || lowerMessage.includes('warn')) {
            return 'warning';
        }
        if (lowerMessage.includes('info') || lowerMessage.includes('notice')) {
            return 'info';
        }
        if (lowerMessage.includes('debug')) {
            return 'debug';
        }
        
        return 'info';
    }

    /**
     * Extract component from message (CPU, memory, disk, network, perf, docker, etc.)
     */
    private static extractComponent(message: string): string | undefined {
        // Pattern 1: Extract perf: component
        // Example: "perf: interrupt took too long"
        const perfMatch = message.match(/\[[\d.]+\]\s+perf:\s*(.+)/i);
        if (perfMatch) {
            return 'perf';
        }
        
        // Pattern 2: Extract docker interfaces (docker0:, docker:, br-*, etc.)
        // Example: "docker0: port 1(veth156b2f3) entered blocking state"
        // Example: "br-68dac176c6d6: port 1(vethef22c78) entered disabled state"
        const dockerInterfaceMatch = message.match(/\[[\d.]+\]\s+((?:docker\d*|br-[a-f0-9]+|veth[a-f0-9]+)):/i);
        if (dockerInterfaceMatch) {
            const interfaceName = dockerInterfaceMatch[1];
            // Normalize docker interfaces
            if (interfaceName.startsWith('docker')) {
                return 'docker';
            }
            // Bridge interfaces
            if (interfaceName.startsWith('br-')) {
                return 'bridge';
            }
            // Veth interfaces
            if (interfaceName.startsWith('veth')) {
                return 'veth';
            }
            return interfaceName;
        }
        
        // Pattern 3: Extract device component
        // Example: "device veth156b2f3 entered promiscuous mode"
        const deviceMatch = message.match(/\[[\d.]+\]\s+device\s+(\S+)/i);
        if (deviceMatch) {
            return 'device';
        }
        
        // Pattern 4: Extract network interface names (eth*, enp*, etc.)
        // Example: "eth0: renamed from veth5299c38"
        const networkInterfaceMatch = message.match(/\[[\d.]+\]\s+((?:eth\d+|enp\d+[a-z0-9]*|wlan\d+|wlp\d+[a-z0-9]*)):/i);
        if (networkInterfaceMatch) {
            return 'network';
        }
        
        // Pattern 5: Extract standard components (CPU, Memory, Disk, etc.)
        const components = ['CPU', 'Memory', 'Disk', 'Network', 'USB', 'PCI', 'ACPI', 'Thermal'];
        const upperMessage = message.toUpperCase();
        
        for (const component of components) {
            if (upperMessage.includes(component.toUpperCase())) {
                return component;
            }
        }
        
        return undefined;
    }

}
