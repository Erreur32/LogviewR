/**
 * Log Table Component
 * 
 * Tableau structuré avec colonnes dynamiques selon type de log
 * Avec tri adaptatif, statistiques et formatage amélioré
 */

import React, { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, FileText, Archive } from 'lucide-react';
import type { LogEntry } from '../../types/logViewer.js';
import type { LogFilters as LogFiltersType } from '../../types/logViewer.js';
import { LogBadge } from './LogBadge.js';
import { LogFilters } from './LogFilters.js';
import { getTimestampColor, getIPBadgeColor, getHostnameBadgeColor, getIPBadgeStyle, getHostnameBadgeStyle, getTimestampStyle, getUserBadgeColor, getUserBadgeStyle } from '../../utils/badgeColors.js';
import { getPluginIcon, getPluginName } from '../../utils/pluginIcons.js';
import { Tooltip } from '../ui/Tooltip.js';

interface SortConfig {
    column: string;
    direction: 'asc' | 'desc';
}

interface LogTableProps {
    logs: LogEntry[];
    columns: string[];
    logType?: string;
    isLoading?: boolean;
    className?: string;
    filteredCount?: number; // Number of logs filtered out by filters
    currentPage?: number;
    pageSize?: number;
    onPageChange?: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
    // Filter props (optional - if not provided, filters won't be shown)
    filters?: LogFiltersType;
    onFiltersChange?: (filters: Partial<LogFiltersType>) => void;
    logDateRange?: { min?: Date; max?: Date };
    pluginId?: string;
    selectedFilePath?: string; // Current log file path to display
    fileSize?: number; // File size in bytes
}

// Helper function to format file size
const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

// Get display name for column
const getColumnDisplayName = (columnName: string): string => {
    const col = columnName.toLowerCase();
    const displayNames: Record<string, string> = {
        'timestamp': 'Time',
        'date': 'Date',
        'time': 'Time',
        'hostname': 'Hostname',
        'tag': 'Tag',
        'level': 'Level',
        'message': 'Message',
        'service': 'Service',
        'component': 'Component',
        'pid': 'PID',
        'action': 'Action',
        'ipaddress': 'IP Address',
        'queueid': 'Queue ID',
        'user': 'User',
        'vhost': 'Virtual Host',
        'port': 'Port',
        'ip': 'IP',
        'method': 'Method',
        'url': 'URL',
        'status': 'Status',
        'size': 'Size',
        'referer': 'Referer',
        'useragent': 'User Agent',
        'module': 'Module',
        'clientip': 'Client IP',
        'remoteip': 'Remote IP'
    };
    
    return displayNames[col] || columnName;
};

// Detect column type for sorting
const getColumnType = (columnName: string): 'date' | 'number' | 'ip' | 'text' | 'badge' => {
    const col = columnName.toLowerCase();
    
    // Date/timestamp columns
    if (['timestamp', 'date', 'time'].includes(col)) {
        return 'date';
    }
    
    // Numeric columns
    if (['status', 'statuscode', 'httpcode', 'size', 'responsetime', 'pid', 'tid'].includes(col)) {
        return 'number';
    }
    
    // IP columns
    if (['ip', 'ipaddress', 'clientip', 'remoteip'].includes(col)) {
        return 'ip';
    }
    
    // Badge columns (level, severity)
    if (['level', 'severity'].includes(col)) {
        return 'badge';
    }
    
    // Default: text
    return 'text';
};

// Compare IPs octet by octet
const compareIPs = (ip1: string, ip2: string): number => {
    try {
        const parts1 = ip1.split('.').map(Number);
        const parts2 = ip2.split('.').map(Number);
        
        // Handle IPv6 or invalid IPs
        if (parts1.length !== 4 || parts2.length !== 4) {
            return ip1.localeCompare(ip2);
        }
        
        for (let i = 0; i < 4; i++) {
            if (parts1[i] !== parts2[i]) {
                return parts1[i] - parts2[i];
            }
        }
        return 0;
    } catch {
        return ip1.localeCompare(ip2);
    }
};

// Sortable header component
interface SortableHeaderProps {
    column: string;
    sortConfig: SortConfig;
    onSort: (column: string) => void;
}

const SortableHeader: React.FC<SortableHeaderProps> = ({ column, sortConfig, onSort }) => {
    const isSorted = sortConfig.column === column;
    const direction = isSorted ? sortConfig.direction : null;
    
    const handleClick = () => {
        if (isSorted && sortConfig.direction === 'desc') {
            onSort(column); // Switch to asc
        } else if (isSorted && sortConfig.direction === 'asc') {
            onSort(column); // Switch to desc
        } else {
            onSort(column); // Start with desc for most columns
        }
    };
    
    return (
        <th
            onClick={handleClick}
            className={`px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider border-r border-gray-800 last:border-r-0 cursor-pointer hover:bg-gray-800/50 select-none transition-colors ${
                isSorted ? 'bg-gray-800/30' : ''
            }`}
            style={{ width: 'auto' }}
        >
            <div className="flex items-center gap-2">
                <span>{getColumnDisplayName(column)}</span>
                {direction === 'asc' && <ArrowUp className="w-3 h-3 text-cyan-400" />}
                {direction === 'desc' && <ArrowDown className="w-3 h-3 text-cyan-400" />}
                {!direction && <ArrowUpDown className="w-3 h-3 text-gray-600 opacity-50" />}
            </div>
        </th>
    );
};

export const LogTable: React.FC<LogTableProps> = ({
    logs,
    columns,
    logType = 'syslog',
    isLoading = false,
    className = '',
    filteredCount = 0,
    currentPage = 1,
    pageSize = 100,
    onPageChange,
    onPageSizeChange,
    filters,
    onFiltersChange,
    logDateRange,
    pluginId,
    selectedFilePath,
    fileSize
}) => {
    // Filter out columns that are always empty (like pid for daemon.log)
    const visibleColumns = useMemo(() => {
        let filteredColumns = [...columns];
        
        if (logType === 'daemon') {
            // Check if pid column has any non-empty values
            const hasPid = logs.some(log => {
                const pidValue = log.pid;
                return pidValue !== null && pidValue !== undefined && pidValue !== '' && 
                       !(typeof pidValue === 'string' && pidValue.trim() === '') &&
                       !isNaN(Number(pidValue));
            });
            
            // Remove pid column if it's always empty
            if (!hasPid) {
                filteredColumns = filteredColumns.filter(col => col.toLowerCase() !== 'pid');
            }
        }
        
        return filteredColumns;
    }, [columns, logs, logType]);
    
    // Reorder columns: timestamp/date/time always first
    const orderedColumns = useMemo(() => {
        const timestampCols = visibleColumns.filter(col => 
            ['timestamp', 'date', 'time'].includes(col.toLowerCase())
        );
        const otherCols = visibleColumns.filter(col => 
            !['timestamp', 'date', 'time'].includes(col.toLowerCase())
        );
        return [...timestampCols, ...otherCols];
    }, [visibleColumns]);
    
    // Sort state
    const [sortConfig, setSortConfig] = useState<SortConfig>({
        column: orderedColumns[0] || 'timestamp',
        direction: 'desc'
    });
    
    // Handle sort
    const handleSort = (column: string) => {
        setSortConfig(prev => {
            if (prev.column === column) {
                // Toggle direction
                return {
                    column,
                    direction: prev.direction === 'asc' ? 'desc' : 'asc'
                };
            } else {
                // New column, default to desc for most columns, asc for text
                const colType = getColumnType(column);
                return {
                    column,
                    direction: colType === 'text' ? 'asc' : 'desc'
                };
            }
        });
    };
    
    // Sorted logs
    const sortedLogs = useMemo(() => {
        const sorted = [...logs];
        const columnType = getColumnType(sortConfig.column);
        
        sorted.sort((a, b) => {
            const aValue = a[sortConfig.column];
            const bValue = b[sortConfig.column];
            
            // Handle null/undefined values
            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;
            
            switch (columnType) {
                case 'date':
                    try {
                        const aDate = aValue instanceof Date ? aValue : new Date(aValue as string);
                        const bDate = bValue instanceof Date ? bValue : new Date(bValue as string);
                        if (isNaN(aDate.getTime())) return 1;
                        if (isNaN(bDate.getTime())) return -1;
                        return aDate.getTime() - bDate.getTime();
                    } catch {
                        return String(aValue).localeCompare(String(bValue));
                    }
                
                case 'number':
                    const aNum = Number(aValue);
                    const bNum = Number(bValue);
                    if (isNaN(aNum)) return 1;
                    if (isNaN(bNum)) return -1;
                    return aNum - bNum;
                
                case 'ip':
                    return compareIPs(String(aValue), String(bValue));
                
                case 'badge':
                    // Sort by severity order
                    const severityOrder: Record<string, number> = {
                        'error': 0,
                        'err': 0,
                        'warning': 1,
                        'warn': 1,
                        'info': 2,
                        'notice': 3,
                        'debug': 4
                    };
                    const aSev = severityOrder[String(aValue).toLowerCase()] ?? 99;
                    const bSev = severityOrder[String(bValue).toLowerCase()] ?? 99;
                    return aSev - bSev;
                
                case 'text':
                default:
                    return String(aValue).localeCompare(String(bValue), 'fr', { sensitivity: 'base' });
            }
        });
        
        return sortConfig.direction === 'desc' ? sorted.reverse() : sorted;
    }, [logs, sortConfig]);
    
    // Filter out empty rows (rows where all column values are empty/null/undefined)
    // Use visibleColumns instead of columns to ensure we check against the actual displayed columns
    const nonEmptyLogs = useMemo(() => {
        return sortedLogs.filter(log => {
            // Check if at least one visible column has a non-empty value
            // Also ensure message column always passes (even if empty) to avoid filtering out valid logs
            return visibleColumns.some(col => {
                const value = log[col];
                // Message column should always be considered valid (even if empty, it's still a log entry)
                if (col.toLowerCase() === 'message') {
                    return true;
                }
                return value !== null && value !== undefined && value !== '' && 
                       !(typeof value === 'string' && value.trim() === '');
            });
        });
    }, [sortedLogs, visibleColumns]);
    
    // Pagination: calculate paginated logs
    const totalPages = Math.max(1, Math.ceil(nonEmptyLogs.length / pageSize));
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedLogs = nonEmptyLogs.slice(startIndex, endIndex);
    
    // Statistics (using non-empty logs for valid count)
    const stats = useMemo(() => {
        const total = logs.length;
        const valid = nonEmptyLogs.length;
        const filtered = filteredCount;
        const unreadable = logs.filter(l => l.isParsed === false).length;
        return { total, valid, filtered, unreadable };
    }, [logs, nonEmptyLogs, filteredCount]);
    
    // Format cell value based on column type and plugin
    const formatCellValue = (log: LogEntry, column: string): React.ReactNode => {
        const value = log[column];
        const columnType = getColumnType(column);
        
        // Special formatting for message column based on logType
        if (column.toLowerCase() === 'message' && logType) {
            const messageValue = String(value || '');
            
            // Detect cron.log by filename or logType
            const isCronLog = logType === 'cron' || 
                             (selectedFilePath && (selectedFilePath.includes('cron') || selectedFilePath.includes('CRON')));
            
            // Cron.log format: (root) CMD (/home/www-adm1n/StatRRD32_new/statRRD32.sh graph >/dev/null 2>&1)
            if (isCronLog || (logType === 'syslog' && messageValue.match(/^\((\w+)\)\s+(\w+)\s+/))) {
                const cronMatch = messageValue.match(/^\((\w+)\)\s+(\w+)\s+(.+)$/);
                if (cronMatch) {
                    const [, user, cmdType, command] = cronMatch;
                    return (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Tooltip content={`Utilisateur : ${user}`}>
                                <span 
                                    className="px-2 py-1 rounded text-xs font-medium cursor-help"
                                    style={getUserBadgeStyle(user)}
                                >
                                    {user}
                                </span>
                            </Tooltip>
                            <Tooltip content={`Type de commande : ${cmdType}`}>
                                <span className="px-2 py-1 rounded text-xs bg-cyan-500/20 text-cyan-300 font-medium cursor-help">
                                    {cmdType}
                                </span>
                            </Tooltip>
                            <span className="text-gray-300 text-sm">{command}</span>
                        </div>
                    );
                }
            }
            
            // Auth.log format: pam_unix(cron:session): session opened for user root(uid=0) by (uid=0)
            if (logType === 'auth') {
                // Try to extract service type from pam_unix(service:type) pattern
                const pamMatch = messageValue.match(/^pam_unix\(([^)]+)\):\s*(.+)$/);
                if (pamMatch) {
                    const [, serviceType, restOfMessage] = pamMatch;
                    // Extract user from various patterns: "for user root", "user root", "root(uid="
                    const userMatch = restOfMessage.match(/(?:for\s+user|user)\s+(\w+)/) || 
                                    restOfMessage.match(/(\w+)\(uid=/);
                    const extractedUser = userMatch?.[1];
                    
                    return (
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Tooltip content={`Type de service : ${serviceType}`}>
                                <span className="px-2 py-1 rounded text-xs bg-orange-500/20 text-orange-300 font-medium cursor-help">
                                    {serviceType}
                                </span>
                            </Tooltip>
                            {extractedUser && (
                                <Tooltip content={`Utilisateur : ${extractedUser}`}>
                                    <span 
                                        className="px-2 py-1 rounded text-xs font-medium cursor-help"
                                        style={getUserBadgeStyle(extractedUser)}
                                    >
                                        {extractedUser}
                                    </span>
                                </Tooltip>
                            )}
                            <span className="text-gray-300 text-sm whitespace-normal break-words">{messageValue}</span>
                        </div>
                    );
                }
            }
        }
        
        // Debug: log timestamp and hostname columns
        if (column === 'timestamp' || column === 'hostname') {
            console.log(`[LogTable] formatCellValue: column=${column}, type=${columnType}, value=`, value, 'typeof=', typeof value);
        }
        
        if (value === null || value === undefined || value === '') {
            return <span className="text-gray-600 italic">-</span>;
        }
        
        switch (columnType) {
            case 'date':
                // Date with color based on time of day
                let date: Date | null = null;
                if (value instanceof Date) {
                    date = value;
                } else if (typeof value === 'string') {
                    try {
                        // Try parsing ISO string or other formats
                        date = new Date(value);
                        if (isNaN(date.getTime())) {
                            // Try parsing as timestamp number
                            const numValue = Number(value);
                            if (!isNaN(numValue) && numValue > 0) {
                                date = new Date(numValue);
                            }
                        }
                        if (!date || isNaN(date.getTime())) {
                            console.warn(`[LogTable] Failed to parse date for column ${column}:`, value);
                            return <span className="text-gray-300">{String(value)}</span>;
                        }
                    } catch (err) {
                        console.warn(`[LogTable] Error parsing date for column ${column}:`, err, value);
                        return <span className="text-gray-300">{String(value)}</span>;
                    }
                } else if (typeof value === 'number' && value > 0) {
                    // Unix timestamp in milliseconds or seconds
                    date = new Date(value > 1000000000000 ? value : value * 1000);
                    if (isNaN(date.getTime())) {
                        return <span className="text-gray-300">{String(value)}</span>;
                    }
                } else {
                    console.warn(`[LogTable] Unexpected date value type for column ${column}:`, typeof value, value);
                    return <span className="text-gray-300">{String(value)}</span>;
                }
                
                if (!date) {
                    return <span className="text-gray-300">{String(value)}</span>;
                }
                
                const timestampStyle = getTimestampStyle(date);
                const formattedDate = date.toLocaleString('fr-FR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                return (
                    <Tooltip content={`Horodatage : ${formattedDate}`}>
                        <span 
                            className="font-mono text-xs px-2 py-1 rounded cursor-help"
                            style={timestampStyle}
                        >
                            {formattedDate}
                        </span>
                    </Tooltip>
                );
            
            case 'ip':
                // IP with unified badge color
                const ipValue = String(value);
                const ipStyle = getIPBadgeStyle(ipValue);
                return (
                    <Tooltip content={`Adresse IP : ${ipValue}`}>
                        <span 
                            className="font-mono text-xs px-2 py-1 rounded cursor-help"
                            style={ipStyle}
                        >
                            {ipValue}
                        </span>
                    </Tooltip>
                );
            
            case 'number':
                if (column === 'status' || column === 'statusCode' || column === 'httpCode') {
                    const statusCode = Number(value);
                    const statusDesc = statusCode >= 200 && statusCode < 300 ? 'Succès' :
                                     statusCode >= 300 && statusCode < 400 ? 'Redirection' :
                                     statusCode >= 400 && statusCode < 500 ? 'Erreur client' :
                                     statusCode >= 500 ? 'Erreur serveur' : 'Code HTTP';
                    return (
                        <Tooltip content={`Code HTTP ${statusCode} : ${statusDesc}`}>
                            <span className="cursor-help">
                                <LogBadge type="httpCode" value={statusCode} />
                            </span>
                        </Tooltip>
                    );
                }
                if (column === 'size') {
                    const sizeBytes = Number(value);
                    const sizeFormatted = formatFileSize(sizeBytes);
                    return (
                        <Tooltip content={`Taille : ${sizeFormatted} (${sizeBytes.toLocaleString('fr-FR')} octets)`}>
                            <span className="text-gray-300 cursor-help">{sizeFormatted}</span>
                        </Tooltip>
                    );
                }
                if (column === 'responseTime' || column === 'time' || column === 'duration') {
                    const rt = Number(value);
                    const rtDesc = rt < 100 ? 'Temps de réponse excellent' :
                                 rt < 500 ? 'Temps de réponse acceptable' :
                                 'Temps de réponse élevé';
                    return (
                        <Tooltip content={`Temps de réponse : ${rt}ms - ${rtDesc}`}>
                            <span className="cursor-help">
                                <LogBadge type="responseTime" value={rt} />
                            </span>
                        </Tooltip>
                    );
                }
                return <span className="text-gray-300">{Number(value).toLocaleString('fr-FR')}</span>;
            
            case 'badge':
                if (column === 'level' || column === 'severity') {
                    const level = String(value).toLowerCase();
                    const levelDesc = level === 'error' || level === 'err' ? 'Erreur' :
                                    level === 'warn' || level === 'warning' ? 'Avertissement' :
                                    level === 'info' ? 'Information' :
                                    level === 'debug' ? 'Debug' : 'Niveau de log';
                    return (
                        <Tooltip content={`Niveau de log : ${levelDesc} (${value})`}>
                            <span className="cursor-help">
                                <LogBadge type="level" value={String(value)} />
                            </span>
                        </Tooltip>
                    );
                }
                if (column === 'method' || column === 'httpMethod') {
                    const method = String(value).toUpperCase();
                    const methodDesc = method === 'GET' ? 'Récupération de ressource' :
                                     method === 'POST' ? 'Création de ressource' :
                                     method === 'PUT' ? 'Mise à jour complète' :
                                     method === 'PATCH' ? 'Mise à jour partielle' :
                                     method === 'DELETE' ? 'Suppression de ressource' : 'Méthode HTTP';
                    return (
                        <Tooltip content={`Méthode HTTP : ${method} - ${methodDesc}`}>
                            <span className="cursor-help">
                                <LogBadge type="httpMethod" value={method} />
                            </span>
                        </Tooltip>
                    );
                }
                if (column === 'action') {
                    // Action badge (accepted, failed, etc.)
                    const action = String(value).toLowerCase();
                    const actionColors: Record<string, string> = {
                        'accepted': 'bg-green-500/20 text-green-300',
                        'failed': 'bg-red-500/20 text-red-300',
                        'denied': 'bg-red-500/20 text-red-300',
                        'success': 'bg-green-500/20 text-green-300'
                    };
                    const colorClass = actionColors[action] || 'bg-gray-500/20 text-gray-300';
                    return (
                        <span className={`px-2 py-1 rounded text-xs ${colorClass}`}>
                            {String(value)}
                        </span>
                    );
                }
                return <span className="text-gray-300">{String(value)}</span>;
            
            case 'text':
            default:
                // Hostname/vhost with unified badge color
                if (['hostname', 'host', 'vhost'].includes(column.toLowerCase())) {
                    const hostnameValue = String(value || '');
                    // Only show badge if hostname is not empty
                    if (hostnameValue && hostnameValue.trim() !== '' && hostnameValue !== 'undefined' && hostnameValue !== 'null') {
                        const hostnameStyle = getHostnameBadgeStyle(hostnameValue);
                        const columnLabel = column.toLowerCase() === 'vhost' ? 'Virtual Host' : 'Hostname';
                        return (
                            <Tooltip content={`${columnLabel} : ${hostnameValue}`}>
                                <span 
                                    className="px-2 py-1 rounded text-xs cursor-help"
                                    style={hostnameStyle}
                                >
                                    {hostnameValue}
                                </span>
                            </Tooltip>
                        );
                    }
                    // Return empty dash if no hostname
                    return <span className="text-gray-600 italic">-</span>;
                }
                
                // Service badge: separate service name from PID
                if (column.toLowerCase() === 'service') {
                    const serviceValue = String(value || '');
                    if (serviceValue && serviceValue.trim() !== '' && serviceValue !== 'undefined' && serviceValue !== 'null') {
                        // Parse service format: "dhclient[1022]" or "systemd" or "postfix/smtpd[1234]"
                        const serviceMatch = serviceValue.match(/^([^\[]+)(?:\[(\d+)\])?$/);
                        if (serviceMatch) {
                            const [, serviceName, pid] = serviceMatch;
                            return (
                                <Tooltip content={`Service : ${serviceName}${pid ? ` (PID: ${pid})` : ''}`}>
                                    <span className="inline-flex items-center gap-1.5 cursor-help">
                                        <span className="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-300 font-medium">
                                            {serviceName.trim()}
                                        </span>
                                        {pid && (
                                            <span className="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-400 font-mono">
                                                [{pid}]
                                            </span>
                                        )}
                                    </span>
                                </Tooltip>
                            );
                        }
                        // Fallback if format doesn't match
                        return (
                            <Tooltip content={`Service : ${serviceValue}`}>
                                <span className="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-300 cursor-help">
                                    {serviceValue}
                                </span>
                            </Tooltip>
                        );
                    }
                    return <span className="text-gray-600 italic">-</span>;
                }
                
                // Tag badge: separate tag name from PID
                if (column.toLowerCase() === 'tag') {
                    const tagValue = String(value || '');
                    if (tagValue && tagValue.trim() !== '' && tagValue !== 'undefined' && tagValue !== 'null') {
                        // Parse tag format: "avahi-daemon[1137]info" or "systemd" or "dhclient[1022]"
                        // Tag can have format: "name[pid]level" or "name[pid]" or "name"
                        const tagMatch = tagValue.match(/^([^\[]+)(?:\[(\d+)\])?(.*)$/);
                        if (tagMatch) {
                            const [, tagName, pid, level] = tagMatch;
                            const cleanTagName = tagName.trim();
                            const cleanLevel = level.trim();
                            
                            return (
                                <Tooltip content={`Tag : ${cleanTagName}${pid ? ` (PID: ${pid})` : ''}${cleanLevel ? ` - Niveau: ${cleanLevel}` : ''}`}>
                                    <span className="inline-flex items-center gap-1.5 cursor-help">
                                        <span className="px-2 py-1 rounded text-xs bg-purple-500/20 text-purple-300 font-medium">
                                            {cleanTagName}
                                        </span>
                                        {pid && (
                                            <span className="px-1.5 py-0.5 rounded text-xs bg-gray-700 text-gray-400 font-mono">
                                                [{pid}]
                                            </span>
                                        )}
                                        {cleanLevel && (
                                            <span className="px-1.5 py-0.5 rounded text-xs bg-gray-600/50 text-gray-300 text-xs">
                                                {cleanLevel}
                                            </span>
                                        )}
                                    </span>
                                </Tooltip>
                            );
                        }
                        // Fallback if format doesn't match
                        return (
                            <Tooltip content={`Tag : ${tagValue}`}>
                                <span className="px-2 py-1 rounded text-xs bg-purple-500/20 text-purple-300 cursor-help">
                                    {tagValue}
                                </span>
                            </Tooltip>
                        );
                    }
                    return <span className="text-gray-600 italic">-</span>;
                }
                
                // User column with unified badge color
                if (column.toLowerCase() === 'user') {
                    const userValue = String(value || '');
                    if (userValue && userValue.trim() !== '' && userValue !== 'undefined' && userValue !== 'null') {
                        const userStyle = getUserBadgeStyle(userValue);
                        return (
                            <Tooltip content={`Utilisateur : ${userValue}`}>
                                <span 
                                    className="px-2 py-1 rounded text-xs cursor-help"
                                    style={userStyle}
                                >
                                    {userValue}
                                </span>
                            </Tooltip>
                        );
                    }
                    return <span className="text-gray-600 italic">-</span>;
                }
                
                // Truncate long columns with tooltip
                if (['referer', 'useragent', 'user-agent'].includes(column.toLowerCase())) {
                    const str = String(value);
                    const truncated = str.length > 50 ? str.substring(0, 50) + '...' : str;
                    const columnLabel = column.toLowerCase() === 'referer' ? 'Referer' : 'User-Agent';
                    return (
                        <Tooltip content={`${columnLabel} : ${str}`}>
                            <span className="text-gray-300 cursor-help">
                                {truncated}
                            </span>
                        </Tooltip>
                    );
                }
                
                if (column === 'url' || column === 'urlPath') {
                    const str = String(value);
                    const truncated = str.length > 80 ? str.substring(0, 80) + '...' : str;
                    return (
                        <Tooltip content={`URL complète : ${str}`}>
                            <span className="text-gray-300 cursor-help">
                                {truncated}
                            </span>
                        </Tooltip>
                    );
                }
                
                // Default text
                return <span className="text-gray-200">{String(value)}</span>;
        }
    };
    
    if (isLoading) {
        return (
            <div className={`flex items-center justify-center p-12 ${className}`}>
                <div className="flex flex-col items-center gap-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
                    <div className="text-gray-400">Chargement des logs...</div>
                </div>
            </div>
        );
    }
    
    if (logs.length === 0) {
        return (
            <div className={`flex items-center justify-center p-12 ${className}`}>
                <div className="text-center">
                    <div className="text-gray-500 text-lg mb-2">Aucun log disponible</div>
                    <div className="text-gray-600 text-sm">Les logs correspondant aux filtres sélectionnés seront affichés ici</div>
                </div>
            </div>
        );
    }
    
    return (
        <div className={`overflow-x-auto ${className}`}>
            {/* Statistics bar with filters - All on same line */}
            <div className="bg-[#0a0a0a] border-b border-gray-800 px-4 py-3">
                <div className="flex flex-wrap items-center gap-4 text-xs">
                    {/* File Name with Plugin Icon and Compression Icon */}
                    {selectedFilePath && (
                        <div className="flex items-center gap-2">
                            {/* Plugin Icon */}
                            {pluginId && (
                                <Tooltip content={`Plugin : ${getPluginName(pluginId)}`}>
                                    <img 
                                        src={getPluginIcon(pluginId)} 
                                        alt={pluginId}
                                        className="w-4 h-4 flex-shrink-0 cursor-help"
                                    />
                                </Tooltip>
                            )}
                            <Tooltip content="Fichier de log">
                                <FileText size={14} className="text-cyan-400 flex-shrink-0 cursor-help" />
                            </Tooltip>
                            <Tooltip content={selectedFilePath}>
                                <span className="text-cyan-400 font-medium truncate max-w-[300px] cursor-help">
                                    {selectedFilePath.split('/').pop() || selectedFilePath}
                                </span>
                            </Tooltip>
                            {/* Compression Icon */}
                            {selectedFilePath.toLowerCase().endsWith('.gz') && (
                                <Tooltip content="Fichier compressé (.gz) - Format gzip">
                                    <Archive size={14} className="text-red-400 flex-shrink-0 cursor-help" />
                                </Tooltip>
                            )}
                        </div>
                    )}
                    
                    {/* Statistics */}
                    <div className="flex items-center gap-3 flex-wrap">
                        {fileSize !== undefined && fileSize > 0 && (
                            <Tooltip content="Taille du fichier de log">
                                <span className="bg-purple-500/20 text-purple-300 px-2 py-1 rounded border border-purple-500/30 cursor-help">
                                    {formatFileSize(fileSize)}
                                </span>
                            </Tooltip>
                        )}
                        <Tooltip content="Nombre total de lignes dans le fichier (y compris les lignes vides)">
                            <span className="bg-blue-500/20 text-blue-300 px-2 py-1 rounded border border-blue-500/30 cursor-help">
                                {stats.total.toLocaleString('fr-FR')} lignes totales
                            </span>
                        </Tooltip>
                        <Tooltip content="Nombre de lignes valides et parsées (lignes vides exclues)">
                            <span className="bg-green-500/20 text-green-300 px-2 py-1 rounded border border-green-500/30 cursor-help">
                                {stats.valid.toLocaleString('fr-FR')} lignes valides
                            </span>
                        </Tooltip>
                        {stats.filtered > 0 && (
                            <Tooltip content="Nombre de lignes filtrées par les critères de recherche">
                                <span className="bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded border border-yellow-500/30 cursor-help">
                                    {stats.filtered.toLocaleString('fr-FR')} lignes filtrées
                                </span>
                            </Tooltip>
                        )}
                        {stats.unreadable > 0 && (
                            <Tooltip content="Nombre de lignes qui n'ont pas pu être parsées">
                                <span className="bg-red-500/20 text-red-300 px-2 py-1 rounded border border-red-500/30 cursor-help">
                                    {stats.unreadable.toLocaleString('fr-FR')} lignes illisibles
                                </span>
                            </Tooltip>
                        )}
                    </div>
                    
                    {/* Filters - Search + Date - Only show if filters props are provided */}
                    {filters && onFiltersChange && (
                        <div className="flex-1 min-w-[300px]">
                            <LogFilters
                                filters={filters}
                                onFiltersChange={onFiltersChange}
                                logType={logType}
                                className="compact"
                                logDateRange={logDateRange}
                                pluginId={pluginId}
                                logs={logs}
                            />
                        </div>
                    )}
                </div>
            </div>
            
            {/* Pagination - Top */}
            <div className="px-4 py-3 bg-[#0a0a0a] border-b border-gray-800 flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <select
                        value={pageSize}
                        onChange={(e) => {
                            const newSize = parseInt(e.target.value, 10);
                            if (onPageSizeChange) {
                                onPageSizeChange(newSize);
                            }
                        }}
                        className="px-2 py-1 bg-[#121212] border border-gray-700 rounded text-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                    >
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={250}>250</option>
                        <option value={500}>500</option>
                        <option value={1000}>1000</option>
                    </select>
                    <span>lignes par page / {nonEmptyLogs.length.toLocaleString('fr-FR')} lignes au total</span>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                        Page {currentPage} sur {totalPages}
                    </span>
                    
                    <div className="flex items-center gap-1">
                        <Tooltip content="Première page">
                            <button
                                onClick={() => onPageChange && onPageChange(1)}
                                disabled={currentPage === 1}
                                className="p-1.5 rounded border border-gray-700 bg-[#121212] text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-help"
                            >
                                <ChevronsLeft size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip content="Page précédente">
                            <button
                                onClick={() => onPageChange && onPageChange(currentPage - 1)}
                                disabled={currentPage === 1}
                                className="p-1.5 rounded border border-gray-700 bg-[#121212] text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-help"
                            >
                                <ChevronLeft size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip content="Page suivante">
                            <button
                                onClick={() => onPageChange && onPageChange(currentPage + 1)}
                                disabled={currentPage >= totalPages}
                                className="p-1.5 rounded border border-gray-700 bg-[#121212] text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-help"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip content="Dernière page">
                            <button
                                onClick={() => onPageChange && onPageChange(totalPages)}
                                disabled={currentPage >= totalPages}
                                className="p-1.5 rounded border border-gray-700 bg-[#121212] text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-help"
                            >
                                <ChevronsRight size={16} />
                            </button>
                        </Tooltip>
                    </div>
                </div>
            </div>
            
            <table className="w-full border-collapse table-fixed">
                <colgroup>
                    {orderedColumns.map((col) => {
                        const colLower = col.toLowerCase();
                        let width: string;
                        
                        // Timestamp columns: wider width for full date/time display (format: "02/01/2026 14:52:58" = ~19 chars)
                        if (['timestamp', 'date', 'time'].includes(colLower)) {
                            width = '220px';
                        }
                        // Tag column: wider width to prevent overflow
                        else if (colLower === 'tag') {
                            width = '200px';
                        }
                        // Hostname column: wider width
                        else if (colLower === 'hostname' || colLower === 'host') {
                            width = '180px';
                        }
                        // Service column: wider width for service name and PID
                        else if (colLower === 'service') {
                            width = '200px';
                        }
                        // Level/Severity: small badge width
                        else if (['level', 'severity'].includes(colLower)) {
                            width = '100px';
                        }
                        // Module: medium width
                        else if (colLower === 'module') {
                            width = '140px';
                        }
                        // IP columns: fixed width for IP addresses
                        else if (['ip', 'ipaddress', 'clientip', 'remoteip'].includes(colLower)) {
                            width = '140px';
                        }
                        // Numeric columns: small fixed width
                        else if (['status', 'statuscode', 'httpcode', 'size', 'responsetime', 'pid', 'tid', 'port'].includes(colLower)) {
                            width = '90px';
                        }
                        // Method: small width
                        else if (colLower === 'method') {
                            width = '80px';
                        }
                        // Protocol: small width
                        else if (colLower === 'protocol') {
                            width = '90px';
                        }
                        // VHost: medium width
                        else if (colLower === 'vhost') {
                            width = '180px';
                        }
                        // URL, referer, userAgent: medium width
                        else if (['url', 'urlpath', 'referer', 'useragent', 'user-agent'].includes(colLower)) {
                            width = '200px';
                        }
                        // Message: takes remaining space (no fixed width)
                        else if (colLower === 'message') {
                            width = 'auto';
                        }
                        // Default: medium width
                        else {
                            width = '120px';
                        }
                        
                        return <col key={col} style={{ width }} />;
                    })}
                </colgroup>
                <thead>
                    <tr className="bg-[#0a0a0a] border-b border-gray-800">
                        {orderedColumns.map((col) => (
                            <SortableHeader
                                key={col}
                                column={col}
                                sortConfig={sortConfig}
                                onSort={handleSort}
                            />
                        ))}
                    </tr>
                </thead>
                <tbody className="bg-[#121212] divide-y divide-gray-800">
                    {paginatedLogs.map((log, index) => {
                        const isUnparsed = log.isParsed === false;
                        return (
                            <tr
                                key={index}
                                className={`transition-colors ${
                                    isUnparsed 
                                        ? 'bg-red-500/5 hover:bg-red-500/10 opacity-70' 
                                        : 'hover:bg-[#1a1a1a]'
                                }`}
                            >
                                {orderedColumns.map((col) => (
                                    <td
                                        key={col}
                                        className={`px-4 py-3 text-sm border-r border-gray-800 last:border-r-0 ${
                                            isUnparsed 
                                                ? 'text-gray-500 italic' 
                                                : ''
                                        } ${
                                            col === 'message' || col === 'url' || col === 'urlPath' || col === 'referer' || col === 'userAgent' || col === 'user-agent' || col === 'tag'
                                                ? 'whitespace-normal break-words'
                                                : col === 'timestamp' || col === 'date' || col === 'time'
                                                ? 'whitespace-nowrap'
                                                : 'whitespace-nowrap'
                                        }`}
                                    >
                                        {col === 'message' && isUnparsed ? (
                                            <span className="flex items-center gap-2">
                                                <span className="text-xs text-red-500/70">⚠</span>
                                                {formatCellValue(log, col)}
                                            </span>
                                        ) : (
                                            formatCellValue(log, col)
                                        )}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {/* Pagination */}
            <div className="px-4 py-3 bg-[#0a0a0a] border-t border-gray-800 flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>Affichage de</span>
                    <select
                        value={pageSize}
                        onChange={(e) => {
                            const newSize = parseInt(e.target.value, 10);
                            if (onPageSizeChange) {
                                onPageSizeChange(newSize);
                            }
                        }}
                        className="px-2 py-1 bg-[#121212] border border-gray-700 rounded text-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                    >
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={250}>250</option>
                        <option value={500}>500</option>
                        <option value={1000}>1000</option>
                    </select>
                    <span>lignes par page</span>
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                        Page {currentPage} sur {totalPages}
                        {' '}({nonEmptyLogs.length} ligne{nonEmptyLogs.length > 1 ? 's' : ''} au total)
                    </span>
                    
                    <div className="flex items-center gap-1">
                        <Tooltip content="Première page">
                            <button
                                onClick={() => onPageChange && onPageChange(1)}
                                disabled={currentPage === 1}
                                className="p-1.5 rounded border border-gray-700 bg-[#121212] text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-help"
                            >
                                <ChevronsLeft size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip content="Page précédente">
                            <button
                                onClick={() => onPageChange && onPageChange(currentPage - 1)}
                                disabled={currentPage === 1}
                                className="p-1.5 rounded border border-gray-700 bg-[#121212] text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-help"
                            >
                                <ChevronLeft size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip content="Page suivante">
                            <button
                                onClick={() => onPageChange && onPageChange(currentPage + 1)}
                                disabled={currentPage >= totalPages}
                                className="p-1.5 rounded border border-gray-700 bg-[#121212] text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-help"
                            >
                                <ChevronRight size={16} />
                            </button>
                        </Tooltip>
                        <Tooltip content="Dernière page">
                            <button
                                onClick={() => onPageChange && onPageChange(totalPages)}
                                disabled={currentPage >= totalPages}
                                className="p-1.5 rounded border border-gray-700 bg-[#121212] text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-help"
                            >
                                <ChevronsRight size={16} />
                            </button>
                        </Tooltip>
                    </div>
                </div>
            </div>
        </div>
    );
};
