/**
 * Log Source model and database operations
 * 
 * Handles log source configuration (Apache, Nginx, System, etc.)
 */

import { getDatabase } from '../connection.js';

export interface LogSource {
    id: number;
    name: string;
    pluginId: string; // 'apache', 'nginx', 'npm', 'host-system'
    type: string; // 'nginx', 'nginx_proxy_manager', 'apache', 'syslog', 'custom'
    basePath: string; // Base path for scanning logs (e.g., '/var/log/apache2/')
    filePatterns: string; // JSON array of patterns (e.g., '["access*.log", "error*.log"]')
    enabled: boolean;
    follow: boolean; // Tail -f mode
    maxLines: number; // Maximum lines to read per request
    filters?: string; // JSON object with filter configuration
    timezone?: string; // Timezone for this source (e.g., 'Europe/Paris')
    healthStatus?: string; // 'healthy', 'degraded', 'down'
    lastHealthCheck?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateLogSourceInput {
    name: string;
    pluginId: string;
    type: string;
    basePath: string;
    filePatterns: string[];
    enabled?: boolean;
    follow?: boolean;
    maxLines?: number;
    filters?: Record<string, unknown>;
    timezone?: string;
}

export interface UpdateLogSourceInput {
    name?: string;
    basePath?: string;
    filePatterns?: string[];
    enabled?: boolean;
    follow?: boolean;
    maxLines?: number;
    filters?: Record<string, unknown>;
    timezone?: string;
    healthStatus?: string;
    lastHealthCheck?: Date;
}

/**
 * Log Source repository for database operations
 */
export class LogSourceRepository {
    /**
     * Create a new log source
     */
    static create(input: CreateLogSourceInput): LogSource {
        const db = getDatabase();
        const stmt = db.prepare(`
            INSERT INTO log_sources (
                name, plugin_id, type, base_path, file_patterns, 
                enabled, follow, max_lines, filters, timezone,
                health_status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `);

        const result = stmt.run(
            input.name,
            input.pluginId,
            input.type,
            input.basePath,
            JSON.stringify(input.filePatterns),
            input.enabled ?? true,
            input.follow ?? true,
            input.maxLines ?? 0, // 0 = no limit (was 1000)
            input.filters ? JSON.stringify(input.filters) : null,
            input.timezone || null,
            'healthy'
        );

        return this.findById(result.lastInsertRowid as number)!;
    }

    /**
     * Find log source by ID
     */
    static findById(id: number): LogSource | null {
        const db = getDatabase();
        const stmt = db.prepare('SELECT * FROM log_sources WHERE id = ?');
        const row = stmt.get(id) as any;

        if (!row) {
            return null;
        }

        return this.mapRowToLogSource(row);
    }

    /**
     * Find all log sources
     */
    static findAll(): LogSource[] {
        const db = getDatabase();
        const stmt = db.prepare('SELECT * FROM log_sources ORDER BY created_at DESC');
        const rows = stmt.all() as any[];

        return rows.map(row => this.mapRowToLogSource(row));
    }

    /**
     * Find log sources by plugin ID
     */
    static findByPluginId(pluginId: string): LogSource[] {
        const db = getDatabase();
        const stmt = db.prepare('SELECT * FROM log_sources WHERE plugin_id = ? ORDER BY created_at DESC');
        const rows = stmt.all(pluginId) as any[];

        return rows.map(row => this.mapRowToLogSource(row));
    }

    /**
     * Find enabled log sources
     */
    static findEnabled(): LogSource[] {
        const db = getDatabase();
        const stmt = db.prepare('SELECT * FROM log_sources WHERE enabled = 1 ORDER BY created_at DESC');
        const rows = stmt.all() as any[];

        return rows.map(row => this.mapRowToLogSource(row));
    }

    /**
     * Update log source
     */
    static update(id: number, input: UpdateLogSourceInput): LogSource | null {
        const db = getDatabase();
        const updates: string[] = [];
        const values: unknown[] = [];

        if (input.name !== undefined) {
            updates.push('name = ?');
            values.push(input.name);
        }
        if (input.basePath !== undefined) {
            updates.push('base_path = ?');
            values.push(input.basePath);
        }
        if (input.filePatterns !== undefined) {
            updates.push('file_patterns = ?');
            values.push(JSON.stringify(input.filePatterns));
        }
        if (input.enabled !== undefined) {
            updates.push('enabled = ?');
            values.push(input.enabled ? 1 : 0);
        }
        if (input.follow !== undefined) {
            updates.push('follow = ?');
            values.push(input.follow ? 1 : 0);
        }
        if (input.maxLines !== undefined) {
            updates.push('max_lines = ?');
            values.push(input.maxLines);
        }
        if (input.filters !== undefined) {
            updates.push('filters = ?');
            values.push(JSON.stringify(input.filters));
        }
        if (input.timezone !== undefined) {
            updates.push('timezone = ?');
            values.push(input.timezone);
        }
        if (input.healthStatus !== undefined) {
            updates.push('health_status = ?');
            values.push(input.healthStatus);
        }
        if (input.lastHealthCheck !== undefined) {
            updates.push('last_health_check = ?');
            values.push(input.lastHealthCheck instanceof Date ? input.lastHealthCheck.toISOString() : input.lastHealthCheck);
        }

        if (updates.length === 0) {
            return this.findById(id);
        }

        updates.push('updated_at = datetime(\'now\')');
        values.push(id);

        const stmt = db.prepare(`
            UPDATE log_sources 
            SET ${updates.join(', ')}
            WHERE id = ?
        `);

        stmt.run(...values);

        return this.findById(id);
    }

    /**
     * Delete log source
     */
    static delete(id: number): boolean {
        const db = getDatabase();
        const stmt = db.prepare('DELETE FROM log_sources WHERE id = ?');
        const result = stmt.run(id);

        return result.changes > 0;
    }

    /**
     * Map database row to LogSource object
     */
    private static mapRowToLogSource(row: any): LogSource {
        return {
            id: row.id,
            name: row.name,
            pluginId: row.plugin_id,
            type: row.type,
            basePath: row.base_path,
            filePatterns: row.file_patterns,
            enabled: row.enabled === 1,
            follow: row.follow === 1,
            maxLines: row.max_lines,
            filters: row.filters ? JSON.parse(row.filters) : undefined,
            timezone: row.timezone || undefined,
            healthStatus: row.health_status || undefined,
            lastHealthCheck: row.last_health_check ? new Date(row.last_health_check) : undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        };
    }
}
