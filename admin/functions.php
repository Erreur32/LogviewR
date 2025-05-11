<?php
/**
 * Sauvegarde la configuration dans le fichier config.user.php
 * @param array $config La configuration à sauvegarder
 * @return bool True si la sauvegarde a réussi, False sinon
 */
function saveConfig($config) {
    $config_file = __DIR__ . '/../config/config.user.php';
    $default_config_file = __DIR__ . '/../config/config.php';
    $default_config = file_exists($default_config_file) ? require $default_config_file : [];
    $user_config = file_exists($config_file) ? require $config_file : [];

    // Fusionner : d'abord défaut, puis user existant, puis nouveaux champs modifiés
    $final_config = array_replace_recursive($default_config, $user_config, $config);

    // Vérifier que la configuration finale est valide
    if (!is_array($final_config)) {
        error_log("[LogviewR Admin] Configuration finale invalide: pas un tableau");
        return false;
    }

    // Toujours écrire la config complète dans .user.php
    $content = "<?php\nreturn " . var_export($final_config, true) . ";\n";
    if (file_put_contents($config_file, $content) === false) {
        error_log("[LogviewR Admin] Erreur lors de l'écriture de config.user.php");
        return false;
    }
    return true;
}