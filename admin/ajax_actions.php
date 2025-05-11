<?php
// Vérifier si la session n'est pas déjà démarrée
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

// Inclure les fonctions nécessaires
require_once __DIR__ . '/functions.php';
require_once __DIR__ . '/../includes/PatternManager.php';

// Vérifier si l'utilisateur est connecté
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    die(json_encode(['success' => false, 'message' => 'Non autorisé']));
}

// Initialiser le gestionnaire de patterns
$patternManager = new PatternManager();

// Fonction de validation des données
function validateConfig($config) {
    $errors = [];

    // Vérifier la structure de base
    if (!is_array($config)) {
        $errors[] = "La configuration doit être un tableau";
        return $errors;
    }

    // Vérifier les sections requises
    $requiredSections = ['app', 'paths', 'nginx', 'filters', 'themes', 'security', 'admin'];
 

    // Validation des chemins
    if (isset($config['paths'])) {
        foreach ($config['paths'] as $key => $path) {
            if (!is_string($path) || !preg_match('/^\/[a-zA-Z0-9\/_-]+$/', $path)) {
                $errors[] = "Chemin invalide pour '$key': $path";
            }
        }
    }

    // Validation des thèmes
    if (isset($config['themes'])) {
        $requiredThemes = ['light', 'dark'];
        foreach ($requiredThemes as $theme) {
            if (!isset($config['themes'][$theme])) {
                $errors[] = "Thème '$theme' manquant";
            } else {
                $requiredColors = ['primary_color', 'text_color', 'bg_color'];
                foreach ($requiredColors as $color) {
                    if (!isset($config['themes'][$theme][$color])) {
                        $errors[] = "Couleur '$color' manquante pour le thème '$theme'";
                    }
                }
            }
        }
    }

    return $errors;
}

// Fonction pour sauvegarder les patterns
function savePatterns($patterns, $filePath) {
    // Remove unwanted keys if present (safety for legacy POST data)
    unset($patterns['action'], $patterns['active_tab']);
    
    // Initialize user patterns array
    $user_patterns = [];
    
    // Load existing user patterns if file exists
    if (file_exists($filePath)) {
        try {
            $user_patterns = require $filePath;
            // Remove redundant 'patterns' key if it exists
            if (isset($user_patterns['patterns'])) {
                unset($user_patterns['patterns']);
            }
        } catch (Exception $e) {
            error_log('Error loading user patterns: ' . $e->getMessage());
            $user_patterns = [];
        }
    }
    
    // Only update patterns that have been modified
    foreach ($patterns as $type => $type_patterns) {
        if (!isset($user_patterns[$type])) {
            $user_patterns[$type] = [];
        }
        
        foreach ($type_patterns as $pattern_type => $pattern_data) {
            if (isset($pattern_data['pattern']) && !empty($pattern_data['pattern'])) {
                // Validate pattern format
                if (preg_match('/^\/.*\/[imsxADSUXJu]*$/', $pattern_data['pattern'])) {
                    $user_patterns[$type][$pattern_type] = $pattern_data;
                } else {
                    error_log('Invalid pattern format: ' . $pattern_data['pattern']);
                    return false;
                }
            }
        }
    }
    
    // Create directory if it doesn't exist
    $dir = dirname($filePath);
    if (!is_dir($dir)) {
        if (!mkdir($dir, 0755, true)) {
            error_log('Failed to create directory: ' . $dir);
            return false;
        }
    }
    
    // Write only the modified patterns
    $content = "<?php\n// User defined patterns\nreturn " . var_export($user_patterns, true) . ";\n";
    if (file_put_contents($filePath, $content) === false) {
        error_log('Failed to write patterns file: ' . $filePath);
        return false;
    }

    // Clear cache
    clearstatcache(true, $filePath);
    if (function_exists('opcache_invalidate')) {
        opcache_invalidate($filePath, true);
    }

    return true;
}

// Fonction pour formater les patterns
function formatPatterns($array, $indent = 2) {
    $result = "array (\n";
    $spaces = str_repeat(' ', $indent);
    
    foreach ($array as $key => $value) {
        $result .= $spaces;
        
        // Handle numeric keys for patterns
        if (is_numeric($key)) {
            $result .= $key . ' => ';
        } else {
            $result .= "'" . addslashes($key) . "' => ";
        }
        
        if (is_array($value)) {
            $result .= formatPatterns($value, $indent + 2);
        } else {
            // Special handling for regex patterns
            if (is_string($value) && preg_match('/^\/.*\/[imsxADSUXJu]*$/', $value)) {
                $result .= $value;
            } else {
                $result .= "'" . addslashes($value) . "'";
            }
        }
        
        $result .= ",\n";
    }
    
    $result .= str_repeat(' ', $indent - 2) . ")";
    return $result;
}

// Traiter les actions POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    
    switch($action) {
        case 'update_patterns':
            if (!isset($_POST['patterns'])) {
                echo json_encode(['success' => false, 'message' => 'Aucun pattern reçu']);
                exit;
            }

            $patterns = json_decode($_POST['patterns'], true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                echo json_encode(['success' => false, 'message' => 'Format de patterns invalide']);
                exit;
            }

            // Utiliser la classe PatternManager pour sauvegarder les patterns
            $result = $patternManager->savePatterns($patterns);
            if ($result['success']) {
                error_log('Patterns sauvegardés avec succès via PatternManager');
                echo json_encode(['success' => true, 'message' => 'Patterns sauvegardés avec succès']);
            } else {
                error_log('Erreur lors de la sauvegarde des patterns: ' . ($result['message'] ?? 'Erreur inconnue'));
                echo json_encode(['success' => false, 'message' => $result['message'] ?? 'Erreur lors de la sauvegarde des patterns']);
            }
            break;
            
        case 'reset_patterns':
            // Réinitialisation des patterns
            $result = $patternManager->resetPatterns();
            die(json_encode($result));
            break;
            
        case 'validate_pattern':
            // Validation d'un seul pattern
            if (!isset($_POST['pattern'])) {
                die(json_encode(['valid' => false, 'message' => 'Pattern manquant']));
            }
            $result = $patternManager->validatePattern($_POST['pattern']);
            die(json_encode($result));
            break;
            
        case 'update_config':
            // Always load the default config for robust merging
            $default_config_file = __DIR__ . '/../config/config.php';
            $config_file = __DIR__ . '/../config/config.user.php';
            $admin_file = __DIR__ . '/../config/admin.php';
            $defaultConfig = file_exists($default_config_file) ? require $default_config_file : [];
            $currentConfig = file_exists($config_file) ? require $config_file : [];
            $adminConfig = file_exists($admin_file) ? require $admin_file : [];

            // Decode the new config from POST (JSON)
            $newConfig = json_decode($_POST['config'], true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                error_log('JSON decode error: ' . json_last_error_msg());
                die(json_encode(['success' => false, 'message' => 'Invalid data']));
            }

            // Si les paramètres de debug sont présents, les sauvegarder dans admin.php
            if (isset($newConfig['debug'])) {
                // Initialiser la section debug si elle n'existe pas
                if (!isset($adminConfig['debug'])) {
                    $adminConfig['debug'] = [];
                }
                
                // Mettre à jour les paramètres de debug
                $adminConfig['debug'] = array_merge($adminConfig['debug'], [
                    'enabled' => $newConfig['debug']['enabled'] ?? false,
                    'log_to_apache' => $newConfig['debug']['log_to_apache'] ?? false,
                    'require_login' => $newConfig['debug']['require_login'] ?? false
                ]);
                
                // Sauvegarder la configuration admin
                $adminContent = "<?php\nreturn " . var_export($adminConfig, true) . ";\n";
                if (file_put_contents($admin_file, $adminContent) === false) {
                    die(json_encode(['success' => false, 'message' => 'Error saving debug configuration']));
                }
                unset($newConfig['debug']); // Retirer debug de la config normale
            }

            // If patterns are present, save them using PatternManager
            if (isset($newConfig['patterns'])) {
                $result = $patternManager->savePatterns($newConfig['patterns']);
                if (!$result['success']) {
                    die(json_encode($result));
                }
                unset($newConfig['patterns']); // Remove patterns from config
            }

            // Merge: default config < user config < new changes
            $finalConfig = array_replace_recursive($defaultConfig, $currentConfig, $newConfig);

            // Save the merged config to config.user.php
            $configContent = "<?php\nreturn " . var_export($finalConfig, true) . ";\n";
            if (file_put_contents($config_file, $configContent) === false) {
                die(json_encode(['success' => false, 'message' => 'Error saving configuration']));
            }

            // Invalidate opcache if needed
            if (function_exists('opcache_invalidate')) {
                opcache_invalidate($config_file, true);
                opcache_invalidate($admin_file, true);
            }

            die(json_encode(['success' => true, 'message' => 'Configuration updated successfully']));
            break;
            
        case 'save_switch':
            // Validate input
            if (!isset($_POST['name']) || !isset($_POST['value'])) {
                die(json_encode(['success' => false, 'message' => 'Paramètres manquants']));
            }

            $name = $_POST['name'];
            $value = $_POST['value'] === '1';

            // Handle special case for Nginx/NPM switch
            if ($name === 'use_npm') {
                $config = [
                    'nginx' => [
                        'use_npm' => $value
                    ],
                    'paths' => [
                        'nginx_logs' => $value ? '/var/log/npm' : '/var/log/nginx'
                    ]
                ];
            } else {
                // Handle other switches
                $parts = explode('[', str_replace(']', '', $name));
                $config = [];
                $current = &$config;
                
                foreach ($parts as $part) {
                    $current[$part] = [];
                    $current = &$current[$part];
                }
                $current = $value;
            }

            // Save configuration
            if (saveConfig($config)) {
                die(json_encode([
                    'success' => true, 
                    'message' => 'Configuration mise à jour avec succès'
                ]));
            } else {
                die(json_encode([
                    'success' => false, 
                    'message' => 'Erreur lors de la mise à jour de la configuration'
                ]));
            }
            break;
            
        case 'update_filters':
            // Validate input
            if (!isset($_POST['enabled'])) {
                die(json_encode(['success' => false, 'message' => 'Paramètre enabled manquant']));
            }

            $enabled = $_POST['enabled'] === '1';

            // Charger la configuration existante
            $config_file = __DIR__ . '/../config/config.user.php';
            if (!file_exists($config_file)) {
                die(json_encode(['success' => false, 'message' => 'Fichier de configuration non trouvé']));
            }

            $currentConfig = require $config_file;

            // Mettre à jour la section filters
            if (!isset($currentConfig['filters'])) {
                $currentConfig['filters'] = [];
            }
            $currentConfig['filters']['enabled'] = $enabled;

            // Sauvegarder la configuration
            $configContent = "<?php\nreturn " . formatArray($currentConfig) . ";\n";
            if (file_put_contents($config_file, $configContent) === false) {
                die(json_encode(['success' => false, 'message' => 'Erreur lors de la sauvegarde de la configuration']));
            }

            // Invalider le cache si nécessaire
            if (function_exists('opcache_invalidate')) {
                opcache_invalidate($config_file, true);
            }

            die(json_encode(['success' => true, 'message' => 'État des filtres mis à jour avec succès']));
            break;
            
        case 'save_all':
            $config_file = __DIR__ . '/../config/config.user.php';
            $config = file_exists($config_file) ? require $config_file : [];

            // Update selected theme at root level
            if (isset($_POST['theme'])) {
                $config['theme'] = $_POST['theme'];
            }

            // Update custom colors for each theme (light, dark, glass)
            foreach (['light', 'dark', 'glass'] as $theme) {
                foreach (['primary_color', 'text_color', 'bg_color', 'accent_color'] as $color) {
                    $key = "themes[$theme][$color]";
                    if (isset($_POST[$key])) {
                        if (!isset($config['themes'][$theme])) {
                            $config['themes'][$theme] = [];
                        }
                        $config['themes'][$theme][$color] = $_POST[$key];
                    }
                }
            }

            // Save config
            file_put_contents($config_file, "<?php\nreturn " . var_export($config, true) . ";\n");
            echo json_encode(['success' => true]);
            exit;
            break;
            
        case 'save_update_switch':
            $enabled = isset($_POST['enabled']) && $_POST['enabled'] == 1;
            $admin_file = __DIR__ . '/../config/admin.php';
            if (!file_exists($admin_file)) {
                die(json_encode(['success' => false, 'message' => 'admin.php introuvable']));
            }
            $adminConfig = require $admin_file;
            $adminConfig['admin']['update_check']['enabled'] = $enabled;
            $content = "<?php\nreturn " . var_export($adminConfig, true) . ";\n";
            if (file_put_contents($admin_file, $content) === false) {
                die(json_encode(['success' => false, 'message' => 'Erreur lors de la sauvegarde']));
            }
            die(json_encode(['success' => true]));
            break;
            
        default:
            die(json_encode(['success' => false, 'message' => 'Action non reconnue']));
    }
}

// Instant update check for GitHub tags (AJAX)
if (isset($_GET['action']) && $_GET['action'] === 'check_update_now') {
    // GitHub API URL for tags
    $apiUrl = 'https://api.github.com/repos/Erreur32/LogviewR/tags';
    $ch = curl_init($apiUrl);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_USERAGENT, 'LogviewR-Admin'); // GitHub API requires a user-agent
    $result = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && $result) {
        $tags = json_decode($result, true);
        if (is_array($tags) && count($tags) > 0) {
            $latest = $tags[0]['name'];
            echo json_encode([
                'success' => true,
                'message' => "Dernier tag GitHub : $latest",
                'latest_tag' => $latest,
                'tags' => array_column($tags, 'name')
            ]);
        } else {
            echo json_encode(['success' => false, 'message' => "Aucun tag trouvé sur GitHub."]);
        }
    } else {
        echo json_encode(['success' => false, 'message' => "Erreur lors de la récupération des tags GitHub (HTTP $httpCode)."]);
    }
    exit;
}

/**
 * Format an array with proper indentation to match var_export() style
 * @param array $array The array to format
 * @param int $indent The current indentation level
 * @return string The formatted array as a string
 */
function formatArray($array, $indent = 0) {
    $indentStr = str_repeat('  ', $indent);
    $result = "array (\n";
    
    foreach ($array as $key => $value) {
        $result .= $indentStr . "  ";
        
        if (is_string($key)) {
            $result .= "'" . addslashes($key) . "' => ";
        }
        
        if (is_array($value)) {
            $result .= formatArray($value, $indent + 1);
        } else if (is_string($value)) {
            // Special handling for filters with regex patterns
            if (strpos($value, "\n") !== false) {
                $lines = explode("\n", $value);
                $result .= "array (\n";
                $index = 0;
                foreach ($lines as $line) {
                    $line = trim($line);
                    if (!empty($line)) {
                        $result .= $indentStr . "    " . $index . " => '" . addslashes($line) . "',\n";
                        $index++;
                    }
                }
                $result .= $indentStr . "  )";
            } else {
                $result .= "'" . addslashes($value) . "'";
            }
        } else if (is_bool($value)) {
            $result .= $value ? 'true' : 'false';
        } else if (is_null($value)) {
            $result .= 'null';
        } else {
            $result .= $value;
        }
        
        $result .= ",\n";
    }
    
    $result .= $indentStr . ")";
    return $result;
} 