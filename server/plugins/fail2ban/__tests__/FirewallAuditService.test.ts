/**
 * Tests for FirewallAuditService — no live fail2ban/iptables available in dev,
 * so the action.d template resolution and iptables-save parsing are covered
 * with synthetic fixtures mirroring fail2ban's real action templates.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { auditFirewallCoherence, detectMechanism, parseIptablesSave, resolveTags } from '../FirewallAuditService.js';
import type { Fail2banClientExec, F2bJailStatus, F2bClientResult, IpsetSetInfo } from '../Fail2banClientExec.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const IPTABLES_MULTIPORT_CONF = `
[Definition]
actionstart = iptables -w -N f2b-<name>
              iptables -w -A f2b-<name> -j RETURN
              iptables -w -I <chain> -p tcp -m multiport --dports <port> -j f2b-<name>
actionstop = iptables -w -D <chain> -p tcp -m multiport --dports <port> -j f2b-<name>
             iptables -w -F f2b-<name>
             iptables -w -X f2b-<name>
actionban = iptables -w -I f2b-<name> 1 -s <ip> -j <blocktype>
actionunban = iptables -w -D f2b-<name> -s <ip> -j <blocktype>

[Init]
chain = INPUT
port = ssh
blocktype = REJECT --reject-with icmp-port-unreachable
`;

const IPTABLES_IPSET_CONF = `
[Definition]
actionstart = ipset -! create <ipmset> hash:ip family inet hashsize 1024 maxelem 65536 timeout 0
              iptables -w -I <chain> -m set --match-set <ipmset> src -j <blocktype>
actionstop = iptables -w -D <chain> -m set --match-set <ipmset> src -j <blocktype>
             ipset flush <ipmset>
             ipset destroy <ipmset>
actionban = ipset add <ipmset> <ip> timeout <bantime> -exist
actionunban = ipset del <ipmset> <ip> -exist

[Init]
chain = INPUT
ipmset = f2b-<name>
blocktype = DROP
bantime = 600
`;

const MAIL_ONLY_CONF = `
[Definition]
actionban = printf %%b "Subject: banned\\n" | mail -s banned root

[Init]
`;

function makeConfBase(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f2b-audit-test-'));
    const actionD = path.join(dir, 'action.d');
    fs.mkdirSync(actionD, { recursive: true });
    fs.writeFileSync(path.join(actionD, 'iptables-multiport.conf'), IPTABLES_MULTIPORT_CONF, 'utf8');
    fs.writeFileSync(path.join(actionD, 'iptables-ipset-proto6.conf'), IPTABLES_IPSET_CONF, 'utf8');
    fs.writeFileSync(path.join(actionD, 'mail-whois.conf'), MAIL_ONLY_CONF, 'utf8');
    return dir;
}

function fakeClient(overrides: Partial<Record<keyof Fail2banClientExec, unknown>>): Fail2banClientExec {
    const base = {
        iptablesSave: async (): Promise<F2bClientResult> => ({ ok: true, output: '' }),
        ipsetInfo: async (): Promise<{ ok: boolean; sets: IpsetSetInfo[] }> => ({ ok: true, sets: [] }),
        nftList: async (): Promise<F2bClientResult> => ({ ok: true, output: '' }),
        ipsetEntries: async (): Promise<{ ok: boolean; entries: string[] }> => ({ ok: true, entries: [] }),
        getJailStatus: async (): Promise<F2bJailStatus | null> => null,
        listJails: async (): Promise<string[]> => [],
        ...overrides,
    };
    return base as unknown as Fail2banClientExec;
}

// ── resolveTags / detectMechanism ────────────────────────────────────────────

describe('resolveTags', () => {
    it('substitutes <name> with the jail name and Init params', () => {
        const out = resolveTags('iptables -I <chain> -j f2b-<name>', 'sshd', { chain: 'INPUT' });
        assert.equal(out, 'iptables -I INPUT -j f2b-sshd');
    });

    it('leaves <ip> untouched as a placeholder', () => {
        const out = resolveTags('iptables -A f2b-<name> -s <ip> -j DROP', 'nginx', {});
        assert.equal(out, 'iptables -A f2b-nginx -s <ip> -j DROP');
    });
});

describe('detectMechanism', () => {
    let confBase: string;
    beforeEach(() => { confBase = makeConfBase(); });
    afterEach(() => { fs.rmSync(confBase, { recursive: true, force: true }); });

    it('detects a chain-based action (iptables-multiport)', () => {
        const mech = detectMechanism('sshd', 'iptables-multiport', confBase);
        assert.equal(mech?.kind, 'chain');
        assert.equal(mech?.targetName, 'f2b-sshd');
        assert.equal(mech?.parentChain, 'INPUT');
    });

    it('detects an ipset-based action (iptables-ipset-proto6)', () => {
        const mech = detectMechanism('nginx-http-auth', 'iptables-ipset-proto6', confBase);
        assert.equal(mech?.kind, 'ipset');
        assert.equal(mech?.targetName, 'f2b-nginx-http-auth');
        assert.equal(mech?.parentChain, 'INPUT');
    });

    it('classifies non-firewall actions (mail-only) as other', () => {
        const mech = detectMechanism('sshd', 'mail-whois', confBase);
        assert.equal(mech?.kind, 'other');
    });

    it('returns null when the action file is missing', () => {
        const mech = detectMechanism('sshd', 'does-not-exist', confBase);
        assert.equal(mech, null);
    });
});

// ── parseIptablesSave ─────────────────────────────────────────────────────────

describe('parseIptablesSave', () => {
    const dump = `# Generated by iptables-save
*filter
:INPUT ACCEPT [0:0]
:FORWARD ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
:f2b-sshd - [0:0]
-A INPUT -p tcp -m multiport --dports 22 -j f2b-sshd
-A f2b-sshd -s 1.2.3.4/32 -j REJECT --reject-with icmp-port-unreachable
-A f2b-sshd -j RETURN
-A INPUT -m set --match-set f2b-nginx src -j DROP
COMMIT
`;

    it('collects declared chains', () => {
        const r = parseIptablesSave(dump);
        assert.ok(r.chains.has('f2b-sshd'));
        assert.ok(r.chains.has('INPUT'));
    });

    it('extracts source IPs, jump targets and match-set references', () => {
        const r = parseIptablesSave(dump);
        const banRule = r.rules.find(x => x.sourceIp === '1.2.3.4');
        assert.ok(banRule);
        assert.equal(banRule?.chain, 'f2b-sshd');

        const jumpRule = r.rules.find(x => x.chain === 'INPUT' && x.jumpTarget === 'f2b-sshd');
        assert.ok(jumpRule);

        const matchSetRule = r.rules.find(x => x.matchSet === 'f2b-nginx');
        assert.ok(matchSetRule);
    });
});

// ── auditFirewallCoherence ────────────────────────────────────────────────────

describe('auditFirewallCoherence', () => {
    let confBase: string;
    beforeEach(() => { confBase = makeConfBase(); });
    afterEach(() => { fs.rmSync(confBase, { recursive: true, force: true }); });

    it('reports no issue when chain, jump and banned IPs are all aligned', async () => {
        const iptablesSaveOut = `*filter
:INPUT ACCEPT [0:0]
:f2b-sshd - [0:0]
-A INPUT -p tcp -j f2b-sshd
-A f2b-sshd -s 9.9.9.9/32 -j REJECT
COMMIT
`;
        const client = fakeClient({
            iptablesSave: async () => ({ ok: true, output: iptablesSaveOut }),
            getJailStatus: async () => ({
                jail: 'sshd', currentlyFailed: 0, totalFailed: 0, currentlyBanned: 1, totalBanned: 1,
                bannedIps: ['9.9.9.9'], fileList: '',
            }),
        });
        const result = await auditFirewallCoherence({
            confBase, client, activeJails: ['sshd'],
            jailMeta: { sshd: { banaction: 'iptables-multiport' } },
        });
        assert.equal(result.ok, true);
        assert.equal(result.jailsChecked, 1);
        assert.deepEqual(result.summary, { critical: 0, warning: 0, info: 0 });
    });

    it('flags a critical issue when the expected chain is missing', async () => {
        const client = fakeClient({
            iptablesSave: async () => ({ ok: true, output: '*filter\n:INPUT ACCEPT [0:0]\nCOMMIT\n' }),
            getJailStatus: async () => ({
                jail: 'sshd', currentlyFailed: 0, totalFailed: 0, currentlyBanned: 0, totalBanned: 0,
                bannedIps: [], fileList: '',
            }),
        });
        const result = await auditFirewallCoherence({
            confBase, client, activeJails: ['sshd'],
            jailMeta: { sshd: { banaction: 'iptables-multiport' } },
        });
        assert.equal(result.summary.critical, 1);
        assert.equal(result.issues[0].category, 'chain');
    });

    it('flags a critical ip-mismatch when a banned IP is not enforced at kernel level', async () => {
        const iptablesSaveOut = `*filter
:INPUT ACCEPT [0:0]
:f2b-sshd - [0:0]
-A INPUT -p tcp -j f2b-sshd
COMMIT
`;
        const client = fakeClient({
            iptablesSave: async () => ({ ok: true, output: iptablesSaveOut }),
            getJailStatus: async () => ({
                jail: 'sshd', currentlyFailed: 0, totalFailed: 0, currentlyBanned: 1, totalBanned: 1,
                bannedIps: ['5.5.5.5'], fileList: '',
            }),
        });
        const result = await auditFirewallCoherence({
            confBase, client, activeJails: ['sshd'],
            jailMeta: { sshd: { banaction: 'iptables-multiport' } },
        });
        const ipIssue = result.issues.find(i => i.category === 'ip-mismatch');
        assert.ok(ipIssue);
        assert.equal(ipIssue?.severity, 'critical');
        assert.match(ipIssue!.fix ?? '', /fail2ban-client set sshd banip 5\.5\.5\.5/);
    });

    it('flags an orphan ipset when populated but never matched by a firewall rule', async () => {
        const client = fakeClient({
            iptablesSave: async () => ({ ok: true, output: '*filter\n:INPUT ACCEPT [0:0]\nCOMMIT\n' }),
            ipsetInfo: async () => ({ ok: true, sets: [{ name: 'f2b-nginx', type: 'hash:ip', size: 0, maxelem: 65536, entries: 3 }] }),
            getJailStatus: async () => ({
                jail: 'nginx', currentlyFailed: 0, totalFailed: 0, currentlyBanned: 0, totalBanned: 0,
                bannedIps: [], fileList: '',
            }),
        });
        const result = await auditFirewallCoherence({
            confBase, client, activeJails: ['nginx'],
            jailMeta: { nginx: { banaction: 'iptables-ipset-proto6' } },
        });
        const orphan = result.issues.find(i => i.category === 'orphan-ipset');
        assert.ok(orphan);
        assert.equal(orphan?.severity, 'critical');
    });

    it('skips jails whose action has no firewall component', async () => {
        const client = fakeClient({});
        const result = await auditFirewallCoherence({
            confBase, client, activeJails: ['sshd'],
            jailMeta: { sshd: { banaction: 'mail-whois' } },
        });
        assert.equal(result.jailsChecked, 0);
        assert.deepEqual(result.jailsSkipped, ['sshd']);
    });

    it('returns ok:false when both iptables and ipset are unavailable', async () => {
        const client = fakeClient({
            iptablesSave: async () => ({ ok: false, output: '', error: 'iptables-save not found' }),
            ipsetInfo: async () => ({ ok: false, sets: [] }),
        });
        const result = await auditFirewallCoherence({ confBase, client, activeJails: [], jailMeta: {} });
        assert.equal(result.ok, false);
        assert.ok(result.error);
    });
});
