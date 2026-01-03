/**
 * Log Viewer WebSocket Hook
 * 
 * Hook React pour gérer la connexion WebSocket et le streaming temps réel des logs
 */

import { useEffect, useRef, useCallback } from 'react';
import { useLogViewerStore } from '../stores/logViewerStore.js';
import type { LogEntry } from '../types/logViewer.js';

interface WebSocketMessage {
    type: 'connected' | 'log' | 'error' | 'pong';
    message?: string;
    data?: {
        parsed: LogEntry;
        lineNumber: number;
    };
    fileId?: string;
    pluginId?: string;
    filePath?: string;
    logType?: string;
}

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

type ClientMessage = SubscribeMessage | UnsubscribeMessage;

export const useLogViewerWebSocket = () => {
    const {
        selectedPluginId,
        selectedFilePath,
        selectedLogType,
        logs,
        isConnected,
        isFollowing,
        setLogs,
        setConnected,
        setFollowing,
        setError
    } = useLogViewerStore();
    
    // Get store instance to access current state
    const getStoreState = useLogViewerStore.getState;

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const maxReconnectAttempts = 5;
    const reconnectDelay = 3000; // 3 seconds
    const isConnectingRef = useRef(false); // Flag to avoid multiple simultaneous connections

    // Get WebSocket URL - same logic as useConnectionWebSocket.ts but adapted for LogviewR
    const getWebSocketUrl = useCallback(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        let wsUrl: string;
        
        // In dev mode, check if we're accessing via IP (Docker dev or npm dev via IP) or localhost
        // If accessing via IP, connect directly to backend port to avoid proxy issues
        if (import.meta.env.DEV) {
            const host = window.location.hostname;
            const port = window.location.port;
            // Check if accessing via IP (not localhost)
            const isIpAccess = host !== 'localhost' && host !== '127.0.0.1';
            
            if (isIpAccess) {
                // Accessing via IP: determine backend port based on frontend port
                // Docker dev: frontend port 3777 → backend port 3779
                // npm dev via IP: frontend port 5175 → backend port 3004
                let backendPort: string;
                if (port === '3777' || port === '3666') {
                    // Docker dev
                    backendPort = '3779';
                } else {
                    // npm dev via IP (or other) - use default backend port 3004
                    backendPort = '3004';
                }
                // Connect directly to backend port to bypass Vite proxy
                wsUrl = `${protocol}//${host}:${backendPort}/ws/log-viewer`;
            } else {
                // Accessing via localhost: use proxy via current host
                // Proxy will route to backend port 3004
                wsUrl = `${protocol}//${window.location.host}/ws/log-viewer`;
            }
        } else {
            // Production: use current host
            wsUrl = `${protocol}//${window.location.host}/ws/log-viewer`;
        }

        if (import.meta.env.DEV) {
            console.log('[LogViewerWS] WebSocket URL:', wsUrl, '(hostname:', window.location.hostname, ', port:', window.location.port, ')');
        }

        return wsUrl;
    }, []);

    // Connect to WebSocket
    const connect = useCallback(() => {
        // Don't try to connect if already connected or connecting
        if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) {
            return; // Already connected or connecting
        }

        // Prevent multiple simultaneous connection attempts
        if (isConnectingRef.current) {
            return;
        }

        // Close existing connection if in closing state
        if (wsRef.current?.readyState === WebSocket.CLOSING) {
            wsRef.current.close();
            wsRef.current = null;
        }

        isConnectingRef.current = true;

        try {
            const url = getWebSocketUrl();
            const ws = new WebSocket(url);

            ws.onopen = () => {
                isConnectingRef.current = false; // Connection established
                if (import.meta.env.DEV) {
                    console.log('[LogViewerWS] Connected to WebSocket');
                }
                setConnected(true);
                reconnectAttemptsRef.current = 0; // Reset counter on successful connection
            };

            ws.onmessage = (event) => {
                try {
                    const message: WebSocketMessage = JSON.parse(event.data);

                    switch (message.type) {
                        case 'connected':
                            console.log('[LogViewerWS]', message.message);
                            break;

                        case 'log':
                            if (message.data) {
                                // Add new log entry to the store (append to existing logs)
                                const currentLogs = getStoreState().logs;
                                setLogs([...currentLogs, message.data!.parsed]);
                            }
                            break;

                        case 'error':
                            console.error('[LogViewerWS] Error:', message.message);
                            setError(message.message || 'WebSocket error');
                            break;

                        case 'pong':
                            // Heartbeat response
                            break;

                        default:
                            console.warn('[LogViewerWS] Unknown message type:', message.type);
                    }
                } catch (error) {
                    console.error('[LogViewerWS] Error parsing message:', error);
                }
            };

            ws.onerror = (error: Event) => {
                isConnectingRef.current = false; // Connection attempt failed
                // Suppress WebSocket errors during development - they're normal when server restarts
                if (import.meta.env.DEV) {
                    // Only log if it's not a connection error (which is expected during dev)
                    const errorMessage = error?.type || String(error || '');
                    if (!errorMessage.includes('failed') && !errorMessage.includes('closed')) {
                        console.error('[LogViewerWS] WebSocket error:', error);
                    }
                } else {
                    console.error('[LogViewerWS] WebSocket error:', error);
                }
                setConnected(false);
            };

            ws.onclose = (event) => {
                isConnectingRef.current = false; // Connection closed
                if (import.meta.env.DEV) {
                    console.log('[LogViewerWS] WebSocket closed', event.code !== 1006 ? `(code: ${event.code})` : '');
                }
                setConnected(false);
                wsRef.current = null;

                // Attempt to reconnect if we were following
                // In production, code 1006 is also common when nginx is not configured for WebSocket
                // Don't reconnect on normal closure (code 1000) or if max attempts reached
                if (isFollowing && reconnectAttemptsRef.current < maxReconnectAttempts && event.code !== 1000) {
                    reconnectAttemptsRef.current++;
                    if (import.meta.env.DEV) {
                        console.log(`[LogViewerWS] Attempting to reconnect (${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
                    }
                    reconnectTimeoutRef.current = setTimeout(() => {
                        connect();
                    }, reconnectDelay);
                }
            };

            wsRef.current = ws;
        } catch (error) {
            isConnectingRef.current = false; // Connection attempt failed
            console.error('[LogViewerWS] Failed to create WebSocket:', error);
            setConnected(false);
        }
    }, [isFollowing, getWebSocketUrl, setConnected, setLogs, setError]);

    // Disconnect from WebSocket
    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }

        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }

        setConnected(false);
        setFollowing(false);
    }, [setConnected, setFollowing]);

    // Subscribe to a log file
    const subscribe = useCallback((pluginId: string, filePath: string, logType: string, follow: boolean = false) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.warn('[LogViewerWS] Cannot subscribe: WebSocket not connected');
            return;
        }

        const fileId = `${pluginId}:${filePath}`;
        const message: SubscribeMessage = {
            type: 'subscribe',
            fileId,
            pluginId,
            filePath,
            logType,
            follow
        };

        try {
            wsRef.current.send(JSON.stringify(message));
            setFollowing(follow);
            console.log('[LogViewerWS] Subscribed to:', filePath, 'follow:', follow);
        } catch (error) {
            console.error('[LogViewerWS] Error subscribing:', error);
            setError('Failed to subscribe to log file');
        }
    }, [setFollowing, setError]);

    // Unsubscribe from a log file
    const unsubscribe = useCallback((fileId: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            return;
        }

        const message: UnsubscribeMessage = {
            type: 'unsubscribe',
            fileId
        };

        try {
            wsRef.current.send(JSON.stringify(message));
            setFollowing(false);
            console.log('[LogViewerWS] Unsubscribed from:', fileId);
        } catch (error) {
            console.error('[LogViewerWS] Error unsubscribing:', error);
        }
    }, [setFollowing]);

    // Auto-connect only when following is enabled or when explicitly needed
    // Don't connect automatically on mount - only when user enables "Follow" mode
    useEffect(() => {
        // Only auto-connect if we're in following mode and have a file selected
        if (isFollowing && selectedPluginId && selectedFilePath) {
            const connectTimeout = setTimeout(() => {
                connect();
            }, 500);

            return () => {
                clearTimeout(connectTimeout);
            };
        } else {
            // Disconnect if not following
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                disconnect();
            }
        }
    }, [isFollowing, selectedPluginId, selectedFilePath, connect, disconnect]);

    // Auto-subscribe when file is selected
    useEffect(() => {
        if (isConnected && selectedPluginId && selectedFilePath && selectedLogType) {
            const fileId = `${selectedPluginId}:${selectedFilePath}`;
            subscribe(selectedPluginId, selectedFilePath, selectedLogType, isFollowing);
        }
    }, [isConnected, selectedPluginId, selectedFilePath, selectedLogType, isFollowing, subscribe]);

    return {
        isConnected,
        isFollowing,
        connect,
        disconnect,
        subscribe,
        unsubscribe
    };
};
