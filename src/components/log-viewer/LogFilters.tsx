/**
 * Log Filters Component
 * 
 * Barre de filtres au-dessus du tableau avec recherche texte, niveau, date, IP, méthode HTTP
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, Filter, Calendar, AlertCircle, Eye, EyeOff, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/Button.js';
import { Badge } from '../ui/Badge.js';
import type { LogFilters as LogFiltersType, LogEntry } from '../../types/logViewer.js';

interface LogFiltersProps {
    filters: LogFiltersType;
    onFiltersChange: (filters: Partial<LogFiltersType>) => void;
    logType?: string;
    className?: string;
    logDateRange?: { min?: Date; max?: Date };
    pluginId?: string;
    logs?: LogEntry[]; // Logs to analyze for available filter values
}

export const LogFilters: React.FC<LogFiltersProps> = ({
    filters,
    onFiltersChange,
    logType = 'syslog',
    className = '',
    logDateRange,
    pluginId,
    logs = []
}) => {
    const [searchValue, setSearchValue] = useState(filters.search || '');
    const [isExpanded, setIsExpanded] = useState(false);
    const [isMobile, setIsMobile] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [selectingRange, setSelectingRange] = useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });

    // Detect mobile
    useEffect(() => {
        const checkMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Close date picker when clicking outside
    useEffect(() => {
        if (!showDatePicker) return;
        
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            if (!target.closest('.date-picker-container')) {
                setShowDatePicker(false);
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showDatePicker]);

    // Sync searchValue when filters.search is cleared from outside (e.g. "Effacer la recherche" in empty state)
    // Only clear - never overwrite user typing with a non-empty value
    useEffect(() => {
        if (!filters.search && searchValue) {
            setSearchValue('');
        }
    }, [filters.search]);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchValue !== filters.search) {
                onFiltersChange({ search: searchValue || undefined });
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [searchValue, filters.search, onFiltersChange]);

    // Count active filters
    const activeFiltersCount = useMemo(() => {
        let count = 0;
        if (filters.search) count++;
        if (filters.level && filters.level.length > 0) count++;
        if (filters.httpCode && filters.httpCode.length > 0) count++;
        if (filters.dateFrom) count++;
        if (filters.dateTo) count++;
        if (filters.httpMethod && filters.httpMethod.length > 0) count++;
        if (filters.showUnparsed === false) count++; // Count as active if hiding unparsed
        return count;
    }, [filters]);

    const handleReset = () => {
        setSearchValue('');
        onFiltersChange({
            search: undefined,
            level: undefined,
            httpCode: undefined,
            dateFrom: undefined,
            dateTo: undefined,
            httpMethod: undefined,
            showUnparsed: undefined // Reset to default (show all)
        });
    };

    const handleLevelChange = (level: string) => {
        const currentLevels = Array.isArray(filters.level) ? filters.level : filters.level ? [filters.level] : [];
        const newLevels = currentLevels.includes(level)
            ? currentLevels.filter(l => l !== level)
            : [...currentLevels, level];
        onFiltersChange({ level: newLevels.length > 0 ? newLevels : undefined });
    };

    const handleHttpCodeChange = (code: number) => {
        const currentCodes = filters.httpCode || [];
        const newCodes = currentCodes.includes(code)
            ? currentCodes.filter(c => c !== code)
            : [...currentCodes, code];
        onFiltersChange({ httpCode: newCodes.length > 0 ? newCodes : undefined });
    };

    const handleHttpMethodChange = (method: string) => {
        const currentMethods = filters.httpMethod || [];
        const newMethods = currentMethods.includes(method)
            ? currentMethods.filter(m => m !== method)
            : [...currentMethods, method];
        onFiltersChange({ httpMethod: newMethods.length > 0 ? newMethods : undefined });
    };

    const allLevels = ['info', 'warn', 'error', 'debug', 'emerg', 'alert', 'crit', 'notice'];
    const allHttpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
    const allHttpCodes = [200, 201, 202, 204, 206, 301, 302, 304, 307, 308, 400, 401, 403, 404, 408, 429, 500, 502, 503, 504];
    const httpCodeRanges = [
        { label: '2xx', codes: [200, 201, 202, 204, 206] },
        { label: '3xx', codes: [301, 302, 304, 307, 308] },
        { label: '4xx', codes: [400, 401, 403, 404, 408, 429] },
        { label: '5xx', codes: [500, 502, 503, 504] }
    ];

    // Analyze logs to detect available values
    const availableValues = useMemo(() => {
        const available: {
            levels: Set<string>;
            httpCodes: Set<number>;
            httpMethods: Set<string>;
        } = {
            levels: new Set(),
            httpCodes: new Set(),
            httpMethods: new Set()
        };

        logs.forEach((log) => {
            // Levels
            if (log.level) {
                available.levels.add(String(log.level).toLowerCase());
            }

            // HTTP codes
            const code = Number(log.status || log.statusCode || log.code || 0);
            if (code > 0 && allHttpCodes.includes(code)) {
                available.httpCodes.add(code);
            }

            // HTTP methods
            const method = String(log.method || log.httpMethod || '').toUpperCase();
            if (method && allHttpMethods.includes(method)) {
                available.httpMethods.add(method);
            }
        });

        return available;
    }, [logs]);

    // Filter levels to show only those present in logs (or active filters)
    const levels = useMemo(() => {
        if (pluginId !== 'host-system') return [];
        return allLevels.filter(level => 
            availableValues.levels.has(level) || 
            filters.level?.includes(level)
        );
    }, [availableValues.levels, filters.level, pluginId]);

    // Filter HTTP codes to show only those present in logs (or active filters)
    const httpCodes = useMemo(() => {
        if (pluginId !== 'apache' && pluginId !== 'nginx' && pluginId !== 'npm') return [];
        return allHttpCodes.filter(code =>
            availableValues.httpCodes.has(code) ||
            filters.httpCode?.includes(code)
        );
    }, [availableValues.httpCodes, filters.httpCode, pluginId]);

    // Filter HTTP methods to show only those present in logs (or active filters)
    const httpMethods = useMemo(() => {
        if (pluginId !== 'apache' && pluginId !== 'nginx' && pluginId !== 'npm') return [];
        return allHttpMethods.filter(method =>
            availableValues.httpMethods.has(method) ||
            filters.httpMethod?.includes(method)
        );
    }, [availableValues.httpMethods, filters.httpMethod, pluginId]);

    // Calendar utilities
    const getDaysInMonth = (date: Date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();
        
        const days: Array<{ date: Date; isCurrentMonth: boolean; isAvailable: boolean }> = [];
        
        // Add previous month's trailing days
        const prevMonth = new Date(year, month - 1, 0);
        for (let i = startingDayOfWeek - 1; i >= 0; i--) {
            const date = new Date(year, month - 1, prevMonth.getDate() - i);
            days.push({ date, isCurrentMonth: false, isAvailable: isDateAvailable(date) });
        }
        
        // Add current month's days
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month, day);
            days.push({ date, isCurrentMonth: true, isAvailable: isDateAvailable(date) });
        }
        
        // Add next month's leading days to fill the grid
        const remainingDays = 42 - days.length; // 6 rows * 7 days
        for (let day = 1; day <= remainingDays; day++) {
            const date = new Date(year, month + 1, day);
            days.push({ date, isCurrentMonth: false, isAvailable: isDateAvailable(date) });
        }
        
        return days;
    };

    const isDateAvailable = (date: Date): boolean => {
        if (!logDateRange?.min || !logDateRange?.max) return true;
        const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const minDate = new Date(logDateRange.min.getFullYear(), logDateRange.min.getMonth(), logDateRange.min.getDate());
        const maxDate = new Date(logDateRange.max.getFullYear(), logDateRange.max.getMonth(), logDateRange.max.getDate());
        return dateOnly >= minDate && dateOnly <= maxDate;
    };

    const isDateInRange = (date: Date, start: Date | null, end: Date | null): boolean => {
        if (!start || !end) return false;
        const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const startOnly = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endOnly = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        return dateOnly >= startOnly && dateOnly <= endOnly;
    };

    const handleDateClick = (date: Date) => {
        if (!isDateAvailable(date)) return;
        
        const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        
        if (!selectingRange.start || (selectingRange.start && selectingRange.end)) {
            // Start new selection
            setSelectingRange({ start: dateOnly, end: null });
        } else {
            // Complete selection
            if (dateOnly < selectingRange.start) {
                // If clicked date is before start, swap them
                setSelectingRange({ start: dateOnly, end: selectingRange.start });
            } else {
                setSelectingRange({ start: selectingRange.start, end: dateOnly });
            }
        }
    };

    const applyDateRange = () => {
        if (selectingRange.start && selectingRange.end) {
            const start = new Date(selectingRange.start);
            start.setHours(0, 0, 0, 0);
            const end = new Date(selectingRange.end);
            end.setHours(23, 59, 59, 999);
            onFiltersChange({ dateFrom: start, dateTo: end });
            setShowDatePicker(false);
            setSelectingRange({ start: null, end: null });
        }
    };

    const clearDateRange = () => {
        onFiltersChange({ dateFrom: undefined, dateTo: undefined });
        setSelectingRange({ start: null, end: null });
        setShowDatePicker(false);
    };

    // Initialize current month based on logDateRange or current date
    useEffect(() => {
        if (logDateRange?.min) {
            setCurrentMonth(new Date(logDateRange.min));
        } else if (filters.dateFrom) {
            setCurrentMonth(new Date(filters.dateFrom));
        }
    }, [logDateRange, filters.dateFrom]);

    // Initialize selectingRange from filters
    useEffect(() => {
        if (filters.dateFrom && filters.dateTo && showDatePicker) {
            setSelectingRange({
                start: new Date(filters.dateFrom),
                end: new Date(filters.dateTo)
            });
        } else if (!filters.dateFrom && !filters.dateTo) {
            setSelectingRange({ start: null, end: null });
        }
    }, [filters.dateFrom, filters.dateTo, showDatePicker]);

    const calendarDays = useMemo(() => getDaysInMonth(currentMonth), [currentMonth, logDateRange]);
    const monthNames = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
    const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

    // Filter content is now inline in the return statement for better layout control

    // Compact mode for header (no background, no padding)
    const isCompact = className.includes('compact');
    
    return (
        <div className={isCompact ? `flex items-center gap-2 ${className}` : `bg-[#121212] border border-gray-800 rounded-xl p-4 ${className}`}>
            {/* Single Row: Search + Date Button */}
            <div className={`flex items-center gap-3 flex-wrap ${isCompact ? 'flex-nowrap' : ''}`}>
                {/* Search Input with clear (X) button */}
                <div className={`relative ${isCompact ? 'w-64' : 'flex-1 min-w-[200px]'}`}>
                    <Search className={`absolute left-3 top-1/2 transform -translate-y-1/2 ${filters.search ? 'text-cyan-400' : 'text-gray-500'}`} size={18} />
                    <input
                        type="text"
                        value={searchValue}
                        onChange={(e) => setSearchValue(e.target.value)}
                        placeholder="Rechercher dans les logs..."
                        className={`w-full pl-10 py-2 rounded-lg border text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 text-sm ${
                            filters.search ? 'pr-10' : 'pr-4'
                        } ${
                            filters.search
                                ? 'border-cyan-500/50 bg-cyan-500/10 ring-2 ring-cyan-400/30'
                                : isCompact 
                                    ? 'border-theme-border bg-theme-secondary' 
                                    : 'border-gray-700 bg-[#0a0a0a]'
                        }`}
                    />
                    {filters.search && (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchValue('');
                                onFiltersChange({ search: undefined });
                            }}
                            className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 rounded hover:bg-gray-600/50 text-gray-400 hover:text-gray-200 transition-colors"
                            title="Effacer la recherche"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>

                {/* Date Button - Opens date picker, no automatic filter */}
                <div className="relative date-picker-container">
                    <button
                        onClick={() => {
                            // If filter is already active, clear it
                            if (filters.dateFrom && filters.dateTo) {
                                onFiltersChange({ dateFrom: undefined, dateTo: undefined });
                                return;
                            }
                            // Otherwise, toggle date picker
                            setShowDatePicker(!showDatePicker);
                        }}
                        className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10 text-cyan-300 border-cyan-500/30 hover:from-cyan-500/20 hover:via-blue-500/20 hover:to-purple-500/20 hover:border-cyan-500/50 ${
                            filters.dateFrom && filters.dateTo
                                ? 'ring-2 ring-cyan-500/50'
                                : ''
                        }`}
                        title={
                            filters.dateFrom && filters.dateTo
                                ? 'Réinitialiser le filtre de date'
                                : logDateRange?.min && logDateRange?.max
                                    ? `Fichier log: ${new Date(logDateRange.min).toLocaleDateString('fr-FR')} - ${new Date(logDateRange.max).toLocaleDateString('fr-FR')} - Cliquez pour filtrer par date`
                                    : 'Cliquez pour filtrer par date'
                        }
                    >
                        <Calendar size={14} />
                        {filters.dateFrom && filters.dateTo ? (
                            <span>
                                {(() => {
                                    const fromDate = new Date(filters.dateFrom);
                                    const toDate = new Date(filters.dateTo);
                                    const fromDay = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
                                    const toDay = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
                                    const daysDiff = Math.floor((toDay.getTime() - fromDay.getTime()) / (1000 * 60 * 60 * 24));
                                    
                                    if (daysDiff > 0) {
                                        // Multiple days - show range
                                        return `${fromDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} - ${toDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
                                    } else {
                                        // Single day
                                        return fromDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
                                    }
                                })()}
                            </span>
                        ) : logDateRange?.min && logDateRange?.max ? (
                            <span>
                                {(() => {
                                    const minDate = new Date(logDateRange.min);
                                    const maxDate = new Date(logDateRange.max);
                                    const minDay = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
                                    const maxDay = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate());
                                    const daysDiff = Math.floor((maxDay.getTime() - minDay.getTime()) / (1000 * 60 * 60 * 24));
                                    
                                    if (daysDiff > 0) {
                                        // Multiple days - show range (informational only)
                                        return `${minDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} - ${maxDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`;
                                    } else {
                                        // Single day
                                        return minDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
                                    }
                                })()}
                            </span>
                        ) : (
                            <span>Date</span>
                        )}
                    </button>
                    {/* Calendar Date Picker Dropdown */}
                    {showDatePicker && (
                        <div className="absolute top-full left-0 mt-2 bg-[#1a1a1a] border border-gray-700 rounded-lg p-4 shadow-xl z-50 w-[320px]">
                            {/* Calendar Header */}
                            <div className="flex items-center justify-between mb-4">
                                <button
                                    onClick={() => {
                                        const prevMonth = new Date(currentMonth);
                                        prevMonth.setMonth(prevMonth.getMonth() - 1);
                                        setCurrentMonth(prevMonth);
                                    }}
                                    className="p-1 hover:bg-gray-700 rounded transition-colors"
                                    title="Mois précédent"
                                >
                                    <ChevronLeft size={18} className="text-gray-400" />
                                </button>
                                <div className="text-sm font-medium text-gray-200">
                                    {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                                </div>
                                <button
                                    onClick={() => {
                                        const nextMonth = new Date(currentMonth);
                                        nextMonth.setMonth(nextMonth.getMonth() + 1);
                                        setCurrentMonth(nextMonth);
                                    }}
                                    className="p-1 hover:bg-gray-700 rounded transition-colors"
                                    title="Mois suivant"
                                >
                                    <ChevronRight size={18} className="text-gray-400" />
                                </button>
                            </div>

                            {/* Day Names Header */}
                            <div className="grid grid-cols-7 gap-1 mb-2">
                                {dayNames.map((day) => (
                                    <div key={day} className="text-xs font-medium text-gray-500 text-center py-1">
                                        {day}
                                    </div>
                                ))}
                            </div>

                            {/* Calendar Grid */}
                            <div className="grid grid-cols-7 gap-1">
                                {calendarDays.map((day, index) => {
                                    const dateOnly = new Date(day.date.getFullYear(), day.date.getMonth(), day.date.getDate());
                                    const isSelectedStart = selectingRange.start && 
                                        dateOnly.getTime() === selectingRange.start.getTime();
                                    const isSelectedEnd = selectingRange.end && 
                                        dateOnly.getTime() === selectingRange.end.getTime();
                                    const isInRange = isDateInRange(dateOnly, selectingRange.start, selectingRange.end);
                                    const isToday = dateOnly.getTime() === new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
                                    const isInLogRange = logDateRange?.min && logDateRange?.max && 
                                        dateOnly >= new Date(logDateRange.min.getFullYear(), logDateRange.min.getMonth(), logDateRange.min.getDate()) &&
                                        dateOnly <= new Date(logDateRange.max.getFullYear(), logDateRange.max.getMonth(), logDateRange.max.getDate());

                                    return (
                                        <button
                                            key={index}
                                            onClick={() => handleDateClick(day.date)}
                                            disabled={!day.isAvailable}
                                            className={`
                                                aspect-square text-xs font-medium rounded transition-colors
                                                ${!day.isCurrentMonth 
                                                    ? 'text-gray-600' 
                                                    : day.isAvailable 
                                                        ? 'text-gray-200 hover:bg-cyan-500/30' 
                                                        : 'text-gray-600 cursor-not-allowed opacity-50'
                                                }
                                                ${isSelectedStart || isSelectedEnd
                                                    ? 'bg-cyan-500 text-white font-bold'
                                                    : ''
                                                }
                                                ${isInRange && !isSelectedStart && !isSelectedEnd
                                                    ? 'bg-cyan-500/20 text-cyan-300'
                                                    : ''
                                                }
                                                ${isToday && !isSelectedStart && !isSelectedEnd
                                                    ? 'ring-2 ring-cyan-400/50'
                                                    : ''
                                                }
                                                ${isInLogRange && !isInRange && !isSelectedStart && !isSelectedEnd && day.isCurrentMonth
                                                    ? 'bg-blue-500/10'
                                                    : ''
                                                }
                                            `}
                                            title={
                                                !day.isAvailable 
                                                    ? 'Date non disponible dans le fichier log'
                                                    : day.isCurrentMonth
                                                        ? dateOnly.toLocaleDateString('fr-FR')
                                                        : ''
                                            }
                                        >
                                            {day.date.getDate()}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Selected Range Display */}
                            {(selectingRange.start || selectingRange.end) && (
                                <div className="mt-4 pt-4 border-t border-gray-700">
                                    <div className="text-xs text-gray-400 mb-2">
                                        {selectingRange.start && selectingRange.end ? (
                                            <>
                                                Sélection : {selectingRange.start.toLocaleDateString('fr-FR')} - {selectingRange.end.toLocaleDateString('fr-FR')}
                                            </>
                                        ) : selectingRange.start ? (
                                            <>
                                                Sélectionnez la date de fin
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-2 mt-4 pt-4 border-t border-gray-700">
                                <Button
                                    onClick={applyDateRange}
                                    variant="primary"
                                    size="sm"
                                    className="flex-1"
                                    disabled={!selectingRange.start || !selectingRange.end}
                                >
                                    Appliquer
                                </Button>
                                <Button
                                    onClick={clearDateRange}
                                    variant="ghost"
                                    size="sm"
                                >
                                    Réinitialiser
                                </Button>
                            </div>

                            {/* Info about log file date range */}
                            {logDateRange?.min && logDateRange?.max && (
                                <div className="mt-3 pt-3 border-t border-gray-700">
                                    <div className="text-xs text-gray-500 text-center">
                                        Fichier log : {logDateRange.min.toLocaleDateString('fr-FR')} - {logDateRange.max.toLocaleDateString('fr-FR')}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Reset Button - Only show if filters are active */}
                {(filters.search || filters.dateFrom || filters.dateTo || (filters.level && filters.level.length > 0) || (filters.httpCode && filters.httpCode.length > 0) || (filters.httpMethod && filters.httpMethod.length > 0)) && (
                    <Button onClick={handleReset} variant="ghost" size="sm" className="text-gray-400 hover:text-gray-200">
                        <X size={14} className="mr-1" />
                        Réinitialiser
                    </Button>
                )}
            </div>

            {/* Expanded Filters - Advanced Options */}
            {(isExpanded || !isMobile) && (
                <div className="border-t border-gray-800 pt-4 mt-4 space-y-4">

                    {/* Level Filter - Only for host-system plugin - Only show if levels are available */}
                    {pluginId === 'host-system' && levels.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-xs font-medium flex items-center gap-2 ${
                                filters.level && filters.level.length > 0 ? 'text-cyan-400' : 'text-gray-400'
                            }`}>
                                {filters.level && filters.level.length > 0 && <Filter size={12} />}
                                Niveau{filters.level && filters.level.length > 0 ? ' (actif)' : ''}
                            </span>
                            <span className="text-gray-600">|</span>
                            <div className="flex flex-wrap gap-2">
                                {levels.map((level) => {
                                    const isActive = filters.level?.includes(level);
                                    // Color mapping for levels
                                    const levelColors: Record<string, string> = {
                                        'error': 'bg-red-500',
                                        'warn': 'bg-yellow-500',
                                        'info': 'bg-blue-500',
                                        'debug': 'bg-gray-500',
                                        'emerg': 'bg-red-700',
                                        'alert': 'bg-orange-500',
                                        'crit': 'bg-red-600',
                                        'notice': 'bg-green-500'
                                    };
                                    const levelColor = levelColors[level] || 'bg-gray-500';
                                    
                                    return (
                                        <button
                                            key={level}
                                            onClick={() => handleLevelChange(level)}
                                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
                                                isActive
                                                    ? `${levelColor} text-white ring-2 ring-cyan-400/50 shadow-lg`
                                                    : 'bg-[#0a0a0a] text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-300 border border-gray-700'
                                            }`}
                                        >
                                            {level}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Unparsed Logs Filter - Hidden by default, can be shown via filter badge */}
                    {filters.showUnparsed === false && (
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-2">
                                Affichage
                            </label>
                            <button
                                onClick={() => onFiltersChange({ showUnparsed: undefined })}
                                className="px-4 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                                title="Afficher les logs non parsés"
                            >
                                <EyeOff size={14} />
                                Masquer les logs non parsés
                            </button>
                        </div>
                    )}

                    {/* HTTP Filters (Code, Method, IP Source) - Only for HTTP access logs */}
                    {(pluginId === 'apache' || pluginId === 'nginx' || pluginId === 'npm') && (logType === 'access' || logType === 'error') && (
                        <div className="space-y-4">
                            {/* HTTP Code Filter - Only show if codes are available */}
                            {httpCodes.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-xs font-medium flex items-center gap-2 ${
                                    filters.httpCode && filters.httpCode.length > 0 ? 'text-cyan-400' : 'text-gray-400'
                                }`}>
                                    {filters.httpCode && filters.httpCode.length > 0 && <Filter size={12} />}
                                    Code HTTP{filters.httpCode && filters.httpCode.length > 0 ? ' (actif)' : ''}
                                </span>
                                <span className="text-gray-600">|</span>
                                <div className="flex flex-wrap gap-2">
                                    {httpCodeRanges.map((range) => {
                                        const availableCodes = range.codes.filter(code => httpCodes.includes(code));
                                        if (availableCodes.length === 0) return null;
                                        return (
                                            <div key={range.label} className="flex flex-wrap gap-1">
                                                {availableCodes.map((code) => {
                                                    const isActive = filters.httpCode?.includes(code);
                                                    return (
                                                        <button
                                                            key={code}
                                                            onClick={() => handleHttpCodeChange(code)}
                                                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                                                isActive
                                                                    ? 'bg-cyan-500 text-white ring-2 ring-cyan-400/50 shadow-lg'
                                                                    : 'bg-[#0a0a0a] text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-300 border border-gray-700'
                                                            }`}
                                                        >
                                                            {code}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            )}

                            {/* HTTP Method Filter - Only show if methods are available */}
                            {httpMethods.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-xs font-medium flex items-center gap-2 ${
                                    filters.httpMethod && filters.httpMethod.length > 0 ? 'text-cyan-400' : 'text-gray-400'
                                }`}>
                                    {filters.httpMethod && filters.httpMethod.length > 0 && <Filter size={12} />}
                                    Méthode HTTP{filters.httpMethod && filters.httpMethod.length > 0 ? ' (actif)' : ''}
                                </span>
                                <span className="text-gray-600">|</span>
                                <div className="flex flex-wrap gap-2">
                                    {httpMethods.map((method) => {
                                        const isActive = filters.httpMethod?.includes(method);
                                        return (
                                            <button
                                                key={method}
                                                onClick={() => handleHttpMethodChange(method)}
                                                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                                    isActive
                                                        ? 'bg-cyan-500 text-white ring-2 ring-cyan-400/50 shadow-lg'
                                                        : 'bg-[#0a0a0a] text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-300 border border-gray-700'
                                                }`}
                                            >
                                                {method}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            )}
                        </div>
                    )}

                </div>
            )}

            {/* Mobile Modal */}
            {isMobile && isExpanded && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-theme-secondary rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-theme-primary">Filtres</h3>
                            <button
                                onClick={() => setIsExpanded(false)}
                                className="p-2 hover:bg-theme-tertiary rounded transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="space-y-4">
                            {/* Level Filter - Only for host-system plugin - Only show if levels are available */}
                            {pluginId === 'host-system' && levels.length > 0 && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className={`text-xs font-medium flex items-center gap-2 ${
                                        filters.level && filters.level.length > 0 ? 'text-cyan-400' : 'text-gray-400'
                                    }`}>
                                        {filters.level && filters.level.length > 0 && <Filter size={12} />}
                                        Niveau{filters.level && filters.level.length > 0 ? ' (actif)' : ''}
                                    </span>
                                    <span className="text-gray-600">|</span>
                                    <div className="flex flex-wrap gap-2">
                                        {levels.map((level) => {
                                            const isActive = filters.level?.includes(level);
                                            // Color mapping for levels
                                            const levelColors: Record<string, string> = {
                                                'error': 'bg-red-500',
                                                'warn': 'bg-yellow-500',
                                                'info': 'bg-blue-500',
                                                'debug': 'bg-gray-500',
                                                'emerg': 'bg-red-700',
                                                'alert': 'bg-orange-500',
                                                'crit': 'bg-red-600',
                                                'notice': 'bg-green-500'
                                            };
                                            const levelColor = levelColors[level] || 'bg-gray-500';
                                            
                                            return (
                                                <button
                                                    key={level}
                                                    onClick={() => handleLevelChange(level)}
                                                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
                                                        isActive
                                                            ? `${levelColor} text-white ring-2 ring-cyan-400/50 shadow-lg`
                                                            : 'bg-[#0a0a0a] text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-300 border border-gray-700'
                                                    }`}
                                                >
                                                    {level}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Unparsed Logs Filter */}
                            {filters.showUnparsed === false && (
                                <div>
                                    <label className="block text-xs font-medium text-gray-400 mb-2">
                                        Affichage
                                    </label>
                                    <button
                                        onClick={() => onFiltersChange({ showUnparsed: undefined })}
                                        className="px-4 py-2 rounded-md text-xs font-medium transition-colors flex items-center gap-2 bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30"
                                        title="Afficher les logs non parsés"
                                    >
                                        <EyeOff size={14} />
                                        Masquer les logs non parsés
                                    </button>
                                </div>
                            )}

                            {/* HTTP Filters (Code, Method, IP Source) - Only for HTTP access logs */}
                            {(pluginId === 'apache' || pluginId === 'nginx' || pluginId === 'npm') && (logType === 'access' || logType === 'error') && (
                                <div className="space-y-4">
                                    {/* HTTP Code Filter - Only show if codes are available */}
                                    {httpCodes.length > 0 && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`text-xs font-medium flex items-center gap-2 ${
                                            filters.httpCode && filters.httpCode.length > 0 ? 'text-cyan-400' : 'text-gray-400'
                                        }`}>
                                            {filters.httpCode && filters.httpCode.length > 0 && <Filter size={12} />}
                                            Code HTTP{filters.httpCode && filters.httpCode.length > 0 ? ' (actif)' : ''}
                                        </span>
                                        <span className="text-gray-600">|</span>
                                        <div className="flex flex-wrap gap-2">
                                            {httpCodeRanges.map((range) => {
                                                const availableCodes = range.codes.filter(code => httpCodes.includes(code));
                                                if (availableCodes.length === 0) return null;
                                                return (
                                                    <div key={range.label} className="flex flex-wrap gap-1">
                                                        {availableCodes.map((code) => {
                                                            const isActive = filters.httpCode?.includes(code);
                                                            return (
                                                                <button
                                                                    key={code}
                                                                    onClick={() => handleHttpCodeChange(code)}
                                                                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                                                        isActive
                                                                            ? 'bg-cyan-500 text-white ring-2 ring-cyan-400/50 shadow-lg'
                                                                            : 'bg-[#0a0a0a] text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-300 border border-gray-700'
                                                                    }`}
                                                                >
                                                                    {code}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    )}

                                    {/* HTTP Method Filter - Only show if methods are available */}
                                    {httpMethods.length > 0 && (
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={`text-xs font-medium flex items-center gap-2 ${
                                            filters.httpMethod && filters.httpMethod.length > 0 ? 'text-cyan-400' : 'text-gray-400'
                                        }`}>
                                            {filters.httpMethod && filters.httpMethod.length > 0 && <Filter size={12} />}
                                            Méthode HTTP{filters.httpMethod && filters.httpMethod.length > 0 ? ' (actif)' : ''}
                                        </span>
                                        <span className="text-gray-600">|</span>
                                        <div className="flex flex-wrap gap-2">
                                            {httpMethods.map((method) => {
                                                const isActive = filters.httpMethod?.includes(method);
                                                return (
                                                    <button
                                                        key={method}
                                                        onClick={() => handleHttpMethodChange(method)}
                                                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                                                            isActive
                                                                ? 'bg-cyan-500 text-white ring-2 ring-cyan-400/50 shadow-lg'
                                                                : 'bg-[#0a0a0a] text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-300 border border-gray-700'
                                                        }`}
                                                    >
                                                        {method}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    )}
                                </div>
                            )}
                        </div>
                        <div className="mt-6 flex gap-2">
                            <Button onClick={() => setIsExpanded(false)} variant="primary" className="flex-1">
                                Appliquer
                            </Button>
                            <Button onClick={handleReset} variant="ghost">
                                Réinitialiser
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
