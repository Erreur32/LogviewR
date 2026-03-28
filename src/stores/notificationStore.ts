/**
 * App-wide notification store.
 * Replaces local toast state in Fail2banPage (ban alerts) and TabConfig (action feedback).
 * Header reads from this store to display a centered notification zone.
 */

import { create } from 'zustand';

export type NotifType = 'ban' | 'action';

export interface AppNotification {
  id: number;
  type: NotifType;
  // ban-specific
  ip?: string;
  jail?: string;
  failures?: number | null;
  timeofban?: number;
  // action-specific
  message?: string;
  ok?: boolean;
  // common
  createdAt: number;
}

const TTL_BAN    = 10_000; // 10s — ban alerts, prominent enough
const TTL_ACTION =  5_000; //  5s — action feedback

let _nextId = 1;

interface NotificationState {
  notifications: AppNotification[];
  addBan: (data: Pick<AppNotification, 'ip' | 'jail' | 'failures' | 'timeofban'>) => number;
  addAction: (message: string, ok: boolean) => number;
  dismiss: (id: number) => void;
  dismissAll: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  addBan: (data) => {
    const id = _nextId++;
    set(s => ({ notifications: [...s.notifications, { ...data, id, type: 'ban', createdAt: Date.now() }] }));
    setTimeout(() => get().dismiss(id), TTL_BAN);
    return id;
  },

  addAction: (message, ok) => {
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
