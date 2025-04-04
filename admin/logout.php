<?php
session_start();

// Détruire la session
session_destroy();

// Rediriger vers la page principale
header('Location: ../index.php');
exit; 