/**
 * Authentication service
 * 
 * Handles user authentication using JWT tokens and bcrypt for password hashing
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { UserRepository, type User, type CreateUserInput } from '../database/models/User.js';
import { logger } from '../utils/logger.js';
import crypto from 'node:crypto';
import { getDatabase } from '../database/connection.js';

export interface LoginResult {
    token: string;
    user: Omit<User, 'passwordHash'>;
}

export interface TokenPayload {
    userId: number;
    username: string;
    role: string;
}

export class AuthService {
    private jwtSecret: string;
    private jwtExpiresIn: string;
    /** In-memory blacklist for revoked tokens (token → expiry timestamp) */
    private revokedTokens = new Map<string, number>();

    constructor() {
        const defaultSecrets = [
            'change-me-in-production-please-use-strong-secret',
            'dev_secret_change_in_production'
        ];
        const envSecret = process.env.JWT_SECRET;

        if (envSecret && !defaultSecrets.includes(envSecret)) {
            // Explicit valid secret provided via env — use it
            this.jwtSecret = envSecret;
        } else {
            // No env secret (or default placeholder) — persist a generated one in the DB
            // so it survives container restarts without requiring env var configuration
            this.jwtSecret = this.getOrCreatePersistedSecret();
            if (!envSecret || defaultSecrets.includes(envSecret)) {
                logger.warn('Auth', 'JWT_SECRET not set — using auto-generated secret persisted in database.');
                logger.warn('Auth', 'Set JWT_SECRET in .env for full control over token invalidation.');
            }
        }

        // Load JWT expiration from database, fallback to environment variable, then default
        this.jwtExpiresIn = this.getJwtExpiresIn();

        // Periodically clean up expired entries from the token blacklist (every 10 min)
        setInterval(() => this.cleanupRevokedTokens(), 10 * 60 * 1000);
    }

    /**
     * Get persisted JWT secret from database, or generate and store a new one.
     * This ensures the same secret is reused across container restarts.
     */
    private getOrCreatePersistedSecret(): string {
        try {
            const db = getDatabase();
            const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get('jwt_secret_generated') as { value: string } | undefined;
            if (row?.value) {
                return row.value;
            }
            // First run — generate and persist
            const generated = crypto.randomBytes(48).toString('base64');
            db.prepare(`INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
                .run('jwt_secret_generated', generated);
            return generated;
        } catch {
            // DB not ready yet (startup race) — generate ephemeral secret; will be replaced on next call
            return crypto.randomBytes(48).toString('base64');
        }
    }

    /**
     * Get JWT expiration time from database or environment variable
     * Priority: Database > Environment Variable > Default (7d)
     */
    private getJwtExpiresIn(): string {
        try {
            const db = getDatabase();
            const stmt = db.prepare('SELECT value FROM app_config WHERE key = ?');
            const result = stmt.get('jwt_expires_in') as { value: string } | undefined;
            
            if (result && result.value) {
                return result.value;
            }
        } catch (error) {
            // Database might not be initialized yet, fallback to env var
            logger.debug('Auth', 'Could not read jwt_expires_in from database, using environment variable or default');
        }
        
        return process.env.JWT_EXPIRES_IN || '7d';
    }

    /**
     * Update JWT expiration time in database
     * This will apply to new tokens only (existing tokens keep their expiration)
     */
    updateJwtExpiresIn(expiresIn: string): void {
        // Validate format (should be like "7d", "24h", "30m", etc.)
        const validFormat = /^\d+[smhd]$/i.test(expiresIn);
        if (!validFormat) {
            throw new Error('Invalid JWT expiration format. Use format like "7d", "24h", "30m", "60s"');
        }

        try {
            const db = getDatabase();
            const stmt = db.prepare(`
                INSERT INTO app_config (key, value, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
            `);
            stmt.run('jwt_expires_in', expiresIn);
            
            // Update the instance variable for new tokens
            this.jwtExpiresIn = expiresIn;
            
            logger.info('Auth', `JWT expiration time updated to: ${expiresIn}`);
        } catch (error) {
            logger.error('Auth', `Failed to update JWT expiration time: ${error}`);
            throw error;
        }
    }

    /**
     * Get current JWT expiration time
     */
    getCurrentJwtExpiresIn(): string {
        return this.jwtExpiresIn;
    }

    /**
     * Hash a password using bcrypt
     */
    async hashPassword(password: string): Promise<string> {
        const saltRounds = 10;
        return bcrypt.hash(password, saltRounds);
    }

    /**
     * Verify a password against a hash
     */
    async verifyPassword(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    }

    /**
     * Register a new user
     */
    async register(input: CreateUserInput): Promise<Omit<User, 'passwordHash'>> {
        // Check if username already exists
        if (UserRepository.usernameExists(input.username)) {
            throw new Error('Username already exists');
        }

        // Check if email already exists
        if (UserRepository.emailExists(input.email)) {
            throw new Error('Email already exists');
        }

        // Hash password
        const passwordHash = await this.hashPassword(input.password);

        // Create user
        const user = UserRepository.create(input, passwordHash);

        // Return user without password hash
        const { passwordHash: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    /**
     * Login user and return JWT token
     */
    async login(username: string, password: string, ipAddress?: string): Promise<LoginResult> {
        // Find user by username
        const user = UserRepository.findByUsername(username);
        
        if (!user) {
            throw new Error('Invalid credentials');
        }

        if (!user.enabled) {
            throw new Error('User account is disabled');
        }

        // Verify password
        const valid = await this.verifyPassword(password, user.passwordHash);
        if (!valid) {
            throw new Error('Invalid credentials');
        }

        // Update last login and IP
        UserRepository.updateLastLogin(user.id, ipAddress);

        // Generate JWT token
        const payload: TokenPayload = {
            userId: user.id,
            username: user.username,
            role: user.role
        };

        const token = jwt.sign(payload, this.jwtSecret, {
            algorithm: 'HS256',
            expiresIn: this.jwtExpiresIn
        } as jwt.SignOptions);

        // Return token and user (without password hash)
        const { passwordHash: _, ...userWithoutPassword } = user;
        return {
            token,
            user: userWithoutPassword
        };
    }

    /**
     * Revoke a token (add to blacklist until it naturally expires)
     */
    revokeToken(token: string): void {
        try {
            const decoded = jwt.decode(token) as { exp?: number } | null;
            const expiry = decoded?.exp ? decoded.exp * 1000 : Date.now() + 7 * 24 * 3600 * 1000;
            this.revokedTokens.set(token, expiry);
        } catch {
            // If token can't be decoded, blacklist with 7d TTL
            this.revokedTokens.set(token, Date.now() + 7 * 24 * 3600 * 1000);
        }
        // Cleanup expired entries periodically
        this.cleanupRevokedTokens();
    }

    /**
     * Check if a token has been revoked
     */
    isRevoked(token: string): boolean {
        return this.revokedTokens.has(token);
    }

    /**
     * Remove expired entries from the revocation list
     */
    private cleanupRevokedTokens(): void {
        const now = Date.now();
        for (const [tok, expiry] of this.revokedTokens) {
            if (expiry < now) this.revokedTokens.delete(tok);
        }
    }

    /**
     * Verify JWT token and return payload
     */
    async verifyToken(token: string): Promise<TokenPayload> {
        // Check blacklist first
        if (this.isRevoked(token)) {
            throw new Error('Token has been revoked');
        }
        try {
            const payload = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] }) as TokenPayload;
            return payload;
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new Error('Token expired');
            }
            if (error instanceof jwt.JsonWebTokenError) {
                throw new Error('Invalid token');
            }
            throw new Error('Token verification failed');
        }
    }

    /**
     * Get user from token
     */
    async getUserFromToken(token: string): Promise<User | null> {
        try {
            const payload = await this.verifyToken(token);
            return UserRepository.findById(payload.userId);
        } catch {
            return null;
        }
    }

    /**
     * Change user password
     */
    async changePassword(userId: number, oldPassword: string, newPassword: string): Promise<boolean> {
        if (!newPassword || newPassword.length < 8) throw new Error('Le nouveau mot de passe doit contenir au moins 8 caractères');
        if (newPassword.length > 72) throw new Error('Le mot de passe ne peut pas dépasser 72 caractères');

        const user = UserRepository.findById(userId);
        if (!user) {
            throw new Error('User not found');
        }

        // Verify old password
        const valid = await this.verifyPassword(oldPassword, user.passwordHash);
        if (!valid) {
            throw new Error('Current password is incorrect');
        }

        // Hash new password
        const newPasswordHash = await this.hashPassword(newPassword);

        // Update password
        UserRepository.update(userId, { password: newPasswordHash });
        return true;
    }
}

export const authService = new AuthService();

