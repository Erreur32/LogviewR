/**
 * Read-only fail2ban MCP tools
 *
 * All tools here are pure reads — no confirm gate, no audit entry (audit is
 * reserved for write actions per the MCP server plan).
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Fail2banClientExec } from '../../plugins/fail2ban/Fail2banClientExec.js';
import { getDatabase } from '../../database/connection.js';
import { getF2banMetrics } from '../../services/metricsService.js';
import { attackCorrelationService } from '../../services/attackCorrelationService.js';
import { lookupIp } from '../../services/ipLookupService.js';
import { jsonResult, errorResult, withMcpGuard } from '../mcpConfig.js';

const WHOIS_TTL_SECONDS = 7 * 86400;

export function registerFail2banReadTools(server: McpServer): void {
    const client = new Fail2banClientExec();

    server.registerTool(
        'f2b_list_jails',
        {
            description: 'List all configured fail2ban jails.',
            inputSchema: {},
        },
        withMcpGuard(async () => {
            const jails = await client.listJails();
            return jsonResult({ jails });
        })
    );

    server.registerTool(
        'f2b_jail_status',
        {
            description: 'Get the current status of one fail2ban jail (failed/banned counts, banned IPs).',
            inputSchema: { jail: z.string().min(1) },
        },
        withMcpGuard(async ({ jail }) => {
            const status = await client.getJailStatus(jail);
            if (!status) return errorResult(`Jail "${jail}" not found or fail2ban unavailable.`);
            return jsonResult(status);
        })
    );

    server.registerTool(
        'f2b_get_metrics',
        {
            description: 'Get aggregated fail2ban metrics (jail counts, ban totals, trends).',
            inputSchema: {},
        },
        withMcpGuard(async () => {
            const metrics = await getF2banMetrics();
            if (!metrics) return errorResult('Fail2ban metrics unavailable.');
            return jsonResult(metrics);
        })
    );

    server.registerTool(
        'f2b_get_ban_history',
        {
            description: 'Query LogviewR\'s durable ban history (survives fail2ban\'s own DB purge). Filter by ip and/or jail.',
            inputSchema: {
                ip: z.string().optional(),
                jail: z.string().optional(),
                days: z.number().int().positive().optional(),
                limit: z.number().int().positive().max(1000).optional(),
            },
        },
        withMcpGuard(async ({ ip, jail, days, limit }) => {
            const db = getDatabase();
            const conditions: string[] = ["event_type = 'ban'"];
            const values: (string | number)[] = [];

            if (ip) { conditions.push('ip = ?'); values.push(ip); }
            if (jail) { conditions.push('jail = ?'); values.push(jail); }
            if (days) {
                conditions.push('timeofban >= ?');
                values.push(Math.floor(Date.now() / 1000) - days * 86400);
            }

            const rows = db.prepare(`
                SELECT ip, jail, timeofban, bantime, failures, unban_at
                FROM f2b_events
                WHERE ${conditions.join(' AND ')}
                ORDER BY timeofban DESC
                LIMIT ?
            `).all(...values, limit && limit > 0 ? limit : 100);

            return jsonResult({ events: rows });
        })
    );

    server.registerTool(
        'f2b_lookup_ip',
        {
            description: 'Look up geo/whois/reverse-DNS info for an IP. Reads cached geo/whois first; falls back to a live whois lookup (and caches it) when the cache is stale or missing.',
            inputSchema: { ip: z.string().min(2) },
        },
        withMcpGuard(async ({ ip }) => {
            const db = getDatabase();
            const now = Math.floor(Date.now() / 1000);

            const geo = db.prepare(
                'SELECT lat, lng, country, countryCode, region, city, org FROM f2b_ip_geo WHERE ip = ?'
            ).get(ip) ?? null;

            let whois = db.prepare(
                'SELECT org, country, asn, netname, cidr, ts FROM f2b_whois_cache WHERE ip = ?'
            ).get(ip) as { org: string; country: string; asn: string; netname: string; cidr: string; ts: number } | undefined;

            let whoisSource: 'cache' | 'live' | 'unavailable' = whois ? 'cache' : 'unavailable';
            if (!whois || now - whois.ts > WHOIS_TTL_SECONDS) {
                const live = await lookupIp(ip);
                if (live.whois) {
                    db.prepare(`
                        INSERT OR REPLACE INTO f2b_whois_cache (ip, org, country, asn, netname, cidr, ts)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).run(ip, live.whois.org, live.whois.country, live.whois.asn, live.whois.netname, live.whois.cidr, now);
                    whois = { ...live.whois, ts: now };
                    whoisSource = 'live';
                }
                return jsonResult({ ip, geo, whois: whois ?? null, whoisSource, hostname: live.hostname, knownProvider: live.knownProvider });
            }

            return jsonResult({ ip, geo, whois, whoisSource });
        })
    );

    server.registerTool(
        'f2b_get_active_threats',
        {
            description: 'Detect currently active fail2ban threat clusters: IPs escalating across multiple jails, or coordinated campaigns (multiple IPs sharing an ASN/netname) within a trailing time window.',
            inputSchema: { windowHours: z.number().positive().max(168).optional() },
        },
        withMcpGuard(async ({ windowHours }) => {
            const clusters = await attackCorrelationService.getActiveThreats(windowHours ?? 6);
            return jsonResult({ windowHours: windowHours ?? 6, clusters });
        })
    );
}
