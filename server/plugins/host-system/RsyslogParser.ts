/**
 * Rsyslog Configuration Parser
 * 
 * Parses /etc/rsyslog.conf to extract log file paths and their types
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

export interface RsyslogLogFile {
    path: string;
    type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'cron' | 'user' | 'custom';
    facility?: string;
    priority?: string;
    enabled: boolean;
}

/**
 * Parse rsyslog.conf file to extract log file paths
 */
export async function parseRsyslogConf(rsyslogPath: string): Promise<RsyslogLogFile[]> {
    const logFiles: RsyslogLogFile[] = [];
    
    try {
        const content = await fs.readFile(rsyslogPath, 'utf-8');
        const lines = content.split('\n');
        
        // Map of facility to log type
        const facilityToType: Record<string, RsyslogLogFile['type']> = {
            'auth': 'auth',
            'authpriv': 'auth',
            'kern': 'kern',
            'daemon': 'daemon',
            'mail': 'mail',
            'cron': 'cron',
            'user': 'user',
            'syslog': 'syslog'
        };
        
        for (const line of lines) {
            // Skip comments and empty lines
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }
            
            // Skip module and global directives
            if (trimmed.startsWith('module(') || 
                trimmed.startsWith('$') || 
                trimmed.startsWith('input(') ||
                trimmed.startsWith('$IncludeConfig') ||
                trimmed.startsWith('$WorkDirectory')) {
                continue;
            }
            
            // Parse rule lines: facility.priority    destination
            // Examples:
            // auth,authpriv.*                 /var/log/auth.log
            // *.warn;auth,authpriv.none               -/var/log/syslog
            // daemon.*      -/var/log/daemon.log
            // kern.*                          -/var/log/kern.log
            
            // Match facility.priority patterns
            const ruleMatch = trimmed.match(/^([^#]+?)\s+(-?)([^\s#]+)$/);
            if (ruleMatch) {
                const [, facilityPart, asyncFlag, destination] = ruleMatch;
                
                // Skip if destination is not a file path (e.g., :omusrmsg:*)
                if (!destination.startsWith('/') && !destination.startsWith('|')) {
                    continue;
                }
                
                // Skip pipes
                if (destination.startsWith('|')) {
                    continue;
                }
                
                // Extract facilities from facilityPart
                // Examples: "auth,authpriv.*", "*.warn", "daemon.*", "kern.*"
                const facilityPatterns = facilityPart.split(';').map(p => p.trim());
                
                for (const pattern of facilityPatterns) {
                    // Skip negations (e.g., "auth,authpriv.none")
                    if (pattern.includes('.none')) {
                        continue;
                    }
                    
                    // Extract facility name
                    // Match patterns like "auth,authpriv.*", "daemon.*", "*.warn"
                    const facilityMatch = pattern.match(/^([^.*]+)/);
                    if (facilityMatch) {
                        const facilities = facilityMatch[1].split(',').map(f => f.trim());
                        
                        for (const facility of facilities) {
                            // Skip wildcards
                            if (facility === '*') {
                                continue;
                            }
                            
                            const logType = facilityToType[facility] || 'custom';
                            const logPath = destination.trim();
                            
                            // Check if this path already exists
                            const existing = logFiles.find(f => f.path === logPath);
                            if (!existing) {
                                logFiles.push({
                                    path: logPath,
                                    type: logType,
                                    facility: facility,
                                    enabled: true
                                });
                            }
                        }
                    } else if (pattern.startsWith('*.')) {
                        // Wildcard facility (e.g., "*.warn")
                        const logPath = destination.trim();
                        const existing = logFiles.find(f => f.path === logPath);
                        if (!existing) {
                            logFiles.push({
                                path: logPath,
                                type: 'syslog',
                                facility: '*',
                                enabled: true
                            });
                        }
                    }
                }
            }
        }
        
        // Also check included config files in /etc/rsyslog.d/
        // Fix: avoid duplicate rsyslog.d in path
        const rsyslogDir = path.dirname(rsyslogPath);
        let rsyslogD: string;
        
        // If we're already in rsyslog.d directory, use it directly
        // Otherwise, append rsyslog.d to the parent directory
        if (path.basename(rsyslogDir) === 'rsyslog.d') {
            rsyslogD = rsyslogDir;
        } else {
            rsyslogD = path.join(rsyslogDir, 'rsyslog.d');
        }
        
        try {
            const files = await fs.readdir(rsyslogD);
            for (const file of files) {
                if (file.endsWith('.conf')) {
                    const confPath = path.join(rsyslogD, file);
                    try {
                        const includedLogs = await parseRsyslogConf(confPath);
                        // Merge without duplicates
                        for (const log of includedLogs) {
                            if (!logFiles.find(f => f.path === log.path)) {
                                logFiles.push(log);
                            }
                        }
                    } catch (err) {
                        // Skip files that can't be read
                        console.warn(`[RsyslogParser] Failed to parse ${confPath}:`, err);
                    }
                }
            }
        } catch (err) {
            // rsyslog.d directory doesn't exist or can't be read - this is normal, not an error
            // Only log in debug mode to avoid cluttering logs
            if (process.env.DEBUG) {
                console.debug(`[RsyslogParser] Could not read rsyslog.d directory:`, err);
            }
        }
        
    } catch (error) {
        console.error(`[RsyslogParser] Error parsing ${rsyslogPath}:`, error);
    }
    
    return logFiles;
}

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
 * Get rsyslog.conf path (handles Docker mount and local development)
 * In Docker: uses HOST_ROOT_PATH or /host
 * In local dev (npm run dev): uses standard paths directly
 */
export function getRsyslogConfPath(): string {
    // If not in Docker (npm run dev), use standard path directly
    if (!isDocker()) {
        return '/etc/rsyslog.conf';
    }
    
    // In Docker: check host path first, then fallback to standard
    const hostRoot = process.env.HOST_ROOT_PATH || '/host';
    const hostRsyslog = path.join(hostRoot, 'etc', 'rsyslog.conf');
    const standardRsyslog = '/etc/rsyslog.conf';
    
    // Check if host path exists (Docker mount)
    try {
        if (fsSync.existsSync(hostRsyslog)) {
            return hostRsyslog;
        }
    } catch {
        // Fallback to standard path
    }
    
    return standardRsyslog;
}
