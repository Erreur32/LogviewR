/**
 * Plugin Summary Card
 * 
 * Displays a summary card for a specific plugin with key statistics
 */

import React from 'react';
import { Card } from './Card';
import { BarChart } from './BarChart';
import { StatusBadge } from '../ui';
import { usePluginStore } from '../../stores/pluginStore';
import { useConnectionStore } from '../../stores';
// WiFi store and authentication removed
import { useSystemStore } from '../../stores/systemStore';
import { formatSpeed, formatTemperature } from '../../utils/constants';
import { Server, Wifi, Activity, ArrowRight, CheckCircle, XCircle, AlertCircle, Cpu, HardDrive, Fan, Phone, ArrowDown, ArrowUp } from 'lucide-react';
import type { SystemSensor, SystemFan } from '../../types/api';

interface PluginSummaryCardProps {
    pluginId: string;
    onViewDetails?: () => void;
    hideController?: boolean;
    cardClassName?: string;
    showDeviceTables?: boolean; // Show APs and Switches tables (for Analyse tab)
}

 

 
 
export const PluginSummaryCard: React.FC<PluginSummaryCardProps> = ({ pluginId, onViewDetails, hideController = false, cardClassName, showDeviceTables = false }) => {
    const { plugins, pluginStats } = usePluginStore();
    
    const { info: systemInfo } = useSystemStore();
    
    const plugin = plugins.find(p => p.id === pluginId);
    const stats = pluginStats[pluginId];

    if (!plugin) return null;

    const isActive = plugin.enabled && plugin.connectionStatus;
    const hasStats = stats && (stats.network || stats.devices || stats.system);

 
    // Get icon based on plugin
    const getIcon = () => {
        switch (pluginId) {
            case 'host-system':
                return <Server size={20} className="text-cyan-400" />;
            case 'nginx':
                return <Activity size={20} className="text-green-400" />;
            case 'apache':
                return <Activity size={20} className="text-orange-400" />;
            case 'npm':
                return <Activity size={20} className="text-blue-400" />;
            default:
                return <Activity size={20} className="text-gray-400" />;
        }
    };
 
};

