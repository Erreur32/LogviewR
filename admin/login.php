<?php
session_start();

// Initialiser les variables de session si elles n'existent pas
if (!isset($_SESSION['login_attempts'])) {
    $_SESSION['login_attempts'] = 0;
}

if (!isset($_SESSION['last_attempt'])) {
    $_SESSION['last_attempt'] = 0;
}

// Vérifier que les fichiers de configuration existent
$config_file = __DIR__ . '/../config/config.php';
$admin_config_file = __DIR__ . '/../config/admin.php';

if (!file_exists($config_file) || !file_exists($admin_config_file)) {
    die('Fichiers de configuration manquants');
}

// Charger les configurations
$config = require_once $config_file;
$admin_config = require_once $admin_config_file;

// Initialiser les variables
$error = '';
$success = '';

// Vérifier si l'utilisateur est déjà connecté
if (isset($_SESSION['admin_logged_in']) && $_SESSION['admin_logged_in'] === true) {
    header('Location: index.php');
    exit;
}

// Traitement du formulaire de connexion
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $username = $_POST['username'] ?? '';
    $password = $_POST['password'] ?? '';
    
    // Vérifier les tentatives de connexion
    if ($_SESSION['login_attempts'] >= ($admin_config['security']['max_login_attempts'] ?? 5)) {
        $lockout_time = $admin_config['security']['lockout_time'] ?? 1800; // 30 minutes par défaut
        if (time() - $_SESSION['last_attempt'] < $lockout_time) {
            $error = 'Trop de tentatives de connexion. Veuillez réessayer dans ' . 
                    ceil(($lockout_time - (time() - $_SESSION['last_attempt'])) / 60) . ' minutes.';
        } else {
            // Réinitialiser les tentatives après le temps de verrouillage
            $_SESSION['login_attempts'] = 0;
        }
    }
    
    if (empty($error)) {
        if ($username === ($admin_config['admin']['username'] ?? 'admin') && 
            password_verify($password, $admin_config['admin']['password'] ?? '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi')) {
            $_SESSION['admin_logged_in'] = true;
            $_SESSION['admin_login_time'] = time();
            $_SESSION['login_attempts'] = 0;
            header('Location: index.php');
            exit;
        } else {
            $_SESSION['login_attempts']++;
            $_SESSION['last_attempt'] = time();
            $error = 'Identifiants incorrects';
        }
    }
}

// Vérifier si on vient d'être déconnecté pour timeout
if (isset($_GET['timeout']) && $_GET['timeout'] == 1) {
    $error = 'Votre session a expiré. Veuillez vous reconnecter.';
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Connexion - LogviewR</title>
    <link rel="stylesheet" href="assets/css/admin.css">
    <link rel="stylesheet" href="assets/css/login.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
</head>
<body>
    <div class="login-container">
        <div class="login-header">
            <h1><i class="fas fa-cog"></i> LogviewR - Administration</h1>
        </div>

        <?php if (isset($_GET['timeout'])): ?>
            <div class="login-timeout">
                <i class="fas fa-clock"></i> Votre session a expiré. Veuillez vous reconnecter.
            </div>
        <?php endif; ?>

        <?php if (!empty($error)): ?>
            <div class="login-error">
                <i class="fas fa-exclamation-circle"></i> <?php echo htmlspecialchars($error); ?>
            </div>
        <?php endif; ?>

        <form method="POST" action="" class="login-form">
            <div class="form-group">
                <label for="username">Nom d'utilisateur</label>
                <input type="text" id="username" name="username" required>
                <i class="fas fa-user"></i>
            </div>

            <div class="form-group">
                <label for="password">Mot de passe</label>
                <input type="password" id="password" name="password" required>
                <i class="fas fa-lock"></i>
            </div>

            <button type="submit" class="btn">
                <i class="fas fa-sign-in-alt"></i> Se connecter
            </button>
        </form>
    </div>
</body>
</html> 