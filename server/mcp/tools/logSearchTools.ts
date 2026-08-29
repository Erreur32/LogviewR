/**
 * Generic log search MCP tools
 *
 * Thin wrappers around the same services the web UI's log-viewer uses
 * (searchAllLogs, LogSourceRepository.findAll) — read-only, no new search
 * layer. Gated by mcp_enabled like every other tool (withMcpGuard).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { searchAllLogs } from '../../services/logSearchService.js';
import { LogSourceRepository } from '../../database/models/LogSource.js';
import { jsonResult, withMcpGuard } from '../mcpConfig.js';

export function registerLogSearchTools(server: McpServer): void {
    server.registerTool(
        'log_list_sources',
        {
            description: 'List configured log sources (plugin IDs, paths) — use this to discover valid pluginIds before calling log_search.',
            inputSchema: {},
        },
        withMcpGuard(async () => {
            const sources = LogSourceRepository.findAll();
            return jsonResult({ sources });
        })
    );

    server.registerTool(
        'log_search',
        {
            description: 'Search across configured log sources for a text query or regex. Mirrors the web UI\'s "search all logs" feature.',
            inputSchema: {
                query: z.string().min(1),
                pluginIds: z.array(z.string()).optional(),
                caseSensitive: z.boolean().optional(),
                useRegex: z.boolean().optional(),
                maxResults: z.number().int().positive().max(500).optional(),
            },
        },
        withMcpGuard(async ({ query, pluginIds, caseSensitive, useRegex, maxResults }) => {
            const result = await searchAllLogs({ query, pluginIds, caseSensitive, useRegex, maxResults });
            return jsonResult(result);
        })
    );
}
