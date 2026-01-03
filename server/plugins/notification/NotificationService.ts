/**
 * Notification Service
 * 
 * Handles sending notifications via webhooks and managing in-app notifications
 */

import { WebhookService } from './WebhookService.js';

export interface Notification {
    id: string;
    type: 'error' | 'attack' | 'performance' | 'warning' | 'info';
    severity: 'low' | 'medium' | 'high' | 'critical';
    title: string;
    message: string;
    details?: Record<string, unknown>;
    timestamp: Date;
    read: boolean;
}

export interface WebhookConfig {
    id: string;
    url: string;
    method: 'POST' | 'PUT';
    headers?: Record<string, string>;
    payloadTemplate?: string;
    enabled: boolean;
}

export class NotificationService {
    private webhookService: WebhookService;
    private notifications: Map<string, Notification> = new Map();
    private maxNotifications = 1000; // Keep last 1000 notifications in memory

    constructor() {
        this.webhookService = new WebhookService();
    }

    /**
     * Register a webhook configuration
     */
    registerWebhook(config: WebhookConfig): void {
        this.webhookService.registerWebhook(config);
    }

    /**
     * Clear all registered webhooks
     */
    clearWebhooks(): void {
        this.webhookService.clearWebhooks();
    }

    /**
     * Test a webhook configuration
     */
    async testWebhook(config: WebhookConfig): Promise<void> {
        await this.webhookService.testWebhook(config);
    }

    /**
     * Send a notification
     * Sends to all enabled webhooks and stores in-app
     */
    async sendNotification(notification: Omit<Notification, 'id' | 'read' | 'timestamp'>): Promise<void> {
        const fullNotification: Notification = {
            ...notification,
            id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(),
            read: false
        };

        // Store notification
        this.notifications.set(fullNotification.id, fullNotification);
        
        // Keep only last maxNotifications
        if (this.notifications.size > this.maxNotifications) {
            const sorted = Array.from(this.notifications.entries())
                .sort((a, b) => a[1].timestamp.getTime() - b[1].timestamp.getTime());
            const toRemove = sorted.slice(0, sorted.length - this.maxNotifications);
            for (const [id] of toRemove) {
                this.notifications.delete(id);
            }
        }

        // Send to webhooks
        await this.webhookService.sendNotification(fullNotification);
    }

    /**
     * Get all notifications
     */
    getNotifications(limit?: number): Notification[] {
        const notifications = Array.from(this.notifications.values())
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        
        return limit ? notifications.slice(0, limit) : notifications;
    }

    /**
     * Get unread notifications count
     */
    getUnreadCount(): number {
        return Array.from(this.notifications.values())
            .filter(n => !n.read).length;
    }

    /**
     * Mark notification as read
     */
    markAsRead(notificationId: string): void {
        const notification = this.notifications.get(notificationId);
        if (notification) {
            notification.read = true;
        }
    }

    /**
     * Mark all notifications as read
     */
    markAllAsRead(): void {
        for (const notification of this.notifications.values()) {
            notification.read = true;
        }
    }

    /**
     * Delete a notification
     */
    deleteNotification(notificationId: string): void {
        this.notifications.delete(notificationId);
    }

    /**
     * Clear all notifications
     */
    clearNotifications(): void {
        this.notifications.clear();
    }
}
