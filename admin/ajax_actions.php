<?php
session_start();

// Vérifier si les fichiers de configuration existent
if (!file_exists(__DIR__ . '/../config/config.php') || !file_exists(__DIR__ . '/../config/admin.php') || !file_exists(__DIR__ . '/../config/log_patterns.php')) {
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => 'Fichiers de configuration manquants'
    ]);
    exit;
}

// Vérifier si l'utilisateur est connecté
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => 'Non autorisé'
    ]);
    exit;
}

// Charger les configurations
$config_file = __DIR__ . '/../config/config.php';
$admin_config_file = __DIR__ . '/../config/admin.php';
$patterns_file = __DIR__ . '/../config/log_patterns.php';

$current_config = require $config_file;
$admin_config = require $admin_config_file;
$current_patterns = require $patterns_file;

// Fonction pour sauvegarder la configuration
function saveConfig($config) {
    $config_file = __DIR__ . '/../config/config.php';
    $current_config = [];
    
    if (file_exists($config_file)) {
        $current_config = require $config_file;
    }
    
    // Check if debug is enabled
    $is_debug_enabled = isset($current_config['debug']['enabled']) && $current_config['debug']['enabled'] === true;
    
    // Create a conditional logging function
    $log = function($message) use ($is_debug_enabled) {
        if ($is_debug_enabled) {
            error_log($message);
        }
    };
    
    // Validate filters structure if present
    if (isset($config['filters'])) {
        if (!isset($config['filters']['exclude'])) {
            $log("Invalid filters structure");
            return false;
        }
        
        // Clean filter patterns
        foreach ($config['filters']['exclude'] as $type => &$items) {
            if (is_array($items)) {
                $items = array_map(function($pattern) {
                    return preg_replace('/\s+/', ' ', rtrim($pattern, "\n\r"));
                }, $items);
            }
        }
    }
    
    // Compare and update only modified values
    $final_config = $current_config;
    
    // Function to recursively compare arrays
    $compareArrays = function($new, $old) use (&$compareArrays) {
        if (!is_array($new) || !is_array($old)) {
            return $new;
        }
        
        $result = [];
        foreach ($new as $key => $value) {
            if (is_array($value) && isset($old[$key]) && is_array($old[$key])) {
                $diff = $compareArrays($value, $old[$key]);
                if (!empty($diff)) {
                    $result[$key] = $diff;
                }
            } elseif (!isset($old[$key]) || $old[$key] !== $value) {
                $result[$key] = $value;
            }
        }
        return $result;
    };
    
    // Get only modified values
    $modified_values = $compareArrays($config, $current_config);
    
    // Merge only modified values if there are changes
    if (!empty($modified_values) && is_array($modified_values)) {
        $final_config = array_replace_recursive($current_config, $modified_values);
        $log("Modified values: " . print_r($modified_values, true));
    } else {
        $log("No changes detected in configuration or invalid modified values");
        return true; // No changes to save
    }
    
    // Prepare content for the file
    $content = "<?php\n// Auto-generated file - Do not modify manually\n// Generation date: " . date('Y-m-d H:i:s') . "\nreturn " . var_export($final_config, true) . ";\n";
    
    // Try to write to a temporary file first
    $temp_file = $config_file . '.tmp';
    if (file_put_contents($temp_file, $content) === false) {
        $log("Failed to write to temporary config file");
        return false;
    }
    
    // Rename temporary file to actual file
    if (!rename($temp_file, $config_file)) {
        $log("Failed to rename temporary config file");
        unlink($temp_file);
        return false;
    }
    
    $log("Config saved successfully with modified values only");
    return true;
}

// Fonction pour nettoyer les patterns (enlever les sauts de ligne et normaliser les espaces)
function cleanPatterns($patterns) {
    // Clean filters if they exist
    if (isset($patterns['filters']['exclude'])) {
        foreach ($patterns['filters']['exclude'] as $type => $items) {
            if (is_array($items)) {
                $patterns['filters']['exclude'][$type] = array_map(function($pattern) {
                    // Remove line breaks and normalize spaces
                    return preg_replace('/\s+/', ' ', rtrim($pattern, "\n\r"));
                }, $items);
            }
        }
    }
    
    // Clean all patterns in the array
    array_walk_recursive($patterns, function(&$value, $key) {
        if (is_string($value) && strpos($key, 'pattern') !== false) {
            // Remove line breaks and normalize spaces for pattern values
            $value = preg_replace('/\s+/', ' ', rtrim($value, "\n\r"));
        }
    });
    
    return $patterns;
}

// Fonction de log globale améliorée
function debug_log($message, $type = 'INFO') {
    global $current_config;
    
    // Vérifier si le debug est activé
    $is_debug_enabled = isset($current_config['debug']['enabled']) && $current_config['debug']['enabled'] === true;
    
    if (!$is_debug_enabled) {
        return;
    }
    
    // Vérifier si le fichier de log existe
    $log_file = $current_config['debug']['log_file'] ?? __DIR__ . '/../logs/debug.log';
    $log_dir = dirname($log_file);
    
    // Créer le dossier de logs s'il n'existe pas
    if (!file_exists($log_dir)) {
        error_log("Le dossier de logs n'existe pas: $log_dir");
        return;
    }
    
    // Vérifier si le fichier est accessible en écriture
    if (file_exists($log_file) && !is_writable($log_file)) {
        error_log("Debug log file is not writable: $log_file");
        return;
    }
    
    // Formater le message avec timestamp
    $timestamp = date($current_config['debug']['timestamp_format'] ?? 'Y-m-d H:i:s');
    $formatted_message = "[$timestamp] [$type] $message" . PHP_EOL;
    
    // Écrire dans le fichier de log
    if (@file_put_contents($log_file, $formatted_message, FILE_APPEND) === false) {
        error_log("Failed to write to debug log file: $log_file");
    }
    
    // Écrire aussi dans les logs Apache si activé
    if (isset($current_config['debug']['log_to_apache']) && $current_config['debug']['log_to_apache']) {
        error_log("LogviewR Debug: $message");
    }
}

// Fonction pour sauvegarder les patterns
function savePatterns($patterns) {
    // Get current config
    $current_config = require_once(__DIR__ . '/../config/config.php');
    
    // Check if debug is enabled
    $is_debug_enabled = isset($current_config['debug']['enabled']) && $current_config['debug']['enabled'] === true;
    
    // Create a conditional logging function
    $log = function($message) use ($is_debug_enabled) {
        if ($is_debug_enabled) {
            error_log($message);
        }
    };
    
    // Remove any filters section from patterns if present
    if (isset($patterns['filters'])) {
        $log("Removing filters section from patterns");
        unset($patterns['filters']);
    }
    
    $patterns_file = __DIR__ . '/../config/log_patterns.php';
    
    // Check if file exists and is writable
    if (!file_exists($patterns_file)) {
        $log("Patterns file does not exist: $patterns_file");
        return ['success' => false, 'error' => 'Le fichier de patterns n\'existe pas'];
    }
    
    if (!is_writable($patterns_file)) {
        $log("Patterns file is not writable: $patterns_file");
        return ['success' => false, 'error' => 'Le fichier de patterns n\'est pas accessible en écriture'];
    }
    
    // Load current patterns
    $current_patterns = require $patterns_file;
    
    // Compare and update only modified values
    $final_patterns = $current_patterns;
    
    // Function to recursively compare arrays
    $compareArrays = function($new, $old) use (&$compareArrays) {
        $result = [];
        foreach ($new as $key => $value) {
            if (is_array($value) && isset($old[$key]) && is_array($old[$key])) {
                $diff = $compareArrays($value, $old[$key]);
                if (!empty($diff)) {
                    $result[$key] = $diff;
                }
            } elseif (!isset($old[$key]) || $old[$key] !== $value) {
                $result[$key] = $value;
            }
        }
        return $result;
    };
    
    // Get only modified values
    $modified_values = $compareArrays($patterns, $current_patterns);
    
    // Merge only modified values
    if (!empty($modified_values)) {
        $final_patterns = array_replace_recursive($current_patterns, $modified_values);
        $log("Modified patterns: " . print_r($modified_values, true));
    } else {
        $log("No changes detected in patterns");
        return ['success' => true]; // No changes to save
    }
    
    // Clean patterns before saving
    $final_patterns = cleanPatterns($final_patterns);
    
    // Validate that patterns is an array
    if (!is_array($final_patterns)) {
        $log("Invalid patterns format: " . print_r($final_patterns, true));
        return ['success' => false, 'error' => 'Format de patterns invalide'];
    }
    
    // Validate regex patterns
    foreach ($final_patterns as $type => $type_data) {
        if (isset($type_data['pattern'])) {
            if (!isValidRegex($type_data['pattern'])) {
                $log("Invalid regex pattern for $type: " . $type_data['pattern']);
                return ['success' => false, 'error' => "Pattern invalide pour $type"];
            }
        }
    }
    
    // Prepare content for the file
    $content = "<?php\n// Auto-generated file - Do not modify manually\n// Generation date: " . date('Y-m-d H:i:s') . "\nreturn " . var_export($final_patterns, true) . ";\n";
    
    // Try to write to a temporary file first
    $temp_file = $patterns_file . '.tmp';
    if (file_put_contents($temp_file, $content) === false) {
        $log("Failed to write to temporary file: $temp_file");
        return ['success' => false, 'error' => 'Impossible d\'écrire dans le fichier temporaire'];
    }
    
    // Rename temporary file to actual file
    if (!rename($temp_file, $patterns_file)) {
        $log("Failed to rename temporary patterns file");
        unlink($temp_file);
        return ['success' => false, 'error' => 'Impossible de renommer le fichier temporaire'];
    }
    
    $log("Patterns saved successfully with modified values only");
    return ['success' => true];
}

// Fonction pour valider une regex
function isValidRegex($pattern) {
    // Vérifier si le pattern commence et finit par un délimiteur
    if (!preg_match('/^\/.*\/$/', $pattern)) {
        return false;
    }
    
    // Tester la regex avec une chaîne vide
    $test = @preg_match($pattern, '');
    return $test !== false;
}

// Traiter les actions POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    debug_log("Received action: $action", 'DEBUG');
    $response = ['success' => false, 'message' => 'Action non reconnue'];

    switch ($action) {
        case 'update_config':
            try {
                // Charger la configuration actuelle
                $current_config = require_once(__DIR__ . '/../config/config.php');
                
                // Initialiser la nouvelle configuration avec les valeurs actuelles
                $new_config = $current_config;
                
                // Mettre à jour les paramètres de l'application
                if (isset($_POST['app']) && is_array($_POST['app'])) {
                    // S'assurer que la section 'app' existe
                    if (!isset($new_config['app']) || !is_array($new_config['app'])) {
                        $new_config['app'] = [];
                    }

                    // Valider et convertir les valeurs numériques
                    $numeric_fields = [
                        'max_execution_time' => ['min' => 1, 'max' => 300, 'default' => 30],
                        'max_lines_per_request' => ['min' => 100, 'max' => 10000, 'default' => 1000],
                        'default_lines_per_page' => ['min' => 10, 'max' => 1000, 'default' => 50],
                        'refresh_interval' => ['min' => 5, 'max' => 1800, 'default' => 30]
                    ];

                    foreach ($numeric_fields as $field => $limits) {
                        if (isset($_POST['app'][$field])) {
                            $value = (int)$_POST['app'][$field];
                            $new_config['app'][$field] = max(min($value, $limits['max']), $limits['min']);
                        } elseif (!isset($new_config['app'][$field])) {
                            $new_config['app'][$field] = $limits['default'];
                        }
                    }

                    // Gérer les extensions exclues
                    if (isset($_POST['app']['excluded_extensions'])) {
                        if (is_string($_POST['app']['excluded_extensions'])) {
                            $extensions = explode("\n", $_POST['app']['excluded_extensions']);
                            $extensions = array_map('trim', $extensions);
                            $extensions = array_filter($extensions);
                            $new_config['app']['excluded_extensions'] = array_values($extensions);
                        } elseif (is_array($_POST['app']['excluded_extensions'])) {
                            $new_config['app']['excluded_extensions'] = array_values(array_filter(array_map('trim', $_POST['app']['excluded_extensions'])));
                        }
                    }
                }

                // Gestion du fuseau horaire
                if (isset($_POST['timezone']) && is_string($_POST['timezone'])) {
                    try {
                        new DateTimeZone($_POST['timezone']);
                        $new_config['timezone'] = $_POST['timezone'];
                    } catch (Exception $e) {
                        debug_log("Fuseau horaire invalide: " . $_POST['timezone'], 'WARNING');
                    }
                }

                // Gestion des formats de date
                if (isset($_POST['date_formats']) && is_array($_POST['date_formats'])) {
                    if (!isset($new_config['date_formats']) || !is_array($new_config['date_formats'])) {
                        $new_config['date_formats'] = [];
                    }

                    $default_formats = [
                        'display' => 'd/m/Y H:i:s',
                        'log' => 'Y-m-d H:i:s',
                        'input' => 'Y-m-d'
                    ];

                    foreach ($default_formats as $key => $default_format) {
                        $format = $_POST['date_formats'][$key] ?? $default_format;
                        try {
                            $date = new DateTime();
                            $date->format($format);
                            $new_config['date_formats'][$key] = $format;
                        } catch (Exception $e) {
                            $new_config['date_formats'][$key] = $default_format;
                            debug_log("Format de date invalide pour $key, utilisation du format par défaut", 'WARNING');
                        }
                    }
                }
                
                // Sauvegarder la configuration
                if (saveConfig($new_config)) {
                    $response = [
                        'success' => true,
                        'message' => 'Configuration mise à jour avec succès',
                        'data' => $new_config
                    ];
                } else {
                    throw new Exception('Erreur lors de la sauvegarde de la configuration');
                }
            } catch (Exception $e) {
                $response = [
                    'success' => false,
                    'message' => $e->getMessage()
                ];
            }
            break;

        case 'save_switch':
            if (isset($_POST['name']) && isset($_POST['value'])) {
                $name = $_POST['name'];
                $value = $_POST['value'] === '1';
                
                // Mettre à jour la configuration
                $current_config['nginx'][$name] = $value;
                
                // Sauvegarder la configuration
                if (saveConfig($current_config)) {
                    $response = [
                        'success' => true,
                        'message' => 'Switch mis à jour avec succès'
                    ];
                } else {
                    $response = [
                        'success' => false,
                        'message' => 'Erreur lors de la sauvegarde'
                    ];
                }
            } else {
                $response = [
                    'success' => false,
                    'message' => 'Paramètres manquants'
                ];
            }
            break;

        case 'save_all':
            debug_log("Saving all configuration", 'DEBUG');
            
            // S'assurer que les sections existent
            if (!isset($current_config['debug'])) {
                $current_config['debug'] = ['enabled' => false];
            }
            if (!isset($current_config['nginx'])) {
                $current_config['nginx'] = [];
            }
            if (!isset($current_config['paths'])) {
                $current_config['paths'] = [];
            }
            if (!isset($current_config['app'])) {
                $current_config['app'] = [];
            }
            if (!isset($current_config['filters'])) {
                $current_config['filters'] = ['exclude' => []];
            }
            
            // Mise à jour du thème
            if (isset($_POST['theme'])) {
                $theme = $_POST['theme'];
                // Vérifier si le thème est valide
                if (in_array($theme, ['light', 'dark'])) {
                    $current_config['theme'] = $theme;
                    debug_log("Theme updated to: " . $theme, 'DEBUG');
                    
                    // Mettre à jour les couleurs du thème si elles sont présentes
                    if (isset($_POST['theme_colors']) && is_array($_POST['theme_colors'])) {
                        foreach (['primary_color', 'text_color', 'bg_color'] as $color_key) {
                            if (isset($_POST['theme_colors'][$color_key]) && 
                                preg_match('/^#[0-9a-f]{3,6}$/i', $_POST['theme_colors'][$color_key])) {
                                $current_config['themes'][$theme][$color_key] = $_POST['theme_colors'][$color_key];
                            }
                        }
                        debug_log("Theme colors updated", 'DEBUG');
                    }
                } else {
                    debug_log("Invalid theme value: " . $theme, 'WARNING');
                }
            }
            
            // Mise à jour des switches (debug et NPM)
            if (isset($_POST['debug']['enabled'])) {
                $current_config['debug']['enabled'] = $_POST['debug']['enabled'] === '1';
            }
            
            if (isset($_POST['use_npm'])) {
                $current_config['nginx']['use_npm'] = $_POST['use_npm'] === '1';
            }
            
            // Mise à jour des chemins
            if (isset($_POST['paths']) && is_array($_POST['paths'])) {
                foreach (['nginx_logs', 'apache_logs', 'syslog'] as $path_key) {
                    if (isset($_POST['paths'][$path_key])) {
                        $current_config['paths'][$path_key] = $_POST['paths'][$path_key];
                    }
                }
            }
            
            // Mise à jour des extensions exclues
            if (isset($_POST['app']['excluded_extensions'])) {
                if (is_string($_POST['app']['excluded_extensions'])) {
                    $extensions = explode("\n", $_POST['app']['excluded_extensions']);
                } elseif (is_array($_POST['app']['excluded_extensions'])) {
                    $extensions = $_POST['app']['excluded_extensions'];
                } else {
                    $extensions = [];
                }
                $current_config['app']['excluded_extensions'] = array_values(array_filter(array_map('trim', $extensions)));
            }
            
            // Mise à jour des filtres d'exclusion
            if (isset($_POST['config']['filters']['exclude']) && is_array($_POST['config']['filters']['exclude'])) {
                foreach ($_POST['config']['filters']['exclude'] as $type => $patterns) {
                    if (is_string($patterns)) {
                        $patterns = explode("\n", $patterns);
                    } elseif (!is_array($patterns)) {
                        $patterns = [];
                    }
                    $current_config['filters']['exclude'][$type] = array_values(array_filter(array_map('trim', $patterns)));
                }
            }
            
            // Mise à jour des patterns
            if (isset($_POST['patterns']) && is_array($_POST['patterns'])) {
                $current_patterns = [];
                foreach ($_POST['patterns'] as $type => $subtypes) {
                    if (isset($subtypes['pattern'])) {
                        $current_patterns[$type]['pattern'] = $subtypes['pattern'];
                    }
                }
            }
            
            // Save patterns first (without filters)
            $save_result = savePatterns($current_patterns);
            if (!$save_result['success']) {
                $response = $save_result;
                break;
            }
            
            // Save configuration (with filters)
            $config_saved = saveConfig($current_config);
            
            if ($config_saved) {
                $response = [
                    'success' => true,
                    'message' => 'Configuration mise à jour avec succès'
                ];
            } else {
                $response = [
                    'success' => false,
                    'message' => 'Erreur lors de la sauvegarde de la configuration'
                ];
            }
            break;

        case 'save_debug_switch':
            // Validate debug mode value (must be 0 or 1)
            if (!isset($_POST['debug']) || !in_array($_POST['debug'], ['0', '1'], true)) {
                http_response_code(400);
                die(json_encode(['status' => 'error', 'message' => 'Invalid debug value']));
            }

            $debug = (int)$_POST['debug'];
            
            try {
                // Update configuration file
                $current_config['debug'] = $debug;
                if (!saveConfig($current_config)) {
                    throw new Exception('Failed to save configuration');
                }

                // Log the change
                error_log(sprintf("[INFO] Debug mode changed to %s by admin", $debug ? 'enabled' : 'disabled'));
                
                die(json_encode(['status' => 'success']));
            } catch (Exception $e) {
                http_response_code(500);
                die(json_encode(['status' => 'error', 'message' => $e->getMessage()]));
            }
            break;

        case 'force_update_check':
            require_once __DIR__ . '/../includes/UpdateChecker.php';
            $updateChecker = new UpdateChecker();
            
            $result = $updateChecker->forceCheck();
            
            if (isset($result['error'])) {
                echo json_encode([
                    'error' => true,
                    'message' => $result['message']
                ]);
            } else {
                echo json_encode($result);
            }
            exit;

        default:
            $response = [
                'success' => false,
                'message' => 'Action inconnue: ' . $action
            ];
    }

    header('Content-Type: application/json');
    echo json_encode($response);
} else {
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => 'Méthode non autorisée'
    ]);
} 