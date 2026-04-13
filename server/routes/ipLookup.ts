/**
 * IP Lookup routes
 *
 * Generic IP information endpoint (geo, WHOIS, hostname, known provider).
 * Independent of the fail2ban plugin — works for any IP address.
 */

import { Router } from 'express';
import expressRateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/authMiddleware.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { lookupIp } from '../services/ipLookupService.js';

const router = Router();

/**
 * GET /api/ip/:ip/lookup
 * Returns geo + whois + hostname + knownProvider for any IP.
 */
router.get('/:ip/lookup', requireAuth, expressRateLimit({
    windowMs: 60_000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false },
}), asyncHandler(async (req, res) => {
    const ip = String(req.params.ip);
    if (!/^[\d:.a-fA-F]{2,45}$/.test(ip)) {
        return res.json({ success: true, result: { ok: false, error: 'Invalid IP' } });
    }

    const data = await lookupIp(ip);
    res.json({
        success: true,
        result: {
            ok: true,
            geo: data.geo,
            whois: data.whois,
            hostname: data.hostname,
            knownProvider: data.knownProvider,
        },
    });
}));

export default router;
