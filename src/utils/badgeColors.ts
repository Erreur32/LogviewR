/**
 * Badge Colors Utilities
 * 
 * Functions to generate consistent colors for badges (IP, hostname, timestamp)
 * Ensures same value = same color across all logs (all plugins, all files)
 */

/**
 * Hash function (djb2) for stable color generation
 * Same string always produces same hash
 */
function hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash;
}

/**
 * Get consistent badge color for an IP address
 * Same IP = same color in all logs (all plugins, all files)
 * 
 * @param ip - IP address (IPv4 or IPv6)
 * @returns HSL color string or Tailwind class
 */
export function getIPBadgeColor(ip: string): string {
    if (!ip || ip.trim() === '') {
        return 'bg-gray-600/20 text-gray-400';
    }
    
    const hash = hashString(ip.trim());
    const hue = Math.abs(hash) % 360;
    
    // Use HSL for better color distribution
    // Saturation 70%, Lightness 50% for good contrast
    return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Get consistent badge color for a hostname
 * Same hostname = same color in all logs
 * 
 * @param hostname - Hostname string
 * @returns HSL color string or Tailwind class
 */
export function getHostnameBadgeColor(hostname: string): string {
    if (!hostname || hostname.trim() === '') {
        return 'bg-gray-600/20 text-gray-400';
    }
    
    const hash = hashString(hostname.trim());
    const hue = Math.abs(hash) % 360;
    
    // Slightly different saturation/lightness to distinguish from IP badges
    // Saturation 65%, Lightness 55% for distinction
    return `hsl(${hue}, 65%, 55%)`;
}

/**
 * Get color for timestamp based on time of day
 * Uses 30-minute time slots for smooth gradient, same color each day for same time
 * Optimized for better visibility: not too dark, not too light
 * 
 * @param timestamp - Date object or ISO string
 * @returns HSL color string for inline style
 */
export function getTimestampColor(timestamp: Date | string): string {
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    
    if (isNaN(date.getTime())) {
        return 'hsl(0, 0%, 35%)'; // Gray fallback
    }
    
    const hour = date.getHours();
    const minute = date.getMinutes();
    
    // Use 30-minute slots (48 slots per day) for smoother gradient
    // Same time slot = same color every day
    const slotIndex = hour * 2 + Math.floor(minute / 30);
    
    // Map 48 slots (0-47) to a full color cycle (0-360°)
    // Each slot represents ~7.5° of hue
    const baseHue = (slotIndex * 360) / 48;
    
    // Create a day/night cycle with varying saturation and lightness
    // Nuit (00h-06h, slots 0-11): Bleu/violet foncé
    if (slotIndex >= 0 && slotIndex < 12) {
        const progress = slotIndex / 12; // 0 to 1
        const hue = 240 + (progress * 30); // 240° (indigo) to 270° (purple)
        const saturation = 65 + (progress * 15); // 65% to 80%
        const lightness = 35 + (progress * 10); // 35% to 45%
        return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
    }
    
    // Aube (06h-09h, slots 12-17): Orange/rose
    if (slotIndex >= 12 && slotIndex < 18) {
        const progress = (slotIndex - 12) / 6; // 0 to 1
        const hue = 15 + (progress * 335); // 15° (orange) to 350° (pink)
        const saturation = 75 + (progress * 5); // 75% to 80%
        const lightness = 45 + (progress * 10); // 45% to 55%
        return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
    }
    
    // Jour (09h-18h, slots 18-35): Jaune/vert clair
    if (slotIndex >= 18 && slotIndex < 36) {
        const progress = (slotIndex - 18) / 18; // 0 to 1
        const hue = 60 + (progress * 60); // 60° (yellow) to 120° (green)
        const saturation = 75 - (progress * 15); // 75% to 60%
        const lightness = 50 + (progress * 10); // 50% to 60%
        return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
    }
    
    // Crépuscule (18h-21h, slots 36-41): Orange/rouge
    if (slotIndex >= 36 && slotIndex < 42) {
        const progress = (slotIndex - 36) / 6; // 0 to 1
        const hue = 20 - (progress * 20); // 20° (orange-red) to 0° (red)
        const saturation = 75 + (progress * 5); // 75% to 80%
        const lightness = 45 + (progress * 5); // 45% to 50%
        return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
    }
    
    // Soirée (21h-00h, slots 42-47): Bleu/violet
    const progress = (slotIndex - 42) / 6; // 0 to 1
    const hue = 220 + (progress * 20); // 220° (blue) to 240° (indigo)
    const saturation = 65 + (progress * 5); // 65% to 70%
    const lightness = 40 + (progress * 5); // 40% to 45%
    return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}

/**
 * Calculate relative luminance of a color (for contrast calculation)
 * Returns a value between 0 (dark) and 1 (light)
 */
function getLuminance(hsl: string): number {
    // Extract HSL values from string like "hsl(240, 65%, 40%)"
    const match = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!match) return 0.5; // Default to medium
    
    const [, h, s, l] = match.map(Number);
    // Convert HSL lightness to relative luminance
    // Simplified: lightness percentage / 100
    return l / 100;
}

/**
 * Get inline style for timestamp with proper contrast
 * Automatically adjusts text color based on background brightness
 */
export function getTimestampStyle(timestamp: Date | string): React.CSSProperties {
    const bgColor = getTimestampColor(timestamp);
    const luminance = getLuminance(bgColor);
    
    // Use white text for darker backgrounds (luminance < 0.5)
    // Use dark text for lighter backgrounds (luminance >= 0.5)
    const textColor = luminance < 0.5 ? '#ffffff' : '#1a1a1a';
    
    // Add slight opacity to background for better integration, but keep it visible
    // Use rgba with opacity or keep hsl with full opacity for better visibility
    return {
        backgroundColor: bgColor,
        color: textColor,
        fontWeight: '500', // Medium weight for better readability
        // Remove opacity to ensure full color visibility
        // Add subtle border for definition
        border: `1px solid ${luminance < 0.5 ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`
    };
}

/**
 * Get inline style for IP badge with proper contrast
 */
export function getIPBadgeStyle(ip: string): React.CSSProperties {
    const bgColor = getIPBadgeColor(ip);
    
    // If it's HSL, use it directly
    if (bgColor.startsWith('hsl(')) {
        return {
            backgroundColor: bgColor,
            color: '#ffffff',
            fontWeight: '500'
        };
    }
    
    // Otherwise return empty (use Tailwind class)
    return {};
}

/**
 * Get inline style for hostname badge with proper contrast
 */
export function getHostnameBadgeStyle(hostname: string): React.CSSProperties {
    const bgColor = getHostnameBadgeColor(hostname);
    
    // If it's HSL, use it directly
    if (bgColor.startsWith('hsl(')) {
        return {
            backgroundColor: bgColor,
            color: '#ffffff',
            fontWeight: '500'
        };
    }
    
    // Otherwise return empty (use Tailwind class)
    return {};
}

/**
 * Get consistent badge color for a username
 * Same username = same color in all logs (all plugins, all files)
 * 
 * @param username - Username string
 * @returns HSL color string
 */
export function getUserBadgeColor(username: string): string {
    if (!username || username.trim() === '') {
        return 'bg-gray-600/20 text-gray-400';
    }
    
    const hash = hashString(username.trim());
    const hue = Math.abs(hash) % 360;
    
    // Different saturation/lightness to distinguish from IP and hostname badges
    // Saturation 70%, Lightness 50% for good contrast and distinction
    return `hsl(${hue}, 70%, 50%)`;
}

/**
 * Get inline style for user badge with proper contrast
 */
export function getUserBadgeStyle(username: string): React.CSSProperties {
    const bgColor = getUserBadgeColor(username);
    
    // If it's HSL, use it directly
    if (bgColor.startsWith('hsl(')) {
        return {
            backgroundColor: bgColor,
            color: '#ffffff',
            fontWeight: '500'
        };
    }
    
    // Otherwise return empty (use Tailwind class)
    return {};
}
