<?php
session_start();

// Vérifier que les fichiers de configuration existent
$config_file = __DIR__ . '/../config/config.php';
$admin_config_file = __DIR__ . '/../config/admin.php';
$patterns_file = __DIR__ . '/../config/log_patterns.php';

if (!file_exists($config_file)) {
    die('Erreur: Fichier de configuration principal manquant (config.php)');
}

if (!file_exists($admin_config_file)) {
    die('Erreur: Fichier de configuration admin manquant (admin.php)');
}

if (!file_exists($patterns_file)) {
    die('Erreur: Fichier de patterns manquant (log_patterns.php)');
}

// Charger les configurations avec des valeurs par défaut
$default_config = [
    'debug' => [
        'enabled' => false,
        'log_level' => 'ERROR'
    ],
    'app' => [
        'max_execution_time' => 120,
        'max_lines_per_request' => 1000,
        'default_lines_per_page' => 50,
        'refresh_interval' => 1000,
        'excluded_extensions' => []
    ],
    'paths' => [
        'apache_logs' => '/var/log/apache2',
        'nginx_logs' => '/var/log/nginx',
        'syslog' => '/var/log'
    ],
    'date_formats' => [
        'display' => 'd/m/Y H:i:s',
        'file' => 'Y-m-d H:i:s'
    ],
    'themes' => [
        'light' => [
            'primary_color' => '#3498db',
            'text_color' => '#333333',
            'bg_color' => '#ffffff'
        ],
        'dark' => [
            'primary_color' => '#3498db',
            'text_color' => '#ffffff',
            'bg_color' => '#1a1a1a'
        ]
    ],
    'theme' => 'dark'
];

try {
    // Charger la configuration actuelle avec vérification du type
    $loaded_config = require $config_file;
    if (!is_array($loaded_config)) {
        throw new Exception('Configuration invalide: config.php doit retourner un tableau');
    }
    $current_config = array_merge($default_config, $loaded_config);
    
    // Charger la configuration admin
    $admin_config = require $admin_config_file;
    if (!is_array($admin_config)) {
        throw new Exception('Configuration invalide: admin.php doit retourner un tableau');
    }
    
    // Vérifier la structure de la configuration admin
    if (!isset($admin_config['admin']) || !is_array($admin_config['admin'])) {
        $admin_config['admin'] = [
            'username' => 'admin',
            'password' => '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // 'password' par défaut
            'session_timeout' => 3600,
            'min_password_length' => 8,
            'require_special_chars' => true,
            'require_numbers' => true,
            'require_uppercase' => true
        ];
    }
    
    if (!isset($admin_config['security']) || !is_array($admin_config['security'])) {
        $admin_config['security'] = [
            'max_login_attempts' => 5,
            'lockout_time' => 1800
        ];
    }
} catch (Exception $e) {
    die('Erreur de chargement de la configuration: ' . $e->getMessage());
}

// Après la définition de $default_config, ajoutons les patterns et filtres par défaut
$default_patterns = [
    'filters' => [
        'exclude' => [
            'ips' => [
                '/^192\.168\.1\.(10|50)$/',
                '/^127\.0\.0\.1$/',
                '/^10\.0\.0\.1$/'
            ],
            'requests' => [
                '/GET\/server-status\?auto/',
                '/favicon\.ico/',
                '/\.(jpg|png|gif|css|js)$/',
                '/robots\.txt/'
            ],
            'user_agents' => [
                '/bot/',
                '/crawler/',
                '/spider/',
                '/wget/',
                '/curl/',
                '/munin/'
            ],
            'users' => [
                '/^Erreur32$/',
                '/^bot$/',
                '/^crawler$/',
                '/^spider$/'
            ]
        ]
    ],
    'apache' => [
        'access' => [
            'pattern' => '/^(\S+:\d+) (\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|\-)(?:\s+"([^"]*)")?(?:\s+"([^"]*)")?/',
            'columns' => [
                'Host', 'IP', 'Identd', 'User', 'Date', 'Requête', 'Code', 'Taille', 'Referer', 'User-Agent'
            ]
        ],
        'error' => [
            'pattern' => '/^\[(.*?)\] \[([^:]+):([^\]]+)\] (?:\[pid (\d+)(?::tid (\d+))?\])?(?: \[client ([^\]]+)\])? (.*)$/',
            'columns' => [
                'Date', 'Module', 'Level', 'PID', 'TID', 'Client', 'Message'
            ]
        ]
    ],
    'nginx' => [
        'access' => [
            'pattern' => '/^(\S+) - \S+ \[([^\]]+)\] "(.*?)" (\d{3}) (\d+) "(.*?)" "(.*?)"$/'
        ],
        'error' => [
            'pattern' => '/^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: (.*)$/'
        ]
    ],
    'syslog' => [
        'pattern' => '/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^:]+):\s+(.*)$/'
    ]
];

try {
    // Charger les patterns depuis le fichier
    $loaded_patterns = require $patterns_file;
    if (!is_array($loaded_patterns)) {
        throw new Exception('Configuration invalide: log_patterns.php doit retourner un tableau');
    }
    $current_patterns = array_replace_recursive($default_patterns, $loaded_patterns);
} catch (Exception $e) {
    die('Erreur de chargement des patterns: ' . $e->getMessage());
}

// Vérifier la connexion
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    header('Location: login.php');
    exit;
}

// Vérifier le timeout de session
if (!isset($_SESSION['admin_login_time']) || (time() - $_SESSION['admin_login_time'] > ($admin_config['admin']['session_timeout'] ?? 3600))) {
    session_destroy();
    header('Location: login.php?timeout=1');
    exit;
}

// Mettre à jour le temps de connexion
$_SESSION['admin_login_time'] = time();

// Initialiser les variables
$message = '';
$error = '';

// Traitement des actions
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (isset($_POST['action'])) {
        switch ($_POST['action']) {
            case 'update_config':
                try {
                    // Créer un tableau de configuration à jour
                    $new_config = [
                        'debug' => [
                            'enabled' => isset($_POST['debug_enabled']),
                            'log_level' => $_POST['log_level'] ?? 'ERROR'
                        ],
                        'app' => [
                            'max_execution_time' => filter_var($_POST['max_execution_time'] ?? 120, FILTER_VALIDATE_INT),
                            'max_lines_per_request' => filter_var($_POST['max_lines_per_request'] ?? 1000, FILTER_VALIDATE_INT),
                            'default_lines_per_page' => filter_var($_POST['default_lines_per_page'] ?? 50, FILTER_VALIDATE_INT),
                            'refresh_interval' => filter_var($_POST['refresh_interval'] ?? 1000, FILTER_VALIDATE_INT),
                            'excluded_extensions' => isset($_POST['app']['excluded_extensions']) ? 
                                array_filter(array_map('trim', explode("\n", $_POST['app']['excluded_extensions']))) : 
                                ['gz', 'zip', 'tar', 'rar', '7z', 'bz2', 'xz']
                        ],
                        'paths' => [
                            'apache_logs' => $_POST['paths']['apache_logs'] ?? '/var/log/apache2',
                            'nginx_logs' => $_POST['paths']['nginx_logs'] ?? '/var/log/nginx',
                            'syslog' => $_POST['paths']['syslog'] ?? '/var/log'
                        ],
                        'nginx' => [
                            'use_npm' => isset($_POST['use_npm']) ? true : false,
                        ],
                        'date_formats' => [
                            'display' => $_POST['date_formats']['display'] ?? 'd/m/Y H:i:s',
                            'file' => $_POST['date_formats']['file'] ?? 'Y-m-d H:i:s'
                        ],
                        'timezone' => $_POST['timezone'] ?? 'Europe/Paris',
                        'theme' => $_POST['theme'] ?? 'dark'
                    ];

                    // Générer le contenu du fichier de configuration
                    $config_content = "<?php\nreturn " . var_export($new_config, true) . ";\n";

                    // Sauvegarder la configuration
                    if (file_put_contents($config_file, $config_content) === false) {
                        throw new Exception('Impossible d\'écrire le fichier de configuration');
                    }

                    $message = "Configuration mise à jour avec succès";
                    
                    // Recharger la configuration
                    $current_config = require $config_file;
                    
                } catch (Exception $e) {
                    $error = $e->getMessage();
                }
                break;
                
            case 'update_patterns':
                try {
                    // Récupérer les filtres d'exclusion globaux
                    $global_filters = $_POST['filters']['exclude'] ?? [];
                    $new_patterns = ['filters' => ['exclude' => []]];
                    
                    // Traiter chaque type de filtre
                    foreach (['ips', 'requests', 'user_agents', 'users'] as $filter_type) {
                        $filters = array_filter(array_map('trim', explode("\n", $global_filters[$filter_type] ?? '')));
                        $new_patterns['filters']['exclude'][$filter_type] = $filters;
                    }
                    
                    // Récupérer les patterns spécifiques
                    $submitted_patterns = $_POST['patterns'] ?? [];
                    foreach ($submitted_patterns as $type => $patterns) {
                        if (!isset($default_patterns[$type])) continue;
                        
                        $new_patterns[$type] = [];
                        foreach ($patterns as $subtype => $data) {
                            if (!isset($default_patterns[$type][$subtype])) continue;
                            
                            $new_patterns[$type][$subtype] = [
                                'pattern' => $data['pattern'] ?? '',
                                'columns' => $default_patterns[$type][$subtype]['columns'] ?? []
                            ];
                        }
                    }
                    
                    // Fusionner avec les patterns par défaut pour les valeurs manquantes
                    $new_patterns = array_replace_recursive($default_patterns, $new_patterns);
                    
                    // Générer le contenu du fichier
                    $patterns_content = "<?php\n// Configuration des patterns pour chaque type de log\nreturn " . 
                        var_export($new_patterns, true) . ";\n";
                    
                    if (file_put_contents($patterns_file, $patterns_content)) {
                        $message = 'Patterns et filtres mis à jour avec succès';
                        $current_patterns = $new_patterns;
                    } else {
                        throw new Exception('Erreur lors de la mise à jour des patterns et filtres');
                    }
                } catch (Exception $e) {
                    $error = $e->getMessage();
                }
                break;

            case 'change_password':
                $current_password = $_POST['current_password'] ?? '';
                $new_password = $_POST['new_password'] ?? '';
                $confirm_password = $_POST['confirm_password'] ?? '';

                // Vérifier l'ancien mot de passe
                if (!password_verify($current_password, $admin_config['admin']['password'])) {
                    $error = 'Mot de passe actuel incorrect';
                    break;
                }

                // Vérifier la confirmation du nouveau mot de passe
                if ($new_password !== $confirm_password) {
                    $error = 'Les mots de passe ne correspondent pas';
                    break;
                }

                // Vérifier les critères de sécurité
                if (strlen($new_password) < $admin_config['admin']['min_password_length']) {
                    $error = 'Le mot de passe doit contenir au moins ' . $admin_config['admin']['min_password_length'] . ' caractères';
                    break;
                }

                if ($admin_config['admin']['require_special_chars'] && !preg_match('/[^a-zA-Z0-9]/', $new_password)) {
                    $error = 'Le mot de passe doit contenir au moins un caractère spécial';
                    break;
                }

                if ($admin_config['admin']['require_numbers'] && !preg_match('/[0-9]/', $new_password)) {
                    $error = 'Le mot de passe doit contenir au moins un chiffre';
                    break;
                }

                if ($admin_config['admin']['require_uppercase'] && !preg_match('/[A-Z]/', $new_password)) {
                    $error = 'Le mot de passe doit contenir au moins une majuscule';
                    break;
                }

                // Mettre à jour le mot de passe
                $config_file = __DIR__ . '/../config/admin.php';
                $config_content = file_get_contents($config_file);
                $new_hash = password_hash($new_password, PASSWORD_DEFAULT);
                
                $config_content = preg_replace(
                    "/'password' => '[^']*'/",
                    "'password' => '$new_hash'",
                    $config_content
                );

                if (file_put_contents($config_file, $config_content)) {
                    $message = 'Mot de passe mis à jour avec succès';
                } else {
                    $error = 'Erreur lors de la mise à jour du mot de passe';
                }
                break;

            case 'update_paths':
                try {
                    // Créer un tableau de configuration à jour
                    $new_config = $current_config;
                    
                    // Mettre à jour les chemins
                    $new_config['paths'] = [
                        'apache_logs' => $_POST['paths']['apache_logs'] ?? '/var/log/apache2',
                        'nginx_logs' => $_POST['paths']['nginx_logs'] ?? '/var/log/nginx',
                        'syslog' => $_POST['paths']['syslog'] ?? '/var/log'
                    ];
                    
                    // Mettre à jour les extensions exclues
                    $new_config['app']['excluded_extensions'] = isset($_POST['app']['excluded_extensions']) ? 
                        array_filter(array_map('trim', explode("\n", $_POST['app']['excluded_extensions']))) : 
                        ['gz', 'zip', 'tar', 'rar', '7z', 'bz2', 'xz'];

                    // Générer le contenu du fichier de configuration
                    $config_content = "<?php\nreturn " . var_export($new_config, true) . ";\n";

                    // Sauvegarder la configuration
                    if (file_put_contents($config_file, $config_content) === false) {
                        throw new Exception('Impossible d\'écrire le fichier de configuration');
                    }

                    $message = "Chemins et exclusions mis à jour avec succès";
                    
                    // Recharger la configuration
                    $current_config = require $config_file;
                    
                } catch (Exception $e) {
                    $error = $e->getMessage();
                }
                break;

            case 'update_excluded_ips':
                $config = require __DIR__ . '/../config/config.php';
                $config['app']['excluded_ips'] = array_filter(explode("\n", $_POST['excluded_ips']));
                $config['app']['enable_ip_exclusion'] = isset($_POST['enable_ip_exclusion']);
                file_put_contents(__DIR__ . '/../config/config.php', '<?php return ' . var_export($config, true) . ';');
                $message = "Configuration des IPs exclues mise à jour avec succès.";
                break;
        }
    }
}

function isExcludedFile($filename, $excluded_extensions) {
    $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
    return in_array($extension, $excluded_extensions);
}

?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🛠️ LogviewR  -Administration-</title>
    <link rel="stylesheet" href="assets/css/admin.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
</head>
<body>
    <div class="admin-container">
        <div class="admin-header">
            <h1><i class="fas fa-cog"></i> LogviewR   administration</h1>
            <div class="admin-nav">
                <a href="../index.php"><i class="fas fa-home"></i> Retour à l'accueil</a>
                <a href="logout.php" class="btn btn-danger"><i class="fas fa-sign-out-alt"></i> Déconnexion</a>
            </div>
        </div>

        <?php if (!empty($message)): ?>
            <div class="alert alert-success">
                <i class="fas fa-check-circle"></i> <?php echo htmlspecialchars($message); ?>
            </div>
        <?php endif; ?>

        <?php if (!empty($error)): ?>
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-circle"></i> <?php echo htmlspecialchars($error); ?>
            </div>
        <?php endif; ?>

        <!-- Section des onglets -->
        <div class="admin-tabs">
            <a href="?tab=general" class="admin-tab <?php echo (!isset($_GET['tab']) || $_GET['tab'] === 'general') ? 'active' : ''; ?>" data-tab="general">
                <i class="fas fa-cog"></i> Options Générales
            </a>
            <a href="?tab=paths" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'paths') ? 'active' : ''; ?>" data-tab="paths">
                <i class="fas fa-folder"></i> Chemins & Exclusions
            </a>
            <a href="?tab=filters" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'filters') ? 'active' : ''; ?>" data-tab="filters">
                <i class="fas fa-filter"></i> Filtres d'Exclusion
            </a>
            <a href="?tab=patterns" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'patterns') ? 'active' : ''; ?>" data-tab="patterns">
                <i class="fas fa-code"></i> Patterns de Logs
            </a>
            <a href="?tab=theme" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'theme') ? 'active' : ''; ?>" data-tab="theme">
                <i class="fas fa-palette"></i> Thème
            </a>
            <a href="?tab=password" class="admin-tab <?php echo (isset($_GET['tab']) && $_GET['tab'] === 'password') ? 'active' : ''; ?>" data-tab="password">
                <i class="fas fa-key"></i> Mot de passe
            </a>
        </div>

        <!-- Onglet Options Générales -->
        <div class="admin-card" id="general-tab" style="display: block;">
            <h2><i class="fas fa-sliders-h"></i> Options Générales</h2>
            <form method="POST" action="">
                <input type="hidden" name="action" value="update_config">
                <input type="hidden" name="active_tab" id="active_tab" value="general">
                
                <div class="form-group">
                    <h3>🔧 Paramètres de Debug</h3>
                    <div class="settings-container">
                        <div class="settings-column">
                            <div class="option-group debug-toggle">
                        <label class="switch">
                                    <input type="checkbox" name="debug_enabled" id="debug_enabled" <?php echo $current_config['debug']['enabled'] ? 'checked' : ''; ?>>
                            <span class="slider"></span>
                        </label>
                        <label>Activer le mode debug</label>
                    </div>
                        </div>
                        <div class="settings-column">
                            <div class="option-group log-level-container">
                        <label for="log_level">Niveau de log</label>
                                <select id="log_level" name="log_level" class="form-control <?php echo !$current_config['debug']['enabled'] ? 'disabled' : ''; ?>">
                            <?php
                            $levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'NOTICE'];
                            foreach ($levels as $level) {
                                $selected = $current_config['debug']['log_level'] === $level ? 'selected' : '';
                                echo "<option value=\"$level\" $selected>$level</option>";
                            }
                            ?>
                        </select>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <h3>📊 Paramètres d'Affichage</h3>
                    <div class="settings-container">
                        <div class="settings-column">
                    <div class="option-group">
                        <label for="default_lines_per_page">Lignes par page par défaut</label>
                        <input type="number" id="default_lines_per_page" name="default_lines_per_page" 
                               value="<?php echo $current_config['app']['default_lines_per_page'] ?? 50; ?>" class="form-control">
                    </div>
                        </div>
                        <div class="settings-column">
                    <div class="option-group">
                        <label for="refresh_interval">Intervalle de rafraîchissement (ms)</label>
                        <input type="number" id="refresh_interval" name="refresh_interval" 
                               value="<?php echo $current_config['app']['refresh_interval'] ?? 1000; ?>" class="form-control">
                            </div>
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <h3>📅 Formats de Date et Fuseaux Horaires</h3>
                    <div class="option-group">
                        <h4>Format d'affichage dans l'interface</h4>
                        <label for="date_format_display">Format d'affichage</label>
                        <input type="text" id="date_format_display" name="date_formats[display]" 
                               value="<?php echo htmlspecialchars($current_config['date_formats']['display'] ?? 'd/m/Y H:i:s'); ?>" class="form-control">
                        <div class="format-info-container">
                        <div class="format-examples">
                            <h5>Exemples de formats disponibles :</h5>
                            <div class="example-group">
                                <code>d/m/Y H:i:s</code>
                                <span class="arrow">→</span>
                                <span class="result">25/03/2024 14:30:45</span>
                            </div>
                            <div class="example-group">
                                <code>Y-m-d H:i:s</code>
                                <span class="arrow">→</span>
                                <span class="result">2024-03-25 14:30:45</span>
                            </div>
                            <div class="example-group">
                                <code>d M Y H:i:s</code>
                                <span class="arrow">→</span>
                                <span class="result">25 Mar 2024 14:30:45</span>
                            </div>
                        </div>
                        <div class="format-variables">
                            <h5>Variables disponibles :</h5>
                            <div class="variable-group">
                                <code>d</code>
                                <span class="description">Jour du mois (01-31)</span>
                            </div>
                            <div class="variable-group">
                                <code>m</code>
                                <span class="description">Mois (01-12)</span>
                            </div>
                            <div class="variable-group">
                                <code>Y</code>
                                <span class="description">Année complète (2024)</span>
                            </div>
                            <div class="variable-group">
                                <code>H</code>
                                <span class="description">Heure au format 24h (00-23)</span>
                            </div>
                            <div class="variable-group">
                                <code>i</code>
                                <span class="description">Minutes (00-59)</span>
                            </div>
                            <div class="variable-group">
                                <code>s</code>
                                <span class="description">Secondes (00-59)</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="option-group">
                        <h4>Format pour les noms de fichiers</h4>
                        <label for="date_format_file">Format de fichier</label>
                        <input type="text" id="date_format_file" name="date_formats[file]" 
                               value="<?php echo htmlspecialchars($current_config['date_formats']['file'] ?? 'Y-m-d H:i:s'); ?>" class="form-control">
                        <small class="form-text">
                            Format utilisé pour les noms de fichiers de logs.<br>
                            Recommandé : <code>Y-m-d H:i:s</code> pour un tri correct des fichiers
                        </small>
                    </div>

                    <div class="option-group">
                        <h4>Fuseau Horaire</h4>
                        <label for="timezone">Fuseau horaire</label>
                        <select id="timezone" name="timezone" class="form-control">
                            <?php
                            $timezones = DateTimeZone::listIdentifiers();
                            $current_timezone = $current_config['timezone'] ?? 'Europe/Paris';
                            foreach ($timezones as $tz) {
                                $selected = ($current_timezone === $tz) ? 'selected' : '';
                                $dt = new DateTime('now', new DateTimeZone($tz));
                                $offset = $dt->format('P');
                                echo "<option value=\"$tz\" $selected>$tz (UTC$offset)</option>";
                            }
                            ?>
                        </select>
                        <small class="form-text">
                            Fuseau horaire utilisé pour l'affichage des dates dans l'interface.<br>
                            Par défaut : Europe/Paris (UTC+1)
                        </small>
                    </div>
                </div>

                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-save"></i> Sauvegarder les options
                </button>
            </form>
        </div>

        <!-- Onglet Chemins & Exclusions -->
        <div class="admin-card paths-section" id="paths-tab">
            <h2><i class="fas fa-folder-tree"></i> Chemins & Exclusions</h2>
            <form method="POST" action="">
                <input type="hidden" name="action" value="update_paths">
                <input type="hidden" name="active_tab" value="paths">

                <!-- Section Apache -->
                <div class="option-group">
                    <h3><i class="fas fa-server"></i> Apache</h3>
                    <div class="path-group">
                        <div class="path-input-container">
                        <label for="apache_path">Chemin des logs</label>
                        <div class="input-with-example">
                            <input type="text" id="apache_path" name="paths[apache_logs]" 
                                   value="<?php echo htmlspecialchars($current_config['paths']['apache_logs'] ?? ''); ?>" 
                                       class="form-control path-input" placeholder="/var/log/apache2">
                            </div>
                            <div class="path-info">
                                <i class="fas fa-info-circle" title="Chemin par défaut recommandé pour les logs Apache"></i>
                                <code>/var/log/apache2</code>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Section Nginx -->
                <div class="option-group">
                    <h3><i class="fas fa-cubes"></i> <?php echo (isset($current_config['nginx']['use_npm']) && $current_config['nginx']['use_npm']) ? 'NPM' : 'Nginx'; ?></h3>
                    <div class="path-group">
                        <div class="path-input-container">
                        <label for="nginx_path">Chemin des logs</label>
                        <div class="input-with-example">
                            <input type="text" id="nginx_path" name="paths[nginx_logs]" 
                                   value="<?php echo htmlspecialchars($current_config['paths']['nginx_logs'] ?? ''); ?>" 
                                       class="form-control path-input" placeholder="/var/log/nginx">
                            </div>
                            <div class="path-info">
                                <i class="fas fa-info-circle" title="Chemin par défaut recommandé pour les logs Nginx/NPM"></i>
                                <code>/var/log/nginx</code>
                            </div>
                        </div>
                    </div>
                    <div class="option-group">
                        <label class="switch">
                            <input type="checkbox" name="use_npm" id="use_npm" 
                                   <?php echo ($current_config['nginx']['use_npm'] ?? false) ? 'checked' : ''; ?>>
                            <span class="slider"></span>
                        </label>
                        <label>Activer Nginx Proxy Manager</label>
                    </div>
                </div>

                <!-- Section Syslog -->
                <div class="option-group">
                    <h3><i class="fas fa-stream"></i> Syslog</h3>
                    <div class="path-group">
                        <div class="path-input-container">
                        <label for="syslog_path">Chemin des logs</label>
                        <div class="input-with-example">
                            <input type="text" id="syslog_path" name="paths[syslog]" 
                                   value="<?php echo htmlspecialchars($current_config['paths']['syslog'] ?? ''); ?>" 
                                       class="form-control path-input" placeholder="/var/log">
                            </div>
                            <div class="path-info">
                                <i class="fas fa-info-circle" title="Chemin par défaut recommandé pour les logs système"></i>
                                <code>/var/log</code>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Section Exclusions -->
                <div class="option-group exclusions-section">
                    <h3><i class="fas fa-ban"></i> Extensions Exclues</h3>
                    <div class="exclusion-group">
                        <label for="excluded_extensions">Extensions à exclure</label>
                        <div class="exclusion-content">
                            <textarea id="excluded_extensions" name="app[excluded_extensions]" class="form-control" rows="4"><?php
                                if (isset($current_config['app']['excluded_extensions'])) {
                                    echo htmlspecialchars(implode("\n", $current_config['app']['excluded_extensions']));
                                }
                            ?></textarea>
                            <div class="exclusion-examples">
                                <h4><i class="fas fa-lightbulb"></i> Exemples</h4>
                                <div class="example-item">
                                    <code>gz</code>
                                    <span class="example-description">Exclure tous les fichiers .gz</span>
                                </div>
                                <div class="example-item">
                                    <code>zip</code>
                                    <span class="example-description">Exclure tous les fichiers .zip</span>
                                </div>
                                <div class="example-item">
                                    <code>tar</code>
                                    <span class="example-description">Exclure tous les fichiers .tar</span>
                                </div>
                                <div class="example-note">
                                    <i class="fas fa-info-circle"></i>
                                    Une extension par ligne, sans le point (.)
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-save"></i> Sauvegarder les chemins
                </button>
            </form>
        </div>

        <!-- Onglet Filtres d'Exclusion -->
        <div class="admin-card" id="filters-tab" style="display: none;">
            <div class="section patterns-section">
                <h2><i class="fas fa-filter"></i> Filtres d'Exclusion Globaux</h2>
                
                <form method="post" action="">
                    <input type="hidden" name="action" value="update_patterns">
                    <input type="hidden" name="active_tab" value="filters">
                    
                    <div class="global-filters">
                        <h3><i class="fas fa-shield-alt"></i> Filtres d'Exclusion Globaux</h3>
                        
                        <div class="filter-group">
                            <label>
                                <div class="label-content">
                                    <i class="fas fa-network-wired"></i> IPs à Exclure
                                </div>
                                <span class="pattern-help" data-help="Exclure des adresses IP spécifiques des logs. Format: /^192\.168\.1\.(10|50)$/ - Exemple: /^192\.168\.1\.(10|50)$/ exclura les IPs 192.168.1.10 et 192.168.1.50">
                                    <i class="fas fa-question-circle"></i>
                                </span>
                            </label>
                            <textarea name="filters[exclude][ips]" id="exclude_ips" class="pattern-input" rows="4"><?php 
                                if (isset($current_patterns['filters']['exclude']['ip'])) {
                                    echo implode("\n", $current_patterns['filters']['exclude']['ip']);
                                } elseif (isset($current_patterns['filters']['exclude']['ips'])) {
                                    echo implode("\n", $current_patterns['filters']['exclude']['ips']);
                                }
                            ?></textarea>
                            <small><i class="fas fa-info-circle"></i> Un pattern par ligne, format regex (ex: /^192\.168\.1\.(10|50)$/)</small>
                        </div>
                        
                        <div class="filter-group">
                            <label>
                                <div class="label-content">
                                    <i class="fas fa-link"></i> Requêtes à Exclure
                                </div>
                                <span class="pattern-help" data-help="Exclure des requêtes spécifiques des logs. Format: /pattern/ - Exemple: /favicon\.ico/ exclura toutes les requêtes pour favicon.ico, /\.(jpg|png|gif)$/ exclura les requêtes d'images">
                                    <i class="fas fa-question-circle"></i>
                                </span>
                            </label>
                            <textarea name="filters[exclude][requests]" id="exclude_requests" class="pattern-input" rows="4"><?php 
                                echo implode("\n", $current_patterns['filters']['exclude']['requests'] ?? []); 
                            ?></textarea>
                            <small><i class="fas fa-info-circle"></i> Un pattern par ligne (ex: /favicon\.ico/, /\.(jpg|png|gif)$/)</small>
                        </div>
                        
                        <div class="filter-group">
                            <label>
                                <div class="label-content">
                                    <i class="fas fa-robot"></i> User-Agents à Exclure
                                </div>
                                <span class="pattern-help" data-help="Exclure des User-Agents spécifiques des logs. Format: /pattern/ - Exemple: /bot/ exclura tous les bots, /crawler/ exclura les crawlers, /^Mozilla/ exclura les navigateurs standards">
                                    <i class="fas fa-question-circle"></i>
                                </span>
                            </label>
                            <textarea name="filters[exclude][user_agents]" id="exclude_user_agents" class="pattern-input" rows="4"><?php 
                                echo implode("\n", $current_patterns['filters']['exclude']['user_agents'] ?? []); 
                            ?></textarea>
                            <small><i class="fas fa-info-circle"></i> Un pattern par ligne (ex: /bot/, /crawler/, /^Mozilla/)</small>
                        </div>
                        
                        <div class="filter-group">
                            <label>
                                <div class="label-content">
                                    <i class="fas fa-user-slash"></i> Utilisateurs à Exclure
                                </div>
                                <span class="pattern-help" data-help="Exclure des utilisateurs spécifiques des logs. Format: /pattern/ - Exemple: /^anonymous$/ exclura l'utilisateur 'anonymous', /^-$/ exclura les utilisateurs non authentifiés, /^admin$/ exclura l'administrateur">
                                    <i class="fas fa-question-circle"></i>
                                </span>
                            </label>
                            <textarea name="filters[exclude][users]" id="exclude_users" class="pattern-input" rows="4"><?php 
                                echo implode("\n", $current_patterns['filters']['exclude']['users'] ?? []); 
                            ?></textarea>
                            <small><i class="fas fa-info-circle"></i> Un pattern par ligne (ex: /^anonymous$/, /^-$/, /^admin$/)</small>
                        </div>

                        <div class="filter-group">
                            <label>
                                <i class="fas fa-search"></i> Contenu Général à Exclure
                                <span class="pattern-help" data-help="Format: /pattern/ - Exclut les lignes contenant ce pattern, quelle que soit la colonne">
                                    <i class="fas fa-question-circle"></i>
                                </span>
                            </label>
                            <textarea name="filters[exclude][content]" id="exclude_content" class="pattern-input" rows="4"><?php 
                                echo implode("\n", $current_patterns['filters']['exclude']['content'] ?? []); 
                            ?></textarea>
                            <small><i class="fas fa-info-circle"></i> Un pattern par ligne (ex: /maintenance/, /health[_-]check/)</small>
                        </div>
                    </div>
                    
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">
                            <i class="fas fa-save"></i> Enregistrer les Filtres
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Onglet Patterns de Logs -->
        <div class="admin-card" id="patterns-tab" style="display: none;">
            <div class="section patterns-section">
                <h2><i class="fas fa-code"></i> Patterns de Logs par Type</h2>
                
                <form method="post" action="">
                    <input type="hidden" name="action" value="update_patterns">
                    <input type="hidden" name="active_tab" value="patterns">
                    
                    <div class="log-patterns">
                        <?php 
                        $pattern_icons = [
                            'apache' => 'fa-server',
                            'nginx' => 'fa-cubes',
                            'npm' => 'fa-cubes',
                            'syslog' => 'fa-stream'
                        ];
                        
                        // Définir les types de patterns à afficher
                        $pattern_types = ['apache', 'nginx', 'npm', 'syslog'];
                        
                        // Afficher les patterns pour chaque type
                        foreach ($pattern_types as $type): 
                            // Masquer les patterns NPM si NPM n'est pas activé
                            $display_style = ($type === 'npm' && !($current_config['nginx']['use_npm'] ?? false)) ? 'style="display: none;"' : '';
                            // Masquer les patterns Nginx si NPM est activé
                            $display_style = ($type === 'nginx' && ($current_config['nginx']['use_npm'] ?? false)) ? 'style="display: none;"' : $display_style;
                        ?>
                            <div class="pattern-group" id="<?php echo $type; ?>_patterns" <?php echo $display_style; ?>>
                                <h4>
                                    <i class="fas <?php echo $pattern_icons[$type]; ?>"></i>
                                    <?php echo ucfirst($type); ?>
                                </h4>
                                <?php if ($type !== 'syslog'): ?>
                                    <?php foreach (['access', 'error'] as $subtype): ?>
                                        <div class="pattern-subgroup" data-type="<?php echo $subtype; ?>">
                                            <label>
                                                <i class="fas <?php echo $subtype === 'access' ? 'fa-file-alt' : 'fa-exclamation-triangle'; ?>"></i>
                                                Pattern <?php echo ucfirst($subtype); ?>
                                                <span class="pattern-help" data-help="Format regex pour les logs <?php echo $subtype; ?> de <?php echo $type; ?>">
                                                    <i class="fas fa-question-circle"></i>
                                                </span>
                                            </label>
                                            <?php
                                            $pattern = isset($current_patterns[$type][$subtype]['pattern']) ? 
                                                (is_string($current_patterns[$type][$subtype]['pattern']) ? 
                                                    $current_patterns[$type][$subtype]['pattern'] : '') : '';
                                            ?>
                                            <input type="text" 
                                                   name="patterns[<?php echo $type; ?>][<?php echo $subtype; ?>][pattern]" 
                                                   id="<?php echo "{$type}_{$subtype}_pattern"; ?>"
                                                   class="pattern-input"
                                                   value="<?php echo htmlspecialchars($pattern); ?>">
                                            <div class="pattern-example">
                                                <i class="fas fa-lightbulb"></i>
                                                <code><?php
                                                $examples = [
                                                    'apache_access' => '/^(\S+:\d+) (\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+|\-)$/',
                                                    'apache_error' => '/^\[(.*?)\] \[([^:]+):([^\]]+)\] (?:\[pid (\d+)\])? (.*)$/',
                                                    'nginx_access' => '/^(\S+) - \S+ \[([^\]]+)\] "(.*?)" (\d{3}) (\d+) "(.*?)" "(.*?)"$/',
                                                    'nginx_error' => '/^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: (.*)$/',
                                                    'npm_access' => '/^(\S+) - \S+ \[([^\]]+)\] "(.*?)" (\d{3}) (\d+) "(.*?)" "(.*?)"$/',
                                                    'npm_error' => '/^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: (.*)$/'
                                                ];
                                                echo htmlspecialchars($examples["{$type}_{$subtype}"] ?? '');
                                                ?></code>
                                            </div>
                                        </div>
                                    <?php endforeach; ?>
                                <?php else: ?>
                                    <div class="pattern-subgroup">
                                        <label>
                                            <i class="fas fa-file-code"></i>
                                            Pattern Syslog
                                            <span class="pattern-help" data-help="Format regex pour les logs système">
                                                <i class="fas fa-question-circle"></i>
                                            </span>
                                        </label>
                                        <?php
                                        $pattern = isset($current_patterns['syslog']['pattern']) ? 
                                            (is_string($current_patterns['syslog']['pattern']) ? 
                                                $current_patterns['syslog']['pattern'] : '') : '';
                                        ?>
                                        <input type="text" 
                                               name="patterns[syslog][pattern]" 
                                               id="syslog_pattern"
                                               class="pattern-input"
                                               value="<?php echo htmlspecialchars($pattern); ?>">
                                        <div class="pattern-example">
                                            <i class="fas fa-lightbulb"></i>
                                            <code>/^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^:]+):\s+(.*)$/</code>
                                        </div>
                                    </div>
                                <?php endif; ?>
                            </div>
                        <?php endforeach; ?>
                    </div>
                    
                    <div class="form-actions">
                        <button type="submit" class="btn btn-primary">
                            <i class="fas fa-save"></i> Enregistrer les Patterns
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- Nouvel onglet Thème -->
        <div class="admin-card" id="theme-tab" style="display: none;">
            <h2><i class="fas fa-palette"></i> Configuration du Thème</h2>
            <form method="POST" action="">
                <input type="hidden" name="action" value="update_config">
                <input type="hidden" name="active_tab" id="active_tab" value="theme">
                
                <div class="form-group">
                    <h3>Sélection du Thème</h3>
                    <div class="theme-selector">
                        <div class="theme-option">
                            <input type="radio" id="theme_light" name="theme" value="light" 
                                   <?php echo (!isset($current_config['theme']) || $current_config['theme'] === 'light') ? 'checked' : ''; ?>>
                            <label for="theme_light" class="theme-preview light">
                                <span class="theme-name">Thème Clair</span>
                                <div class="theme-colors">
                                    <span class="color" style="background: <?php echo $current_config['themes']['light']['primary_color'] ?? '#3498db'; ?>"></span>
                                    <span class="color" style="background: <?php echo $current_config['themes']['light']['text_color'] ?? '#333333'; ?>"></span>
                                    <span class="color" style="background: <?php echo $current_config['themes']['light']['bg_color'] ?? '#ffffff'; ?>"></span>
                                </div>
                                <small class="theme-description">Pour une utilisation en environnements très lumineux</small>
                            </label>
                        </div>
                        
                        <div class="theme-option">
                            <input type="radio" id="theme_dark" name="theme" value="dark"
                                   <?php echo (isset($current_config['theme']) && $current_config['theme'] === 'dark') ? 'checked' : ''; ?>>
                            <label for="theme_dark" class="theme-preview dark">
                                <span class="theme-name">Thème Sombre</span>
                                <div class="theme-colors">
                                    <span class="color" style="background: <?php echo $current_config['themes']['dark']['primary_color'] ?? '#3498db'; ?>"></span>
                                    <span class="color" style="background: <?php echo $current_config['themes']['dark']['text_color'] ?? '#ffffff'; ?>"></span>
                                    <span class="color" style="background: <?php echo $current_config['themes']['dark']['bg_color'] ?? '#1a1a1a'; ?>"></span>
                                </div>
                                <small class="theme-description">Réduit la fatigue oculaire, idéal pour une utilisation prolongée</small>
                            </label>
                        </div>
                    </div>
                </div>

                <div class="form-group">
                    <h3>Personnalisation des Couleurs</h3>
                    <div class="color-customization">
                        <div class="color-group">
                            <h4>Thème Clair</h4>
                            <div class="color-input">
                                <label for="light_primary_color">Couleur principale</label>
                                <input type="color" id="light_primary_color" name="themes[light][primary_color]" 
                                       value="<?php echo $current_config['themes']['light']['primary_color'] ?? '#3498db'; ?>">
                            </div>
                            <div class="color-input">
                                <label for="light_text_color">Couleur du texte</label>
                                <input type="color" id="light_text_color" name="themes[light][text_color]" 
                                       value="<?php echo $current_config['themes']['light']['text_color'] ?? '#333333'; ?>">
                            </div>
                            <div class="color-input">
                                <label for="light_bg_color">Couleur de fond</label>
                                <input type="color" id="light_bg_color" name="themes[light][bg_color]" 
                                       value="<?php echo $current_config['themes']['light']['bg_color'] ?? '#ffffff'; ?>">
                            </div>
                        </div>

                        <div class="color-group">
                            <h4>Thème Sombre</h4>
                            <div class="color-input">
                                <label for="dark_primary_color">Couleur principale</label>
                                <input type="color" id="dark_primary_color" name="themes[dark][primary_color]" 
                                       value="<?php echo $current_config['themes']['dark']['primary_color'] ?? '#3498db'; ?>">
                            </div>
                            <div class="color-input">
                                <label for="dark_text_color">Couleur du texte</label>
                                <input type="color" id="dark_text_color" name="themes[dark][text_color]" 
                                       value="<?php echo $current_config['themes']['dark']['text_color'] ?? '#ffffff'; ?>">
                            </div>
                            <div class="color-input">
                                <label for="dark_bg_color">Couleur de fond</label>
                                <input type="color" id="dark_bg_color" name="themes[dark][bg_color]" 
                                       value="<?php echo $current_config['themes']['dark']['bg_color'] ?? '#1a1a1a'; ?>">
                            </div>
                        </div>
                    </div>
                </div>

                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-save"></i> Sauvegarder les paramètres du thème
                </button>
            </form>
        </div>

        <!-- Nouvel onglet Mot de passe -->
        <div class="admin-card" id="password-tab" style="display: none;">
            <h2>🔐 Sécurité du Compte</h2>
            <form method="POST" action="">
                <input type="hidden" name="action" value="change_password">
                <input type="hidden" name="active_tab" id="active_tab" value="password">
                
                <div class="form-group">
 
                    <div class="password-section">
                        <h4><i class="fas fa-key"></i> Changer le mot de passe</h4>
                        <div class="option-group">
                    <label for="current_password">Mot de passe actuel</label>
                            <input type="password" id="current_password" name="current_password" class="form-control">
                </div>
                        <div class="option-group">
                    <label for="new_password">Nouveau mot de passe</label>
                            <input type="password" id="new_password" name="new_password" class="form-control">
                        </div>
                        <div class="option-group">
                            <label for="confirm_password">Confirmer le nouveau mot de passe</label>
                            <input type="password" id="confirm_password" name="confirm_password" class="form-control">
                        </div>
                        <div class="password-requirements">
                            <h5><i class="fas fa-info-circle"></i> Exigences du mot de passe</h5>
                            <ul>
                                <li><i class="fas fa-check"></i> Au moins 8 caractères</li>
                                <li><i class="fas fa-check"></i> Au moins une lettre majuscule</li>
                                <li><i class="fas fa-check"></i> Au moins un chiffre</li>
                                <li><i class="fas fa-check"></i> Au moins un caractère spécial</li>
                        </ul>
                </div>
                    </div>
                </div>

                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-save"></i> Mettre à jour le mot de passe
                </button>
            </form>
        </div>
    </div>

    <script>
    document.addEventListener('DOMContentLoaded', function() {
        // Initialiser les objets de parsers pour la mise à jour dynamique
        window.apacheParser = {
            excludePatterns: <?php echo json_encode($current_patterns['filters']['exclude'] ?? []); ?>
        };
        
        window.nginxParser = {
            excludePatterns: <?php echo json_encode($current_patterns['filters']['exclude'] ?? []); ?>
        };
        
        // Gestion des onglets
        const tabs = document.querySelectorAll('.admin-tab');
        const tabContents = document.querySelectorAll('.admin-card');
        const activeTabInputs = document.querySelectorAll('input[name="active_tab"]');

        // Fonction pour mettre à jour tous les champs active_tab
        function updateActiveTabInputs(tabId) {
            activeTabInputs.forEach(input => {
                input.value = tabId;
            });
        }

        function switchTab(tab) {
            const tabId = tab.getAttribute('data-tab');
            
            // Désactiver tous les onglets
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.style.display = 'none');

            // Activer l'onglet cliqué
            tab.classList.add('active');
            const content = document.getElementById(tabId + '-tab');
            if (content) {
                content.style.display = 'block';
                updateActiveTabInputs(tabId);
                
                // Mettre à jour l'URL sans recharger la page
                const url = new URL(window.location);
                url.searchParams.set('tab', tabId);
                window.history.pushState({}, '', url);
            }
        }

        // Ajouter les événements de clic sur les onglets
        tabs.forEach(tab => {
            tab.addEventListener('click', function(e) {
                e.preventDefault();
                switchTab(this);
            });
        });

        // Récupérer l'onglet actif depuis l'URL
        const urlParams = new URLSearchParams(window.location.search);
        const activeTab = urlParams.get('tab') || 'general';
        const initialTab = document.querySelector(`.admin-tab[data-tab="${activeTab}"]`);
        if (initialTab) {
            switchTab(initialTab);
        }

        // Gestion du toggle de debug
        const debugToggle = document.getElementById('debug_enabled');
        const logLevelSelect = document.getElementById('log_level');
        
        if (debugToggle && logLevelSelect) {
            debugToggle.addEventListener('change', function() {
                if (this.checked) {
                    logLevelSelect.classList.remove('disabled');
                } else {
                    logLevelSelect.classList.add('disabled');
                }
            });
        }

        // Gestion du switch NPM
        const npmSwitch = document.getElementById('use_npm');
        const nginxTitle = document.querySelector('.option-group h3 i.fa-cubes').parentNode;
        const nginxPatterns = document.getElementById('nginx_patterns');
        const npmPatterns = document.getElementById('npm_patterns');
        
        if (npmSwitch) {
            npmSwitch.addEventListener('change', function() {
                const value = this.checked ? '1' : '0';
                this.value = value;
                
                // Mettre à jour le titre
                if (this.checked) {
                    nginxTitle.innerHTML = '<i class="fas fa-cubes"></i> NPM';
                    if (nginxPatterns) nginxPatterns.style.display = 'none';
                    if (npmPatterns) npmPatterns.style.display = 'block';
                } else {
                    nginxTitle.innerHTML = '<i class="fas fa-cubes"></i> Nginx';
                    if (nginxPatterns) nginxPatterns.style.display = 'block';
                    if (npmPatterns) npmPatterns.style.display = 'none';
                }
            });
        }

        // Gestion des formulaires
        const forms = document.querySelectorAll('form');
        forms.forEach(form => {
            form.addEventListener('submit', async function(e) {
                e.preventDefault();
                const activeTab = document.querySelector('.admin-tab.active').getAttribute('data-tab');
                const formData = new FormData(this);
                formData.set('active_tab', activeTab);

                // Désactiver le bouton de soumission
                const submitButton = this.querySelector('button[type="submit"]');
                const originalButtonText = submitButton.innerHTML;
                submitButton.disabled = true;
                submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...';

                try {
                    const response = await fetch(window.location.href, {
                        method: 'POST',
                        body: formData
                    });

                    if (!response.ok) {
                        throw new Error('Erreur lors de la mise à jour');
                        }

                        // Afficher le message de succès
                        const messageDiv = document.createElement('div');
                        messageDiv.className = 'alert alert-success';
                    messageDiv.innerHTML = '<i class="fas fa-check-circle"></i> Configuration mise à jour avec succès';
                        document.querySelector('.admin-container').insertBefore(messageDiv, document.querySelector('.admin-container').firstChild);

                    // Si c'est le formulaire des filtres d'exclusion
                    if (formData.get('action') === 'update_patterns' && activeTab === 'filters') {
                        // Recharger la page après un court délai
                        setTimeout(() => {
                            window.location.href = window.location.pathname + '?tab=filters';
                        }, 1000);
                    } else {
                        // Pour les autres formulaires, faire disparaître le message après 3 secondes
                        setTimeout(() => {
                            messageDiv.style.animation = 'fadeOut 0.5s ease-out';
                            setTimeout(() => {
                                messageDiv.remove();
                            }, 500);
                        }, 3000);
                    }

                } catch (error) {
                    // Afficher le message d'erreur
                    const messageDiv = document.createElement('div');
                    messageDiv.className = 'alert alert-danger';
                    messageDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${error.message}`;
                    document.querySelector('.admin-container').insertBefore(messageDiv, document.querySelector('.admin-container').firstChild);

                    // Faire disparaître le message après 3 secondes
                    setTimeout(() => {
                        messageDiv.style.animation = 'fadeOut 0.5s ease-out';
                        setTimeout(() => {
                            messageDiv.remove();
                        }, 500);
                    }, 3000);
                } finally {
                    // Réactiver le bouton de soumission
                    submitButton.disabled = false;
                    submitButton.innerHTML = originalButtonText;
                }
            });
        });

        // Fonction pour mettre à jour l'affichage des patterns
        function updatePatternDisplay(fieldId, patterns) {
            const textarea = document.getElementById(fieldId);
            if (!textarea) return;
            
            // Mettre à jour le contenu du textarea
            textarea.value = patterns.join('\n');
            
            // Ajouter une animation pour indiquer la mise à jour
            textarea.classList.add('updated');
            setTimeout(() => {
                textarea.classList.remove('updated');
            }, 1000);
        }

        // Fonction pour recharger les logs en arrière-plan
        function reloadLogsInBackground() {
            // Créer un message de notification
            const notification = document.createElement('div');
            notification.className = 'alert alert-info';
            notification.innerHTML = '<i class="fas fa-sync fa-spin"></i> Mise à jour des filtres en cours...';
            document.querySelector('.admin-container').insertBefore(notification, document.querySelector('.admin-container').firstChild);
            
            // Faire une requête AJAX pour recharger les logs
            fetch('../index.php?action=reload_logs', {
                method: 'GET',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest'
                }
            })
            .then(response => {
                if (response.ok) {
                    // Mettre à jour la notification
                    notification.className = 'alert alert-success';
                    notification.innerHTML = '<i class="fas fa-check-circle"></i> Filtres mis à jour avec succès';
                } else {
                    // Erreur
                    notification.className = 'alert alert-warning';
                    notification.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Les filtres ont été sauvegardés mais la mise à jour des logs a échoué';
                }
            })
            .catch(error => {
                // Erreur réseau
                notification.className = 'alert alert-warning';
                notification.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Les filtres ont été sauvegardés mais la mise à jour des logs a échoué';
            })
            .finally(() => {
                // Faire disparaître la notification après 3 secondes
                setTimeout(() => {
                    notification.style.animation = 'fadeOut 0.5s ease-out';
                    setTimeout(() => {
                        notification.remove();
                    }, 500);
                }, 3000);
            });
        }

        // Styles pour les zones de texte des filtres
        const textareas = document.querySelectorAll('.filter-group textarea.pattern-input');
        
        function adjustHeight(textarea) {
            textarea.style.height = 'auto';
            const scrollHeight = textarea.scrollHeight;
            textarea.style.height = scrollHeight + 'px';
            
            // Ajuster la hauteur minimale en fonction du contenu
            const lineCount = textarea.value.split('\n').length;
            const minHeight = Math.max(32, lineCount * 24); // 24px par ligne
            textarea.style.minHeight = minHeight + 'px';
        }
        
        textareas.forEach(textarea => {
            // Ajuster la hauteur initiale
            adjustHeight(textarea);
            
            // Ajuster la hauteur lors de la saisie
            textarea.addEventListener('input', function() {
                adjustHeight(this);
            });
            
            // Ajuster la hauteur lors du redimensionnement de la fenêtre
            window.addEventListener('resize', function() {
                adjustHeight(textarea);
            });

            // Ajuster la hauteur lors du collage
            textarea.addEventListener('paste', function() {
                setTimeout(() => adjustHeight(this), 0);
            });
        });

        // Fonction de validation des chemins
        function validatePath(input) {
            const path = input.value.trim();
            const isWindows = path.match(/^[a-zA-Z]:\\/) !== null;
            const isUnix = path.startsWith('/');
            
            if (path === '') {
                showValidationStatus(input, false, 'Le chemin ne peut pas être vide');
                return false;
            }
            
            if (!isWindows && !isUnix) {
                showValidationStatus(input, false, 'Format de chemin invalide');
                return false;
            }
            
            showValidationStatus(input, true);
            return true;
        }

        // Fonction de validation des expressions régulières
        function validatePattern(input) {
            const patterns = input.value.trim().split('\n').filter(p => p.trim() !== '');
            
            if (patterns.length === 0) {
                showValidationStatus(input, true);
                return true;
            }
            
            for (const pattern of patterns) {
                try {
                    if (!pattern.startsWith('/') || !pattern.endsWith('/')) {
                        showValidationStatus(input, false, `Format invalide: ${pattern} - Doit être entouré de /`);
                        return false;
                    }
                    new RegExp(pattern.slice(1, -1));
                } catch (e) {
                    showValidationStatus(input, false, `Expression régulière invalide: ${pattern}`);
                    return false;
                }
            }
            
            showValidationStatus(input, true);
            return true;
        }

        // Fonction pour ajouter un indicateur de validation
        function showValidationStatus(input, isValid, message = '') {
            const container = input.closest('.path-input-container, .filter-group');
            let statusContainer = container.querySelector('.validation-status');
            
            if (!statusContainer) {
                statusContainer = document.createElement('div');
                statusContainer.className = 'validation-status';
                
                if (container.classList.contains('path-input-container')) {
                    // Pour les chemins de logs, ajouter après le label
                    container.querySelector('label').appendChild(statusContainer);
                } else {
                    // Pour les filtres, ajouter après l'icône d'aide
                    container.querySelector('.pattern-help').after(statusContainer);
                }
            }
            
            statusContainer.innerHTML = isValid ? 
                '<i class="fas fa-check-circle" title="Valide"></i>' : 
                `<i class="fas fa-exclamation-circle" title="${message}"></i>`;
            
            statusContainer.className = `validation-status ${isValid ? 'valid' : 'invalid'}`;
        }

        // Validation des chemins
        const pathInputs = document.querySelectorAll('.path-input');
        pathInputs.forEach(input => {
            input.addEventListener('input', () => validatePath(input));
            validatePath(input);
        });

        // Validation des filtres d'exclusion
        const patternInputs = document.querySelectorAll('.pattern-input');
        patternInputs.forEach(input => {
            input.addEventListener('input', () => validatePattern(input));
            validatePattern(input);
        });
    });
    </script>
    
 
</body>
</html> 