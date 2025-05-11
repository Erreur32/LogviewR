<?php
/**
 * Fonctions utilitaires pour LogviewR
 */

if (!function_exists('getAbsolutePath')) {
    /**
     * Convertit un chemin relatif en chemin absolu
     * @param string $path Le chemin relatif
     * @return string Le chemin absolu
     */
    function getAbsolutePath($path) {
        // Si le chemin commence déjà par /, le retourner tel quel
        if (strpos($path, '/') === 0) {
            return $path;
        }
        
        // Obtenir le chemin de base
        $basePath = dirname($_SERVER['SCRIPT_NAME']);
        if ($basePath === '/') {
            $basePath = '';
        }
        
        // Construire le chemin absolu
        return $basePath . '/' . ltrim($path, '/');
    }
} 