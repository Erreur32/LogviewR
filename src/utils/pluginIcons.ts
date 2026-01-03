/**
 * Plugin Icons Utility
 * 
 * Provides icon paths and components for different plugins
 */

import apacheIcon from '../icons/apache.svg';
import nginxIcon from '../icons/nginx.svg';
import npmIcon from '../icons/npm.svg';
import debianIcon from '../icons/debian.svg';
import ubuntuIcon from '../icons/ubuntu.svg';
import centosIcon from '../icons/centos.svg';
import fedoraIcon from '../icons/fedora.svg';
import archIcon from '../icons/arch.svg';
import suseIcon from '../icons/suse.svg';
import systemIcon from '../icons/system.svg';

export interface PluginIconInfo {
  icon: string;
  name: string;
  osType?: string;
}

/**
 * Get plugin icon path by plugin ID
 */
export function getPluginIcon(pluginId: string, osType?: string): string {
  switch (pluginId) {
    case 'apache':
      return apacheIcon;
    case 'nginx':
      return nginxIcon;
    case 'npm':
      return npmIcon;
    case 'host-system':
      // Return OS-specific icon if available, otherwise generic system icon
      if (osType) {
        switch (osType.toLowerCase()) {
          case 'debian':
            return debianIcon;
          case 'ubuntu':
            return ubuntuIcon;
          case 'centos':
          case 'rhel':
            return centosIcon;
          case 'fedora':
            return fedoraIcon;
          case 'arch':
            return archIcon;
          case 'suse':
            return suseIcon;
          default:
            return systemIcon;
        }
      }
      return systemIcon;
    default:
      return systemIcon;
  }
}

/**
 * Get plugin display name
 */
export function getPluginName(pluginId: string): string {
  switch (pluginId) {
    case 'apache':
      return 'Apache';
    case 'nginx':
      return 'Nginx';
    case 'npm':
      return 'NPM';
    case 'host-system':
      return 'Host System';
    default:
      return 'Plugin';
  }
}
