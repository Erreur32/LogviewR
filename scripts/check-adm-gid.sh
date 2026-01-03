#!/bin/bash
# Script pour vérifier et configurer le GID du groupe adm
# Usage: ./scripts/check-adm-gid.sh

echo "=========================================="
echo "Vérification du GID du groupe adm"
echo "=========================================="
echo ""

# Vérifier si le groupe adm existe
if getent group adm > /dev/null 2>&1; then
    ADM_GID=$(getent group adm | cut -d: -f3)
    echo "✅ Groupe adm trouvé avec GID: $ADM_GID"
    echo ""
    echo "Pour utiliser ce GID dans Docker, ajoutez dans votre fichier .env :"
    echo "  ADM_GID=$ADM_GID"
    echo ""
    
    # Vérifier si .env existe et contient déjà ADM_GID
    if [ -f .env ]; then
        if grep -q "^ADM_GID=" .env; then
            CURRENT_GID=$(grep "^ADM_GID=" .env | cut -d'=' -f2)
            if [ "$CURRENT_GID" = "$ADM_GID" ]; then
                echo "✅ ADM_GID est déjà configuré correctement dans .env"
            else
                echo "⚠️  ADM_GID dans .env ($CURRENT_GID) ne correspond pas au GID réel ($ADM_GID)"
                echo "   Mettez à jour .env avec: ADM_GID=$ADM_GID"
            fi
        else
            echo "⚠️  ADM_GID n'est pas défini dans .env"
            echo "   Ajoutez: ADM_GID=$ADM_GID"
        fi
    else
        echo "⚠️  Fichier .env n'existe pas"
        echo "   Créez-le avec: echo 'ADM_GID=$ADM_GID' >> .env"
    fi
else
    echo "❌ Groupe adm introuvable sur ce système"
    echo "   Le GID par défaut (4) sera utilisé"
fi

echo ""
echo "=========================================="
echo "Test des permissions sur les fichiers de logs"
echo "=========================================="
echo ""

# Tester l'accès à quelques fichiers de logs courants
for log_file in /var/log/auth.log /var/log/cron.log /var/log/daemon.log /var/log/syslog; do
    if [ -f "$log_file" ]; then
        perms=$(stat -c "%a %U:%G" "$log_file" 2>/dev/null || stat -f "%OLp %Su:%Sg" "$log_file" 2>/dev/null)
        readable=$(test -r "$log_file" && echo "✅" || echo "❌")
        echo "$readable $log_file ($perms)"
    fi
done

echo ""
echo "Pour que Docker puisse lire ces fichiers, le conteneur doit avoir le même GID pour le groupe adm."
