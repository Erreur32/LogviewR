<?php
require_once __DIR__ . '/ApacheParser.php';

class ApacheModsecParser extends ApacheParser {
    private $modsecPattern = '/^\[(.*?)\] \[([^:]+):([^\]]+)\] \[pid (\d+):tid (\d+)\] \[client ([^\]]+)\] (?:\[client [^\]]+\] )?ModSecurity: (.+?)(?:, referer: (.+))?$/';
    private $parseErrors = [];
    private $debugMode = true;

    public function parse($line, $type = 'error') {
        $line = trim($line);
        if (empty($line)) {
            $this->addParseError("Ligne vide");
            return null;
        }

        if ($this->debugMode) {
            error_log("=== Début du parsing ===");
            error_log("Ligne à parser: " . $line);
        }

        $result = $this->parseModsecLog($line);
        
        if ($result === null) {
            if ($this->debugMode) {
                error_log("Échec du parsing");
                $this->analyzeFailure($line);
            }
            $this->addParseError("Impossible de parser la ligne: " . $line);
        } else {
            if ($this->debugMode) {
                error_log("Parsing réussi");
                error_log(print_r($result, true));
            }
        }
        
        return $result;
    }

    private function parseModsecLog($line) {
        if (!preg_match($this->modsecPattern, $line, $matches)) {
            // Essayons de comprendre pourquoi ça ne match pas
            if (strpos($line, 'ModSecurity:') === false) {
                $this->addParseError("La ligne ne contient pas 'ModSecurity:'");
            } else if (substr_count($line, '[') < 4) {
                $this->addParseError("Format incorrect - nombre insuffisant de crochets []");
            } else {
                $this->addParseError("Format non reconnu pour la ligne ModSecurity");
            }
            error_log("ModSec Parse failed for line: " . $line);
            return null;
        }

        // Extraire les informations de base
        $datetime = $matches[1];
        $module = $matches[2];
        $level = $matches[3];
        $pid = $matches[4];
        $tid = $matches[5];
        $client = $matches[6];
        $type = $matches[7];
        $message = $matches[8];
        $referer = isset($matches[9]) ? $matches[9] : '-';

        // Extraire les détails ModSecurity du message
        $details = $this->extractModsecDetails($message);

        // Formater le niveau avec un badge
        $levelClass = $this->getLevelClass($level);
        $formattedLevel = sprintf(
            '<span class="badge level %s">%s</span>',
            $levelClass,
            strtoupper($level)
        );

        // Formater le client avec un badge IP
        $formattedClient = sprintf(
            '<span class="ip-badge">%s</span>',
            htmlspecialchars($client)
        );

        // Formater le PID/TID
        $formattedPid = sprintf(
            '<span class="pid-badge">%s:%s</span>',
            $pid,
            $tid
        );

        // Formater les tags
        $formattedTags = '';
        if (!empty($details['tags'])) {
            $tags = explode('] [tag "', $details['tags']);
            $formattedTags = array_map(function($tag) {
                $tag = trim($tag, '"] ');
                return sprintf('<span class="modsec-tag">%s</span>', htmlspecialchars($tag));
            }, $tags);
            $formattedTags = implode(' ', $formattedTags);
        }

        return [
            'date' => $this->formatDate($datetime),
            'level' => $formattedLevel,
            'module' => htmlspecialchars($module),
            'client' => $formattedClient,
            'pid' => $formattedPid,
            'rule_id' => !empty($details['id']) ? sprintf('<span class="modsec-rule">%s</span>', $details['id']) : '-',
            'message' => !empty($details['msg']) ? htmlspecialchars($details['msg']) : htmlspecialchars($message),
            'file' => !empty($details['file']) ? htmlspecialchars(basename($details['file'])) : '-',
            'line' => !empty($details['line']) ? htmlspecialchars($details['line']) : '-',
            'data' => !empty($details['data']) ? htmlspecialchars($details['data']) : '-',
            'severity' => !empty($details['severity']) ? sprintf('<span class="modsec-severity %s">%s</span>', strtolower($details['severity']), $details['severity']) : '-',
            'tags' => $formattedTags,
            'uri' => !empty($details['uri']) ? htmlspecialchars($details['uri']) : '-',
            'unique_id' => !empty($details['unique_id']) ? htmlspecialchars($details['unique_id']) : '-',
            'referer' => $referer !== '-' ? htmlspecialchars($referer) : '-'
        ];
    }

    private function extractModsecDetails($message) {
        $details = [];
        $patterns = [
            'id' => '/\[id "([^"]+)"\]/',
            'msg' => '/\[msg "([^"]+)"\]/',
            'data' => '/\[data "([^"]+)"\]/',
            'severity' => '/\[severity "([^"]+)"\]/',
            'ver' => '/\[ver "([^"]+)"\]/',
            'file' => '/\[file "([^"]+)"\]/',
            'line' => '/\[line "([^"]+)"\]/',
            'tags' => '/(\[tag "[^"]+"\])+/',
            'hostname' => '/\[hostname "([^"]+)"\]/',
            'uri' => '/\[uri "([^"]+)"\]/',
            'unique_id' => '/\[unique_id "([^"]+)"\]/'
        ];

        foreach ($patterns as $key => $pattern) {
            if (preg_match($pattern, $message, $matches)) {
                if ($key === 'tags') {
                    $details[$key] = $matches[0];
                } else {
                    $details[$key] = $matches[1];
                }
            }
        }

        return $details;
    }

    public function getColumns() {
        return [
            'date' => 'Date',
            'level' => 'Niveau',
            'module' => 'Module',
            'client' => 'Client',
            'pid' => 'PID:TID',
            'rule_id' => 'Rule ID',
            'message' => 'Message',
            'file' => 'Fichier',
            'line' => 'Ligne',
            'data' => 'Données',
            'severity' => 'Sévérité',
            'tags' => 'Tags',
            'uri' => 'URI',
            'unique_id' => 'ID Unique',
            'referer' => 'Referer'
        ];
    }

    private function analyzeFailure($line) {
        error_log("=== Analyse détaillée de l'échec de parsing ===");
        error_log("Ligne complète: " . $line);
        error_log("Longueur de la ligne: " . strlen($line));
        
        // Vérifier les éléments clés
        $elements = [
            'Date' => preg_match('/^\[.*?\]/', $line),
            'Module' => preg_match('/\[[^:]+:[^\]]+\]/', $line),
            'PID/TID' => preg_match('/\[pid \d+:tid \d+\]/', $line),
            'Client' => preg_match('/\[client [^\]]+\]/', $line),
            'ModSecurity' => strpos($line, 'ModSecurity:') !== false
        ];
        
        foreach ($elements as $element => $present) {
            error_log("$element présent: " . ($present ? "Oui" : "Non"));
        }
        
        error_log("=== Fin de l'analyse ===");
    }

    private function addParseError($message) {
        $this->parseErrors[] = $message;
        if ($this->debugMode) {
            error_log("ModSecurity Parser Error: " . $message);
        }
    }

    public function getParseErrors() {
        return $this->parseErrors;
    }

    public function hasErrors() {
        return !empty($this->parseErrors);
    }
} 