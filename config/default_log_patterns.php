<?php
/**
 * Default patterns configuration file
 * This file contains the default patterns used when no custom patterns are defined
 * Only used for initialization or reset purposes
 */

return [
    // Default patterns for Apache logs
    'apache' => [
        'access' => [
            'pattern' => '/^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d+) (\d+) "([^"]*)" "([^"]*)"$/',
            'parser' => 'ApacheAccessParser',
            'columns' => [
                'client_ip' => ['name' => 'IP', 'class' => 'column-ip'],
                'identity' => ['name' => 'Identity', 'class' => 'column-identity'],
                'user' => ['name' => 'User', 'class' => 'column-user'],
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'status' => ['name' => 'Status', 'class' => 'column-status'],
                'size' => ['name' => 'Size', 'class' => 'column-size'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
                'user_agent' => ['name' => 'User-Agent', 'class' => 'column-user-agent']
            ]
        ],
        'error' => [
            'pattern' => '/^\[(.*?)\] \[([^\]]*)\] \[([^\]]*)\] (.*)$/',
            'parser' => 'ApacheErrorParser',
            'columns' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'level' => ['name' => 'Level', 'class' => 'column-level'],
                'pid' => ['name' => 'PID', 'class' => 'column-pid'],
                'message' => ['name' => 'Message', 'class' => 'column-message']
            ]
        ]
    ],
    // Default patterns for 404 errors
    'apache-404' => [
        'pattern' => '/^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d+) (\d+) "([^"]*)" "([^"]*)"$/',
        'parser' => 'Apache404Parser',
        'columns' => [
            'client_ip' => ['name' => 'IP', 'class' => 'column-ip'],
            'date' => ['name' => 'Date', 'class' => 'column-date'],
            'request' => ['name' => 'Request', 'class' => 'column-request'],
            'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
            'user_agent' => ['name' => 'User-Agent', 'class' => 'column-user-agent']
        ]
    ],
    // Default patterns for Nginx logs
    'nginx' => [
        'access' => [
            'pattern' => '/^(\S+) - (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+) "([^"]*)" "([^"]*)"$/',
            'parser' => 'NginxAccessParser',
            'columns' => [
                'remote_addr' => ['name' => 'IP', 'class' => 'column-ip'],
                'remote_user' => ['name' => 'User', 'class' => 'column-user'],
                'time_local' => ['name' => 'Date', 'class' => 'column-date'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'status' => ['name' => 'Status', 'class' => 'column-status'],
                'body_bytes_sent' => ['name' => 'Size', 'class' => 'column-size'],
                'http_referer' => ['name' => 'Referer', 'class' => 'column-referer'],
                'http_user_agent' => ['name' => 'User-Agent', 'class' => 'column-user-agent']
            ]
        ],
        'error' => [
            'pattern' => '/^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: \*(\d+) (.*)$/',
            'parser' => 'NginxErrorParser',
            'columns' => [
                'time' => ['name' => 'Date', 'class' => 'column-date'],
                'level' => ['name' => 'Level', 'class' => 'column-level'],
                'pid' => ['name' => 'PID', 'class' => 'column-pid'],
                'tid' => ['name' => 'TID', 'class' => 'column-tid'],
                'message' => ['name' => 'Message', 'class' => 'column-message']
            ]
        ]
    ],
    // Default patterns for NPM (Nginx Proxy Manager) logs
    'npm' => [
        'default_host_access' => [
            'pattern' => '/^(\S+) - - \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+) "([^"]*)" "([^"]*)"$/',
            'parser' => 'NPMDefaultHostParser',
            'columns' => [
                'client_ip' => ['name' => 'Client IP', 'class' => 'column-client-ip'],
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'status' => ['name' => 'Status', 'class' => 'column-status'],
                'size' => ['name' => 'Size', 'class' => 'column-size'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
                'user_agent' => ['name' => 'User-Agent', 'class' => 'column-user-agent'],
            ]
        ],
        'proxy_host_access' => [
            'pattern' => '/^\[([^\]]+)\] (-) (-) (\d{3}) (-) ([A-Z]+) (https?) ([^\s]+) "([^"]*)" \[Client ([^\]]+)\] \[Length ([^\]]+)\] \[Gzip ([^\]]+)\] \[Sent-to ([^\]]+)\] "([^"]*)" "([^"]*)"$/',
            'parser' => 'NPMProxyHostParser',
            'columns' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'identity' => ['name' => 'Identity', 'class' => 'column-identity'],
                'user' => ['name' => 'User', 'class' => 'column-user'],
                'status' => ['name' => 'Status', 'class' => 'column-status'],
                'status_in' => ['name' => 'Status In', 'class' => 'column-status-in'],
                'method' => ['name' => 'Method', 'class' => 'column-method'],
                'protocol' => ['name' => 'Protocol', 'class' => 'column-protocol'],
                'host' => ['name' => 'Host', 'class' => 'column-host'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'client_ip' => ['name' => 'Client IP', 'class' => 'column-ip'],
                'length' => ['name' => 'Length', 'class' => 'column-length'],
                'gzip' => ['name' => 'Gzip', 'class' => 'column-gzip'],
                'sent_to' => ['name' => 'Sent To', 'class' => 'column-sent-to'],
                'user_agent' => ['name' => 'User Agent', 'class' => 'column-user-agent'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
            ]
        ],
        'proxy_host_error' => [
            'pattern' => '/^(\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[([^\\]]+)\\] (\\d+)#(\\d+): \\*(\\d+) ([^,]+)(?:, client: ([^,]+))?(?:, server: ([^,]+))?(?:, request: "([^"]+)")?(?:, upstream: "([^"]+)")?(?:, host: "([^"]+)")?(?:, referrer: "([^"]+)")?$/',
            'parser' => 'NPMProxyHostParser',
            'columns' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'level' => ['name' => 'Level', 'class' => 'column-level'],
                'pid' => ['name' => 'PID', 'class' => 'column-pid'],
                'tid' => ['name' => 'TID', 'class' => 'column-tid'],
                'connection' => ['name' => 'Connection', 'class' => 'column-connection'],
                'message' => ['name' => 'Message', 'class' => 'column-message'],
                'client' => ['name' => 'Client', 'class' => 'column-client'],
                'server' => ['name' => 'Server', 'class' => 'column-server'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'upstream' => ['name' => 'Upstream', 'class' => 'column-upstream'],
                'host' => ['name' => 'Host', 'class' => 'column-host'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
            ]
        ],
        'fallback_access' => [
            'pattern' => '/^\[([^\]]+)\] (\d{3}) (-) ([A-Z]+) (https?) ([^\s]+) "([^"]*)" \[Client ([^\]]+)\] \[Length ([^\]]+)\] \[Gzip ([^\]]+)\] "([^"]*)" "([^"]*)"$/',
            'parser' => 'NPMFallbackParser',
            'columns' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'status' => ['name' => 'Status', 'class' => 'column-status'],
                'status_in' => ['name' => 'Status In', 'class' => 'column-status-in'],
                'method' => ['name' => 'Method', 'class' => 'column-method'],
                'protocol' => ['name' => 'Protocol', 'class' => 'column-protocol'],
                'host' => ['name' => 'Host', 'class' => 'column-host'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'client_ip' => ['name' => 'Client IP', 'class' => 'column-ip'],
                'length' => ['name' => 'Length', 'class' => 'column-length'],
                'gzip' => ['name' => 'Gzip', 'class' => 'column-gzip'],
                'user_agent' => ['name' => 'User Agent', 'class' => 'column-user-agent'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
            ]
        ],
        'fallback_error' => [
            'pattern' => '/^(\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[([^\\]]+)\\] (\\d+)#(\\d+): \\*(\\d+) ([^,]+),\\s+client:\\s+([^,]+),\\s+server:\\s+([^,]+),\\s+request:\\s+"([^"]+)",\\s+upstream:\\s+"([^"]+)",\\s+host:\\s+"([^"]+)"$/',
            'parser' => 'NginxProxyManagerParser',
            'columns' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'level' => ['name' => 'Level', 'class' => 'column-level'],
                'pid' => ['name' => 'PID', 'class' => 'column-pid'],
                'tid' => ['name' => 'TID', 'class' => 'column-tid'],
                'connection' => ['name' => 'Connection', 'class' => 'column-connection'],
                'message' => ['name' => 'Message', 'class' => 'column-message'],
                'client' => ['name' => 'Client', 'class' => 'column-client'],
                'server' => ['name' => 'Server', 'class' => 'column-server'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'upstream' => ['name' => 'Upstream', 'class' => 'column-upstream'],
                'host' => ['name' => 'Host', 'class' => 'column-host'],
            ]
        ],
        'dead_host_access' => [
            'pattern' => '/^\[([^\]]+)\] (\d{3}) - ([A-Z]+) (https?) ([^\s]+) "([^"]*)" \[Client ([^\]]+)\] \[Length ([^\]]+)\] \[Gzip ([^\]]+)\] "([^"]*)" "([^"]*)"$/',
            'parser' => 'NPMDeadHostParser',
            'columns' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'status' => ['name' => 'Status', 'class' => 'column-status'],
                'status_in' => ['name' => 'Status In', 'class' => 'column-status-in'],
                'method' => ['name' => 'Method', 'class' => 'column-method'],
                'protocol' => ['name' => 'Protocol', 'class' => 'column-protocol'],
                'host' => ['name' => 'Host', 'class' => 'column-host'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'client_ip' => ['name' => 'Client IP', 'class' => 'column-ip'],
                'length' => ['name' => 'Length', 'class' => 'column-length'],
                'gzip' => ['name' => 'Gzip', 'class' => 'column-gzip'],
                'user_agent' => ['name' => 'User Agent', 'class' => 'column-user-agent'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
            ]
        ],
        'dead_host_error' => [
            'pattern' => '/^(\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[([^\\]]+)\\] (\\d+)#(\\d+): \\*(\\d+) ([^,]+),\\s+client:\\s+([^,]+),\\s+server:\\s+([^,]+),\\s+request:\\s+"([^"]+)",\\s+upstream:\\s+"([^"]+)",\\s+host:\\s+"([^"]+)"(?:,\\s+referrer:\\s+"([^"]+)")?$/',
            'parser' => 'NPMDeadHostParser',
            'columns' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'level' => ['name' => 'Level', 'class' => 'column-level'],
                'pid' => ['name' => 'PID', 'class' => 'column-pid'],
                'tid' => ['name' => 'TID', 'class' => 'column-tid'],
                'connection' => ['name' => 'Connection', 'class' => 'column-connection'],
                'message' => ['name' => 'Message', 'class' => 'column-message'],
                'client' => ['name' => 'Client', 'class' => 'column-client'],
                'server' => ['name' => 'Server', 'class' => 'column-server'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'upstream' => ['name' => 'Upstream', 'class' => 'column-upstream'],
                'host' => ['name' => 'Host', 'class' => 'column-host'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
            ]
        ],
        'default_host_error' => [
            'pattern' => '/^(\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[([^\\]]+)\\] (?:\\d+#\\d+: \\*\\d+ )(.+?) failed \\(([^)]+)\\), client: ([^,]+), (?:server: [^,]+, )?request: "([^"]+)", host: "([^"]+)"/',
            'parser' => 'NPMDefaultHostParser',
            'columns' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'level' => ['name' => 'Level', 'class' => 'column-level'],
                'message' => ['name' => 'Message', 'class' => 'column-message'],
                'error' => ['name' => 'Error', 'class' => 'column-error'],
                'client_ip' => ['name' => 'Client IP', 'class' => 'column-ip'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'host' => ['name' => 'Host', 'class' => 'column-host'],
            ]
        ],
        'letsencrypt_requests_access' => [
            'pattern' => '/^\\[([^\\]]+)\\]\\s+(\\d{3})\\s+-\\s+([A-Z]+)\\s+(https?)\\s+([^\\s]+)\\s+"([^"]*)"\\s+\\[Client\\s+([^\\]]+)\\]\\s+\\[Length\\s+([^\\]]+)\\]\\s+\\[Gzip\\s+([^\\]]+)\\]\\s+"([^"]*)"\\s+"([^"]*)"$/',
            'parser' => 'NPMLetsEncryptParser',
            'columns' => [
                'date' => ['name' => 'Date', 'class' => 'column-date'],
                'status' => ['name' => 'Status', 'class' => 'column-status'],
                'method' => ['name' => 'Method', 'class' => 'column-method'],
                'protocol' => ['name' => 'Protocol', 'class' => 'column-protocol'],
                'host' => ['name' => 'Host', 'class' => 'column-host'],
                'request' => ['name' => 'Request', 'class' => 'column-request'],
                'client_ip' => ['name' => 'Client IP', 'class' => 'column-ip'],
                'length' => ['name' => 'Length', 'class' => 'column-length'],
                'gzip' => ['name' => 'Gzip', 'class' => 'column-gzip'],
                'user_agent' => ['name' => 'User Agent', 'class' => 'column-user-agent'],
                'referer' => ['name' => 'Referer', 'class' => 'column-referer'],
            ]
        ]
    ]
]; 