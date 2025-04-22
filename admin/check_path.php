<?php
/**
 * Check Path Handler
 * Vérifie si un chemin est valide et accessible pour les logs
 */

header('Content-Type: application/json');

// Load configuration
$config = require_once __DIR__ . '/../config/config.php';
$debug = isset($config['debug']) && $config['debug']['enabled'] === true;

// Check session and admin rights
session_start();
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    http_response_code(403);
    echo json_encode([
        'success' => false,
        'message' => 'Non autorisé'
    ]);
    exit;
}

class PathChecker {
    // Extensions de fichiers de log reconnues
    private const LOG_EXTENSIONS = [
        '.log',
        '.access',
        '.error'
    ];

    private $debug;
    private $path;

    public function __construct($path, $debug = false) {
        $this->debug = $debug;
        $this->path = $this->sanitizePath($path);
    }

    /**
     * Nettoie et valide le chemin
     * @param string $path Le chemin à vérifier
     * @return string Le chemin nettoyé
     */
    private function sanitizePath($path) {
        // Supprimer les caractères dangereux
        $path = str_replace(['..', '&', '|', ';'], '', $path);
        
        // Normaliser les séparateurs de chemin
        $path = str_replace('\\', '/', $path);
        
        // Supprimer les slashes multiples
        $path = preg_replace('#/+#', '/', $path);
        
        if ($this->debug) {
            error_log("[DEBUG] Path after sanitization: " . $path);
        }
        
        return $path;
    }

    /**
     * Vérifie si un fichier est un fichier de log
     * @param string $filename Nom du fichier
     * @return bool
     */
    private function isLogFile($filename) {
        foreach (self::LOG_EXTENSIONS as $ext) {
            if (str_ends_with(strtolower($filename), $ext)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Vérifie le chemin et retourne le résultat
     * @return array Résultat de la vérification
     */
    public function check() {
        // Vérifier si le chemin est vide
        if (empty($this->path)) {
            return $this->createResponse(false, false, 'Le chemin ne peut pas être vide');
        }

        // Vérifier si le chemin existe
        if (!file_exists($this->path)) {
            return $this->createResponse(false, false, 'Le dossier n\'existe pas');
        }

        // Vérifier si c'est un dossier
        if (!is_dir($this->path)) {
            return $this->createResponse(true, false, 'Le chemin spécifié n\'est pas un dossier');
        }

        // Vérifier les permissions de lecture
        if (!is_readable($this->path)) {
            return $this->createResponse(true, false, 'Le dossier n\'est pas accessible en lecture');
        }

        // Vérifier si le dossier contient des fichiers de logs
        $hasLogFiles = false;
        try {
            $files = scandir($this->path);
            foreach ($files as $file) {
                if ($file === '.' || $file === '..') continue;
                if (is_file($this->path . '/' . $file) && $this->isLogFile($file)) {
                    $hasLogFiles = true;
                    break;
                }
            }
        } catch (Exception $e) {
            if ($this->debug) {
                error_log("[ERROR] Error scanning directory: " . $e->getMessage());
            }
            return $this->createResponse(true, false, 'Erreur lors de la lecture du dossier');
        }

        if (!$hasLogFiles) {
            return $this->createResponse(true, true, 'Aucun fichier de log trouvé dans ce dossier');
        }

        return $this->createResponse(true, true, 'Chemin valide et accessible');
    }

    /**
     * Crée une réponse formatée
     */
    private function createResponse($exists, $readable, $message) {
        if ($this->debug) {
            error_log("[DEBUG] Path check result - Exists: " . ($exists ? 'yes' : 'no') . 
                     ", Readable: " . ($readable ? 'yes' : 'no') . 
                     ", Message: " . $message);
        }
        
        return [
            'exists' => $exists,
            'readable' => $readable,
            'message' => $message
        ];
    }
}

// Vérifier si le chemin est fourni
if (!isset($_POST['path'])) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'message' => 'Chemin non spécifié'
    ]);
    exit;
}

try {
    // Créer et utiliser le vérificateur de chemin
    $checker = new PathChecker($_POST['path'], $debug);
    $result = $checker->check();
    
    echo json_encode($result);
} catch (Exception $e) {
    if ($debug) {
        error_log("[ERROR] Unexpected error: " . $e->getMessage());
    }
    
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'message' => 'Une erreur inattendue est survenue'
    ]);
} 