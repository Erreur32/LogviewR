#!/bin/bash

# Configuration de sécurité
set -euo pipefail
IFS=$'\n\t'

# Fonction de nettoyage
cleanup() {
    # Supprimer les fichiers temporaires
    rm -f "${TEMP_FILE:-}"
    # Réinitialiser les variables d'environnement
    unset LOGFILE
    unset TEMP_FILE
    unset MAX_LINES
    unset ALLOWED_PATHS
}

# Configuration des variables
MAX_LINES=100
TEMP_FILE=$(mktemp)
ALLOWED_PATHS=(
    "/var/log/apache2/access.log"
    "/var/log/apache2/error.log"
    "/var/log/nginx/access.log"
    "/var/log/nginx/error.log"
    "/var/log/syslog"
)

# Traitement des erreurs
trap cleanup EXIT
trap 'echo "Erreur: Une erreur est survenue à la ligne $LINENO"' ERR

# Vérification des arguments
if [ $# -ne 1 ]; then
    echo "Erreur: Nombre d'arguments incorrect"
    exit 1
fi

# Nettoyage et validation du chemin
LOGFILE=$(readlink -f "$1")
LOGFILE=$(echo "$LOGFILE" | sed 's/^\/\+/\//')

# Vérification du chemin
is_allowed_path=false
for path in "${ALLOWED_PATHS[@]}"; do
    if [[ "$LOGFILE" == "$path" ]]; then
        is_allowed_path=true
        break
    fi
done

if [ "$is_allowed_path" = false ]; then
    echo "Erreur: Chemin non autorisé"
    exit 1
fi

# Vérification des permissions
if [ ! -f "$LOGFILE" ]; then
    echo "Erreur: Le fichier $LOGFILE n'existe pas"
    exit 1
fi

if [ ! -r "$LOGFILE" ]; then
    echo "Erreur: Le fichier $LOGFILE n'est pas lisible"
    exit 1
fi

# Vérification de la taille du fichier
FILE_SIZE=$(stat -f%z "$LOGFILE" 2>/dev/null || stat -c%s "$LOGFILE")
if [ "$FILE_SIZE" -gt 10485760 ]; then  # 10MB max
    echo "Erreur: Le fichier est trop volumineux"
    exit 1
fi

# Vérification du type de fichier
if ! file "$LOGFILE" | grep -q "text"; then
    echo "Erreur: Le fichier n'est pas un fichier texte"
    exit 1
fi

# Lecture sécurisée des lignes
if ! tail -n "$MAX_LINES" "$LOGFILE" > "$TEMP_FILE"; then
    echo "Erreur: Impossible de lire le fichier"
    exit 1
fi

# Vérification du contenu
if ! grep -q '^[[:print:]]*$' "$TEMP_FILE"; then
    echo "Erreur: Le fichier contient des caractères non imprimables"
    exit 1
fi

# Affichage du résultat
cat "$TEMP_FILE"
