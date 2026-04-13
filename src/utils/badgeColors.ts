/**
 * Badge Colors Utilities
 *
 * Consistent color generation for dynamic badges (IP, hostname, username, timestamp).
 * Each badge type has a distinct visual identity:
 *   - IP:        cool tones (hue 170-270), solid dark fill, rectangle
 *   - Username:  warm tones (hue 0-60 / 320-360), transparent bg + left border accent
 *   - Hostname:  pastel mix, transparent bg + dashed border
 *   - Timestamp: neutral blue-gray, lightness varies with time of day (noir → slate blue)
 */

/**
 * Hash function (djb2) for stable color generation.
 * Same string always produces same hash.
 */
function hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash;
}

// ─── IP Badges ── cool tones, solid dark fill ────────────────────────

/**
 * Get consistent badge color for an IP address.
 * Restricted to cool tones (hue 170-270: cyan/blue/indigo/teal).
 * Lightness kept low (35-45%) to guarantee white text contrast.
 */
export function getIPBadgeColor(ip: string): string {
    if (!ip || ip.trim() === '') {
        return '';
    }
    const hash = hashString(ip.trim());
    const hue = 170 + (Math.abs(hash) % 100);           // 170-270
    const saturation = 55 + (Math.abs(hash >> 8) % 20);  // 55-75%
    const lightness = 35 + (Math.abs(hash >> 16) % 10);  // 35-45%
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Get inline style for IP badge — rectangle, solid fill, white text.
 */
export function getIPBadgeStyle(ip: string): React.CSSProperties {
    const bgColor = getIPBadgeColor(ip);
    if (!bgColor) {
        return { backgroundColor: 'rgba(107,114,128,0.15)', color: '#6e7681' };
    }
    return {
        backgroundColor: bgColor,
        color: '#ffffff',
        fontWeight: '500',
    };
}

// ─── Username Badges ── green tones, transparent bg + left border ────

/**
 * Get consistent hue for a username.
 * Restricted to green tones: hue 90-170 (green, teal, emerald).
 * Distinct from IP badges (170-270 blue/indigo).
 */
function getUserHue(username: string): number {
    const hash = hashString(username.trim());
    return 90 + (Math.abs(hash) % 80); // 90-170
}

/**
 * Get consistent badge color for a username (green tones only).
 */
export function getUserBadgeColor(username: string): string {
    if (!username || username.trim() === '') {
        return '';
    }
    return `hsl(${getUserHue(username)}, 60%, 45%)`;
}

/**
 * Get inline style for user badge - transparent bg, left border accent, green tones.
 */
export function getUserBadgeStyle(username: string): React.CSSProperties {
    if (!username || username.trim() === '') {
        return { backgroundColor: 'rgba(107,114,128,0.15)', color: '#6e7681' };
    }
    const hue = getUserHue(username);
    return {
        backgroundColor: `hsla(${hue}, 60%, 45%, 0.15)`,
        color: `hsl(${hue}, 60%, 70%)`,
        borderLeft: `3px solid hsl(${hue}, 60%, 45%)`,
        borderRadius: '4px',
        fontWeight: '600',
    };
}

// ─── Hostname Badges ── pastel mix, dashed border ───────────────────

/**
 * Get consistent badge color for a hostname (full hue range, pastel).
 */
export function getHostnameBadgeColor(hostname: string): string {
    if (!hostname || hostname.trim() === '') {
        return '';
    }
    const hash = hashString(hostname.trim());
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 50%, 65%)`;
}

/**
 * Get inline style for hostname badge — transparent bg, dashed border, pastel.
 */
export function getHostnameBadgeStyle(hostname: string): React.CSSProperties {
    if (!hostname || hostname.trim() === '') {
        return { backgroundColor: 'rgba(107,114,128,0.15)', color: '#6e7681' };
    }
    const hash = hashString(hostname.trim());
    const hue = Math.abs(hash) % 360;
    return {
        backgroundColor: `hsla(${hue}, 50%, 55%, 0.10)`,
        color: `hsl(${hue}, 50%, 72%)`,
        border: `1px dashed hsla(${hue}, 50%, 55%, 0.35)`,
        borderRadius: '6px',
        fontWeight: '500',
    };
}

// ─── Timestamp Badges ── neutral blue-gray, day/night cycle ─────────

/**
 * Get color for timestamp based on time of day.
 * Night = near-black gray (hsl 220, 8%, 11%).
 * Noon  = faded slate blue (hsl 215, 25%, 48%).
 * Smooth symmetrical transition.
 */
export function getTimestampColor(timestamp: Date | string): string {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;

    if (Number.isNaN(date.getTime())) {
        return 'hsl(220, 8%, 20%)';
    }

    const hour = date.getHours();
    const minute = date.getMinutes();
    // 0 at midnight, 1 at noon
    const proximityToNoon = 1 - Math.abs(hour + minute / 60 - 12) / 12;

    const hue = Math.round(220 - proximityToNoon * 5);         // 220 → 215
    const saturation = Math.round(8 + proximityToNoon * 17);    // 8% → 25%
    const lightness = Math.round(11 + proximityToNoon * 37);    // 11% → 48%

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

/**
 * Get inline style for timestamp badge.
 * Text color adapts to background lightness — always readable.
 */
export function getTimestampStyle(timestamp: Date | string): React.CSSProperties {
    const bgColor = getTimestampColor(timestamp);

    // Extract lightness from the HSL string
    const match = bgColor.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    const lightness = match ? Number(match[3]) : 20;

    let textColor: string;
    if (lightness > 32) {
        textColor = '#e6edf3';   // bright white — for daytime backgrounds
    } else if (lightness > 18) {
        textColor = '#c9d1d9';   // light gray — for dawn/dusk
    } else if (lightness > 14) {
        textColor = '#8b949e';   // medium gray — for evening
    } else {
        textColor = '#6e7681';   // dim gray — for deep night
    }

    return {
        backgroundColor: bgColor,
        color: textColor,
        fontWeight: '500',
    };
}
