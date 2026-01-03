/**
 * Log File Selector Component
 * 
 * Improved file selector with grouping by category and base name
 * Groups rotated files (auth.log, auth.log.1, auth.log.2.gz) under a single entry
 */

import { useMemo, useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Eye, EyeOff, Lock, Menu, X, Archive } from 'lucide-react';
import type { LogFileInfo } from '../../types/logViewer.js';
import { Tooltip } from '../ui/Tooltip.js';
import { usePluginStore } from '../../stores/pluginStore.js';

interface GroupedFile {
    baseName: string;
    category: string;
    files: LogFileInfo[];
    isRotated: boolean;
}

interface LogFileSelectorProps {
    files: LogFileInfo[];
    selectedFilePath?: string;
    onFileSelect: (filePath: string, logType: string) => void;
    className?: string;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    pluginId?: string; // Plugin ID to detect subdomain patterns
    readCompressed?: boolean; // Whether compressed files should be displayed
}

// Map log types to display names
const TYPE_LABELS: Record<string, string> = {
    'syslog': 'Syslog',
    'auth': 'Authentification',
    'kern': 'Kernel',
    'daemon': 'Démon',
    'mail': 'Mail',
    'access': 'Accès',
    'error': 'Erreur',
    'custom': 'Autre',
    'journald': 'Journald',
    'subdomain': 'Sous-domaines'
};

// Types that have parsers (known and functional)
const PARSED_TYPES = ['syslog', 'journald', 'auth', 'kern', 'daemon', 'mail', 'access', 'error'];

// Category order for display - parsed types first, then others
// For HTTP plugins (apache, nginx, npm), prioritize access and error
const CATEGORY_ORDER = ['auth', 'syslog', 'daemon', 'kern', 'mail', 'journald', 'access', 'error', 'custom'];

/**
 * Detect if a file is a subdomain file based on plugin and filename pattern
 */
function isSubdomainFile(filePath: string, pluginId?: string): boolean {
    const filename = filePath.split('/').pop() || '';
    
    if (pluginId === 'npm') {
        // NPM pattern: proxy-host-xxx_access.log or proxy-host-xxx_error.log (where xxx is the subdomain)
        // Standard files: proxy-host_access.log, proxy-host_error.log (without xxx)
        const npmSubdomainAccessPattern = /^proxy-host-[^_]+_access\.log/;
        const npmSubdomainErrorPattern = /^proxy-host-[^_]+_error\.log/;
        return npmSubdomainAccessPattern.test(filename) || npmSubdomainErrorPattern.test(filename);
    } else if (pluginId === 'apache') {
        // Apache pattern: access.monsoudomaine.myoueb.fr.log or error.monsoudomaine.myoueb.fr.log
        // Also handles: access.monsoudomaine.myoueb.fr (without .log), access.monsoudomaine.myoueb.fr.log.1, etc.
        // Standard files: access.log, access_ssl.log, error.log, etc. (no dots in the middle or underscore after access/error)
        // Pattern: access. or error. followed by at least one dot before .log or end of filename
        // Example: access.example.com.log, access.example.com, error.subdomain.example.com.log.1
        // Not: access.log, access_ssl.log, error.log, error_ssl.log
        
        // Remove rotation numbers and compression extensions for pattern matching
        let baseFilename = filename
            .replace(/\.log\.\d+(\.gz|\.bz2|\.xz)?$/, '') // Remove .log.1, .log.2.gz, etc.
            .replace(/\.\d+(\.gz|\.bz2|\.xz)?$/, '') // Remove .1, .2.gz, etc.
            .replace(/\.(gz|bz2|xz)$/, ''); // Remove remaining compression extensions
        
        // Also remove .log extension if present (for files like access.example.com.log)
        if (baseFilename.endsWith('.log')) {
            baseFilename = baseFilename.slice(0, -4); // Remove .log
        }
        
        // Check if it starts with access. or error.
        if (baseFilename.startsWith('access.')) {
            // Extract the part after "access."
            const afterAccess = baseFilename.substring(7); // "access." is 7 chars
            // Must have at least one dot in the remaining part (indicating subdomain.domain format)
            // And must not be empty (which would be "access.log" after removing .log)
            if (afterAccess && afterAccess.includes('.')) {
                return true;
            }
        }
        
        if (baseFilename.startsWith('error.')) {
            // Extract the part after "error."
            const afterError = baseFilename.substring(6); // "error." is 6 chars
            // Must have at least one dot in the remaining part (indicating subdomain.domain format)
            // And must not be empty (which would be "error.log" after removing .log)
            if (afterError && afterError.includes('.')) {
                return true;
            }
        }
        
        return false;
    }
    
    return false;
}

export function LogFileSelector({ 
    files, 
    selectedFilePath, 
    onFileSelect, 
    className = '',
    collapsed = false,
    onToggleCollapse,
    pluginId,
    readCompressed = false
}: LogFileSelectorProps) {
    const { plugins } = usePluginStore();
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set([...CATEGORY_ORDER.filter(cat => PARSED_TYPES.includes(cat)), 'subdomain', 'unparsed']));
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [showUnreadable, setShowUnreadable] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    
    // Get configured files for host-system plugin
    const configuredFiles = useMemo(() => {
        if (pluginId === 'host-system') {
            const plugin = plugins.find(p => p.id === 'host-system');
            if (plugin?.settings?.logFiles && Array.isArray(plugin.settings.logFiles)) {
                return new Set((plugin.settings.logFiles as Array<{ path: string; type: string; enabled: boolean }>)
                    .map(f => f.path));
            }
        }
        return null;
    }, [pluginId, plugins]);

    // Helper function to check if a file is compressed (.gz)
    const isCompressedFile = (filePath: string): boolean => {
        return filePath.toLowerCase().endsWith('.gz');
    };

    // Separate readable and unreadable files, and filter out compressed files unless readCompressed is enabled
    const filteredFiles = useMemo(() => {
        return files.filter(f => {
            const filename = f.path.toLowerCase();
            // If readCompressed is enabled, only show .gz files (other formats not supported yet)
            if (readCompressed) {
                // Show all files including .gz, but exclude other compression formats for now
                return !filename.endsWith('.bz2') && 
                       !filename.endsWith('.xz') &&
                       !filename.endsWith('.tar.bz2') &&
                       !filename.endsWith('.tar.xz');
            } else {
                // Skip all compressed files when readCompressed is disabled
                return !filename.endsWith('.gz') && 
                       !filename.endsWith('.bz2') && 
                       !filename.endsWith('.xz') &&
                       !filename.endsWith('.tar.gz') &&
                       !filename.endsWith('.tar.bz2') &&
                       !filename.endsWith('.tar.xz');
            }
        });
    }, [files, readCompressed]);
    
    const readableFiles = useMemo(() => filteredFiles.filter(f => f.readable !== false), [filteredFiles]);
    const unreadableFiles = useMemo(() => filteredFiles.filter(f => f.readable === false), [filteredFiles]);
    const displayFiles = showUnreadable ? filteredFiles : readableFiles;

    // Group files by category and base name
    // Separate parsed types (with parsers) from unparsed types (custom/unknown)
    const { parsedFiles, unparsedFiles } = useMemo(() => {
        const parsed: LogFileInfo[] = [];
        const unparsed: LogFileInfo[] = [];

        displayFiles.forEach(file => {
            const fileType = file.type || 'custom';
            
            // For host-system: only show configured files in parsed categories
            if (pluginId === 'host-system' && configuredFiles) {
                // Check if this file or its base file (without rotation) is configured
                const filePath = file.path;
                const baseFileName = getBaseFileNameForRotation(filePath);
                const directory = filePath.substring(0, filePath.lastIndexOf('/') + 1);
                const basePath = directory + baseFileName;
                
                // Check if the exact file path or the base file path is configured
                const isConfigured = configuredFiles.has(filePath) || configuredFiles.has(basePath);
                
                if (!isConfigured) {
                    // File not configured, put it in unparsed (will appear in "Autres fichiers")
                    unparsed.push(file);
                    return;
                }
            }
            
            // Filter syslog category for host-system: exclude non-system log files
            if (pluginId === 'host-system' && fileType === 'syslog') {
                const filename = file.path.split('/').pop()?.toLowerCase() || '';
                // Exclude common application log files that are not system logs
                const nonSystemPatterns = [
                    /^error\.log$/,
                    /^access\.log$/,
                    /^debug\.log$/,
                    /^info\.log$/,
                    /^warn\.log$/,
                    /^application\.log$/,
                    /^app\.log$/,
                    /^server\.log$/,
                    /^nginx\.log$/,
                    /^apache\.log$/,
                    /^php.*\.log$/,
                    /^mysql.*\.log$/,
                    /^postgres.*\.log$/
                ];
                
                // If it matches a non-system pattern, treat it as custom/unparsed
                if (nonSystemPatterns.some(pattern => pattern.test(filename))) {
                    unparsed.push(file);
                    return;
                }
            }
            
            if (PARSED_TYPES.includes(fileType)) {
                parsed.push(file);
            } else {
                unparsed.push(file);
            }
        });

        return { parsedFiles: parsed, unparsedFiles: unparsed };
    }, [displayFiles, pluginId, configuredFiles]);

    // Group parsed files by category and base name
    const groupedParsedFiles = useMemo(() => {
        const groups = new Map<string, Map<string, LogFileInfo[]>>();

        parsedFiles.forEach(file => {
            // Check if this is a subdomain file
            const isSubdomain = isSubdomainFile(file.path, pluginId);
            const category = isSubdomain ? 'subdomain' : (file.type || 'custom');
            // Use getBaseFileNameForRotation to properly group rotated files
            const baseName = getBaseFileNameForRotation(file.path);
            
            if (!groups.has(category)) {
                groups.set(category, new Map());
            }
            
            const categoryGroups = groups.get(category)!;
            if (!categoryGroups.has(baseName)) {
                categoryGroups.set(baseName, []);
            }
            
            categoryGroups.get(baseName)!.push(file);
        });

        // Convert to array and sort
        const result: GroupedFile[] = [];
        
        // For HTTP plugins (access/error), prioritize these categories
        const hasAccessOrError = parsedFiles.some(f => f.type === 'access' || f.type === 'error');
        const hasSubdomain = parsedFiles.some(f => isSubdomainFile(f.path, pluginId));
        
        // Build category order: access/error first, then others, subdomain last
        let categoryOrder: string[];
        if (hasAccessOrError) {
            categoryOrder = ['access', 'error', ...CATEGORY_ORDER.filter(cat => cat !== 'access' && cat !== 'error' && cat !== 'subdomain' && PARSED_TYPES.includes(cat))];
        } else {
            categoryOrder = CATEGORY_ORDER.filter(cat => cat !== 'subdomain' && PARSED_TYPES.includes(cat));
        }
        
        // Add subdomain at the end if it exists
        if (hasSubdomain) {
            categoryOrder.push('subdomain');
        }
        
        categoryOrder.forEach(category => {
            const categoryGroups = groups.get(category);
            if (!categoryGroups || categoryGroups.size === 0) return;

            categoryGroups.forEach((fileList, baseName) => {
                // Sort files: current file first, then rotated files by number
                const sortedFiles = fileList.sort((a, b) => {
                    const aRotated = isRotatedFile(a.path);
                    const bRotated = isRotatedFile(b.path);
                    
                    // Current file (not rotated) comes first
                    if (!aRotated && bRotated) return -1;
                    if (aRotated && !bRotated) return 1;
                    
                    // Both rotated: sort by rotation number
                    if (aRotated && bRotated) {
                        const aNum = getRotationNumber(a.path);
                        const bNum = getRotationNumber(b.path);
                        return aNum - bNum;
                    }
                    
                    return 0;
                });

                result.push({
                    baseName,
                    category,
                    files: sortedFiles,
                    isRotated: sortedFiles.length > 1 || isRotatedFile(sortedFiles[0].path)
                });
            });
        });

        return result;
    }, [parsedFiles, pluginId]);

    // Group unparsed files by base name (grouping rotated files together)
    const groupedUnparsedFiles = useMemo(() => {
        const groups = new Map<string, LogFileInfo[]>();

        unparsedFiles.forEach(file => {
            // Group by base name (without rotation numbers) to group rotated files together
            const baseName = getBaseFileNameForRotation(file.path);
            const groupKey = `other-${baseName}`;
            
            if (!groups.has(groupKey)) {
                groups.set(groupKey, []);
            }
            
            groups.get(groupKey)!.push(file);
        });

        // Convert to array format
        const result: Array<{ groupName: string; files: LogFileInfo[] }> = [];
        groups.forEach((fileList, groupKey) => {
            // Sort files: current file first, then rotated files by number
            const sorted = fileList.sort((a, b) => {
                const aRotated = isRotatedFile(a.path);
                const bRotated = isRotatedFile(b.path);
                
                // Current file (not rotated) comes first
                if (!aRotated && bRotated) return -1;
                if (aRotated && !bRotated) return 1;
                
                // Both rotated: sort by rotation number
                if (aRotated && bRotated) {
                    const aNum = getRotationNumber(a.path);
                    const bNum = getRotationNumber(b.path);
                    return aNum - bNum;
                }
                
                // Otherwise sort by filename
                return a.path.localeCompare(b.path);
            });
            
            // Extract base name for display
            const baseName = getBaseFileNameForRotation(fileList[0].path);
            result.push({ groupName: baseName, files: sorted });
        });

        // Sort groups by name
        return result.sort((a, b) => a.groupName.localeCompare(b.groupName));
    }, [unparsedFiles]);

    const toggleCategory = (category: string) => {
        const newExpanded = new Set(expandedCategories);
        if (newExpanded.has(category)) {
            newExpanded.delete(category);
        } else {
            newExpanded.add(category);
        }
        setExpandedCategories(newExpanded);
    };

    const toggleGroup = (key: string) => {
        const newExpanded = new Set(expandedGroups);
        if (newExpanded.has(key)) {
            newExpanded.delete(key);
        } else {
            newExpanded.add(key);
        }
        setExpandedGroups(newExpanded);
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    const getFileDisplayName = (filePath: string): string => {
        const filename = filePath.split('/').pop() || filePath;
        if (isRotatedFile(filePath)) {
            const rotationNum = getRotationNumber(filePath);
            const isCompressed = filePath.endsWith('.gz');
            return `#${rotationNum}${isCompressed ? ' (compressé)' : ''}`;
        }
        return 'Actuel';
    };

    // Auto-scroll to selected file and expand necessary categories/groups
    useEffect(() => {
        if (!selectedFilePath || !containerRef.current) return;
        
        // Find the selected file in displayFiles
        const selectedFile = displayFiles.find(f => f.path === selectedFilePath);
        if (!selectedFile) return;
        
        // Determine category
        const fileType = selectedFile.type || 'custom';
        let category = 'unparsed';
        if (PARSED_TYPES.includes(fileType)) {
            category = fileType;
        } else if (isSubdomainFile(selectedFile.path, pluginId)) {
            category = 'subdomain';
        }
        
        // Expand category if needed
        if (!expandedCategories.has(category)) {
            setExpandedCategories(prev => new Set([...prev, category]));
        }
        
        // For rotated files, find and expand the group
        if (isRotatedFile(selectedFile.path)) {
            const baseName = getBaseFileNameForRotation(selectedFile.path);
            // For unparsed files, use the base name as group key
            const groupKey = category === 'unparsed' 
                ? `other-${baseName}`
                : `${category}-${baseName}`;
            
            if (!expandedGroups.has(groupKey)) {
                setExpandedGroups(prev => new Set([...prev, groupKey]));
            }
        }
        
        // Scroll to selected file after a delay to allow DOM update
        setTimeout(() => {
            const selectedElement = containerRef.current?.querySelector(`[data-selected-file="${selectedFilePath}"]`);
            if (selectedElement) {
                selectedElement.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center',
                    inline: 'nearest'
                });
            }
        }, 150);
    }, [selectedFilePath, displayFiles, expandedCategories, expandedGroups, pluginId]);

    return (
        <div ref={containerRef} className={`bg-[#121212] border border-gray-800 rounded-xl overflow-hidden transition-all duration-300 ${className} ${collapsed ? 'w-12' : ''}`}>
            {/* Header with collapse button */}
            <div className="p-4 border-b border-gray-800 flex items-center justify-between">
                {!collapsed && (
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-base font-semibold text-white flex items-center gap-2">
                                <FileText size={18} />
                                Fichiers de logs ({readableFiles.length}
                                {unreadableFiles.length > 0 && (
                                    <span className="text-gray-500">/{files.length}</span>
                                )})
                            </h3>
                            {unreadableFiles.length > 0 && (
                                <Tooltip content={showUnreadable ? 'Masquer les fichiers non accessibles' : 'Afficher les fichiers non accessibles'}>
                                    <button
                                        onClick={() => setShowUnreadable(!showUnreadable)}
                                        className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center gap-1 transition-colors cursor-help"
                                    >
                                        {showUnreadable ? (
                                            <>
                                                <EyeOff size={12} />
                                                Masquer
                                            </>
                                        ) : (
                                            <>
                                                <Eye size={12} />
                                                Voir ({unreadableFiles.length})
                                            </>
                                        )}
                                    </button>
                                </Tooltip>
                            )}
                        </div>
                        {unreadableFiles.length > 0 && !showUnreadable && (
                            <Tooltip content="Ces fichiers ne peuvent pas être lus en raison de permissions insuffisantes">
                                <div className="text-xs text-gray-500 flex items-center gap-1 cursor-help">
                                    <Lock size={12} />
                                    {unreadableFiles.length} fichier{unreadableFiles.length > 1 ? 's' : ''} non accessible{unreadableFiles.length > 1 ? 's' : ''} (droits insuffisants)
                                </div>
                            </Tooltip>
                        )}
                    </div>
                )}
                
                {/* Collapse/Expand button */}
                {onToggleCollapse && (
                    <button
                        onClick={onToggleCollapse}
                        className={`p-2 rounded-lg hover:bg-gray-800 transition-colors ${collapsed ? 'w-full' : 'ml-2'}`}
                        title={collapsed ? 'Afficher le menu' : 'Masquer le menu'}
                    >
                        {collapsed ? (
                            <Menu size={18} className="text-gray-400" />
                        ) : (
                            <X size={18} className="text-gray-400" />
                        )}
                    </button>
                )}
            </div>
            
            {/* File list - hidden when collapsed */}
            {!collapsed && (
                <div className="max-h-[600px] overflow-y-auto">
                {groupedParsedFiles.length === 0 && groupedUnparsedFiles.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">
                        Aucun fichier disponible
                    </div>
                ) : (
                    <div className="divide-y divide-gray-800">
                        {/* Parsed Files (with parsers) */}
                        {groupedParsedFiles.length > 0 && (
                            <>
                                {(() => {
                                    // Determine category order based on available files
                                    // Subdomain should be last
                                    const hasSubdomain = groupedParsedFiles.some(g => g.category === 'subdomain');
                                    const hasAccessOrError = groupedParsedFiles.some(g => g.category === 'access' || g.category === 'error');
                                    
                                    let order: string[];
                                    if (hasAccessOrError) {
                                        order = ['access', 'error', ...CATEGORY_ORDER.filter(cat => cat !== 'access' && cat !== 'error' && cat !== 'subdomain' && PARSED_TYPES.includes(cat))];
                                    } else {
                                        order = CATEGORY_ORDER.filter(cat => cat !== 'subdomain' && PARSED_TYPES.includes(cat));
                                    }
                                    
                                    // Add subdomain at the end
                                    if (hasSubdomain) {
                                        order.push('subdomain');
                                    }
                                    
                                    return order;
                                })().map(category => {
                                    const categoryFiles = groupedParsedFiles.filter(g => g.category === category);
                                    if (categoryFiles.length === 0) return null;

                            const isCategoryExpanded = expandedCategories.has(category);
                            const categoryLabel = TYPE_LABELS[category] || category;

                            return (
                                <div key={category} className="bg-[#0a0a0a]">
                                    {/* Category Header */}
                                    <button
                                        onClick={() => toggleCategory(category)}
                                        className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#1a1a1a] transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            {isCategoryExpanded ? (
                                                <ChevronDown size={18} className="text-orange-500" />
                                            ) : (
                                                <ChevronRight size={18} className="text-orange-500" />
                                            )}
                                            <span className="text-base font-medium text-white">
                                                {categoryLabel}
                                            </span>
                                            <span className="text-sm text-gray-500">
                                                ({categoryFiles.length})
                                            </span>
                                        </div>
                                    </button>

                                    {/* Category Files */}
                                    {isCategoryExpanded && (
                                        <div className="bg-[#0f0f0f]">
                                            {categoryFiles.map((group, idx) => {
                                                const groupKey = `${category}-${group.baseName}`;
                                                const isGroupExpanded = expandedGroups.has(groupKey);
                                                const currentFile = group.files.find(f => !isRotatedFile(f.path)) || group.files[0];
                                                const rotatedFiles = group.files.filter(f => isRotatedFile(f.path));

                                                const isSelected = selectedFilePath === currentFile?.path;
                                                
                                                return (
                                                    <div key={idx} className="border-t border-gray-800/50">
                                                        {/* Group Header (always visible) */}
                                                        <div className="px-4 py-2 flex items-center justify-between gap-2">
                                                            <button
                                                                data-selected-file={isSelected ? currentFile?.path : undefined}
                                                                onClick={() => {
                                                                    if (currentFile && currentFile.readable !== false && currentFile.size > 0) {
                                                                        onFileSelect(currentFile.path, currentFile.type);
                                                                    }
                                                                }}
                                                                disabled={currentFile?.readable === false || currentFile?.size === 0}
                                                                className={`flex-1 text-left text-base transition-colors ${
                                                                    currentFile?.readable === false
                                                                        ? 'text-gray-600 cursor-not-allowed opacity-50'
                                                                        : selectedFilePath === currentFile?.path
                                                                        ? isCompressedFile(currentFile?.path || '')
                                                                            ? 'text-orange-200 font-semibold bg-orange-500/30 border-2 border-orange-400 rounded-lg px-2 py-1'
                                                                            : 'text-blue-300 font-semibold bg-blue-500/30 border-2 border-blue-400 rounded-lg px-2 py-1'
                                                                        : isCompressedFile(currentFile?.path || '')
                                                                            ? 'text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 border border-orange-500/20'
                                                                            : isRotatedFile(currentFile?.path || '')
                                                                                ? 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
                                                                                : 'text-gray-300 hover:text-white'
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    {currentFile?.readable === false || currentFile?.size === 0 ? (
                                                                        <Tooltip content="Fichier non accessible (droits insuffisants)">
                                                                            <Lock size={16} className="text-gray-600 cursor-help" />
                                                                        </Tooltip>
                                                                    ) : isCompressedFile(currentFile?.path || '') ? (
                                                                        <Tooltip content="Fichier compressé (.gz)">
                                                                            <Archive size={16} className="text-orange-500 cursor-help" />
                                                                        </Tooltip>
                                                                    ) : (
                                                                        <FileText size={16} />
                                                                    )}
                                                                    <span className={`flex-1 ${currentFile?.size === 0 ? 'text-gray-600' : isCompressedFile(currentFile?.path || '') ? 'text-orange-400' : isRotatedFile(currentFile?.path || '') ? 'text-gray-400' : ''}`}>{group.baseName}</span>
                                                                    {isCompressedFile(currentFile?.path || '') && (
                                                                        <span className="text-xs px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded border border-orange-500/30">
                                                                            .gz
                                                                        </span>
                                                                    )}
                                                                    {currentFile?.readable === false && (
                                                                        <span className="text-xs text-red-500/70">
                                                                            (non accessible)
                                                                        </span>
                                                                    )}
                                                                    {currentFile?.size === 0 && (
                                                                        <span className="text-xs text-gray-600">
                                                                            (vide)
                                                                        </span>
                                                                    )}
                                                                    {group.isRotated && rotatedFiles.length > 0 && (
                                                                        <span className="text-xs text-gray-500">
                                                                            <span className="text-yellow-50">+{rotatedFiles.length}</span> archives
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </button>
                                                            {currentFile?.size !== undefined && (
                                                                <span className="text-sm text-gray-500 whitespace-nowrap">
                                                                    <span className="text-yellow-200">
                                                                        {formatFileSize(currentFile.size)}
                                                                    </span>
                                                                </span>
                                                            )}
                                                            
                                                            {rotatedFiles.length > 0 && (
                                                                <button
                                                                    onClick={() => toggleGroup(groupKey)}
                                                                    className="ml-2 p-1 hover:bg-gray-800 rounded"
                                                                >
                                                                    {isGroupExpanded ? (
                                                                        <ChevronDown size={14} className="text-orange-500" />
                                                                    ) : (
                                                                        <ChevronRight size={14} className="text-orange-500" />
                                                                    )}
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* Rotated Files (expandable) */}
                                                        {rotatedFiles.length > 0 && isGroupExpanded && (
                                                            <div className="pl-8 pr-4 pb-2 space-y-1 bg-[#0a0a0a]">
                                                            {rotatedFiles.map((file, fileIdx) => {
                                                                const isRotatedSelected = selectedFilePath === file.path;
                                                                
                                                                return (
                                                                <button
                                                                    key={fileIdx}
                                                                    data-selected-file={isRotatedSelected ? file.path : undefined}
                                                                        onClick={() => {
                                                                            if (file.readable !== false && file.size > 0) {
                                                                                onFileSelect(file.path, file.type);
                                                                            }
                                                                        }}
                                                                        disabled={file.readable === false || file.size === 0}
                                                                        className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center justify-between ${
                                                                            file.readable === false || file.size === 0
                                                                                ? 'text-gray-600 cursor-not-allowed opacity-50'
                                                                                : selectedFilePath === file.path
                                                                                ? isCompressedFile(file.path)
                                                                                    ? 'bg-orange-500/30 text-orange-200 font-semibold border-2 border-orange-400'
                                                                                    : 'bg-blue-500/30 text-blue-300 font-semibold border-2 border-blue-400'
                                                                                : isCompressedFile(file.path)
                                                                                    ? 'text-orange-400 hover:bg-orange-500/10 hover:text-orange-300 border border-orange-500/20'
                                                                                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'
                                                                        }`}
                                                                    >
                                                                        <span className={`flex items-center gap-1.5 ${file.size === 0 ? 'text-gray-600' : isCompressedFile(file.path) ? 'text-orange-400' : isRotatedFile(file.path) ? 'text-gray-400' : ''}`}>
                                                                            {(file.readable === false || file.size === 0) && (
                                                                                <Tooltip content="Fichier non accessible (droits insuffisants)">
                                                                                    <Lock size={12} className="text-gray-600 cursor-help" />
                                                                                </Tooltip>
                                                                            )}
                                                                            {file.readable !== false && file.size > 0 && isCompressedFile(file.path) && (
                                                                                <Tooltip content="Fichier compressé (.gz)">
                                                                                    <Archive size={12} className="text-orange-500 cursor-help" />
                                                                                </Tooltip>
                                                                            )}
                                                                            {file.path.split('/').pop() || file.path}
                                                                            {isCompressedFile(file.path) && (
                                                                                <span className="text-xs px-1 py-0.5 bg-orange-500/20 text-orange-400 rounded border border-orange-500/30 ml-1">
                                                                                    .gz
                                                                                </span>
                                                                            )}
                                                                            {file.size === 0 && (
                                                                                <span className="text-xs text-gray-600 ml-1">(vide)</span>
                                                                            )}
                                                                        </span>
                                                                        <span className={`${file.readable === false || file.size === 0 ? 'text-gray-700' : 'text-yellow-200'}`}>
                                                                            {formatFileSize(file.size)}
                                                                        </span>
                                                                    </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                            </>
                        )}

                        {/* Unparsed Files (without parsers) */}
                        {groupedUnparsedFiles.length > 0 && (
                            <div className="bg-[#0a0a0a] border-t-2 border-gray-700">
                                {/* Category Header for "Autres" */}
                                <button
                                    onClick={() => toggleCategory('unparsed')}
                                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#1a1a1a] transition-colors"
                                >
                                    <div className="flex items-center gap-2">
                                        {expandedCategories.has('unparsed') ? (
                                            <ChevronDown size={16} className="text-orange-500" />
                                        ) : (
                                            <ChevronRight size={16} className="text-orange-500" />
                                        )}
                                        <span className="text-base font-medium text-white">
                                            Autres fichiers
                                        </span>
                                        <span className="text-sm text-gray-500">
                                            ({groupedUnparsedFiles.length} groupe{groupedUnparsedFiles.length > 1 ? 's' : ''})
                                        </span>
                                    </div>
                                </button>

                                {/* Unparsed Files Groups */}
                                {expandedCategories.has('unparsed') && (
                                    <div className="bg-[#0f0f0f]">
                                        {groupedUnparsedFiles.map((group, idx) => {
                                            const groupKey = `other-${group.groupName}`;
                                            const isGroupExpanded = expandedGroups.has(groupKey);
                                            const currentFile = group.files.find(f => !isRotatedFile(f.path)) || group.files[0];
                                            const rotatedFiles = group.files.filter(f => isRotatedFile(f.path));
                                            const groupLabel = group.groupName.split('/').pop() || group.groupName;

                                            const isSelected = selectedFilePath === currentFile?.path;
                                            
                                            return (
                                                <div key={idx} className="border-t border-gray-800/50">
                                                    {/* Group Header (always visible) */}
                                                    <div className="px-4 py-2 flex items-center justify-between gap-2">
                                                        <button
                                                            data-selected-file={isSelected ? currentFile?.path : undefined}
                                                            onClick={() => {
                                                                if (currentFile && currentFile.readable !== false && currentFile.size > 0) {
                                                                    onFileSelect(currentFile.path, currentFile.type || 'custom');
                                                                }
                                                            }}
                                                            disabled={currentFile?.readable === false || currentFile?.size === 0}
                                                            className={`flex-1 text-left text-base transition-colors ${
                                                                currentFile?.readable === false
                                                                    ? 'text-gray-600 cursor-not-allowed opacity-50'
                                                                    : selectedFilePath === currentFile?.path
                                                                    ? isCompressedFile(currentFile?.path || '')
                                                                        ? 'text-orange-200 font-semibold bg-orange-500/30 border-2 border-orange-400 rounded-lg px-2 py-1'
                                                                        : 'text-blue-300 font-semibold bg-blue-500/30 border-2 border-blue-400 rounded-lg px-2 py-1'
                                                                    : isCompressedFile(currentFile?.path || '')
                                                                        ? 'text-orange-400 hover:text-orange-300 hover:bg-orange-500/10 border border-orange-500/20'
                                                                        : isRotatedFile(currentFile?.path || '')
                                                                            ? 'text-gray-400 hover:text-gray-300 hover:bg-gray-800'
                                                                            : 'text-gray-300 hover:text-white'
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                {currentFile?.readable === false || currentFile?.size === 0 ? (
                                                                    <Tooltip content="Fichier non accessible (droits insuffisants)">
                                                                        <Lock size={16} className="text-gray-600 cursor-help" />
                                                                    </Tooltip>
                                                                ) : isCompressedFile(currentFile?.path || '') ? (
                                                                    <Tooltip content="Fichier compressé (.gz)">
                                                                        <Archive size={16} className="text-orange-500 cursor-help" />
                                                                    </Tooltip>
                                                                ) : (
                                                                    <FileText size={16} />
                                                                )}
                                                                <span className={`flex-1 ${currentFile?.size === 0 ? 'text-gray-600' : isCompressedFile(currentFile?.path || '') ? 'text-orange-400' : isRotatedFile(currentFile?.path || '') ? 'text-gray-400' : ''}`}>{groupLabel}</span>
                                                                {isCompressedFile(currentFile?.path || '') && (
                                                                    <span className="text-xs px-1.5 py-0.5 bg-orange-500/20 text-orange-400 rounded border border-orange-500/30">
                                                                        .gz
                                                                    </span>
                                                                )}
                                                                {currentFile?.readable === false && (
                                                                    <span className="text-xs text-red-500/70">
                                                                        (non accessible)
                                                                    </span>
                                                                )}
                                                                {currentFile?.size === 0 && (
                                                                    <span className="text-xs text-gray-600">
                                                                        (vide)
                                                                    </span>
                                                                )}
                                                                {rotatedFiles.length > 0 && (
                                                                    <span className="text-xs text-gray-500">
                                                                        <span className="text-yellow-50">+{rotatedFiles.length}</span> archives
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </button>
                                                        {currentFile?.size !== undefined && (
                                                            <span className="text-sm text-gray-500 whitespace-nowrap">
                                                                <span className="text-yellow-200">
                                                                    {formatFileSize(currentFile.size)}
                                                                </span>
                                                            </span>
                                                        )}
                                                        
                                                        {rotatedFiles.length > 0 && (
                                                            <button
                                                                onClick={() => toggleGroup(groupKey)}
                                                                className="ml-2 p-1 hover:bg-gray-800 rounded"
                                                            >
                                                                {isGroupExpanded ? (
                                                                    <ChevronDown size={14} className="text-orange-500" />
                                                                ) : (
                                                                    <ChevronRight size={14} className="text-orange-500" />
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Rotated Files (expandable) */}
                                                    {rotatedFiles.length > 0 && isGroupExpanded && (
                                                        <div className="pl-8 pr-4 pb-2 space-y-1 bg-[#0a0a0a]">
                                                            {rotatedFiles.map((file, fileIdx) => {
                                                                const isRotatedSelected = selectedFilePath === file.path;
                                                                
                                                                return (
                                                                <button
                                                                    key={fileIdx}
                                                                    data-selected-file={isRotatedSelected ? file.path : undefined}
                                                                    onClick={() => {
                                                                        if (file.readable !== false && file.size > 0) {
                                                                            onFileSelect(file.path, file.type || 'custom');
                                                                        }
                                                                    }}
                                                                    disabled={file.readable === false || file.size === 0}
                                                                    className={`w-full text-left px-3 py-2 rounded text-sm transition-colors flex items-center justify-between ${
                                                                        file.readable === false || file.size === 0
                                                                            ? 'text-gray-600 cursor-not-allowed opacity-50'
                                                                            : selectedFilePath === file.path
                                                                            ? isCompressedFile(file.path)
                                                                                ? 'bg-orange-500/30 text-orange-200 font-semibold border-2 border-orange-400'
                                                                                : 'bg-blue-500/30 text-blue-300 font-semibold border-2 border-blue-400'
                                                                            : isCompressedFile(file.path)
                                                                                ? 'text-orange-400 hover:bg-orange-500/10 hover:text-orange-300 border border-orange-500/20'
                                                                                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-300'
                                                                    }`}
                                                                >
                                                                    <span className={`flex items-center gap-1.5 ${file.size === 0 ? 'text-gray-600' : isCompressedFile(file.path) ? 'text-orange-400' : isRotatedFile(file.path) ? 'text-gray-400' : ''}`}>
                                                                        {(file.readable === false || file.size === 0) && (
                                                                            <Tooltip content="Fichier non accessible (droits insuffisants)">
                                                                                <Lock size={12} className="text-gray-600 cursor-help" />
                                                                            </Tooltip>
                                                                        )}
                                                                        {file.readable !== false && file.size > 0 && isCompressedFile(file.path) && (
                                                                            <Tooltip content="Fichier compressé (.gz)">
                                                                                <Archive size={12} className="text-orange-500 cursor-help" />
                                                                            </Tooltip>
                                                                        )}
                                                                        {file.path.split('/').pop() || file.path}
                                                                        {isCompressedFile(file.path) && (
                                                                            <span className="text-xs px-1 py-0.5 bg-orange-500/20 text-orange-400 rounded border border-orange-500/30 ml-1">
                                                                                .gz
                                                                            </span>
                                                                        )}
                                                                        {file.size === 0 && (
                                                                            <span className="text-xs text-gray-600 ml-1">(vide)</span>
                                                                        )}
                                                                    </span>
                                                                    <span className={`${file.readable === false || file.size === 0 ? 'text-gray-700' : 'text-yellow-200'}`}>
                                                                        {formatFileSize(file.size)}
                                                                    </span>
                                                                </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        </div>
                                    )}
                                </div>
                            )}
                    </div>
                )}
                </div>
            )}
        </div>
    );
}

// Helper functions
function getBaseFileName(filePath: string): string {
    const filename = filePath.split('/').pop() || filePath;
    // Remove rotation suffix (.1, .2, .20240101, etc.) and compression (.gz)
    // Also handle .log.1, .log.2 patterns
    return filename
        .replace(/\.log\.\d+(\.gz|\.bz2|\.xz)?$/, '') // Remove .log.1, .log.2.gz, etc.
        .replace(/\.\d+(\.gz|\.bz2|\.xz)?$/, '') // Remove .1, .2.gz, etc.
        .replace(/\.\d{8}(\.gz|\.bz2|\.xz)?$/, '') // Remove .20240101.gz, etc.
        .replace(/\.(gz|bz2|xz)$/, ''); // Remove remaining compression extensions
}

function isRotatedFile(filePath: string): boolean {
    const filename = filePath.split('/').pop() || filePath;
    // Check for rotation patterns: .1, .2, .20240101, etc. (including compressed)
    // Also check for .log.1, .log.2 patterns
    return /\.[\d]+(\.gz|\.bz2|\.xz)?$/.test(filename) || 
           /\.log\.\d+(\.gz|\.bz2|\.xz)?$/.test(filename);
}

function getBaseFileNameForRotation(filePath: string): string {
    const filename = filePath.split('/').pop() || filePath;
    // Remove rotation numbers and compression extensions
    // Handle patterns like: file.log.1, file.log.2.gz, file.1, file.2.gz
    return filename
        .replace(/\.log\.\d+(\.gz|\.bz2|\.xz)?$/, '') // Remove .log.1, .log.2.gz, etc.
        .replace(/\.\d+(\.gz|\.bz2|\.xz)?$/, '') // Remove .1, .2.gz, etc.
        .replace(/\.(gz|bz2|xz)$/, ''); // Remove remaining compression extensions
}

function getRotationNumber(filePath: string): number {
    const filename = filePath.split('/').pop() || filePath;
    // Handle .log.1, .log.2 patterns first
    const logMatch = filename.match(/\.log\.(\d+)(\.gz|\.bz2|\.xz)?$/);
    if (logMatch) {
        return parseInt(logMatch[1], 10);
    }
    // Handle .1, .2 patterns
    const match = filename.match(/\.(\d+)(\.gz|\.bz2|\.xz)?$/);
    if (match) {
        return parseInt(match[1], 10);
    }
    // For date-based rotation (YYYYMMDD), return a large number to sort them last
    const dateMatch = filename.match(/\.(\d{8})(\.gz|\.bz2|\.xz)?$/);
    if (dateMatch) {
        return parseInt(dateMatch[1], 10);
    }
    return 0;
}
