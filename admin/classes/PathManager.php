<?php
/**
 * PathManager - Gère les opérations liées aux chemins
 * 
 * @package LogviewR
 * @subpackage Admin
 */

class PathManager {
    private $config;
    private $debug;

    /**
     * Constructeur
     * 
     * @param array $config Configuration de l'application
     * @param bool $debug Mode debug
     */
    public function __construct($config, $debug = false) {
        $this->config = $config;
        $this->debug = $debug;
    }

    /**
     * Nettoie un chemin
     * 
     * @param string $path Chemin à nettoyer
     * @return string Chemin nettoyé
     */
    public function sanitizePath($path) {
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
     * 
     * @param string $filename Nom du fichier
     * @return bool
     */
    public function isLogFile($filename) {
        $extensions = ['.log', '.access', '.error'];
        foreach ($extensions as $ext) {
            if (str_ends_with(strtolower($filename), $ext)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Vérifie un chemin
     * 
     * @param string $path Chemin à vérifier
     * @return array Résultat de la vérification
     */
    public function checkPath($path) {
        try {
            $path = $this->sanitizePath($path);

            // Vérifier si le chemin est vide
            if (empty($path)) {
                return $this->createResponse(false, false, 'Le chemin ne peut pas être vide');
            }

            // Vérifier si le chemin existe
            if (!file_exists($path)) {
                return $this->createResponse(false, false, 'Le dossier n\'existe pas');
            }

            // Vérifier si c'est un dossier
            if (!is_dir($path)) {
                return $this->createResponse(true, false, 'Le chemin spécifié n\'est pas un dossier');
            }

            // Vérifier les permissions de lecture
            if (!is_readable($path)) {
                return $this->createResponse(true, false, 'Le dossier n\'est pas accessible en lecture');
            }

            // Vérifier si le dossier contient des fichiers de logs
            $hasLogFiles = false;
            $files = scandir($path);
            foreach ($files as $file) {
                if ($file === '.' || $file === '..') continue;
                if (is_file($path . '/' . $file) && $this->isLogFile($file)) {
                    $hasLogFiles = true;
                    break;
                }
            }

            if (!$hasLogFiles) {
                return $this->createResponse(true, true, 'Aucun fichier de log trouvé dans ce dossier');
            }

            return $this->createResponse(true, true, 'Chemin valide et accessible');
        } catch (Exception $e) {
            if ($this->debug) {
                error_log("[ERROR] Error checking path: " . $e->getMessage());
            }
            return $this->createResponse(false, false, 'Erreur lors de la vérification du chemin');
        }
    }

    /**
     * Crée une réponse formatée
     * 
     * @param bool $exists Le chemin existe
     * @param bool $readable Le chemin est lisible
     * @param string $message Message de statut
     * @return array Réponse formatée
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