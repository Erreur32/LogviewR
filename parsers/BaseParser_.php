<?php
abstract class BaseParser {
    protected $columns = [];
    protected $config;
    protected $debug = false;
    protected $filtersEnabled = false;
    protected static $filterPatterns = null; // Cache for filter patterns
    protected $parserType = ''; // To be set by child classes

    /**
     * Base configuration for common columns
     */
    protected $defaultColumnConfig = [
        'date' => [
            'name' => 'Date',
            'class' => 'column-date',
            'width' => '150px',
            'align' => 'center',
            'sortable' => true,
            'searchable' => true,
            'visible' => true,
            'render_type' => 'date'
        ],
        'ip' => [
            'name' => 'IP',
            'class' => 'column-ip',
            'width' => '120px',
            'align' => 'center',
            'sortable' => true,
            'searchable' => true,
            'visible' => true,
            'render_type' => 'ip_badge'
        ],
        'level' => [
            'name' => 'Level',
            'class' => 'column-level',
            'width' => '100px',
            'align' => 'center',
            'sortable' => true,
            'searchable' => true,
            'visible' => true,
            'render_type' => 'level_badge'
        ],
        'message' => [
            'name' => 'Message',
            'class' => 'column-message',
            'width' => 'auto',
            'align' => 'left',
            'sortable' => true,
            'searchable' => true,
            'visible' => true,
            'render_type' => 'text',
            'truncate' => 100
        ],
        'referer' => [
            'name' => 'Referer',
            'class' => 'column-referer',
            'width' => '180px',
            'align' => 'left',
            'sortable' => true,
            'searchable' => true,
            'visible' => true,
            'render_type' => 'referer_badge',
            'truncate' => 50
        ],
        'user_agent' => [
            'name' => 'User-Agent',
            'class' => 'column-user-agent',
            'width' => '200px',
            'align' => 'left',
            'sortable' => true,
            'searchable' => true,
            'visible' => true,
            'render_type' => 'text',
            'truncate' => 50
        ]
    ];
    
    /**
     * Base configuration for filter management
     */
    protected $filtersConfig = null;

    /**
     * Constructor with filter patterns caching
     */
    public function __construct() {
        // Load configuration
        $config_file = __DIR__ . '/../config/config.php';
        $this->config = require $config_file;
        $this->debug = isset($this->config['debug']['enabled']) && $this->config['debug']['enabled'];
        
        // Initialize filters configuration
        $this->initializeFilters();
        
        // Set timezone from config
        $timezone = $this->config['timezone'] ?? 'Europe/Paris';
        date_default_timezone_set($timezone);
    }
    
    /**
     * Initialize filters configuration
     */
    protected function initializeFilters() {
        // Load user configuration first
        $user_config_file = __DIR__ . '/../config/config.user.php';
        $default_config_file = __DIR__ . '/../config/config.php';
        
        // Load the appropriate configuration file
        $config = file_exists($user_config_file) ? require $user_config_file : require $default_config_file;
        
        // Check if filters are enabled in config
        $this->filtersEnabled = isset($config['filters']['enabled']) && $config['filters']['enabled'] === true;
        
        if ($this->debug) {
            $this->debugLog("Filters initialization", [
                'enabled' => $this->filtersEnabled,
                'config_file' => file_exists($user_config_file) ? 'config.user.php' : 'config.php'
            ]);
        }
        
        // Load filter patterns if enabled
        if ($this->filtersEnabled) {
            // Get filters directly from config
            if (isset($config['filters']['exclude'])) {
                $this->filtersConfig = $config['filters']['exclude'];
                if ($this->debug) {
                    $this->debugLog("Filter patterns loaded from config", [
                        'patterns_count' => count($this->filtersConfig)
                    ]);
                }
            } else {
                if ($this->debug) {
                    $this->debugLog("No filter patterns found in config");
                }
            }
        }
    }
    
    /**
     * Get the columns configuration for this parser
     * This method can be overridden by child classes if needed
     * @param string $type Optional log type parameter
     * @return array The columns configuration
     */
    public function getColumns($type = null) {
        return $this->columns;
    }
    
    /**
     * Format a date in HTML
     * @param string $dateStr The date to format
     * @return string The formatted date in HTML
     */
    protected function formatDate($dateStr) {
        // Extract timezone offset if present [18/Apr/2025:12:40:58 +0200]
        $timezone_offset = '';
        if (preg_match('/([+-]\d{4})/', $dateStr, $matches)) {
            $timezone_offset = $matches[1];
            // Remove timezone from date string to avoid confusion
            $dateStr = str_replace($timezone_offset, '', $dateStr);
        }
        
        // If the date doesn't contain a year, add the current year
        if (!preg_match('/\d{4}/', $dateStr)) {
            $dateStr .= ' ' . date('Y');
        }
        
        // Parse the date, considering timezone offset
        $timestamp = strtotime($dateStr . ' ' . $timezone_offset);
        if ($timestamp === false) {
            // If the conversion fails, try an alternative format
            $timestamp = strtotime(str_replace('  ', ' ', $dateStr . ' ' . $timezone_offset));
        }
        
        if ($timestamp === false) {
            // If all fails, use the current date
            $timestamp = time();
        }
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        $dateFormat = $config['date_formats']['display'] ?? 'd/m/Y H:i:s';
        
        // Convert timestamp to configured timezone
        $timezone = new DateTimeZone($config['timezone'] ?? 'Europe/Paris');
        $date = new DateTime('@' . $timestamp);
        $date->setTimezone($timezone);
        
        $formattedDate = $date->format($dateFormat);
        
        return sprintf(
            '<span class="date-badge" data-hour="%d">%s</span>',
            $date->format('G'),
            $formattedDate
        );
    }
    
    /**
     * Format a size in HTML
     * @param string|int $size The size to format
     * @return string The formatted size in HTML
     */
    protected function formatSize($size) {
        if ($size == '-' || $size == '0') {
            return '<span class="log-badge size"><span class="number">-</span></span>';
        }
        
        $units = ['B', 'KB', 'MB', 'GB'];
        $size = intval($size);
        $i = 0;
        while ($size >= 1024 && $i < count($units) - 1) {
            $size /= 1024;
            $i++;
        }
        return sprintf(
            '<span class="log-badge size"><span class="number">%.1f</span><span class="unit">%s</span></span>',
            $size,
            $units[$i]
        );
    }

    protected function formatStatusBadge($status) {
        $statusClass = '';
        if ($status >= 500) {
            $statusClass = 'server_error';
        } elseif ($status >= 400) {
            $statusClass = 'client_error';
        } elseif ($status >= 300) {
            $statusClass = 'redirect';
        } elseif ($status >= 200) {
            $statusClass = 'success';
        } elseif ($status >= 100) {
            $statusClass = 'info';
        }

        return sprintf(
            '<span class="status-badge status-%s" data-status="%d">%d</span>',
            $statusClass,
            $status,
            $status
        );
    }

    protected function formatHostBadge($host) {
        // Generate a consistent color hash based on the host
        $hostHash = $host !== '-' ? substr(md5($host), 0, 1) : '0';
        
        return sprintf(
            '<span class="log-badge host%s" data-host-hash="%s" data-host="%s">%s</span>',
            $host === '-' ? ' host-empty' : '',
            $hostHash,
            htmlspecialchars($host, ENT_QUOTES),
            htmlspecialchars($host)
        );
    }

    protected function formatIpBadge($ip) {
        // Generate a consistent color hash based on the IP
        $ipHash = $ip !== '-' ? substr(md5($ip), 0, 1) : '0';
        
        $badge = sprintf(
            '<span class="log-badge ip%s" data-ip-hash="%s" data-ip="%s">%s</span>',
            $ip === '-' ? ' ip-empty' : '',
            $ipHash,
            htmlspecialchars($ip, ENT_QUOTES),
            htmlspecialchars($ip)
        );

        return $badge;
    }

    protected function formatUserBadge($user) {
        $userHash = $user !== '-' ? substr(md5($user), 0, 1) : '0';
        
        return sprintf(
            '<span class="log-badge user%s" data-user="%s" data-user-hash="%s">%s</span>',
            $user === '-' ? ' user-empty' : '',
            $this->getUserClass($user),
            $userHash,
            htmlspecialchars($user)
        );
    }

    protected function formatRequestBadge($method, $path) {
        return sprintf(
            '<div class="apache-request-container"><span class="apache-badge method %s">%s</span>&nbsp;&nbsp;<span class="path">%s</span></div>',
            strtolower($method),
            htmlspecialchars($method),
            htmlspecialchars($path)
        );
    }

    protected function getUserClass($user) {
        $specialUsers = [
            'root' => 'root',
            'admin' => 'admin',
            'www-data' => 'www-data',
            '-' => 'anonymous',
            'erreur32' => 'erreur32'
        ];
        
        return $specialUsers[$user] ?? 'user';
    }

    protected function formatRefererBadge($referer) {
        if ($referer === '-' || empty($referer)) {
            return '<span class="log-badge referer empty">-</span>';
        }

        if (filter_var($referer, FILTER_VALIDATE_URL)) {
            $parsedUrl = parse_url($referer);
            $displayUrl = $parsedUrl['host'] . (isset($parsedUrl['path']) ? $parsedUrl['path'] : '');
            return sprintf(
                '<a href="%s" class="log-badge referer" target="_blank" rel="noopener noreferrer">%s</a>',
                htmlspecialchars($referer),
                htmlspecialchars($displayUrl)
            );
        }

        return sprintf('<span class="log-badge referer">%s</span>', htmlspecialchars($referer));
    }

    protected function formatUserAgentBadge($userAgent) {
        if ($userAgent === '-' || empty($userAgent)) {
            return '<span class="log-badge user-agent empty">-</span>';
        }

        $isBot = preg_match('/(bot|crawler|spider|googlebot|bingbot|yahoo|duckduckbot)/i', $userAgent);
        $shortUserAgent = strlen($userAgent) > 50 ? substr($userAgent, 0, 50) . '...' : $userAgent;
        
        return sprintf(
            '<span class="log-badge user-agent%s" title="%s">%s</span>',
            $isBot ? ' bot' : '',
            htmlspecialchars($userAgent),
            htmlspecialchars($shortUserAgent)
        );
    }

    /**
     * Log a debug message if debug is enabled
     * @param string $message The message to log
     * @param array $data Additional data to log
     */
    protected function debugLog($message, $data = []) {
        if ($this->debug) {
            $class = get_class($this);
            $logMessage = "[DEBUG] $class: $message";
            if (!empty($data)) {
                $logMessage .= " - " . json_encode($data);
            }
            
            try {
                // Get the log file path from config with fallback
                $config = require __DIR__ . '/../config/config.php';
                $logFile = $config['debug']['log_file'] ?? __DIR__ . '/../logs/debug.log';
                
                // Ensure the log file path is valid
                if (empty($logFile)) {
                    $logFile = __DIR__ . '/../logs/debug.log';
                }
                
                // Ensure the directory exists
                $logDir = dirname($logFile);
                if (!is_dir($logDir)) {
                    if (!mkdir($logDir, 0755, true)) {
                        throw new Exception("Failed to create log directory: $logDir");
                    }
                }
                
                // Write to the log file
                $timestamp = date('Y-m-d H:i:s');
                $logEntry = "[$timestamp] $logMessage" . PHP_EOL;
                if (file_put_contents($logFile, $logEntry, FILE_APPEND) === false) {
                    throw new Exception("Failed to write to log file: $logFile");
                }
                
                // Also write to Apache logs if enabled
                if ($config['debug']['log_to_apache'] ?? false) {
                    error_log($logMessage);
                }
            } catch (Exception $e) {
                // Fallback to error_log if file logging fails
                error_log("Logging error: " . $e->getMessage());
                error_log($logMessage);
            }
        }
    }

    /**
     * Get the complete columns configuration for JavaScript
     * @return array The complete columns configuration
     */
    public function getColumnsConfig() {
        $config = [];
        foreach ($this->columns as $key => $column) {
            // Merge with default config if it exists
            $defaultConfig = $this->defaultColumnConfig[$key] ?? [];
            $config[$key] = array_merge($defaultConfig, $column);
        }
        return $config;
    }

    /**
     * Parse a single line of log
     * This method must be implemented by child classes
     * @param string $line The line to parse
     * @return array|null The parsed data or null if parsing failed
     */
    abstract public function parse($line);

    /**
     * Get the pattern used by this parser
     * This method must be implemented by child classes
     * @return string The pattern
     */
    abstract public function getPattern();

    /**
     * Check if a log line should be filtered based on exclusion patterns
     * @param array $data The parsed log data
     * @return bool True if the line should be filtered
     */
    protected function shouldFilter($data) {
        // If filters are disabled, don't filter anything
        if (!$this->filtersEnabled) {
            return false;
        }

        // Load filters from configuration
        $config = require __DIR__ . '/../config/config.user.php';
        $filters = $config['filters']['exclude'] ?? [];

        // Check IP filters
        if (!empty($filters['ips']) && isset($data['ip'])) {
            $ip = strip_tags($data['ip']);
            foreach ($filters['ips'] as $pattern) {
                if (preg_match($pattern, $ip)) {
                    if ($this->debug) {
                        error_log(sprintf(
                            "[DEBUG] IP filter match: IP=%s, Pattern=%s",
                            $ip,
                            $pattern
                        ));
                    }
                    return true;
                }
            }
        }

        return false;
    }
} 