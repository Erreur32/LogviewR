/**
 * Plugin Priority Configuration Service
 * 
 * Manages the priority order for plugins when detecting hostnames and vendors
 * Allows users to configure which plugin takes precedence when data conflicts
 */

import { AppConfigRepository } from '../database/models/AppConfig.js';
import { logger } from '../utils/logger.js';

export interface PluginPriorityConfig {
    hostnamePriority: string[]; // Order: first has highest priority
    vendorPriority: string[]; // Order: first has highest priority
    overwriteExisting: {
        hostname: boolean; // If true, plugin data overwrites existing non-empty hostname
        vendor: boolean; // If true, plugin data overwrites existing non-empty vendor
    };
}

const DEFAULT_CONFIG: PluginPriorityConfig = {
    hostnamePriority: [], // No plugins by default
    vendorPriority: [], // No plugins by default
    overwriteExisting: {
        hostname: true,
        vendor: true
    }
};

export class PluginPriorityConfigService {
    private static readonly CONFIG_KEY = 'plugin_priority_config';
    
    /**
     * Get current priority configuration
     */
    static getConfig(): PluginPriorityConfig {
        try {
            const configJson = AppConfigRepository.get(this.CONFIG_KEY);
            if (configJson) {
                const config = JSON.parse(configJson) as PluginPriorityConfig;
                // Validate and merge with defaults
                return {
                    hostnamePriority: config.hostnamePriority || DEFAULT_CONFIG.hostnamePriority,
                    vendorPriority: config.vendorPriority || DEFAULT_CONFIG.vendorPriority,
                    overwriteExisting: {
                        hostname: config.overwriteExisting?.hostname ?? DEFAULT_CONFIG.overwriteExisting.hostname,
                        vendor: config.overwriteExisting?.vendor ?? DEFAULT_CONFIG.overwriteExisting.vendor
                    }
                };
            }
        } catch (error) {
            logger.error('PluginPriorityConfig', `Failed to load config: ${error}`);
        }
        
        return DEFAULT_CONFIG;
    }
    
    /**
     * Save priority configuration
     */
    static setConfig(config: PluginPriorityConfig): boolean {
        try {
            // Validate config
            if (!Array.isArray(config.hostnamePriority) || !Array.isArray(config.vendorPriority)) {
                logger.error('PluginPriorityConfig', 'Invalid config format');
                return false;
            }
            
            // Validate config (no specific plugins required for LogviewR)
            // This service is kept for compatibility but not actively used
            
            const success = AppConfigRepository.set(this.CONFIG_KEY, JSON.stringify(config));
            if (success) {
                logger.info('PluginPriorityConfig', 'Priority configuration saved successfully');
            }
            return success;
        } catch (error) {
            logger.error('PluginPriorityConfig', `Failed to save config: ${error}`);
            return false;
        }
    }
    
    /**
     * Reset to default configuration
     */
    static resetToDefault(): boolean {
        return this.setConfig(DEFAULT_CONFIG);
    }
}

