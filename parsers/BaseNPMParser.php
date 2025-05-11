<?php
require_once __DIR__ . '/BaseParser.php';

/**
 * BaseNPMParser - Base class for all NPM log parsers
 * 
 * This class extends BaseParser and adds NPM-specific functionality
 * and formatting methods.
 */
abstract class BaseNPMParser extends BaseParser {
    protected $pattern;
    protected $debug = false;

    public function __construct() {
        parent::__construct();
        
        // Initialize columns configuration
        $this->columns = [
            'date' => $this->defaultColumnConfig['date'],
            'host' => [
                'name' => 'Host',
                'class' => 'column-host',
                'width' => '120px',
                'align' => 'left',
                'sortable' => true,
                'searchable' => true,
                'visible' => true
            ],
            'message' => [
                'name' => 'Message',
                'class' => 'column-message',
                'width' => 'auto',
                'align' => 'left',
                'sortable' => true,
                'searchable' => true,
                'visible' => true
            ]
        ];
    }

    /**
     * Parse a line of log
     * @param string $line The line to parse
     * @return array|null The parsed data or null if parsing failed
     */
    public function parse($line) {
        if (preg_match($this->getPattern(), $line, $matches)) {
            return [
                'date' => $this->parseDate($matches[1]),
                'host' => $matches[2],
                'message' => $matches[3]
            ];
        }
        return null;
    }

    /**
     * Get the pattern used by this parser
     * @return string The pattern
     */
    abstract public function getPattern();

    /**
     * Parse the date from the log line
     * @param string $date The date string from the log
     * @return string The formatted date
     */
    protected function parseDate($date) {
        return date('Y-m-d H:i:s', strtotime($date));
    }

    /**
     * Check if a log entry should be filtered
     * @param array $data The log data to check
     * @return bool True if the entry should be filtered
     */
    protected function shouldFilter($data) {
        // Si les filtres sont désactivés, ne pas filtrer
        if (!isset($this->config['filters']['enabled']) || !$this->config['filters']['enabled']) {
            if ($this->debug) {
                error_log("[DEBUG] Filters are disabled");
            }
            return false;
        }

        // Charger les filtres depuis config.user.php
        $config_file = file_exists(__DIR__ . '/../config/config.user.php')
            ? __DIR__ . '/../config/config.user.php'
            : __DIR__ . '/../config/config.php';
        $config = require $config_file;

        if (!isset($config['filters']['exclude'])) {
            if ($this->debug) {
                error_log("[DEBUG] No filters found in configuration");
            }
            return false;
        }

        $filters = $config['filters']['exclude'];
        $rawData = $data['raw'] ?? [];

        // Vérifier les filtres IP
        if (isset($filters['ips']) && !empty($filters['ips'])) {
            foreach ($filters['ips'] as $pattern) {
                if (isset($rawData['ip']) && preg_match($pattern, $rawData['ip'])) {
                    if ($this->debug) {
                        error_log("[DEBUG] IP filter match: " . $rawData['ip'] . " matches pattern: " . $pattern);
                    }
                    return true;
                }
            }
        }

        // Vérifier les filtres de requêtes
        if (isset($filters['requests']) && !empty($filters['requests'])) {
            foreach ($filters['requests'] as $pattern) {
                if (isset($rawData['request']) && preg_match($pattern, $rawData['request'])) {
                    if ($this->debug) {
                        error_log("[DEBUG] Request filter match: " . $rawData['request'] . " matches pattern: " . $pattern);
                    }
                    return true;
                }
            }
        }

        // Vérifier les filtres user-agent
        if (isset($filters['user_agents']) && !empty($filters['user_agents'])) {
            foreach ($filters['user_agents'] as $pattern) {
                if (isset($rawData['user_agent']) && preg_match($pattern, $rawData['user_agent'])) {
                    if ($this->debug) {
                        error_log("[DEBUG] User-Agent filter match: " . $rawData['user_agent'] . " matches pattern: " . $pattern);
                    }
                    return true;
                }
            }
        }

        if ($this->debug) {
            error_log("[DEBUG] No filter matches found for data: " . json_encode($rawData));
        }
        return false;
    }

    /**
     * Format a method badge
     * 
     * @param string $method HTTP method
     * @return string Formatted badge
     */
    protected function formatMethodBadge($method) {
        if (empty($method) || $method === '-') {
            return '<span class="method-badge empty">-</span>';
        }

        $method = strtoupper($method);
        $methodColors = [
            'GET' => '#4CAF50',
            'POST' => '#2196F3',
            'PUT' => '#FF9800',
            'DELETE' => '#F44336',
            'HEAD' => '#9C27B0',
            'OPTIONS' => '#607D8B',
            'PATCH' => '#795548',
            'CONNECT' => '#9E9E9E',
            'TRACE' => '#795548'
        ];

        $color = $methodColors[$method] ?? '#9E9E9E';

        return sprintf(
            '<span class="method-badge" style="background-color: %s" title="%s">%s</span>',
            $color,
            htmlspecialchars($method),
            htmlspecialchars($method)
        );
    }

    /**
     * Format a protocol badge
     * 
     * @param string $protocol Protocol
     * @return string Formatted badge
     */
    protected function formatProtocolBadge($protocol) {
        if (empty($protocol) || $protocol === '-') {
            return '<span class="protocol-badge empty">-</span>';
        }

        $protocolColors = [
            'HTTP/1.0' => '#FF9800',
            'HTTP/1.1' => '#4CAF50',
            'HTTP/2' => '#2196F3',
            'HTTP/3' => '#9C27B0',
            'HTTPS' => '#4CAF50',
            'HTTP' => '#FF9800'
        ];

        $color = $protocolColors[$protocol] ?? '#9E9E9E';

        return sprintf(
            '<span class="protocol-badge" style="background-color: %s" title="%s">%s</span>',
            $color,
            htmlspecialchars($protocol),
            htmlspecialchars($protocol)
        );
    }

    /**
     * Format a Gzip badge
     * 
     * @param string $gzip Gzip status
     * @return string Formatted badge
     */
    protected function formatGzipBadge($gzip) {
        $class = $gzip === '-' ? 'disabled' : 'enabled';
        return sprintf(
            '<span class="npm-badge gzip-%s">%s</span>',
            $class,
            htmlspecialchars($gzip)
        );
    }

    /**
     * Format a request badge
     * 
     * @param string $method HTTP method
     * @param string $path Request path
     * @return string Formatted badge
     */
    protected function formatRequestBadge($method, $path) {
        return sprintf(
            '<span class="npm-request">%s %s</span>',
            htmlspecialchars($method),
            htmlspecialchars($path)
        );
    }

    /**
     * Format a host badge
     * 
     * @param string $host Host name
     * @return string Formatted badge
     */
    protected function formatHostBadge($host) {
        if (empty($host) || $host === '-') {
            return '<span class="host-badge empty">-</span>';
        }

        // Générer une couleur unique basée sur le nom d'hôte
        $color = substr(md5($host), 0, 6);
        
        // Détecter si c'est un localhost ou une IP
        $isLocalhost = (strpos($host, 'localhost') !== false || $host === '127.0.0.1');
        $isIP = filter_var($host, FILTER_VALIDATE_IP) !== false;
        
        $class = $isLocalhost ? ' localhost' : ($isIP ? ' ip' : '');

        return sprintf(
            '<span class="host-badge%s" style="background-color: #%s" title="%s">%s</span>',
            $class,
            $color,
            htmlspecialchars($host),
            htmlspecialchars($host)
        );
    }

    /**
     * Format an IP badge
     * 
     * @param string $ip IP address
     * @return string Formatted badge
     */
    protected function formatIpBadge($ip) {
        if (empty($ip) || $ip === '-') {
            return '<span class="ip-badge empty">-</span>';
        }

        // Générer une couleur unique basée sur l'IP
        $color = substr(md5($ip), 0, 6);
        
        // Déterminer si c'est un bot connu
        $isBot = false;
        $knownBots = [
            '/^66\.249\./' => 'Google',
            '/^157\.55\./' => 'Bing',
            '/^40\.77\./' => 'Bing',
            '/^17\.58\./' => 'Apple',
            '/^131\.253\./' => 'Bing',
            '/^199\.59\./' => 'Twitter',
            '/^54\.174\./' => 'Amazon'
        ];

        foreach ($knownBots as $pattern => $botName) {
            if (preg_match($pattern, $ip)) {
                $isBot = true;
                break;
            }
        }

        return sprintf(
            '<span class="ip-badge%s" style="background-color: #%s" title="%s">%s</span>',
            $isBot ? ' bot' : '',
            $color,
            htmlspecialchars($ip),
            htmlspecialchars($ip)
        );
    }

    /**
     * Format a user agent badge
     * 
     * @param string|null $userAgent User agent
     * @return string Formatted badge
     */
    protected function formatUserAgentBadge($userAgent) {
        if ($userAgent === null) {
            return '<span class="npm-badge user-agent">-</span>';
        }
        return sprintf(
            '<span class="npm-badge user-agent">%s</span>',
            htmlspecialchars($userAgent)
        );
    }

    /**
     * Format a referer badge
     * 
     * @param string $referer Referer
     * @return string Formatted badge
     */
    protected function formatRefererBadge($referer) {
        return sprintf(
            '<span class="npm-badge referer">%s</span>',
            htmlspecialchars($referer)
        );
    }

    /**
     * Format an error level badge
     * 
     * @param string $level Error level
     * @return string Formatted badge
     */
    protected function formatErrorLevel($level) {
        $level = strtoupper($level);
        return sprintf(
            '<span class="npm-badge level-%s">%s</span>',
            strtolower($level),
            htmlspecialchars($level)
        );
    }

    /**
     * Format a status code badge
     * 
     * @param string $code HTTP status code
     * @return string Formatted badge
     */
    protected function formatStatusCode($code) {
        $code = trim($code);
        if (empty($code) || $code === '-') {
            return '-';
        }

        // Determine badge class based on status code
        $class = 'status-other';
        if ($code >= 200 && $code < 300) {
            $class = 'status-success';
        } elseif ($code >= 300 && $code < 400) {
            $class = 'status-redirect';
        } elseif ($code >= 400 && $code < 500) {
            $class = 'status-client-error';
        } elseif ($code >= 500) {
            $class = 'status-server-error';
        }

        return sprintf(
            '<span class="npm-badge %s">%s</span>',
            $class,
            htmlspecialchars($code)
        );
    }

    /**
     * Format a process ID badge
     * 
     * @param string $pid Process ID
     * @return string Formatted badge
     */
    protected function formatPid($pid) {
        return sprintf(
            '<span class="npm-badge process">PID:%s</span>',
            htmlspecialchars($pid)
        );
    }

    /**
     * Format a thread ID badge
     * 
     * @param string $tid Thread ID
     * @return string Formatted badge
     */
    protected function formatTid($tid) {
        return sprintf(
            '<span class="npm-badge thread">TID:%s</span>',
            htmlspecialchars($tid)
        );
    }

    /**
     * Debug log
     * 
     * @param string $message Debug message
     * @param array $data Additional data
     */
    protected function debugLog($message, $data = []) {
        if ($this->debug) {
            parent::debugLog($message, $data);
        }
    }
} 