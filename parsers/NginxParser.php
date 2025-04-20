<?php
require_once __DIR__ . '/BaseParser.php';

class NginxParser extends BaseParser {
    private $accessLogPattern;
    private $errorLogPattern;
    protected $debug = false;

    // Configuration of exclusion patterns
    private $excludePatterns = [];
    private $patterns;

    // HTTP codes configuration
    private $httpCodes = [
        'success' => [200, 201, 204],
        'redirect' => [301, 302, 303, 307, 308],
        'client_error' => [400, 401, 403, 404, 405],
        'server_error' => [500, 501, 502, 503, 504]
    ];

    // Error levels configuration
    private $errorLevels = [
        'emerg' => ['class' => 'error', 'priority' => 0],
        'alert' => ['class' => 'error', 'priority' => 1],
        'crit' => ['class' => 'error', 'priority' => 2],
        'error' => ['class' => 'error', 'priority' => 3],
        'warn' => ['class' => 'warning', 'priority' => 4],
        'notice' => ['class' => 'notice', 'priority' => 5],
        'info' => ['class' => 'info', 'priority' => 6],
        'debug' => ['class' => 'debug', 'priority' => 7]
    ];

    public function __construct() {
        parent::__construct();
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        $this->debug = $config['debug']['enabled'] ?? false;
        
        // Load patterns from configuration
        $patterns = require __DIR__ . '/../config/log_patterns.php';
        $this->accessLogPattern = $patterns['nginx']['access']['pattern'];
        $this->errorLogPattern = $patterns['nginx']['error']['pattern'];
        $this->columns = $patterns['nginx']['access']['columns'];
        
        if ($this->debug) {
            $this->debugLog("=== NginxParser initialized ===");
            $this->debugLog("Access Pattern: " . $this->accessLogPattern);
            $this->debugLog("Error Pattern: " . $this->errorLogPattern);
            $this->debugLog("Columns: " . print_r($this->columns, true));
        }
        
        // Initialize exclusion patterns from configuration
        if (isset($patterns['filters']['exclude'])) {
            $this->excludePatterns = $patterns['filters']['exclude'];
            $this->debugLog("Exclusion filters loaded", ['patterns' => $this->excludePatterns]);
        } else {
            $this->debugLog("No exclusion filters found in configuration");
        }
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

        $this->debugLog("Analyzing line", ['line' => $line, 'type' => $type]);

        return $type === 'access' ? $this->parseAccessLog($line) : $this->parseErrorLog($line);
    }

    private function parseAccessLog($line) {
        if (!preg_match($this->accessLogPattern, $line, $matches)) {
            return null;
        }

        // Extract components for filters
        $ip = $matches[1];
        $request = $matches[4];
        $userAgent = $matches[8] ?? '-';

        $this->debugLog("Extracted components", [
            'ip' => $ip,
            'request' => $request,
            'userAgent' => $userAgent
        ]);

        // Apply exclusion filters
        if (isset($this->excludePatterns['ips'])) {
            $this->debugLog("Available IP filters", ['patterns' => $this->excludePatterns['ips']]);
            foreach ($this->excludePatterns['ips'] as $pattern) {
                $this->debugLog("Testing IP pattern", ['pattern' => $pattern, 'ip' => $ip]);
                // Clean IP from potential ports
                $cleanIp = preg_replace('/:\d+$/', '', $ip);
                if (preg_match($pattern, $cleanIp)) {
                    $this->debugLog("IP excluded", ['pattern' => $pattern, 'ip' => $cleanIp]);
                    return ['filtered' => true, 'reason' => 'IP excluded: ' . $cleanIp];
                }
            }
        } else {
            $this->debugLog("No IP filters found");
        }

        if (isset($this->excludePatterns['requests'])) {
            $this->debugLog("Available request filters", ['patterns' => $this->excludePatterns['requests']]);
            foreach ($this->excludePatterns['requests'] as $pattern) {
                if (preg_match($pattern, $request)) {
                    $this->debugLog("Request excluded", ['pattern' => $pattern, 'request' => $request]);
                    return ['filtered' => true, 'reason' => 'Request excluded: ' . $request];
                }
            }
        } else {
            $this->debugLog("No request filters found");
        }

        if (isset($this->excludePatterns['user_agents'])) {
            $this->debugLog("Available user-agent filters", ['patterns' => $this->excludePatterns['user_agents']]);
            foreach ($this->excludePatterns['user_agents'] as $pattern) {
                if (preg_match($pattern, $userAgent)) {
                    $this->debugLog("User-Agent excluded", ['pattern' => $pattern, 'user_agent' => $userAgent]);
                    return ['filtered' => true, 'reason' => 'User-Agent excluded: ' . $userAgent];
                }
            }
        } else {
            $this->debugLog("No user-agent filters found");
        }

        return [
            'ip' => parent::formatIpBadge($ip),
            'date' => $this->formatDate($matches[2]),
            'request' => $this->parseRequest($request),
            'status' => $this->formatStatusBadge($matches[5]),
            'size' => $this->formatSize($matches[6]),
            'referer' => htmlspecialchars($matches[7] ?? '-'),
            'user_agent' => htmlspecialchars($userAgent)
        ];
    }

    private function parseErrorLog($line) {
        if (!preg_match($this->errorLogPattern, $line, $matches)) {
            $this->debugLog("Pattern error ne correspond pas");
            return null;
        }

        $level = strtolower($matches[2]);
        $levelInfo = $this->errorLevels[$level] ?? ['class' => 'info', 'priority' => 6];

        return [
            'date' => $this->formatDate($matches[1]),
            'level' => sprintf(
                '<span class="nginx-badge level %s">%s</span>',
                $levelInfo['class'],
                strtoupper($level)
            ),
            'pid' => sprintf(
                '<span class="log-badge pid">%s</span>',
                htmlspecialchars($matches[3])
            ),
            'tid' => sprintf(
                '<span class="log-badge tid">%s</span>',
                htmlspecialchars($matches[4])
            ),
            'cid' => sprintf(
                '<span class="log-badge cid">%s</span>',
                htmlspecialchars($matches[5])
            ),
            'message' => sprintf(
                '<span class="log-badge message %s" data-priority="%d">%s</span>',
                $levelInfo['class'],
                $levelInfo['priority'],
                htmlspecialchars($matches[6])
            )
        ];
    }

    private function parseRequest($requestStr) {
        if (!preg_match('/^(\S+)\s+(\S+)(?:\s+(\S+))?$/', $requestStr, $parts)) {
            return null;
        }

        $method = $parts[1] ?? '-';
        $url = $parts[2] ?? '-';
        $protocol = $parts[3] ?? '-';

        return [
            'method' => $method,
            'url' => $url,
            'protocol' => $protocol,
            'html' => sprintf(
                '<div class="nginx-request-container"><span class="nginx-badge method %s">%s</span><span class="path">%s</span></div>',
                strtolower($method),
                htmlspecialchars($method),
                htmlspecialchars($url)
            )
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

    private function getStatusClass($status) {
        $status = intval($status);
        
        foreach ($this->httpCodes as $type => $codes) {
            if (in_array($status, $codes)) {
                return $type;
            }
        }
        
        return 'unknown';
    }

    private function formatStatusBadge($status) {
        $status = intval($status);
        
        foreach ($this->httpCodes as $type => $codes) {
            if (in_array($status, $codes)) {
                return sprintf(
                    '<span class="nginx-badge status %s">%s</span>',
                    $type,
                    $status
                );
            }
        }
        
        return sprintf(
            '<span class="nginx-badge status unknown">%s</span>',
            $status
        );
    }

    public function getLogsByCategory($directory) {
        $all_logs = [];
        if (is_dir($directory)) {
            $items = scandir($directory);
            foreach ($items as $item) {
                if ($item === '.' || $item === '..') continue;
                
                // Exclure les fichiers de position de logs
                if (strpos($item, '_last_pos') !== false) continue;
                
                $path = $directory . '/' . $item;
                if (is_file($path)) {
                    $all_logs[] = $path;
                }
            }
        }

        $default_host_logs = [];
        $dead_host_logs = [];
        $proxy_host_logs = [];
        $fallback_logs = [];
        $other_logs = [];

        foreach ($all_logs as $log) {
            $basename = basename($log);
            
            // Ignorer les fichiers vides
            if (filesize($log) === 0) continue;
            
            // Ignorer les extensions exclues
            $extension = pathinfo($log, PATHINFO_EXTENSION);
            if (in_array($extension, ['gz', 'zip', 'bz2', 'old', 'bak'])) continue;
            
            // Ignorer les fichiers de rotation numérotés sauf .1
            if (preg_match('/\.log\.[2-9]$/', $basename)) continue;
            
            // Catégoriser les logs
            if (strpos($basename, 'default-host') !== false) {
                $default_host_logs[] = $log;
            } elseif (strpos($basename, 'dead-host') !== false) {
                $dead_host_logs[] = $log;
            } elseif (strpos($basename, 'proxy-host') !== false) {
                $proxy_host_logs[] = $log;
            } elseif (strpos($basename, 'fallback') !== false) {
                $fallback_logs[] = $log;
            } else {
                $other_logs[] = $log;
            }
        }

        // Trier les logs dans chaque catégorie
        sort($default_host_logs);
        sort($dead_host_logs);
        sort($proxy_host_logs);
        sort($fallback_logs);
        sort($other_logs);

        return [
            'default' => $default_host_logs,
            'dead' => $dead_host_logs,
            'proxy' => $proxy_host_logs,
            'fallback' => $fallback_logs,
            'other' => $other_logs
        ];
    }
} 