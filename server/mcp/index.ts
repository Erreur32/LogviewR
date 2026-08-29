#!/usr/bin/env node
/**
 * LogviewR MCP server entrypoint (stdio transport)
 *
 * Launched by the MCP client (Claude Code / Claude Desktop config), not by
 * `npm run dev`. Exposes read-only fail2ban tools plus confirm+audit gated
 * write tools. See server/mcp/auditGate.ts and CLAUDE.md for conventions.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initializeDatabase } from '../database/connection.js';
import { registerFail2banReadTools } from './tools/fail2banReadTools.js';
import { registerFail2banWriteTools } from './tools/fail2banWriteTools.js';
import { registerLogSearchTools } from './tools/logSearchTools.js';
import { registerMcpResources } from './resources.js';

async function main() {
    initializeDatabase();

    const server = new McpServer({
        name: 'logviewr',
        version: '1.0.0',
    });

    registerFail2banReadTools(server);
    registerFail2banWriteTools(server);
    registerLogSearchTools(server);
    registerMcpResources(server);

    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((err) => {
    console.error('[logviewr-mcp] fatal error:', err);
    process.exit(1);
});
