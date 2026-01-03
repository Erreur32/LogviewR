import React, { useEffect, useState } from 'react';

interface ClockProps {
    /**
     * Show date below time
     * @default true
     */
    showDate?: boolean;
    /**
     * Custom className for the container
     */
    className?: string;
    /**
     * Show yellow LED indicator (Freebox Revolution style)
     * @default true
     */
    showLed?: boolean;
}

/**
 * Clock component - Real-time clock with HH:MM:SS format
 * Updates every second
 */
export const Clock: React.FC<ClockProps> = ({
    showDate = true,
    className = '',
    showLed = true
}) => {
    const [currentTime, setCurrentTime] = useState(new Date());

    // Update time every second
    useEffect(() => {
        const updateTime = () => setCurrentTime(new Date());
        updateTime(); // Set initial time immediately
        
        const interval = setInterval(updateTime, 1000); // Update every second
        
        return () => clearInterval(interval);
    }, []);

    return (
        <div className={`flex items-center gap-2 bg-theme-secondary px-4 py-2 rounded-lg border border-theme ${className}`}>
            {showLed && (
                <div className="w-2 h-2 rounded-full bg-yellow-400 shadow-lg shadow-yellow-400/50 animate-pulse" />
            )}
            <div className="flex flex-col items-end">
                <div className="text-sm font-mono text-theme-primary font-semibold">
                    {currentTime.toLocaleTimeString('fr-FR', { 
                        hour: '2-digit', 
                        minute: '2-digit',
                        second: '2-digit'
                    })}
                </div>
                {showDate && (
                    <div className="text-xs text-theme-secondary">
                        {currentTime.toLocaleDateString('fr-FR', { 
                            weekday: 'short', 
                            day: '2-digit', 
                            month: 'short' 
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
