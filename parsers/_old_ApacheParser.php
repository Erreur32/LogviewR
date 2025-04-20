<?php
require_once __DIR__ . '/BaseParser.php';

class ApacheParser extends BaseParser {
    private $accessLogPattern = '/^(\S+)(?::(\d+))?\s+(\S+)\s+(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+"([^"]*)"\s+(\d{3})\s+(\d+|\-)(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?/';
    private $errorLogPattern = '/^\[(.*?)\]\s*\[php:(error|notice|warning|debug)\]\s*\[pid\s+(\d+):tid\s+(\d+)\]\s*\[client\s+(\S+)\]\s*(.*)$/';
    private $debug = false;

    // Exclusion patterns configuration
    private $excludePatterns = [];
    private $patterns;

    // HTTP codes configuration
    private $httpCodes = [
        'success' => [200, 201, 204],
        'redirect' => [301, 302, 303, 307, 308],
        'client_error' => [400, 401, 403, 404, 405],
        'server_error' => [500, 501, 502, 503, 504]
    ];

    public function __construct($debug = false) {
        $this->debug = $debug;
        // Load patterns from configuration
        $patterns_file = __DIR__ . '/../config/log_patterns.php';
        
        if (file_exists($patterns_file)) {
            $this->patterns = require $patterns_file;
            
            // Initialiser les patterns d'exclusion depuis la configuration
            if (isset($this->patterns['filters']['exclude'])) {
                $this->excludePatterns = $this->patterns['filters']['exclude'];
                $this->debugLog("Exclusion filters loaded", ['patterns' => $this->excludePatterns]);
            } else {
                $this->debugLog("No exclusion filters found in configuration");
            }
        } else {
            $this->debugLog("Patterns file not found: $patterns_file");
            $this->patterns = [];
            $this->excludePatterns = [];
        }
        
        $this->columns = [
            'access' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'host' => ['name' => 'Host', 'class' => 'column-host'],
                'ip' => ['name' => 'IP', 'class' => 'column-ip'],
                'user' => ['name' => 'User', 'class' => 'column-user'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'status' => ['name' => 'Code', 'class' => 'column-status'],
                'size' => ['name' => 'Size', 'class' => 'column-size'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
                'user_agent' => ['name' => 'User-Agent', 'class' => 'column-useragent']
            ],
            'error' => [
                'message' => ['name' => 'Message', 'class' => 'column-message']
            ]
        ];
    }

    private function debugLog($message, $data = []) {
        if ($this->debug) {
            parent::debugLog($message, $data);
        }
    }

    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        // Automatically detect log type if not specified
        if ($type === 'access') {
            // If the line starts with [ and contains [php:error] or [php:notice], it's an error log
            if (preg_match('/^\[.*?\]\s*\[php:(error|notice|warning|debug)\]/', $line)) {
                $type = 'error';
            }
        }

        $this->debugLog("Log type detected", ['type' => $type, 'line' => $line]);
        return $type === 'access' ? $this->parseAccessLog($line) : $this->parseErrorLog($line);
    }

    private function parseAccessLog($line) {
        $this->debugLog("Analyzing line", ['line' => $line]);

        if (!preg_match($this->accessLogPattern, $line, $matches)) {
            $this->debugLog("Pattern does not match");
            return null;
        }

        // Extract components for filters
        $host = $matches[1] ?? '-';
        $ip = $matches[3] ?? '-';
        $user = $matches[4] ?? '-';
        $request = $matches[7] ?? '-';
        $userAgent = $matches[11] ?? '-';

        // Format badges with default values if necessary
        $hostHash = $host !== '-' ? substr(md5($host), 0, 1) : '0';
        $ipHash = $ip !== '-' ? substr(md5($ip), 0, 1) : '0';
        $userHash = $user !== '-' ? substr(md5($user), 0, 1) : '0';

        // Format host with or without port
        $port = isset($matches[2]) && $matches[2] ? ':' . $matches[2] : '';
        $hostDisplay = $host !== '-' ? rtrim($host . $port, ':') : '-';

        // Prepare formatted request
        $requestParts = explode(' ', $request);
        $method = $requestParts[0] ?? '-';
        $path = $requestParts[1] ?? '-';
        $protocol = $requestParts[2] ?? '-';

        // Apply exclusion filters before HTML formatting
        $filtered = false;
        $filterReason = '';

        // IP filter
        if (isset($this->excludePatterns['ips'])) {
            foreach ($this->excludePatterns['ips'] as $pattern) {
                $cleanIp = trim(preg_replace('/:\d+$/', '', $ip));
                $cleanPattern = str_replace('\\\\', '\\', trim($pattern, '/'));
                if (@preg_match('/' . $cleanPattern . '/', $cleanIp)) {
                    $filtered = true;
                    $filterReason = 'IP excluded: ' . $cleanIp;
                    break;
                }
            }
        }

        // Request filter
        if (!$filtered && isset($this->excludePatterns['requests'])) {
            foreach ($this->excludePatterns['requests'] as $pattern) {
                $cleanPattern = str_replace('\\\\', '\\', trim($pattern, '/'));
                if (@preg_match('/' . $cleanPattern . '/', $path)) {
                    $filtered = true;
                    $filterReason = 'Request excluded: ' . $path;
                    break;
                }
            }
        }

        // User-agent filter
        if (!$filtered && isset($this->excludePatterns['user_agents'])) {
            foreach ($this->excludePatterns['user_agents'] as $pattern) {
                $cleanPattern = str_replace('\\\\', '\\', trim($pattern, '/'));
                if (@preg_match('/' . $cleanPattern . '/', $userAgent)) {
                    $filtered = true;
                    $filterReason = 'User-Agent excluded: ' . $userAgent;
                    break;
                }
            }
        }

        // User filter (only if user is not '-')
        if (!$filtered && isset($this->excludePatterns['users']) && $user !== '-') {
            foreach ($this->excludePatterns['users'] as $pattern) {
                $cleanPattern = str_replace('\\\\', '\\', trim($pattern, '/'));
                if (@preg_match('/' . $cleanPattern . '/', $user)) {
                    $filtered = true;
                    $filterReason = 'User excluded: ' . $user;
                    break;
                }
            }
        }

        // Prepare formatted result
        $result = [
            'date' => $this->formatDate($matches[6]),
            'host' => sprintf(
                '<span class="log-badge host%s" data-host-hash="%s">%s</span>',
                $host === '-' ? ' host-empty' : '',
                $hostHash,
                htmlspecialchars($hostDisplay)
            ),
            'ip' => sprintf(
                '<span class="log-badge ip%s" data-ip-hash="%s">%s</span>',
                $ip === '-' ? ' ip-empty' : '',
                $ipHash,
                htmlspecialchars($ip)
            ),
            'user' => sprintf(
                '<span class="log-badge user%s" data-user="%s" data-user-hash="%s">%s</span>',
                $user === '-' ? ' user-empty' : '',
                $this->getUserClass($user),
                $userHash,
                htmlspecialchars($user)
            ),
            'request' => sprintf(
                '<div class="apache-request-container"><span class="apache-badge method %s">%s</span>&nbsp;&nbsp;<span class="path">%s</span></div>',
                strtolower($method),
                htmlspecialchars($method),
                htmlspecialchars($path)
            ),
            'status' => $this->formatStatusBadge($matches[8]),
            'size' => $this->formatSize($matches[9]),
            'referer' => htmlspecialchars($matches[10] ?? '-'),
            'user_agent' => htmlspecialchars($userAgent)
        ];

        if ($filtered) {
            $result['filtered'] = true;
            $result['reason'] = $filterReason;
        }

        return $result;
    }

    private function parseRequest($requestStr) {
        if (!preg_match('/^(\S+)\s+(\S+)(?:\s+(\S+))?$/', $requestStr, $parts)) {
            return null;
        }

        $method = $parts[1] ?? '-';
        $url = $parts[2] ?? '-';
        $protocol = $parts[3] ?? '-';

        return sprintf(
            '<div class="apache-request-container"><span class="apache-badge method %s">%s</span><span class="path">%s</span></div>',
            strtolower($method),
            htmlspecialchars($method),
            htmlspecialchars($url)
        );
    }

    private function parseErrorLog($line) {
        // For error logs, we simply return the raw message
        return [
            'message' => htmlspecialchars($line)
        ];
    }

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

    private function getUserClass($user) {
        $specialUsers = [
            'root' => 'root',
            'admin' => 'admin',
            'www-data' => 'www-data',
            '-' => 'anonymous',
            'erreur32' => 'erreur32'
        ];
        
        return $specialUsers[$user] ?? 'user';
    }

    private function getStatusClass($status) {
        $status = intval($status);
        
        foreach ($this->httpCodes as $type => $codes) {
            if (in_array($status, $codes)) {
                return $type;
            }
        }
        
        return 'unknown';
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

    public function getColumns($subtype = 'access') {
        return $this->columns[$subtype] ?? [];
    }

    public function getType() {
        return 'apache';
    }
} 