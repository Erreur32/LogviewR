/**
 * Notification Plugin
 * 
 * Plugin for sending notifications via webhooks and in-app alerts
 */

import { BasePlugin } from '../base/BasePlugin.js';
import type { PluginConfig, PluginStats } from '../base/PluginInterface.js';
import { NotificationService } from './NotificationService.js';

export interface NotificationPluginConfig {
    enabled: boolean;
    webhooks?: Array<{
        id: string;
        url: string;
        method: 'POST' | 'PUT';
        headers?: Record<string, string>;
        payloadTemplate?: string;
        enabled: boolean;
    }>;
    alertRules?: Array<{
        id: string;
        name: string;
        condition: string; // Pattern or threshold
        severity: 'low' | 'medium' | 'high' | 'critical';
        enabled: boolean;
    }>;
}

export class NotificationPlugin extends BasePlugin {
    private notificationService: NotificationService;

    constructor() {
        super('notification', 'Notifications', '0.1.0');
        this.notificationService = new NotificationService();
    }

    async initialize(config: PluginConfig): Promise<void> {
        await super.initialize(config);
        const settings = config.settings as NotificationPluginConfig;
        
        // Initialize notification service with webhooks
        if (settings.webhooks) {
            for (const webhook of settings.webhooks) {
                if (webhook.enabled) {
                    this.notificationService.registerWebhook(webhook);
                }
            }
        }
        
        console.log('[NotificationPlugin] Initialized');
    }

    async start(): Promise<void> {
        await super.start();
        console.log('[NotificationPlugin] Started');
    }

    async stop(): Promise<void> {
        await super.stop();
        this.notificationService.clearWebhooks();
        console.log('[NotificationPlugin] Stopped');
    }

    async getStats(): Promise<PluginStats> {
        const settings = this.config?.settings as NotificationPluginConfig | undefined;
        const webhookCount = settings?.webhooks?.filter(w => w.enabled).length || 0;
        const ruleCount = settings?.alertRules?.filter(r => r.enabled).length || 0;

        return {
            status: this.config?.enabled ? 'ok' : 'warning',
            message: `${webhookCount} webhook(s) configuré(s), ${ruleCount} règle(s) active(s)`,
            devices: [],
            additional: {
                webhookCount,
                ruleCount
            }
        };
    }

    async testConnection(): Promise<boolean> {
        // Test if at least one webhook is configured and valid
        const settings = this.config?.settings as NotificationPluginConfig | undefined;
        if (!settings?.webhooks || settings.webhooks.length === 0) {
            return false;
        }
        
        // Test first enabled webhook
        const enabledWebhook = settings.webhooks.find(w => w.enabled);
        if (!enabledWebhook) {
            return false;
        }

        try {
            await this.notificationService.testWebhook(enabledWebhook);
            return true;
        } catch {
            return false;
        }
    }
}
