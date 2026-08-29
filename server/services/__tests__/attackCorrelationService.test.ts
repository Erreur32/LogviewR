/**
 * Tests for attackCorrelationService
 *
 * Uses Node.js built-in test runner (node:test + node:assert), in-memory SQLite.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';

// Dynamic import: connection.ts resolves its DB path once at module-evaluation
// time, and static imports are hoisted ahead of the env assignment above — a
// dynamic import is the only way to guarantee the env var is read first.
const { initializeDatabase, getDatabase, closeDatabase } = await import('../../database/connection.js');
const { attackCorrelationService } = await import('../attackCorrelationService.js');

const NOW = Math.floor(Date.now() / 1000);

let nextRowid = 1;

function seedBan(ip: string, jail: string, timeofban: number) {
    const db = getDatabase();
    db.prepare(`
        INSERT INTO f2b_events (f2b_rowid, ip, jail, event_type, timeofban, bantime, failures)
        VALUES (?, ?, ?, 'ban', ?, 600, 3)
    `).run(nextRowid++, ip, jail, timeofban);
}

function seedWhois(ip: string, asn: string, netname: string, org: string) {
    const db = getDatabase();
    db.prepare(`
        INSERT OR REPLACE INTO f2b_whois_cache (ip, org, country, asn, netname, cidr, ts)
        VALUES (?, ?, 'US', ?, ?, '0.0.0.0/24', ?)
    `).run(ip, org, asn, netname, NOW);
}

describe('attackCorrelationService', () => {
    beforeEach(() => {
        closeDatabase();
        process.env.DATABASE_PATH = ':memory:';
        initializeDatabase();
    });

    afterEach(() => {
        closeDatabase();
    });

    it('detects an IP escalating across multiple jails', async () => {
        seedBan('1.2.3.4', 'sshd', NOW - 100);
        seedBan('1.2.3.4', 'nginx-botsearch', NOW - 50);

        const threats = await attackCorrelationService.getActiveThreats(6);
        const escalation = threats.find(t => t.kind === 'ip_escalation' && t.ips.includes('1.2.3.4'));

        assert.ok(escalation, 'expected an ip_escalation cluster for 1.2.3.4');
        assert.equal(escalation!.jails.length, 2);
        assert.equal(escalation!.totalBans, 2);
    });

    it('ignores an IP banned in only one jail', async () => {
        seedBan('5.6.7.8', 'sshd', NOW - 100);

        const threats = await attackCorrelationService.getActiveThreats(6);
        const escalation = threats.find(t => t.kind === 'ip_escalation' && t.ips.includes('5.6.7.8'));

        assert.equal(escalation, undefined);
    });

    it('detects a coordinated campaign across >=3 IPs sharing an ASN', async () => {
        for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
            seedBan(ip, 'sshd', NOW - 30);
            seedWhois(ip, 'AS12345', 'EXAMPLE-NET', 'Example Hosting');
        }

        const threats = await attackCorrelationService.getActiveThreats(6);
        const campaign = threats.find(t => t.kind === 'asn_campaign' && t.asn === 'AS12345');

        assert.ok(campaign, 'expected an asn_campaign cluster for AS12345');
        assert.equal(campaign!.ips.length, 3);
        assert.equal(campaign!.org, 'Example Hosting');
    });

    it('ignores an ASN with fewer than 3 distinct IPs', async () => {
        for (const ip of ['10.0.1.1', '10.0.1.2']) {
            seedBan(ip, 'sshd', NOW - 30);
            seedWhois(ip, 'AS99999', 'SMALL-NET', 'Small Org');
        }

        const threats = await attackCorrelationService.getActiveThreats(6);
        const campaign = threats.find(t => t.kind === 'asn_campaign' && t.asn === 'AS99999');

        assert.equal(campaign, undefined);
    });

    it('excludes bans outside the trailing window', async () => {
        seedBan('9.9.9.9', 'sshd', NOW - 100000);
        seedBan('9.9.9.9', 'nginx-botsearch', NOW - 99000);

        const threats = await attackCorrelationService.getActiveThreats(1);
        const escalation = threats.find(t => t.ips.includes('9.9.9.9'));

        assert.equal(escalation, undefined);
    });
});
