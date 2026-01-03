/**
 * Application version constant
 * This file should match package.json version
 */

export const APP_VERSION = '0.1.4';
export const APP_NAME = 'LogviewR';

/**
 * Environment information from server
 */
let environmentInfo: {
  environment: string;
  versionLabel: string;
  containerName: string;
} | null = null;

/**
 * Fetch environment information from server
 */
export const fetchEnvironmentInfo = async (): Promise<void> => {
  try {
    const response = await fetch('/api/system/environment');
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.result) {
        environmentInfo = {
          environment: data.result.environment,
          versionLabel: data.result.versionLabel,
          containerName: data.result.containerName
        };
      }
    }
  } catch (error) {
    // Silently fail - use default version
    console.warn('[Version] Failed to fetch environment info:', error);
  }
};

/**
 * Get the formatted version string with 'v' prefix
 * Uses server environment info if available, otherwise falls back to local version
 */
export const getVersionString = (): string => {
  if (environmentInfo?.versionLabel) {
    return environmentInfo.versionLabel;
  }
  return `v${APP_VERSION}`;
};

/**
 * Get container name from server
 */
export const getContainerName = (): string => {
  return environmentInfo?.containerName || APP_NAME;
};

