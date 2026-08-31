/**
 * Per-request MCP actor/scope context
 *
 * The stdio transport is one process per session, so a single env var
 * (LOGVIEWR_MCP_ACTOR) was enough to identify the caller. The HTTP transport
 * shares one process across many concurrent requests, each authenticated by
 * a different bearer token: AsyncLocalStorage carries that token's identity
 * through to auditGate.ts without threading it through every tool handler.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { McpTokenScope } from '../database/models/McpApiToken.js';

export interface McpRequestContext {
    actor: string;
    scope: McpTokenScope;
}

const storage = new AsyncLocalStorage<McpRequestContext>();

export function runWithMcpContext<T>(context: McpRequestContext, fn: () => T): T {
    return storage.run(context, fn);
}

/** Falls back to the stdio env var with full read_write scope when no HTTP context is active. */
export function getMcpContext(): McpRequestContext {
    const ctx = storage.getStore();
    if (ctx) return ctx;
    return {
        actor: process.env.LOGVIEWR_MCP_ACTOR || 'unknown-mcp-agent',
        scope: 'read_write',
    };
}
