// Centralized permission messages and labels
import type { TFunction } from 'i18next';

// Maps permission keys to their i18n translation key suffix
export const PERMISSION_KEYS: Record<string, string> = {
  calls: 'calls',
  camera: 'camera',
  contacts: 'contacts',
  downloader: 'downloader',
  explorer: 'explorer',
  home: 'home',
  parental: 'parental',
  player: 'player',
  profile: 'profile',
  pvr: 'pvr',
  settings: 'settings',
  tv: 'tv',
  vm: 'vm',
  wdo: 'wdo'
};

export const getPermissionLabel = (permission: string, t: TFunction): string => {
  const key = PERMISSION_KEYS[permission];
  if (key) return t(`permissions.labels.${key}`);
  return permission;
};

export const getPermissionErrorMessage = (permission: string, t: TFunction): string => {
  const label = getPermissionLabel(permission, t);
  return `${t('permissions.errorRequired', { label })} ${t('permissions.errorInstructions')}`;
};

export const getPermissionShortError = (permission: string, t: TFunction): string => {
  const label = getPermissionLabel(permission, t);
  return t('permissions.shortError', { label });
};

/** Base URL of the Freebox (e.g. http://mafreebox.freebox.fr) → link toward management UI */
export function getFreeboxSettingsUrl(freeboxBaseUrl: string): string {
  const trimmed = (freeboxBaseUrl || '').trim();
  if (!trimmed) return 'http://mafreebox.freebox.fr';
  try {
    const u = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`);
    return u.toString().replace(/\/$/, '');
  } catch {
    return 'http://mafreebox.freebox.fr';
  }
}
