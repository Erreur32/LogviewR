<?php
/**
 * Web version of Apache logs reader
 * Displays logs in a nice HTML table with styling
 */

// Set error reporting
error_reporting(E_ALL);
ini_set('display_errors', 1);

// Define log file path
$logFile = '/var/log/apache2/access.log';

// HTML header with styling
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Logs Apache</title>
    <style>
        /* Style minimal et efficace */
        body {
            font-family: monospace;
            padding: 20px;
            background: #1e1e1e;
            color: #fff;
        }
        .container {
            max-width: 95%;
            margin: 0 auto;
        }
        .info {
            background: #2d2d2d;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 20px;
        }
        .log-line {
            padding: 5px;
            border-bottom: 1px solid #333;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        .log-line:hover {
            background: #2d2d2d;
        }
        .error { color: #ff6b6b; }
        .warning { color: #ffd93d; }
        .success { color: #6bff6b; }
    </style>
</head>
<body>
    <div class="container">
        <div class="info">
            📁 <?php echo $logFile; ?><br>
            📊 Taille: <?php echo number_format(filesize($logFile)); ?> bytes<br>
            🔒 Permissions: <?php echo substr(sprintf('%o', fileperms($logFile)), -4); ?>
        </div>

        <?php
        try {
            $file = new SplFileObject($logFile, 'r');
            $file->seek(PHP_INT_MAX);
            $lastLine = $file->key();
            $startLine = max(0, $lastLine - 50); // Dernières 50 lignes
            $file->seek($startLine);

            while (!$file->eof()) {
                $line = trim($file->current());
                if (!empty($line)) {
                    $class = '';
                    // Coloration selon le type de log
                    if (strpos($line, 'ERROR') !== false || strpos($line, '500') !== false) {
                        $class = 'error';
                    } elseif (strpos($line, 'WARNING') !== false || strpos($line, '404') !== false) {
                        $class = 'warning';
                    } elseif (strpos($line, '200') !== false) {
                        $class = 'success';
                    }
                    echo "<div class='log-line $class'>" . htmlspecialchars($line) . "</div>";
                }
                $file->next();
            }
        } catch (Exception $e) {
            echo "<div class='log-line error'>Erreur de lecture: " . htmlspecialchars($e->getMessage()) . "</div>";
        }
        ?>
    </div>
</body>
</html> 