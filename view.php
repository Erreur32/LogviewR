<?php
require_once 'config/config.php';
require_once 'parsers/ApacheParser.php';
require_once 'parsers/NginxParser.php';
require_once 'parsers/SyslogParser.php';
require_once 'parsers/NginxProxyManagerParser.php';

// Récupération des paramètres
$logType = $_GET['type'] ?? 'apache_access';
$logFile = $_GET['file'] ?? '';
$filter = $_GET['filter'] ?? '';
$level = $_GET['level'] ?? '';

// Vérification de la sécurité du chemin
$logFile = realpath($logFile);
if (!$logFile || strpos($logFile, LOGS_DIR) !== 0) {
    die(json_encode(['success' => false, 'error' => 'Accès non autorisé']));
}

// Initialisation du parser approprié
$parser = null;
switch ($logType) {
    case 'apache_access':
        $parser = new ApacheParser(true); // Activer le mode debug
        break;
    case 'apache_error':
        $parser = new ApacheParser(true); // Activer le mode debug
        break;
    case 'nginx_access':
        $parser = new NginxParser(true); // Activer le mode debug
        break;
    case 'nginx_error':
        $parser = new NginxParser(true); // Activer le mode debug
        break;
    case 'npm_access':
        $parser = new NginxProxyManagerParser(true);
        break;
    case 'npm_error':
        $parser = new NginxProxyManagerParser(true);
        break;
    case 'syslog':
        $parser = new SyslogParser();
        break;
    default:
        die(json_encode(['success' => false, 'error' => 'Type de log non supporté']));
}

// Lecture et parsing des logs
$logs = [];
$filteredCount = 0;
if (file_exists($logFile)) {
    $handle = fopen($logFile, 'r');
    if ($handle) {
        $lineCount = 0;
        while (($line = fgets($handle)) !== false && $lineCount < MAX_LINES) {
            $parsedLine = $parser->parse($line);
            if ($parsedLine) {
                // Application des filtres
                if ($logType === 'syslog') {
                    // Pour les logs système, on filtre uniquement par niveau
                    if ($level && isset($parsedLine['level']) && $parsedLine['level'] !== $level) {
                        continue;
                    }
                } else {
                    // Pour les autres types de logs (Apache, Nginx)
                    if (isset($parsedLine['filtered']) && $parsedLine['filtered'] === true) {
                        $filteredCount++;
                        error_log("Ligne filtrée: " . json_encode($parsedLine));
                        continue;
                    }
                    
                    // Appliquer les filtres supplémentaires si nécessaire
                    if ($filter && !preg_match('/' . preg_quote($filter, '/') . '/i', $line)) {
                        continue;
                    }
                    if ($level && isset($parsedLine['level']) && $parsedLine['level'] !== $level) {
                        continue;
                    }
                }
                $logs[] = $parsedLine;
                $lineCount++;
            }
        }
        fclose($handle);
    }
}

// Affichage des logs
header('Content-Type: application/json');
echo json_encode([
    'success' => true,
    'logs' => $logs,
    'count' => count($logs),
    'filtered_count' => $filteredCount
]); 