<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Charger la configuration
$config_file = __DIR__ . '/config/config.php';
$patterns_file = __DIR__ . '/config/log_patterns.php';
require_once __DIR__ . '/includes/config.php';

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
        'excluded_extensions' => ['gz', 'zip', 'tar', 'rar', '7z', 'bz2', 'xz'],
        'max_execution_time' => 300,
        'default_lines_per_page' => 25
    ];
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
function isExcludedFile($filename, $excluded_extensions) {
    if (!is_array($excluded_extensions)) {
        return false;
    }
    $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    return in_array($extension, $excluded_extensions);
}

// Fonction pour lister les fichiers de logs avec gestion des erreurs
function listLogFiles($directory, $excluded_extensions) {
    $files = [];
    if (is_dir($directory)) {
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
                $extension = pathinfo($path, PATHINFO_EXTENSION);
                if (!in_array($extension, $excluded_extensions)) {
                    $files[] = $item;
                }
            }
        }
    }
    return $files;
}

// Lister les fichiers de logs pour chaque type
$log_files = [
    'apache' => listLogFiles($config['paths']['apache_logs'], $config['app']['excluded_extensions']),
    'nginx' => listLogFiles(
        isset($config['nginx']['use_npm']) && $config['nginx']['use_npm'] ? 
            $config['paths']['npm_logs'] : 
            $config['paths']['nginx_logs'], 
        $config['app']['excluded_extensions']
    ),
    'syslog' => listLogFiles($config['paths']['syslog'], $config['app']['excluded_extensions'])
];

require_once __DIR__ . '/includes/Logger.php';

class LogManager {
    private $excluded_extensions;
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
        $this->excluded_extensions = $config['app']['excluded_extensions'];
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
        
        // Vérifier les extensions exclues
        foreach ($this->excluded_extensions as $ext) {
            if (str_ends_with(strtolower($file), '.' . $ext)) {
                return false;
            }
        }
        
        // Vérifier si le fichier est lisible
        if (!is_readable($file)) {
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
            if (isExcludedFile($file, $this->excluded_extensions)) continue;
            
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

// Traitement des actions normales
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LogviewR</title>
  
  <!-- Charger d'abord jQuery -->
  <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
  
  <!-- Puis le JavaScript de DataTables -->
  <script src="https://cdn.datatables.net/1.11.5/js/jquery.dataTables.js"></script>
  
  <!-- CSS externes -->
  <link rel="stylesheet" type="text/css" href="https://cdn.datatables.net/1.11.5/css/jquery.dataTables.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  
  <!-- Notre CSS personnalisé -->


  <link rel="stylesheet" href="assets/css/variables.css">
  <link rel="stylesheet" href="assets/css/base.css">
  <link rel="stylesheet" href="assets/css/table.css">
  <link rel="stylesheet" href="assets/css/badges.css">
  <link rel="stylesheet" href="assets/css/links.css">
  <link rel="stylesheet" href="assets/css/syslog.css">

  
  <!--  Notre JavaScript personnalisé -->
  <script src="assets/js/table.js" defer></script>
  <script src="assets/js/filters.js" defer></script>


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
        <i class="fas fa-scroll"></i>
        <a href="https://v32.myoueb.fr/LogviewR/">LogviewR</a>
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
      <div class="level-filter">
        <label>Niveau </label>
        <select id="levelFilter">
          <option value="">Tous</option>
          <option value="error">Erreurs</option>
          <option value="warning">Avertissements</option>
          <option value="info">Information</option>
          <option value="notice">Notices</option>
        </select>
      </div>

      <div class="filter-group">
        <label>Filtre recherche:</label>
        <input type="text" id="persistentFilter" placeholder="Filtrer les résultats...">
      </div>

      <div class="length-menu">
        <label>Lignes:</label>
        <select id="lengthMenu">
          <option value="10">10</option>
          <option value="25" selected>25</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="-1">Tout</option>
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
          <input type="number" id="refreshInterval" value="<?php echo ($config['app']['refresh_interval'] ?? 1000) / 1000; ?>" min="10" step="10">
          <span>s</span>
        </div>
      </div>

      <button id="filterToggle" class="filter-toggle active" title="Activer/Désactiver les filtres">
        <i class="fas fa-filter"></i> Filtres ON
      </button>

      <button id="resetFilters">Réinitialiser</button>
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
          | <a href="admin/login.php" class="admin-link"><i class="fas fa-cog"></i> Administration</a>
          | <a href="https://github.com/Erreur32/LogviewR" target="_blank"><i class="fab fa-github"></i> v<?php echo LOGVIEWR_VERSION; ?></a>
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
    const defaultLinesPerPage = <?php echo $config['app']['default_lines_per_page']; ?>;
    
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
            filters_enabled: window.getFiltersEnabled() ? '1' : '0'
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
        <div class="welcome-message"  style="border: 1px solid var(--primary-color);">
          <div class="welcome-icon">
            <i class="fas fa-file-alt"></i>
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
      
      // Gérer la visibilité du filtre de niveau
      const isSyslog = $(this).closest('.category').find('h3').text().includes('Syslog');
      $('.level-filter').toggle(isSyslog);
      
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
    $('#lengthMenu').val(defaultLinesPerPage);

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
  </script>
 
</body>
</html>
