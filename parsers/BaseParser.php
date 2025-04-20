<?php
abstract class BaseParser {
    protected $columns = [];
    protected $config;
    protected $filters = [];
    protected $filtersEnabled = true;
    protected $filteredCount = 0;
    protected $filteredBy = [];
    protected $debug = false;
    
    public function __construct() {
        // Load configuration
        $this->config = require __DIR__ . '/../config/config.php';
        
        // Load filters from configuration
        $patterns = require __DIR__ . '/../config/log_patterns.php';
        $this->filters = $patterns['filters']['exclude'] ?? [];
        
        // Set timezone from config
        $timezone = $this->config['timezone'] ?? 'Europe/Paris';
        if (in_array($timezone, timezone_identifiers_list())) {
            date_default_timezone_set($timezone);
        }
    }
    
    /**
     * Enable or disable filters
     */
    public function setFiltersEnabled($enabled) {
        $this->filtersEnabled = $enabled;
    }

    /**
     * Get filtered statistics
     */
    public function getFilteredStats() {
        return [
            'count' => $this->filteredCount,
            'by' => $this->filteredBy
        ];
    }

    /**
     * Check if a line should be filtered based on configuration
     */
    protected function shouldFilter($components) {
        if (!$this->filtersEnabled) {
            return false;
        }

        // Check IP filters
        if (!empty($this->filters['ips']) && isset($components['ip'])) {
            foreach ($this->filters['ips'] as $pattern) {
                if (preg_match($pattern, $components['ip'])) {
                    $this->filteredCount++;
                    $this->filteredBy['ip'][] = $components['ip'];
                    return true;
                }
            }
        }

        // Check user filters
        if (!empty($this->filters['users']) && isset($components['user'])) {
            foreach ($this->filters['users'] as $pattern) {
                if (preg_match($pattern, $components['user'])) {
                    $this->filteredCount++;
                    $this->filteredBy['user'][] = $components['user'];
                    return true;
                }
            }
        }

        // Check request filters
        if (!empty($this->filters['requests']) && isset($components['request'])) {
            foreach ($this->filters['requests'] as $pattern) {
                if (preg_match($pattern, $components['request'])) {
                    $this->filteredCount++;
                    $this->filteredBy['request'][] = $components['request'];
                    return true;
                }
            }
        }

        // Check user agent filters
        if (!empty($this->filters['user_agents']) && isset($components['user_agent'])) {
            foreach ($this->filters['user_agents'] as $pattern) {
                if (preg_match($pattern, $components['user_agent'])) {
                    $this->filteredCount++;
                    $this->filteredBy['user_agent'][] = $components['user_agent'];
                    return true;
                }
            }
        }

        // Check referer filters
        if (!empty($this->filters['referers']) && isset($components['referer'])) {
            foreach ($this->filters['referers'] as $pattern) {
                if (preg_match($pattern, $components['referer'])) {
                    $this->filteredCount++;
                    $this->filteredBy['referer'][] = $components['referer'];
                    return true;
                }
            }
        }

        return false;
    }
    
    /**
     * Parse a log line
     * @param string $line The line to parse
     * @param string $type The log type (access, error, etc.)
     * @return array|null The parsed data or null if the line is invalid
     */
    abstract public function parse($line, $type = 'access');
    
    /**
     * Returns the column definition
     * @param string $type The log type
     * @return array The column definition
     */
    public function getColumns($type = 'access') {
        return $this->columns[$type] ?? [];
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
            
            // Get the log file path from config
            $config = require __DIR__ . '/../config/config.php';
            $logFile = $config['debug']['log_file'];
            
            // Ensure the directory exists
            $logDir = dirname($logFile);
            if (!is_dir($logDir)) {
                mkdir($logDir, 0755, true);
            }
            
            // Write to the log file
            $timestamp = date('Y-m-d H:i:s');
            $logEntry = "[$timestamp] $logMessage" . PHP_EOL;
            file_put_contents($logFile, $logEntry, FILE_APPEND);
            
            // Also write to Apache logs if enabled
            if ($config['debug']['log_to_apache']) {
                error_log($logMessage);
            }
        }
    }
} 