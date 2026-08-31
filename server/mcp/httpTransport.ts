/**
 * Remote HTTP MCP transport (Streamable HTTP, stateless mode)
 *
 * Mounted inside the existing Express app rather than a separate process:
 * network_mode: host already exposes any bound port, and this avoids a
 * second SQLite connection contending for the same WAL file. The stdio
 * transport (server/mcp/index.ts) is untouched and keeps working for local
 * Claude Code/Desktop sessions.
 *
 * Stateless per the SDK's own reference pattern
 * (examples/server/simpleStatelessStreamableHttp.js): no session ID, a fresh
 * McpServer + StreamableHTTPServerTransport per request, closed on
 * completion. No session state means nothing to hijack or replay: every
 * call is authenticated independently by requireMcpToken.
 */

import { Router } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerFail2banReadTools } from './tools/fail2banReadTools.js';
import { registerFail2banWriteTools } from './tools/fail2banWriteTools.js';
import { registerLogSearchTools } from './tools/logSearchTools.js';
import { registerMcpResources } from './resources.js';
import { requireMcpToken, mcpHttpRateLimit } from './httpAuth.js';
import { logger } from '../utils/logger.js';

function buildServer(): McpServer {
    const server = new McpServer({ name: 'logviewr', version: '1.0.0' });
    registerFail2banReadTools(server);
    registerFail2banWriteTools(server);
    registerLogSearchTools(server);
    registerMcpResources(server);
    return server;
}

const router = Router();

router.post('/', mcpHttpRateLimit, requireMcpToken, async (req, res) => {
    const server = buildServer();
    try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
            transport.close();
            server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        logger.error('McpHttp', 'Error handling /mcp request:', error);
        if (!res.headersSent) {
            res.status(500).json({
                jsonrpc: '2.0',
                error: { code: -32603, message: 'Internal server error' },
                id: null,
            });
        }
    }
});

router.get('/', mcpHttpRateLimit, requireMcpToken, (_req, res) => {
    res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed. This endpoint only accepts POST (stateless mode).' },
        id: null,
    });
});

router.delete('/', mcpHttpRateLimit, requireMcpToken, (_req, res) => {
    res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed. This endpoint is stateless, there is no session to delete.' },
        id: null,
    });
});

export default router;
