/**
 * Uptime history for UptimeGrid (30-day cells). Minimal persistence in memory.
 */
import { create } from 'zustand';

export type UptimeDayStatus = 'up' | 'partial' | 'down' | 'unknown';

export interface UptimeDayDisplay {
    date: string;
    status: UptimeDayStatus;
}

function emptyMonthGrid(): UptimeDayDisplay[] {
    const out: UptimeDayDisplay[] = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        out.push({ date: d.toISOString(), status: 'unknown' });
    }
    return out;
}

interface UptimeStoreState {
    days: UptimeDayDisplay[];
    recordUptime: (uptimeSeconds: number) => void;
    getHistoryForDisplay: () => UptimeDayDisplay[];
}

export const useUptimeStore = create<UptimeStoreState>((set, get) => ({
    days: emptyMonthGrid(),

    recordUptime: (uptimeSeconds: number) => {
        set((state) => {
            const days = [...state.days];
            const todayIso = new Date().toISOString().slice(0, 10);
            const idx = days.findIndex((d) => d.date.slice(0, 10) === todayIso);
            const status: UptimeDayStatus = uptimeSeconds > 0 ? 'up' : 'unknown';
            if (idx >= 0) {
                days[idx] = { ...days[idx], status };
            }
            return { days };
        });
    },

    getHistoryForDisplay: () => get().days,
}));
