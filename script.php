<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Charger la configuration
$config_file = __DIR__ . '/config/config.php';
$patterns_file = __DIR__ . '/config/log_patterns.php';

if (!file_exists($config_file)) {
    die(json_encode(['error' => 'Fichier de configuration manquant: config.php']));
}

if (!file_exists($patterns_file)) {
    die(json_encode(['error' => 'Fichier de patterns manquant: log_patterns.php']));
}

try {
    $config = require $config_file;
    $patterns = require $patterns_file;
    
    if (!is_array($config)) {
        throw new Exception('Configuration invalide: config.php doit retourner un tableau');
    }
    
    if (!is_array($patterns)) {
        throw new Exception('Configuration invalide: log_patterns.php doit retourner un tableau');
    }
} catch (Exception $e) {
    die(json_encode(['error' => 'Erreur de chargement de la configuration: ' . $e->getMessage()]));
}

// Configurer le temps d'exécution maximum
if (isset($config['app']['max_execution_time'])) {
    ini_set('max_execution_time', $config['app']['max_execution_time']);
}

// Inclure et configurer ParserFactory avant toute utilisation
if (!file_exists(__DIR__ . '/parsers/ParserFactory.php')) {
    die(json_encode(['error' => 'Fichier ParserFactory.php manquant']));
}

require_once __DIR__ . '/parsers/ParserFactory.php';
ParserFactory::setConfig($config);

header('Content-Type: application/json');

// Démarrer le chronomètre
$start_time = microtime(true);

if (!isset($_POST['logfile']) || empty($_POST['logfile'])) {
    die(json_encode(['error' => 'Aucun fichier spécifié']));
}

$logfile = $_POST['logfile'];

// Vérifier si le fichier existe et est lisible
if (!file_exists($logfile) || !is_readable($logfile)) {
    die(json_encode([
        'error' => "Le fichier $logfile n'existe pas ou n'est pas lisible"
    ]));
}

// Obtenir les informations du fichier
$filesize = filesize($logfile);
$mtime = filemtime($logfile);

// Formater la taille
function formatFileSize($size) {
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $i = 0;
    while ($size >= 1024 && $i < count($units) - 1) {
        $size /= 1024;
        $i++;
    }
    return [
        'value' => round($size, 1),
        'unit' => $units[$i]
    ];
}

// Fonction pour analyser la validité d'une ligne selon le type de log
function analyzeLine($line, $logType) {
    global $patterns;
    
    $line = trim($line);
    if (empty($line)) {
        ParserFactory::log("Ligne vide ignorée");
        return ['status' => 'skipped', 'reason' => 'empty'];
    }

    ParserFactory::log("Analyse de la ligne pour le type: " . $logType);
    ParserFactory::log("Ligne: " . substr($line, 0, 150));

    // Séparer le type et le sous-type
    list($type, $subtype) = explode('_', $logType);

    // Utiliser le parser approprié
    try {
        $parser = ParserFactory::getParser($type);
        $result = $parser->parse($line, $subtype);
        
        if ($result === null) {
            return ['status' => 'unreadable', 'reason' => 'invalid_format'];
        }
        
        // Vérifier si la ligne est filtrée
        if (isset($result['filtered']) && $result['filtered'] === true) {
            return ['status' => 'filtered', 'reason' => $result['reason'] ?? 'filter_match'];
        }
        
        return ['status' => 'valid', 'data' => $result];
    } catch (Exception $e) {
        ParserFactory::log("Erreur lors du parsing: " . $e->getMessage(), 'ERROR');
        return ['status' => 'unreadable', 'reason' => 'parser_error'];
    }
}

function analyzeLogFile($file) {
    if (!file_exists($file)) {
        throw new Exception("Le fichier $file n'existe pas");
    }

    // Vérifier si le fichier est compressé
    $isCompressed = preg_match('/\.(gz|bz2|xz)$/', $file);
    $handle = null;

    try {
        if ($isCompressed) {
            if (preg_match('/\.gz$/', $file)) {
                $handle = @gzopen($file, 'r');
                if ($handle === false) {
                    throw new Exception("Impossible d'ouvrir le fichier GZ: " . $file);
                }
            } elseif (preg_match('/\.bz2$/', $file)) {
                $handle = @bzopen($file, 'r');
                if ($handle === false) {
                    throw new Exception("Impossible d'ouvrir le fichier BZ2: " . $file);
                }
            } elseif (preg_match('/\.xz$/', $file)) {
                $handle = @popen('xz -dc ' . escapeshellarg($file), 'r');
                if ($handle === false) {
                    throw new Exception("Impossible d'ouvrir le fichier XZ: " . $file);
                }
            }
        } else {
            $handle = @fopen($file, 'r');
            if ($handle === false) {
                throw new Exception("Impossible d'ouvrir le fichier: " . $file);
            }
        }

        if (!$handle) {
            throw new Exception("Impossible d'ouvrir le fichier: " . $file);
        }

        $results = [];
        $lineNumber = 0;
        $totalLines = 0;
        $validLines = 0;
        $invalidLines = 0;
        $startTime = microtime(true);
        $lastProgressUpdate = 0;
        $progressInterval = 1; // Mise à jour toutes les secondes

        // Obtenir la taille du fichier pour le calcul de la progression
        $fileSize = filesize($file);
        $processedBytes = 0;

        // Lire le fichier ligne par ligne
        while (($line = $isCompressed ? gzgets($handle) : fgets($handle)) !== false) {
            $lineNumber++;
            $totalLines++;
            $processedBytes += strlen($line);

            // Mise à jour de la progression
            $currentTime = microtime(true);
            if ($currentTime - $lastProgressUpdate >= $progressInterval) {
                $progress = ($processedBytes / $fileSize) * 100;
                $speed = $processedBytes / ($currentTime - $startTime);
                $remainingBytes = $fileSize - $processedBytes;
                $eta = $remainingBytes / $speed;

                echo json_encode([
                    'status' => 'processing',
                    'progress' => round($progress, 2),
                    'processed' => $lineNumber,
                    'speed' => round($speed / 1024 / 1024, 2),
                    'eta' => round($eta, 2)
                ]) . "\n";
                flush();
                $lastProgressUpdate = $currentTime;
            }

            // Analyser la ligne
            $result = analyzeLine($line, $type . '_' . $subtype);
            if ($result['status'] === 'valid') {
                $validLines++;
                $results[] = $result;
            } else {
                $invalidLines++;
            }
        }

        $endTime = microtime(true);
        $processingTime = $endTime - $startTime;

        // Fermer le fichier
        if ($isCompressed) {
            if (preg_match('/\.gz$/', $file)) {
                gzclose($handle);
            } elseif (preg_match('/\.bz2$/', $file)) {
                bzclose($handle);
            } elseif (preg_match('/\.xz$/', $file)) {
                pclose($handle);
            }
        } else {
            fclose($handle);
        }

        return [
            'results' => $results,
            'stats' => [
                'total_lines' => $totalLines,
                'valid_lines' => $validLines,
                'invalid_lines' => $invalidLines,
                'processing_time' => round($processingTime, 2),
                'speed' => round($totalLines / $processingTime, 2)
            ]
        ];
    } catch (Exception $e) {
        if ($handle) {
            if ($isCompressed) {
                if (preg_match('/\.gz$/', $file)) {
                    gzclose($handle);
                } elseif (preg_match('/\.bz2$/', $file)) {
                    bzclose($handle);
                } elseif (preg_match('/\.xz$/', $file)) {
                    pclose($handle);
                }
            } else {
                fclose($handle);
            }
        }
        throw $e;
    }
}

try {
    // Déterminer le type de log
    ParserFactory::log("=== Début de l'analyse ===");
    ParserFactory::log("Fichier demandé: " . $logfile);
    ParserFactory::log("File exists: " . (file_exists($logfile) ? 'yes' : 'no'));
    ParserFactory::log("File is readable: " . (is_readable($logfile) ? 'yes' : 'no'));
    ParserFactory::log("File size: " . filesize($logfile));
    
    // Vérifier les permissions
    ParserFactory::log("File permissions: " . substr(sprintf('%o', fileperms($logfile)), -4));
    
    // Utiliser ParserFactory pour détecter le type
    $detectedType = ParserFactory::detectLogType($logfile);
    ParserFactory::log("Type détecté: " . json_encode($detectedType));
    
    $type = $detectedType['type'];
    $subtype = $detectedType['subtype'];
    
    ParserFactory::log("Création du parser pour le type: " . $type);
    try {
        $parser = ParserFactory::getParser($type);
        ParserFactory::log("Parser créé avec succès: " . get_class($parser));
    } catch (Exception $e) {
        ParserFactory::log("Échec de la création du parser: " . $e->getMessage(), 'ERROR');
        ParserFactory::log("Stack trace: " . $e->getTraceAsString(), 'ERROR');
        throw $e;
    }

    // Lire et analyser les lignes du fichier
    $lines = [];
    $stats = [
        'total_lines' => 0,
        'valid_lines' => 0,
        'skipped_lines' => 0,
        'unreadable_lines' => 0,
        'filtered_lines' => 0,
        'reasons' => []
    ];

    ParserFactory::log("Ouverture du fichier: " . $logfile);
    $handle = fopen($logfile, "r");
    if (!$handle) {
        $error = error_get_last();
        ParserFactory::log("Échec de l'ouverture du fichier: " . ($error ? $error['message'] : 'Unknown error'), 'ERROR');
        throw new Exception("Impossible d'ouvrir le fichier $logfile: " . ($error ? $error['message'] : 'Unknown error'));
    }

    $buffer = [];
    $lineCount = 0;
    $maxLines = $config['app']['max_lines_per_request'];

    ParserFactory::log("Début de la lecture des lignes");
    while (!feof($handle) && $lineCount < $maxLines) {
        $line = fgets($handle);
        if ($line === false) {
            if (feof($handle)) {
                ParserFactory::log("Fin du fichier atteinte");
                break;
            }
            $error = error_get_last();
            ParserFactory::log("Erreur de lecture: " . ($error ? $error['message'] : 'Erreur inconnue'), 'ERROR');
            continue;
        }

        $stats['total_lines']++;
        $lineCount++;
        
        try {
            // Analyser la ligne
            $result = analyzeLine($line, ($type ?? 'raw') . '_' . ($subtype ?? 'default'));
            ParserFactory::log("Analyse de la ligne: " . json_encode($result));
            
            if (isset($result['status']) && $result['status'] === 'valid') {
                if (isset($result['data'])) {
                    $buffer[] = $result['data'];
                    $stats['valid_lines']++;
                    ParserFactory::log("Ligne valide: " . json_encode($result['data']));
                }
            } else if (isset($result['status']) && $result['status'] === 'filtered') {
                $stats['filtered_lines']++;
                if (isset($result['reason'])) {
                    if (!isset($stats['reasons'][$result['reason']])) {
                        $stats['reasons'][$result['reason']] = 0;
                    }
                    $stats['reasons'][$result['reason']]++;
                }
                ParserFactory::log("Ligne filtrée: " . $line);
            } else {
                if (isset($result['status']) && $result['status'] === 'skipped') {
                    $stats['skipped_lines']++;
                    ParserFactory::log("Ligne ignorée: " . $line);
                } else {
                    $stats['unreadable_lines']++;
                    ParserFactory::log("Ligne illisible: " . $line);
                }
                if (isset($result['reason'])) {
                    if (!isset($stats['reasons'][$result['reason']])) {
                        $stats['reasons'][$result['reason']] = 0;
                    }
                    $stats['reasons'][$result['reason']]++;
                }
            }
        } catch (Exception $e) {
            $stats['unreadable_lines']++;
            ParserFactory::log("Erreur lors du parsing: " . $e->getMessage(), 'ERROR');
        }
    }

    if ($handle) {
        fclose($handle);
    }
    $lines = array_values(array_filter($buffer));

    ParserFactory::log("Récupération des colonnes pour le type: " . $type . ", sous-type: " . $subtype);
    $columns = $parser->getColumns($subtype);
    ParserFactory::log("Colonnes: " . json_encode($columns));

    // Préparer les informations du fichier
    $fileInfo = [
        'size' => formatFileSize($filesize),
        'mtime' => [
            'timestamp' => $mtime,
            'formatted' => date($config['date_formats']['display'], $mtime)
        ]
    ];

    // S'assurer que filtered_lines existe dans les stats
    if (!isset($stats['filtered_lines'])) {
        $stats['filtered_lines'] = 0;
    }

    // Calculer le nombre de lignes filtrées si ce n'est pas déjà fait
    if ($stats['filtered_lines'] === 0) {
        $stats['filtered_lines'] = $stats['total_lines'] - ($stats['valid_lines'] + $stats['skipped_lines'] + $stats['unreadable_lines']);
    }

    ParserFactory::log("Préparation de la réponse avec " . count($lines) . " lignes valides");
    ParserFactory::log("Statistiques: " . json_encode($stats));
    
    // Si aucune ligne n'a été parsée, on affiche en mode brut
    if (empty($buffer)) {
        // Lire toutes les lignes du fichier pour le mode brut
        $rawLines = [];
        $rawHandle = null;
        
        try {
            $rawHandle = fopen($logfile, 'r');
            if ($rawHandle) {
                while (($line = fgets($rawHandle)) !== false) {
                    $rawLines[] = htmlspecialchars(trim($line));
                }
                fclose($rawHandle);
                
                $response = [
                    'success' => true,
                    'type' => 'raw',
                    'columns' => [
                        'raw_line' => ['name' => 'Ligne brute', 'class' => 'column-raw']
                    ],
                    'lines' => array_map(function($line) {
                        return ['raw_line' => $line];
                    }, $rawLines),
                    'stats' => [
                        'total_lines' => count($rawLines),
                        'valid_lines' => count($rawLines),
                        'filtered_lines' => 0,
                        'skipped_lines' => 0,
                        'unreadable_lines' => 0
                    ],
                    'file_info' => $fileInfo,
                    'execution_time' => round((microtime(true) - $start_time) * 1000, 2)
                ];
            } else {
                throw new Exception("Impossible de lire le fichier en mode brut");
            }
        } catch (Exception $e) {
            if ($rawHandle) {
                fclose($rawHandle);
            }
            throw $e;
        }
    } else {
        $response = [
            'success' => true,
            'type' => $type,
            'subtype' => $subtype,
            'columns' => $columns,
            'lines' => array_values($buffer),
            'stats' => $stats,
            'file_info' => $fileInfo,
            'execution_time' => round((microtime(true) - $start_time) * 1000, 2)
        ];
    }

    $jsonResponse = json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    if ($jsonResponse === false) {
        ParserFactory::log("Erreur d'encodage JSON: " . json_last_error_msg(), 'ERROR');
        throw new Exception("Erreur lors de l'encodage JSON: " . json_last_error_msg());
    }

    header('Content-Type: application/json; charset=utf-8');
    echo $jsonResponse;
    
} catch (Exception $e) {
    ParserFactory::log("Erreur principale: " . $e->getMessage(), 'ERROR');
    ParserFactory::log("Stack trace: " . $e->getTraceAsString(), 'ERROR');
    
    header('Content-Type: application/json');
    $error_response = [
        'error' => "Erreur lors de la lecture: " . $e->getMessage(),
        'execution_time' => round((microtime(true) - $start_time) * 1000, 2)
    ];
    
    echo json_encode($error_response, JSON_UNESCAPED_UNICODE);
}

// Suppression de la gestion du mode debug via AJAX
?>
