/**
 * Wireshark vendor data (OUI) — optional auto-update flag used by database config.
 * Full vendor DB sync can be implemented separately; this module only stores the preference.
 */
export class WiresharkVendorService {
    private static autoUpdateEnabled = false;

    static setAutoUpdateEnabled(enabled: boolean): void {
        WiresharkVendorService.autoUpdateEnabled = enabled;
    }

    static getAutoUpdateEnabled(): boolean {
        return WiresharkVendorService.autoUpdateEnabled;
    }
}
