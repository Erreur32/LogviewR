/**
 * Tests for errorMessageNormalizer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeErrorMessage } from '../errorMessageNormalizer.js';

describe('normalizeErrorMessage', () => {
    it('groups messages differing only by IPv4 address', () => {
        const a = normalizeErrorMessage('Connection from 192.168.1.5 refused');
        const b = normalizeErrorMessage('Connection from 10.0.0.9 refused');
        assert.equal(a, b);
    });

    it('groups messages differing only by PID', () => {
        const a = normalizeErrorMessage('worker pid 12345 exited unexpectedly');
        const b = normalizeErrorMessage('worker pid 67890 exited unexpectedly');
        assert.equal(a, b);
    });

    it('groups messages differing only by a long numeric id', () => {
        const a = normalizeErrorMessage('session 1699999999 expired');
        const b = normalizeErrorMessage('session 1700000123 expired');
        assert.equal(a, b);
    });

    it('groups messages differing only by ISO timestamp', () => {
        const a = normalizeErrorMessage('retry scheduled at 2026-09-04T10:00:00Z');
        const b = normalizeErrorMessage('retry scheduled at 2026-09-05T11:30:12+02:00');
        assert.equal(a, b);
    });

    it('groups messages differing only by UUID', () => {
        const a = normalizeErrorMessage('request 3fa85f64-5717-4562-b3fc-2c963f66afa6 failed');
        const b = normalizeErrorMessage('request 9c858901-8a57-4791-81fe-4c455b099bc9 failed');
        assert.equal(a, b);
    });

    it('does not group structurally different messages', () => {
        const a = normalizeErrorMessage('permission denied for /etc/shadow');
        const b = normalizeErrorMessage('connection refused on port 8080');
        assert.notEqual(a, b);
    });

    it('collapses repeated whitespace', () => {
        const result = normalizeErrorMessage('too   many    spaces   here');
        assert.equal(result, 'too many spaces here');
    });
});
