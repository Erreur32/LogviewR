/**
 * Base plugin class
 * 
 * Provides common functionality for all plugins
 */

import type { IPlugin, PluginConfig, PluginStats } from './PluginInterface.js';
import * as fsSync from 'fs';

export abstract class BasePlugin implements IPlugin {
    protected id: string;
    protected name: string;
    protected version: string;
    protected config: PluginConfig | null = null;

    constructor(id: string, name: string, version: string) {
        this.id = id;
        this.name = name;
        this.version = version;
    }

    getId(): string {
        return this.id;
    }

    getName(): string {
        return this.name;
    }

    getVersion(): string {
        return this.version;
    }

    async initialize(config: PluginConfig): Promise<void> {
        this.config = config;
        console.log(`[Plugin:${this.id}] Initialized`);
    }

    async start(): Promise<void> {
        if (!this.config) {
            throw new Error(`Plugin ${this.id} not initialized`);
        }
        if (!this.config.enabled) {
            // Don't throw error, just return silently
            // PluginManager will only call start() if enabled, but this provides extra safety
            return;
        }
        console.log(`[Plugin:${this.id}] Started`);
    }

    async stop(): Promise<void> {
        console.log(`[Plugin:${this.id}] Stopped`);
    }

    isEnabled(): boolean {
        return this.config?.enabled === true;
    }

    /**
     * Detect if running in Docker container
     */
    protected isDocker(): boolean {
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
     * Convert a standard log path to Docker path if needed
     * Converts paths starting with /var/log to /host/logs (or /host/var/log if symlink exists)
     * This handles paths like /var/log, /var/log/apache2, /var/log/nginx, etc.
     */
    protected convertToDockerPath(filePath: string): string {
        if (!this.isDocker()) {
            return filePath;
        }

        const HOST_ROOT_PATH = process.env.HOST_ROOT_PATH || '/host';
        const DOCKER_LOG_PATH = '/host/logs';
        const STANDARD_LOG_PATH = '/var/log';

        // If path starts with /var/log, convert it
        if (filePath.startsWith(STANDARD_LOG_PATH)) {
            // Check if /host/logs exists (symlink created by docker-entrypoint.sh)
            if (fsSync.existsSync(DOCKER_LOG_PATH)) {
                // Replace /var/log with /host/logs
                return filePath.replace(STANDARD_LOG_PATH, DOCKER_LOG_PATH);
            } else {
                // Fallback: use /host/var/log (direct mount)
                const dockerPath = filePath.replace(STANDARD_LOG_PATH, `${HOST_ROOT_PATH}/var/log`);
                return dockerPath;
            }
        }

        return filePath;
    }

    /**
     * Resolve the path to use in Docker.
     * - Paths under /var/log: try both /host/logs and /host/var/log (first that exists).
     * - Any other absolute host path (e.g. /home/docker/nginx_proxy/data/logs): prefix with HOST_ROOT_PATH
     *   so the container sees /host/home/docker/nginx_proxy/data/logs (host root is mounted at /host).
     * - Paths already under /host: returned as-is.
     */
    protected resolveDockerPathSync(filePath: string): string {
        if (!this.isDocker()) {
            return this.convertToDockerPath(filePath);
        }
        const HOST_ROOT_PATH = process.env.HOST_ROOT_PATH || '/host';
        // Already a container path (under /host): use as-is
        if (filePath.startsWith(HOST_ROOT_PATH + '/') || filePath === HOST_ROOT_PATH) {
            return filePath;
        }
        // Host path under /var/log: try both /host/logs and /host/var/log
        if (filePath.startsWith('/var/log')) {
            const candidate1 = filePath.replace('/var/log', '/host/logs');
            const candidate2 = filePath.replace('/var/log', `${HOST_ROOT_PATH}/var/log`);
            if (fsSync.existsSync(candidate1)) {
                return candidate1;
            }
            if (fsSync.existsSync(candidate2)) {
                return candidate2;
            }
            return candidate2;
        }
        // Any other absolute host path: prefix with /host so container can read it (e.g. /home/... -> /host/home/...)
        if (filePath.startsWith('/')) {
            return HOST_ROOT_PATH + filePath;
        }
        return filePath;
    }

    abstract getStats(): Promise<PluginStats>;
    abstract testConnection(): Promise<boolean>;
}

