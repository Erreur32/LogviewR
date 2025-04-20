<?php

/**
 * RawParser class
 * Handles raw log files without specific parsing
 */
class RawParser extends BaseParser {
    
    /**
     * Parse a single line of raw log
     * 
     * @param string $line The log line to parse
     * @param string $type The log type (access/error) - not used in raw parser
     * @return array Parsed log data
     */
    public function parse($line, $type = 'access') {
        // For raw parser, we just return the line as is
        return [
            'raw_line' => $line
        ];
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
                'orderable' => true
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
        return '<div class="raw-log-line">' . htmlspecialchars($data['raw_line']) . '</div>';
    }
} 