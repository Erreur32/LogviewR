<?php
require_once __DIR__ . '/ApacheParser.php';

class Apache404Parser extends ApacheParser {
    private $accessLogPattern = '/^(\S+)(?::(\d+))? (\S+) (\S+) (\S+) \[([^\]]+)\] "(.*?)" (\d{3}) (\d+) "([^"]*)" "([^"]*)"$/';
    private $debugMode = true;

    public function parse($line, $type = 'access') {
        $line = trim($line);
        if (empty($line)) {
            return null;
        }

        if ($this->debugMode) {
            error_log("=== Début du parsing 404 ===");
            error_log("Ligne à parser: " . $line);
        }

        $result = $this->parseAccessLog($line);
        
        if ($result === null && $this->debugMode) {
            error_log("Échec du parsing de la ligne 404");
        } else if ($this->debugMode) {
            error_log("Parsing 404 réussi");
            error_log(print_r($result, true));
        }
        
        return $result;
    }

    private function parseAccessLog($line) {
        if (!preg_match($this->accessLogPattern, $line, $matches)) {
            if ($this->debugMode) {
                error_log("Pattern ne correspond pas à la ligne");
                error_log("Pattern: " . $this->accessLogPattern);
                error_log("Ligne: " . $line);
            }
            return null;
        }

        // Extraire la méthode HTTP et l'URL de la requête
        $request = $matches[7];
        preg_match('/^(\S+)\s+(\S+)\s+(\S+)?$/', $request, $requestParts);
        $method = $requestParts[1] ?? '-';
        $url = $requestParts[2] ?? '-';
        $protocol = $requestParts[3] ?? '-';

        // Formater la requête avec des badges HTML
        $formattedRequest = sprintf(
            '<div class="request-container"><span class="badge method %s">%s</span><span class="path">%s</span></div>',
            strtolower($method),
            htmlspecialchars($method),
            htmlspecialchars($url)
        );

        // Formater l'utilisateur avec un badge
        $user = $matches[5];
        $userClass = $this->getUserClass($user);
        $formattedUser = sprintf(
            '<span class="apache-badge user" data-user="%s">%s</span>',
            htmlspecialchars($userClass),
            htmlspecialchars($user)
        );

        // Formater le code status avec un badge (toujours 404)
        $formattedStatus = '<span class="badge status warning">404</span>';

        // Formater la taille
        $size = $matches[9];
        $formattedSize = $this->formatSize($size);

        // Formater le hostname avec le port si présent
        $hostname = isset($matches[2]) ? sprintf('%s:%s', $matches[1], $matches[2]) : $matches[1];
        $formattedHost = sprintf(
            '<span class="host-badge" data-host-hash="%d">%s</span>',
            abs(crc32($matches[1]) % 10),
            htmlspecialchars($hostname)
        );

        // Formater l'IP
        $ip = $matches[3];
        $formattedIp = sprintf(
            '<span class="ip-badge%s" data-ip-hash="%d">%s</span>',
            $ip === '-' ? ' ip-empty' : '',
            $ip !== '-' ? abs(crc32($ip) % 10) : 0,
            htmlspecialchars($ip)
        );

        return [
            'date' => $this->formatDate($matches[6]),
            'host' => $formattedHost,
            'ip' => $formattedIp,
            'user' => $formattedUser,
            'request' => $formattedRequest,
            'status' => $formattedStatus,
            'size' => $formattedSize,
            'referer' => htmlspecialchars($matches[10]),
            'user_agent' => htmlspecialchars($matches[11])
        ];
    }

    public function getColumns($type = 'access') {
        return [
            'date' => 'Date',
            'host' => 'Host',
            'ip' => 'IP',
            'user' => 'Utilisateur',
            'request' => 'Requête',
            'status' => 'Status',
            'size' => 'Taille',
            'referer' => 'Referer',
            'user_agent' => 'User-Agent'
        ];
    }
} 