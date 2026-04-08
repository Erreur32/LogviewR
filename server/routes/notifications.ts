/**
 * Notification Routes
 *
 * API endpoints for in-app notification preferences and outbound webhooks
 * (Discord, Telegram, generic HTTP).
 */

import { Router } from 'express';
import crypto from 'crypto';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { autoLog } from '../middleware/loggingMiddleware.js';
import { AppConfigRepository } from '../database/models/AppConfig.js';
import { logger } from '../utils/logger.js';

const router = Router();

// ── SSRF protection — block internal/private URLs in webhooks ────────────────
function validateWebhookUrl(url: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return 'Invalid URL format';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Only http/https URLs are allowed';
    }
    const hostname = parsed.hostname.toLowerCase();
    // Block localhost variants
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]' || hostname === '0.0.0.0') {
        return 'Localhost URLs are not allowed';
    }
    // Block private IP ranges and cloud metadata
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
        const [, a, b] = ipv4Match.map(Number);
        if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)) {
            return 'Private/internal IP addresses are not allowed';
        }
    }
    return null; // OK
}

// ── Interfaces ──────────────────────────────────────────────────────────────────

export interface NotificationPrefs {
    ban: boolean;
    attempt: boolean;
    action: boolean;
}

export interface WebhookEntry {
    id: string;
    name: string;
    type: 'discord' | 'telegram' | 'generic';
    enabled: boolean;
    // Discord / generic
    url?: string;
    // Telegram
    token?: string;
    chatId?: string;
    // Generic
    method?: 'POST' | 'PUT';
    // Event triggers
    events?: { ban: boolean; attempt: boolean; action: boolean };
    // Batching: 0 = immediate, N = group events over N minutes
    batchWindow?: number;
    maxPerBatch?: number;
    // Filtering
    jailFilter?: string[];
    minFailures?: number;
    rateLimit?: number;
    cooldownMinutes?: number;
    activeHours?: { from: number; to: number } | null;
    // Discord enhancements
    discordUsername?: string;
    discordAvatarUrl?: string;
    discordThreadId?: string;
    discordMention?: string;
    discordColors?: { ban?: number; action?: number; unban?: number };
    // Telegram enhancements
    telegramSilent?: boolean;
    telegramThreadId?: string;
    telegramDisablePreview?: boolean;
    // Message templates
    templates?: { banSolo?: string; banGroup?: string; actionSolo?: string };
}

// ── Storage helpers ─────────────────────────────────────────────────────────────

const PREFS_KEY    = 'notification_prefs';
const WEBHOOKS_KEY = 'notification_webhooks';

const DEFAULT_PREFS: NotificationPrefs = { ban: true, attempt: true, action: true };

function getPrefs(): NotificationPrefs {
    const raw = AppConfigRepository.get(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    try { return { ...DEFAULT_PREFS, ...JSON.parse(raw) }; }
    catch { return DEFAULT_PREFS; }
}

function getWebhooks(): WebhookEntry[] {
    const raw = AppConfigRepository.get(WEBHOOKS_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw) as WebhookEntry[]; }
    catch { return []; }
}

function saveWebhooks(webhooks: WebhookEntry[]): void {
    AppConfigRepository.set(WEBHOOKS_KEY, JSON.stringify(webhooks));
}

// ── Prefs endpoints ─────────────────────────────────────────────────────────────

/**
 * GET /api/notifications/prefs
 * Retrieve in-app notification preferences (accessible to any auth'd user).
 */
router.get('/prefs', requireAuth, asyncHandler(async (_req: AuthenticatedRequest, res) => {
    res.json({ success: true, result: getPrefs() });
}));

/**
 * POST /api/notifications/prefs
 * Update in-app notification preferences.
 */
router.post('/prefs', requireAuth, requireAdmin,
    autoLog('notifications', 'update-prefs'),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
        const { ban, attempt, action } = req.body as Partial<NotificationPrefs>;
        const current = getPrefs();
        const updated: NotificationPrefs = {
            ban:     typeof ban === 'boolean'     ? ban     : current.ban,
            attempt: typeof attempt === 'boolean' ? attempt : current.attempt,
            action:  typeof action === 'boolean'  ? action  : current.action,
        };
        AppConfigRepository.set(PREFS_KEY, JSON.stringify(updated));
        res.json({ success: true, result: updated });
    })
);

// ── Webhook CRUD ────────────────────────────────────────────────────────────────

/**
 * GET /api/notifications/webhooks
 */
router.get('/webhooks', requireAuth, requireAdmin, asyncHandler(async (_req: AuthenticatedRequest, res) => {
    res.json({ success: true, result: getWebhooks() });
}));

/**
 * POST /api/notifications/webhooks
 */
router.post('/webhooks', requireAuth, requireAdmin,
    autoLog('notifications', 'add-webhook'),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
        const {
            name, type, url, token, chatId, method, events, batchWindow, maxPerBatch,
            jailFilter, minFailures, rateLimit, cooldownMinutes, activeHours,
            discordUsername, discordAvatarUrl, discordThreadId, discordMention, discordColors,
            telegramSilent, telegramThreadId, telegramDisablePreview,
            templates,
        } = req.body as Partial<WebhookEntry>;

        if (!name || !type) {
            throw createError('name and type are required', 400, 'WEBHOOK_INVALID');
        }
        if (type === 'discord' && !url) {
            throw createError('url is required for Discord webhooks', 400, 'WEBHOOK_INVALID');
        }
        if (type === 'telegram' && (!token || !chatId)) {
            throw createError('token and chatId are required for Telegram', 400, 'WEBHOOK_INVALID');
        }
        if (type === 'generic' && !url) {
            throw createError('url is required for generic webhooks', 400, 'WEBHOOK_INVALID');
        }
        // SSRF check — block private/internal URLs
        if (url) {
            const ssrfErr = validateWebhookUrl(url);
            if (ssrfErr) throw createError(ssrfErr, 400, 'WEBHOOK_INVALID_URL');
        }

        const entry: WebhookEntry = {
            id:      crypto.randomUUID(),
            name:    name!,
            type:    type!,
            enabled: true,
            ...(url    ? { url }    : {}),
            ...(token  ? { token }  : {}),
            ...(chatId ? { chatId } : {}),
            method:      method || 'POST',
            events:      events ?? { ban: true, attempt: false, action: false },
            batchWindow: batchWindow ?? 0,
            maxPerBatch: maxPerBatch ?? 10,
            ...(jailFilter              !== undefined ? { jailFilter }              : {}),
            ...(minFailures             !== undefined ? { minFailures }             : {}),
            ...(rateLimit               !== undefined ? { rateLimit }               : {}),
            ...(cooldownMinutes         !== undefined ? { cooldownMinutes }         : {}),
            ...(activeHours             !== undefined ? { activeHours }             : {}),
            ...(discordUsername         !== undefined ? { discordUsername }         : {}),
            ...(discordAvatarUrl        !== undefined ? { discordAvatarUrl }        : {}),
            ...(discordThreadId         !== undefined ? { discordThreadId }         : {}),
            ...(discordMention          !== undefined ? { discordMention }          : {}),
            ...(discordColors           !== undefined ? { discordColors }           : {}),
            ...(telegramSilent          !== undefined ? { telegramSilent }          : {}),
            ...(telegramThreadId        !== undefined ? { telegramThreadId }        : {}),
            ...(telegramDisablePreview  !== undefined ? { telegramDisablePreview }  : {}),
            ...(templates               !== undefined ? { templates }               : {}),
        };

        const webhooks = getWebhooks();
        webhooks.push(entry);
        saveWebhooks(webhooks);

        res.json({ success: true, result: entry });
    })
);

/**
 * PUT /api/notifications/webhooks/:id
 */
router.put('/webhooks/:id', requireAuth, requireAdmin,
    autoLog('notifications', 'update-webhook'),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
        const { id } = req.params;
        const webhooks = getWebhooks();
        const idx = webhooks.findIndex(w => w.id === id);
        if (idx === -1) throw createError('Webhook not found', 404, 'WEBHOOK_NOT_FOUND');

        const patch = req.body as Partial<WebhookEntry>;
        // SSRF check on URL update
        if (patch.url) {
            const ssrfErr = validateWebhookUrl(patch.url);
            if (ssrfErr) throw createError(ssrfErr, 400, 'WEBHOOK_INVALID_URL');
        }
        // Merge — only override fields that are explicitly present in the body
        const updated: WebhookEntry = { ...webhooks[idx] };
        if (patch.name                !== undefined) updated.name                = patch.name;
        if (patch.type                !== undefined) updated.type                = patch.type;
        if (patch.url                 !== undefined) updated.url                 = patch.url;
        if (patch.token               !== undefined) updated.token               = patch.token;
        if (patch.chatId              !== undefined) updated.chatId              = patch.chatId;
        if (patch.enabled             !== undefined) updated.enabled             = patch.enabled;
        if (patch.method              !== undefined) updated.method              = patch.method;
        if (patch.events              !== undefined) updated.events              = patch.events;
        if (patch.batchWindow         !== undefined) updated.batchWindow         = patch.batchWindow;
        if (patch.maxPerBatch         !== undefined) updated.maxPerBatch         = patch.maxPerBatch;
        if (patch.jailFilter          !== undefined) updated.jailFilter          = patch.jailFilter;
        if (patch.minFailures         !== undefined) updated.minFailures         = patch.minFailures;
        if (patch.rateLimit           !== undefined) updated.rateLimit           = patch.rateLimit;
        if (patch.cooldownMinutes     !== undefined) updated.cooldownMinutes     = patch.cooldownMinutes;
        if (patch.activeHours         !== undefined) updated.activeHours         = patch.activeHours;
        if (patch.discordUsername     !== undefined) updated.discordUsername     = patch.discordUsername;
        if (patch.discordAvatarUrl    !== undefined) updated.discordAvatarUrl    = patch.discordAvatarUrl;
        if (patch.discordThreadId     !== undefined) updated.discordThreadId     = patch.discordThreadId;
        if (patch.discordMention      !== undefined) updated.discordMention      = patch.discordMention;
        if (patch.discordColors       !== undefined) updated.discordColors       = patch.discordColors;
        if (patch.telegramSilent      !== undefined) updated.telegramSilent      = patch.telegramSilent;
        if (patch.telegramThreadId    !== undefined) updated.telegramThreadId    = patch.telegramThreadId;
        if (patch.telegramDisablePreview !== undefined) updated.telegramDisablePreview = patch.telegramDisablePreview;
        if (patch.templates           !== undefined) updated.templates           = patch.templates;

        webhooks[idx] = updated;
        saveWebhooks(webhooks);

        res.json({ success: true, result: updated });
    })
);

/**
 * DELETE /api/notifications/webhooks/:id
 */
router.delete('/webhooks/:id', requireAuth, requireAdmin,
    autoLog('notifications', 'delete-webhook'),
    asyncHandler(async (req: AuthenticatedRequest, res) => {
        const { id } = req.params;
        const webhooks = getWebhooks();
        const filtered = webhooks.filter(w => w.id !== id);
        if (filtered.length === webhooks.length) {
            throw createError('Webhook not found', 404, 'WEBHOOK_NOT_FOUND');
        }
        saveWebhooks(filtered);
        res.json({ success: true, message: 'Webhook deleted' });
    })
);

// ── Test endpoint ───────────────────────────────────────────────────────────────

/**
 * POST /api/notifications/webhooks/:id/test
 * Send a test message to the webhook.
 */
router.post('/webhooks/:id/test', requireAuth, requireAdmin,
    asyncHandler(async (req: AuthenticatedRequest, res) => {
        const { id } = req.params;
        const wh = getWebhooks().find(w => w.id === id);
        if (!wh) throw createError('Webhook not found', 404, 'WEBHOOK_NOT_FOUND');

        try {
            if (wh.type === 'discord') {
                const r = await fetch(wh.url!, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        embeds: [{
                            title: '🔔 LogviewR — Test',
                            description: 'Ce message confirme que le webhook Discord est bien configuré.',
                            color: 0x00b4d8,
                            footer: { text: 'LogviewR Notifications' },
                            timestamp: new Date().toISOString(),
                        }]
                    })
                });
                if (!r.ok) throw new Error(`Discord a répondu : ${r.status} ${r.statusText}`);

            } else if (wh.type === 'telegram') {
                const url = `https://api.telegram.org/bot${wh.token}/sendMessage`;
                const r = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id:    wh.chatId,
                        text:       '🔔 <b>LogviewR — Test</b>\n\nCe message confirme que le webhook Telegram est bien configuré.',
                        parse_mode: 'HTML',
                    })
                });
                const data = await r.json() as { ok: boolean; description?: string };
                if (!data.ok) throw new Error(`Telegram a répondu : ${data.description}`);

            } else {
                const r = await fetch(wh.url!, {
                    method: wh.method || 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        source:    'LogviewR',
                        test:      true,
                        timestamp: new Date().toISOString(),
                        message:   'Test webhook notification',
                    })
                });
                if (!r.ok) throw new Error(`Endpoint a répondu : ${r.status} ${r.statusText}`);
            }

            res.json({ success: true, message: 'Message de test envoyé avec succès' });

        } catch (err: any) {
            logger.warn('Notifications', `Webhook test failed for ${wh.id}:`, err.message);
            throw createError(err.message || 'Test échoué', 502, 'WEBHOOK_TEST_FAILED');
        }
    })
);

// ── Telegram token verifier ─────────────────────────────────────────────────────
router.post('/telegram/verify', requireAuth, requireAdmin,
    asyncHandler(async (req: AuthenticatedRequest, res) => {
        const { token } = req.body as { token?: string };
        if (!token) throw createError('Token manquant', 400, 'MISSING_TOKEN');
        const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await r.json() as { ok: boolean; result?: { username?: string; first_name?: string; id?: number }; description?: string };
        if (!data.ok) throw createError(data.description || 'Token invalide', 400, 'INVALID_TOKEN');
        res.json({ success: true, result: { username: data.result?.username, first_name: data.result?.first_name, id: data.result?.id } });
    })
);

export default router;
