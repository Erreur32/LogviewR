<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Test de configuration LogviewR</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <style>
        :root {
            --primary-color: #3498db;
            --success-color: #2ecc71;
            --error-color: #e74c3c;
            --warning-color: #f39c12;
            --dark-bg: #2c3e50;
            --light-bg: #ecf0f1;
            --text-color: #333;
            --border-radius: 5px;
            --box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            background-color: var(--light-bg);
            color: var(--text-color);
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }

        .admin-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding: 20px;
            background-color: var(--dark-bg);
            border-radius: var(--border-radius);
            color: white;
        }

        .admin-nav a {
            color: white;
            text-decoration: none;
            padding: 8px 15px;
            border-radius: var(--border-radius);
            margin-left: 10px;
            background-color: rgba(255, 255, 255, 0.1);
        }

        .admin-nav a:hover {
            background-color: rgba(255, 255, 255, 0.2);
        }

        .admin-nav a.active {
            background-color: var(--primary-color);
        }

        .summary {
            background-color: var(--dark-bg);
            color: white;
            padding: 20px;
            border-radius: var(--border-radius);
            margin-bottom: 30px;
        }

        .summary-stats {
            display: flex;
            justify-content: space-around;
            flex-wrap: wrap;
            gap: 20px;
        }

        .summary-stat {
            text-align: center;
            padding: 15px;
            background-color: rgba(255, 255, 255, 0.1);
            border-radius: var(--border-radius);
            min-width: 150px;
        }

        .summary-value {
            font-size: 2em;
            font-weight: bold;
            margin-bottom: 5px;
        }

        .test-section {
            background-color: white;
            padding: 20px;
            border-radius: var(--border-radius);
            margin-bottom: 20px;
            box-shadow: var(--box-shadow);
        }

        .test-section h2 {
            color: var(--dark-bg);
            border-bottom: 2px solid var(--primary-color);
            padding-bottom: 10px;
            margin-top: 0;
        }

        .result {
            margin: 10px 0;
            padding: 15px;
            border-radius: var(--border-radius);
            background-color: rgba(0, 0, 0, 0.05);
        }

        .result.success {
            border-left: 4px solid var(--success-color);
        }

        .result.error {
            border-left: 4px solid var(--error-color);
        }

        .details {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: var(--border-radius);
            margin-top: 10px;
            display: none;
            overflow-x: auto;
        }

        .toggle-details {
            background-color: var(--primary-color);
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: var(--border-radius);
            cursor: pointer;
            margin-top: 5px;
        }

        .toggle-details:hover {
            background-color: #2980b9;
        }

        @media (max-width: 768px) {
            .summary-stats {
                flex-direction: column;
            }

            .summary-stat {
                width: 100%;
            }

            .admin-header {
                flex-direction: column;
                text-align: center;
            }

            .admin-nav {
                margin-top: 15px;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="admin-header">
            <h1>Test de configuration LogviewR</h1>
            <div class="admin-nav">
                <a href="index.php">Tableau de bord</a>
                <a href="test.php" class="active">Tests</a>
                <a href="logout.php">Déconnexion</a>
            </div>
        </div>

        <div class="summary">
            <h2>Résumé des tests</h2>
            <div class="summary-stats">
                <div class="summary-stat">
                    <div class="summary-value"><?php echo $allParsersLoaded ? '✅' : '❌'; ?></div>
                    <div class="summary-label">Parsers</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-value"><?php echo $allRegexValid ? '✅' : '❌'; ?></div>
                    <div class="summary-label">Expressions régulières</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-value"><?php echo $allPathsAccessible ? '✅' : '❌'; ?></div>
                    <div class="summary-label">Dossiers</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-value"><?php echo $allExtensionsLoaded ? '✅' : '❌'; ?></div>
                    <div class="summary-label">Extensions PHP</div>
                </div>
            </div>
        </div>

        <div class="test-section">
            <h2>Test des parsers</h2>
            <?php if (isset($parser) && $parser !== null): ?>
                <?php foreach ($testCases as $type => $test): ?>
                    <?php
                    $result = testParsing($parser, $test['line'], $test['type']);
                    $success = $result['success'];
                    ?>
                    <div class="result <?php echo $success ? 'success' : 'error'; ?>">
                        <h3><?php echo htmlspecialchars($test['description']); ?></h3>
                        <p><?php echo $success ? '✅ Test réussi' : '❌ Test échoué'; ?></p>
                        <button class="toggle-details" data-target="details-<?php echo $type; ?>">
                            Voir les détails
                        </button>
                        <div id="details-<?php echo $type; ?>" class="details">
                            <h4>Exemple de log :</h4>
                            <pre><?php echo htmlspecialchars($test['line']); ?></pre>
                            <h4>Résultat :</h4>
                            <pre><?php echo htmlspecialchars(print_r($result, true)); ?></pre>
                        </div>
                    </div>
                <?php endforeach; ?>
            <?php else: ?>
                <div class="result error">
                    <p>❌ Erreur : Impossible d'initialiser le parser</p>
                </div>
            <?php endif; ?>
        </div>

        <div class="test-section">
            <h2>Test des expressions régulières</h2>
            <?php if (isset($regexResults)): ?>
                <?php foreach ($regexResults as $type => $result): ?>
                    <div class="result <?php echo $result['success'] ? 'success' : 'error'; ?>">
                        <h3>Pattern pour <?php echo htmlspecialchars($type); ?></h3>
                        <p><?php echo $result['success'] ? '✅ Pattern valide' : '❌ Pattern invalide'; ?></p>
                        <button class="toggle-details" data-target="regex-<?php echo $type; ?>">
                            Voir le pattern
                        </button>
                        <div id="regex-<?php echo $type; ?>" class="details">
                            <pre><?php echo htmlspecialchars($result['pattern']); ?></pre>
                            <?php if (isset($result['error'])): ?>
                                <p class="error">Erreur : <?php echo htmlspecialchars($result['error']); ?></p>
                            <?php endif; ?>
                        </div>
                    </div>
                <?php endforeach; ?>
            <?php else: ?>
                <div class="result error">
                    <p>❌ Erreur : Aucun pattern trouvé</p>
                </div>
            <?php endif; ?>
        </div>

        <div class="test-section">
            <h2>Test des permissions</h2>
            <?php if (isset($permissionResults)): ?>
                <?php foreach ($permissionResults as $path => $result): ?>
                    <div class="result <?php echo ($result['exists'] && $result['readable']) ? 'success' : 'error'; ?>">
                        <h3><?php echo htmlspecialchars($path); ?></h3>
                        <p>
                            <?php if ($result['exists'] && $result['readable']): ?>
                                ✅ Dossier accessible
                            <?php else: ?>
                                ❌ <?php echo htmlspecialchars($result['error']); ?>
                            <?php endif; ?>
                        </p>
                        <button class="toggle-details" data-target="path-<?php echo md5($path); ?>">
                            Voir les détails
                        </button>
                        <div id="path-<?php echo md5($path); ?>" class="details">
                            <pre><?php echo htmlspecialchars(print_r($result, true)); ?></pre>
                        </div>
                    </div>
                <?php endforeach; ?>
            <?php else: ?>
                <div class="result error">
                    <p>❌ Erreur : Aucun dossier à tester</p>
                </div>
            <?php endif; ?>
        </div>
    </div>

    <script>
        document.addEventListener('click', function(e) {
            if (e.target.classList.contains('toggle-details')) {
                const targetId = e.target.getAttribute('data-target');
                const details = document.getElementById(targetId);
                
                if (details.style.display === 'none' || !details.style.display) {
                    details.style.display = 'block';
                    e.target.textContent = 'Masquer les détails';
                } else {
                    details.style.display = 'none';
                    e.target.textContent = 'Voir les détails';
                }
            }
        });
    </script>
</body>
</html> 