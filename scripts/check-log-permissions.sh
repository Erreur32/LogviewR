#!/bin/bash
# Script pour vérifier les permissions des fichiers de logs problématiques
# Usage: ./scripts/check-log-permissions.sh

echo "=========================================="
echo "Vérification des permissions des fichiers de logs"
echo "=========================================="
echo ""

# Fichiers problématiques signalés
PROBLEM_FILES=(
    "/var/log/php8.0-fpm.log"
    "/var/log/php8.0-fpm.log.1"
    "/var/log/rkhunter.log.1"
)

echo "Fichiers problématiques :"
echo ""

for file in "${PROBLEM_FILES[@]}"; do
    if [ -f "$file" ]; then
        perms=$(stat -c "%a %U:%G" "$file" 2>/dev/null || stat -f "%OLp %Su:%Sg" "$file" 2>/dev/null)
        readable=$(test -r "$file" && echo "✅ Lisible" || echo "❌ Non lisible")
        echo "  $file"
        echo "    Permissions: $perms"
        echo "    Statut: $readable"
        echo ""
    else
        echo "  $file: ❌ Fichier introuvable"
        echo ""
    fi
done

echo "=========================================="
echo "Solution recommandée"
echo "=========================================="
echo ""
echo "Si les fichiers appartiennent à root:root au lieu de root:adm,"
echo "vous pouvez soit :"
echo ""
echo "1. Modifier les permissions sur l'hôte (si acceptable) :"
echo "   sudo chgrp adm /var/log/php8.0-fpm.log* /var/log/rkhunter.log*"
echo "   sudo chmod g+r /var/log/php8.0-fpm.log* /var/log/rkhunter.log*"
echo ""
echo "2. Ou ignorer ces fichiers dans la configuration du plugin"
echo "   (ils ne sont pas critiques pour la plupart des cas d'usage)"
echo ""
