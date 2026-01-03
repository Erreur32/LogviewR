/**
 * Log Viewer WebSocket Service
 * 
 * Provides real-time log streaming via WebSocket
 * Clients can subscribe to specific log files and receive parsed log entries
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { WebSocket as WsType } from 'ws';
import { logger } from '../utils/logger.js';
import { logParserService } from './logParserService.js';
import { logReaderService } from './logReaderService.js';
import { PluginConfigRepository } from '../database/models/PluginConfig.js';

type ClientWebSocket = WsType & { 
    isAlive?: boolean;
    subscriptions?: Map<string, {
        filePath: string;
        pluginId: string;
        logType: string;
        stopFollowing?: () => void;
    }>;
};

interface SubscribeMessage {
    type: 'subscribe';
    fileId: string;
    pluginId: string;
    filePath: string;
    logType: string;
    follow?: boolean;
    fromLine?: number;
}

interface UnsubscribeMessage {
    type: 'unsubscribe';
    fileId: string;
}

interface FilterMessage {
    type: 'filter';
    fileId: string;
    filters: Record<string, unknown>;
}

type ClientMessage = SubscribeMessage | UnsubscribeMessage | FilterMessage;

class LogViewerWebSocketService {
    private wss: WebSocketServer | null = null;
    private pingInterval: NodeJS.Timeout | null = null;

    /**
     * Initialize the WebSocket server for log viewer
     */
    init(server: import('http').Server) {
        logger.debug('LogViewerWS', 'Initializing Log Viewer WebSocket server...');

        this.wss = new WebSocketServer({ 
            server, 
            path: '/ws/log-viewer',
            perMessageDeflate: false,
            clientTracking: true
        });

        logger.debug('LogViewerWS', 'Log Viewer WebSocket server created on path /ws/log-viewer');

        this.wss.on('error', (error) => {
            logger.error('LogViewerWS', 'Server error:', error);
        });

        this.wss.on('connection', (ws: ClientWebSocket, req) => {
            logger.info('LogViewerWS', `Client connected from: ${req.socket.remoteAddress}`);
            ws.isAlive = true;
            ws.subscriptions = new Map();

            // Send connection confirmation
            this.sendMessage(ws, {
                type: 'connected',
                message: 'Connected to Log Viewer WebSocket'
            });

            ws.on('message', async (data: Buffer) => {
                try {
                    const message: ClientMessage = JSON.parse(data.toString());
                    await this.handleMessage(ws, message);
                } catch (error) {
                    logger.error('LogViewerWS', 'Error handling message:', error);
                    this.sendMessage(ws, {
                        type: 'error',
                        message: 'Invalid message format'
                    });
                }
            });

            ws.on('pong', () => {
                ws.isAlive = true;
            });

            ws.on('close', () => {
                logger.info('LogViewerWS', 'Client disconnected');
                // Clean up subscriptions
                if (ws.subscriptions) {
                    ws.subscriptions.forEach((subscription) => {
                        if (subscription.stopFollowing) {
                            subscription.stopFollowing();
                        }
                    });
                    ws.subscriptions.clear();
                }
            });

            ws.on('error', (error) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                if (errorMessage && !errorMessage.includes('socket') && !errorMessage.includes('ECONNRESET')) {
                    logger.error('LogViewerWS', `Client error: ${errorMessage}`);
                }
            });
        });

        // Ping clients to detect stale connections
        this.pingInterval = setInterval(() => {
            this.wss?.clients.forEach((ws) => {
                const client = ws as ClientWebSocket;
                if (client.isAlive === false) {
                    return client.terminate();
                }
                client.isAlive = false;
                client.ping();
            });
        }, 30000);

        logger.debug('LogViewerWS', 'Log Viewer WebSocket server initialized');
    }

    /**
     * Handle incoming WebSocket messages
     */
    private async handleMessage(ws: ClientWebSocket, message: ClientMessage): Promise<void> {
        switch (message.type) {
            case 'subscribe':
                await this.handleSubscribe(ws, message);
                break;
            case 'unsubscribe':
                await this.handleUnsubscribe(ws, message);
                break;
            case 'filter':
                await this.handleFilter(ws, message);
                break;
            default:
                this.sendMessage(ws, {
                    type: 'error',
                    message: `Unknown message type: ${(message as any).type}`
                });
        }
    }

    /**
     * Handle subscribe message
     */
    private async handleSubscribe(ws: ClientWebSocket, message: SubscribeMessage): Promise<void> {
        const { fileId, pluginId, filePath, logType, follow = true, fromLine = 0 } = message;

        try {
            // Check if already subscribed
            if (ws.subscriptions?.has(fileId)) {
                this.sendMessage(ws, {
                    type: 'error',
                    fileId,
                    message: 'Already subscribed to this file'
                });
                return;
            }

            // Verify file exists
            const fileInfo = await logReaderService.getFileInfo(filePath);
            if (!fileInfo.exists || !fileInfo.readable) {
                this.sendMessage(ws, {
                    type: 'error',
                    fileId,
                    message: `File not found or not readable: ${filePath}`
                });
                return;
            }

            // Store subscription
            const subscription = {
                filePath,
                pluginId,
                logType,
                stopFollowing: undefined as (() => void) | undefined
            };
            ws.subscriptions?.set(fileId, subscription);

            // Send initial confirmation
            this.sendMessage(ws, {
                type: 'subscribed',
                fileId,
                filePath,
                fileInfo: {
                    size: fileInfo.size,
                    modified: fileInfo.modified.toISOString(),
                    compressed: fileInfo.compressed,
                    rotated: fileInfo.rotated
                }
            });

            // Get readCompressed from plugin settings
            const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
            const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

            // Read existing lines if fromLine > 0
            if (fromLine > 0) {
                const existingResults = await logParserService.parseLogFile({
                    pluginId,
                    filePath,
                    logType,
                    maxLines: 0, // 0 = no limit (was 1000)
                    fromLine: 0,
                    readCompressed
                });

                // Send existing lines
                for (const result of existingResults) {
                    if (result.raw.lineNumber > fromLine) {
                        this.sendMessage(ws, {
                            type: 'log-line',
                            fileId,
                            log: result.parsed,
                            lineNumber: result.raw.lineNumber
                        });
                    }
                }
            }

            // Start streaming if follow mode
            if (follow) {
                await this.startStreaming(ws, fileId, subscription);
            }
        } catch (error) {
            logger.error('LogViewerWS', `Error subscribing to ${filePath}:`, error);
            this.sendMessage(ws, {
                type: 'error',
                fileId,
                message: `Error subscribing: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }

    /**
     * Handle unsubscribe message
     */
    private async handleUnsubscribe(ws: ClientWebSocket, message: UnsubscribeMessage): Promise<void> {
        const { fileId } = message;

        const subscription = ws.subscriptions?.get(fileId);
        if (subscription) {
            // Stop following
            if (subscription.stopFollowing) {
                subscription.stopFollowing();
            }
            ws.subscriptions?.delete(fileId);

            this.sendMessage(ws, {
                type: 'unsubscribed',
                fileId
            });
        } else {
            this.sendMessage(ws, {
                type: 'error',
                fileId,
                message: 'Not subscribed to this file'
            });
        }
    }

    /**
     * Handle filter message (for future use)
     */
    private async handleFilter(ws: ClientWebSocket, message: FilterMessage): Promise<void> {
        // Filters will be applied client-side for now
        // In the future, we can implement server-side filtering
        this.sendMessage(ws, {
            type: 'filter-applied',
            fileId: message.fileId,
            filters: message.filters
        });
    }

    /**
     * Start streaming log file
     */
    private async startStreaming(
        ws: ClientWebSocket,
        fileId: string,
        subscription: { filePath: string; pluginId: string; logType: string; stopFollowing?: () => void }
    ): Promise<void> {
        const { filePath, pluginId, logType } = subscription;

        try {
            // Get readCompressed from plugin settings
            const pluginConfig = PluginConfigRepository.findByPluginId(pluginId);
            const readCompressed = (pluginConfig?.settings?.readCompressed as boolean) ?? false;

            // Stream and parse log file
            await logParserService.streamAndParseLogFile(
                {
                    pluginId,
                    filePath,
                    logType,
                    follow: true,
                    fromLine: 0,
                    readCompressed
                },
                (result) => {
                    // Send parsed log line to client
                    if (ws.readyState === WebSocket.OPEN) {
                        this.sendMessage(ws, {
                            type: 'log-line',
                            fileId,
                            log: result.parsed,
                            lineNumber: result.raw.lineNumber
                        });
                    }
                }
            );
        } catch (error) {
            logger.error('LogViewerWS', `Error streaming ${filePath}:`, error);
            this.sendMessage(ws, {
                type: 'error',
                fileId,
                message: `Error streaming: ${error instanceof Error ? error.message : String(error)}`
            });
        }
    }

    /**
     * Send message to client
     */
    private sendMessage(ws: ClientWebSocket, message: Record<string, unknown>): void {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                const jsonMessage = JSON.stringify(message);
                ws.send(jsonMessage);
            } catch (error) {
                logger.error('LogViewerWS', 'Error sending message:', error);
            }
        }
    }

    /**
     * Close the WebSocket server
     */
    close() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        if (this.wss) {
            // Clean up all subscriptions
            this.wss.clients.forEach((ws) => {
                const client = ws as ClientWebSocket;
                if (client.subscriptions) {
                    client.subscriptions.forEach((subscription) => {
                        if (subscription.stopFollowing) {
                            subscription.stopFollowing();
                        }
                    });
                }
            });

            this.wss.close();
            this.wss = null;
        }

        logger.debug('LogViewerWS', 'Log Viewer WebSocket service closed');
    }
}

export const logViewerWebSocket = new LogViewerWebSocketService();
