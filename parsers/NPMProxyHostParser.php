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
        $this->columns = $this->patterns['npm-proxy-host-access']['columns'];
    }

    /**
     * Get the type prefix for this parser
     */
    public function getType() {
        return 'npm-proxy-host-' . $this->currentType;
    }

    /**
     * Get columns configuration
     * 
     * @param string $type Type of log (access or error)
     * @return array Columns configuration
     */
    public function getColumns($type = 'access') {
        $this->currentType = $type; // Update current type
        return $this->patterns['npm-proxy-host-' . $type]['columns'] ?? [];
    }

    /**
     * Parse a line from the log file
     */
    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        $this->debugLog("Parsing line", ['line' => $line]);

        // Get the appropriate pattern based on current type
        $pattern = $this->patterns['npm-proxy-host-' . $this->currentType]['pattern'];
        
        // Try to match the line with our pattern
        if (!preg_match($pattern, $line, $matches)) {
            $this->debugLog("Line does not match pattern", [
                'line' => $line,
                'pattern' => $pattern
            ]);
            return null;
        }

        $this->debugLog("Matches found", ['matches' => $matches]);

        return $this->currentType === 'access' 
            ? $this->parseAccessLog($matches)
            : $this->parseErrorLog($matches, $line);
    }

    /**
     * Parse an access log line
     */
    protected function parseAccessLog($matches) {
        // Séparer la requête en méthode et chemin
        $request = $matches[7];
        $requestParts = explode(' ', trim($request), 2);
        $requestMethod = $requestParts[0] ?? '';
        $requestPath = $requestParts[1] ?? '';

        // Extraire l'IP client du format [Client IP]
        $clientIp = $matches[8] ?? '-';
        $clientIp = trim($clientIp); // Nettoyer les espaces

        return [
            'date' => $this->formatDate($matches[1]),
            'status_in' => $this->formatStatusCode($matches[2]),
            'status_out' => $this->formatStatusCode($matches[3]),
            'method' => $this->formatMethodBadge($matches[4]),
            'protocol' => $this->formatProtocolBadge($matches[5]),
            'host' => $this->formatHostBadge($matches[6]),
            'request' => $this->formatRequestBadge($requestMethod, $requestPath),
            'client_ip' => $this->formatIpBadge($clientIp), // Utilisation de l'IP nettoyée
            'length' => $this->formatSize($matches[9]),
            'gzip' => $this->formatGzipBadge($matches[10]),
            'sent_to' => $this->formatIpBadge($matches[11]),
            'user_agent' => $this->formatUserAgentBadge($matches[12]),
            'referer' => $this->formatRefererBadge($matches[13])
        ];
    }

    /**
     * Parse an error log line
     */
    protected function parseErrorLog($matches, $line) {
        // Format each field with appropriate badges
        $date = $this->formatDate($matches[1]);
        $level = $this->formatErrorLevel($matches[2]);
        $pid = $this->formatPid($matches[3] . '#' . $matches[4]);
        $connection = isset($matches[5]) ? '*' . $matches[5] : '-';
        $message = htmlspecialchars($matches[6] ?? '-');
        
        // Optional fields
        $client = isset($matches[7]) && $matches[7] !== '' ? $this->formatIpBadge($matches[7]) : '-';
        $server = isset($matches[8]) && $matches[8] !== '' ? $this->formatHostBadge($matches[8]) : '-';
        $request = isset($matches[9]) && $matches[9] !== '' ? $this->formatRequestBadge($matches[9], '') : '-';
        $upstream = isset($matches[10]) && $matches[10] !== '' ? $this->formatHostBadge($matches[10]) : '-';
        $host = isset($matches[11]) && $matches[11] !== '' ? $this->formatHostBadge($matches[11]) : '-';
        $referer = isset($matches[12]) && $matches[12] !== '' ? $this->formatRefererBadge($matches[12]) : '-';

        $this->debugLog("Parsed error log", [
            'date' => $date,
            'level' => $level,
            'pid' => $pid,
            'connection' => $connection,
            'message' => $message,
            'client' => $client,
            'server' => $server,
            'request' => $request,
            'upstream' => $upstream,
            'host' => $host,
            'referer' => $referer
        ]);

        return [
            'date' => $date,
            'level' => $level,
            'pid' => $pid,
            'connection' => $connection,
            'message' => $message,
            'client' => $client,
            'server' => $server,
            'request' => $request,
            'upstream' => $upstream,
            'host' => $host,
            'referer' => $referer
        ];
    }
} 