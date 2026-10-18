/**
 * Log file listing shared by GET /api/log-viewer/plugins/:pluginId/files and the
 * MCP tool log_list_files. Sizes come from plugin.scanLogFiles (fs.stat), file
 * contents are never read.
 */

import { pluginManager } from './pluginManager.js';
import { PluginConfigRepository } from '../database/models/PluginConfig.js';
import type { LogSourcePlugin } from '../plugins/base/LogSourcePluginInterface.js';

export interface ListedLogFile {
    path: string;
    type: string;
    size: number;
    modified: Date;
}

export interface PluginFileListing {
    basePath: string;
    patterns: string[];
    files: ListedLogFile[];
}

export function isLogSourcePlugin(plugin: unknown): plugin is LogSourcePlugin {
    const p = plugin as LogSourcePlugin;
    return (
        typeof p.scanLogFiles === 'function' &&
        typeof p.getDefaultBasePath === 'function' &&
        typeof p.getDefaultFilePatterns === 'function'
    );
}

/** Base path saved in the plugin settings, else the plugin default. */
export function getConfiguredBasePath(pluginId: string, plugin: LogSourcePlugin): string {
    const configured = PluginConfigRepository.findByPluginId(pluginId)?.settings?.basePath;
    if (configured && typeof configured === 'string' && configured.trim()) {
        return configured.trim();
    }
    return plugin.getDefaultBasePath();
}

const isCompressedFile = (filePath: string): boolean => /\.(gz|bz2|xz)$/i.test(filePath);

/**
 * Scan a plugin's log files. Compressed files are dropped unless the plugin has
 * readCompressed enabled (and quick is off), as in the Log Viewer.
 */
export async function listPluginLogFiles(
    pluginId: string,
    plugin: LogSourcePlugin,
    options: { basePath?: string; patterns?: string[]; quick?: boolean } = {}
): Promise<PluginFileListing> {
    const readCompressed = (PluginConfigRepository.findByPluginId(pluginId)?.settings?.readCompressed as boolean) ?? false;
    const basePath = options.basePath ?? getConfiguredBasePath(pluginId, plugin);
    const patterns = options.patterns ?? plugin.getDefaultFilePatterns();

    const allFiles = await plugin.scanLogFiles(basePath, patterns);
    const files = options.quick || !readCompressed
        ? allFiles.filter((file) => !isCompressedFile(file.path))
        : allFiles;
    return { basePath, patterns, files };
}

/** IDs of enabled plugins that expose log files. */
export function getActiveLogSourcePluginIds(): string[] {
    return pluginManager
        .getAllPlugins()
        .filter((plugin) => plugin.isEnabled() && isLogSourcePlugin(plugin))
        .map((plugin) => plugin.getId());
}
