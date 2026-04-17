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

        // Map input field → SQL column + optional value transform
        const fieldMap: Array<{ key: keyof UpdateLogSourceInput; column: string; transform?: (v: unknown) => unknown }> = [
            { key: 'name', column: 'name' },
            { key: 'basePath', column: 'base_path' },
            { key: 'filePatterns', column: 'file_patterns', transform: v => JSON.stringify(v) },
            { key: 'enabled', column: 'enabled', transform: v => v ? 1 : 0 },
            { key: 'follow', column: 'follow', transform: v => v ? 1 : 0 },
            { key: 'maxLines', column: 'max_lines' },
            { key: 'filters', column: 'filters', transform: v => JSON.stringify(v) },
            { key: 'timezone', column: 'timezone' },
            { key: 'healthStatus', column: 'health_status' },
            { key: 'lastHealthCheck', column: 'last_health_check', transform: v => v instanceof Date ? v.toISOString() : v },
        ];

        for (const { key, column, transform } of fieldMap) {
            const v = input[key];
            if (v === undefined) continue;
            updates.push(`${column} = ?`);
            values.push(transform ? transform(v) : v);
        }

        if (updates.length === 0) return this.findById(id);

        updates.push('updated_at = datetime(\'now\')');
        values.push(id);

        db.prepare(`UPDATE log_sources SET ${updates.join(', ')} WHERE id = ?`).run(...values);

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
