/**
 * MCP HTTP API Token Repository
 *
 * Dedicated bearer tokens for the remote HTTP MCP transport, never the
 * browser session JWT, since a headless agent cannot complete an interactive
 * login. Tokens are shown once at creation (GitHub PAT pattern) and stored
 * only as a SHA-256 hash plus a short display prefix.
 */

import crypto from 'node:crypto';
import { getDatabase, checkpointWAL } from '../connection.js';
import { logger } from '../../utils/logger.js';

export type McpTokenScope = 'read' | 'read_write';

export interface McpApiTokenRecord {
    id: number;
    name: string;
    tokenPrefix: string;
    scope: McpTokenScope;
    createdBy: string;
    createdAt: number;
    expiresAt: number;
    lastUsedAt: number | null;
    revokedAt: number | null;
}

export interface CreateMcpApiTokenInput {
    name: string;
    scope: McpTokenScope;
    createdBy: string;
    /** Clamped to [1, MAX_EXPIRY_DAYS]. Defaults to DEFAULT_EXPIRY_DAYS. No unlimited tokens. */
    expiresInDays?: number;
}

export interface CreatedMcpApiToken extends McpApiTokenRecord {
    /** The raw bearer token, only ever available on the create() response, never persisted or re-derivable. */
    token: string;
}

export interface VerifiedMcpToken {
    id: number;
    name: string;
    scope: McpTokenScope;
}

const TOKEN_PREFIX = 'lvr_mcp_';
export const MCP_TOKEN_DEFAULT_EXPIRY_DAYS = 90;
export const MCP_TOKEN_MAX_EXPIRY_DAYS = 365;

function hashToken(token: string): string {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function mapRow(row: any): McpApiTokenRecord {
    return {
        id: row.id,
        name: row.name,
        tokenPrefix: row.token_prefix,
        scope: row.scope,
        createdBy: row.created_by,
        createdAt: row.created_at * 1000,
        expiresAt: row.expires_at * 1000,
        lastUsedAt: row.last_used_at ? row.last_used_at * 1000 : null,
        revokedAt: row.revoked_at ? row.revoked_at * 1000 : null,
    };
}

export class McpApiTokenRepository {
    static create(input: CreateMcpApiTokenInput): CreatedMcpApiToken {
        const db = getDatabase();
        const secret = crypto.randomBytes(32).toString('base64url');
        const token = `${TOKEN_PREFIX}${secret}`;
        const tokenHash = hashToken(token);
        const tokenPrefix = secret.slice(0, 8);

        const days = Math.min(
            Math.max(input.expiresInDays ?? MCP_TOKEN_DEFAULT_EXPIRY_DAYS, 1),
            MCP_TOKEN_MAX_EXPIRY_DAYS
        );
        const expiresAt = Math.floor(Date.now() / 1000) + days * 86400;

        const stmt = db.prepare(`
            INSERT INTO mcp_api_tokens (name, token_hash, token_prefix, scope, created_by, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(input.name, tokenHash, tokenPrefix, input.scope, input.createdBy, expiresAt);
        checkpointWAL();

        const row = db.prepare('SELECT * FROM mcp_api_tokens WHERE id = ?').get(result.lastInsertRowid) as any;
        return { ...mapRow(row), token };
    }

    static list(): McpApiTokenRecord[] {
        const db = getDatabase();
        // Secondary sort on id: created_at has 1-second resolution, so tokens
        // created within the same second would otherwise sort non-deterministically.
        const rows = db.prepare('SELECT * FROM mcp_api_tokens ORDER BY created_at DESC, id DESC').all() as any[];
        return rows.map(mapRow);
    }

    static revoke(id: number): boolean {
        const db = getDatabase();
        const result = db
            .prepare(`UPDATE mcp_api_tokens SET revoked_at = strftime('%s','now') WHERE id = ? AND revoked_at IS NULL`)
            .run(id);
        checkpointWAL();
        return result.changes > 0;
    }

    static touchLastUsed(id: number): void {
        try {
            const db = getDatabase();
            db.prepare(`UPDATE mcp_api_tokens SET last_used_at = strftime('%s','now') WHERE id = ?`).run(id);
        } catch (error) {
            logger.error('McpApiToken', 'Failed to touch last_used_at:', error);
        }
    }

    /** Verifies a raw bearer token against stored hashes. Returns null if unknown, expired, or revoked. */
    static verifyToken(rawToken: string): VerifiedMcpToken | null {
        if (!rawToken || !rawToken.startsWith(TOKEN_PREFIX)) return null;

        const db = getDatabase();
        const providedHash = hashToken(rawToken);
        const row = db.prepare('SELECT * FROM mcp_api_tokens WHERE token_hash = ?').get(providedHash) as any;
        if (!row) return null;

        const providedHashBuf = Buffer.from(providedHash, 'hex');
        const storedHashBuf = Buffer.from(row.token_hash, 'hex');
        if (providedHashBuf.length !== storedHashBuf.length || !crypto.timingSafeEqual(providedHashBuf, storedHashBuf)) {
            return null;
        }

        if (row.revoked_at) return null;

        const now = Math.floor(Date.now() / 1000);
        if (row.expires_at && row.expires_at < now) return null;

        McpApiTokenRepository.touchLastUsed(row.id);
        return { id: row.id, name: row.name, scope: row.scope };
    }
}
