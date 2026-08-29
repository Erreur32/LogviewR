/**
 * MCP resources — read-only views of the same data the audit/threat tools
 * and the web admin panel expose, for clients that prefer to browse
 * resources instead of calling tools.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpActionAuditRepository } from '../database/models/McpActionAudit.js';
import { attackCorrelationService } from '../services/attackCorrelationService.js';
import { assertMcpEnabled, touchHeartbeat } from './mcpConfig.js';

export function registerMcpResources(server: McpServer): void {
    server.registerResource(
        'mcp-audit-recent',
        'logviewr://mcp/audit/recent',
        {
            title: 'Recent MCP action audit trail',
            description: 'The 50 most recent entries in mcp_action_audit (write attempts, confirmations, rejections).',
            mimeType: 'application/json',
        },
        async (uri) => {
            assertMcpEnabled();
            const entries = McpActionAuditRepository.list({ limit: 50 });
            touchHeartbeat();
            return {
                contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ entries }, null, 2) }],
            };
        }
    );

    server.registerResource(
        'mcp-active-threats',
        new ResourceTemplate('logviewr://mcp/threats/{windowHours}', { list: undefined }),
        {
            title: 'Active fail2ban threat clusters',
            description: 'IP escalation / ASN campaign clusters detected within the trailing {windowHours} hours.',
            mimeType: 'application/json',
        },
        async (uri, variables) => {
            assertMcpEnabled();
            const windowHours = Number.parseFloat(String(variables.windowHours)) || 6;
            const clusters = await attackCorrelationService.getActiveThreats(windowHours);
            touchHeartbeat();
            return {
                contents: [
                    { uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ windowHours, clusters }, null, 2) },
                ],
            };
        }
    );
}
