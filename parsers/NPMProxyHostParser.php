<?php
require_once __DIR__ . '/BaseNPMParser.php';

/**
 * NPMProxyHostParser - Parser for NPM proxy host logs
 * 
 * This parser handles both access and error logs for NPM proxy hosts.
 */
class NPMProxyHostParser extends BaseNPMParser {
    protected $pattern;
    protected $currentType = 'access';
    protected $patterns;

    /**
     * Constructor
     */
    public function __construct() {
        parent::__construct();
        
        // Initialize columns for access logs by default
        $this->columns = $this->patterns['npm']['proxy_host_access']['columns'] ?? [];
    }

    /**
     * Set the type of log being parsed
     * 
     * @param string $type Type of log (access or error)
     */
    public function setType($type) {
        $this->currentType = $type;
        $patternKey = 'proxy_host_' . $type;
        
        if ($this->debug) {
            $this->debugLog("Setting type", [
                'type' => $type,
                'pattern_key' => $patternKey
            ]);
        }

        // Update columns based on type
        $this->getColumns($type);
    }

    /**
     * Get the type prefix for this parser
     */
    public function getType() {
        return 'proxy_host_' . $this->currentType;
    }

    /**
     * Get columns configuration
     * 
     * @param string $type Type of log (access or error)
     * @return array Columns configuration
     */
    public function getColumns($type = 'access') {
        $this->currentType = $type;
        $patternKey = 'proxy_host_' . $type;
        
        if (isset($this->patterns['npm'][$patternKey]['columns'])) {
            $this->columns = $this->patterns['npm'][$patternKey]['columns'];
            if ($this->debug) {
                $this->debugLog("Columns loaded for type", [
                    'type' => $type,
                    'pattern_key' => $patternKey,
                    'columns' => $this->columns
                ]);
            }
            return $this->columns;
        }
        
        if ($this->debug) {
            $this->debugLog("No columns found for type", [
                'type' => $type,
                'pattern_key' => $patternKey,
                'available_patterns' => array_keys($this->patterns['npm'])
            ]);
        }
        return [];
    }

    /**
     * Parse a line from the log file
     */
    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        $this->currentType = $type;
        $patternKey = 'proxy_host_' . $type;
        
        $this->debugLog("Parsing line", [
            'line' => $line,
            'type' => $type,
            'pattern_key' => $patternKey
        ]);

        // Get the appropriate pattern based on current type
        if (!isset($this->patterns['npm'][$patternKey]['pattern'])) {
            $this->debugLog("Pattern not found", [
                'type' => $type,
                'pattern_key' => $patternKey,
                'available_patterns' => array_keys($this->patterns['npm'])
            ]);
            return null;
        }

        // Update columns for current type BEFORE parsing
        $this->getColumns($type);

        $pattern = $this->patterns['npm'][$patternKey]['pattern'];
        
        // Try to match the line with our pattern
        if (!preg_match($pattern, $line, $matches)) {
            $this->debugLog("Line does not match pattern", [
                'line' => $line,
                'pattern' => $pattern
            ]);
            return null;
        }

        $this->debugLog("Matches found", [
            'matches' => $matches,
            'columns' => $this->columns
        ]);

        return $type === 'access' 
            ? $this->parseAccessLog($matches)
            : $this->parseErrorLog($matches, $line);
    }

    /**
     * Parse an access log line
     */
    protected function parseAccessLog($matches) {
        if (!is_array($matches) || count($matches) < 16) {
            $this->debugLog("Invalid matches array for access log", [
                'matches' => $matches,
                'count' => count($matches)
            ]);
            return null;
        }

        // Format date
        $date = $this->formatDate($matches[1] ?? '-');

        // Format status codes
        $statusIn = $this->formatStatusCode($matches[4] ?? '-');

        // Format method and protocol
        $method = $this->formatMethodBadge($matches[6] ?? '-');
        $protocol = $this->formatProtocolBadge($matches[7] ?? '-');

        // Format host and request
        $host = $this->formatHostBadge($matches[8] ?? '-');
        $request = $this->formatRequestBadge($matches[6] ?? '-', $matches[9] ?? '-');

        // Format client IP (remove brackets from [Client X.X.X.X])
        $clientIp = $matches[10] ?? '-';
        $clientIp = preg_replace('/^\[Client\s+|\]$/', '', $clientIp);

        // Format length and gzip
        $length = $matches[11] ?? '-';
        $gzip = $matches[12] ?? '-';

        // Format sent-to
        $sentTo = $matches[13] ?? '-';
        $sentTo = preg_replace('/^\[Sent-to\s+|\]$/', '', $sentTo);

        // Format user agent and referer
        $userAgent = $matches[14] ?? '-';
        $referer = $matches[15] ?? '-';

        return [
            'date' => $date,
            'identity' => '-',
            'user' => '-',
            'status' => $statusIn,
            'status_in' => '-',
            'method' => $method,
            'protocol' => $protocol,
            'host' => $host,
            'request' => $request,
            'client_ip' => $this->formatIpBadge($clientIp),
            'length' => $this->formatSize($length),
            'gzip' => $this->formatGzipBadge($gzip),
            'sent_to' => $this->formatIpBadge($sentTo),
            'user_agent' => $this->formatUserAgentBadge($userAgent),
            'referer' => $this->formatRefererBadge($referer)
        ];
    }

    /**
     * Parse an error log line
     */
    protected function parseErrorLog($matches, $line) {
        if (!is_array($matches) || count($matches) < 10) {
            $this->debugLog("Invalid matches array for error log", [
                'matches' => $matches,
                'line' => $line,
                'count' => count($matches)
            ]);
            return null;
        }

        // Format date
        $date = $this->formatDate($matches[1] ?? '-');

        // Format error level
        $level = $this->formatErrorLevel($matches[2] ?? '-');

        // Format PID#TID
        $pid = isset($matches[3]) ? sprintf(
            '<span class="npm-badge process">PID:%s</span>',
            htmlspecialchars($matches[3])
        ) : '-';

        $tid = isset($matches[4]) ? sprintf(
            '<span class="npm-badge thread">TID:%s</span>',
            htmlspecialchars($matches[4])
        ) : '-';

        // Format connection ID
        $connection = isset($matches[5]) ? sprintf(
            '<span class="npm-badge connection">#%s</span>',
            htmlspecialchars($matches[5])
        ) : '-';

        // Format message
        $message = htmlspecialchars($matches[6] ?? '-');

        // Format client IP
        $client = isset($matches[7]) ? $this->formatIpBadge($matches[7]) : '-';

        // Format server
        $server = isset($matches[8]) ? sprintf(
            '<span class="npm-badge server">%s</span>',
            htmlspecialchars($matches[8])
        ) : '-';

        // Format request
        $request = isset($matches[9]) ? $this->formatRequestBadge('GET', $matches[9]) : '-';

        // Format host
        $host = isset($matches[10]) ? $this->formatHostBadge($matches[10]) : '-';

        return [
            'date' => $date,
            'level' => $level,
            'pid' => $pid,
            'tid' => $tid,
            'connection' => $connection,
            'message' => $message,
            'client' => $client,
            'server' => $server,
            'request' => $request,
            'host' => $host
        ];
    }
} 