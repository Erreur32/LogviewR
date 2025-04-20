<?php
/**
 * Authentication management for LogviewR
 * This file handles user authentication and session management
 */

// Check if user is logged in
if (!isset($_SESSION['admin_logged_in']) || $_SESSION['admin_logged_in'] !== true) {
    header('Location: login.php');
    exit;
}

// Load admin configuration
$admin_config = require_once __DIR__ . '/../config/admin.php';
$session_timeout = $admin_config['admin']['session_timeout'] ?? 3600;

// Check session timeout
if (isset($_SESSION['admin_login_time']) && (time() - $_SESSION['admin_login_time'] > $session_timeout)) {
    session_destroy();
    header('Location: login.php?timeout=1');
    exit;
}

// Update login time
$_SESSION['admin_login_time'] = time(); 