# Changelog

All notable changes to LogviewR will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-01-03

### Fixed

#### OS Detection
- **Linux Mint detection**: Fixed OS detection for Linux Mint systems
  - Improved detection logic to check Mint before Ubuntu (Mint has `ID_LIKE="ubuntu debian"`)
  - Added helper function `idLikeContains()` to properly handle multi-value `ID_LIKE` fields
  - Now correctly detects Mint even when only `ID_LIKE` contains "ubuntu"
  - Supports detection via `ID=linuxmint`, `ID=mint`, or `ID_LIKE` containing "mint"/"linuxmint"

### Added

#### Linux Mint Support
- **Mint icon**: Added Linux Mint icon to frontend plugin icons
  - Mint icon now displays correctly in plugin management section
  - Icon automatically shown when OS is detected as Mint
  - Uses existing `mint.svg` icon file

- **Mint-specific log files**: Added `mintupdate.log` to default system log files for Mint
  - `/var/log/mintupdate.log` now included in default log files list for Mint
  - Added to default file patterns (`mintupdate.log*`) for automatic detection
  - Included in log rotation detection for Mint systems
  - File is disabled by default but visible in log files list

### Changed

#### OS Detection Logic
- **Detection order**: Reorganized OS detection to check Mint before Ubuntu
  - Prevents Mint from being incorrectly detected as Ubuntu
  - More accurate OS type identification for Mint-based systems
  - Better handling of `ID_LIKE` field with multiple values

---

## [0.1.4] - 2026-01-03

### Fixed

#### Plugin Options Panel
- **Auto-refresh issue**: Fixed automatic refresh that was overwriting user input when editing `basePath` field
  - Added debounce (500ms) for `basePath` field auto-save
  - Added debounce (1s) for detected files reload after `basePath` changes
  - Prevents file list from reloading while user is typing
  - User modifications are no longer overwritten during editing

#### Docker Path Conversion
- **Apache and Nginx plugins**: Fixed Docker path conversion for log files
  - Added `convertToDockerPath()` method in `BasePlugin` for automatic path conversion
  - Converts `/var/log/apache2` to `/host/logs/apache2` (or `/host/var/log/apache2` as fallback)
  - Converts `/var/log/nginx` to `/host/logs/nginx` (or `/host/var/log/nginx` as fallback)
  - Handles all paths starting with `/var/log` automatically
  - Works correctly even when `/host/logs` symlink doesn't exist

#### Host System Plugin
- **Docker path fallback**: Improved fallback mechanism for log base path
  - Uses `/host/var/log` directly when `/host/logs` symlink doesn't exist
  - Prevents "Connection failed" errors when symlink creation fails
  - Better compatibility with read-only filesystems

#### HTML Validation
- **Nested buttons**: Fixed React hydration error caused by nested `<button>` elements
  - Replaced parent buttons with `<div>` elements using `role="button"` and `tabIndex={0}`
  - Added keyboard navigation support (Enter and Space keys)
  - Applied to "Fichiers de logs système" and "Fichiers détectés avec regex" sections
  - Maintains full functionality and accessibility

#### TypeScript Errors
- **Type conversions**: Fixed TypeScript errors for `HostSystemPluginConfig` type conversions
  - Added `as unknown as` intermediate conversion for safe type casting
  - Fixed type mapping for 'user' and 'cron' log types in auto-detected files
  - Improved type safety in plugin configuration handling

### Added

#### Log File Permissions
- **Docker permissions**: Added automatic configuration for reading system log files
  - Container automatically adds `node` user to `adm` group (GID 4)
  - Allows reading files owned by `root:adm` with permissions `640`
  - Configurable via `ADM_GID` environment variable for custom GID
  - Supports reading auth.log, cron.log, daemon.log, syslog, and other system logs

#### Documentation
- **README updates**: Added comprehensive documentation for log file permissions
  - Section explaining Docker permissions configuration
  - Instructions for handling files with restrictive permissions (600)
  - Examples for fixing permissions on php8.0-fpm.log and rkhunter.log.1
  - Security notes about adm group usage

### Changed

#### Docker Configuration
- **docker-compose.yml**: Added `group_add` configuration for adm group
  - Automatically adds container to adm group for log file access
  - Configurable via `ADM_GID` environment variable (default: 4)

#### docker-entrypoint.sh
- **Group management**: Enhanced entrypoint script to add node user to adm group
  - Creates adm group with standard GID 4 if it doesn't exist
  - Adds node user to adm group for log file access
  - Works seamlessly with Docker volume mounts

---

## [0.1.3] - 2026-01-03

---

## [0.1.2] - 2025-01-28

### Changed

#### UI/UX Improvements
- **Header file selector**: Removed file count badge from "Fichiers de logs" button - count now only displayed on plugin icon badge
  - Cleaner header interface
  - File count remains visible on plugin icon for quick reference
- **Log table statistics**: Improved statistics badges display
  - Added file size badge (displayed first, before other badges)
  - Removed "Statistiques :" label text - only badges are now displayed
  - File size badge uses purple color scheme to differentiate from other badges
  - File size formatted automatically (B, KB, MB, GB)
- **Filter badges layout**: Enhanced filter badges display for better readability
  - Filter titles and badges now displayed on a single line with separator "|"
  - Applied to "Niveau", "Code HTTP", and "Méthode HTTP" filters
  - More compact and consistent layout
  - Better use of horizontal space

### Technical Details

- **Frontend**:
  - Updated `Header.tsx` to remove file count from file selector button
  - Updated `LogTable.tsx` to add file size badge and remove statistics label
  - Updated `LogFilters.tsx` to display filter titles and badges on single line
  - Added `fileSize` prop to `LogTable` component
  - Updated `LogViewerPage.tsx` to pass file size from `availableFiles` to `LogTable`

## [0.1.1] - 2025-01-28

### Added

#### Log Viewer Improvements
- **Automatic log loading**: Logs are now automatically loaded when a file is selected, eliminating the need to click "Refresh"
  - Automatic loading triggered when `selectedFilePath` or `selectedLogType` changes
  - Seamless user experience with immediate log display
- **Custom regex editor**: New modal for editing custom regex patterns for log files
  - `RegexEditorModal` component with full regex editing capabilities
  - Display of default regex pattern (if available) for the selected log type
  - Real-time regex testing with sample log lines
  - Visual feedback showing capture groups and matches
  - Validation of regex syntax before saving
- **Regex editor button in header**: Quick access to regex editor from the log viewer header
  - Button with `Code` icon next to the file selector
  - Only visible when a log file is selected
  - Opens the regex editor modal for the current file
- **Backend API for custom regex**: New API endpoints for managing custom regex patterns
  - `GET /api/log-viewer/plugins/:pluginId/default-regex` - Get default regex for a log type
  - `GET /api/log-viewer/plugins/:pluginId/regex-config` - Get custom regex for a file
  - `PUT /api/log-viewer/plugins/:pluginId/regex-config` - Save custom regex for a file
  - Custom regexes stored in plugin configuration via `PluginConfigRepository`
- **Custom regex display in plugin settings**: List of custom regexes in plugin configuration modal
  - New "Regex personnalisées" section in `PluginConfigModal`
  - Displays all custom regexes with file path, log type, modification date, and full regex pattern
  - Available for all log source plugins (host-system, nginx, apache, npm)
  - Helpful message explaining how to configure regexes from the log viewer

### Changed

- **Log file selection behavior**: File selection now automatically triggers log loading
  - Removed manual "Refresh" requirement after file selection
  - Improved user experience with immediate feedback
- **Header component**: Enhanced with regex editor button
  - Added `Code` icon button for regex editing
  - Integrated `RegexEditorModal` component
  - Conditional rendering based on file selection

### Technical Details

- **Frontend**:
  - New `RegexEditorModal.tsx` component with regex editing and testing
  - Updated `Header.tsx` with regex editor button and modal integration
  - Updated `LogViewerPage.tsx` with automatic log loading on file selection
  - Updated `PluginConfigModal.tsx` with custom regex display section
- **Backend**:
  - New routes in `log-viewer.ts` for regex management
  - Integration with `PluginConfigRepository` for persistent storage
  - Default regex patterns for common log types (NPM, Nginx, Apache, Host System)

## [0.1.0] - 2024-01-15

### Added

#### User Management
- **Automatic default admin user creation**: On first application startup, a default admin user is automatically created
  - Default username: `admin`
  - Default password: `admin123`
  - Default email: `admin@localhost`
  - Default role: `admin`
  - Credentials can be customized via environment variables:
    - `DEFAULT_ADMIN_USERNAME`
    - `DEFAULT_ADMIN_PASSWORD`
    - `DEFAULT_ADMIN_EMAIL`
- **JWT-based authentication system**: Secure user authentication using JSON Web Tokens
  - Token stored in browser localStorage
  - Automatic token validation on application startup
  - Automatic reconnection if valid token exists
  - Configurable token expiration (default: 7 days)
- **User login modal**: Automatic display of login modal when user is not authenticated
- **Password security**: Passwords are hashed using bcrypt (10 rounds)
- **Brute force protection**: Account lockout after multiple failed login attempts
- **User roles**: Support for three roles (`admin`, `user`, `viewer`)
- **User management**: Full CRUD operations for user accounts
  - User registration
  - User login/logout
  - User profile management
  - Password change functionality
  - User enable/disable
  - Role management

#### Log Source Plugin System
- **Plugin architecture**: New plugin system for log sources
  - `LogSourcePlugin` interface for implementing log source plugins
  - Support for multiple log source types (Apache, Nginx, NPM, Host System)
  - Plugin registration and management system
- **Host System Log Plugin**: Default plugin for reading system logs
  - Automatic detection of Docker environment
  - Reads logs from `/host/logs` in Docker or `/var/log` locally
  - Support for multiple log types:
    - Syslog
    - Auth logs
    - Kernel logs
    - Daemon logs
    - Mail logs
    - Custom logs
- **Log file scanning**: Automatic detection and scanning of log files
  - Pattern-based file matching
  - Support for rotated log files
  - Compressed file support (gzip)
- **Log parsing**: Specialized parsers for different log formats
  - Syslog parser
  - Nginx access/error log parser
  - Apache access/error log parser
  - NPM log parser
  - Auth log parser
  - Kernel log parser
  - Daemon log parser
  - Mail log parser
  - Custom log parser
- **Log reading service**: Efficient log file reading with streaming support
  - Configurable line limits
  - Support for reading from specific line numbers
  - Handling of large log files
- **Log parser service**: Coordinates log reading and parsing using registered plugins
  - Dynamic column detection based on log type
  - Parsed log entry structure
- **WebSocket streaming**: Real-time log streaming via WebSocket
  - `/ws/log-viewer` WebSocket endpoint
  - Real-time log updates
  - Automatic reconnection on disconnect
  - Follow mode for live log monitoring
- **REST API routes**: Complete API for log viewer functionality
  - `GET /api/log-viewer/plugins/:pluginId/files` - List available log files
  - `POST /api/log-viewer/plugins/:pluginId/scan` - Scan for log files
  - `GET /api/log-viewer/files/:fileId/logs` - Read logs from a file
  - `POST /api/log-viewer/plugins/:pluginId/read-direct` - Read logs directly (bypass DB)
  - `GET /api/log-viewer/plugins/:pluginId/files-direct` - List files directly (bypass DB)
  - `GET /api/log-viewer/sources` - List log sources
  - `POST /api/log-viewer/sources` - Create log source
  - `GET /api/log-viewer/sources/:id` - Get log source
  - `PUT /api/log-viewer/sources/:id` - Update log source
  - `DELETE /api/log-viewer/sources/:id` - Delete log source
  - `GET /api/log-viewer/files` - List log files
  - `PUT /api/log-viewer/files/:id` - Update log file
  - `DELETE /api/log-viewer/files/:id` - Delete log file
- **Database models**: New database models for log management
  - `LogSource` model for managing log sources
  - `LogFile` model for managing individual log files
  - Database tables with proper indexes

#### Frontend Log Viewer
- **LogViewerPage**: Complete log viewer page component
  - Plugin selection
  - File selection
  - Log display with dynamic columns
  - Real-time log streaming support
- **LogTable component**: Structured table for displaying logs
  - Dynamic columns based on log type
  - Colored badges for log levels, HTTP codes, methods
  - Responsive design with horizontal scrolling on mobile
- **LogBadge component**: Colored badges for log entries
  - Level badges (INFO, WARN, ERROR, DEBUG, etc.)
  - HTTP code badges (2xx, 3xx, 4xx, 5xx)
  - HTTP method badges (GET, POST, DELETE, etc.)
  - Response time badges
- **LogFilters component**: Advanced filtering system
  - Text search with debounce (300ms)
  - Level filtering
  - HTTP code filtering
  - HTTP method filtering
  - Date range filtering
  - IP source filtering
  - Active filter count badge
  - Reset filters button
  - Responsive modal on mobile
- **WebSocket hook**: React hook for WebSocket connection
  - `useLogViewerWebSocket` hook
  - Automatic connection management
  - Automatic reconnection on disconnect
  - Subscribe/unsubscribe to log files
  - Real-time log updates
- **Log viewer store**: Zustand store for log viewer state management
  - Selected plugin and file state
  - Log entries state
  - Filter state
  - WebSocket connection state
  - Loading and error states
- **Dashboard integration**: Button in dashboard to navigate to log viewer
- **TypeScript types**: Complete type definitions for log viewer
  - `LogEntry` interface
  - `LogFilters` interface
  - `LogFileInfo` interface

### Changed

- **Project name**: Changed from "MyNetwork" to "LogviewR"
- **Project version**: Set to `0.1.0`
- **Removed Freebox/UniFi/Scanner**: All Freebox, UniFi, and network scanner code has been removed
  - Freebox API routes removed
  - Freebox services removed
  - UniFi plugin removed
  - Network scanner plugin removed
  - Freebox-specific WebSocket removed
  - Freebox-specific configuration removed

### Removed

- Freebox API integration
- UniFi plugin
- Network scanner plugin
- Freebox WebSocket service
- Latency monitoring system
- All Freebox-specific routes and services

### Security

- JWT-based authentication
- Password hashing with bcrypt
- Brute force protection
- Token expiration management
- Secure token storage

### Technical Details

- **Backend**: Node.js with Express.js
- **Frontend**: React with TypeScript
- **Database**: SQLite with WAL mode
- **WebSocket**: ws library for real-time communication
- **Authentication**: JWT tokens
- **Password hashing**: bcrypt

---

## Future Plans

### Planned Features

- **Additional log source plugins**:
  - Apache log plugin (in progress)
  - Nginx log plugin (in progress)
  - NPM log plugin (in progress)
- **Dashboard page**: Summary dashboard with plugin statistics
- **Export functionality**: Export logs in multiple formats (CSV, JSON, TXT, Excel, PDF)
- **Advanced filtering**: Server-side filtering for better performance
- **Log statistics**: Statistics and analytics for log sources
- **Plugin icon buttons**: Footer integration with plugin icons
- **Clock component**: Real-time clock in header
- **Header improvements**: Adaptive header with file selector

---

[0.1.0]: https://github.com/Erreur32/LogviewR/releases/tag/v0.1.0
