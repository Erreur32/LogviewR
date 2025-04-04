<?php
// Configuration des patterns pour chaque type de log
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
        3 => '/^192\\.168\\.1\\.150$/',
        4 => '/^192\\.168\\.1\\.254$/',
        5 => '/^192\\.168\\.1\\.252$/',
      ),
      'requests' => 
      array (
        0 => '/server-status(?:\\?auto)?/',
        1 => '/favicon\\.ico/',
        2 => '/robots\\.txt/',
        3 => '/help\\.txt/',
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
    ),
  ),
  'apache' => 
  array (
    'access' => 
    array (
      'pattern' => '/^(\\S+:\\d+) (\\S+) (\\S+) (\\S+) \\[([^\\]]+)\\] "([^"]*)" (\\d{3}) (\\d+|\\-)(?:\\s+"([^"]*)")?(?:\\s+"([^"]*)")?/',
      'columns' => 
      array (
        0 => 'Host',
        1 => 'IP',
        2 => 'Identd',
        3 => 'User',
        4 => 'Date',
        5 => 'Requête',
        6 => 'Code',
        7 => 'Taille',
        8 => 'Referer',
        9 => 'User-Agent',
      ),
    ),
    'error' => 
    array (
      'pattern' => '/^\\[(.*?)\\] \\[([^:]+):([^\\]]+)\\] (?:\\[pid (\\d+)(?::tid (\\d+))?\\])?(?: \\[client ([^\\]]+)\\])? (.*)$/',
      'columns' => 
      array (
        0 => 'Date',
        1 => 'Module',
        2 => 'Level',
        3 => 'PID',
        4 => 'TID',
        5 => 'Client',
        6 => 'Message',
      ),
    ),
  ),
  'nginx' => 
  array (
    'access' => 
    array (
      'pattern' => '/^(\S+) - (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\d+) "([^"]*)" "([^"]*)" "([^"]*)" "([^"]*)"$/',
      'columns' => 
      array (
        0 => 'IP',
        1 => 'User',
        2 => 'Date',
        3 => 'Request',
        4 => 'Status',
        5 => 'Size',
        6 => 'Referer',
        7 => 'User-Agent',
        8 => 'X-Forwarded-For',
        9 => 'X-Real-IP',
      ),
    ),
    'error' => 
    array (
      'pattern' => '/^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: (.*?)(?: while reading upstream client request body)?(?: while connecting to upstream)?(?: while sending to client)?$/',
      'columns' => 
      array (
        0 => 'Date',
        1 => 'Level',
        2 => 'PID',
        3 => 'Message',
      ),
    ),
  ),
  'npm' => 
  array (
    'access' => 
    array (
      'pattern' => '/^\[([^\]]+)\] (\d{3}) - (\w+) (https?) ([^ ]+) "([^"]*)" \[Client ([^\]]+)\] \[Length (\d+)\] \[Gzip ([^\]]+)\] "([^"]*)" "([^"]*)"$/',
      'columns' => 
      array (
        0 => 'Date',
        1 => 'Status',
        2 => 'Method',
        3 => 'Protocol',
        4 => 'URL',
        5 => 'Host',
        6 => 'Client',
        7 => 'Length',
        8 => 'Gzip',
        9 => 'User-Agent',
        10 => 'Referer',
      ),
    ),
    'error' => 
    array (
      'pattern' => '/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: \*(\d+)(?:, client: ([^,]+), server: ([^,]+), request: "([^"]+)", host: "([^"]+)"(?:, upstream: "([^"]+)")?)?$/',
      'columns' => 
      array (
        0 => 'Date',
        1 => 'Level',
        2 => 'PID',
        3 => 'Connection',
        4 => 'Client',
        5 => 'Server',
        6 => 'Request',
        7 => 'Host',
        8 => 'Upstream',
      ),
    ),
    'proxy_host_access' => 
    array (
      'pattern' => '/^\[([^\]]+)\] (\d{3}) - (\w+) (https?) ([^ ]+) "([^"]*)" \[Client ([^\]]+)\] \[Length (\d+)\] \[Gzip ([^\]]+)\] "([^"]*)" "([^"]*)" \[Sent-to ([^\]]+)\]$/',
      'columns' => 
      array (
        0 => 'Date',
        1 => 'Status',
        2 => 'Method',
        3 => 'Protocol',
        4 => 'URL',
        5 => 'Host',
        6 => 'Client',
        7 => 'Length',
        8 => 'Gzip',
        9 => 'User-Agent',
        10 => 'Referer',
        11 => 'Sent-to',
      ),
    ),
    'proxy_host_error' => 
    array (
      'pattern' => '/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: \*(\d+)(?:, client: ([^,]+), server: ([^,]+), request: "([^"]+)", host: "([^"]+)"(?:, upstream: "([^"]+)")?)?$/',
      'columns' => 
      array (
        0 => 'Date',
        1 => 'Level',
        2 => 'PID',
        3 => 'Connection',
        4 => 'Client',
        5 => 'Server',
        6 => 'Request',
        7 => 'Host',
        8 => 'Upstream',
      ),
    ),
    'letsencrypt_access' => 
    array (
      'pattern' => '/^\[([^\]]+)\] (\d{3}) - (\w+) (https?) ([^ ]+) "([^"]*)" \[Client ([^\]]+)\] \[Length (\d+)\] \[Gzip ([^\]]+)\] "([^"]*)" "([^"]*)"$/',
      'columns' => 
      array (
        0 => 'Date',
        1 => 'Status',
        2 => 'Method',
        3 => 'Protocol',
        4 => 'URL',
        5 => 'Host',
        6 => 'Client',
        7 => 'Length',
        8 => 'Gzip',
        9 => 'User-Agent',
        10 => 'Referer',
      ),
    ),
    'letsencrypt_error' => 
    array (
      'pattern' => '/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: \*(\d+)(?:, client: ([^,]+), server: ([^,]+), request: "([^"]+)", host: "([^"]+)"(?:, upstream: "([^"]+)")?)?$/',
      'columns' => 
      array (
        0 => 'Date',
        1 => 'Level',
        2 => 'PID',
        3 => 'Connection',
        4 => 'Client',
        5 => 'Server',
        6 => 'Request',
        7 => 'Host',
        8 => 'Upstream',
      ),
    ),
    'default_host_access' => 
    array (
      'pattern' => '/^(\S+) - - \[([^\]]+)\] "([A-Z]+) ([^\s]+) ([^"]+)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"$/',
      'columns' => 
      array (
        0 => 'ip',
        1 => 'date',
        2 => 'method',
        3 => 'path',
        4 => 'protocol',
        5 => 'status',
        6 => 'size',
        7 => 'referer',
        8 => 'user_agent'
      )
    ),
    'default_host_error' => 
    array (
      'pattern' => '/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: \*(\d+)(?:, client: ([^,]+), server: ([^,]+), request: "([^"]+)", host: "([^"]+)"(?:, upstream: "([^"]+)")?)?$/',
      'columns' => 
      array (
        0 => 'Date',
        1 => 'Level',
        2 => 'PID',
        3 => 'Connection',
        4 => 'Client',
        5 => 'Server',
        6 => 'Request',
        7 => 'Host',
        8 => 'Upstream'
      )
    ),
    'dead_host_access' => 
    array (
      'pattern' => '/^\[([^\]]+)\] (\d{3}) - (\w+) (https?) ([^ ]+) "([^"]*)" \[Client ([^\]]+)\] \[Length (\d+)\] \[Gzip ([^\]]+)\] "([^"]*)" "([^"]*)"$/',
      'columns' => 
      array (
        0 => 'date',
        1 => 'status',
        2 => 'method',
        3 => 'protocol',
        4 => 'host',
        5 => 'request',
        6 => 'client',
        7 => 'length',
        8 => 'gzip',
        9 => 'user_agent',
        10 => 'referer'
      )
    ),
    'dead_host_error' => 
    array (
      'pattern' => '/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: \*(\d+)(?:, client: ([^,]+), server: ([^,]+), request: "([^"]+)", host: "([^"]+)"(?:, upstream: "([^"]+)")?)?$/',
      'columns' => 
      array (
        0 => 'date',
        1 => 'level',
        2 => 'pid',
        3 => 'connection',
        4 => 'client',
        5 => 'server',
        6 => 'request',
        7 => 'host',
        8 => 'upstream'
      )
    ),
    'fallback_access' => 
    array (
      'pattern' => '/^(\S+) (\S+) (\S+) \[([^\]]+)\] "([A-Z]+) ([^ ]*) ([^"]*)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"$/',
      'columns' => 
      array (
        0 => 'IP',
        1 => 'Identd',
        2 => 'User',
        3 => 'Date',
        4 => 'Method',
        5 => 'Path',
        6 => 'Protocol',
        7 => 'Status',
        8 => 'Size',
        9 => 'Referer',
        10 => 'User-Agent'
      )
    ),
    'fallback_error' => 
    array (
      'pattern' => '/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] (\d+)#\d+: \*(\d+)(?:, client: ([^,]+), server: ([^,]+), request: "([^"]+)", host: "([^"]+)"(?:, upstream: "([^"]+)")?)?$/',
      'columns' => 
      array (
        0 => 'Date',
        1 => 'Level',
        2 => 'PID',
        3 => 'Connection',
        4 => 'Client',
        5 => 'Server',
        6 => 'Request',
        7 => 'Host',
        8 => 'Upstream'
      )
    )
  ),
  'syslog' => 
  array (
    'pattern' => '/^(\\w{3}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+(\\S+)\\s+([^:]+):\\s+(.*)$/',
  ),
);
