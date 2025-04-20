<?php
// Test script to verify paths
$config = require_once __DIR__ . '/../config/config.php';

// Define constants if not already defined
if (!defined('BASE_PATH')) {
    define('BASE_PATH', dirname(__DIR__));
}
if (!defined('LOGS_PATH')) {
    define('LOGS_PATH', BASE_PATH . '/logs');
}

// Start HTML output
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test des Chemins - LogviewR</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            margin: 20px;
            background-color: #f5f5f5;
            color: #333;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #2c3e50;
            border-bottom: 2px solid #3498db;
            padding-bottom: 10px;
        }
        .section {
            margin: 20px 0;
            padding: 15px;
            background-color: #f8f9fa;
            border-radius: 5px;
            border-left: 4px solid #3498db;
        }
        .result {
            margin: 10px 0;
            padding: 10px;
            background-color: #fff;
            border-radius: 4px;
            border: 1px solid #ddd;
        }
        .success {
            color: #27ae60;
        }
        .error {
            color: #e74c3c;
        }
        .info {
            color: #3498db;
        }
        pre {
            background-color: #2c3e50;
            color: #ecf0f1;
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Test des Chemins - LogviewR</h1>

        <div class="section">
            <h2>Informations de Base</h2>
            <div class="result">
                <p><strong>Timezone configuré:</strong> <?php echo date_default_timezone_get(); ?></p>
                <p><strong>Date actuelle:</strong> <?php echo date('Y-m-d H:i:s'); ?></p>
            </div>
        </div>

        <div class="section">
            <h2>Chemins du Système</h2>
            <div class="result">
                <p><strong>Chemin de base (BASE_PATH):</strong> <?php echo BASE_PATH; ?></p>
                <p><strong>Chemin des logs (LOGS_PATH):</strong> <?php echo LOGS_PATH; ?></p>
                <p><strong>Current directory:</strong> <?php echo __DIR__; ?></p>
                <p><strong>Directory separator:</strong> <?php echo DIRECTORY_SEPARATOR; ?></p>
            </div>
        </div>

        <div class="section">
            <h2>Fichier de Log de Debug</h2>
            <?php
            $debugLogFile = LOGS_PATH . '/debug.log';
            ?>
            <div class="result">
                <p><strong>Chemin configuré:</strong> <?php echo $debugLogFile; ?></p>
                
                <?php
                // Create logs directory if it doesn't exist
                if (!is_dir(LOGS_PATH)) {
                    echo '<p class="info">Création du dossier logs...</p>';
                    if (!mkdir(LOGS_PATH, 0755, true)) {
                        echo '<p class="error">Impossible de créer le dossier logs</p>';
                    } else {
                        echo '<p class="success">Dossier logs créé avec succès</p>';
                    }
                }
                ?>

                <p><strong>Le dossier existe ?</strong> 
                    <span class="<?php echo is_dir(LOGS_PATH) ? 'success' : 'error'; ?>">
                        <?php echo is_dir(LOGS_PATH) ? 'OUI' : 'NON'; ?>
                    </span>
                </p>
                <p><strong>Le fichier existe ?</strong> 
                    <span class="<?php echo file_exists($debugLogFile) ? 'success' : 'error'; ?>">
                        <?php echo file_exists($debugLogFile) ? 'OUI' : 'NON'; ?>
                    </span>
                </p>

                <?php
                // Test d'écriture
                $testMessage = date('Y-m-d H:i:s') . " Test d'écriture dans le fichier de log\n";
                $result = file_put_contents($debugLogFile, $testMessage, FILE_APPEND);
                ?>
                <p><strong>Test d'écriture:</strong> 
                    <span class="<?php echo $result !== false ? 'success' : 'error'; ?>">
                        <?php echo $result !== false ? 'RÉUSSIE' : 'ÉCHOUÉE'; ?>
                    </span>
                </p>
            </div>
        </div>

        <div class="section">
            <h2>Chemins des Logs Configurés</h2>
            <div class="result">
                <?php
                if (isset($config['paths']) && is_array($config['paths'])) {
                    foreach ($config['paths'] as $type => $path) {
                        echo "<div class='path-info'>";
                        echo "<h3>$type</h3>";
                        echo "<p><strong>Chemin:</strong> $path</p>";
                        echo "<p><strong>Le chemin existe ?</strong> ";
                        echo "<span class='" . (file_exists($path) ? 'success' : 'error') . "'>";
                        echo file_exists($path) ? 'OUI' : 'NON';
                        echo "</span></p>";
                        echo "<p><strong>Est lisible ?</strong> ";
                        echo "<span class='" . (is_readable($path) ? 'success' : 'error') . "'>";
                        echo is_readable($path) ? 'OUI' : 'NON';
                        echo "</span></p>";
                        echo "</div>";
                    }
                } else {
                    echo '<p class="error">Aucun chemin configuré dans config.php</p>';
                }
                ?>
            </div>
        </div>
    </div>
</body>
</html> 