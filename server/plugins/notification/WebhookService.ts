/**
 * Webhook Service
 * 
 * Handles sending HTTP requests to webhook endpoints
 */

import type { Notification } from './NotificationService.js';
import type { WebhookConfig } from './NotificationService.js';

export class WebhookService {
    private webhooks: Map<string, WebhookConfig> = new Map();

    /**
     * Register a webhook configuration
     */
    registerWebhook(config: WebhookConfig): void {
        this.webhooks.set(config.id, config);
    }

    /**
     * Clear all registered webhooks
     */
    clearWebhooks(): void {
        this.webhooks.clear();
    }

    /**
     * Test a webhook configuration by sending a test payload
     */
    async testWebhook(config: WebhookConfig): Promise<void> {
        const testPayload = {
            test: true,
            timestamp: new Date().toISOString(),
            message: 'Test notification from LogviewR'
        };

        await this.sendRequest(config, testPayload);
    }

    /**
     * Send a notification to all enabled webhooks
     */
    async sendNotification(notification: Notification): Promise<void> {
        const enabledWebhooks = Array.from(this.webhooks.values())
            .filter(w => w.enabled);

        const promises = enabledWebhooks.map(webhook => 
            this.sendToWebhook(webhook, notification)
        );

        await Promise.allSettled(promises);
    }

    /**
     * Send notification to a specific webhook
     */
    private async sendToWebhook(webhook: WebhookConfig, notification: Notification): Promise<void> {
        let payload: Record<string, unknown>;

        if (webhook.payloadTemplate) {
            // Use custom template
            payload = this.processTemplate(webhook.payloadTemplate, notification);
        } else {
            // Use default payload format
            payload = {
                type: notification.type,
                severity: notification.severity,
                title: notification.title,
                message: notification.message,
                details: notification.details,
                timestamp: notification.timestamp.toISOString()
            };
        }

        await this.sendRequest(webhook, payload);
    }

    /**
     * Process template string with notification data
     * Simple template replacement: {{field}} -> value
     */
    private processTemplate(template: string, notification: Notification): Record<string, unknown> {
        try {
            // Replace template variables
            let processed = template;
            processed = processed.replace(/\{\{type\}\}/g, notification.type);
            processed = processed.replace(/\{\{severity\}\}/g, notification.severity);
            processed = processed.replace(/\{\{title\}\}/g, notification.title);
            processed = processed.replace(/\{\{message\}\}/g, notification.message);
            processed = processed.replace(/\{\{timestamp\}\}/g, notification.timestamp.toISOString());
            
            // Try to parse as JSON
            return JSON.parse(processed);
        } catch {
            // If parsing fails, return as plain object
            return {
                payload: template,
                notification: {
                    type: notification.type,
                    severity: notification.severity,
                    title: notification.title,
                    message: notification.message
                }
            };
        }
    }

    /**
     * Send HTTP request to webhook
     */
    private async sendRequest(webhook: WebhookConfig, payload: Record<string, unknown>): Promise<void> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...webhook.headers
        };

        const response = await fetch(webhook.url, {
            method: webhook.method,
            headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`);
        }
    }
}
