<?php
abstract class BaseParser {
    protected $columns = [];
    
    /**
     * Parse une ligne de log
     * @param string $line La ligne à parser
     * @param string $type Le type de log (access, error, etc.)
     * @return array|null Les données parsées ou null si la ligne est invalide
     */
    abstract public function parse($line, $type = 'access');
    
    /**
     * Retourne la définition des colonnes
     * @param string $type Le type de log
     * @return array La définition des colonnes
     */
    public function getColumns($type = 'access') {
        return $this->columns[$type] ?? [];
    }
    
    /**
     * Formate une date en HTML
     * @param string $dateStr La date à formater
     * @return string La date formatée en HTML
     */
    protected function formatDate($dateStr) {
        // Si la date ne contient pas d'année, ajouter l'année courante
        if (!preg_match('/\d{4}/', $dateStr)) {
            $dateStr .= ' ' . date('Y');
        }
        
        $timestamp = strtotime($dateStr);
        if ($timestamp === false) {
            // Si la conversion échoue, essayer un format alternatif
            $timestamp = strtotime(str_replace('  ', ' ', $dateStr));
        }
        
        if ($timestamp === false) {
            // Si tout échoue, utiliser la date actuelle
            $timestamp = time();
        }
        
        $hour = date('G', $timestamp); // 0-23 format
        $date = date('d/m/Y', $timestamp);
        $time = date('H:i:s', $timestamp);
        
        return sprintf(
            '<span class="date-badge" data-hour="%d">%s %s</span>',
            $hour,
            $date,
            $time
        );
    }
    
    /**
     * Formate une taille en HTML
     * @param string|int $size La taille à formater
     * @return string La taille formatée en HTML
     */
    protected function formatSize($size) {
        if ($size == '-' || $size == '0') {
            return '<span class="log-badge size"><span class="number">-</span></span>';
        }
        
        $units = ['B', 'KB', 'MB', 'GB'];
        $size = intval($size);
        $i = 0;
        while ($size >= 1024 && $i < count($units) - 1) {
            $size /= 1024;
            $i++;
        }
        return sprintf(
            '<span class="log-badge size"><span class="number">%.1f</span><span class="unit">%s</span></span>',
            $size,
            $units[$i]
        );
    }
} 