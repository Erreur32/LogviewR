import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Freebox token path function removed - LogviewR doesn't use Freebox
const getTokenFilePath = (): string => {
  // This function is no longer used but kept for compatibility
  return '';
};

// Server configuration
export const config = {
  // Server
  // Default port: 3000 for production (Docker), 3004 for development
  // IMPORTANT: In Docker, use PORT (container port), not SERVER_PORT (host port)
  // SERVER_PORT is only for display/logging purposes
  port: parseInt(
    process.env.PORT || 
    (process.env.NODE_ENV === 'production' ? '3000' : '3004'), 
    10
  ),
  // Public URL for frontend access (used in logs and WebSocket URLs)
  // Priority: 1. Database config, 2. Environment variable, 3. null
  // Note: Use getPublicUrl() function to get the value (reads from DB if available)
  publicUrl: process.env.PUBLIC_URL || process.env.DASHBOARD_URL || null

  // Freebox API configuration removed - LogviewR doesn't use Freebox
};

/**
 * Get public URL with priority: Database > Environment variable > null
 * This function should be used instead of config.publicUrl to get the current value
 */
export const getPublicUrl = (): string | null => {
  try {
    // Try to get from database (if available)
    const { AppConfigRepository } = require('./database/models/AppConfig.js');
    const dbValue = AppConfigRepository.get('public_url');
    if (dbValue) return dbValue;
  } catch {
    // If AppConfigRepository is not available yet, fall back to env
  }
  return process.env.PUBLIC_URL || process.env.DASHBOARD_URL || config.publicUrl || null;
};

// API endpoints (Freebox-specific endpoints removed - LogviewR doesn't use Freebox)
export const API_ENDPOINTS = {
  // Freebox API endpoints removed - LogviewR doesn't use Freebox
};
