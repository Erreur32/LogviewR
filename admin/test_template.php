<?php
// Vérifier que ce fichier n'est pas appelé directement
if (!defined('LOGVIEWR_ROOT')) {
    define('LOGVIEWR_ROOT', dirname(__DIR__));
}

// Vérifier que la variable testResults est définie
if (!isset($testResults)) {
    die("❌ Erreur : Variable testResults non définie");
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test de Configuration - LogviewR</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.7.2/font/bootstrap-icons.css" rel="stylesheet">
    <style>
        :root {
            --primary-color: #3498db;
            --success-color: #2ecc71;
            --error-color: #e74c3c;
            --warning-color: #f1c40f;
            --background-color: #1a1a1a;
            --card-background: #2d2d2d;
            --text-color: #ffffff;
            --border-radius: 0.75rem;
            --shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
            --transition: all 0.3s ease;
        }

        body {
            background-color: var(--background-color);
            color: var(--text-color);
            font-family: system-ui, -apple-system, sans-serif;
            line-height: 1.6;
        }

        .container {
            max-width: 1200px;
            padding: 2rem 1rem;
        }

        h1, h2, h3 {
            color: var(--primary-color);
            font-weight: 700;
            margin-bottom: 1.5rem;
        }

        .test-card {
            background-color: var(--card-background);
            border-radius: var(--border-radius);
            box-shadow: var(--shadow);
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            transition: var(--transition);
        }

 

        .test-item {
            background-color: rgba(255, 255, 255, 0.05);
            border-radius: calc(var(--border-radius) * 0.75);
            padding: 1rem;
            margin-bottom: 1rem;
        }

        .test-success {
            border-left: 4px solid var(--success-color);
        }

        .test-error {
            border-left: 4px solid var(--error-color);
        }

        .test-warning {
            border-left: 4px solid var(--warning-color);
        }

        pre {
            background-color: rgba(0, 0, 0, 0.2);
            border-radius: calc(var(--border-radius) * 0.5);
            padding: 1rem;
            color: var(--text-color);
            font-size: 0.875rem;
            overflow-x: auto;
        }

        .status-icon {
            font-size: 1.25rem;
            margin-right: 0.75rem;
        }

        .status-icon.success {
            color: var(--success-color);
        }

        .status-icon.error {
            color: var(--error-color);
        }

        .status-icon.warning {
            color: var(--warning-color);
        }

        .btn-primary {
            background-color: var(--primary-color);
            border: none;
            border-radius: calc(var(--border-radius) * 0.5);
            padding: 0.75rem 1.5rem;
            font-weight: 500;
            transition: var(--transition);
        }

        .btn-primary:hover {
            background-color: #2980b9;
            transform: translateY(-1px);
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 Test de Configuration - LogviewR</h1>
        
        <!-- Système -->
        <div class="test-card">
            <h2>💻 Système</h2>
            <div class="test-item <?php echo $testResults['system']['php_version']['success'] ? 'test-success' : 'test-error'; ?>">
                <i class="bi bi-cpu status-icon <?php echo $testResults['system']['php_version']['success'] ? 'success' : 'error'; ?>"></i>
                <strong>Version PHP:</strong> <?php echo $testResults['system']['php_version']['message']; ?>
                <div class="small">(Requis: <?php echo $testResults['system']['php_version']['required']; ?>)</div>
            </div>
            
            <div class="test-item <?php echo $testResults['system']['extensions']['success'] ? 'test-success' : 'test-error'; ?>">
                <i class="bi bi-puzzle status-icon <?php echo $testResults['system']['extensions']['success'] ? 'success' : 'error'; ?>"></i>
                <strong>Extensions:</strong>
                <ul class="mb-0">
                    <?php foreach ($testResults['system']['extensions']['details'] as $ext => $loaded): ?>
                        <li><?php echo $ext; ?>: <?php echo $loaded ? '✅' : '❌'; ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        </div>

        <!-- Chemins -->
        <div class="test-card">
            <h2>📁 Chemins</h2>
            <?php foreach ($testResults['paths'] as $name => $path): ?>
                <div class="test-item <?php echo ($path['readable'] && $path['writable']) ? 'test-success' : 'test-error'; ?>">
                    <i class="bi bi-folder status-icon <?php echo ($path['readable'] && $path['writable']) ? 'success' : 'error'; ?>"></i>
                    <strong><?php echo ucfirst($name); ?>:</strong> <?php echo $path['path']; ?>
                    <div class="small">
                        Existe: <?php echo $path['exists'] ? '✅' : '❌'; ?> |
                        Lecture: <?php echo $path['readable'] ? '✅' : '❌'; ?> |
                        Écriture: <?php echo $path['writable'] ? '✅' : '❌'; ?>
                    </div>
                </div>
            <?php endforeach; ?>
        </div>

        <!-- Configuration -->
        <div class="test-card">
            <h2>⚙️ Configuration</h2>
            <div class="test-item <?php echo $testResults['config']['debug']['writable'] ? 'test-success' : 'test-warning'; ?>">
                <i class="bi bi-bug status-icon <?php echo $testResults['config']['debug']['enabled'] ? 'success' : 'warning'; ?>"></i>
                <strong>Debug:</strong> <?php echo $testResults['config']['debug']['enabled'] ? 'Activé' : 'Désactivé'; ?>
                <div class="small">
                    Fichier: <?php echo $testResults['config']['debug']['log_file']; ?><br>
                    Écriture: <?php echo $testResults['config']['debug']['writable'] ? '✅' : '❌'; ?>
                </div>
            </div>

            <?php foreach ($testResults['config']['paths'] as $type => $info): ?>
                <div class="test-item <?php echo ($info['exists'] && $info['readable']) ? 'test-success' : 'test-error'; ?>">
                    <i class="bi bi-journal-text status-icon <?php echo ($info['exists'] && $info['readable']) ? 'success' : 'error'; ?>"></i>
                    <strong>Logs <?php echo ucfirst($type); ?>:</strong> <?php echo $info['path'] ?: 'Non configuré'; ?>
                    <?php if ($info['path']): ?>
                        <div class="small">
                            Existe: <?php echo $info['exists'] ? '✅' : '❌'; ?> |
                            Lecture: <?php echo $info['readable'] ? '✅' : '❌'; ?>
                        </div>
                    <?php endif; ?>
                </div>
            <?php endforeach; ?>
        </div>

        <!-- Patterns -->
        <div class="test-card">
            <h2>🔍 Patterns</h2>
            <?php foreach ($testResults['patterns'] as $type => $info): ?>
                <div class="test-item <?php echo $info['success'] ? 'test-success' : 'test-error'; ?>">
                    <i class="bi bi-regex status-icon <?php echo $info['success'] ? 'success' : 'error'; ?>"></i>
                    <strong><?php echo ucfirst(str_replace('_', ' ', $type)); ?>:</strong>
                    <?php if ($info['error']): ?>
                        <div class="text-danger"><?php echo $info['error']; ?></div>
                    <?php endif; ?>
                    <pre class="mb-0"><?php echo htmlspecialchars($info['pattern']); ?></pre>
                </div>
            <?php endforeach; ?>
        </div>

        <!-- Bouton de retour -->
        <div class="text-center mt-4">
            <a href="index.php" class="btn btn-primary">
                <i class="bi bi-arrow-left"></i> Retour à l'administration
            </a>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html> 