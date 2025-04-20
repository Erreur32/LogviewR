<?php
// Vérifier que ce fichier n'est pas appelé directement
if (!defined('LOGVIEWR_ROOT')) {
    define('LOGVIEWR_ROOT', dirname(__DIR__));
}

// Vérifier que les variables nécessaires sont définies
if (!isset($allParsersLoaded) || !isset($allRegexValid) || !isset($allPathsAccessible) || !isset($allExtensionsLoaded)) {
    die("❌ Erreur : Variables de test non définies");
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
            --primary-color: #2563eb;
            --success-color: #16a34a;
            --error-color: #dc2626;
            --warning-color: #ca8a04;
            --background-color: #f8fafc;
            --card-background: #ffffff;
            --text-color: #1e293b;
            --border-radius: 0.75rem;
            --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
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

        h1 {
            color: var(--primary-color);
            font-weight: 700;
            margin-bottom: 2rem;
            font-size: 2.25rem;
        }

        h2 {
            color: var(--text-color);
            font-weight: 600;
            font-size: 1.5rem;
            margin-bottom: 1.5rem;
        }

        .test-section {
            background-color: var(--card-background);
            border-radius: var(--border-radius);
            box-shadow: var(--shadow);
            padding: 1.5rem;
            margin-bottom: 2rem;
            transition: var(--transition);
        }

        .test-section:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
        }

        .test-result {
            background-color: var(--background-color);
            border-radius: calc(var(--border-radius) * 0.75);
            padding: 1rem;
            margin-bottom: 1rem;
            transition: var(--transition);
        }

        .test-success {
            background-color: #f0fdf4;
            border-left: 4px solid var(--success-color);
        }

        .test-error {
            background-color: #fef2f2;
            border-left: 4px solid var(--error-color);
        }

        .test-warning {
            background-color: #fefce8;
            border-left: 4px solid var(--warning-color);
        }

        pre {
            background-color: #f1f5f9;
            border-radius: calc(var(--border-radius) * 0.5);
            padding: 1rem;
            margin: 0.5rem 0;
            font-size: 0.875rem;
            overflow-x: auto;
        }

        .bi {
            margin-right: 0.5rem;
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
            background-color: #1d4ed8;
            transform: translateY(-1px);
        }

        .status-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
            margin-bottom: 1rem;
        }

        .status-item {
            background-color: var(--background-color);
            border-radius: calc(var(--border-radius) * 0.75);
            padding: 1rem;
            display: flex;
            align-items: center;
            transition: var(--transition);
        }

        .status-item i {
            font-size: 1.25rem;
            margin-right: 0.75rem;
        }

        .status-item.success i {
            color: var(--success-color);
        }

        .status-item.error i {
            color: var(--error-color);
        }

        @media (max-width: 768px) {
            .container {
                padding: 1rem;
            }

            h1 {
                font-size: 1.75rem;
            }

            .test-section {
                padding: 1rem;
            }
        }
    </style>
</head>
<body>
    <div class="container mt-4">
        <h1 class="mb-4">🔍 Test de Configuration - LogviewR</h1>
        
        <!-- Section État Général -->
        <div class="test-section">
            <h2>📊 État Général</h2>
            <div class="row">
                <div class="col-md-6">
                    <div class="test-result <?php echo $allParsersLoaded ? 'test-success' : 'test-error'; ?>">
                        <i class="bi <?php echo $allParsersLoaded ? 'bi-check-circle' : 'bi-x-circle'; ?>"></i>
                        Parsers chargés
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="test-result <?php echo $allRegexValid ? 'test-success' : 'test-error'; ?>">
                        <i class="bi <?php echo $allRegexValid ? 'bi-check-circle' : 'bi-x-circle'; ?>"></i>
                        Expressions régulières valides
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="test-result <?php echo $allPathsAccessible ? 'test-success' : 'test-error'; ?>">
                        <i class="bi <?php echo $allPathsAccessible ? 'bi-check-circle' : 'bi-x-circle'; ?>"></i>
                        Permissions des dossiers
                    </div>
                </div>
                <div class="col-md-6">
                    <div class="test-result <?php echo $allExtensionsLoaded ? 'test-success' : 'test-error'; ?>">
                        <i class="bi <?php echo $allExtensionsLoaded ? 'bi-check-circle' : 'bi-x-circle'; ?>"></i>
                        Extensions PHP requises
                    </div>
                </div>
            </div>
        </div>

        <!-- Section Test des Parsers -->
        <div class="test-section">
            <h2>🔧 Test des Parsers</h2>
            <?php if ($allParsersLoaded): ?>
                <?php foreach ($testCases as $case): ?>
                    <div class="test-result">
                        <h5><?php echo htmlspecialchars($case['description']); ?></h5>
                        <pre><?php echo htmlspecialchars($case['line']); ?></pre>
                        <?php
                        $result = testParsing($parser, $case['line'], $case['type']);
                        if ($result['success']):
                        ?>
                            <div class="test-success">
                                <i class="bi bi-check-circle"></i> Parsing réussi
                                <pre><?php echo json_encode($result['result'], JSON_PRETTY_PRINT); ?></pre>
                            </div>
                        <?php else: ?>
                            <div class="test-error">
                                <i class="bi bi-x-circle"></i> Erreur de parsing: <?php echo htmlspecialchars($result['error']); ?>
                            </div>
                        <?php endif; ?>
                    </div>
                <?php endforeach; ?>
            <?php else: ?>
                <div class="test-error">
                    <i class="bi bi-x-circle"></i> Impossible de charger les parsers
                </div>
            <?php endif; ?>
        </div>

        <!-- Section Test des Expressions Régulières -->
        <div class="test-section">
            <h2>🔍 Test des Expressions Régulières</h2>
            <?php foreach ($regexResults as $type => $result): ?>
                <div class="test-result <?php echo $result['success'] ? 'test-success' : 'test-error'; ?>">
                    <h5><?php echo htmlspecialchars($type); ?></h5>
                    <pre><?php echo htmlspecialchars($result['pattern']); ?></pre>
                    <?php if (!$result['success']): ?>
                        <div class="test-error">
                            <i class="bi bi-x-circle"></i> Erreur: <?php echo htmlspecialchars($result['error']); ?>
                        </div>
                    <?php endif; ?>
                </div>
            <?php endforeach; ?>
        </div>

        <!-- Section Test des Permissions -->
        <div class="test-section">
            <h2>📂 Test des Permissions</h2>
            <?php foreach ($permissionResults as $path => $result): ?>
                <div class="test-result <?php echo $result['readable'] ? 'test-success' : 'test-error'; ?>">
                    <h5><?php echo htmlspecialchars($path); ?></h5>
                    <?php if ($result['exists']): ?>
                        <div>
                            <i class="bi bi-check-circle"></i> Dossier existe
                        </div>
                        <?php if ($result['readable']): ?>
                            <div>
                                <i class="bi bi-check-circle"></i> Dossier lisible
                            </div>
                        <?php else: ?>
                            <div class="test-error">
                                <i class="bi bi-x-circle"></i> <?php echo htmlspecialchars($result['error']); ?>
                            </div>
                        <?php endif; ?>
                    <?php else: ?>
                        <div class="test-error">
                            <i class="bi bi-x-circle"></i> <?php echo htmlspecialchars($result['error']); ?>
                        </div>
                    <?php endif; ?>
                </div>
            <?php endforeach; ?>
        </div>

        <!-- Section Comparaison des Configurations -->
        <div class="test-section">
            <h2>⚙️ Comparaison des Configurations</h2>
            
            <!-- Configuration -->
            <h3>Configuration (config.php)</h3>
            <?php if (empty($configDifferences)): ?>
                <div class="test-success">
                    <i class="bi bi-check-circle"></i> La configuration est identique à la configuration par défaut
                </div>
            <?php else: ?>
                <div class="test-warning">
                    <i class="bi bi-exclamation-triangle"></i> Différences détectées
                    <pre><?php echo json_encode($configDifferences, JSON_PRETTY_PRINT); ?></pre>
                </div>
            <?php endif; ?>

            <!-- Patterns -->
            <h3>Patterns (log_patterns.php)</h3>
            <?php if (empty($patternDifferences)): ?>
                <div class="test-success">
                    <i class="bi bi-check-circle"></i> Les patterns sont identiques aux patterns par défaut
                </div>
            <?php else: ?>
                <div class="test-warning">
                    <i class="bi bi-exclamation-triangle"></i> Différences détectées
                    <pre><?php echo json_encode($patternDifferences, JSON_PRETTY_PRINT); ?></pre>
                </div>
            <?php endif; ?>
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