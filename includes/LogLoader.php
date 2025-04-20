<?php
require_once __DIR__ . '/debug.php';

class LogLoader {
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    public function loadLogs($type) {
        debug("Tentative de chargement des logs de type: $type");
        
        // Vérifier le chemin
        $path = $this->config['paths'][$type] ?? null;
        if (!$path) {
            debug("❌ Erreur: Chemin non configuré pour $type");
            return [];
        }
        
        debug("📂 Chemin à scanner: $path");
        
        // Vérifier si le dossier existe
        if (!file_exists($path)) {
            debug("❌ Erreur: Le dossier n'existe pas: $path");
            return [];
        }
        
        // Vérifier les permissions
        if (!is_readable($path)) {
            debug("❌ Erreur: Le dossier n'est pas lisible: $path");
            return [];
        }
        
        // Scanner le dossier
        $files = scandir($path);
        debug("📄 Fichiers trouvés: " . json_encode($files));
        
        $logFiles = [];
        foreach ($files as $file) {
            if ($file === '.' || $file === '..') continue;
            
            $fullPath = $path . '/' . $file;
            if (is_file($fullPath)) {
                // Vérifier si c'est un fichier de log
                if ($this->isLogFile($file)) {
                    debug("✓ Fichier de log trouvé: $file");
                    $logFiles[] = [
                        'name' => $file,
                        'path' => $fullPath,
                        'size' => filesize($fullPath),
                        'mtime' => filemtime($fullPath)
                    ];
                } else {
                    debug("✗ Fichier ignoré (pas un log): $file");
                }
            }
        }
        
        debug("📊 Total fichiers de log trouvés: " . count($logFiles));
        return $logFiles;
    }
    
    private function isLogFile($filename) {
        $extensions = ['.log', '.access', '.error'];
        foreach ($extensions as $ext) {
            if (stripos($filename, $ext) !== false) {
                return true;
            }
        }
        return false;
    }
} 