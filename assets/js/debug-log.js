// Debug Log Management
document.addEventListener('DOMContentLoaded', function() {
    console.log('Debug Log JS chargé'); // Log de débogage

    // Get UI elements
    const refreshButton = document.getElementById('refresh-debug-log');
    const toggleButton = document.getElementById('toggle-debug-log');
    const clearButton = document.getElementById('clear-debug-log');
    const debugLogContent = document.getElementById('debug-log-content');

    console.log('Boutons trouvés:', { 
        refresh: !!refreshButton, 
        toggle: !!toggleButton, 
        clear: !!clearButton 
    }); // Log de débogage

    // Refresh button
    if (refreshButton) {
        refreshButton.onclick = function() {
            console.log('Clic sur Rafraîchir');
            refreshDebugLog();
        };
    }

    // Toggle button
    if (toggleButton) {
        toggleButton.onclick = function() {
            console.log('Clic sur Masquer/Afficher');
            toggleDebugLog();
        };
    }

    // Clear button
    if (clearButton) {
        clearButton.onclick = function() {
            console.log('Clic sur Vider');
            clearDebugLog();
        };
    }

    // Initial load
    refreshDebugLog();

    // Auto refresh every 30 seconds if visible
    setInterval(function() {
        if (debugLogContent && !debugLogContent.classList.contains('hidden')) {
            refreshDebugLog();
        }
    }, 30000);
});

async function refreshDebugLog() {
    console.log('Rafraîchissement des logs...'); // Log de débogage
    const debugLogContent = document.getElementById('debug-log-content');
    const refreshButton = document.getElementById('refresh-debug-log');

    if (!debugLogContent || debugLogContent.classList.contains('hidden')) {
        console.log('Contenu caché ou non trouvé');
        return;
    }

    try {
        if (refreshButton) {
            refreshButton.disabled = true;
            refreshButton.innerHTML = '<span class="spinner"></span> Rafraîchissement...';
        }

        const response = await fetch('get_debug_log.php');
        if (!response.ok) throw new Error('Échec de la récupération des logs');

        const content = await response.text();
        debugLogContent.innerHTML = content
            .split('\n')
            .map(line => `<div class="log-line">${escapeHtml(line)}</div>`)
            .join('');

        console.log('Logs rafraîchis avec succès');

    } catch (error) {
        console.error('Erreur de rafraîchissement:', error);
        debugLogContent.innerHTML = `<div class="error">Erreur: ${error.message}</div>`;
    } finally {
        if (refreshButton) {
            refreshButton.disabled = false;
            refreshButton.innerHTML = '<i class="fas fa-sync-alt"></i> Rafraîchir';
        }
    }
}

function toggleDebugLog() {
    console.log('Toggle des logs...'); // Log de débogage
    const debugLogContent = document.getElementById('debug-log-content');
    const toggleButton = document.getElementById('toggle-debug-log');

    if (!debugLogContent || !toggleButton) {
        console.log('Éléments non trouvés pour le toggle');
        return;
    }

    const isHidden = debugLogContent.classList.toggle('hidden');
    toggleButton.innerHTML = isHidden ? 
        '<i class="fas fa-eye"></i> Afficher' : 
        '<i class="fas fa-eye-slash"></i> Masquer';
    toggleButton.classList.toggle('active', !isHidden);

    console.log('État après toggle:', isHidden ? 'caché' : 'visible');
}

async function clearDebugLog() {
    console.log('Tentative de nettoyage des logs...'); // Log de débogage

    if (!confirm('Êtes-vous sûr de vouloir vider le fichier de log ?\nCette action ne peut pas être annulée.')) {
        console.log('Nettoyage annulé par l\'utilisateur');
        return;
    }

    try {
        const response = await fetch('clear_debug_log.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();
        console.log('Résultat du nettoyage:', result);

        if (result.success) {
            refreshDebugLog();
            alert('Logs réinitialisés avec succès');
        } else {
            throw new Error(result.message || 'Erreur inconnue');
        }
    } catch (error) {
        console.error('Erreur de nettoyage:', error);
        alert('Erreur lors de la réinitialisation des logs: ' + error.message);
    }
}

// Helper function to escape HTML
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
} 