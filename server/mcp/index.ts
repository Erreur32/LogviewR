#!/usr/bin/env node
/**
 * LogviewR MCP server entrypoint (stdio transport)
 *
 * Launched by the MCP client (Claude Code / Claude Desktop config), not by
 * `npm run dev`. Exposes read-only fail2ban tools plus confirm+audit gated
 * write tools. See server/mcp/auditGate.ts and CLAUDE.md for conventions.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { initializeDatabase } from '../database/connection.js';
import { buildLogviewrMcpServer } from './buildServer.js';

async function main() {
    initializeDatabase();

    const server = buildLogviewrMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main().catch((err) => {
    console.error('[logviewr-mcp] fatal error:', err);
    process.exit(1);
});
