/**
 * Journald JSON Parser
 * 
 * Parser for journald logs in JSON format (journalctl -o json)
 * This format avoids fragile parsing as data is already structured
 * 
 * Format example:
 * {
 *   "__REALTIME_TIMESTAMP": "1234567890123456",
 *   "_HOSTNAME": "hostname",
 *   "_SYSTEMD_UNIT": "sshd.service",
 *   "MESSAGE": "Accepted password for user from 192.168.1.1",
 *   "PRIORITY": "6"
 * }
 */

import type { ParsedLogEntry } from '../base/LogSourcePluginInterface.js';

/**
 * Journald JSON log entry interface
 */
interface JournaldJsonEntry {
    __REALTIME_TIMESTAMP?: string;
    _HOSTNAME?: string;
    _SYSTEMD_UNIT?: string;
    _COMM?: string;
    _PID?: string;
    MESSAGE?: string;
    PRIORITY?: string;
    SYSLOG_IDENTIFIER?: string;
    SYSLOG_PID?: string;
    SYSLOG_FACILITY?: string;
    SYSLOG_SEVERITY?: string;
    [key: string]: unknown;
}

/**
 * Parse a journald JSON log line
 * 
 * @param line JSON string from journalctl -o json
 * @returns Parsed log entry or null if parsing fails
 */
export function parseJournaldJson(line: string): ParsedLogEntry | null {
    if (!line || line.trim().length === 0) {
        return null;
    }

    try {
        const jsonEntry: JournaldJsonEntry = JSON.parse(line);
        
        // Extract timestamp from __REALTIME_TIMESTAMP (microseconds since epoch)
        let timestamp: Date | undefined;
        if (jsonEntry.__REALTIME_TIMESTAMP) {
            const microseconds = parseInt(jsonEntry.__REALTIME_TIMESTAMP, 10);
            if (!isNaN(microseconds)) {
                timestamp = new Date(microseconds / 1000); // Convert to milliseconds
            }
        }
        
        // Extract level from PRIORITY (syslog priority: 0-7)
        let level = 'info';
        if (jsonEntry.PRIORITY) {
            const priority = parseInt(jsonEntry.PRIORITY, 10);
            level = getLevelFromPriority(priority);
        }
        
        // Extract hostname
        const hostname = jsonEntry._HOSTNAME || jsonEntry.HOSTNAME as string | undefined;
        
        // Extract service/program name
        const service = jsonEntry._SYSTEMD_UNIT || 
                       jsonEntry.SYSLOG_IDENTIFIER || 
                       jsonEntry._COMM || 
                       undefined;
        
        // Extract PID
        let pid: number | undefined;
        if (jsonEntry._PID) {
            const pidValue = parseInt(jsonEntry._PID, 10);
            if (!isNaN(pidValue)) {
                pid = pidValue;
            }
        } else if (jsonEntry.SYSLOG_PID) {
            const pidValue = parseInt(jsonEntry.SYSLOG_PID as string, 10);
            if (!isNaN(pidValue)) {
                pid = pidValue;
            }
        }
        
        // Extract message
        const message = jsonEntry.MESSAGE as string || '';
        
        // Extract IP address from message if present
        const ipAddress = extractIpAddress(message);
        
        // Extract user from message if present
        const user = extractUser(message);
        
        // Extract action from message if present
        const action = extractAction(message);
        
        // Build parsed entry
        const entry: ParsedLogEntry = {
            timestamp: timestamp || new Date(),
            level,
            message: message.trim(),
        };
        
        if (hostname) {
            entry.hostname = hostname;
        }
        
        if (service) {
            entry.service = service;
            entry.tag = service; // For compatibility
        }
        
        if (pid !== undefined) {
            entry.pid = pid;
        }
        
        if (ipAddress) {
            entry.ipAddress = ipAddress;
        }
        
        if (user) {
            entry.user = user;
        }
        
        if (action) {
            entry.action = action;
        }
        
        // Add priority if available
        if (jsonEntry.PRIORITY) {
            entry.priority = parseInt(jsonEntry.PRIORITY, 10);
        }
        
        return entry;
    } catch (error) {
        // Not valid JSON, return null
        return null;
    }
}

/**
 * Get log level from syslog priority
 * 
 * @param priority Syslog priority (0-7)
 * @returns Log level string
 */
function getLevelFromPriority(priority: number): string {
    const severity = priority % 8;
    
    if (severity <= 2) return 'error';      // Emergency, Alert, Critical
    if (severity === 3) return 'error';     // Error
    if (severity === 4) return 'warning';    // Warning
    if (severity <= 6) return 'info';       // Notice, Informational, Debug
    
    return 'info';
}

/**
 * Extract IP address from message (IPv4 and IPv6)
 */
function extractIpAddress(message: string): string | undefined {
    // Try IPv6 first: [2001:db8::1] or 2001:db8::1
    const ipv6Regex = /(?:\[([0-9a-fA-F:]+(?:::[0-9a-fA-F:]*)?)\]|([0-9a-fA-F:]+(?:::[0-9a-fA-F:]*)?))/;
    const ipv6Match = message.match(ipv6Regex);
    if (ipv6Match && (ipv6Match[1] || ipv6Match[2])) {
        return ipv6Match[1] || ipv6Match[2];
    }
    
    // Try IPv4: 192.168.1.1
    const ipv4Regex = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/;
    const ipv4Match = message.match(ipv4Regex);
    if (ipv4Match) {
        return ipv4Match[1];
    }
    
    return undefined;
}

/**
 * Extract username from message
 */
function extractUser(message: string): string | undefined {
    // Pattern 1: "for user" or "for username"
    const forPattern = /for\s+([a-z_][a-z0-9_\-]*)/i;
    const forMatch = message.match(forPattern);
    if (forMatch) {
        return forMatch[1];
    }
    
    // Pattern 2: "user=username" or "user = username"
    const userEqualsPattern = /user\s*=\s*([a-z_][a-z0-9_\-]*)/i;
    const userEqualsMatch = message.match(userEqualsPattern);
    if (userEqualsMatch) {
        return userEqualsMatch[1];
    }
    
    // Pattern 3: "Accepted password for username"
    const acceptedPattern = /accepted\s+(?:password|publickey)\s+for\s+([a-z_][a-z0-9_\-]*)/i;
    const acceptedMatch = message.match(acceptedPattern);
    if (acceptedMatch) {
        return acceptedMatch[1];
    }
    
    return undefined;
}

/**
 * Extract action from message
 */
function extractAction(message: string): string | undefined {
    const lowerMessage = message.toLowerCase();
    const actions = [
        'accepted', 'failed', 'disconnected', 'opened', 'closed', 
        'authentication failure', 'connection', 'login', 'logout'
    ];
    
    for (const action of actions) {
        if (lowerMessage.includes(action)) {
            return action;
        }
    }
    
    return undefined;
}

/**
 * Check if a line is JSON format (journald JSON)
 * 
 * @param line Log line to check
 * @returns true if line appears to be JSON
 */
export function isJournaldJson(line: string): boolean {
    if (!line || line.trim().length === 0) {
        return false;
    }
    
    const trimmed = line.trim();
    return trimmed.startsWith('{') && trimmed.endsWith('}');
}
