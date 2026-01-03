/**
 * OS Detection Utility
 * 
 * Detects the operating system type and version to adapt log parsing patterns
 * Supports: Debian, Ubuntu, CentOS, RHEL, Fedora, Arch, etc.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export type OSType = 'debian' | 'ubuntu' | 'mint' | 'centos' | 'rhel' | 'fedora' | 'arch' | 'suse' | 'unknown';
export type LogFormat = 'syslog' | 'systemd' | 'rsyslog' | 'syslog-ng';

export interface OSInfo {
    type: OSType;
    version?: string;
    logFormat: LogFormat;
    usesISO8601: boolean; // Whether logs use ISO 8601 format (systemd/journald)
}

let cachedOSInfo: OSInfo | null = null;

/**
 * Detect OS type from /etc/os-release
 */
export async function detectOS(): Promise<OSInfo> {
    if (cachedOSInfo) {
        return cachedOSInfo;
    }

    const defaultInfo: OSInfo = {
        type: 'unknown',
        logFormat: 'syslog',
        usesISO8601: false
    };

    try {
        // Try /etc/os-release first (systemd-based systems)
        const osReleasePath = '/etc/os-release';
        const hostOsReleasePath = process.env.HOST_ROOT_PATH 
            ? path.join(process.env.HOST_ROOT_PATH, 'etc', 'os-release')
            : null;

        let osReleaseContent: string | null = null;

        // Try host path first (Docker), then standard path
        for (const tryPath of [hostOsReleasePath, osReleasePath].filter(Boolean)) {
            try {
                osReleaseContent = await fs.readFile(tryPath!, 'utf-8');
                break;
            } catch {
                // Continue to next path
            }
        }

        if (!osReleaseContent) {
            // Fallback: check if systemd is present (indicates systemd-based logging)
            try {
                const systemdPath = process.env.HOST_ROOT_PATH
                    ? path.join(process.env.HOST_ROOT_PATH, 'usr', 'bin', 'systemd')
                    : '/usr/bin/systemd';
                await fs.access(systemdPath);
                return {
                    type: 'unknown',
                    logFormat: 'systemd',
                    usesISO8601: true
                };
            } catch {
                return defaultInfo;
            }
        }

        // Parse /etc/os-release
        const osInfo: Partial<OSInfo> = {
            logFormat: 'syslog',
            usesISO8601: false
        };

        const lines = osReleaseContent.split('\n');
        for (const line of lines) {
            if (line.startsWith('ID=')) {
                const id = line.split('=')[1]?.replace(/^"|"$/g, '').toLowerCase();
                if (id === 'debian') {
                    osInfo.type = 'debian';
                    osInfo.logFormat = 'systemd'; // Debian 12+ uses systemd
                    osInfo.usesISO8601 = true;
                } else if (id === 'ubuntu') {
                    osInfo.type = 'ubuntu';
                    // Ubuntu 16.04+ uses systemd
                    osInfo.logFormat = 'systemd';
                    osInfo.usesISO8601 = true;
                } else if (id === 'linuxmint') {
                    osInfo.type = 'mint';
                    // Linux Mint is based on Ubuntu, uses systemd
                    osInfo.logFormat = 'systemd';
                    osInfo.usesISO8601 = true;
                } else if (id === 'centos' || id === 'rhel' || id === 'rocky' || id === 'almalinux') {
                    osInfo.type = id === 'rhel' ? 'rhel' : 'centos';
                    osInfo.logFormat = 'systemd';
                    osInfo.usesISO8601 = true;
                } else if (id === 'fedora') {
                    osInfo.type = 'fedora';
                    osInfo.logFormat = 'systemd';
                    osInfo.usesISO8601 = true;
                } else if (id === 'arch' || id === 'archlinux') {
                    osInfo.type = 'arch';
                    osInfo.logFormat = 'systemd';
                    osInfo.usesISO8601 = true;
                } else if (id === 'opensuse' || id === 'sles') {
                    osInfo.type = 'suse';
                    osInfo.logFormat = 'systemd';
                    osInfo.usesISO8601 = true;
                }
            } else if (line.startsWith('VERSION_ID=')) {
                osInfo.version = line.split('=')[1]?.replace(/^"|"$/g, '');
            }
        }

        // If systemd is detected, use ISO 8601 format
        if (osInfo.logFormat === 'systemd' || osInfo.usesISO8601) {
            osInfo.usesISO8601 = true;
        }

        cachedOSInfo = {
            type: osInfo.type || 'unknown',
            version: osInfo.version,
            logFormat: osInfo.logFormat || 'syslog',
            usesISO8601: osInfo.usesISO8601 || false
        };

        return cachedOSInfo;
    } catch (error) {
        console.warn('[OSDetector] Failed to detect OS:', error);
        return defaultInfo;
    }
}

/**
 * Get log format pattern preference based on OS
 */
export function getPreferredLogFormat(): LogFormat {
    // Default to systemd if cached info indicates it
    if (cachedOSInfo?.logFormat === 'systemd') {
        return 'systemd';
    }
    return 'syslog';
}

/**
 * Check if OS uses ISO 8601 timestamps
 */
export function usesISO8601(): boolean {
    return cachedOSInfo?.usesISO8601 || false;
}

/**
 * Get default log file paths based on OS type
 */
export function getDefaultLogFiles(osType: OSType): Array<{ path: string; type: string; enabled: boolean }> {
    switch (osType) {
        case 'debian':
        case 'ubuntu':
        case 'mint':
            return [
                { path: '/var/log/syslog', type: 'syslog', enabled: true },
                { path: '/var/log/auth.log', type: 'auth', enabled: true },
                { path: '/var/log/kern.log', type: 'kern', enabled: false },
                { path: '/var/log/daemon.log', type: 'daemon', enabled: false },
                { path: '/var/log/mail.log', type: 'mail', enabled: false },
                { path: '/var/log/mail.err', type: 'mail', enabled: false }
            ];
        
        case 'centos':
        case 'rhel':
        case 'fedora':
            return [
                { path: '/var/log/messages', type: 'syslog', enabled: true },
                { path: '/var/log/secure', type: 'auth', enabled: true },
                { path: '/var/log/cron', type: 'syslog', enabled: false },
                { path: '/var/log/maillog', type: 'mail', enabled: false },
                { path: '/var/log/boot.log', type: 'syslog', enabled: false }
            ];
        
        case 'arch':
            return [
                { path: '/var/log/messages', type: 'syslog', enabled: true },
                { path: '/var/log/auth.log', type: 'auth', enabled: true },
                { path: '/var/log/kern.log', type: 'kern', enabled: false },
                { path: '/var/log/daemon.log', type: 'daemon', enabled: false }
            ];
        
        case 'suse':
            return [
                { path: '/var/log/messages', type: 'syslog', enabled: true },
                { path: '/var/log/secure', type: 'auth', enabled: true },
                { path: '/var/log/mail', type: 'mail', enabled: false }
            ];
        
        default:
            // Default to Debian/Ubuntu pattern (most common)
            return [
                { path: '/var/log/syslog', type: 'syslog', enabled: true },
                { path: '/var/log/messages', type: 'syslog', enabled: true },
                { path: '/var/log/auth.log', type: 'auth', enabled: true },
                { path: '/var/log/secure', type: 'auth', enabled: false },
                { path: '/var/log/kern.log', type: 'kern', enabled: false },
                { path: '/var/log/daemon.log', type: 'daemon', enabled: false },
                { path: '/var/log/mail.log', type: 'mail', enabled: false },
                { path: '/var/log/maillog', type: 'mail', enabled: false }
            ];
    }
}

/**
 * Get default file patterns based on OS type
 */
export function getDefaultFilePatterns(osType: OSType): string[] {
    switch (osType) {
        case 'debian':
        case 'ubuntu':
        case 'mint':
            return [
                'syslog*',
                'auth.log*',
                'kern.log*',
                'daemon.log*',
                'mail.log*',
                'mail.err*',
                '*.log'
            ];
        
        case 'centos':
        case 'rhel':
        case 'fedora':
            return [
                'messages*',
                'secure*',
                'cron*',
                'maillog*',
                'boot.log*',
                '*.log'
            ];
        
        case 'arch':
            return [
                'messages*',
                'auth.log*',
                'kern.log*',
                'daemon.log*',
                '*.log'
            ];
        
        case 'suse':
            return [
                'messages*',
                'secure*',
                'mail*',
                '*.log'
            ];
        
        default:
            // Default patterns (most common)
            return [
                'syslog*',
                'messages*',
                'auth.log*',
                'secure*',
                'kern.log*',
                'daemon.log*',
                'mail.log*',
                'maillog*',
                'mail.err*',
                'cron*',
                '*.log'
            ];
    }
}
