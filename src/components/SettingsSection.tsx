/**
 * Shared Section and SettingRow components for Settings and Theme sections.
 * Extracted to avoid circular dependency: SettingsPage -> ThemeSection -> SettingsPage.
 */

import React from 'react';

export const SettingRow: React.FC<{
  label: string;
  description?: string;
  children: React.ReactNode;
}> = ({ label, description, children }) => (
  <div className="flex items-center justify-between py-3 border-b border-gray-800 last:border-b-0">
    <div className="flex-1">
      <h4 className="text-sm font-medium text-white">{label}</h4>
      {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
    </div>
    <div className="ml-4">{children}</div>
  </div>
);

export const Section: React.FC<{
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  permissionError?: string | null;
  iconColor?: 'blue' | 'purple' | 'emerald' | 'cyan' | 'red' | 'amber' | 'yellow' | 'violet' | 'teal' | 'orange';
}> = ({ title, icon: Icon, children, permissionError, iconColor }) => {
  const iconColorClasses: Record<string, string> = {
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    emerald: 'text-emerald-400',
    cyan: 'text-cyan-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
    yellow: 'text-yellow-400',
    violet: 'text-violet-300',
    teal: 'text-teal-300',
    orange: 'text-orange-400',
  };

  const iconClassName = iconColor ? iconColorClasses[iconColor] : 'text-theme-secondary';

  return (
    <div className={`bg-theme-card rounded-xl border border-theme overflow-hidden ${permissionError ? 'opacity-60' : ''}`} style={{ backdropFilter: 'var(--backdrop-blur)' }}>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-theme bg-theme-primary">
        <Icon size={18} className={iconClassName} />
        <h3 className="font-medium theme-section-title">{title}</h3>
      </div>
      {permissionError && (
        <div className="px-4 py-3 bg-amber-900/20 border-b border-amber-700/30">
          <p className="text-amber-400 text-xs">{permissionError}</p>
        </div>
      )}
      <div className={`px-4 py-4 ${permissionError ? 'pointer-events-none' : ''}`}>{children}</div>
    </div>
  );
};
