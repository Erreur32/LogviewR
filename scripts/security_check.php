<?php
// Vérification de la session
session_start();
if (!isset($_SESSION['authenticated']) || $_SESSION['authenticated'] !== true) {
    header('HTTP/1.1 403 Forbidden');
    die('Accès non autorisé');
}

// Vérification de l'origine de la requête
if (!isset($_SERVER['HTTP_REFERER']) || !preg_match('#^https?://' . $_SERVER['HTTP_HOST'] . '#', $_SERVER['HTTP_REFERER'])) {
    header('HTTP/1.1 403 Forbidden');
    die('Origine non autorisée');
}

// Vérification de la méthode HTTP
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('HTTP/1.1 405 Method Not Allowed');
    die('Méthode non autorisée');
}

// Vérification du token CSRF
if (!isset($_POST['csrf_token']) || $_POST['csrf_token'] !== $_SESSION['csrf_token']) {
    header('HTTP/1.1 403 Forbidden');
    die('Token CSRF invalide');
}

// Vérification des paramètres
if (!isset($_POST['logfile']) || empty($_POST['logfile'])) {
    header('HTTP/1.1 400 Bad Request');
    die('Paramètre logfile manquant');
}

// Nettoyage et validation du chemin
$logfile = realpath($_POST['logfile']);
$allowed_paths = [
    '/var/log/apache2/access.log',
    '/var/log/apache2/error.log',
    '/var/log/nginx/access.log',
    '/var/log/nginx/error.log',
    '/var/log/syslog'
];

if (!in_array($logfile, $allowed_paths)) {
    header('HTTP/1.1 403 Forbidden');
    die('Chemin non autorisé');
}

// Vérification des permissions
if (!is_file($logfile) || !is_readable($logfile)) {
    header('HTTP/1.1 403 Forbidden');
    die('Fichier non accessible');
}

// Vérification de la taille du fichier
if (filesize($logfile) > 10485760) { // 10MB max
    header('HTTP/1.1 413 Request Entity Too Large');
    die('Fichier trop volumineux');
}

// Vérification du type de fichier
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime_type = finfo_file($finfo, $logfile);
finfo_close($finfo);

if (!in_array($mime_type, ['text/plain', 'application/x-log'])) {
    header('HTTP/1.1 415 Unsupported Media Type');
    die('Type de fichier non autorisé');
}

// Vérification du nombre de lignes demandées
$max_lines = isset($_POST['max_lines']) ? (int)$_POST['max_lines'] : 100;
if ($max_lines < 1 || $max_lines > 50000) { // Augmenté à 50000 lignes
    header('HTTP/1.1 400 Bad Request');
    die('Nombre de lignes invalide');
}

// Vérification de la fréquence d'utilisation
$last_access = isset($_SESSION['last_script_access']) ? $_SESSION['last_script_access'] : 0;
if (time() - $last_access < 1) { // 1 seconde minimum entre les appels
    header('HTTP/1.1 429 Too Many Requests');
    die('Trop de requêtes');
}
$_SESSION['last_script_access'] = time();

// Vérification de l'IP
$ip = $_SERVER['REMOTE_ADDR'];
$allowed_ips = ['127.0.0.1', '::1']; // Ajoutez les IPs autorisées ici
if (!in_array($ip, $allowed_ips)) {
    header('HTTP/1.1 403 Forbidden');
    die('IP non autorisée');
}

// Vérification du User-Agent
$user_agent = $_SERVER['HTTP_USER_AGENT'];
$blocked_agents = ['curl', 'wget', 'python', 'perl', 'ruby', 'php', 'nikto', 'sqlmap', 'nmap'];
foreach ($blocked_agents as $agent) {
    if (stripos($user_agent, $agent) !== false) {
        header('HTTP/1.1 403 Forbidden');
        die('User-Agent non autorisé');
    }
}

// Si toutes les vérifications sont passées, on continue l'exécution
return true; 