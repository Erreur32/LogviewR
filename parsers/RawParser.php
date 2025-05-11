<?php

/**
 * RawParser class
 * Handles raw log files without specific parsing
 */
class RawParser extends BaseParser {
    
    /**
     * Pattern for raw logs (matches any line)
     * @var string
     */
    protected $pattern = '/^(.*)$/';
    
    /**
     * Parse a single line of raw log
     * 
     * @param string $line The log line to parse
     * @param string $type The log type (access/error) - not used in raw parser
     * @return array Parsed log data
     */
    public function parse($line, $type = 'access') {
        // Return raw line without any filtering
        return [
            'raw_line' => $line,
            'message' => $line,
            'date' => date('Y-m-d H:i:s'), // Current timestamp as fallback
            'type' => 'raw'
        ];
    }
    
    /**
     * Get the pattern used by this parser
     * Implementation of abstract method from BaseParser
     * 
     * @return string The pattern that matches any line
     */
    public function getPattern() {
        return $this->pattern;
    }
    
    /**
     * Get columns configuration for raw display
     * 
     * @param string $type The log type (access/error) - not used in raw parser
     * @return array Column configuration
     */
    public function getColumns($type = 'access') {
        return [
            'raw_line' => [
                'name' => 'Raw Content',
                'class' => 'column-raw-content',
                'width' => 'auto',
                'align' => 'left',
                'orderable' => true,
                'searchable' => true
            ]
        ];
    }
    
    /**
     * Format the raw content for display
     *
     * @param array $data Parsed log data
     * @return string Formatted HTML
     */
    public function formatForDisplay($data) {
        return sprintf(
            '<div class="raw-log-line" data-timestamp="%s">%s</div>',
            htmlspecialchars($data['date']),
            htmlspecialchars($data['raw_line'])
        );
    }

    /**
     * Override shouldFilter to always return false
     * This ensures no filtering is applied to raw logs
     * 
     * @param array $data The log data
     * @return bool Always false
     */
    protected function shouldFilter($data) {
        return false;
    }

    /**
     * Get the type of this parser
     * 
     * @return string The parser type
     */
    public function getType() {
        return 'raw';
    }
} 