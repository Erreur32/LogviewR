/**
 * Download task details (trackers, peers, files, etc.) — stub store until a backend API is wired.
 */
import { create } from 'zustand';
import type { DownloadTracker, DownloadPeer, DownloadFile, DownloadBlacklistEntry } from '../types/api';

export const useDownloadsStore = create(() => ({
    getTrackers: async (_taskId: string): Promise<DownloadTracker[]> => [],
    getPeers: async (_taskId: string): Promise<DownloadPeer[]> => [],
    getFiles: async (_taskId: string): Promise<DownloadFile[]> => [],
    updateFilePriority: async (_taskId: string, _fileId: string, _priority: string): Promise<boolean> => false,
    getPieces: async (_taskId: string): Promise<string> => '',
    getBlacklist: async (_taskId: string): Promise<DownloadBlacklistEntry[]> => [],
    emptyBlacklist: async (_taskId: string): Promise<boolean> => false,
    getLog: async (_taskId: string): Promise<string> => '',
}));
