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

    // ── Public API ────────────────────────────────────────────────────────────

    async dispatch(eventType: 'ban' | 'action', payload: BanPayload | ActionPayload): Promise<void> {
        const webhooks = this._getWebhooks().filter(
            wh => wh.enabled && (wh.events?.[eventType] ?? (eventType === 'ban'))
        );

        for (const wh of webhooks) {
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

    private async _sendDiscord(wh: WebhookEntry, events: QueuedEvent[]): Promise<void> {
        const embed = events.length === 1
            ? this._discordSingleEmbed(events[0])
            : this._discordBatchEmbed(events);

        const r = await fetch(wh.url!, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] }),
        });
        if (!r.ok) throw new Error(`Discord HTTP ${r.status}`);
    }

    private _discordSingleEmbed(ev: QueuedEvent): Record<string, unknown> {
        if (ev.type === 'ban') {
            const d = ev.data;
            const dur = d.bantime ? `${Math.round(d.bantime / 60)} min` : 'Permanent';
            return {
                title: '🔴 Nouveau ban Fail2ban',
                color: 0xe74c3c,
                fields: [
                    { name: 'IP',     value: `\`${d.ip}\``, inline: true },
                    { name: 'Jail',   value: d.jail,         inline: true },
                    { name: 'Durée',  value: dur,            inline: true },
                    ...(d.failures != null ? [{ name: 'Échecs',  value: String(d.failures), inline: true }] : []),
                    ...(d.domain        ? [{ name: 'Domaine', value: d.domain,            inline: true }] : []),
                ],
                timestamp: new Date(d.timeofban * 1000).toISOString(),
                footer: { text: 'LogviewR · Fail2ban' },
            };
        } else {
            const d = ev.data;
            return {
                title: d.action === 'ban' ? '🔨 Ban manuel' : '✅ Débannissement',
                color: d.action === 'ban' ? 0xe67e22 : 0x2ecc71,
                fields: [
                    { name: 'IP',   value: `\`${d.ip}\``, inline: true },
                    { name: 'Jail', value: d.jail,         inline: true },
                    ...(d.username ? [{ name: 'Par', value: d.username, inline: true }] : []),
                ],
                timestamp: new Date().toISOString(),
                footer: { text: 'LogviewR · Action manuelle' },
            };
        }
    }

    private _discordBatchEmbed(events: QueuedEvent[]): Record<string, unknown> {
        const banCount    = events.filter(e => e.type === 'ban').length;
        const actionCount = events.filter(e => e.type === 'action').length;
        const lines = events.slice(0, 15).map(e => {
            if (e.type === 'ban') {
                const d = e.data;
                return `• \`${d.ip}\` — ${d.jail}`;
            } else {
                const d = e.data;
                return `• ${d.action === 'ban' ? '🔨' : '✅'} \`${d.ip}\` — ${d.jail}`;
            }
        });
        return {
            title: `📋 ${events.length} événement${events.length > 1 ? 's' : ''} regroupés`,
            color: 0x3498db,
            description: lines.join('\n') + (events.length > 15 ? `\n… et ${events.length - 15} autres` : ''),
            fields: [
                ...(banCount    > 0 ? [{ name: 'Bans auto',       value: String(banCount),    inline: true }] : []),
                ...(actionCount > 0 ? [{ name: 'Actions manuelles', value: String(actionCount), inline: true }] : []),
            ],
            timestamp: new Date().toISOString(),
            footer: { text: 'LogviewR · Résumé groupé' },
        };
    }

    private async _sendTelegram(wh: WebhookEntry, events: QueuedEvent[]): Promise<void> {
        const text = events.length === 1
            ? this._telegramSingleText(events[0])
            : this._telegramBatchText(events);

        const r = await fetch(`https://api.telegram.org/bot${wh.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: wh.chatId, text, parse_mode: 'HTML' }),
        });
        const body = await r.json() as { ok: boolean; description?: string };
        if (!body.ok) throw new Error(`Telegram: ${body.description}`);
    }

    private _telegramSingleText(ev: QueuedEvent): string {
        if (ev.type === 'ban') {
            const d = ev.data;
            const dur = d.bantime ? `${Math.round(d.bantime / 60)} min` : 'Permanent';
            return `🔴 <b>Nouveau ban Fail2ban</b>\n\n` +
                `IP : <code>${d.ip}</code>\nJail : <b>${d.jail}</b>\nDurée : ${dur}` +
                (d.failures != null ? `\nÉchecs : ${d.failures}` : '') +
                (d.domain           ? `\nDomaine : ${d.domain}`  : '');
        } else {
            const d = ev.data;
            return `${d.action === 'ban' ? '🔨' : '✅'} ` +
                `<b>${d.action === 'ban' ? 'Ban manuel' : 'Débannissement'}</b>\n\n` +
                `IP : <code>${d.ip}</code>\nJail : <b>${d.jail}</b>` +
                (d.username ? `\nPar : ${d.username}` : '');
        }
    }

    private _telegramBatchText(events: QueuedEvent[]): string {
        const lines = events.slice(0, 15).map(e => {
            if (e.type === 'ban') {
                const d = e.data;
                return `• <code>${d.ip}</code> — ${d.jail}`;
            } else {
                const d = e.data;
                return `• ${d.action === 'ban' ? '🔨' : '✅'} <code>${d.ip}</code> — ${d.jail}`;
            }
        });
        return `📋 <b>${events.length} événements regroupés</b>\n\n` +
            lines.join('\n') +
            (events.length > 15 ? `\n… et ${events.length - 15} autres` : '');
    }

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

    // ── Helpers ───────────────────────────────────────────────────────────────

    private _getWebhooks(): WebhookEntry[] {
        const raw = AppConfigRepository.get(WEBHOOKS_KEY);
        if (!raw) return [];
        try { return JSON.parse(raw) as WebhookEntry[]; }
        catch { return []; }
    }
}

export const webhookDispatchService = new WebhookDispatchService();
