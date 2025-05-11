<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Charger d'abord les fonctions utilitaires
require_once __DIR__ . '/includes/functions.php';

// Charger la configuration
$config_file = file_exists(__DIR__ . '/config/config.user.php') 
    ? __DIR__ . '/config/config.user.php'
    : __DIR__ . '/config/config.php';

$patterns_file = file_exists(__DIR__ . '/config/log_patterns.user.php')
    ? __DIR__ . '/config/log_patterns.user.php'
    : __DIR__ . '/config/log_patterns.php';

require_once $config_file;
require_once $patterns_file;
require_once __DIR__ . '/includes/config.php';

// Charger la configuration admin
$admin_config = require __DIR__ . '/config/admin.php';

// Démarrer la session si elle n'est pas déjà démarrée
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Debug pour vérifier la configuration
error_log('Debug - admin_config: ' . print_r($admin_config, true));
error_log('Debug - require_login: ' . (isset($admin_config['debug']['require_login']) ? 'true' : 'false'));
error_log('Debug - SESSION: ' . print_r($_SESSION, true));

// Vérifier si le login est requis pour la page principale
if (isset($admin_config['debug']['require_login']) && $admin_config['debug']['require_login'] === true) {
    // Vérifier si l'utilisateur est connecté
    if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
        error_log('Debug - Redirection vers login.php');
        // Construire l'URL de redirection de manière plus robuste
        $baseUrl = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on' ? "https" : "http") . "://$_SERVER[HTTP_HOST]";
        $redirect_url = $baseUrl . getAbsolutePath('admin/login.php') . '?redirect=' . urlencode($_SERVER['REQUEST_URI']);
        error_log('Debug - URL de redirection: ' . $redirect_url);
        header('Location: ' . $redirect_url);
        exit;
    }
}

if (!file_exists($config_file)) {
    die('Erreur: Fichier de configuration manquant (config.php)');
}

if (!file_exists($patterns_file)) {
    die('Erreur: Fichier de patterns manquant (log_patterns.php)');
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
    die('Erreur de chargement de la configuration: ' . $e->getMessage());
}

// Vérifier et initialiser les tableaux si nécessaire
if (!isset($config['app']) || !is_array($config['app'])) {
    $config['app'] = [
        'max_execution_time' => 300,
        'default_lines_per_page' => 25
    ];
}

// S'assurer que les extensions exclues sont définies
if (!isset($config['app']['excluded_extensions']) || !is_array($config['app']['excluded_extensions'])) {
    $config['app']['excluded_extensions'] = ['gz', 'zip', 'tar', 'rar', '7z', 'bz2', 'xz'];
}

// Définir $temp_dir avant son utilisation
$temp_dir = sys_get_temp_dir() . '/logviewr';

if (!isset($config['paths']) || !is_array($config['paths'])) {
    $config['paths'] = [
        'apache_logs' => '/var/log/apache2',
        'nginx_logs' => '/var/log/nginx',
        'syslog' => '/var/log'
    ];
}

if (!isset($config['debug']) || !is_array($config['debug'])) {
    $config['debug'] = [
        'enabled' => false,
        'log_file' => $temp_dir . '/debug.log',
        'log_level' => 'ERROR',
        'log_to_apache' => false
    ];
}

// Désactiver explicitement le debug si nécessaire
if (isset($config['debug']['enabled']) && $config['debug']['enabled'] === false) {
    error_reporting(0);
    ini_set('display_errors', 0);
    ini_set('log_errors', 0);
} else {
    // Configurer le logging uniquement si le debug est activé
    ini_set('log_errors', 1);
    ini_set('error_log', $config['debug']['log_file'] ?? $temp_dir . '/debug.log');
}

// Gestion du dossier de logs
$log_dir = __DIR__ . '/logs';

// Essayer d'abord le dossier local, sinon utiliser le dossier temporaire
if (!file_exists($log_dir)) {
    if (!@mkdir($log_dir, 0755, true)) {
        // Si échec, utiliser le dossier temporaire
        if (!file_exists($temp_dir)) {
            if (!@mkdir($temp_dir, 0755, true)) {
                die('Erreur: Impossible de créer le dossier temporaire');
            }
        }
        $config['debug']['log_file'] = $temp_dir . '/debug.log';
    }
}

// Vérifier les patterns Nginx
if (!isset($patterns['nginx']) || !is_array($patterns['nginx'])) {
    $patterns['nginx'] = [
        'use_npm' => false,
        'access' => [
            'pattern' => '/^(\S+) - \S+ \[([^\]]+)\] "(.*?)" (\d{3}) (\d+) "(.*?)" "(.*?)"$/'
        ],
        'error' => [
            'pattern' => '/^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: (.*)$/'
        ]
    ];
}

// Fonction pour vérifier si un fichier doit être exclu
function isExcludedFile($filename) {
    global $config;
    
    if (!isset($config['app']['excluded_extensions']) || !is_array($config['app']['excluded_extensions'])) {
        return false;
    }
    
    // Convertir toutes les extensions en minuscules une seule fois
    $excluded_extensions = array_map('strtolower', $config['app']['excluded_extensions']);
    
    // Obtenir l'extension
    $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    
    // Si l'extension est un nombre (ex: .1, .2), vérifier l'extension précédente
    if (is_numeric($extension)) {
        $previousExtension = strtolower(pathinfo(pathinfo($filename, PATHINFO_FILENAME), PATHINFO_EXTENSION));
        // Ajouter le point si nécessaire
        $previousExtension = '.' . ltrim($previousExtension, '.');
        return in_array($previousExtension, $excluded_extensions);
    }
    
    // Vérifier les extensions composées (ex: .log.gz)
    $fullName = strtolower($filename);
    foreach ($excluded_extensions as $ext) {
        // Ajouter le point si nécessaire
        $ext = '.' . ltrim($ext, '.');
        // Vérifier l'extension simple
        if ('.' . $extension === $ext) {
            return true;
        }
        // Vérifier l'extension composée
        if (str_ends_with($fullName, $ext)) {
            return true;
        }
    }
    
    return false;
}

// Fonction pour lister les fichiers de logs avec gestion des erreurs
function listLogFiles($directory) {
    $files = [];
    
    if (!is_dir($directory)) {
        error_log("Le répertoire n'existe pas: " . $directory);
        return $files;
    }
    
    if (!is_readable($directory)) {
        error_log("Le répertoire n'est pas lisible: " . $directory);
        return $files;
    }
    
    try {
        $items = scandir($directory);
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            
            // Exclure les fichiers de position de logs
            if ($item === 'error_last_pos' || $item === 'access_last_pos' || 
                strpos($item, '_last_pos') !== false) {
                continue;
            }
            
            $path = $directory . '/' . $item;
            if (is_file($path)) {
                // Vérifier si le fichier est vide
                if (filesize($path) === 0) {
                    continue;
                }
                
                // Vérifier si le fichier est lisible
                if (!is_readable($path)) {
                    continue;
                }
                
                // Si le fichier n'est PAS exclu, l'ajouter à la liste
                if (!isExcludedFile($item)) {
                    $files[] = $item;
                } else {
                    // Log pour le débogage
                 //   error_log("Fichier exclu: " . $item . " (extension exclue)");
                }
            }
        }
    } catch (Exception $e) {
        error_log("Erreur lors de la lecture du répertoire: " . $e->getMessage());
    }
    
    // Trier les fichiers
    sort($files);
    return $files;
}

// Lister les fichiers de logs pour chaque type
$log_files = [
    'apache' => listLogFiles($config['paths']['apache_logs']),
    'nginx' => listLogFiles(
        isset($config['nginx']['use_npm']) && $config['nginx']['use_npm'] ? 
            $config['paths']['npm_logs'] : 
            $config['paths']['nginx_logs']
    ),
    'syslog' => listLogFiles($config['paths']['syslog'])
];

require_once __DIR__ . '/includes/Logger.php';

class LogManager {
    private $excluded_extensions;
    private $config;
    private $filters_enabled;
    
    public function __construct($config) {
        $this->config = $config;
        
        // Les filtres de contenu sont gérés séparément dans les parsers
        $this->filters_enabled = $config['filters']['enabled'] ?? true;
        
        // Les extensions exclues sont toujours appliquées, indépendamment des filtres de contenu
        // Car elles concernent la sélection des fichiers, pas le contenu des logs
        $this->excluded_extensions = isset($config['app']['excluded_extensions']) ? 
            array_map(function($ext) {
                // Normaliser le format des extensions
                return '.' . ltrim($ext, '.');
            }, $config['app']['excluded_extensions']) : 
            ['.gz', '.zip', '.tar', '.rar', '.7z', '.bz2', '.xz'];
            
        if ($this->config['debug']['enabled']) {
            error_log("[DEBUG] LogManager initialized with excluded extensions: " . implode(', ', $this->excluded_extensions));
        }
    }
    
    public function formatFileSize($size) {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        while ($size >= 1024 && $i < count($units) - 1) {
            $size /= 1024;
            $i++;
        }
        $size = round($size, 1);
        return "<span class='size-badge'><span class='number'>$size</span><span class='unit'>" . $units[$i] . "</span></span>";
    }

    public function getFileInfo($file) {
        $size = filesize($file);
        $mtime = filemtime($file);
        $date = date($this->config['date_formats']['display'], $mtime);
        
        return sprintf(
            '<span class="file-meta">(%s - <span class="date-info">%s</span>)</span>',
            $this->formatFileSize($size),
            $date
        );
    }

    public function findLogs($dir) {
        $logs = [];
        
        // Vérifier si le répertoire existe
        if (!is_dir($dir)) {
            Logger::getInstance()->log("Le répertoire n'existe pas: " . $dir, 'ERROR');
            return $logs;
        }
        
        // Vérifier si le répertoire est lisible
        if (!is_readable($dir)) {
            Logger::getInstance()->log("Le répertoire n'est pas lisible: " . $dir, 'WARNING');
            return $logs;
        }
        
        // Fonction récursive pour trouver tous les fichiers
        $findFiles = function($directory) use (&$findFiles, &$logs) {
            // Vérifier si le répertoire est lisible avant de le scanner
            if (!is_readable($directory)) {
                Logger::getInstance()->log("Le répertoire n'est pas lisible: " . $directory, 'WARNING');
                return;
            }
            
            $files = @scandir($directory);
            
            if ($files === false) {
                Logger::getInstance()->log("Impossible de scanner le répertoire: " . $directory, 'WARNING');
                return;
            }
            
            foreach ($files as $file) {
                if ($file === '.' || $file === '..') {
                    continue;
                }
                
                $path = $directory . '/' . $file;
                
                // Si c'est un répertoire, le parcourir récursivement
                if (is_dir($path)) {
                    // Vérifier si le sous-répertoire est lisible avant de le parcourir
                    if (is_readable($path)) {
                        $findFiles($path);
                    } else {
                        Logger::getInstance()->log("Le sous-répertoire n'est pas lisible: " . $path, 'WARNING');
                    }
                    continue;
                }
                
                // Vérifier si c'est un fichier de log valide
                if ($this->isValidLogFile($path)) {
                    $logs[] = $path;
                }
            }
        };
        
        // Démarrer la recherche récursive
        $findFiles($dir);
        
        // Trier les logs par nom
        sort($logs);
        
        return $logs;
    }

    private function isValidLogFile($file) {
        // Vérifier si le fichier existe et n'est pas vide
        if (!file_exists($file) || filesize($file) === 0) {
            return false;
        }
        
        // Exclure les fichiers *_last_pos
        $basename = basename($file);
        if (strpos($basename, '_last_pos') !== false || 
            $basename === 'error_last_pos' || 
            $basename === 'access_last_pos') {
            return false;
        }
        
        // Vérifier les extensions exclues (indépendant des filtres de contenu)
        // Cette logique est séparée des filtres de contenu des logs
        $extension = strtolower(pathinfo($file, PATHINFO_EXTENSION));
        
        // Si l'extension est un nombre (ex: .1, .2), vérifier l'extension précédente
        if (is_numeric($extension)) {
            $previousExtension = strtolower(pathinfo(pathinfo($file, PATHINFO_FILENAME), PATHINFO_EXTENSION));
            if (in_array('.' . ltrim($previousExtension, '.'), $this->excluded_extensions)) {
                if ($this->config['debug']['enabled']) {
                    error_log("[DEBUG] File excluded by previous extension: " . $file);
                }
                return false;
            }
        } else if (in_array('.' . ltrim($extension, '.'), $this->excluded_extensions)) {
            if ($this->config['debug']['enabled']) {
                error_log("[DEBUG] File excluded by extension: " . $file);
            }
            return false;
        }
        
        // Vérifier si le fichier est lisible
        if (!is_readable($file)) {
            if ($this->config['debug']['enabled']) {
                error_log("[DEBUG] File not readable: " . $file);
            }
            return false;
        }
        
        return true;
    }

    public function renderLogOption($log) {
        $basename = basename($log);
        $size = filesize($log);
        $mtime = filemtime($log);
        $date = date('Y-m-d H:i:s', $mtime);
        
        return sprintf(
            '<option value="%s" data-date="%s">%s (%s - %s)</option>',
            htmlspecialchars($log),
            htmlspecialchars($date),
            htmlspecialchars($basename),
            $this->formatFileSize($size),
            $date
        );
    }

    public function getApacheLogs() {
        $all_logs = $this->findLogs($this->config['paths']['apache_logs']);
        $main_logs = [];
        $vhost_logs = [];
        $other_logs = [];

        foreach ($all_logs as $log) {
            $basename = basename($log);
            if (preg_match('/^(access\.log|error\.log|404_only\.log|referer\.log|other_vhosts_access\.log)/', $basename)) {
                $main_logs[] = $log;
            } elseif (strpos($basename, 'access') !== false || strpos($basename, 'error') !== false) {
                $vhost_logs[] = $log;
            } else {
                $other_logs[] = $log;
            }
        }

        // Trier les logs dans chaque catégorie
        sort($main_logs);
        sort($vhost_logs);
        sort($other_logs);

        return [
            'main' => $main_logs,
            'vhost' => $vhost_logs,
            'other' => $other_logs
        ];
    }

    public function getNginxLogs() {
        $logs = [
            'default' => [],
            'dead' => [],
            'fallback' => [],
            'letsencrypt' => [],
            'proxy' => [],
            'other' => []
        ];
        
        $path = isset($this->config['nginx']['use_npm']) && $this->config['nginx']['use_npm'] ? 
            $this->config['paths']['npm_logs'] : 
            $this->config['paths']['nginx_logs'];
        
        if (!is_dir($path)) {
            Logger::getInstance()->log("Le répertoire n'existe pas: " . $path, 'WARNING');
            return $logs;
        }
        
        if (!is_readable($path)) {
            Logger::getInstance()->log("Le répertoire n'est pas lisible: " . $path, 'WARNING');
            return $logs;
        }
        
        $files = scandir($path);
        foreach ($files as $file) {
            // Skip special files and _last_pos files
            if ($file === '.' || $file === '..' || strpos($file, '_last_pos') !== false) continue;
            
            $full_path = $path . '/' . $file;
            
            // Check if it's a file
            if (!is_file($full_path)) continue;
            
            // Check if file is empty
            if (filesize($full_path) === 0) continue;
            
            // Check file extension (.log or .log.1)
            if (!preg_match('/\.(log|log\.1)$/', $file)) continue;
            
            // Check excluded extensions
            if (isExcludedFile($file)) continue;
            
            $log_entry = [
                'name' => $file,
                'path' => $full_path,
                'info' => $this->getFileInfo($full_path)
            ];
            
            // Categorize NPM logs
            if (strpos($file, 'letsencrypt') !== false) {
                $logs['letsencrypt'][] = $log_entry;
            } elseif (preg_match('/^default-host[_-](access|error)\.(log|log\.1)$/', $file) || preg_match('/^default-host-\d*[_-]/', $file)) {
                $logs['default'][] = $log_entry;
            } elseif (preg_match('/^dead-host-\d*[_-]/', $file)) {
                $logs['dead'][] = $log_entry;
            } elseif (preg_match('/^fallback[_-]/', $file)) {
                $logs['fallback'][] = $log_entry;
            } elseif (preg_match('/^proxy-host-\d*[_-]/', $file)) {
                $logs['proxy'][] = $log_entry;
            } else {
                $logs['other'][] = $log_entry;
            }
        }
        
        // Sort logs in each category
        foreach ($logs as &$category) {
            usort($category, function($a, $b) {
                // Priority order for default host logs
                $defaultFiles = [
                    'default-host_access.log' => 1,
                    'default-host_error.log' => 2,
                    'default-host_access.log.1' => 3,
                    'default-host_error.log.1' => 4
                ];

                // Check if files are in our priority list
                $priorityA = isset($defaultFiles[$a['name']]) ? $defaultFiles[$a['name']] : 999;
                $priorityB = isset($defaultFiles[$b['name']]) ? $defaultFiles[$b['name']] : 999;

                // If both files have different priorities, sort by priority
                if ($priorityA !== $priorityB) {
                    return $priorityA - $priorityB;
                }
                
                // Extract numbers from filenames (if present)
                preg_match('/\d+/', $a['name'], $matchesA);
                preg_match('/\d+/', $b['name'], $matchesB);
                
                $numA = isset($matchesA[0]) ? intval($matchesA[0]) : 0;
                $numB = isset($matchesB[0]) ? intval($matchesB[0]) : 0;
                
                // If both files have numbers, sort by number
                if ($numA && $numB) {
                    if ($numA !== $numB) {
                        return $numA - $numB;
                    }
                }
                
                // Sort by name, with .log before .log.1
                $nameA = preg_replace('/\.1$/', '', $a['name']);
                $nameB = preg_replace('/\.1$/', '', $b['name']);
                $baseCompare = strcmp($nameA, $nameB);
                
                if ($baseCompare === 0) {
                    return strpos($b['name'], '.1') !== false ? -1 : 1;
                }
                
                return $baseCompare;
            });
        }
        
        return $logs;
    }

    public function getSysLogs() {
        $all_logs = $this->findLogs($this->config['paths']['syslog']);
        $priority_logs = [];
        $other_logs = [];

        foreach ($all_logs as $log) {
            // Exclure les fichiers des dossiers journal et pcp
            if (strpos($log, '/var/log/journal') !== false || 
                strpos($log, '/var/log/pcp') !== false) {
                continue;
            }
            
            $basename = basename($log);
            if (preg_match('/^(syslog|auth\.log|kern\.log|daemon\.log|debug|messages|cron\.log)$/', $basename)) {
                $priority_logs[] = $log;
            } else {
                $other_logs[] = $log;
            }
        }

        // Trier les logs dans chaque catégorie
        sort($priority_logs);
        sort($other_logs);

        return [
            'priority' => $priority_logs,
            'other' => $other_logs
        ];
    }
}

$logManager = new LogManager($config);

// Charger la configuration admin
$admin_config = require __DIR__ . '/config/admin.php';
$filters_enabled = $config['filters']['enabled'] ?? false;

// Traitement des actions AJAX
if (isset($_GET['action']) && $_GET['action'] === 'reload_logs' && isset($_SERVER['HTTP_X_REQUESTED_WITH']) && $_SERVER['HTTP_X_REQUESTED_WITH'] === 'XMLHttpRequest') {
    // Recharger les logs
    $logs = [];
    $logFiles = getLogFiles();
    
    foreach ($logFiles as $file) {
        $logs[$file] = parseLogFile($file);
    }
    
    // Retourner une réponse JSON
    header('Content-Type: application/json');
    echo json_encode(['success' => true, 'message' => 'Logs rechargés avec succès']);
    exit;
}

// Vérifier si l'utilisateur est connecté au panneau d'administration
$admin_logged_in = false;
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}
if (isset($_SESSION['admin_logged_in']) && $_SESSION['admin_logged_in'] === true) {
    $admin_logged_in = true;
}

// Vérifier si un fichier de log est spécifié
$log_file = $_GET['log_file'] ?? '';
if (empty($log_file)) {
    $log_file = $config['paths']['default_log'] ?? '';
}

// Vérifier les mises à jour
if (isset($config['admin']['update_check']['enabled']) && $config['admin']['update_check']['enabled']) {
    require_once __DIR__ . '/includes/UpdateChecker.php';
    $updateChecker = new UpdateChecker();
    $updateInfo = $updateChecker->checkForUpdates();
    
    if ($updateInfo) {
        echo '<div class="alert alert-warning alert-dismissible fade show update-alert" role="alert" style="position: fixed; top: 20px; right: 20px; z-index: 9999; max-width: 400px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                <div class="d-flex align-items-center">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    <div>
                        <h5 class="alert-heading mb-1">Mise à jour disponible !</h5>
                        <p class="mb-0">Version ' . $updateInfo['latest_version'] . ' est disponible (vous utilisez ' . $updateInfo['current_version'] . ')</p>
                    </div>
                    <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert" aria-label="Close"></button>
                </div>
            </div>';
    }
}

// Après le chargement de la configuration

// Démarrer la session si ce n'est pas déjà fait
session_start();

// Récupérer les valeurs de la session ou utiliser les valeurs par défaut
$default_lines = isset($_SESSION['default_lines_per_page']) 
    ? $_SESSION['default_lines_per_page'] 
    : $config['app']['default_lines_per_page'];

$max_lines = isset($_SESSION['max_lines_per_request'])
    ? $_SESSION['max_lines_per_request']
    : $config['app']['max_lines_per_request'];

// Sauvegarder les nouvelles valeurs dans la session si elles sont modifiées
if (isset($_POST['lines_per_page'])) {
    $_SESSION['default_lines_per_page'] = (int)$_POST['lines_per_page'];
    $default_lines = $_SESSION['default_lines_per_page'];
}

if (isset($_POST['max_lines'])) {
    $_SESSION['max_lines_per_request'] = (int)$_POST['max_lines'];
    $max_lines = $_SESSION['max_lines_per_request'];
}

// Traitement des actions normales
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title> LogviewR</title>
      <!-- Favicon -->
      <link rel="icon" type="image/x-icon" href="favicon.ico">
  <!-- Charger d'abord jQuery -->
  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
  
  <!-- Puis le JavaScript de DataTables -->
  <script src="https://cdn.datatables.net/1.11.5/js/jquery.dataTables.js"></script>
  <script src="https://cdn.datatables.net/colreorder/1.5.4/js/dataTables.colReorder.min.js"></script>
  
  <!-- CSS externes -->
  <link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/1.11.5/css/jquery.dataTables.css">
  <link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/colreorder/1.5.4/css/colReorder.dataTables.min.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  
  <!-- Notre CSS personnalisé -->
  <link rel="stylesheet" href="assets/css/variables.css">
  <link rel="stylesheet" href="assets/css/base.css">
  <link rel="stylesheet" href="assets/css/table.css">

  <link rel="stylesheet" href="assets/css/badges.css">
  <link rel="stylesheet" href="assets/css/links.css">
  <link rel="stylesheet" href="assets/css/syslog.css">

  <script>
    // Définir la configuration globale
    window.config = {
        filters_enabled: <?php echo $filters_enabled ? 'true' : 'false'; ?>
    };
</script>
 
  <!--  Notre JavaScript personnalisé -->
  <script src="assets/js/column_config.js" defer></script>
  <script src="assets/js/table.js" defer></script>

  <script src="assets/js/filters.js" defer></script>
  
  <!-- Script pour gérer la fermeture du popup de mise à jour -->
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      // Gestionnaire pour le bouton de fermeture du popup de mise à jour
      const closeButtons = document.querySelectorAll('.update-alert .btn-close');
      closeButtons.forEach(button => {
        button.addEventListener('click', function() {
          const alert = this.closest('.update-alert');
          if (alert) {
            // Ajouter la classe fade pour l'animation
            alert.classList.add('fade');
            // Supprimer l'élément après l'animation
            setTimeout(() => {
              alert.remove();
            }, 150);
          }
        });
      });
    });
  </script>
</head>
<body>
  <div class="container">
    <div class="theme-switch">
      <button onclick="toggleTheme()" id="themeIcon">
        <i class="fas fa-sun"></i>
      </button>
    </div>

    <div class="header-container">
      <h2>
       <!-- <i class="fas fa-scroll"></i> -->
       <img src="favicon.png" style="width: 48px; vertical-align: middle; margin-right: 5px;">
        <a href="<?= 'https://' . $_SERVER['HTTP_HOST'] . '/LogviewR/' ?>">LogviewR</a>
        <span id="selectedFileInfo"></span>
      </h2>
      <div class="header-controls">
        <?php if ($admin_logged_in): ?>
        <a href="admin/index.php" class="admin-badge" title="Administrateur connecté: <?php echo htmlspecialchars($admin_config['admin']['username'] ?? 'admin'); ?>">
          <i class="fas fa-user-shield"></i>
        </a>
        <?php endif; ?>
        <?php if ($config['debug']['enabled']): ?>
        <span class="debug-badge" title="Mode Debug Activé">
          <i class="fas fa-bug"></i>
        </span>
        <?php endif; ?>
      </div>
    </div>

    <div class="categories">
      <div class="category">
        <h3>
          <i class="fas fa-server"></i> 
          Apache 
          <span class="folder-name">/var/log/apache2</span>
        </h3>
        <select class="log-select" data-type="apache">
          <option value="">Sélectionner un fichier 👇</option>
          <?php
            $apache_logs = $logManager->getApacheLogs();
            
            if (!empty($apache_logs['main'])) {
                echo "<optgroup label='Logs Principaux'>";
                foreach ($apache_logs['main'] as $log) {
                    echo $logManager->renderLogOption($log);
                }
                echo "</optgroup>";
            }
            
            if (!empty($apache_logs['vhost'])) {
                echo "<optgroup label='Logs Virtualhosts'>";
                foreach ($apache_logs['vhost'] as $log) {
                    echo $logManager->renderLogOption($log);
                }
                echo "</optgroup>";
            }
            
            if (!empty($apache_logs['other'])) {
                echo "<optgroup label='Autres Logs'>";
                foreach ($apache_logs['other'] as $log) {
                    echo $logManager->renderLogOption($log);
                }
                echo "</optgroup>";
            }
          ?>
        </select>
      </div>

      <div class="category">
        <h3>
          <i class="fas fa-wind"></i> 
          <?php 
            // Utiliser uniquement la valeur de config.php, pas celle des patterns
            $use_npm = isset($config['nginx']['use_npm']) ? $config['nginx']['use_npm'] : false;
            echo $use_npm ? 'NPM' : 'Nginx'; 
          ?>
          <span class="folder-name"><?php echo $use_npm ? '/var/log/npm' : '/var/log/nginx'; ?></span>
        </h3>
        <select class="log-select" data-type="nginx">
          <option value="">Sélectionner un fichier 👇</option>
          <?php
            $nginx_logs = $logManager->getNginxLogs();
            
            if (!empty($nginx_logs['default'])): ?>
                <optgroup label="Default Host">
                    <?php foreach ($nginx_logs['default'] as $log): ?>
                        <option value="<?php echo htmlspecialchars($log['path']); ?>">
                            <?php echo htmlspecialchars($log['name']) . ' ' . $log['info']; ?>
                        </option>
                    <?php endforeach; ?>
                </optgroup>
            <?php endif;
            
            if (!empty($nginx_logs['dead'])): ?>
                <optgroup label="Dead Host">
                    <?php foreach ($nginx_logs['dead'] as $log): ?>
                        <option value="<?php echo htmlspecialchars($log['path']); ?>">
                            <?php echo htmlspecialchars($log['name']) . ' ' . $log['info']; ?>
                        </option>
                    <?php endforeach; ?>
                </optgroup>
            <?php endif;
            
            if (!empty($nginx_logs['fallback'])): ?>
                <optgroup label="Fallback">
                    <?php foreach ($nginx_logs['fallback'] as $log): ?>
                        <option value="<?php echo htmlspecialchars($log['path']); ?>">
                            <?php echo htmlspecialchars($log['name']) . ' ' . $log['info']; ?>
                        </option>
                    <?php endforeach; ?>
                </optgroup>
            <?php endif;

            if (!empty($nginx_logs['letsencrypt'])): ?>
                <optgroup label="Let's Encrypt">
                    <?php foreach ($nginx_logs['letsencrypt'] as $log): ?>
                        <option value="<?php echo htmlspecialchars($log['path']); ?>">
                            <?php echo htmlspecialchars($log['name']) . ' ' . $log['info']; ?>
                        </option>
                    <?php endforeach; ?>
                </optgroup>
            <?php endif;
            
            if (!empty($nginx_logs['proxy'])): ?>
                <optgroup label="Proxy">
                    <?php foreach ($nginx_logs['proxy'] as $log): ?>
                        <option value="<?php echo htmlspecialchars($log['path']); ?>">
                            <?php echo htmlspecialchars($log['name']) . ' ' . $log['info']; ?>
                        </option>
                    <?php endforeach; ?>
                </optgroup>
            <?php endif;
            
            if (!empty($nginx_logs['other'])): ?>
                <optgroup label="Autres Logs">
                    <?php foreach ($nginx_logs['other'] as $log): ?>
                        <option value="<?php echo htmlspecialchars($log['path']); ?>">
                            <?php echo htmlspecialchars($log['name']) . ' ' . $log['info']; ?>
                        </option>
                    <?php endforeach; ?>
                </optgroup>
            <?php endif; ?>
        </select>
      </div>

      <div class="category">
        <h3>
          <i class="fas fa-terminal"></i> 
          Syslog
          <span class="folder-name">/var/log</span>
        </h3>
        <select class="log-select" data-type="syslog">
          <option value="">Sélectionner un fichier 👇</option>
          <?php
            $syslog_logs = $logManager->getSysLogs();
            
            if (!empty($syslog_logs['priority'])) {
                echo "<optgroup label='Logs Système Principaux'>";
                foreach ($syslog_logs['priority'] as $log) {
                    echo $logManager->renderLogOption($log);
                }
                echo "</optgroup>";
            }
            
            if (!empty($syslog_logs['other'])) {
                // Organiser les autres logs par dossier
                $logs_by_dir = [];
                foreach ($syslog_logs['other'] as $log) {
                    $dir = dirname($log);
                    // Ignorer les dossiers nginx et apache2
                    if (strpos($dir, '/var/log/nginx') !== false || strpos($dir, '/var/log/apache2') !== false) {
                        continue;
                    }
                    
                    $relative_path = str_replace('/var/log/', '', $dir);
                    if ($dir === '/var/log') {
                        $dir_name = 'Autres Logs Système';
                    } else {
                        $dir_name = str_replace('/', ' → ', $relative_path);
                    }
                    $logs_by_dir[$dir_name][] = $log;
                }
                
                // Trier les dossiers
                ksort($logs_by_dir);
                
                // Afficher d'abord les logs de la racine
                if (isset($logs_by_dir['Autres Logs Système'])) {
                    echo "<optgroup label='Autres Logs Système'>";
                    sort($logs_by_dir['Autres Logs Système']);
                    foreach ($logs_by_dir['Autres Logs Système'] as $log) {
                        echo $logManager->renderLogOption($log);
                    }
                    echo "</optgroup>";
                    unset($logs_by_dir['Autres Logs Système']);
                }
                
                // Afficher les autres dossiers
                foreach ($logs_by_dir as $dir_name => $logs) {
                    if (!empty($logs)) {
                        echo "<optgroup label='$dir_name'>";
                        sort($logs);
                        foreach ($logs as $log) {
                            echo $logManager->renderLogOption($log);
                        }
                        echo "</optgroup>";
                    }
                }
            }
          ?>
        </select>
      </div>
    </div>



    <div id="logForm">

      <button id="filterToggle" class="filter-toggle <?php echo $filters_enabled ? 'active' : ''; ?>" title="Activer/Désactiver les filtres" style="width: 134px;">
          <i class="fas fa-filter"></i> Filtres <?php echo $filters_enabled ? 'ON' : 'OFF'; ?>
      </button>



      <div class="filter-group">
        <label>Filtre recherche:</label>
        <input type="text" id="persistentFilter" placeholder="Filtrer les résultats...">
      </div>


      <button id="resetFilters">Réinitialiser</button>

      <div class="length-menu">
        <label>Lignes:</label>
        <select id="lengthMenu">
          <?php
          $default_lines = (int)$config['app']['default_lines_per_page'];
          // Définir les options avec la valeur par défaut incluse
          $options = [10, 25, 32, 50, 100, -1];
          // S'assurer que la valeur par défaut est dans les options
          if (!in_array($default_lines, $options)) {
              $options[] = $default_lines;
              sort($options);
          }
          foreach ($options as $value) {
              $selected = ($value == $default_lines) ? 'selected' : '';
              $display = ($value == -1) ? 'Tout' : $value;
              echo "<option value=\"$value\" $selected>$display</option>";
          }
          ?>
        </select>
      </div>

      <div class="refresh-controls">
        <button id="refreshLogs" class="refresh-button" title="Rafraîchir les logs">
          <i class="fas fa-sync-alt"></i> Rafraîchir
        </button>
        <div class="auto-refresh">
          <label>
            <input type="checkbox" id="autoRefreshToggle">
            Auto-Refresh
          </label>
          <input type="number" id="refreshInterval" value="<?php echo $config['app']['refresh_interval'] ?? 20; ?>" min="5" step="1">
        sec. </div>
      </div>



    </div>

    <div class="output-container">
      <div id="notifications"></div>
      <div id="output">
        <div class="stats-badges">
          <span class="stats-badge total">Total: <span class="count">0</span></span>
          <span class="stats-badge valid">Valides: <span class="count">0</span></span>
          <span class="stats-badge filtered">Ignorés: <span class="count">0</span></span>
          <span class="stats-badge unreadable">Illisibles: <span class="count">0</span></span>
        </div>
        <!-- Le message de bienvenue sera injecté ici par JavaScript -->
      </div>
    </div>

    <footer>
      <div class="footer-left">
        <span id="datetime" class="footer-datetime"></span>
      </div>
      <div class="footer-center">
        <span class="footer-made-by">
          Made with <i class="fas fa-coffee"></i> by 
          <a href="https://github.com/Erreur32" target="_blank">Erreur32</a>
          | <a href="admin/login.php" class="admin-link" ><i class="fas fa-cog"></i> Admin</a>
          | <i class="fab fa-github"></i><a href="https://github.com/Erreur32/LogviewR" target="_blank" style=""> v<?php echo LOGVIEWR_VERSION; ?></a>
        </span>
      </div>
      <div class="footer-right">
        <div class="execution-times" style="display: flex; flex-direction: column; gap: 2px;">
          <!-- Temps de chargement de la page -->
          <div class="execution-time-badge page-load" style="text-align: right;">
            <?php
            $execution_time = microtime(true) - $_SERVER["REQUEST_TIME_FLOAT"];
            echo sprintf('Chargement page: %.4f secondes', $execution_time);
            ?>
          </div>
          
          <!-- Temps d'exécution des scripts -->
          <div class="execution-time-badge script-load" id="execution_time" style="text-align: right;"></div>
        </div>
      </div>
    </footer>
  </div>




  <script>
    let currentLogFile = '';
    const defaultLinesPerPage = <?php echo (int)$config['app']['default_lines_per_page']; ?>;
    
    function toggleTheme() {
      const html = document.documentElement;
      const currentTheme = html.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
      
      // Update theme icon
      const themeIcon = document.getElementById('themeIcon').querySelector('i');
      themeIcon.className = newTheme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
    }

    // Set initial theme icon
    window.addEventListener('DOMContentLoaded', () => {
      const currentTheme = document.documentElement.getAttribute('data-theme');
      const themeIcon = document.getElementById('themeIcon').querySelector('i');
      themeIcon.className = currentTheme === 'dark' ? 'fas fa-moon' : 'fas fa-sun';
    });

    function loadLog(logFile) {
      return new Promise((resolve, reject) => {
        currentLogFile = logFile;
        
        if (!logFile || logFile === '') {
          $('#selectedFileInfo').empty();
          $('#output').empty();
          $('#execution_time').empty();
          updateStatsBadges({}); // Réinitialiser les stats
          showWelcomeMessage();
          resolve();
          return;
        }

        $('.welcome-message').remove();

        const selectedOption = $('.log-select option:selected[value!=""]');
        if (selectedOption.length) {
          const fullText = selectedOption.text();
          const pathParts = selectedOption.val().split('/');
          const fileName = pathParts[pathParts.length - 1];
          const folderName = pathParts[pathParts.length - 2];
          
          // Extraire la taille et la date du texte de l'option
          const sizeMatch = fullText.match(/\((.*?) -/);
          const dateMatch = fullText.match(/- (.*?)\)/);
          
          const size = sizeMatch ? sizeMatch[1].trim() : '';
          const date = dateMatch ? dateMatch[1].trim() : '';
          
          $('#selectedFileInfo').html(`
            <span class="file-info-name">${folderName}/${fileName}</span>
            ${size ? `<span class="file-info">${size}</span>` : ''}
            ${date ? `<span class="file-info-date">${date}</span>` : ''}
          `);
        } else {
          $('#selectedFileInfo').empty();
        }

        $('#output').html('<div class="loading-message">Chargement des logs...</div>');

        $.ajax({
          url: 'script.php',
          method: 'POST',
          data: { 
            logfile: logFile,
            filters_enabled: filtersEnabled ? '1' : '0'
          },
          dataType: 'json',
          success: function(response) {
            console.log('Response received:', response);
            
            if (response.error) {
              $('#output').html('<div class="error-message">' + response.error + '</div>');
              $('#execution_time').empty();
              updateStatsBadges({});
              reject(new Error(response.error));
              return;
            }

            if (!response.lines || response.lines.length === 0) {
              $('#output').html('<div class="info-message">Aucune ligne de log trouvée</div>');
              $('#execution_time').empty();
              updateStatsBadges({});
              resolve();
              return;
            }

            // Initialiser le tableau avec les données
            initLogTable(response, logFile);

            // Mettre à jour les statistiques
            updateStatsBadges(response.stats);

            // Afficher le temps d'exécution
            if (response.execution_time) {
              const seconds = (response.execution_time / 1000).toFixed(4);
              $('#execution_time').html(`Chargement script: ${seconds} secondes`);
            } else {
              $('#execution_time').empty();
            }
            
            resolve();
          },
          error: function(xhr, status, error) {
            console.error('Ajax error:', status, error);
            $('#output').html('<div class="error-message">Erreur lors du chargement des données</div>');
            $('#execution_time').empty();
            updateStatsBadges({});
            reject(error);
          }
        });
      });
    }

    // Fonction pour afficher le message de bienvenue
    function showWelcomeMessage() {
      const welcomeMessage = `
        <div class="welcome-message">
          <div class="welcome-icon">
            <!--     <i class="fas fa-file-alt"></i> -->
            <img src="favicon.png" style="width: 60px; vertical-align: middle; margin-right: 5px;">
          </div>
          <div class="welcome-content">
            <h4>Bienvenue dans LogviewR</h4>
            <p>Votre visualiseur de logs intelligent</p>
            <div class="welcome-features">
              <span><i class="fas fa-search"></i> Recherche avancée</span>
              <span><i class="fas fa-filter"></i> Filtres dynamiques</span>
              <span><i class="fas fa-chart-bar"></i> Statistiques en temps réel</span>
            </div>
          </div>
          <button class="close-message" title="Fermer le message">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `;
      $('#output').html(welcomeMessage);
    }

    // Gestionnaires d'événements pour la sélection des logs
    $('.log-select').on('change', function() {
      const logFile = $(this).val();
      $('.log-select').not(this).val('');
      $('.category').removeClass('active');
      $(this).closest('.category').addClass('active');
      localStorage.setItem('selectedLogFile', logFile);
      
      loadLog(logFile);
    });

    $('#resetFilters').on('click', function(e) {
      e.preventDefault();
      $('#levelFilter').val('');
      $('#persistentFilter').val('');
      $('.log-select').val('');
      $('.category').removeClass('active');
      localStorage.removeItem('persistentFilter');
      localStorage.removeItem('selectedLevel');
      localStorage.removeItem('selectedLogFile');
      $('#selectedFileInfo').empty();
      $('#output').empty();
      $('#execution_time').empty();
      
      // Message de réinitialisation avec style amélioré
      const message = $(`
        <div class="reset-message" style="
          background: #000000;
          border: 1px solid var(--primary-color);
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
          display: flex;
          align-items: flex-start;
          gap: 15px;
          position: relative;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          width: 500px;
          min-width: 500px;
          margin: 20px auto;
        ">
          <div class="reset-icon" style="
            font-size: 24px;
            color: var(--primary-color);
          ">
            <i class="fas fa-sync-alt"></i>
          </div>
          <div class="reset-content">
            <h4 style="margin: 0 0 10px 0; color: #ffffff;">Réinitialisation effectuée</h4>
            <p style="margin: 0 0 15px 0; color: #ffffff;">Les filtres ont été réinitialisés avec succès</p>
            <div class="reset-details" style="
              display: flex;
              flex-direction: column;
              gap: 8px;
              color: #ffffff;
            ">
              <span><i class="fas fa-file-alt"></i> Aucun fichier sélectionné</span>
              <span><i class="fas fa-filter"></i> Filtres effacés</span>
              <span><i class="fas fa-search"></i> Recherche réinitialisée</span>
            </div>
          </div>
          <button class="close-message" style="
            position: absolute;
            top: 10px;
            right: 10px;
            background: none;
            border: none;
            color: var(--primary-color);
            cursor: pointer;
            padding: 5px;
            opacity: 0.8;
            transition: opacity 0.3s;
          ">
            <i class="fas fa-times"></i>
          </button>
        </div>
      `);
      
      $('#output').html(message);
      
      // Animation de rotation de l'icône
      $('.reset-icon i').css({
        'animation': 'spin 1s linear infinite',
        'display': 'inline-block'
      });
      
      // Auto-suppression après 2 secondes et affichage du message de bienvenue
      setTimeout(() => {
        message.fadeOut(300, function() {
          $(this).remove();
          showWelcomeMessage();
        });
      }, 2000);
      
      // Gestionnaire d'événement pour le bouton de fermeture
      message.find('.close-message').on('click', function() {
        message.fadeOut(300, function() {
          $(this).remove();
          showWelcomeMessage();
        });
      });
    });

    // Restaurer les paramètres sauvegardés
    const savedTheme = localStorage.getItem('theme');
    const savedFilter = localStorage.getItem('persistentFilter');
    const savedLevel = localStorage.getItem('selectedLevel');

    // Initialiser le menu de longueur avec la valeur de configuration
    $(document).ready(function() {
      // Récupérer la valeur de configuration
      const configValue = <?php echo (int)$config['app']['default_lines_per_page']; ?>;
      
      // Mettre à jour le select avec la valeur de configuration
      $('#lengthMenu').val(configValue);
      
      // Si la valeur n'existe pas dans les options, sélectionner la plus proche
      if ($('#lengthMenu').val() === null) {
        const values = $('#lengthMenu option').map(function() {
          return parseInt($(this).val());
        }).get().filter(v => v > 0);
        
        const closest = values.reduce(function(prev, curr) {
          return (Math.abs(curr - configValue) < Math.abs(prev - configValue) ? curr : prev);
        });
        $('#lengthMenu').val(closest);
      }
    });

    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
    if (savedFilter) {
      $('#persistentFilter').val(savedFilter);
    }
    if (savedLevel) {
      $('#levelFilter').val(savedLevel);
    }

    // Effacer le fichier sélectionné lors du rafraîchissement de page
    if (window.performance.navigation.type === window.performance.navigation.TYPE_RELOAD) {
      localStorage.removeItem('selectedLogFile');
      showWelcomeMessage();
    } else {
      const savedLogFile = localStorage.getItem('selectedLogFile');
      if (savedLogFile) {
        $('.log-select').val(savedLogFile);
        const activeSelect = $('.log-select').filter(function() {
          return $(this).val() === savedLogFile;
        });
        activeSelect.closest('.category').addClass('active');
        loadLog(savedLogFile);
      } else {
        showWelcomeMessage();
      }
    }

    // Mise à jour de l'heure
    function updateDateTime() {
      const now = new Date();
      const dateStr = now.toLocaleDateString('fr-FR', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
      });
      const timeStr = now.toLocaleTimeString('fr-FR', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });
      document.getElementById('datetime').textContent = `${dateStr} ${timeStr}`;
    }

    updateDateTime();
    setInterval(updateDateTime, 1000);

    // Gestion du rafraîchissement des logs
    let autoRefreshInterval = null;
    const refreshButton = document.getElementById('refreshLogs');
    const autoRefreshToggle = document.getElementById('autoRefreshToggle');
    const refreshIntervalInput = document.getElementById('refreshInterval');

    // Fonction pour rafraîchir les logs
    function refreshLogs() {
      if (!currentLogFile) return;
      
      const button = refreshButton;
      button.classList.add('loading');
      button.disabled = true;
      
      loadLog(currentLogFile)
        .catch(error => {
          console.error('Erreur lors du rafraîchissement:', error);
        })
        .finally(() => {
          button.classList.remove('loading');
          button.disabled = false;
        });
    }

    // Gestionnaire pour le bouton de rafraîchissement
    refreshButton.addEventListener('click', refreshLogs);

    // Gestionnaire pour l'auto-rafraîchissement
    autoRefreshToggle.addEventListener('change', function() {
      if (this.checked) {
        const intervalSeconds = parseInt(refreshIntervalInput.value);
        if (intervalSeconds >= 1) {
          autoRefreshInterval = setInterval(refreshLogs, intervalSeconds * 1000);
        }
      } else {
        if (autoRefreshInterval) {
          clearInterval(autoRefreshInterval);
          autoRefreshInterval = null;
        }
      }
    });

    // Gestionnaire pour la modification de l'intervalle
    refreshIntervalInput.addEventListener('change', function() {
      const valueSeconds = parseInt(this.value);
      if (valueSeconds < 1) {
        this.value = 1;
      }
      
      if (autoRefreshToggle.checked) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = setInterval(refreshLogs, valueSeconds * 1000);
      }
    });

    // Nettoyer l'intervalle lors du changement de fichier
    document.querySelectorAll('.log-select').forEach(select => {
      select.addEventListener('change', function() {
        if (autoRefreshInterval) {
          clearInterval(autoRefreshInterval);
          autoRefreshInterval = null;
          autoRefreshToggle.checked = false;
        }
      });
    });

    // Afficher le message de bienvenue au chargement initial
    $(document).ready(function() {
      if (!currentLogFile) {
        showWelcomeMessage();
      }
      
      // Gestionnaire pour le bouton de fermeture
      $(document).on('click', '.welcome-message .close-message', function() {
        $('.welcome-message').fadeOut(300, function() {
          $(this).remove();
        });
      });
    });

    // Écouter les changements d'état des filtres
    document.addEventListener('filtersStateChanged', function(event) {
        if (currentLogFile) {
            loadLog(currentLogFile);
        }
    });

    // Écouter l'événement de rechargement des logs
    document.addEventListener('reloadLogs', function() {
        if (currentLogFile) {
            loadLog(currentLogFile);
        }
    });

    // Gestion du toggle des filtres
    document.getElementById('filterToggle').addEventListener('click', function() {
        this.classList.toggle('active');
        const isActive = this.classList.contains('active');
        this.innerHTML = `<i class="fas fa-filter"></i> Filtres ${isActive ? 'ON' : 'OFF'}`;
        
        // Sauvegarder l'état des filtres
        fetch('admin/ajax_actions.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `action=update_filters&enabled=${isActive ? '1' : '0'}`
        });
        
        // Mettre à jour l'état des filtres dans les parseurs
        if (typeof updateFiltersState === 'function') {
            updateFiltersState(isActive);
        }
    });


  </script>
 
</body>
</html>
