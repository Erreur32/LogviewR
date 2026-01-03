/**
 * Log Source Plugin Interface
 * 
 * Extended interface for plugins that provide log sources
 * All log source plugins must implement this interface
 */

import type { IPlugin } from './PluginInterface.js';

/**
 * Information about a log file
 */
export interface LogFileInfo {
    path: string;
    type: string; // 'access', 'error', 'syslog', etc.
    size: number;
    modified: Date;
}

/**
 * Parsed log entry
 */
export interface ParsedLogEntry {
    timestamp?: Date | string;
    level?: string;
    message: string;
    [key: string]: unknown; // Additional parsed fields
}

/**
 * Extended plugin interface for log sources
 */
export interface LogSourcePlugin extends IPlugin {
    /**
     * Scanner les fichiers de logs disponibles
     * @param basePath Chemin de base pour scanner
     * @param patterns Patterns de fichiers à rechercher (ex: ['access*.log', 'error*.log'])
     * @returns Liste des fichiers de logs trouvés
     */
    scanLogFiles(basePath: string, patterns: string[]): Promise<LogFileInfo[]>;
    
    /**
     * Parser une ligne de log
     * @param line Ligne de log brute
     * @param logType Type de log (ex: 'access', 'error', 'syslog')
     * @returns Objet parsé ou null si la ligne ne peut pas être parsée
     */
    parseLogLine(line: string, logType: string): ParsedLogEntry | null;
    
    /**
     * Obtenir les colonnes pour un type de log
     * @param logType Type de log
     * @returns Liste des noms de colonnes pour le tableau
     */
    getColumns(logType: string): string[];
    
    /**
     * Valider la configuration du plugin
     * @param config Configuration à valider
     * @returns true si la configuration est valide
     */
    validateConfig(config: unknown): boolean;
    
    /**
     * Obtenir les patterns de fichiers par défaut pour ce plugin
     * @returns Tableau de patterns (ex: ['access*.log', 'error*.log'])
     */
    getDefaultFilePatterns(): string[];
    
    /**
     * Obtenir le chemin de base par défaut pour ce plugin
     * @returns Chemin par défaut (ex: '/var/log/apache2/')
     */
    getDefaultBasePath(): string;
}
