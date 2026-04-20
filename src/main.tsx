import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './i18n';
import './index.css';
import './styles/themes.css';
import { initTheme } from './utils/themeManager';
import { initChunkReloadHandler } from './utils/chunkReload';
import { APP_NAME, APP_VERSION } from './constants/version';

// Console log with colored background
const logAppInfo = () => {
    const styles = [
        'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        'color: white',
        'padding: 12px 20px',
        'border-radius: 8px',
        'font-size: 14px',
        'font-weight: bold',
        'font-family: monospace'
    ].join(';');
    
    console.log(`%c${APP_NAME} v${APP_VERSION}`, styles);
    console.log(`%cScript: main.tsx`, 'background: #1a1a1a; color: #10b981; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-family: monospace');
};

// Log app info on startup
logAppInfo();

// In production, suppress WebSocket "Invalid frame header" errors
// These errors occur when Nginx is not properly configured for WebSocket
// The HTTP polling fallback handles data updates correctly
if (import.meta.env.PROD) {
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const message = args.join(' ');
    // Suppress WebSocket "Invalid frame header" errors in production
    // These are expected when Nginx doesn't support WebSocket properly
    // The application works correctly with HTTP polling fallback
    if (
      message.includes('WebSocket connection to') &&
      message.includes('failed') &&
      (message.includes('Invalid frame header') || message.includes('1006'))
    ) {
      // Silently ignore - HTTP polling fallback is active
      return;
    }
    // Log all other errors normally
    originalConsoleError.apply(console, args);
  };
  
  // Suppress deprecated StorageType.persistent warning in production
  // This warning comes from dependencies using the old storage API
  const originalConsoleWarn = console.warn;
  console.warn = (...args: any[]) => {
    const message = args.join(' ');
    // Suppress only the StorageType.persistent deprecation warning
    if (message.includes('StorageType.persistent is deprecated')) {
      return; // Ignore silently
    }
    // Keep all other warnings
    originalConsoleWarn.apply(console, args);
  };
}

// Recover from stale-chunk errors after a new deploy (old tabs referencing
// hashed filenames that no longer exist on the server).
initChunkReloadHandler();

// Initialize theme before rendering (async, but don't block rendering)
initTheme().catch(err => console.warn('Theme initialization error:', err));

// Rybbit analytics — opt-in: only active when env vars are set
const analyticsHost = import.meta.env.VITE_ANALYTICS_HOST;
const analyticsSiteId = import.meta.env.VITE_ANALYTICS_SITE_ID;
if (analyticsHost && analyticsSiteId && !document.querySelector('script[data-site-id]')) {
  const s = document.createElement('script');
  s.src = `${analyticsHost}/api/script.js`;
  s.dataset.siteId = analyticsSiteId;
  s.dataset.disableSessionReplay = 'true';
  s.defer = true;
  document.head.appendChild(s);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>
);