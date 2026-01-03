/**
 * Database connection module using SQLite (better-sqlite3)
 * 
 * SQLite is chosen for simplicity - no separate database server needed.
 * Can be easily migrated to PostgreSQL later if needed.
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { initializeDatabaseConfig } from './dbConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database file path
// Use DATABASE_PATH env var if set, otherwise find project root and use data/dashboard.db
function getDatabasePath(): string {
    if (process.env.DATABASE_PATH) {
        return process.env.DATABASE_PATH;
    }
    
    // Find project root by looking for package.json (more reliable than __dirname)
    // This ensures the path is correct even when running with tsx watch
    let projectRoot = process.cwd();
    let currentDir = process.cwd();
    const maxDepth = 10;
    let depth = 0;
    
    // Find project root by looking for package.json
    while (depth < maxDepth && currentDir !== path.dirname(currentDir)) {
        if (fs.existsSync(path.join(currentDir, 'package.json'))) {
            projectRoot = currentDir;
            break;
        }
        currentDir = path.dirname(currentDir);
        depth++;
    }
    
    // Force absolute path from project root
    const dbPath = path.resolve(projectRoot, 'data', 'dashboard.db');
    return dbPath;
}

const dbPath = getDatabasePath();

// Create database instance
let db: Database.Database | null = null;

/**
 * Get or create database connection
 * Creates the database file if it doesn't exist
 */
export function getDatabase(): Database.Database {
    if (!db) {
        // For in-memory database, skip directory creation
        if (dbPath !== ':memory:') {
            // Ensure data directory exists
            const dbDir = path.dirname(dbPath);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }
        }

        db = new Database(dbPath);
        
        // Enable foreign keys
        db.pragma('foreign_keys = ON');
        
        // Apply basic WAL mode first (required before other configs)
        db.pragma('journal_mode = WAL');
        
        // Apply performance configuration (will set other optimizations)
        // Note: initializeDatabaseConfig will be called after schema initialization
        try {
            initializeDatabaseConfig();
        } catch (error) {
            logger.warn('Database', 'Failed to initialize database config (will retry after schema init):', error);
        }
        
        if (dbPath !== ':memory:') {
            logger.success('Database', `Connected to SQLite database: ${dbPath}`);
            if (process.env.NODE_ENV === 'development') {
                logger.info('Database', `Database path: ${dbPath} (project root: ${process.cwd()})`);
            }
        }
    }
    
    return db;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
    if (db) {
        db.close();
        db = null;
        logger.debug('Database', 'Connection closed');
    }
}

/**
 * Force a WAL checkpoint to ensure all changes are written to the main database file
 * This is important in Docker environments where WAL files might not be properly synchronized
 */
export function checkpointWAL(): void {
    try {
        if (db) {
            // Checkpoint the WAL file to ensure all changes are written to the main database
            db.pragma('wal_checkpoint(TRUNCATE)');
            logger.debug('Database', 'WAL checkpoint completed');
        }
    } catch (error) {
        logger.error('Database', 'Failed to checkpoint WAL:', error);
    }
}

/**
 * Initialize database schema (create tables if they don't exist)
 */
export function initializeDatabase(): void {
    const database = getDatabase();
    
    // Users table
    database.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user', 'viewer')),
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME,
            last_login_ip TEXT,
            avatar TEXT
        )
    `);

    // Add new columns if they don't exist (migration for existing databases)
    try {
        database.exec(`
            ALTER TABLE users ADD COLUMN last_login_ip TEXT;
        `);
    } catch (e: any) {
        // Column already exists, ignore error
        if (!e.message?.includes('duplicate column name')) {
            logger.debug('Database', 'Migration: last_login_ip column may already exist');
        }
    }

    try {
        database.exec(`
            ALTER TABLE users ADD COLUMN avatar TEXT;
        `);
    } catch (e: any) {
        // Column already exists, ignore error
        if (!e.message?.includes('duplicate column name')) {
            logger.debug('Database', 'Migration: avatar column may already exist');
        }
    }

    // Plugin configurations table
    database.exec(`
        CREATE TABLE IF NOT EXISTS plugin_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            plugin_id TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            settings TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(plugin_id)
        )
    `);

    // Logs table
    database.exec(`
        CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            username TEXT,
            plugin_id TEXT,
            action TEXT NOT NULL,
            resource TEXT NOT NULL,
            resource_id TEXT,
            details TEXT,
            ip_address TEXT,
            user_agent TEXT,
            level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('info', 'warning', 'error')),
            timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        )
    `);

    // User plugin permissions table
    database.exec(`
        CREATE TABLE IF NOT EXISTS user_plugin_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            plugin_id TEXT NOT NULL,
            can_view INTEGER NOT NULL DEFAULT 1,
            can_edit INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, plugin_id)
        )
    `);

    // App configuration table (for metrics, etc.)
    database.exec(`
        CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Network scans table (for network scan plugin)
    database.exec(`
        CREATE TABLE IF NOT EXISTS network_scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL UNIQUE,
            mac TEXT,
            hostname TEXT,
            vendor TEXT,
            hostname_source TEXT,
            vendor_source TEXT,
            status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('online', 'offline', 'unknown')),
            ping_latency INTEGER,
            first_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            scan_count INTEGER NOT NULL DEFAULT 1,
            additional_info TEXT
        )
    `);
    
    // Migration: Add hostname_source and vendor_source columns if they don't exist
    try {
        database.exec(`
            ALTER TABLE network_scans ADD COLUMN hostname_source TEXT;
        `);
    } catch (error: any) {
        // Column already exists, ignore
        if (!error.message?.includes('duplicate column')) {
            logger.debug('Database', 'Migration: hostname_source column may already exist');
        }
    }
    
    try {
        database.exec(`
            ALTER TABLE network_scans ADD COLUMN vendor_source TEXT;
        `);
    } catch (error: any) {
        // Column already exists, ignore
        if (!error.message?.includes('duplicate column')) {
            logger.debug('Database', 'Migration: vendor_source column may already exist');
        }
    }

    // Network scan history table (tracks each time an IP is seen)
    database.exec(`
        CREATE TABLE IF NOT EXISTS network_scan_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('online', 'offline', 'unknown')),
            ping_latency INTEGER,
            seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ip) REFERENCES network_scans(ip) ON DELETE CASCADE
        )
    `);

    // Latency monitoring tables removed - Latency monitoring system removed

    // Log sources table (configuration for log sources: Apache, Nginx, System, etc.)
    database.exec(`
        CREATE TABLE IF NOT EXISTS log_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            plugin_id TEXT NOT NULL,
            type TEXT NOT NULL,
            base_path TEXT NOT NULL,
            file_patterns TEXT NOT NULL DEFAULT '[]',
            enabled INTEGER NOT NULL DEFAULT 1,
            follow INTEGER NOT NULL DEFAULT 1,
            max_lines INTEGER NOT NULL DEFAULT 1000,
            filters TEXT,
            timezone TEXT,
            health_status TEXT CHECK(health_status IN ('healthy', 'degraded', 'down')),
            last_health_check DATETIME,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Log files table (individual log files within a source)
    database.exec(`
        CREATE TABLE IF NOT EXISTS log_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id INTEGER NOT NULL,
            file_path TEXT NOT NULL,
            log_type TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            follow INTEGER NOT NULL DEFAULT 1,
            max_lines INTEGER NOT NULL DEFAULT 1000,
            filters TEXT,
            last_read_position INTEGER,
            new_lines_count INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (source_id) REFERENCES log_sources(id) ON DELETE CASCADE,
            UNIQUE(source_id, file_path)
        )
    `);

    // Create indexes for better performance
    database.exec(`
        CREATE INDEX IF NOT EXISTS idx_logs_user_id ON logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_logs_plugin_id ON logs(plugin_id);
        CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action);
        CREATE INDEX IF NOT EXISTS idx_user_plugin_permissions_user_id ON user_plugin_permissions(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_plugin_permissions_plugin_id ON user_plugin_permissions(plugin_id);
        CREATE INDEX IF NOT EXISTS idx_network_scans_ip ON network_scans(ip);
        CREATE INDEX IF NOT EXISTS idx_network_scans_last_seen ON network_scans(last_seen);
        CREATE INDEX IF NOT EXISTS idx_network_scans_status ON network_scans(status);
        CREATE INDEX IF NOT EXISTS idx_network_scan_history_ip ON network_scan_history(ip);
        CREATE INDEX IF NOT EXISTS idx_network_scan_history_seen_at ON network_scan_history(seen_at);
        CREATE INDEX IF NOT EXISTS idx_network_scan_history_status ON network_scan_history(status);
        -- Latency monitoring indexes removed - Latency monitoring system removed
        CREATE INDEX IF NOT EXISTS idx_log_sources_plugin_id ON log_sources(plugin_id);
        CREATE INDEX IF NOT EXISTS idx_log_sources_enabled ON log_sources(enabled);
        CREATE INDEX IF NOT EXISTS idx_log_files_source_id ON log_files(source_id);
        CREATE INDEX IF NOT EXISTS idx_log_files_file_path ON log_files(file_path);
        CREATE INDEX IF NOT EXISTS idx_log_files_enabled ON log_files(enabled);
    `);

    logger.success('Database', 'Schema initialized');
}

