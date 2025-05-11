<?php
// Récupération des variables passées par JavaScript
$logFile = $_POST['logFile'] ?? '';
$response = json_decode($_POST['response'], true) ?? [];
$headers = $_POST['headers'] ?? '';

// Fonction pour sécuriser l'affichage des données
function h($str) {
    return htmlspecialchars($str, ENT_QUOTES, 'UTF-8');
}

// Fonction pour formater les nombres
function formatNumber($number) {
    return number_format($number, 0, ',', ' ');
}

// Fonction pour formater la date avec un badge coloré
function formatDateWithBadge($dateStr) {
    try {
        $date = new DateTime($dateStr);
        $hour = $date->format('H');
        $formattedDate = $date->format('d/m/Y H:i:s');
        return sprintf('<span class="date-badge" data-hour="%s">%s</span>', 
            h($hour), 
            h($formattedDate)
        );
    } catch (Exception $e) {
        return h($dateStr);
    }
}

// Génération du HTML des statistiques
$statsHtml = '
<div class="stats-container">
    <div class="stats-badge filepath" title="Chemin complet du fichier de logs
Taille: ' . h($response['file_info']['size']['value'] ?? '0') . ' ' . h($response['file_info']['size']['unit'] ?? 'B') . '" style="margin-right: 20px;">
        <span class="path">' . h(dirname($logFile)) . '/</span>
        <span class="filename">' . h(basename($logFile)) . '</span>
    </div>
    <div class="stats-badge total" title="Nombre total de lignes dans le fichier
Inclut toutes les lignes, même celles qui sont filtrées ou ignorées
Statistiques détaillées:
- Lignes valides: ' . formatNumber($response['stats']['valid_lines'] ?? 0) . '
- Lignes filtrées: ' . formatNumber($response['stats']['filtered_lines'] ?? 0) . '
- Lignes ignorées par les filtres: ' . formatNumber($response['stats']['unreadable_lines'] ?? 0) . '">
        <span class="number">' . formatNumber($response['stats']['total_lines'] ?? 0) . '</span>
        <span class="label">lignes totales</span>
    </div>
    <div class="stats-badge valid" title="Nombre de lignes valides et correctement formatées
Ces lignes ont été parsées avec succès et sont affichées dans le tableau
Format: ' . h($response['type'] ?? 'raw') . '">
        <span class="number">' . formatNumber($response['stats']['valid_lines'] ?? 0) . '</span>
        <span class="label">lignes valides</span>
    </div>
    <div class="stats-badge filtered" title="Lignes filtrées automatiquement

🔍 Résumé des filtres:
' . (isset($response['stats']['reasons']) ? (function($reasons) {
        // Grouper les raisons par type de filtre
        $groups = [
            'ip' => ['emoji' => '🌐', 'name' => 'Filtres IP', 'items' => []],
            'user-agent' => ['emoji' => '🌍', 'name' => 'Filtres User-Agent', 'items' => []],
            'utilisateur' => ['emoji' => '👤', 'name' => 'Filtres Utilisateur', 'items' => []],
            'requête' => ['emoji' => '🔗', 'name' => 'Filtres Requête', 'items' => []],
            'autre' => ['emoji' => '⚡', 'name' => 'Autres Filtres', 'items' => []]
        ];
        
        $totalsByType = [
            'ip' => 0,
            'user-agent' => 0,
            'utilisateur' => 0,
            'requête' => 0,
            'autre' => 0
        ];

        // Trier les raisons dans les groupes
        foreach ($reasons as $reason => $count) {
            $type = match(true) {
                str_contains(strtolower($reason), 'ip') => 'ip',
                str_contains(strtolower($reason), 'user-agent') => 'user-agent',
                str_contains(strtolower($reason), 'utilisateur') => 'utilisateur',
                str_contains(strtolower($reason), 'requête') => 'requête',
                default => 'autre'
            };
            
            // Ajouter au total du type
            $totalsByType[$type] += $count;
            
            // Tronquer la raison si elle est trop longue
            $maxLength = 50;
            $truncatedReason = strlen($reason) > $maxLength 
                ? substr($reason, 0, $maxLength) . '...' 
                : $reason;
            
            $groups[$type]['items'][] = formatNumber($count) . " lignes • " . $truncatedReason;
        }

        // Construire le résumé
        $summary = [];
        foreach ($groups as $type => $group) {
            if (!empty($group['items'])) {
                $summary[] = $group['emoji'] . " " . $group['name'] . " (" . formatNumber($totalsByType[$type]) . " total):\n" . 
                            implode("\n", $group['items']);
            }
        }

        return implode("\n\n", $summary);
    })($response['stats']['reasons']) : "❌ Aucun filtre actif") . '

📊 Total global: ' . formatNumber($response['stats']['filtered_lines'] ?? 0) . ' lignes filtrées">
        <span class="number">' . formatNumber($response['stats']['filtered_lines'] ?? 0) . '</span>
        <span class="label">lignes filtrées</span>
    </div>
  <!--  <div class="stats-badge skipped" title="Lignes ignorées
Ces lignes ont été ignorées car elles sont vides ou ne correspondent pas au format attendu">
        <span class="number">' . formatNumber($response['stats']['skipped_lines'] ?? 0) . '</span>
        <span class="label">lignes ignorées</span>
    </div>-->
    <div class="stats-badge unreadable" title="Lignes ignorées format incorrect ou invalide">
        <span class="number">' . formatNumber($response['stats']['unreadable_lines'] ?? 0) . '</span>
        <span class="label">lignes  illisibles</span>
    </div>
    <div class="stats-badge filesize" title="Taille du fichier sur le disque
Format: ' . h($response['file_info']['size']['value'] ?? '0') . ' ' . h($response['file_info']['size']['unit'] ?? 'B') . '">
        <span class="number">' . h($response['file_info']['size']['value'] ?? '0') . '</span>
        <span class="unit">' . h($response['file_info']['size']['unit'] ?? 'B') . '</span>
    </div>
    <div class="stats-badge mtime" title="Date et heure de dernière modification du fichier
Dernière modification: ' . h($response['file_info']['mtime']['formatted'] ?? '') . '
Format: ' . h($response['file_info']['mtime']['formatted'] ?? '') . '
Timestamp: ' . h($response['file_info']['mtime']['timestamp'] ?? '') . '">
        <span class="date">' . h(explode(' ', $response['file_info']['mtime']['formatted'] ?? '')[0] ?? '') . '</span>
        <span class="time">' . h(explode(' ', $response['file_info']['mtime']['formatted'] ?? '')[1] ?? '') . '</span>
    </div>
    <div class="stats-badge execution-time" title="Temps de traitement et d\'analyse du fichier
Inclut:
- Lecture du fichier
- Parsing des lignes
- Application des filtres
- Génération du tableau">
        <span class="number">' . formatNumber($response['execution_time'] ?? 0) . '</span>
        <span class="unit">ms</span>
    </div>
</div>';

// Génération du HTML du tableau
$tableHtml = '
<div class="table-container">
    <table id="logTable" class="logviewer-table display responsive nowrap" style="width:100%">
        <thead>
            <tr>' . $headers . '</tr>
        </thead>
        <tbody></tbody>
    </table>
</div>';

// Retourner le HTML complet
echo $statsHtml . $tableHtml; 