import { Router } from 'express';
import { asyncHandler, createError } from '../middleware/errorHandler.js';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { authService } from '../services/authService.js';
import { bruteForceProtection } from '../services/bruteForceProtection.js';
import { securityNotificationService } from '../services/securityNotificationService.js';
import { AppConfigRepository } from '../database/models/AppConfig.js';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

const router = Router();

// GET /api/system/environment - Get environment information (NPM, Docker dev, Docker prod)
router.get('/environment', asyncHandler(async (_req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Check if running in Docker
  let isDockerEnv = false;
  try {
    const cgroup = fsSync.readFileSync('/proc/self/cgroup', 'utf8');
    if (cgroup.includes('docker') || cgroup.includes('containerd')) {
      isDockerEnv = true;
    }
  } catch {
    // Not Linux or file doesn't exist
  }
  
  if (!isDockerEnv) {
    try {
      fsSync.accessSync('/.dockerenv');
      isDockerEnv = true;
    } catch {
      // Not in Docker
    }
  }
  
  if (process.env.DOCKER === 'true' || process.env.DOCKER_CONTAINER === 'true') {
    isDockerEnv = true;
  }
  
  // Determine environment type
  const isNpmDev = !isProduction && !isDockerEnv;
  const isDockerDev = !isProduction && isDockerEnv;
  const isDockerProd = isProduction && isDockerEnv;
  
  // Get container name
  let containerName = 'LogviewR';
  if (isDockerEnv) {
    if (process.env.CONTAINER_NAME) {
      containerName = process.env.CONTAINER_NAME;
    } else {
      const hostname = os.hostname();
      if (hostname && hostname.length === 12 && /^[a-f0-9]+$/.test(hostname)) {
        containerName = isDockerDev ? 'Logviewr-dev' : 'LogviewR';
      } else {
        containerName = hostname;
      }
    }
  } else if (isNpmDev) {
    containerName = 'NPM DEV';
  }
  
  // Read app version
  let appVersion = '0.2.5';
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(fsSync.readFileSync(packageJsonPath, 'utf8'));
    appVersion = packageJson.version || appVersion;
  } catch {
    // Use default
  }
  
  // Determine version label
  let versionLabel: string;
  if (isNpmDev) {
    versionLabel = `NPM Docker DEV v${appVersion}`;
  } else if (isDockerDev) {
    versionLabel = `Docker DEV v${appVersion}`;
  } else if (isDockerProd) {
    versionLabel = `Version v${appVersion}`;
  } else {
    versionLabel = `DEV v${appVersion}`;
  }
  
  res.json({
    success: true,
    result: {
      environment: isNpmDev ? 'npm' : isDockerDev ? 'docker-dev' : isDockerProd ? 'docker-prod' : 'unknown',
      isNpmDev,
      isDockerDev,
      isDockerProd,
      containerName,
      version: appVersion,
      versionLabel,
      isDocker: isDockerEnv,
      isProduction
    }
  });
}));

// GET /api/system/security-status - Public endpoint to check JWT_SECRET status (no auth required)
router.get('/security-status', asyncHandler(async (req, res) => {
  const defaultSecrets = [
    'change-me-in-production-please-use-strong-secret',
    'dev_secret_change_in_production'
  ];
  const jwtSecret = process.env.JWT_SECRET || defaultSecrets[0];
  const jwtSecretIsDefault = !process.env.JWT_SECRET || defaultSecrets.includes(jwtSecret);
  
  res.json({
    success: true,
    result: {
      jwtSecretIsDefault,
      message: jwtSecretIsDefault 
        ? 'JWT_SECRET is not set or using default value. Please set a secure JWT_SECRET environment variable.'
        : 'JWT_SECRET is properly configured.'
    }
  });
}));

// GET /api/system/security - Get security configuration and status
router.get('/security', requireAuth, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const defaultSecrets = [
    'change-me-in-production-please-use-strong-secret',
    'dev_secret_change_in_production'
  ];
  const jwtSecret = process.env.JWT_SECRET || defaultSecrets[0];
  const jwtSecretIsDefault = !process.env.JWT_SECRET || defaultSecrets.includes(jwtSecret);
  
  const config = bruteForceProtection.getConfig();
  
  // Get current session timeout from authService (reads from DB or env var)
  const jwtExpiresIn = authService.getCurrentJwtExpiresIn();
  let sessionTimeoutHours = 24 * 7; // Default 7 days
  if (jwtExpiresIn.endsWith('d')) {
    sessionTimeoutHours = parseInt(jwtExpiresIn) * 24;
  } else if (jwtExpiresIn.endsWith('h')) {
    sessionTimeoutHours = parseInt(jwtExpiresIn);
  } else if (jwtExpiresIn.endsWith('m')) {
    sessionTimeoutHours = Math.round(parseInt(jwtExpiresIn) / 60);
  }

  res.json({
    success: true,
    result: {
      jwtSecretIsDefault,
      sessionTimeout: sessionTimeoutHours,
      requireHttps: process.env.REQUIRE_HTTPS === 'true',
      rateLimitEnabled: true, // Always enabled (can be configured later)
      maxLoginAttempts: config.maxAttempts,
      lockoutDuration: config.lockoutDuration,
      trackingWindow: config.trackingWindow
    }
  });
}));

// POST /api/system/security - Update security configuration
router.post('/security', requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const { maxLoginAttempts, lockoutDuration, sessionTimeoutHours } = req.body;

  // Update brute force protection config
  if (maxLoginAttempts !== undefined || lockoutDuration !== undefined) {
    const currentConfig = bruteForceProtection.getConfig();
    bruteForceProtection.setConfig({
      maxAttempts: maxLoginAttempts !== undefined ? parseInt(maxLoginAttempts) : currentConfig.maxAttempts,
      lockoutDuration: lockoutDuration !== undefined ? parseInt(lockoutDuration) : currentConfig.lockoutDuration
    });

    // Notify about security settings change
    if (req.user) {
      await securityNotificationService.notifySecuritySettingsChanged(
        req.user.userId,
        req.user.username,
        { maxLoginAttempts, lockoutDuration }
      );
    }
  }

  // Update JWT expiration time (session timeout)
  if (sessionTimeoutHours !== undefined) {
    const hours = parseInt(sessionTimeoutHours);
    if (isNaN(hours) || hours < 1 || hours > 168) {
      return res.status(400).json({
        success: false,
        error: { message: 'Session timeout must be between 1 and 168 hours (7 days)' }
      });
    }

    // Convert hours to JWT format (prefer days if >= 24h, otherwise hours)
    let jwtExpiresIn: string;
    if (hours >= 24 && hours % 24 === 0) {
      jwtExpiresIn = `${hours / 24}d`;
    } else {
      jwtExpiresIn = `${hours}h`;
    }

    try {
      authService.updateJwtExpiresIn(jwtExpiresIn);
      
      // Notify about security settings change
      if (req.user) {
        await securityNotificationService.notifySecuritySettingsChanged(
          req.user.userId,
          req.user.username,
          { sessionTimeout: jwtExpiresIn }
        );
      }
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: { message: error instanceof Error ? error.message : 'Failed to update session timeout' }
      });
    }
  }

  const config = bruteForceProtection.getConfig();
  const currentJwtExpiresIn = authService.getCurrentJwtExpiresIn();
  let currentSessionTimeoutHours = 24 * 7; // Default
  if (currentJwtExpiresIn.endsWith('d')) {
    currentSessionTimeoutHours = parseInt(currentJwtExpiresIn) * 24;
  } else if (currentJwtExpiresIn.endsWith('h')) {
    currentSessionTimeoutHours = parseInt(currentJwtExpiresIn);
  } else if (currentJwtExpiresIn.endsWith('m')) {
    currentSessionTimeoutHours = Math.round(parseInt(currentJwtExpiresIn) / 60);
  }
  
  res.json({
    success: true,
    result: {
      maxLoginAttempts: config.maxAttempts,
      lockoutDuration: config.lockoutDuration,
      sessionTimeout: currentSessionTimeoutHours,
      message: sessionTimeoutHours !== undefined 
        ? 'Security settings updated. Note: New session timeout will apply to new login sessions only. Existing sessions will keep their original expiration time.'
        : 'Security settings updated.'
    }
  });
}));

// GET /api/system/general - Get general application settings
router.get('/general', requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  const publicUrl = AppConfigRepository.get('public_url') || process.env.PUBLIC_URL || process.env.DASHBOARD_URL || '';
  
  // Get CORS config from database
  const corsConfigJson = AppConfigRepository.get('cors_config');
  const corsConfig = corsConfigJson ? JSON.parse(corsConfigJson) : null;
  
  // Get remember last file setting (default to true)
  const rememberLastFileJson = AppConfigRepository.get('remember_last_file');
  const rememberLastFile = rememberLastFileJson ? JSON.parse(rememberLastFileJson) : true;
  
  // Get default page settings
  const defaultPageJson = AppConfigRepository.get('default_page');
  const defaultPage = defaultPageJson ? JSON.parse(defaultPageJson) : 'dashboard';
  
  const defaultPluginIdJson = AppConfigRepository.get('default_plugin_id');
  const defaultPluginId = defaultPluginIdJson ? JSON.parse(defaultPluginIdJson) : '';
  
  const defaultLogFileJson = AppConfigRepository.get('default_log_file');
  const defaultLogFile = defaultLogFileJson ? JSON.parse(defaultLogFileJson) : '';
  
  res.json({
    success: true,
    result: {
      publicUrl,
      corsConfig,
      rememberLastFile,
      defaultPage,
      defaultPluginId,
      defaultLogFile
    }
  });
}));

// PUT /api/system/general - Update general application settings
router.put('/general', requireAuth, requireAdmin, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const { publicUrl, corsConfig, rememberLastFile, defaultPage, defaultPluginId, defaultLogFile } = req.body;

  // Validate publicUrl format if provided
  if (publicUrl !== undefined && publicUrl !== null && publicUrl !== '') {
    try {
      // Validate URL format
      const url = new URL(publicUrl);
      // Ensure it's http or https
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw createError('Public URL must use http:// or https:// protocol', 400, 'INVALID_URL');
      }
      
      // Save to database
      AppConfigRepository.set('public_url', publicUrl);
      
      // Also update environment variable for current process (for immediate effect)
      process.env.PUBLIC_URL = publicUrl;
      
      // Log the change
      if (req.user) {
        await securityNotificationService.notifySecuritySettingsChanged(
          req.user.userId,
          req.user.username,
          { publicUrl: 'Updated' }
        );
      }
    } catch (error) {
      if (error instanceof TypeError) {
        throw createError('Invalid URL format. Please use format: https://domain.com or http://domain.com', 400, 'INVALID_URL');
      }
      throw error;
    }
  } else if (publicUrl === '') {
    // Empty string means clear the setting
    AppConfigRepository.delete('public_url');
    delete process.env.PUBLIC_URL;
  }

  // Handle remember last file setting
  if (rememberLastFile !== undefined) {
    if (typeof rememberLastFile !== 'boolean') {
      throw createError('rememberLastFile must be a boolean', 400, 'INVALID_REMEMBER_LAST_FILE');
    }
    AppConfigRepository.set('remember_last_file', JSON.stringify(rememberLastFile));
  }

  // Handle CORS configuration
  if (corsConfig !== undefined) {
    try {
      // Validate CORS config structure
      if (corsConfig.allowedOrigins && !Array.isArray(corsConfig.allowedOrigins)) {
        throw createError('allowedOrigins must be an array', 400, 'INVALID_CORS_CONFIG');
      }
      if (corsConfig.allowCredentials !== undefined && typeof corsConfig.allowCredentials !== 'boolean') {
        throw createError('allowCredentials must be a boolean', 400, 'INVALID_CORS_CONFIG');
      }
      if (corsConfig.allowedMethods && !Array.isArray(corsConfig.allowedMethods)) {
        throw createError('allowedMethods must be an array', 400, 'INVALID_CORS_CONFIG');
      }
      if (corsConfig.allowedHeaders && !Array.isArray(corsConfig.allowedHeaders)) {
        throw createError('allowedHeaders must be an array', 400, 'INVALID_CORS_CONFIG');
      }

      // Validate origins format
      if (corsConfig.allowedOrigins) {
        for (const origin of corsConfig.allowedOrigins) {
          if (typeof origin !== 'string' || origin.trim() === '') {
            throw createError('Each origin must be a non-empty string', 400, 'INVALID_CORS_CONFIG');
          }
          // Allow wildcard or valid URL patterns
          if (origin !== '*' && !origin.match(/^https?:\/\//) && !origin.match(/^\/.*\/$/)) {
            throw createError(`Invalid origin format: ${origin}. Must be a URL (http://... or https://...) or a regex pattern (/pattern/)`, 400, 'INVALID_CORS_CONFIG');
          }
        }
      }

      // Save to database as JSON
      AppConfigRepository.set('cors_config', JSON.stringify(corsConfig));
      
      // Log the change
      if (req.user) {
        await securityNotificationService.notifySecuritySettingsChanged(
          req.user.userId,
          req.user.username,
          { corsConfig: 'Updated' }
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('INVALID_CORS_CONFIG')) {
        throw error;
      }
      throw createError('Invalid CORS configuration format', 400, 'INVALID_CORS_CONFIG');
    }
  }

  const currentPublicUrl = AppConfigRepository.get('public_url') || process.env.PUBLIC_URL || process.env.DASHBOARD_URL || '';
  
  // Get current CORS config
  const corsConfigJson = AppConfigRepository.get('cors_config');
  const currentCorsConfig = corsConfigJson ? JSON.parse(corsConfigJson) : null;
  
  // Get current remember last file setting
  const rememberLastFileJson = AppConfigRepository.get('remember_last_file');
  const currentRememberLastFile = rememberLastFileJson ? JSON.parse(rememberLastFileJson) : true;
  
  // Get current default page settings
  const currentDefaultPageJson = AppConfigRepository.get('default_page');
  const currentDefaultPage = currentDefaultPageJson ? JSON.parse(currentDefaultPageJson) : 'dashboard';
  
  const currentDefaultPluginIdJson = AppConfigRepository.get('default_plugin_id');
  const currentDefaultPluginId = currentDefaultPluginIdJson ? JSON.parse(currentDefaultPluginIdJson) : '';
  
  const currentDefaultLogFileJson = AppConfigRepository.get('default_log_file');
  const currentDefaultLogFile = currentDefaultLogFileJson ? JSON.parse(currentDefaultLogFileJson) : '';

  res.json({
    success: true,
    result: {
      publicUrl: currentPublicUrl,
      corsConfig: currentCorsConfig,
      rememberLastFile: currentRememberLastFile,
      defaultPage: currentDefaultPage,
      defaultPluginId: currentDefaultPluginId,
      defaultLogFile: currentDefaultLogFile,
      message: 'General settings updated. Note: CORS changes require a server restart to take full effect.'
    }
  });
}));

export default router;