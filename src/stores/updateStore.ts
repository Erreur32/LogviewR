/**
 * Update Store
 *
 * Manages update checking and configuration
 */

import { create } from 'zustand';
import { api } from '../api/client';

export interface UpdateInfo {
  enabled: boolean;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  dockerReady?: boolean;   // Docker image available on GHCR for that version
  error?: string;
}

export interface UpdateConfig {
  enabled: boolean;
  frequency: number;  // hours: 1, 6, 12, 24, 168 (7j)
}

interface UpdateStore {
  updateInfo: UpdateInfo | null;
  updateConfig: UpdateConfig | null;
  isLoading: boolean;
  lastCheck: Date | null;

  // Actions
  checkForUpdates: () => Promise<void>;
  loadConfig: () => Promise<void>;
  setConfig: (enabled: boolean, frequency?: number) => Promise<void>;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  updateInfo: null,
  updateConfig: null,
  isLoading: false,
  lastCheck: null,

  checkForUpdates: async () => {
    set({ isLoading: true });
    try {
      const response = await api.get<UpdateInfo>('/api/updates/check');
      if (response.success && response.result) {
        set({
          updateInfo: response.result,
          lastCheck: new Date(),
          isLoading: false,
        });
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error('[UpdateStore] Error checking for updates:', error);
      set({ isLoading: false });
    }
  },

  loadConfig: async () => {
    try {
      const response = await api.get<UpdateConfig>('/api/updates/config');
      if (response.success && response.result) {
        set({ updateConfig: response.result });
      }
    } catch (error) {
      console.error('[UpdateStore] Error loading config:', error);
    }
  },

  setConfig: async (enabled: boolean, frequency?: number) => {
    try {
      const payload = {
        enabled,
        frequency: frequency ?? get().updateConfig?.frequency ?? 24,
      };
      const response = await api.post<UpdateConfig>('/api/updates/config', payload);
      if (response.success && response.result) {
        set({ updateConfig: response.result });
        if (enabled) {
          get().checkForUpdates();
        }
      }
    } catch (error) {
      console.error('[UpdateStore] Error setting config:', error);
      throw error;
    }
  },
}));
