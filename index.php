<?php
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Charger la configuration
$config_file = __DIR__ . '/config/config.php';
$patterns_file = __DIR__ . '/config/log_patterns.php';

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
        'log_level' => 'ERROR'
    ];
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

// Configurer le logging
ini_set('log_errors', 1);
ini_set('error_log', $config['debug']['log_file']);

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
        $config['paths']['nginx_logs'], 
        $config['app']['excluded_extensions']
    ),
    'syslog' => listLogFiles($config['paths']['syslog'], $config['app']['excluded_extensions'])
];

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
            self::log("Le répertoire n'existe pas: " . $dir, 'ERROR');
            return $logs;
        }
        
        // Fonction récursive pour trouver tous les fichiers
        $findFiles = function($directory) use (&$findFiles, &$logs) {
            $files = scandir($directory);
            
            foreach ($files as $file) {
                // Ignorer . et ..
                if ($file === '.' || $file === '..') {
                    continue;
                }
                
                $path = $directory . '/' . $file;
                
                // Si c'est un répertoire, le parcourir récursivement
                if (is_dir($path)) {
                    $findFiles($path);
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
            if (preg_match('/^(access\.log|error\.log|404_only\.log|other_vhosts_access\.log)/', $basename)) {
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
        // Créer une instance du parseur NPM
        require_once __DIR__ . '/parsers/NginxProxyManagerParser.php';
        $npmParser = new NginxProxyManagerParser();
        
        // Utiliser le parseur pour catégoriser les logs
        return $npmParser->getLogsByCategory($this->config['paths']['nginx_logs']);
    }

    public function getSysLogs() {
        $all_logs = $this->findLogs($this->config['paths']['syslog']);
        $priority_logs = [];
        $other_logs = [];

        foreach ($all_logs as $log) {
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
  
  <!-- Notre CSS personnalisé 
  <link rel="stylesheet" href=".old/style_old.css_">-->


  <link rel="stylesheet" href="assets/css/variables.css">
  <link rel="stylesheet" href="assets/css/base.css">
  <link rel="stylesheet" href="assets/css/table.css">
  <link rel="stylesheet" href="assets/css/badges.css">
  <link rel="stylesheet" href="assets/css/links.css">
  <link rel="stylesheet" href="assets/css/syslog.css">

  <link rel="stylesheet" href=".old/style_old.css_">

  <!--  Notre JavaScript personnalisé -->
  <script src="assets/js/table.js" defer></script>

  <style>
    .level-filter {
        display: none; /* Caché par défaut */
    }
  </style>
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
      <?php if ($config['debug']['enabled']): ?>
      <div class="header-controls">
        <span class="debug-badge" title="Mode Debug Activé">
          <i class="fas fa-bug"></i>
        </span>
      </div>
      <?php endif; ?>
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
          <?php echo (isset($config['nginx']['use_npm']) && $config['nginx']['use_npm']) ? 'NPM' : 'Nginx'; ?>
          <span class="folder-name">/var/log/nginx</span>
        </h3>
        <select class="log-select" data-type="nginx">
          <option value="">Sélectionner un fichier 👇</option>
          <?php
            $nginx_logs = $logManager->getNginxLogs();
            
            if (!empty($nginx_logs['default'])): ?>
                <optgroup label="Default Host">
                    <?php foreach ($nginx_logs['default'] as $log): ?>
                        <?php echo $logManager->renderLogOption($log); ?>
                    <?php endforeach; ?>
                </optgroup>
            <?php endif;
            
            if (!empty($nginx_logs['dead'])): ?>
                <optgroup label="Dead Host">
                    <?php foreach ($nginx_logs['dead'] as $log): ?>
                        <?php echo $logManager->renderLogOption($log); ?>
                    <?php endforeach; ?>
                </optgroup>
            <?php endif;
            
            if (!empty($nginx_logs['fallback'])): ?>
                <optgroup label="Fallback">
                    <?php foreach ($nginx_logs['fallback'] as $log): ?>
                        <?php echo $logManager->renderLogOption($log); ?>
                    <?php endforeach; ?>
                </optgroup>
            <?php endif;
            
            if (!empty($nginx_logs['other'])): ?>
                <optgroup label="Autres Logs">
                    <?php foreach ($nginx_logs['other'] as $log): ?>
                        <?php echo $logManager->renderLogOption($log); ?>
                    <?php endforeach; ?>
                </optgroup>
            <?php endif;
            
            if (!empty($nginx_logs['proxy'])): ?>
                <optgroup label="Proxy Host">
                    <?php foreach ($nginx_logs['proxy'] as $log): ?>
                        <?php echo $logManager->renderLogOption($log); ?>
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

      <button id="resetFilters">Réinitialiser</button>
    </div>

    <div class="output-container">
      <div id="notifications"></div>
      <div id="output">
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
      currentLogFile = logFile;
      
      if (!logFile || logFile === '') {
        $('#selectedFileInfo').empty();
        $('#output').empty();
        $('#execution_time').empty();
        showWelcomeMessage();
        return;
      }

      $('.welcome-message').remove();

      const selectedOption = $('.log-select option:selected[value!=""]');
      if (selectedOption.length) {
        const fullText = selectedOption.text();
        const matches = fullText.match(/^(.+?) \((.+?) - (.+?)\)$/);
        if (matches) {
          const [, fileName, size, date] = matches;
          const pathParts = selectedOption.val().split('/');
          const folderName = pathParts[pathParts.length - 2];
          
          $('#selectedFileInfo').html(`
            <span class="file-info-name">${folderName}/${fileName}</span>
            <span class="file-info">${size}</span>
            <span class="file-info-date">${date}</span>
          `);
        }
      } else {
        $('#selectedFileInfo').empty();
      }

      $('#output').html('<div class="loading-message">Chargement des logs...</div>');

      $.ajax({
        url: 'script.php',
        method: 'POST',
        data: { logfile: logFile },
        dataType: 'json',
        success: function(response) {
          console.log('Response received:', response); // Debug log
          
          if (response.error) {
            $('#output').html('<div class="error-message">' + response.error + '</div>');
            $('#execution_time').empty();
            return;
          }

          if (!response.lines || response.lines.length === 0) {
            $('#output').html('<div class="info-message">Aucune ligne de log trouvée</div>');
            $('#execution_time').empty();
            return;
          }

          // Initialiser le tableau avec les données
          initLogTable(response, logFile);

          // Afficher le temps d'exécution
          if (response.execution_time) {
            const seconds = (response.execution_time / 1000).toFixed(4);
            console.log('Setting execution time:', seconds); // Debug log
            $('#execution_time').html(`Chargement script: ${seconds} secondes`);
          } else {
            console.log('No execution time in response'); // Debug log
            $('#execution_time').empty();
          }
        },
        error: function(xhr, status, error) {
          console.error('Ajax error:', status, error); // Debug log
          $('#output').html('<div class="error-message">Erreur lors du chargement des données</div>');
          $('#execution_time').empty();
        }
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
      
      // Auto-suppression après 5 secondes et affichage du message de bienvenue
      setTimeout(() => {
        message.fadeOut(300, function() {
          $(this).remove();
          showWelcomeMessage();
        });
      }, 5000);
      
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
    const savedLogFile = localStorage.getItem('selectedLogFile');
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
    if (savedLogFile) {
      $('.log-select').val(savedLogFile);
      const activeSelect = $('.log-select').filter(function() {
        return $(this).val() === savedLogFile;
      });
      activeSelect.closest('.category').addClass('active');
      loadLog(savedLogFile);
    } else {
      const firstLog = $('.log-select:first').val();
      if (firstLog) {
        $('.category:first').addClass('active');
        loadLog(firstLog);
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
  </script>
</body>
</html>
