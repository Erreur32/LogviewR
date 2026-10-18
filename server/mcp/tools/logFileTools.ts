/**
 * log_list_files MCP tool
 *
 * Read-only. Same file source as GET /api/log-viewer/plugins/:pluginId/files
 * (listPluginLogFiles, sizes from fs.stat), file contents are never read.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { pluginManager } from '../../services/pluginManager.js';
import { getActiveLogSourcePluginIds, isLogSourcePlugin, listPluginLogFiles } from '../../services/logFileListService.js';
import type { LogSourcePlugin } from '../../plugins/base/LogSourcePluginInterface.js';
import { logger } from '../../utils/logger.js';
import { errorResult, jsonResult, withMcpGuard } from '../mcpConfig.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface ListedFileEntry {
    pluginId: string;
    path: string;
    type: string;
    size: number;
    modified: string;
}

export type ListFilesResult =
    | { ok: true; files: ListedFileEntry[] }
    | { ok: false; error: string };

/** Largest files first, optionally for one plugin, filtered by minimum size and capped at limit. */
export async function listLogFiles(params: {
    pluginId?: string;
    minSizeBytes?: number;
    limit?: number;
}): Promise<ListFilesResult> {
    const limit = Math.min(params.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const minSize = params.minSizeBytes ?? 0;

    let pluginIds: string[];
    if (params.pluginId) {
        const plugin = pluginManager.getPlugin(params.pluginId);
        if (!plugin) return { ok: false, error: `Unknown plugin: ${params.pluginId}` };
        if (!isLogSourcePlugin(plugin)) return { ok: false, error: `Plugin ${params.pluginId} does not expose log files` };
        pluginIds = [params.pluginId];
    } else {
        pluginIds = getActiveLogSourcePluginIds();
    }

    const entries: ListedFileEntry[] = [];
    for (const pluginId of pluginIds) {
        const plugin = pluginManager.getPlugin(pluginId) as LogSourcePlugin;
        try {
            const { files } = await listPluginLogFiles(pluginId, plugin);
            for (const file of files) {
                if (file.size >= minSize) {
                    entries.push({ pluginId, path: file.path, type: file.type, size: file.size, modified: file.modified.toISOString() });
                }
            }
        } catch (err) {
            // One broken plugin must not hide the others when merging.
            if (params.pluginId) return { ok: false, error: `Failed to list files for ${pluginId}` };
            logger.warn('McpLogFiles', `Skip plugin ${pluginId}:`, err);
        }
    }

    entries.sort((a, b) => b.size - a.size);
    return { ok: true, files: entries.slice(0, limit) };
}

export function registerLogFileTools(server: McpServer): void {
    server.registerTool(
        'log_list_files',
        {
            description: 'List log files with their size, largest first. Optionally restrict to one plugin or to files of at least minSizeBytes. '
                + 'Without pluginId, merges the files of all enabled plugins. Read-only: file contents are not read.',
            inputSchema: {
                pluginId: z.string().max(64).optional(),
                minSizeBytes: z.number().int().min(0).optional(),
                limit: z.number().int().positive().max(MAX_LIMIT).optional(),
            },
        },
        withMcpGuard(async ({ pluginId, minSizeBytes, limit }) => {
            const result = await listLogFiles({ pluginId, minSizeBytes, limit });
            if (result.ok === false) return errorResult(result.error);
            return jsonResult({ files: result.files });
        })
    );
}
