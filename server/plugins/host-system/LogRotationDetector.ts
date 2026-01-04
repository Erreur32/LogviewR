/**
 * Log Rotation Detector
 * 
 * Detects log rotation system (logrotate) and extracts configured log files
 * Falls back to common log files by OS if logrotate is not available
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

export interface LogRotationInfo {
    rotationSystem: 'logrotate' | 'systemd' | 'none' | 'unknown';
    active: boolean;
    configPath?: string;
    configFiles?: string[]; // List of logrotate config files
    configuredLogFiles: Array<{
        path: string;
        type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
        rotationPattern?: string; // e.g., "daily", "weekly", "monthly"
        keepDays?: number;
        compress?: boolean;
    }>;
    commonLogFiles: Array<{
        path: string;
        type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
        osTypes: string[]; // OS types where this file is common
    }>;
}

/**
 * Detect if running in Docker container
 */
function isDocker(): boolean {
    try {
        const cgroup = fsSync.readFileSync('/proc/self/cgroup', 'utf8');
        if (cgroup.includes('docker') || cgroup.includes('containerd')) {
            return true;
        }
    } catch {
        // Not Linux or file doesn't exist
    }
    
    if (process.env.DOCKER === 'true' || process.env.DOCKER_CONTAINER === 'true') {
        return true;
    }
    
    try {
        fsSync.accessSync('/.dockerenv');
        return true;
    } catch {
        return false;
    }
}

/**
 * Get host root path based on environment
 */
function getHostRootPath(): string {
    if (!isDocker()) {
        return '';
    }
    return process.env.HOST_ROOT_PATH || '/host';
}

/**
 * Detect if logrotate is installed
 */
async function detectLogrotate(): Promise<{ active: boolean; configPath?: string }> {
    const hostRoot = getHostRootPath();
    
    // Check if logrotate binary exists
    const logrotatePaths: string[] = [];
    
    if (hostRoot) {
        logrotatePaths.push(
            path.join(hostRoot, 'usr', 'sbin', 'logrotate'),
            path.join(hostRoot, 'sbin', 'logrotate')
        );
    }
    logrotatePaths.push('/usr/sbin/logrotate', '/sbin/logrotate');
    
    let logrotateExists = false;
    for (const logrotatePath of logrotatePaths) {
        try {
            await fs.access(logrotatePath);
            logrotateExists = true;
            break;
        } catch {
            // Continue checking
        }
    }
    
    if (!logrotateExists) {
        return { active: false };
    }
    
    // Check for logrotate configuration files
    const configPaths: string[] = [];
    
    if (hostRoot) {
        configPaths.push(
            path.join(hostRoot, 'etc', 'logrotate.conf'),
            path.join(hostRoot, 'etc', 'logrotate.d')
        );
    }
    configPaths.push('/etc/logrotate.conf', '/etc/logrotate.d');
    
    for (const configPath of configPaths) {
        try {
            const stat = await fs.stat(configPath);
            if (stat.isFile() && configPath.endsWith('logrotate.conf')) {
                return { active: true, configPath };
            } else if (stat.isDirectory() && configPath.endsWith('logrotate.d')) {
                // Main config is usually /etc/logrotate.conf
                const mainConfig = path.join(path.dirname(configPath), 'logrotate.conf');
                try {
                    await fs.access(mainConfig);
                    return { active: true, configPath: mainConfig };
                } catch {
                    return { active: true, configPath: configPath };
                }
            }
        } catch {
            // Continue checking
        }
    }
    
    return { active: logrotateExists };
}

/**
 * Parse logrotate configuration file
 */
async function parseLogrotateConfig(configPath: string): Promise<Array<{
    path: string;
    type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
    rotationPattern?: string;
    keepDays?: number;
    compress?: boolean;
}>> {
    const logFiles: Array<{
        path: string;
        type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
        rotationPattern?: string;
        keepDays?: number;
        compress?: boolean;
    }> = [];
    
    try {
        const content = await fs.readFile(configPath, 'utf-8');
        const lines = content.split('\n');
        
        let currentLogPath: string | null = null;
        let currentRotationPattern: string | undefined;
        let currentKeepDays: number | undefined;
        let currentCompress: boolean | undefined;
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Skip comments and empty lines
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }
            
            // Check for include directive
            if (trimmed.startsWith('include')) {
                const includeMatch = trimmed.match(/include\s+(.+)/);
                if (includeMatch) {
                    const includePath = includeMatch[1].trim();
                    try {
                        const fullIncludePath = includePath.startsWith('/') 
                            ? includePath 
                            : path.join(path.dirname(configPath), includePath);
                        const stat = await fs.stat(fullIncludePath);
                        if (stat.isDirectory()) {
                            // Parse all files in directory
                            const files = await fs.readdir(fullIncludePath);
                            for (const file of files) {
                                if (!file.startsWith('.')) {
                                    const filePath = path.join(fullIncludePath, file);
                                    try {
                                        const includedFiles = await parseLogrotateConfig(filePath);
                                        logFiles.push(...includedFiles);
                                    } catch {
                                        // Skip files that can't be parsed
                                    }
                                }
                            }
                        } else {
                            const includedFiles = await parseLogrotateConfig(fullIncludePath);
                            logFiles.push(...includedFiles);
                        }
                    } catch {
                        // Skip includes that can't be read
                    }
                }
                continue;
            }
            
            // Check if line starts a new log file block
            // Format: /var/log/file.log { ... }
            const logFileMatch = trimmed.match(/^([^\s{]+)\s*\{/);
            if (logFileMatch) {
                // Save previous log file if exists
                if (currentLogPath) {
                    const logType = determineLogType(currentLogPath);
                    logFiles.push({
                        path: currentLogPath,
                        type: logType,
                        rotationPattern: currentRotationPattern,
                        keepDays: currentKeepDays,
                        compress: currentCompress
                    });
                }
                
                // Start new log file
                currentLogPath = logFileMatch[1].trim();
                currentRotationPattern = undefined;
                currentKeepDays = undefined;
                currentCompress = undefined;
                continue;
            }
            
            // Parse rotation directives within a block
            if (currentLogPath && trimmed.includes('{')) {
                // Block continues
                continue;
            }
            
            if (currentLogPath && trimmed === '}') {
                // End of block - save current log file
                const logType = determineLogType(currentLogPath);
                logFiles.push({
                    path: currentLogPath,
                    type: logType,
                    rotationPattern: currentRotationPattern,
                    keepDays: currentKeepDays,
                    compress: currentCompress
                });
                currentLogPath = null;
                continue;
            }
            
            // Parse directives
            if (currentLogPath) {
                if (trimmed.match(/^(daily|weekly|monthly|yearly)$/)) {
                    currentRotationPattern = trimmed;
                } else if (trimmed.startsWith('rotate')) {
                    const rotateMatch = trimmed.match(/rotate\s+(\d+)/);
                    if (rotateMatch) {
                        currentKeepDays = parseInt(rotateMatch[1], 10);
                    }
                } else if (trimmed === 'compress' || trimmed.startsWith('compress')) {
                    currentCompress = true;
                } else if (trimmed === 'nocompress') {
                    currentCompress = false;
                }
            }
        }
        
        // Save last log file if block wasn't closed
        if (currentLogPath) {
            const logType = determineLogType(currentLogPath);
            logFiles.push({
                path: currentLogPath,
                type: logType,
                rotationPattern: currentRotationPattern,
                keepDays: currentKeepDays,
                compress: currentCompress
            });
        }
        
    } catch (error) {
        console.error(`[LogRotationDetector] Error parsing ${configPath}:`, error);
    }
    
    return logFiles;
}

/**
 * Determine log type from file path
 */
function determineLogType(filePath: string): 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom' {
    const filename = path.basename(filePath).toLowerCase();
    
    if (filename.includes('auth') || filename.includes('secure')) {
        return 'auth';
    }
    if (filename.includes('kern')) {
        return 'kern';
    }
    if (filename.includes('daemon')) {
        return 'daemon';
    }
    if (filename.includes('mail')) {
        return 'mail';
    }
    if (filename.includes('syslog') || filename.includes('messages')) {
        return 'syslog';
    }
    
    return 'custom';
}

/**
 * Get common log files by OS type
 */
function getCommonLogFilesByOS(osType: string): Array<{
    path: string;
    type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
    osTypes: string[];
}> {
    const commonFiles: Array<{
        path: string;
        type: 'syslog' | 'auth' | 'kern' | 'daemon' | 'mail' | 'custom';
        osTypes: string[];
    }> = [];
    
    // Linux Mint specific files (must be checked before Debian/Ubuntu)
    if (osType === 'mint') {
        commonFiles.push(
            { path: '/var/log/syslog', type: 'syslog', osTypes: ['mint'] },
            { path: '/var/log/auth.log', type: 'auth', osTypes: ['mint'] },
            { path: '/var/log/kern.log', type: 'kern', osTypes: ['mint'] },
            { path: '/var/log/daemon.log', type: 'daemon', osTypes: ['mint'] },
            { path: '/var/log/mail.log', type: 'mail', osTypes: ['mint'] },
            { path: '/var/log/mail.err', type: 'mail', osTypes: ['mint'] },
            { path: '/var/log/mintupdate.log', type: 'custom', osTypes: ['mint'] }
        );
    }
    
    // Debian/Ubuntu common files
    if (['debian', 'ubuntu'].includes(osType)) {
        commonFiles.push(
            { path: '/var/log/syslog', type: 'syslog', osTypes: ['debian', 'ubuntu'] },
            { path: '/var/log/auth.log', type: 'auth', osTypes: ['debian', 'ubuntu'] },
            { path: '/var/log/kern.log', type: 'kern', osTypes: ['debian', 'ubuntu'] },
            { path: '/var/log/daemon.log', type: 'daemon', osTypes: ['debian', 'ubuntu'] },
            { path: '/var/log/mail.log', type: 'mail', osTypes: ['debian', 'ubuntu'] },
            { path: '/var/log/mail.err', type: 'mail', osTypes: ['debian', 'ubuntu'] }
        );
    }
    
    // CentOS/RHEL/Fedora common files
    if (['centos', 'rhel', 'fedora'].includes(osType)) {
        commonFiles.push(
            { path: '/var/log/messages', type: 'syslog', osTypes: ['centos', 'rhel', 'fedora'] },
            { path: '/var/log/secure', type: 'auth', osTypes: ['centos', 'rhel', 'fedora'] },
            { path: '/var/log/cron', type: 'syslog', osTypes: ['centos', 'rhel', 'fedora'] },
            { path: '/var/log/maillog', type: 'mail', osTypes: ['centos', 'rhel', 'fedora'] },
            { path: '/var/log/boot.log', type: 'syslog', osTypes: ['centos', 'rhel', 'fedora'] }
        );
    }
    
    // Arch common files
    if (osType === 'arch') {
        commonFiles.push(
            { path: '/var/log/messages', type: 'syslog', osTypes: ['arch'] },
            { path: '/var/log/auth.log', type: 'auth', osTypes: ['arch'] },
            { path: '/var/log/kern.log', type: 'kern', osTypes: ['arch'] },
            { path: '/var/log/daemon.log', type: 'daemon', osTypes: ['arch'] }
        );
    }
    
    // SUSE common files
    if (osType === 'suse') {
        commonFiles.push(
            { path: '/var/log/messages', type: 'syslog', osTypes: ['suse'] },
            { path: '/var/log/secure', type: 'auth', osTypes: ['suse'] },
            { path: '/var/log/mail', type: 'mail', osTypes: ['suse'] }
        );
    }
    
    // Universal common files (all Linux)
    commonFiles.push(
        { path: '/var/log/syslog', type: 'syslog', osTypes: ['debian', 'ubuntu', 'mint', 'arch'] },
        { path: '/var/log/messages', type: 'syslog', osTypes: ['centos', 'rhel', 'fedora', 'arch', 'suse'] },
        { path: '/var/log/auth.log', type: 'auth', osTypes: ['debian', 'ubuntu', 'mint', 'arch'] },
        { path: '/var/log/secure', type: 'auth', osTypes: ['centos', 'rhel', 'fedora', 'suse'] }
    );
    
    // Remove duplicates
    const uniqueFiles = new Map<string, typeof commonFiles[0]>();
    for (const file of commonFiles) {
        const existing = uniqueFiles.get(file.path);
        if (existing) {
            // Merge OS types
            const mergedOsTypes = [...new Set([...existing.osTypes, ...file.osTypes])];
            uniqueFiles.set(file.path, { ...existing, osTypes: mergedOsTypes });
        } else {
            uniqueFiles.set(file.path, file);
        }
    }
    
    return Array.from(uniqueFiles.values());
}

/**
 * Detect log rotation system and get configured log files
 */
export async function detectLogRotation(osType: string = 'unknown'): Promise<LogRotationInfo> {
    const result: LogRotationInfo = {
        rotationSystem: 'unknown',
        active: false,
        configuredLogFiles: [],
        commonLogFiles: getCommonLogFilesByOS(osType)
    };
    
    // Try to detect logrotate
    const logrotateInfo = await detectLogrotate();
    
    if (logrotateInfo.active && logrotateInfo.configPath) {
        result.rotationSystem = 'logrotate';
        result.active = true;
        result.configPath = logrotateInfo.configPath;
        
        try {
            // Parse main config file
            const mainConfigFiles = await parseLogrotateConfig(logrotateInfo.configPath);
            result.configuredLogFiles.push(...mainConfigFiles);
            
            // Parse files in /etc/logrotate.d/
            const logrotateDir = path.join(path.dirname(logrotateInfo.configPath), 'logrotate.d');
            try {
                const files = await fs.readdir(logrotateDir);
                for (const file of files) {
                    if (!file.startsWith('.') && !file.endsWith('~')) {
                        const filePath = path.join(logrotateDir, file);
                        try {
                            const configFiles = await parseLogrotateConfig(filePath);
                            result.configuredLogFiles.push(...configFiles);
                        } catch {
                            // Skip files that can't be parsed
                        }
                    }
                }
                result.configFiles = files.filter(f => !f.startsWith('.') && !f.endsWith('~'));
            } catch {
                // logrotate.d directory doesn't exist or can't be read
            }
        } catch (error) {
            console.warn('[LogRotationDetector] Error parsing logrotate config:', error);
        }
    } else {
        // Check for systemd (journald handles rotation)
        const hostRoot = getHostRootPath();
        const systemdPaths: string[] = [];
        
        if (hostRoot) {
            systemdPaths.push(
                path.join(hostRoot, 'usr', 'lib', 'systemd'),
                path.join(hostRoot, 'lib', 'systemd')
            );
        }
        systemdPaths.push('/usr/lib/systemd', '/lib/systemd');
        
        for (const systemdPath of systemdPaths) {
            try {
                const stat = await fs.stat(systemdPath);
                if (stat.isDirectory()) {
                    result.rotationSystem = 'systemd';
                    result.active = true;
                    break;
                }
            } catch {
                // Continue checking
            }
        }
        
        if (result.rotationSystem === 'unknown') {
            result.rotationSystem = 'none';
        }
    }
    
    return result;
}
