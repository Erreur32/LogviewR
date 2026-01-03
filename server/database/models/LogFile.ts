/**
 * Log File model and database operations
 * 
 * Handles individual log files within a log source
 */

import { getDatabase } from '../connection.js';

export interface LogFile {
    id: number;
    sourceId: number; // Reference to log_sources.id
    filePath: string; // Full path to the log file
    logType: string; // 'nginx_access', 'nginx_error', 'apache_access', 'apache_error', 'syslog', 'auth', 'kern', 'daemon', 'mail', 'custom'
    enabled: boolean;
    follow: boolean; // Tail -f mode for this specific file
    maxLines: number; // Maximum lines to read per request
    filters?: string; // JSON object with filter configuration
    lastReadPosition?: number; // Last line number read (for resuming)
    newLinesCount?: number; // Number of new lines since last read (for badge)
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateLogFileInput {
    sourceId: number;
    filePath: string;
    logType: string;
    enabled?: boolean;
    follow?: boolean;
    maxLines?: number;
    filters?: Record<string, unknown>;
    lastReadPosition?: number;
    newLinesCount?: number;
}

export interface UpdateLogFileInput {
    enabled?: boolean;
    follow?: boolean;
    maxLines?: number;
    filters?: Record<string, unknown>;
    lastReadPosition?: number;
    newLinesCount?: number;
}

/**
 * Log File repository for database operations
 */
export class LogFileRepository {
    /**
     * Create a new log file
     */
    static create(input: CreateLogFileInput): LogFile {
        const db = getDatabase();
        const stmt = db.prepare(`
            INSERT INTO log_files (
                source_id, file_path, log_type, enabled, follow, 
                max_lines, filters, last_read_position, new_lines_count,
                created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        `);

        const result = stmt.run(
            input.sourceId,
            input.filePath,
            input.logType,
            input.enabled ?? true,
            input.follow ?? true,
            input.maxLines ?? 0, // 0 = no limit (was 1000)
            input.filters ? JSON.stringify(input.filters) : null,
            input.lastReadPosition || null,
            input.newLinesCount || 0
        );

        return this.findById(result.lastInsertRowid as number)!;
    }

    /**
     * Find log file by ID
     */
    static findById(id: number): LogFile | null {
        const db = getDatabase();
        const stmt = db.prepare('SELECT * FROM log_files WHERE id = ?');
        const row = stmt.get(id) as any;

        if (!row) {
            return null;
        }

        return this.mapRowToLogFile(row);
    }

    /**
     * Find log file by path
     */
    static findByPath(filePath: string): LogFile | null {
        const db = getDatabase();
        const stmt = db.prepare('SELECT * FROM log_files WHERE file_path = ?');
        const row = stmt.get(filePath) as any;

        if (!row) {
            return null;
        }

        return this.mapRowToLogFile(row);
    }

    /**
     * Find all log files
     */
    static findAll(): LogFile[] {
        const db = getDatabase();
        const stmt = db.prepare('SELECT * FROM log_files ORDER BY created_at DESC');
        const rows = stmt.all() as any[];

        return rows.map(row => this.mapRowToLogFile(row));
    }

    /**
     * Find log files by source ID
     */
    static findBySourceId(sourceId: number): LogFile[] {
        const db = getDatabase();
        const stmt = db.prepare('SELECT * FROM log_files WHERE source_id = ? ORDER BY created_at DESC');
        const rows = stmt.all(sourceId) as any[];

        return rows.map(row => this.mapRowToLogFile(row));
    }

    /**
     * Find enabled log files
     */
    static findEnabled(): LogFile[] {
        const db = getDatabase();
        const stmt = db.prepare('SELECT * FROM log_files WHERE enabled = 1 ORDER BY created_at DESC');
        const rows = stmt.all() as any[];

        return rows.map(row => this.mapRowToLogFile(row));
    }

    /**
     * Update log file
     */
    static update(id: number, input: UpdateLogFileInput): LogFile | null {
        const db = getDatabase();
        const updates: string[] = [];
        const values: unknown[] = [];

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
        if (input.lastReadPosition !== undefined) {
            updates.push('last_read_position = ?');
            values.push(input.lastReadPosition);
        }
        if (input.newLinesCount !== undefined) {
            updates.push('new_lines_count = ?');
            values.push(input.newLinesCount);
        }

        if (updates.length === 0) {
            return this.findById(id);
        }

        updates.push('updated_at = datetime(\'now\')');
        values.push(id);

        const stmt = db.prepare(`
            UPDATE log_files 
            SET ${updates.join(', ')}
            WHERE id = ?
        `);

        stmt.run(...values);

        return this.findById(id);
    }

    /**
     * Delete log file
     */
    static delete(id: number): boolean {
        const db = getDatabase();
        const stmt = db.prepare('DELETE FROM log_files WHERE id = ?');
        const result = stmt.run(id);

        return result.changes > 0;
    }

    /**
     * Delete log files by source ID (when source is deleted)
     */
    static deleteBySourceId(sourceId: number): number {
        const db = getDatabase();
        const stmt = db.prepare('DELETE FROM log_files WHERE source_id = ?');
        const result = stmt.run(sourceId);

        return result.changes;
    }

    /**
     * Upsert log file (create if not exists, update if exists)
     */
    static upsert(input: CreateLogFileInput): LogFile {
        const existing = this.findByPath(input.filePath);
        
        if (existing) {
            return this.update(existing.id, {
                enabled: input.enabled,
                follow: input.follow,
                maxLines: input.maxLines,
                filters: input.filters
            })!;
        }

        return this.create(input);
    }

    /**
     * Map database row to LogFile object
     */
    private static mapRowToLogFile(row: any): LogFile {
        return {
            id: row.id,
            sourceId: row.source_id,
            filePath: row.file_path,
            logType: row.log_type,
            enabled: row.enabled === 1,
            follow: row.follow === 1,
            maxLines: row.max_lines,
            filters: row.filters ? JSON.parse(row.filters) : undefined,
            lastReadPosition: row.last_read_position || undefined,
            newLinesCount: row.new_lines_count || undefined,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        };
    }
}
