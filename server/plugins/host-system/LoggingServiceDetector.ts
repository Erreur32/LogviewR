/**
 * Logging Service Detector
 * 
 * Automatically detects which logging service is active on the system:
 * - journalctl (systemd-journald)
 * - syslog-ng
 * - rsyslog
 * 
 * Extracts log file paths from their configuration files
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { parseRsyslogConf, getRsyslogConfPath } from './RsyslogParser.js';

/**
 * Detect if running in Docker container
 */
function isDocker(): boolean {
    try {
        // Check /proc/self/cgroup (Linux)
        const cgroup = fsSync.readFileSync('/proc/self/cgroup', 'utf8');
        if (cgroup.includes('docker') || cgroup.includes('containerd')) {
            return true;
        }
    } catch {
        // Not Linux or file doesn't exist
    }
    
    // Check environment variable
    if (process.env.DOCKER === 'true' || process.env.DOCKER_CONTAINER === 'true') {
        return true;
    }
    
    // Check for .dockerenv file
    try {
        fsSync.accessSync('/.dockerenv');
        return true;
    } catch {
        return false;
    }
}

/**
 * Get host root path based on environment
 * In Docker: uses HOST_ROOT_PATH or /host
 * In local dev (npm run dev): returns empty string to use standard paths
 */
function getHostRootPath(): string {
    if (!isDocker()) {
        // Not in Docker (npm run dev) - use standard paths directly
        return '';
    }
    
    // In Docker - use HOST_ROOT_PATH if set, otherwise /host
    return process.env.HOST_ROOT_PATH || '/host';
}

export interface DetectedLoggingService {
    type: 'journald' | 'syslog-ng' | 'rsyslog' | 'none';
    active: boolean;
    configPath?: string;
    logFiles: Array<{
        path: string;
        type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'cron' | 'user' | 'journald' | 'custom';
        facility?: string;
        priority?: string;
        enabled: boolean;
        source: 'config' | 'default'; // Whether from config file or default detection
    }>;
}

/**
 * Check if systemd-journald (journalctl) is available
 */
async function detectJournald(): Promise<boolean> {
    const hostRoot = getHostRootPath();
    
    // Build paths to check - prioritize standard paths in local dev, host paths in Docker
    const journalctlPaths: string[] = [];
    
    if (hostRoot) {
        // Docker: check host paths first, then standard paths
        journalctlPaths.push(
            path.join(hostRoot, 'usr', 'bin', 'journalctl'),
            path.join(hostRoot, 'bin', 'journalctl')
        );
    }
    // Always check standard paths (works in both Docker and local dev)
    journalctlPaths.push('/usr/bin/journalctl', '/bin/journalctl');
    
    for (const journalctlPath of journalctlPaths) {
        try {
            await fs.access(journalctlPath);
            return true;
        } catch {
            // Continue checking
        }
    }
    
    // Check if systemd is present (indicates journald availability)
    const systemdPaths: string[] = [];
    
    if (hostRoot) {
        // Docker: check host paths first
        systemdPaths.push(
            path.join(hostRoot, 'usr', 'lib', 'systemd'),
            path.join(hostRoot, 'lib', 'systemd')
        );
    }
    // Always check standard paths
    systemdPaths.push('/usr/lib/systemd', '/lib/systemd');
    
    for (const systemdPath of systemdPaths) {
        try {
            const stat = await fs.stat(systemdPath);
            if (stat.isDirectory()) {
                return true;
            }
        } catch {
            // Continue checking
        }
    }
    
    return false;
}

/**
 * Check if syslog-ng is installed and get its configuration
 */
async function detectSyslogNg(): Promise<{ active: boolean; configPath?: string }> {
    const hostRoot = getHostRootPath();
    
    // Build paths to check - prioritize standard paths in local dev, host paths in Docker
    const syslogNgPaths: string[] = [];
    
    if (hostRoot) {
        // Docker: check host paths first
        syslogNgPaths.push(
            path.join(hostRoot, 'usr', 'sbin', 'syslog-ng'),
            path.join(hostRoot, 'sbin', 'syslog-ng')
        );
    }
    // Always check standard paths
    syslogNgPaths.push('/usr/sbin/syslog-ng', '/sbin/syslog-ng');
    
    let syslogNgExists = false;
    for (const syslogNgPath of syslogNgPaths) {
        try {
            await fs.access(syslogNgPath);
            syslogNgExists = true;
            break;
        } catch {
            // Continue checking
        }
    }
    
    if (!syslogNgExists) {
        return { active: false };
    }
    
    // Check for syslog-ng configuration files
    const configPaths: string[] = [];
    
    if (hostRoot) {
        // Docker: check host paths first
        configPaths.push(
            path.join(hostRoot, 'etc', 'syslog-ng', 'syslog-ng.conf'),
            path.join(hostRoot, 'etc', 'syslog-ng.conf')
        );
    }
    // Always check standard paths
    configPaths.push('/etc/syslog-ng/syslog-ng.conf', '/etc/syslog-ng.conf');
    
    for (const configPath of configPaths) {
        try {
            await fs.access(configPath);
            return { active: true, configPath };
        } catch {
            // Continue checking
        }
    }
    
    return { active: syslogNgExists };
}

/**
 * Check if rsyslog is installed and get its configuration
 */
async function detectRsyslog(): Promise<{ active: boolean; configPath?: string }> {
    const hostRoot = getHostRootPath();
    
    // Build paths to check - prioritize standard paths in local dev, host paths in Docker
    const rsyslogPaths: string[] = [];
    
    if (hostRoot) {
        // Docker: check host paths first
        rsyslogPaths.push(
            path.join(hostRoot, 'usr', 'sbin', 'rsyslogd'),
            path.join(hostRoot, 'sbin', 'rsyslogd')
        );
    }
    // Always check standard paths
    rsyslogPaths.push('/usr/sbin/rsyslogd', '/sbin/rsyslogd');
    
    let rsyslogExists = false;
    for (const rsyslogPath of rsyslogPaths) {
        try {
            await fs.access(rsyslogPath);
            rsyslogExists = true;
            break;
        } catch {
            // Continue checking
        }
    }
    
    if (!rsyslogExists) {
        return { active: false };
    }
    
    // Get rsyslog configuration path (getRsyslogConfPath already handles Docker/local)
    const configPath = getRsyslogConfPath();
    
    try {
        await fs.access(configPath);
        return { active: true, configPath };
    } catch {
        return { active: rsyslogExists };
    }
}

/**
 * Parse syslog-ng configuration file to extract log file paths
 */
async function parseSyslogNgConf(configPath: string): Promise<DetectedLoggingService['logFiles']> {
    const logFiles: DetectedLoggingService['logFiles'] = [];
    
    try {
        const content = await fs.readFile(configPath, 'utf-8');
        const lines = content.split('\n');
        
        // Map of facility to log type
        const facilityToType: Record<string, DetectedLoggingService['logFiles'][0]['type']> = {
            'auth': 'auth',
            'authpriv': 'auth',
            'kern': 'kern',
            'daemon': 'daemon',
            'mail': 'mail',
            'cron': 'cron',
            'user': 'user',
            'syslog': 'syslog'
        };
        
        // syslog-ng uses destination() and log() statements
        // Example: destination d_auth { file("/var/log/auth.log"); };
        //          log { source(s_sys); filter(f_auth); destination(d_auth); };
        
        const destinations: Map<string, string> = new Map();
        const filters: Map<string, string[]> = new Map();
        
        let currentDestination: string | null = null;
        let currentFilter: string | null = null;
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip comments and empty lines
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }
            
            // Parse destination statements
            // destination d_name { file("/path/to/log"); };
            const destMatch = trimmed.match(/destination\s+(\w+)\s*\{[^}]*file\(["']([^"']+)["']\)/);
            if (destMatch) {
                const [, destName, filePath] = destMatch;
                destinations.set(destName, filePath);
                continue;
            }
            
            // Parse filter statements with facilities
            // filter f_auth { facility(auth, authpriv); };
            const filterMatch = trimmed.match(/filter\s+(\w+)\s*\{[^}]*facility\(([^)]+)\)/);
            if (filterMatch) {
                const [, filterName, facilitiesStr] = filterMatch;
                const facilities = facilitiesStr.split(',').map(f => f.trim());
                filters.set(filterName, facilities);
                continue;
            }
            
            // Parse log statements
            // log { source(s_sys); filter(f_auth); destination(d_auth); };
            const logMatch = trimmed.match(/log\s*\{[^}]*filter\((\w+)\)[^}]*destination\((\w+)\)/);
            if (logMatch) {
                const [, filterName, destName] = logMatch;
                const filterFacilities = filters.get(filterName) || [];
                const filePath = destinations.get(destName);
                
                if (filePath) {
                    for (const facility of filterFacilities) {
                        const logType = facilityToType[facility] || 'custom';
                        const existing = logFiles.find(f => f.path === filePath);
                        if (!existing) {
                            logFiles.push({
                                path: filePath,
                                type: logType,
                                facility: facility,
                                enabled: true,
                                source: 'config'
                            });
                        }
                    }
                    
                    // If no specific facility, treat as syslog
                    if (filterFacilities.length === 0) {
                        const existing = logFiles.find(f => f.path === filePath);
                        if (!existing) {
                            logFiles.push({
                                path: filePath,
                                type: 'syslog',
                                enabled: true,
                                source: 'config'
                            });
                        }
                    }
                }
            }
        }
        
        // Also check included config files in /etc/syslog-ng/conf.d/
        const syslogNgDir = path.dirname(configPath);
        const confD = path.join(syslogNgDir, 'conf.d');
        
        try {
            const files = await fs.readdir(confD);
            for (const file of files) {
                if (file.endsWith('.conf')) {
                    const confPath = path.join(confD, file);
                    try {
                        const includedLogs = await parseSyslogNgConf(confPath);
                        // Merge without duplicates
                        for (const log of includedLogs) {
                            if (!logFiles.find(f => f.path === log.path)) {
                                logFiles.push(log);
                            }
                        }
                    } catch (err) {
                        // Skip files that can't be read
                        console.warn(`[SyslogNgParser] Failed to parse ${confPath}:`, err);
                    }
                }
            }
        } catch (err) {
            // conf.d directory doesn't exist or can't be read - not an error
            console.debug(`[SyslogNgParser] Could not read conf.d directory:`, err);
        }
        
    } catch (error) {
        console.error(`[SyslogNgParser] Error parsing ${configPath}:`, error);
    }
    
    return logFiles;
}

/**
 * Get default log files for journald (systemd)
 * journald doesn't use traditional log files, but we can list common paths
 */
function getJournaldDefaultLogFiles(): DetectedLoggingService['logFiles'] {
    const hostRoot = getHostRootPath();
    
    // journald stores logs in /var/log/journal/ or /run/log/journal/
    // But we can't directly read binary journal files
    // Instead, we list common log files that might be forwarded from journald
    const defaultPaths = [
        '/var/log/syslog',
        '/var/log/messages',
        '/var/log/auth.log',
        '/var/log/secure'
    ];
    
    const logFiles: DetectedLoggingService['logFiles'] = [];
    
    for (const logPath of defaultPaths) {
        // Build paths to check
        const pathsToCheck: string[] = [];
        
        if (hostRoot) {
            // Docker: check host path first
            const hostPath = logPath.startsWith('/var/log') 
                ? path.join(hostRoot, logPath.substring(1))
                : logPath;
            pathsToCheck.push(hostPath);
        }
        // Always check standard path (works in both Docker and local dev)
        pathsToCheck.push(logPath);
        
        // Check if any path exists
        let pathExists = false;
        for (const checkPath of pathsToCheck) {
            try {
                if (fsSync.existsSync(checkPath)) {
                    pathExists = true;
                    break;
                }
            } catch {
                // Continue checking
            }
        }
        
        if (pathExists) {
            const filename = path.basename(logPath).toLowerCase();
            let logType: DetectedLoggingService['logFiles'][0]['type'] = 'syslog';
            
            if (filename.includes('auth') || filename.includes('secure')) {
                logType = 'auth';
            } else if (filename.includes('kern')) {
                logType = 'kern';
            } else if (filename.includes('daemon')) {
                logType = 'daemon';
            } else if (filename.includes('mail')) {
                logType = 'mail';
            }
            
            logFiles.push({
                path: logPath,
                type: logType,
                enabled: true,
                source: 'default'
            });
        }
    }
    
    return logFiles;
}

/**
 * Detect all logging services and extract their log file configurations
 */
export async function detectLoggingServices(): Promise<DetectedLoggingService[]> {
    const services: DetectedLoggingService[] = [];
    
    // Detect journald (systemd)
    const journaldActive = await detectJournald();
    if (journaldActive) {
        const logFiles = getJournaldDefaultLogFiles();
        services.push({
            type: 'journald',
            active: journaldActive,
            logFiles
        });
    }
    
    // Detect syslog-ng
    const syslogNgInfo = await detectSyslogNg();
    if (syslogNgInfo.active) {
        let logFiles: DetectedLoggingService['logFiles'] = [];
        
        if (syslogNgInfo.configPath) {
            try {
                logFiles = await parseSyslogNgConf(syslogNgInfo.configPath);
            } catch (error) {
                console.warn('[LoggingServiceDetector] Failed to parse syslog-ng config:', error);
            }
        }
        
        // If no log files from config, use defaults
        if (logFiles.length === 0) {
            logFiles = getJournaldDefaultLogFiles(); // Reuse default detection
        }
        
        services.push({
            type: 'syslog-ng',
            active: syslogNgInfo.active,
            configPath: syslogNgInfo.configPath,
            logFiles
        });
    }
    
    // Detect rsyslog
    const rsyslogInfo = await detectRsyslog();
    if (rsyslogInfo.active) {
        let logFiles: DetectedLoggingService['logFiles'] = [];
        
        if (rsyslogInfo.configPath) {
            try {
                const rsyslogLogFiles = await parseRsyslogConf(rsyslogInfo.configPath);
                logFiles = rsyslogLogFiles.map(log => ({
                    ...log,
                    source: 'config' as const
                }));
            } catch (error) {
                console.warn('[LoggingServiceDetector] Failed to parse rsyslog config:', error);
            }
        }
        
        // If no log files from config, use defaults
        if (logFiles.length === 0) {
            logFiles = getJournaldDefaultLogFiles(); // Reuse default detection
        }
        
        services.push({
            type: 'rsyslog',
            active: rsyslogInfo.active,
            configPath: rsyslogInfo.configPath,
            logFiles
        });
    }
    
    // If no service detected, return a "none" service with default files
    if (services.length === 0) {
        services.push({
            type: 'none',
            active: false,
            logFiles: getJournaldDefaultLogFiles()
        });
    }
    
    return services;
}

/**
 * Get the primary active logging service
 */
export async function getPrimaryLoggingService(): Promise<DetectedLoggingService | null> {
    const services = await detectLoggingServices();
    
    // Prefer journald > syslog-ng > rsyslog > none
    const priority = ['journald', 'syslog-ng', 'rsyslog', 'none'];
    
    for (const serviceType of priority) {
        const service = services.find(s => s.type === serviceType && s.active);
        if (service) {
            return service;
        }
    }
    
    // Return first service if any
    return services.length > 0 ? services[0] : null;
}
