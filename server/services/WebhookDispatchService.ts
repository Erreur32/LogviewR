/**
 * Webhook Dispatch Service
 *
 * Dispatches LogviewR events (bans, manual actions) to configured webhooks
 * (Discord, Telegram, generic HTTP) with optional batching/grouping.
 *
 * Hooks:
 *   - fail2banSyncService → 'ban' events for each new ban synced
 *   - Fail2banPlugin ban/unban routes → 'action' events for manual operations
 */

import cron from 'node-cron';
import { AppConfigRepository } from '../database/models/AppConfig.js';
import { logger } from '../utils/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WebhookEntry {
    id: string;
    name: string;
    type: 'discord' | 'telegram' | 'generic';
    enabled: boolean;
    url?: string;
    token?: string;
    chatId?: string;
    method?: string;
    events?: { ban: boolean; attempt: boolean; action: boolean };
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

export interface BanPayload {
    ip: string;
    jail: string;
    timeofban: number;
    bantime?: number | null;
    failures?: number | null;
    domain?: string | null;
}

export interface ActionPayload {
    action: 'ban' | 'unban';
    ip: string;
    jail: string;
    username?: string;
}

type QueuedEvent =
    | { type: 'ban';    data: BanPayload }
    | { type: 'action'; data: ActionPayload };

const WEBHOOKS_KEY = 'notification_webhooks';

// ── Service ───────────────────────────────────────────────────────────────────

class WebhookDispatchService {
    private queues   = new Map<string, QueuedEvent[]>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private cronJobs = new Map<string, any>();
    // Rate limiting: webhookId → { count, windowStart (ms) }
    private rateLimitCounters = new Map<string, { count: number; windowStart: number }>();
    // Cooldown: `${webhookId}:${ip}` → last notification timestamp (ms)
    private cooldownTracker = new Map<string, number>();

    // ── Public API ────────────────────────────────────────────────────────────

    async dispatch(eventType: 'ban' | 'action', payload: BanPayload | ActionPayload): Promise<void> {
        const webhooks = this._getWebhooks().filter(
            wh => wh.enabled && (wh.events?.[eventType] ?? (eventType === 'ban'))
        );

        for (const wh of webhooks) {
            if (!this._passesFilters(wh, eventType, payload)) continue;

            const ev: QueuedEvent = eventType === 'ban'
                ? { type: 'ban',    data: payload as BanPayload }
                : { type: 'action', data: payload as ActionPayload };

            if (!wh.batchWindow || wh.batchWindow === 0) {
                this._send(wh, [ev]).catch(err =>
                    logger.warn('WebhookDispatch', `[${wh.name}] send failed:`, err.message)
                );
            } else {
                if (!this.queues.has(wh.id)) this.queues.set(wh.id, []);
                this.queues.get(wh.id)!.push(ev);
                this._ensureCron(wh);
            }
        }
    }

    // ── Filters ───────────────────────────────────────────────────────────────

    private _passesFilters(wh: WebhookEntry, eventType: 'ban' | 'action', payload: BanPayload | ActionPayload): boolean {
        const now = Date.now();

        // Active hours: only send within the configured window
        if (wh.activeHours) {
            const hour = new Date().getHours();
            const { from, to } = wh.activeHours;
            // Support overnight ranges (e.g. 22→06)
            const inRange = from <= to
                ? hour >= from && hour < to
                : hour >= from || hour < to;
            if (!inRange) return false;
        }

        // Jail filter — ban events only
        if (eventType === 'ban' && wh.jailFilter && wh.jailFilter.length > 0) {
            const banData = payload as BanPayload;
            if (!wh.jailFilter.includes(banData.jail)) return false;
        }

        // Minimum failures — ban events only
        if (eventType === 'ban' && wh.minFailures && wh.minFailures > 0) {
            const banData = payload as BanPayload;
            if ((banData.failures ?? 0) < wh.minFailures) return false;
        }

        // Rate limit: max N notifications per rolling hour window
        if (wh.rateLimit && wh.rateLimit > 0) {
            const counter = this.rateLimitCounters.get(wh.id);
            if (counter) {
                const elapsed = now - counter.windowStart;
                if (elapsed < 3_600_000) {
                    if (counter.count >= wh.rateLimit) return false;
                    counter.count++;
                } else {
                    this.rateLimitCounters.set(wh.id, { count: 1, windowStart: now });
                }
            } else {
                this.rateLimitCounters.set(wh.id, { count: 1, windowStart: now });
            }
        }

        // Per-IP cooldown — ban events only
        if (eventType === 'ban' && wh.cooldownMinutes && wh.cooldownMinutes > 0) {
            const banData = payload as BanPayload;
            const key = `${wh.id}:${banData.ip}`;
            const lastNotified = this.cooldownTracker.get(key);
            if (lastNotified && (now - lastNotified) < wh.cooldownMinutes * 60_000) return false;
            this.cooldownTracker.set(key, now);
        }

        return true;
    }

    // ── Batching ──────────────────────────────────────────────────────────────

    private _ensureCron(wh: WebhookEntry): void {
        if (this.cronJobs.has(wh.id)) return;
        const minutes = wh.batchWindow!;
        const expr = minutes <= 1 ? '* * * * *' : `*/${minutes} * * * *`;
        const task = cron.schedule(expr, () => this._flush(wh.id));
        this.cronJobs.set(wh.id, task);
    }

    private async _flush(webhookId: string): Promise<void> {
        const queue = this.queues.get(webhookId);
        if (!queue || queue.length === 0) return;

        const wh = this._getWebhooks().find(w => w.id === webhookId);
        if (!wh || !wh.enabled) { this.queues.delete(webhookId); return; }

        const max   = wh.maxPerBatch ?? 10;
        const batch = queue.splice(0, max);
        this.queues.set(webhookId, queue);

        this._send(wh, batch).catch(err =>
            logger.warn('WebhookDispatch', `[${wh.name}] flush failed:`, err.message)
        );
    }

    // ── Senders ───────────────────────────────────────────────────────────────

    private async _send(wh: WebhookEntry, events: QueuedEvent[]): Promise<void> {
        if (events.length === 0) return;
        try {
            if      (wh.type === 'discord')  await this._sendDiscord(wh, events);
            else if (wh.type === 'telegram') await this._sendTelegram(wh, events);
            else                             await this._sendGeneric(wh, events);
            logger.debug('WebhookDispatch', `[${wh.name}] sent ${events.length} event(s)`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('WebhookDispatch', `[${wh.name}] error:`, msg);
            throw err;
        }
    }

    // ── Discord ───────────────────────────────────────────────────────────────

    private async _sendDiscord(wh: WebhookEntry, events: QueuedEvent[]): Promise<void> {
        const embed = events.length === 1
            ? this._discordSingleEmbed(wh, events[0])
            : this._discordBatchEmbed(wh, events);

        const payload: Record<string, unknown> = { embeds: [embed] };

        if (wh.discordUsername)  payload.username   = wh.discordUsername;
        if (wh.discordAvatarUrl) payload.avatar_url = wh.discordAvatarUrl;

        // Mention: @here / @everyone / role ID
        if (wh.discordMention) {
            if (wh.discordMention === '@here' || wh.discordMention === '@everyone') {
                payload.content = wh.discordMention;
                payload.allowed_mentions = { parse: ['everyone'] };
            } else {
                payload.content = `<@&${wh.discordMention}>`;
                payload.allowed_mentions = { roles: [wh.discordMention] };
            }
        }

        let url = wh.url!;
        if (wh.discordThreadId) url += `?thread_id=${wh.discordThreadId}`;

        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error(`Discord HTTP ${r.status}`);
    }

    private _discordSingleEmbed(wh: WebhookEntry, ev: QueuedEvent): Record<string, unknown> {
        const colors = wh.discordColors ?? {};

        if (ev.type === 'ban') {
            const d = ev.data;
            const dur = d.bantime ? `${Math.round(d.bantime / 60)} min` : 'Permanent';
            const tplVars = {
                ip: d.ip, jail: d.jail, bantime: dur,
                failures: String(d.failures ?? '—'),
                domain: d.domain ?? '—',
                date: new Date(d.timeofban * 1000).toLocaleDateString('fr-FR'),
                time: new Date(d.timeofban * 1000).toLocaleTimeString('fr-FR'),
            };
            const description = wh.templates?.banSolo
                ? this._renderTemplate(wh.templates.banSolo, tplVars)
                : undefined;

            return {
                title: '🔴 Nouveau ban Fail2ban',
                color: colors.ban ?? 0xe74c3c,
                ...(description
                    ? { description }
                    : {
                        fields: [
                            { name: 'IP',    value: `\`${d.ip}\``, inline: true },
                            { name: 'Jail',  value: d.jail,         inline: true },
                            { name: 'Durée', value: dur,            inline: true },
                            ...(d.failures != null ? [{ name: 'Échecs',  value: String(d.failures), inline: true }] : []),
                            ...(d.domain        ? [{ name: 'Domaine', value: d.domain,            inline: true }] : []),
                        ],
                    }
                ),
                timestamp: new Date(d.timeofban * 1000).toISOString(),
                footer: { text: 'LogviewR · Fail2ban' },
            };
        } else {
            const d = ev.data;
            const isban = d.action === 'ban';
            const tplVars = {
                ip: d.ip, jail: d.jail,
                action: isban ? 'Ban manuel' : 'Débannissement',
                by: d.username ?? '—',
                date: new Date().toLocaleDateString('fr-FR'),
                time: new Date().toLocaleTimeString('fr-FR'),
            };
            const description = wh.templates?.actionSolo
                ? this._renderTemplate(wh.templates.actionSolo, tplVars)
                : undefined;

            return {
                title: isban ? '🔨 Ban manuel' : '✅ Débannissement',
                color: isban ? (colors.action ?? 0xe67e22) : (colors.unban ?? 0x2ecc71),
                ...(description
                    ? { description }
                    : {
                        fields: [
                            { name: 'IP',   value: `\`${d.ip}\``, inline: true },
                            { name: 'Jail', value: d.jail,         inline: true },
                            ...(d.username ? [{ name: 'Par', value: d.username, inline: true }] : []),
                        ],
                    }
                ),
                timestamp: new Date().toISOString(),
                footer: { text: 'LogviewR · Action manuelle' },
            };
        }
    }

    private _discordBatchEmbed(wh: WebhookEntry, events: QueuedEvent[]): Record<string, unknown> {
        const banCount    = events.filter(e => e.type === 'ban').length;
        const actionCount = events.filter(e => e.type === 'action').length;

        // Group bans by jail for richer summary
        const byJail = new Map<string, number>();
        events.filter(e => e.type === 'ban').forEach(e => {
            const jail = (e.data as BanPayload).jail;
            byJail.set(jail, (byJail.get(jail) ?? 0) + 1);
        });

        const listLines = events.slice(0, 15).map(e => {
            if (e.type === 'ban') {
                const d = e.data as BanPayload;
                return `• \`${d.ip}\` — ${d.jail}`;
            } else {
                const d = e.data as ActionPayload;
                return `• ${d.action === 'ban' ? '🔨' : '✅'} \`${d.ip}\` — ${d.jail}`;
            }
        });
        const listText = listLines.join('\n') + (events.length > 15 ? `\n… et ${events.length - 15} autres` : '');

        const description = wh.templates?.banGroup
            ? this._renderTemplate(wh.templates.banGroup, { count: String(events.length), list: listText })
            : listText;

        // Per-jail breakdown when multiple jails involved
        const fields: Record<string, unknown>[] = [];
        if (banCount > 0 && byJail.size > 1) {
            byJail.forEach((count, jail) => {
                fields.push({ name: jail, value: `${count} ban${count > 1 ? 's' : ''}`, inline: true });
            });
        } else {
            if (banCount    > 0) fields.push({ name: 'Bans auto',          value: String(banCount),    inline: true });
            if (actionCount > 0) fields.push({ name: 'Actions manuelles',  value: String(actionCount), inline: true });
        }

        return {
            title: `📋 ${events.length} événement${events.length > 1 ? 's' : ''} regroupés`,
            color: wh.discordColors?.ban ?? 0x3498db,
            description,
            fields,
            timestamp: new Date().toISOString(),
            footer: { text: 'LogviewR · Résumé groupé' },
        };
    }

    // ── Telegram ──────────────────────────────────────────────────────────────

    private async _sendTelegram(wh: WebhookEntry, events: QueuedEvent[]): Promise<void> {
        const text = events.length === 1
            ? this._telegramSingleText(wh, events[0])
            : this._telegramBatchText(wh, events);

        const body: Record<string, unknown> = {
            chat_id:    wh.chatId,
            text,
            parse_mode: 'HTML',
        };
        if (wh.telegramSilent)         body.disable_notification    = true;
        if (wh.telegramThreadId)       body.message_thread_id       = Number.parseInt(wh.telegramThreadId, 10);
        if (wh.telegramDisablePreview) body.disable_web_page_preview = true;

        const r = await fetch(`https://api.telegram.org/bot${wh.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const resp = await r.json() as { ok: boolean; description?: string };
        if (!resp.ok) throw new Error(`Telegram: ${resp.description}`);
    }

    private _telegramSingleText(wh: WebhookEntry, ev: QueuedEvent): string {
        if (ev.type === 'ban') {
            const d = ev.data;
            const dur = d.bantime ? `${Math.round(d.bantime / 60)} min` : 'Permanent';
            if (wh.templates?.banSolo) {
                return this._renderTemplate(wh.templates.banSolo, {
                    ip: d.ip, jail: d.jail, bantime: dur,
                    failures: String(d.failures ?? '—'),
                    domain: d.domain ?? '—',
                    date: new Date(d.timeofban * 1000).toLocaleDateString('fr-FR'),
                    time: new Date(d.timeofban * 1000).toLocaleTimeString('fr-FR'),
                });
            }
            return `🔴 <b>Nouveau ban Fail2ban</b>\n\n` +
                `IP : <code>${d.ip}</code>\nJail : <b>${d.jail}</b>\nDurée : ${dur}` +
                (d.failures != null ? `\nÉchecs : ${d.failures}` : '') +
                (d.domain           ? `\nDomaine : ${d.domain}`  : '');
        } else {
            const d = ev.data;
            const isban = d.action === 'ban';
            if (wh.templates?.actionSolo) {
                return this._renderTemplate(wh.templates.actionSolo, {
                    ip: d.ip, jail: d.jail,
                    action: isban ? 'Ban manuel' : 'Débannissement',
                    by: d.username ?? '—',
                    date: new Date().toLocaleDateString('fr-FR'),
                    time: new Date().toLocaleTimeString('fr-FR'),
                });
            }
            return `${isban ? '🔨' : '✅'} ` +
                `<b>${isban ? 'Ban manuel' : 'Débannissement'}</b>\n\n` +
                `IP : <code>${d.ip}</code>\nJail : <b>${d.jail}</b>` +
                (d.username ? `\nPar : ${d.username}` : '');
        }
    }

    private _telegramBatchText(wh: WebhookEntry, events: QueuedEvent[]): string {
        const lines = events.slice(0, 15).map(e => {
            if (e.type === 'ban') {
                const d = e.data as BanPayload;
                return `• <code>${d.ip}</code> — ${d.jail}`;
            } else {
                const d = e.data as ActionPayload;
                return `• ${d.action === 'ban' ? '🔨' : '✅'} <code>${d.ip}</code> — ${d.jail}`;
            }
        });
        const listText = lines.join('\n') + (events.length > 15 ? `\n… et ${events.length - 15} autres` : '');

        if (wh.templates?.banGroup) {
            return this._renderTemplate(wh.templates.banGroup, {
                count: String(events.length),
                list: listText,
            });
        }
        return `📋 <b>${events.length} événements regroupés</b>\n\n` + listText;
    }

    // ── Generic ───────────────────────────────────────────────────────────────

    private async _sendGeneric(wh: WebhookEntry, events: QueuedEvent[]): Promise<void> {
        const r = await fetch(wh.url!, {
            method: wh.method || 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source:    'LogviewR',
                count:     events.length,
                timestamp: new Date().toISOString(),
                events:    events.map(e => ({
                    type: e.type,
                    ...e.data,
                    timestamp: e.type === 'ban'
                        ? new Date((e.data as BanPayload).timeofban * 1000).toISOString()
                        : new Date().toISOString(),
                })),
            }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }

    // ── Template engine ───────────────────────────────────────────────────────

    private _renderTemplate(template: string, vars: Record<string, string>): string {
        return template.replaceAll(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private _getWebhooks(): WebhookEntry[] {
        const raw = AppConfigRepository.get(WEBHOOKS_KEY);
        if (!raw) return [];
        try { return JSON.parse(raw) as WebhookEntry[]; }
        catch { return []; }
    }
}

export const webhookDispatchService = new WebhookDispatchService();
