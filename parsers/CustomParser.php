<?php
require_once __DIR__ . '/BaseParser.php';

class CustomParser extends BaseParser {
    private $customPattern;
    private $debug = false;

    public function __construct() {
        parent::__construct();
        
        // Load configuration
        $config = require __DIR__ . '/../config/config.php';
        $this->debug = $config['debug']['enabled'] ?? false;
        
        // Load pattern from configuration
        $patterns = require __DIR__ . '/../config/log_patterns.php';
        $this->customPattern = $patterns['custom']['pattern'];
        $this->columns = $patterns['custom']['columns'];
        
        if ($this->debug) {
            $this->debugLog("=== CustomParser initialized ===");
            $this->debugLog("Pattern: " . $this->customPattern);
            $this->debugLog("Columns: " . print_r($this->columns, true));
        }
    }

    // ... rest of the code remains the same ...
} 