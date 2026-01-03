#!/bin/bash

# Script pour configurer le remote Git et pousser le code
# Usage: bash .git-push-commands.sh

set -e

echo "🔧 Configuration du remote Git..."

# URL du dépôt (à adapter selon votre configuration)
# Pour GitHub: https://github.com/Erreur32/LogviewR.git
# Pour Forgejo/Gitea: https://forgejo.example.com/erreur32/LogviewR.git

REPO_URL="${GIT_REPO_URL:-https://github.com/Erreur32/LogviewR.git}"

# Vérifier si le remote existe déjà
if git remote get-url origin &>/dev/null; then
    echo "✅ Remote 'origin' existe déjà: $(git remote get-url origin)"
    read -p "Voulez-vous le remplacer? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git remote set-url origin "$REPO_URL"
        echo "✅ Remote 'origin' mis à jour"
    fi
else
    echo "➕ Ajout du remote 'origin'..."
    git remote add origin "$REPO_URL"
    echo "✅ Remote 'origin' ajouté: $REPO_URL"
fi

echo ""
echo "📋 État actuel:"
echo "  - Commit: $(git log --oneline -1)"
echo "  - Tag: $(git tag -l | tail -1)"
echo "  - Remote: $(git remote get-url origin)"
echo ""

read -p "Voulez-vous pousser le code maintenant? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Push du code..."
    
    # Push de la branche main
    echo "📤 Push de la branche main..."
    git push -u origin main
    
    # Push du tag
    echo "📤 Push du tag v0.1.2..."
    git push origin v0.1.2
    
    echo ""
    echo "✅ Push terminé avec succès!"
    echo "   - Branche main: $(git remote get-url origin | sed 's/\.git$//')/tree/main"
    echo "   - Tag v0.1.2: $(git remote get-url origin | sed 's/\.git$//')/releases/tag/v0.1.2"
else
    echo "⏭️  Push annulé. Commandes à exécuter manuellement:"
    echo ""
    echo "  git push -u origin main"
    echo "  git push origin v0.1.2"
fi
