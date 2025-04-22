<?php
return array (
  'apache' => 
  array (
    'access' => 
    array (
      'pattern' => '/^\\[([^\\]]+)\\] ([\\d\\.]+) ([\\d\\.]+) (\\S+) (\\S+) ([^\\s]+) "([^"]+)" (\\d{3}) (\\d+) "([^"]*)" "([^"]*)"$/',
      'parser' => 'ApacheAccessParser',
      'columns' => 
      array (
        'client_ip' => 
        array (
          'name' => 'IP',
          'class' => 'column-ip',
        ),
        'identity' => 
        array (
          'name' => 'Identity',
          'class' => 'column-identity',
        ),
        'user' => 
        array (
          'name' => 'User',
          'class' => 'column-user',
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
    'error' => 
    array (
      'pattern' => '/^\\[(.*?)\\] \\[([^\\]]*)\\] \\[([^\\]]*)\\] (.*)$/',
      'parser' => 'ApacheErrorParser',
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
    'pattern' => '/^\\[([^\\]]+)\\] ([^\\s]+) ([^\\s]+) ([\\d\\.]+) (\\S+) (\\S+) "([^"]+)" (\\d{3}) (\\d+) "([^"]*)" "([^"]*)" "([^"]*)"$/',
    'parser' => 'Apache404Parser',
    'columns' => 
    array (
      'client_ip' => 
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
      'user_agent' => 
      array (
        'name' => 'User-Agent',
        'class' => 'column-user-agent',
      ),
    ),
  ),
  'apache-referer' => 
  array (
    'pattern' => '/^\\[([^\\]]+)\\] ([^:]+):(\\d+) ([\\d\\.]+) (\\S+) (\\S+) (.*?) -> ([^ ]+) (.+)$/',
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
  'nginx' => 
  array (
    'access' => 
    array (
      'pattern' => '/^(\\S+) - (\\S+) \\[([^\\]]+)\\] "([^"]*)" (\\d{3}) (\\d+) "([^"]*)" "([^"]*)"$/',
      'parser' => 'NginxAccessParser',
      'columns' => 
      array (
        'remote_addr' => 
        array (
          'name' => 'IP',
          'class' => 'column-ip',
        ),
        'remote_user' => 
        array (
          'name' => 'User',
          'class' => 'column-user',
        ),
        'time_local' => 
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
        'body_bytes_sent' => 
        array (
          'name' => 'Size',
          'class' => 'column-size',
        ),
        'http_referer' => 
        array (
          'name' => 'Referer',
          'class' => 'column-referer',
        ),
        'http_user_agent' => 
        array (
          'name' => 'User-Agent',
          'class' => 'column-user-agent',
        ),
      ),
    ),
    'error' => 
    array (
      'pattern' => '/^(\\d{4}/\\d{2}/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[(\\w+)\\] (\\d+)#\\d+: \\*(\\d+) (.*)$/',
      'parser' => 'NginxErrorParser',
      'columns' => 
      array (
        'time' => 
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
        'message' => 
        array (
          'name' => 'Message',
          'class' => 'column-message',
        ),
      ),
    ),
  ),
  'npm' => 
  array (
    'default_host_access' => 
    array (
      'pattern' => '/^(\S+) - - \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+) "([^"]*)" "([^"]*)"$/',
      'parser' => 'NPMDefaultHostParser',
      'columns' => 
      array (
        'client_ip' => array ('name' => 'Client IP', 'class' => 'column-client-ip'),
        'date' => array ('name' => 'Date', 'class' => 'column-date'),
        'request' => array ('name' => 'Request', 'class' => 'column-request'),
        'status' => array ('name' => 'Status', 'class' => 'column-status'),
        'size' => array ('name' => 'Size', 'class' => 'column-size'),
        'referer' => array ('name' => 'Referer', 'class' => 'column-referer'),
        'user_agent' => array ('name' => 'User-Agent', 'class' => 'column-user-agent'),
      ),
    ),
    'proxy_host_access' => 
    array (
      'pattern' => '/^\[([^\]]+)\] (-) (-) (\d{3}) (-) ([A-Z]+) (https?) ([^\s]+) "([^"]*)" \[Client ([^\]]+)\] \[Length ([^\]]+)\] \[Gzip ([^\]]+)\] \[Sent-to ([^\]]+)\] "([^"]*)" "([^"]*)"$/',
      'parser' => 'NPMProxyHostParser',
      'columns' => 
      array (
        'date' => array ('name' => 'Date', 'class' => 'column-date'),
        'identity' => array ('name' => 'Identity', 'class' => 'column-identity'),
        'user' => array ('name' => 'User', 'class' => 'column-user'),
        'status' => array ('name' => 'Status', 'class' => 'column-status'),
        'status_in' => array ('name' => 'Status In', 'class' => 'column-status-in'),
        'method' => array ('name' => 'Method', 'class' => 'column-method'),
        'protocol' => array ('name' => 'Protocol', 'class' => 'column-protocol'),
        'host' => array ('name' => 'Host', 'class' => 'column-host'),
        'request' => array ('name' => 'Request', 'class' => 'column-request'),
        'client_ip' => array ('name' => 'Client IP', 'class' => 'column-ip'),
        'length' => array ('name' => 'Length', 'class' => 'column-length'),
        'gzip' => array ('name' => 'Gzip', 'class' => 'column-gzip'),
        'sent_to' => array ('name' => 'Sent To', 'class' => 'column-sent-to'),
        'user_agent' => array ('name' => 'User Agent', 'class' => 'column-user-agent'),
        'referer' => array ('name' => 'Referer', 'class' => 'column-referer'),
      ),
    ),
    'proxy_host_error' => 
    array (
      'pattern' => '/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[([^\]]+)\] (\d+)#(\d+): \*(\d+)? ?([^,]+), client: ([^,]+), server: ([^,]+), request: "([^"]+)", host: "([^"]+)(?::\d+)?"$/',
      'parser' => 'NPMProxyHostParser',
      'columns' => 
      array (
        'date' => array ('name' => 'Date', 'class' => 'column-date'),
        'level' => array ('name' => 'Level', 'class' => 'column-level'),
        'pid' => array ('name' => 'PID', 'class' => 'column-pid'),
        'tid' => array ('name' => 'TID', 'class' => 'column-tid'),
        'connection' => array ('name' => 'Connection', 'class' => 'column-connection'),
        'message' => array ('name' => 'Message', 'class' => 'column-message'),
        'client' => array ('name' => 'Client', 'class' => 'column-client'),
        'server' => array ('name' => 'Server', 'class' => 'column-server'),
        'request' => array ('name' => 'Request', 'class' => 'column-request'),
        'host' => array ('name' => 'Host', 'class' => 'column-host')
      ),
    ),
    'fallback_access' => 
    array (
      'pattern' => '/^\[([^\]]+)\] (\d{3}) (-) ([A-Z]+) (https?) ([^\s]+) "([^"]*)" \[Client ([^\]]+)\] \[Length ([^\]]+)\] \[Gzip ([^\]]+)\] "([^"]*)" "([^"]*)"$/',
      'parser' => 'NPMFallbackParser',
      'columns' => 
      array (
        'date' => array ('name' => 'Date', 'class' => 'column-date'),
        'status' => array ('name' => 'Status', 'class' => 'column-status'),
        'status_in' => array ('name' => 'Status In', 'class' => 'column-status-in'),
        'method' => array ('name' => 'Method', 'class' => 'column-method'),
        'protocol' => array ('name' => 'Protocol', 'class' => 'column-protocol'),
        'host' => array ('name' => 'Host', 'class' => 'column-host'),
        'request' => array ('name' => 'Request', 'class' => 'column-request'),
        'client_ip' => array ('name' => 'Client IP', 'class' => 'column-ip'),
        'length' => array ('name' => 'Length', 'class' => 'column-length'),
        'gzip' => array ('name' => 'Gzip', 'class' => 'column-gzip'),
        'user_agent' => array ('name' => 'User Agent', 'class' => 'column-user-agent'),
        'referer' => array ('name' => 'Referer', 'class' => 'column-referer'),
      ),
    ),
    'fallback_error' => 
    array (
      'pattern' => '/^(\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[([^\\]]+)\\] (\\d+)#(\\d+): (.*)$/',
      'parser' => 'NPMFallbackParser',
      'columns' => 
      array (
        'date' => array ('name' => 'Date', 'class' => 'column-date'),
        'level' => array ('name' => 'Level', 'class' => 'column-level'),
        'pid' => array ('name' => 'PID', 'class' => 'column-pid'),
        'tid' => array ('name' => 'TID', 'class' => 'column-tid'),
        'message' => array ('name' => 'Message', 'class' => 'column-message')
      ),
    ),
    'dead_host_access' => 
    array (
      'pattern' => '/^\[([^\]]+)\] (\d{3}) - ([A-Z]+) (https?) ([^\s]+) "([^"]*)" \[Client ([^\]]+)\] \[Length ([^\]]+)\] \[Gzip ([^\]]+)\] "([^"]*)" "([^"]*)"$/',
      'parser' => 'NPMDeadHostParser',
      'columns' => 
      array (
        'date' => array ('name' => 'Date', 'class' => 'column-date'),
        'status' => array ('name' => 'Status', 'class' => 'column-status'),
        'status_in' => array ('name' => 'Status In', 'class' => 'column-status-in'),
        'method' => array ('name' => 'Method', 'class' => 'column-method'),
        'protocol' => array ('name' => 'Protocol', 'class' => 'column-protocol'),
        'host' => array ('name' => 'Host', 'class' => 'column-host'),
        'request' => array ('name' => 'Request', 'class' => 'column-request'),
        'client_ip' => array ('name' => 'Client IP', 'class' => 'column-ip'),
        'length' => array ('name' => 'Length', 'class' => 'column-length'),
        'gzip' => array ('name' => 'Gzip', 'class' => 'column-gzip'),
        'user_agent' => array ('name' => 'User Agent', 'class' => 'column-user-agent'),
        'referer' => array ('name' => 'Referer', 'class' => 'column-referer'),
      ),
    ),
    'dead_host_error' => 
    array (
      'pattern' => '/^(\\d{4}\\/\\d{2}\\/\\d{2} \\d{2}:\\d{2}:\\d{2}) \\[([^\\]]+)\\] (\\d+)#(\\d+): \\*(\\d+) ([^,]+),\\s+client:\\s+([^,]+),\\s+server:\\s+([^,]+),\\s+request:\\s+"([^"]+)",\\s+upstream:\\s+"([^"]+)",\\s+host:\\s+"([^"]+)"(?:,\\s+referrer:\\s+"([^"]+)")?$/',
      'parser' => 'NPMDeadHostParser',
      'columns' => 
      array (
        'date' => array ('name' => 'Date', 'class' => 'column-date'),
        'level' => array ('name' => 'Level', 'class' => 'column-level'),
        'pid' => array ('name' => 'PID', 'class' => 'column-pid'),
        'tid' => array ('name' => 'TID', 'class' => 'column-tid'),
        'connection' => array ('name' => 'Connection', 'class' => 'column-connection'),
        'message' => array ('name' => 'Message', 'class' => 'column-message'),
        'client' => array ('name' => 'Client', 'class' => 'column-client'),
        'server' => array ('name' => 'Server', 'class' => 'column-server'),
        'request' => array ('name' => 'Request', 'class' => 'column-request'),
        'upstream' => array ('name' => 'Upstream', 'class' => 'column-upstream'),
        'host' => array ('name' => 'Host', 'class' => 'column-host'),
        'referer' => array ('name' => 'Referer', 'class' => 'column-referer'),
      ),
    ),
    'default_host_error' => 
    array (
      'pattern' => '/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[([^\]]+)\] (\d+)#(\d+): \*(\d+) (.+?) \(([^)]+)\), client: ([^,]+), server: ([^,]+), request: "([^"]+)", host: "([^"]+)"$/',
      'parser' => 'NPMDefaultHostParser',
      'columns' => 
      array (
        'date' => array ('name' => 'Date', 'class' => 'column-date'),
        'level' => array ('name' => 'Level', 'class' => 'column-level'),
        'pid' => array ('name' => 'PID', 'class' => 'column-pid'),
        'tid' => array ('name' => 'TID', 'class' => 'column-tid'),
        'connection' => array ('name' => 'Connection', 'class' => 'column-connection'),
        'message' => array ('name' => 'Message', 'class' => 'column-message'),
        'error_code' => array ('name' => 'Error Code', 'class' => 'column-error'),
        'client_ip' => array ('name' => 'Client IP', 'class' => 'column-ip'),
        'server' => array ('name' => 'Server', 'class' => 'column-server'),
        'request' => array ('name' => 'Request', 'class' => 'column-request'),
        'host' => array ('name' => 'Host', 'class' => 'column-host')
      ),
    ),
    'letsencrypt_requests_access' => 
    array (
      'pattern' => '/^\\[([^\\]]+)\\]\\s+(\\d{3})\\s+-\\s+([A-Z]+)\\s+(https?)\\s+([^\\s]+)\\s+"([^"]*)"\\s+\\[Client\\s+([^\\]]+)\\]\\s+\\[Length\\s+([^\\]]+)\\]\\s+\\[Gzip\\s+([^\\]]+)\\]\\s+"([^"]*)"\\s+"([^"]*)"$/',
      'parser' => 'NPMLetsEncryptParser',
      'columns' => 
      array (
        'date' => array ('name' => 'Date', 'class' => 'column-date'),
        'status' => array ('name' => 'Status', 'class' => 'column-status'),
        'method' => array ('name' => 'Method', 'class' => 'column-method'),
        'protocol' => array ('name' => 'Protocol', 'class' => 'column-protocol'),
        'host' => array ('name' => 'Host', 'class' => 'column-host'),
        'request' => array ('name' => 'Request', 'class' => 'column-request'),
        'client_ip' => array ('name' => 'Client IP', 'class' => 'column-ip'),
        'length' => array ('name' => 'Length', 'class' => 'column-length'),
        'gzip' => array ('name' => 'Gzip', 'class' => 'column-gzip'),
        'user_agent' => array ('name' => 'User Agent', 'class' => 'column-user-agent'),
        'referer' => array ('name' => 'Referer', 'class' => 'column-referer'),
      ),
    ) 
  )
);
