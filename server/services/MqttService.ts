/**
 * MQTT Service
 *
 * Publishes LogviewR stats to an MQTT broker with optional
 * Home Assistant auto-discovery support.
 *
 * Stat selection lets users choose exactly what to publish,
 * keeping payload volume minimal (no sensitive data, no raw logs).
 */

import cron from 'node-cron';
import { AppConfigRepository } from '../database/models/AppConfig.js';
import { getDatabase } from '../database/connection.js';
import { getF2banMetrics } from './metricsService.js';
import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

// ── Config interface ────────────────────────────────────────────────────────────

export interface MqttStatSelection {
    bansToday:   boolean;  // Total bans since midnight
    uniqueIps:   boolean;  // Unique IPs banned today
    activeBans:  boolean;  // Currently active bans
    jailDetails: boolean;  // Per-jail breakdown (JSON payload)
    dbSizeMb:    boolean;  // SQLite DB size in MB
    systemLoad:  boolean;  // CPU % + RAM MB (from system API)
}

export interface MqttConfig {
    enabled:         boolean;
    broker:          string;   // e.g. "mqtt://192.168.1.1:1883"
    username?:       string;
    password?:       string;
    topicPrefix:     string;   // default "logviewr"
    intervalMinutes: number;   // 1 | 5 | 10 | 30
    discovery:       boolean;  // HA MQTT auto-discovery
    stats:           MqttStatSelection;
}

const MQTT_CONFIG_KEY = 'mqtt_config';

export const DEFAULT_MQTT_CONFIG: MqttConfig = {
    enabled:         false,
    broker:          'mqtt://localhost:1883',
    topicPrefix:     'logviewr',
    intervalMinutes: 5,
    discovery:       true,
    stats: {
        bansToday:   true,
        uniqueIps:   true,
        activeBans:  true,
        jailDetails: false,
        dbSizeMb:    true,
        systemLoad:  false,
    },
};

// ── Sensor descriptor for HA discovery ─────────────────────────────────────────

interface SensorDescriptor {
    id:      string;
    name:    string;
    icon:    string;
    unit?:   string;
    statKey: keyof MqttStatSelection;
}

const SENSORS: SensorDescriptor[] = [
    { id: 'bans_today',      name: 'Bans aujourd\'hui',    icon: 'mdi:shield-alert',      statKey: 'bansToday'   },
    { id: 'unique_ips',      name: 'IPs uniques bannies',  icon: 'mdi:ip-network-outline', statKey: 'uniqueIps'   },
    { id: 'active_bans',     name: 'Bans actifs',          icon: 'mdi:shield-lock',        statKey: 'activeBans'  },
    { id: 'db_size_mb',      name: 'Base de données (MB)', icon: 'mdi:database',  unit: 'MB', statKey: 'dbSizeMb' },
    { id: 'cpu_usage',       name: 'CPU LogviewR (%)',     icon: 'mdi:cpu-64-bit',unit: '%',  statKey: 'systemLoad'},
    { id: 'memory_used_mb',  name: 'Mémoire LogviewR',     icon: 'mdi:memory',    unit: 'MB', statKey: 'systemLoad'},
];

// ── MqttService class ───────────────────────────────────────────────────────────

class MqttService {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private client:     any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private cronTask:   any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private mqttLib:    any = null;
    private _connected      = false;

    // ── Config helpers ────────────────────────────────────────────────────────

    getConfig(): MqttConfig {
        const raw = AppConfigRepository.get(MQTT_CONFIG_KEY);
        if (!raw) return { ...DEFAULT_MQTT_CONFIG };
        try {
            const parsed = JSON.parse(raw) as Partial<MqttConfig>;
            return {
                ...DEFAULT_MQTT_CONFIG,
                ...parsed,
                stats: { ...DEFAULT_MQTT_CONFIG.stats, ...(parsed.stats ?? {}) },
            };
        } catch {
            return { ...DEFAULT_MQTT_CONFIG };
        }
    }

    saveConfig(config: MqttConfig): void {
        AppConfigRepository.set(MQTT_CONFIG_KEY, JSON.stringify(config));
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async initialize(): Promise<void> {
        const config = this.getConfig();
        if (config.enabled) {
            await this.start(config);
        }
    }

    async start(config: MqttConfig): Promise<void> {
        await this.stop();

        try {
            if (!this.mqttLib) {
                this.mqttLib = await import('mqtt');
            }

            const connectUrl = config.broker.startsWith('mqtt')
                ? config.broker
                : `mqtt://${config.broker}`;

            this.client = this.mqttLib.connect(connectUrl, {
                username:        config.username || undefined,
                password:        config.password || undefined,
                clientId:        `logviewr_${crypto.randomBytes(5).toString('hex')}`,
                clean:           true,
                reconnectPeriod: 10_000,
                connectTimeout:  8_000,
            });

            this.client.on('connect', async () => {
                this._connected = true;
                logger.info('MQTT', `Connected to ${config.broker}`);
                if (config.discovery) {
                    await this.publishDiscovery(config);
                }
                await this.publishStats(config);
            });

            this.client.on('reconnect', () => {
                logger.debug('MQTT', 'Reconnecting…');
            });

            this.client.on('close', () => {
                this._connected = false;
            });

            this.client.on('error', (err: Error) => {
                this._connected = false;
                logger.error('MQTT', 'Connection error:', err.message);
            });

            // Schedule periodic publication
            const cronExpr = this._intervalToCron(config.intervalMinutes);
            this.cronTask = cron.schedule(cronExpr, async () => {
                if (this._connected) {
                    await this.publishStats(config);
                }
            });

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('MQTT', 'Failed to start service:', msg);
        }
    }

    async stop(): Promise<void> {
        if (this.cronTask) {
            this.cronTask.stop();
            this.cronTask = null;
        }
        if (this.client) {
            // Publish offline before disconnecting
            try {
                const config = this.getConfig();
                this.client.publish(`${config.topicPrefix}/status`, 'offline', { retain: true });
            } catch { /* ignore */ }
            this.client.end(true);
            this.client   = null;
            this._connected = false;
        }
    }

    async restart(): Promise<void> {
        const config = this.getConfig();
        if (config.enabled) {
            await this.start(config);
        } else {
            await this.stop();
        }
    }

    isConnected(): boolean {
        return this._connected;
    }

    // ── Connection test (ephemeral client) ────────────────────────────────────

    async testConnection(config: MqttConfig): Promise<{ ok: boolean; message: string }> {
        if (!this.mqttLib) {
            try {
                this.mqttLib = await import('mqtt');
            } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                return { ok: false, message: msg };
            }
        }
        const mqttLib = this.mqttLib;
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve({ ok: false, message: 'Timeout (10s) — broker injoignable' });
            }, 10_000);

            try {
                const connectUrl = config.broker.startsWith('mqtt')
                    ? config.broker
                    : `mqtt://${config.broker}`;

                const testClient = mqttLib.connect(connectUrl, {
                    username:       config.username || undefined,
                    password:       config.password || undefined,
                    clientId:       `logviewr_test_${crypto.randomBytes(4).toString('hex')}`,
                    clean:          true,
                    connectTimeout: 8_000,
                    reconnectPeriod: 0,
                });

                testClient.on('connect', () => {
                    clearTimeout(timeout);
                    testClient.end(true);
                    resolve({ ok: true, message: `Connexion réussie à ${config.broker}` });
                });

                testClient.on('error', (err: Error) => {
                    clearTimeout(timeout);
                    testClient.end(true);
                    resolve({ ok: false, message: `Erreur : ${err.message}` });
                });
            } catch (err: unknown) {
                clearTimeout(timeout);
                const msg = err instanceof Error ? err.message : String(err);
                resolve({ ok: false, message: msg });
            }
        });
    }

    // ── Publish helpers ───────────────────────────────────────────────────────

    private _publish(topic: string, payload: string | object, retain = true): void {
        if (!this.client || !this._connected) return;
        const msg = typeof payload === 'string' ? payload : JSON.stringify(payload);
        this.client.publish(topic, msg, { retain, qos: 0 });
    }

    // ── Home Assistant auto-discovery ─────────────────────────────────────────

    async publishDiscovery(config: MqttConfig): Promise<void> {
        const prefix = config.topicPrefix;
        const device = {
            identifiers:  ['logviewr'],
            name:         'LogviewR',
            model:        'Log Analysis & Security Monitor',
            manufacturer: 'LogviewR',
        };

        for (const sensor of SENSORS) {
            if (!config.stats[sensor.statKey]) continue;

            const configTopic = `homeassistant/sensor/logviewr_${sensor.id}/config`;
            const payload: Record<string, unknown> = {
                name:               sensor.name,
                unique_id:          `logviewr_${sensor.id}`,
                state_topic:        `${prefix}/sensor/${sensor.id}/state`,
                icon:               sensor.icon,
                device,
                availability_topic: `${prefix}/status`,
                payload_available:  'online',
                payload_not_available: 'offline',
            };
            if (sensor.unit) payload.unit_of_measurement = sensor.unit;

            this._publish(configTopic, payload, true);
        }

        // Availability
        this._publish(`${prefix}/status`, 'online', true);
        logger.debug('MQTT', `Published HA discovery for ${prefix}`);
    }

    // ── Stats publication ─────────────────────────────────────────────────────

    async publishStats(config: MqttConfig): Promise<void> {
        const prefix = config.topicPrefix;

        try {
            const f2b = await getF2banMetrics();

            if (config.stats.bansToday) {
                this._publish(`${prefix}/sensor/bans_today/state`, String(f2b?.bansToday ?? 0));
            }
            if (config.stats.uniqueIps) {
                this._publish(`${prefix}/sensor/unique_ips/state`, String(f2b?.uniqueIpsToday ?? 0));
            }
            if (config.stats.activeBans) {
                this._publish(`${prefix}/sensor/active_bans/state`, String(f2b?.activeBans ?? 0));
            }
            if (config.stats.jailDetails && f2b && f2b.jailCounts.length > 0) {
                // JSON object for template sensors in HA
                const jailPayload: Record<string, number> = {};
                for (const j of f2b.jailCounts) jailPayload[j.jail] = j.count;
                this._publish(`${prefix}/jails`, jailPayload);
            }

            // System stats
            if (config.stats.dbSizeMb || config.stats.systemLoad) {
                const sys = await this._getSystemStats();
                if (config.stats.dbSizeMb) {
                    this._publish(`${prefix}/sensor/db_size_mb/state`, String(sys.dbSizeMb));
                }
                if (config.stats.systemLoad) {
                    this._publish(`${prefix}/sensor/cpu_usage/state`,      String(sys.cpuUsage));
                    this._publish(`${prefix}/sensor/memory_used_mb/state`, String(sys.memoryUsedMb));
                }
            }

            logger.debug('MQTT', `Stats published to ${prefix}/*`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('MQTT', 'Failed to publish stats:', msg);
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private _intervalToCron(minutes: number): string {
        if (minutes === 1)  return '* * * * *';
        if (minutes <= 60)  return `*/${minutes} * * * *`;
        return '0 * * * *';
    }

    private async _getSystemStats(): Promise<{ dbSizeMb: number; cpuUsage: number; memoryUsedMb: number }> {
        let dbSizeMb = 0;
        let cpuUsage = 0;
        let memoryUsedMb = 0;

        try {
            const db        = getDatabase();
            const pageSize  = db.pragma('page_size',  { simple: true }) as number;
            const pageCount = db.pragma('page_count', { simple: true }) as number;
            dbSizeMb = Math.round((pageSize * pageCount) / (1024 * 1024) * 10) / 10;
        } catch { /* ignore */ }

        try {
            const r = await fetch(`http://localhost:${process.env.PORT ?? 3003}/api/system/server`);
            if (r.ok) {
                const d = await r.json() as { success: boolean; result: Record<string, unknown> };
                if (d.success && d.result) {
                    const cpu = d.result['cpu'] as number | { usage?: number } | undefined;
                    cpuUsage = typeof cpu === 'number' ? Math.round(cpu)
                             : typeof cpu === 'object' && cpu !== null && typeof cpu.usage === 'number'
                             ? Math.round(cpu.usage) : 0;
                    const mem = d.result['memory'] as { used?: number } | undefined;
                    memoryUsedMb = mem?.used ? Math.round(mem.used / 1024 / 1024) : 0;
                }
            }
        } catch { /* ignore */ }

        return { dbSizeMb, cpuUsage, memoryUsedMb };
    }
}

export const mqttService = new MqttService();
