/**
 * App-wide notification store.
 * Replaces local toast state in Fail2banPage (ban alerts) and TabConfig (action feedback).
 * Header reads from this store to display a centered notification zone.
 */

import { create } from 'zustand';

export type NotifType = 'ban' | 'action' | 'attempt';

export interface NotifPrefs {
  ban: boolean;
  attempt: boolean;
  action: boolean;
}

export interface AppNotification {
  id: number;
  type: NotifType;
  // ban-specific
  ip?: string;
  jail?: string;
  failures?: number | null;
  timeofban?: number;
  // attempt-specific
  delta?: number;   // how many new failures since last poll
  total?: number;   // currentlyFailed total in this jail
  // action-specific
  message?: string;
  ok?: boolean;
  // common
  createdAt: number;
}

const TTL_BAN     = 10_000; // 10s — ban alerts, prominent enough
const TTL_ACTION  =  5_000; //  5s — action feedback
const TTL_ATTEMPT =  8_000; //  8s — attempt warnings

let _nextId = 1;

interface NotificationState {
  notifications: AppNotification[];
  prefs: NotifPrefs;
  setPrefs: (p: Partial<NotifPrefs>) => void;
  addBan: (data: Pick<AppNotification, 'ip' | 'jail' | 'failures' | 'timeofban'>) => number;
  addAttempt: (data: Pick<AppNotification, 'jail' | 'delta' | 'total'>) => number;
  addAction: (message: string, ok: boolean) => number;
  dismiss: (id: number) => void;
  dismissAll: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  prefs: { ban: true, attempt: true, action: true },

  setPrefs: (p) => set(s => ({ prefs: { ...s.prefs, ...p } })),

  addBan: (data) => {
    if (!get().prefs.ban) return 0;
    const id = _nextId++;
    set(s => ({ notifications: [...s.notifications, { ...data, id, type: 'ban', createdAt: Date.now() }] }));
    setTimeout(() => get().dismiss(id), TTL_BAN);
    return id;
  },

  addAttempt: (data) => {
    if (!get().prefs.attempt) return 0;
    const id = _nextId++;
    set(s => ({ notifications: [...s.notifications, { ...data, id, type: 'attempt', createdAt: Date.now() }] }));
    setTimeout(() => get().dismiss(id), TTL_ATTEMPT);
    return id;
  },

  addAction: (message, ok) => {
    if (!get().prefs.action) return 0;
    const id = _nextId++;
    set(s => ({ notifications: [...s.notifications, { id, type: 'action', message, ok, createdAt: Date.now() }] }));
    setTimeout(() => get().dismiss(id), TTL_ACTION);
    return id;
  },

  dismiss: (id) => {
    set(s => ({ notifications: s.notifications.filter(n => n.id !== id) }));
  },

  dismissAll: () => {
    set({ notifications: [] });
  },
}));
