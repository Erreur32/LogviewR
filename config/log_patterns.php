<?php
return array (
  'filters' => 
  array (
    'exclude' => 
    array (
      'ips' => 
      array (
        0 => '/^192\\.168\\.1\\.(10|50)$/',
        1 => '/^127\\.0\\.0\\.1$/',
        2 => '/^10\\.0\\.0\\.1$/',
        3 => '/^10\\.0\\.0\\.2$/',
        4 => '/^192\\.168\\.1\\.150$/',
        5 => '/^192\\.168\\.1\\.254$/',
        6 => '/^212\\.203\\.103\\.210$/',
        7 => '/^188\\.165\\.194\\.218$/',
      ),
      'requests' => 
      array (
        0 => '/server-status\\?auto/',
        1 => '/favicon\\.ico/',
        2 => '/\\.(jpg|png|gif|css|js)$/',
        3 => '/robots\\.txt/',
      ),
      'user_agents' => 
      array (
        0 => '/bot/',
        1 => '/crawler/',
        2 => '/spider/',
        3 => '/wget/',
        4 => '/curl/',
        5 => '/munin/',
      ),
      'users' => 
      array (
        0 => '/^Erreur32$/',
        1 => '/^bot$/',
        2 => '/^crawler$/',
        3 => '/^spider$/',
      ),
      'referers' => 
      array (
        0 => '/^https?:\\/\\/localhost/',
        1 => '/^https?:\\/\\/127\\.0\\.0\\.1/',
        2 => '/^https?:\\/\\/192\\.168\\.1\\.150/',
      ),
      'content' => 
      array (
      ),
    ),
  ),
  'apache' => 
  array (
    'access' => 
    array (
      'pattern' => '/^([^:]+):(\\d+)\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)\\s+\\[([^\\]]+)\\]\\s+"([^"]+)"\\s+(\\d{3})\\s+(\\d+|-)\\s+"([^"]*)"\\s+"([^"]*)"/',
      'columns' => 
      array (
        'date' => 
        array (
          'name' => 'Date',
          'class' => 'column-date',
        ),
        'host' => 
        array (
          'name' => 'Host:Port',
          'class' => 'column-host',
        ),
        'ip' => 
        array (
          'name' => 'IP',
          'class' => 'column-ip',
        ),
        'user' => 
        array (
          'name' => 'User',
          'class' => 'column-user',
        ),
        'request' => 
        array (
          'name' => 'Request',
          'class' => 'column-request',
        ),
        'status' => 
        array (
          'name' => 'Status',
          'class' => 'column-status',
        ),
        'size' => 
        array (
          'name' => 'Size',
          'class' => 'column-size',
        ),
        'referer' => 
        array (
          'name' => 'Referer',
          'class' => 'column-referer',
        ),
        'user_agent' => 
        array (
          'name' => 'User-Agent',
          'class' => 'column-user-agent',
        ),
      ),
    ),
    'error' => 
    array (
      'pattern' => '/^\\[(.*?)\\] \\[([^:]+):([^\\]]+)\\] \\[pid (\\d+):tid (\\d+)\\] (?:\\[client ([^\\]]+)\\])? (.*)$/',
      'columns' => 
      array (
        'timestamp' => 
        array (
          'name' => 'Date/Heure',
          'class' => 'column-timestamp',
        ),
        'module' => 
        array (
          'name' => 'Module',
          'class' => 'column-module',
        ),
        'level' => 
        array (
          'name' => 'Niveau',
          'class' => 'column-level',
        ),
        'process' => 
        array (
          'name' => 'Process',
          'class' => 'column-process',
        ),
        'client' => 
        array (
          'name' => 'Client',
          'class' => 'column-client',
        ),
        'message' => 
        array (
          'name' => 'Message',
          'class' => 'column-message',
        ),
      ),
    ),
  ),
  'apache-404' => 
  array (
    'pattern' => '/^(\\S+?)(?::(\\d+))?\\s+([^,\\s]+)(?:,\\s+(\\S+))?\\s+-\\s+-\\s+\\[([^\\]]+)\\]\\s+"([^"]+)"\\s+404\\s+(\\d+|-)(?:\\s+"([^"]*)")?(?:\\s+"([^"]*)")?/',
    'columns' => 
    array (
      'host' => 
      array (
        'name' => 'Host',
        'class' => 'column-host',
      ),
      'ip' => 
      array (
        'name' => 'IP',
        'class' => 'column-ip',
      ),
      'real_ip' => 
      array (
        'name' => 'Real IP',
        'class' => 'column-real-ip',
      ),
      'date' => 
      array (
        'name' => 'Date',
        'class' => 'column-date',
      ),
      'request' => 
      array (
        'name' => 'Request',
        'class' => 'column-request',
      ),
      'size' => 
      array (
        'name' => 'Size',
        'class' => 'column-size',
      ),
      'referer' => 
      array (
        'name' => 'Referer',
        'class' => 'column-referer',
      ),
      'user_agent' => 
      array (
        'name' => 'User-Agent',
        'class' => 'column-user-agent',
      ),
    ),
  ),
  'apache-referer' => 
  array (
    'pattern' => '/^([^\\s]+)\\s+([^\\s]+)\\s+\\[([^\\]]+)\\]\\s+"([^"]+)"\\s+->\\s+"([^"]+)"$/',
    'columns' => 
    array (
      'host' => 
      array (
        'name' => 'Host',
        'class' => 'column-host',
      ),
      'ip' => 
      array (
        'name' => 'IP',
        'class' => 'column-ip',
      ),
      'date' => 
      array (
        'name' => 'Date',
        'class' => 'column-date',
      ),
      'request' => 
      array (
        'name' => 'Request',
        'class' => 'column-request',
      ),
      'referer' => 
      array (
        'name' => 'Referer',
        'class' => 'column-referer',
      ),
    ),
  ),
  'syslog' => 
  array (
    'pattern' => '/^(\\w{3}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+(\\S+)\\s+([^:]+):\\s+(.*)$/',
    'alt_pattern' => '/^(\\w{3}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+(\\S+)\\s+(.*)$/',
    'columns' => 
    array (
      'date' => 
      array (
        'name' => 'Date',
        'class' => 'column-date',
      ),
      'host' => 
      array (
        'name' => 'Host',
        'class' => 'column-host',
      ),
      'program' => 
      array (
        'name' => 'Programme',
        'class' => 'column-program',
      ),
      'message' => 
      array (
        'name' => 'Message',
        'class' => 'column-message',
      ),
    ),
  ),
  'npm-proxy-host-access' => 
  array (
    'pattern' => '/^\\[([^\\]]+)\\]\\s+-\\s+(\\d{3})\\s+(\\d{3})\\s+-\\s+([A-Z]+)\\s+(https?|tcp)\\s+([^\\s]+)\\s+"([^"]*)"\\s+\\[Client\\s+([^\\]]+)\\]\\s+\\[Length\\s+([^\\]]+)\\]\\s+\\[Gzip\\s+([^\\]]+)\\]\\s+\\[Sent-to\\s+([^\\]]+)\\]\\s+"([^"]*)"\\s+"([^"]*)"$/',
    'parser' => 'NginxProxyManagerParser',
    'columns' => 
    array (
      'date' => 
      array (
        'name' => 'Date',
        'class' => 'column-date',
      ),
      'status_in' => 
      array (
        'name' => 'Status In',
        'class' => 'column-status',
      ),
      'status_out' => 
      array (
        'name' => 'Status Out',
        'class' => 'column-status',
      ),
      'method' => 
      array (
        'name' => 'Method',
        'class' => 'column-method',
      ),
      'protocol' => 
      array (
        'name' => 'Protocol',
        'class' => 'column-protocol',
      ),
      'host' => 
      array (
        'name' => 'Host',
        'class' => 'column-host',
      ),
      'request' => 
      array (
        'name' => 'Request',
        'class' => 'column-request',
      ),
      'client_ip' => 
      array (
        'name' => 'Client IP',
        'class' => 'column-ip',
      ),
      'length' => 
      array (
        'name' => 'Length',
        'class' => 'column-length',
      ),
      'gzip' => 
      array (
        'name' => 'Gzip',
        'class' => 'column-gzip',
      ),
      'sent_to' => 
      array (
        'name' => 'Sent To',
        'class' => 'column-sent-to',
      ),
      'user_agent' => 
      array (
        'name' => 'User Agent',
        'class' => 'column-user-agent',
      ),
      'referer' => 
      array (
        'name' => 'Referer',
        'class' => 'column-referer',
      ),
    ),
  ),
  'npm-proxy-host-error' => 
  array (
    'pattern' => '/^(\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[([^\\]]+)\\] (\\d+)#(\\d+): \\*(\\d+) ([^,]+)(?:, client: ([^,]+))?(?:, server: ([^,]+))?(?:, request: "([^"]+)")?(?:, upstream: "([^"]+)")?(?:, host: "([^"]+)")?(?:, referrer: "([^"]+)")?$/',
    'parser' => 'NPMProxyHostParser',
    'columns' => 
    array (
      'date' => 
      array (
        'name' => 'Date',
        'class' => 'column-date',
      ),
      'level' => 
      array (
        'name' => 'Level',
        'class' => 'column-level',
      ),
      'pid' => 
      array (
        'name' => 'PID',
        'class' => 'column-pid',
      ),
      'tid' => 
      array (
        'name' => 'TID',
        'class' => 'column-tid',
      ),
      'connection' => 
      array (
        'name' => 'Connection',
        'class' => 'column-connection',
      ),
      'message' => 
      array (
        'name' => 'Message',
        'class' => 'column-message',
      ),
      'client' => 
      array (
        'name' => 'Client',
        'class' => 'column-client',
      ),
      'server' => 
      array (
        'name' => 'Server',
        'class' => 'column-server',
      ),
      'request' => 
      array (
        'name' => 'Request',
        'class' => 'column-request',
      ),
      'upstream' => 
      array (
        'name' => 'Upstream',
        'class' => 'column-upstream',
      ),
      'host' => 
      array (
        'name' => 'Host',
        'class' => 'column-host',
      ),
      'referer' => 
      array (
        'name' => 'Referer',
        'class' => 'column-referer',
      ),
    ),
  ),
  'npm-default-host-access' => 
  array (
    'pattern' => '/^(\\S+) - - \\[([^\\]]+)\\] "([^"]*)" (\\d{3}) (\\d+) "([^"]*)" "([^"]*)"$/',
    'parser' => 'NPMDefaultHostParser',
    'columns' => 
    array (
      'client_ip' => 
      array (
        'name' => 'Client IP',
        'class' => 'column-client-ip',
      ),
      'date' => 
      array (
        'name' => 'Date',
        'class' => 'column-date',
      ),
      'request' => 
      array (
        'name' => 'Request',
        'class' => 'column-request',
      ),
      'status' => 
      array (
        'name' => 'Status',
        'class' => 'column-status',
      ),
      'size' => 
      array (
        'name' => 'Size',
        'class' => 'column-size',
      ),
      'referer' => 
      array (
        'name' => 'Referer',
        'class' => 'column-referer',
      ),
      'user_agent' => 
      array (
        'name' => 'User-Agent',
        'class' => 'column-user-agent',
      ),
    ),
  ),
  'npm-fallback-access' => 
  array (
    'pattern' => '/^\\[([^\\]]+)\\]\\s+(\\d{3})\\s+-\\s+([A-Z]+)\\s+(https?)\\s+([^\\s]+)\\s+"([^"]*)"\\s+\\[Client\\s+([^\\]]+)\\]\\s+\\[Length\\s+([^\\]]+)\\]\\s+\\[Gzip\\s+([^\\]]+)\\]\\s+"([^"]*)"\\s+"([^"]*)"$/',
    'parser' => 'NginxProxyManagerParser',
    'columns' => 
    array (
      'date' => 
      array (
        'name' => 'Date',
        'class' => 'column-date',
      ),
      'status' => 
      array (
        'name' => 'Status',
        'class' => 'column-status',
      ),
      'method' => 
      array (
        'name' => 'Method',
        'class' => 'column-method',
      ),
      'protocol' => 
      array (
        'name' => 'Protocol',
        'class' => 'column-protocol',
      ),
      'host' => 
      array (
        'name' => 'Host',
        'class' => 'column-host',
      ),
      'request' => 
      array (
        'name' => 'Request',
        'class' => 'column-request',
      ),
      'client_ip' => 
      array (
        'name' => 'Client IP',
        'class' => 'column-ip',
      ),
      'length' => 
      array (
        'name' => 'Length',
        'class' => 'column-length',
      ),
      'gzip' => 
      array (
        'name' => 'Gzip',
        'class' => 'column-gzip',
      ),
      'user_agent' => 
      array (
        'name' => 'User Agent',
        'class' => 'column-user-agent',
      ),
      'referer' => 
      array (
        'name' => 'Referer',
        'class' => 'column-referer',
      ),
    ),
  ),
  'npm-fallback-error' => 
  array (
    'pattern' => '/^(\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[([^\\]]+)\\] (\\d+)#(\\d+): \\*(\\d+) ([^,]+),\\s+client:\\s+([^,]+),\\s+server:\\s+([^,]+),\\s+request:\\s+"([^"]+)",\\s+upstream:\\s+"([^"]+)",\\s+host:\\s+"([^"]+)"$/',
    'parser' => 'NginxProxyManagerParser',
    'columns' => 
    array (
      'date' => 
      array (
        'name' => 'Date',
        'class' => 'column-date',
      ),
      'level' => 
      array (
        'name' => 'Level',
        'class' => 'column-level',
      ),
      'pid' => 
      array (
        'name' => 'PID',
        'class' => 'column-pid',
      ),
      'tid' => 
      array (
        'name' => 'TID',
        'class' => 'column-tid',
      ),
      'connection' => 
      array (
        'name' => 'Connection',
        'class' => 'column-connection',
      ),
      'message' => 
      array (
        'name' => 'Message',
        'class' => 'column-message',
      ),
      'client' => 
      array (
        'name' => 'Client',
        'class' => 'column-client',
      ),
      'server' => 
      array (
        'name' => 'Server',
        'class' => 'column-server',
      ),
      'request' => 
      array (
        'name' => 'Request',
        'class' => 'column-request',
      ),
      'upstream' => 
      array (
        'name' => 'Upstream',
        'class' => 'column-upstream',
      ),
      'host' => 
      array (
        'name' => 'Host',
        'class' => 'column-host',
      ),
    ),
  ),
  'npm-dead-host-access' => 
  array (
    'pattern' => '/^\\[([^\\]]+)\\]\\s+(\\d{3})\\s+-\\s+([A-Z]+)\\s+(https?)\\s+([^\\s]+)\\s+"([^"]+)"\\s+\\[Client\\s+([^\\]]+)\\]\\s+\\[Length\\s+([^\\]]+)\\]\\s+\\[Gzip\\s+([^\\]]+)\\]\\s+"([^"]*)"\\s+"([^"]*)"$/',
    'parser' => 'NPMDeadHostParser',
    'columns' => 
    array (
      'date' => 
      array (
        'name' => 'Date',
        'class' => 'column-date',
      ),
      'status' => 
      array (
        'name' => 'Status',
        'class' => 'column-status',
      ),
      'method' => 
      array (
        'name' => 'Method',
        'class' => 'column-method',
      ),
      'protocol' => 
      array (
        'name' => 'Protocol',
        'class' => 'column-protocol',
      ),
      'host' => 
      array (
        'name' => 'Host',
        'class' => 'column-host',
      ),
      'request' => 
      array (
        'name' => 'Request',
        'class' => 'column-request',
      ),
      'client_ip' => 
      array (
        'name' => 'Client IP',
        'class' => 'column-ip',
      ),
      'length' => 
      array (
        'name' => 'Length',
        'class' => 'column-length',
      ),
      'gzip' => 
      array (
        'name' => 'Gzip',
        'class' => 'column-gzip',
      ),
      'user_agent' => 
      array (
        'name' => 'User Agent',
        'class' => 'column-user-agent',
      ),
      'referer' => 
      array (
        'name' => 'Referer',
        'class' => 'column-referer',
      ),
    ),
  ),
  'npm-dead-host-error' => 
  array (
    'pattern' => '/^(\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[([^\\]]+)\\] (\\d+)#(\\d+): \\*(\\d+) ([^,]+),\\s+client:\\s+([^,]+),\\s+server:\\s+([^,]+),\\s+request:\\s+"([^"]+)",\\s+upstream:\\s+"([^"]+)",\\s+host:\\s+"([^"]+)"(?:,\\s+referrer:\\s+"([^"]+)")?$/',
    'parser' => 'NPMDeadHostParser',
    'columns' => 
    array (
      'date' => 
      array (
        'name' => 'Date',
        'class' => 'column-date',
      ),
      'level' => 
      array (
        'name' => 'Level',
        'class' => 'column-level',
      ),
      'pid' => 
      array (
        'name' => 'PID',
        'class' => 'column-pid',
      ),
      'tid' => 
      array (
        'name' => 'TID',
        'class' => 'column-tid',
      ),
      'connection' => 
      array (
        'name' => 'Connection',
        'class' => 'column-connection',
      ),
      'message' => 
      array (
        'name' => 'Message',
        'class' => 'column-message',
      ),
      'client' => 
      array (
        'name' => 'Client',
        'class' => 'column-client',
      ),
      'server' => 
      array (
        'name' => 'Server',
        'class' => 'column-server',
      ),
      'request' => 
      array (
        'name' => 'Request',
        'class' => 'column-request',
      ),
      'upstream' => 
      array (
        'name' => 'Upstream',
        'class' => 'column-upstream',
      ),
      'host' => 
      array (
        'name' => 'Host',
        'class' => 'column-host',
      ),
      'referer' => 
      array (
        'name' => 'Referer',
        'class' => 'column-referer',
      ),
    ),
  ),
  'npm-default-host-error' => 
  array (
    'pattern' => '/^(\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[([^\\]]+)\\] (?:\\d+#\\d+: \\*\\d+ )(.+?) failed \\(([^)]+)\\), client: ([^,]+), (?:server: [^,]+, )?request: "([^"]+)", host: "([^"]+)"/',
    'parser' => 'NPMDefaultHostParser',
    'columns' => 
    array (
      'date' => 
      array (
        'name' => 'Date',
        'class' => 'column-date',
      ),
      'level' => 
      array (
        'name' => 'Level',
        'class' => 'column-level',
      ),
      'message' => 
      array (
        'name' => 'Message',
        'class' => 'column-message',
      ),
      'error' => 
      array (
        'name' => 'Error',
        'class' => 'column-error',
      ),
      'client_ip' => 
      array (
        'name' => 'Client IP',
        'class' => 'column-ip',
      ),
      'request' => 
      array (
        'name' => 'Request',
        'class' => 'column-request',
      ),
      'host' => 
      array (
        'name' => 'Host',
        'class' => 'column-host',
      ),
    ),
  ),
  'npm-letsencrypt-requests_access' => array(
    'pattern' => '/^\\[([^\\]]+)\\]\\s+(\\d{3})\\s+-\\s+([A-Z]+)\\s+(https?)\\s+([^\\s]+)\\s+"([^"]*)"\\s+\\[Client\\s+([^\\]]+)\\]\\s+\\[Length\\s+([^\\]]+)\\]\\s+\\[Gzip\\s+([^\\]]+)\\]\\s+"([^"]*)"\\s+"([^"]*)"$/',
    'parser' => 'NPMLetsEncryptParser',
    'columns' => array(
      'date' => array(
        'name' => 'Date',
        'class' => 'column-date'
      ),
      'status' => array(
        'name' => 'Status',
        'class' => 'column-status'
      ),
      'method' => array(
        'name' => 'Method',
        'class' => 'column-method'
      ),
      'protocol' => array(
        'name' => 'Protocol',
        'class' => 'column-protocol'
      ),
      'host' => array(
        'name' => 'Host',
        'class' => 'column-host'
      ),
      'request' => array(
        'name' => 'Request',
        'class' => 'column-request'
      ),
      'client_ip' => array(
        'name' => 'Client IP',
        'class' => 'column-ip'
      ),
      'length' => array(
        'name' => 'Length',
        'class' => 'column-length'
      ),
      'gzip' => array(
        'name' => 'Gzip',
        'class' => 'column-gzip'
      ),
      'user_agent' => array(
        'name' => 'User Agent',
        'class' => 'column-user-agent'
      ),
      'referer' => array(
        'name' => 'Referer',
        'class' => 'column-referer'
      )
    )
  ),
);
