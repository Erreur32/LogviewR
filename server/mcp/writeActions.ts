/**
 * MCP write actions: param guardrails + executor registry
 *
 * Every argument reaching a write tool comes from an LLM that may have read
 * attacker-controlled log content (indirect prompt injection), so it is
 * treated like untrusted input from the internet: strict format checks plus
 * semantic guardrails (never ban LAN/allowlisted IPs, never unban an IP that
 * is part of an active attack). The same validation runs again right before
 * an approved pending action executes, since state may have changed meanwhile.
 *
 * The executor registry is shared by the MCP tools (direct path) and the
 * admin approval route (pending path), so both run the exact same code.
 */

import { isIP } from 'node:net';
import { z } from 'zod';
import { Fail2banClientExec, type F2bClientResult } from '../plugins/fail2ban/Fail2banClientExec.js';
import { getErrorAnalysisConfig } from '../config/errorAnalysisConfig.js';
import { attackCorrelationService } from '../services/attackCorrelationService.js';
import { ipMatchesEntry } from './ipAllowlist.js';
import { MCP_DEFAULT_PRIVATE_RANGES, type McpApprovalMode } from './mcpConfig.js';

export const MCP_WRITE_TOOLS = ['f2b_ban_ip', 'f2b_unban_ip', 'f2b_jail_start', 'f2b_jail_stop'] as const;
export type McpWriteTool = typeof MCP_WRITE_TOOLS[number];

/** Tools that lower protection, the ones an injected prompt would most want to trigger. */
const WEAKENING_TOOLS: ReadonlySet<string> = new Set(['f2b_unban_ip', 'f2b_jail_stop']);

// First char alphanumeric: a leading "-" could be parsed as an option by fail2ban-client.
const JAIL_NAME_RE = /^[A-Za-z0-9][\w.@-]{0,63}$/;
export const MAX_REASON_LENGTH = 200;
/** Trailing window checked before an unban: an IP seen in an active cluster stays banned. */
const UNBAN_THREAT_WINDOW_HOURS = 24;
/** Tool input schemas, so the MCP SDK rejects malformed values before the gate even runs. */
export const ipLiteralSchema = z.string().trim().refine((v) => isIP(v) !== 0, 'Must be a single IPv4 or IPv6 address');
export const jailNameSchema = z.string().trim().regex(JAIL_NAME_RE, 'Invalid jail name');

/** Never banned through MCP: LAN, loopback, link-local, CGNAT, "this network". */
const NEVER_BAN_RANGES = [...MCP_DEFAULT_PRIVATE_RANGES, '169.254.0.0/16', '100.64.0.0/10', '0.0.0.0/8'];

export interface WriteActionParams {
    jail: string;
    ip?: string;
    reason?: string;
}

export function isMcpWriteTool(toolName: string): toolName is McpWriteTool {
    return (MCP_WRITE_TOOLS as readonly string[]).includes(toolName);
}

export function requiresApproval(toolName: string, mode: McpApprovalMode): boolean {
    if (mode === 'none') return false;
    if (mode === 'all') return true;
    return WEAKENING_TOOLS.has(toolName);
}

function needsIp(toolName: McpWriteTool): boolean {
    return toolName === 'f2b_ban_ip' || toolName === 'f2b_unban_ip';
}

/** Keeps only the fields the executor uses, so nothing else an agent sends gets stored or replayed. */
export function pickWriteParams(toolName: McpWriteTool, raw: Record<string, unknown>): WriteActionParams {
    const params: WriteActionParams = { jail: typeof raw.jail === 'string' ? raw.jail.trim() : '' };
    if (needsIp(toolName)) params.ip = typeof raw.ip === 'string' ? raw.ip.trim() : '';
    if (typeof raw.reason === 'string' && raw.reason.trim()) params.reason = raw.reason.trim().slice(0, MAX_REASON_LENGTH);
    return params;
}

function isInRanges(ip: string, ranges: string[]): boolean {
    return ranges.some((entry) => ipMatchesEntry(ip, entry));
}

/** Format checks only (sync), shared by guardrails and the approval route. */
function validateFormat(toolName: McpWriteTool, params: WriteActionParams): string | null {
    if (!JAIL_NAME_RE.test(params.jail)) {
        return `Invalid jail name "${params.jail}": letters, digits, "_", "-", "." and "@" only, starting with a letter or digit.`;
    }
    if (needsIp(toolName) && (!params.ip || isIP(params.ip) === 0)) {
        return `Invalid IP address "${params.ip ?? ''}": a single IPv4 or IPv6 address is required.`;
    }
    return null;
}

/** Returns a refusal message, or null when the action may proceed. */
export async function validateWriteAction(toolName: string, raw: Record<string, unknown>): Promise<string | null> {
    if (!isMcpWriteTool(toolName)) return `Unknown write tool "${toolName}".`;
    const params = pickWriteParams(toolName, raw);

    const formatError = validateFormat(toolName, params);
    if (formatError) return formatError;

    if (toolName === 'f2b_ban_ip') {
        const ip = params.ip!;
        if (isInRanges(ip, NEVER_BAN_RANGES)) {
            return `Refused: ${ip} is a private, loopback or link-local address, MCP never bans those (risk of locking the admin out).`;
        }
        if (isInRanges(ip, getErrorAnalysisConfig().suspiciousIpAllowlist)) {
            return `Refused: ${ip} is in the LogviewR trusted IP allowlist (Settings > Analysis).`;
        }
    }

    if (toolName === 'f2b_unban_ip') {
        const ip = params.ip!;
        const clusters = await attackCorrelationService.getActiveThreats(UNBAN_THREAT_WINDOW_HOURS);
        if (clusters.some((c) => c.ips.includes(ip))) {
            return `Refused: ${ip} belongs to an active threat cluster in the last ${UNBAN_THREAT_WINDOW_HOURS}h, unban it manually from the LogviewR UI if this is really intended.`;
        }
    }

    return null;
}

let client: Fail2banClientExec | null = null;

export async function executeWriteAction(toolName: McpWriteTool, params: WriteActionParams): Promise<F2bClientResult> {
    client ??= new Fail2banClientExec();
    switch (toolName) {
        case 'f2b_ban_ip': return client.banIp(params.jail, params.ip!);
        case 'f2b_unban_ip': return client.unbanIp(params.jail, params.ip!);
        case 'f2b_jail_start': return client.startJail(params.jail);
        case 'f2b_jail_stop': return client.stopJail(params.jail);
    }
}
