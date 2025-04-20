<?php
require_once __DIR__ . '/BaseParser.php';

/**
 * BaseNPMParser - Base class for all NPM log parsers
 * 
 * This class extends BaseParser and adds NPM-specific functionality
 * and formatting methods.
 */
class BaseNPMParser extends BaseParser {
    protected $currentType = 'access';
    protected $patterns = [];
    protected $columns = [];
    protected $debug = false;
    protected $excludedIps = [];
    protected $excludedRequests = [];
    protected $excludedUserAgents = [];
    protected $excludedUsers = [];
    protected $excludedReferers = [];
    protected $excludedContent = [];
    protected $filtersEnabled = true;

    /**
     * Constructor
     */
    public function __construct() {
        parent::__construct();
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        $this->debug = $config['debug']['enabled'] ?? false;
        
        // Load patterns and columns from configuration
        $this->patterns = require __DIR__ . '/../config/log_patterns.php';
        
        // Load exclusion filters
        if (isset($this->patterns['filters']['exclude'])) {
            $this->excludedIps = $this->patterns['filters']['exclude']['ips'] ?? [];
            $this->excludedRequests = $this->patterns['filters']['exclude']['requests'] ?? [];
            $this->excludedUserAgents = $this->patterns['filters']['exclude']['user_agents'] ?? [];
            $this->excludedUsers = $this->patterns['filters']['exclude']['users'] ?? [];
            $this->excludedReferers = $this->patterns['filters']['exclude']['referers'] ?? [];
            $this->excludedContent = $this->patterns['filters']['exclude']['content'] ?? [];
        }
    }

    /**
     * Enable or disable filters
     * 
     * @param bool $enabled Whether filters should be enabled
     */
    public function setFiltersEnabled($enabled) {
        $this->filtersEnabled = $enabled;
    }

    /**
     * Set the current log type (access or error)
     * 
     * @param string $type Log type
     */
    public function setType($type) {
        $this->currentType = $type;
        // Update columns based on type
        $this->columns = $this->patterns['npm-' . $this->getType()]['columns'] ?? $this->columns;
    }

    /**
     * Format a method badge
     * 
     * @param string $method HTTP method
     * @return string Formatted badge
     */
    protected function formatMethodBadge($method) {
        $method = strtoupper($method);
        return sprintf(
            '<span class="npm-badge method-%s">%s</span>',
            strtolower($method),
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
        return sprintf(
            '<span class="npm-badge protocol-%s">%s</span>',
            strtolower($protocol),
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
        return sprintf(
            '<span class="npm-badge host">%s</span>',
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
        return sprintf(
            '<span class="npm-badge ip">%s</span>',
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

    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        // Get the appropriate pattern based on current type
        $pattern = $this->patterns[$this->getType()]['pattern'];
        
        // Try to match the line with our pattern
        if (!preg_match($pattern, $line, $matches)) {
            return null;
        }

        return $this->currentType === 'access' 
            ? $this->parseAccessLog($matches)
            : $this->parseErrorLog($matches, $line);
    }

    protected function parseAccessLog($matches) {
        // Format date
        $date = $this->formatDate($matches[1]);

        // Format status codes
        $statusIn = isset($matches[2]) ? $this->formatStatusCode($matches[2]) : '-';
        $statusOut = isset($matches[3]) ? $this->formatStatusCode($matches[3]) : '-';

        // Format method and protocol
        $method = $this->formatMethodBadge($matches[4] ?? '-');
        $protocol = $this->formatProtocolBadge($matches[5] ?? '-');

        // Format host and request
        $host = $this->formatHostBadge($matches[6] ?? '-');
        $request = $this->formatRequestBadge($matches[7] ?? '-', $matches[8] ?? '-');

        // Format client IP
        $clientIp = $this->formatIpBadge($matches[9] ?? '-');

        // Format length and gzip
        $length = $this->formatSize($matches[10] ?? '0');
        $gzip = $this->formatGzipBadge($matches[11] ?? '-');

        // Format sent-to
        $sentTo = isset($matches[12]) ? $this->formatIpBadge($matches[12]) : '-';

        // Format user agent and referer
        $userAgent = isset($matches[13]) ? $this->formatUserAgentBadge($matches[13]) : '-';
        $referer = isset($matches[14]) ? $this->formatRefererBadge($matches[14]) : '-';

        return [
            'date' => $date,
            'status_in' => $statusIn,
            'status_out' => $statusOut,
            'method' => $method,
            'protocol' => $protocol,
            'host' => $host,
            'request' => $request,
            'client_ip' => $clientIp,
            'length' => $length,
            'gzip' => $gzip,
            'sent_to' => $sentTo,
            'user_agent' => $userAgent,
            'referer' => $referer
        ];
    }

    protected function parseErrorLog($matches, $line) {
        // Format date
        $date = parent::formatDate($matches[1]);

        // Format error level
        $level = $this->formatErrorLevel($matches[2] ?? '-');

        // Format process ID
        $pid = isset($matches[3]) ? $this->formatPid($matches[3]) : '-';

        // Format connection ID
        $connection = isset($matches[4]) ? $this->formatTid($matches[4]) : '-';

        // Format message
        $message = htmlspecialchars($matches[5] ?? '-');

        // Format client and server
        $client = isset($matches[6]) ? parent::formatIpBadge($matches[6]) : '-';
        $server = isset($matches[7]) ? parent::formatIpBadge($matches[7]) : '-';

        // Format request and host
        $request = isset($matches[8]) ? sprintf(
            '<span class="npm-badge request">%s</span>',
            htmlspecialchars($matches[8])
        ) : '-';
        $host = isset($matches[9]) ? parent::formatHostBadge($matches[9]) : '-';

        return [
            'date' => $date,
            'level' => $level,
            'process' => $pid,
            'connection' => $connection,
            'message' => $message,
            'client' => $client,
            'server' => $server,
            'request' => $request,
            'host' => $host
        ];
    }
} 