/**
 * Nginx Proxy Manager (NPM) Log Plugin
 * 
 * Plugin for reading NPM access and error logs
 */

import { BasePlugin } from '../base/BasePlugin.js';
import { NpmParser } from './NpmParser.js';
import type { LogSourcePlugin, LogFileInfo, ParsedLogEntry } from '../base/LogSourcePluginInterface.js';
import type { PluginStats } from '../base/PluginInterface.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface NpmPluginConfig {
    basePath: string;
    accessLogPattern: string;
    enabled: boolean;
    follow: boolean;
    maxLines: number;
    excludeFilters?: {
        files?: string[];
        directories?: string[];
        paths?: string[];
    };
}

export class NpmLogPlugin extends BasePlugin implements LogSourcePlugin {
    constructor() {
        super('npm', 'Nginx Proxy Manager Logs', '0.1.5');
    }

    async getStats(): Promise<PluginStats> {
        // NPM plugin doesn't provide device/network stats
        return {};
    }

    async testConnection(): Promise<boolean> {
        const config = this.config?.settings as NpmPluginConfig | undefined;
        const basePath = config?.basePath || this.getDefaultBasePath();
        const actualBasePath = this.resolveDockerPathSync(basePath);
        try {
            await fs.access(actualBasePath);
            return true;
        } catch (err: unknown) {
            const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : 'unknown';
            console.warn(
                `[Plugin:npm] testConnection failed. Path checked: ${actualBasePath} (from basePath: ${basePath}). Error: ${code}. ` +
                `To verify in container run: docker exec <container> ls -la ${actualBasePath}`
            );
            return false;
        }
    }

    /**
     * Check if a file or directory should be excluded based on configured filters
     */
    private shouldExclude(filePath: string, entryName: string, isDirectory: boolean): boolean {
        const config = this.config?.settings as NpmPluginConfig | undefined;
        const excludeFilters = config?.excludeFilters;
        
        if (!excludeFilters) {
            return false;
        }
        
        // Check full path exclusions
        if (excludeFilters.paths && excludeFilters.paths.length > 0) {
            for (const excludePath of excludeFilters.paths) {
                if (filePath === excludePath || filePath.startsWith(excludePath + '/')) {
                    return true;
                }
            }
        }
        
        // Convert glob patterns to regex
        const globToRegex = (pattern: string): RegExp => {
            let regexStr = pattern
                .replace(/\./g, '\\.')
                .replace(/\*\*/g, '.*')
                .replace(/\*/g, '[^/]*')
                .replace(/\?/g, '.');
            return new RegExp(`^${regexStr}$`);
        };
        
        // Check directory exclusions
        if (isDirectory && excludeFilters.directories && excludeFilters.directories.length > 0) {
            for (const dirPattern of excludeFilters.directories) {
                const regex = globToRegex(dirPattern);
                if (regex.test(entryName)) {
                    return true;
                }
            }
        }
        
        // Check file exclusions
        if (!isDirectory && excludeFilters.files && excludeFilters.files.length > 0) {
            for (const filePattern of excludeFilters.files) {
                const regex = globToRegex(filePattern);
                if (regex.test(entryName)) {
                    return true;
                }
            }
        }
        
        return false;
    }

    async scanLogFiles(basePath: string, patterns: string[]): Promise<LogFileInfo[]> {
        const results: LogFileInfo[] = [];
        const actualBasePath = this.resolveDockerPathSync(basePath);
        try {
            // Same glob-to-regex as Apache: optional rotation (.1, .2) and compression (.gz, .bz2, .xz) after .log
            const regexPatterns = patterns.map(p => {
                let regexStr = p
                    .replace(/\./g, '\\.')
                    .replace(/\*\*/g, '.*')
                    .replace(/\*/g, '[^/]*')
                    .replace(/\?/g, '.');
                if (regexStr.endsWith('\\.log')) {
                    regexStr = regexStr + '(?:\\.\\d+)?(?:\\.(?:gz|bz2|xz))?';
                }
                return new RegExp(`^${regexStr}$`);
            });

            const scanDirectory = async (dir: string): Promise<void> => {
                try {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        
                        // Check exclusion filters first
                        if (this.shouldExclude(fullPath, entry.name, entry.isDirectory())) {
                            continue;
                        }
                        
                        if (entry.name === 'node_modules') {
                            continue;
                        }
                        
                        if (entry.isDirectory()) {
                            await scanDirectory(fullPath);
                        } else if (entry.isFile()) {
                            const matches = regexPatterns.some(regex => regex.test(entry.name));
                            
                            if (matches) {
                                try {
                                    const stats = await fs.stat(fullPath);
                                    const logType = this.determineLogType(fullPath);
                                    
                                    results.push({
                                        path: fullPath,
                                        type: logType,
                                        size: stats.size,
                                        modified: stats.mtime
                                    });
                                } catch {
                                    // Skip files we can't access
                                }
                            }
                        }
                    }
                } catch {
                    // Skip directories we can't access
                }
            };

            await scanDirectory(actualBasePath);
        } catch (error) {
            console.error(
                `[NpmLogPlugin] Error scanning files at ${actualBasePath} (basePath: ${basePath}). ` +
                `Verify access in container: docker exec <container> ls -la ${actualBasePath}`,
                error
            );
        }
        
        return results;
    }

    parseLogLine(line: string, logType: string): ParsedLogEntry | null {
        if (!line || line.trim().length === 0) {
            return null;
        }

        switch (logType) {
            case 'access':
                return NpmParser.parseAccessLine(line);
            case 'error':
                return NpmParser.parseErrorLine(line);
            default:
                // Try access format first, then error
                return NpmParser.parseAccessLine(line) || NpmParser.parseErrorLine(line);
        }
    }

    getColumns(logType: string): string[] {
        switch (logType) {
            case 'access':
                // Include all possible columns (cache, upstreamStatus, gzip may be present in NPM formats)
                return ['timestamp', 'ip', 'method', 'url', 'status', 'size', 'referer', 'userAgent', 'host', 'upstream', 'responseTime', 'cache', 'upstreamStatus', 'gzip'];
            case 'error':
                // Aligned with Nginx error columns — NpmParser.parseErrorLine extracts pid/tid
                return ['timestamp', 'level', 'pid', 'tid', 'message'];
            default:
                return ['timestamp', 'level', 'message'];
        }
    }

    validateConfig(config: unknown): boolean {
        if (!config || typeof config !== 'object') {
            return false;
        }

        const cfg = config as NpmPluginConfig;
        
        if (typeof cfg.basePath !== 'string' || cfg.basePath.length === 0) {
            return false;
        }
        if (typeof cfg.accessLogPattern !== 'string') {
            return false;
        }
        if (typeof cfg.enabled !== 'boolean') {
            return false;
        }
        if (typeof cfg.follow !== 'boolean') {
            return false;
        }
        if (typeof cfg.maxLines !== 'number' || cfg.maxLines < 0) {
            return false;
        }

        return true;
    }

    getDefaultFilePatterns(): string[] {
        return [
            'proxy-host-*_access.log*',
            'proxy-host-*_error.log*',
            'default-host_access.log*',
            'default-host_error.log*',
            'fallback_access.log*',
            'fallback_error.log*',
            'dead-host-*_access.log*',
            'dead-host-*_error.log*',
            'letsencrypt-requests_access.log*',
            'letsencrypt-requests_error.log*',
            '*.access.log*',
            '*.error.log*'
        ];
    }

    getDefaultBasePath(): string {
        // Try common NPM log paths
        const possiblePaths = [
            '/var/log/npm',
            '/data/logs',
            '/app/data/logs',
            '/npm/data/logs'
        ];
        
        // Return the first path that exists (will be checked at runtime)
        // Default to /var/log/npm as it's the most common location
        return '/var/log/npm';
    }

    /**
     * Determine log type from file path
     * 
     * IMPORTANT: We must check for 'error' BEFORE 'proxy-host' because files
     * like 'proxy-host-12_error.log' contain both substrings.
     * If we checked 'proxy-host' first, error logs would be misclassified
     * as access logs, causing the access parser to fail on error log lines.
     */
    private determineLogType(filePath: string): string {
        const filename = path.basename(filePath).toLowerCase();
        
        // Check for 'error' first — proxy-host-*_error.log must be typed as 'error'
        if (filename.includes('error')) {
            return 'error';
        }
        if (filename.includes('access') || filename.includes('proxy-host')) {
            return 'access';
        }
        
        return 'access'; // Default to access
    }
}
