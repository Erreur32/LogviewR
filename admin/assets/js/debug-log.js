// Test direct que le script est chargé
console.log('Script de debug log chargé !');

// Fonctions globales pour les boutons
function refreshDebugLog() {
    console.log('Rafraîchissement des logs...');
    const debugLogContent = document.getElementById('debug-log-content');
    
    if (!debugLogContent) {
        console.error('Element debug-log-content non trouvé');
        return;
    }

    fetch('get_debug_log.php')
        .then(response => response.text())
        .then(content => {
            debugLogContent.innerHTML = `<pre><code>${escapeHtml(content)}</code></pre>`;
            console.log('Logs rafraîchis avec succès');
        })
        .catch(error => {
            console.error('Erreur:', error);
            debugLogContent.innerHTML = `<div class="error">Erreur: ${error.message}</div>`;
        });
}

function toggleDebugLog() {
    console.log('Toggle des logs...');
    const debugLogContent = document.getElementById('debug-log-content');
    const toggleBtn = document.querySelector('.btn-toggle');
    
    if (!debugLogContent || !toggleBtn) {
        console.error('Elements non trouvés pour le toggle');
        return;
    }

    const isHidden = debugLogContent.classList.toggle('hidden');
    const icon = toggleBtn.querySelector('i');
    if (icon) {
        icon.className = isHidden ? 'fas fa-eye' : 'fas fa-eye-slash';
    }
}

function clearDebugLog() {
    console.log('Tentative de nettoyage des logs...');
    
    if (!confirm('Êtes-vous sûr de vouloir vider le fichier de log ?\nCette action ne peut pas être annulée.')) {
        return;
    }

    fetch('clear_debug_log.php', {
        method: 'POST'
    })
    .then(response => response.json())
    .then(result => {
        console.log('Résultat:', result);
        if (result.success) {
            refreshDebugLog();
            alert('Logs réinitialisés avec succès');
        } else {
            throw new Error(result.message || 'Erreur inconnue');
        }
    })
    .catch(error => {
        console.error('Erreur:', error);
        alert('Erreur lors de la réinitialisation des logs: ' + error.message);
    });
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

// Initial load
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM chargé, rafraîchissement initial...');
    refreshDebugLog();
    
    // Test que les fonctions sont disponibles
    console.log('Fonctions disponibles:', {
        refresh: typeof refreshDebugLog === 'function',
        toggle: typeof toggleDebugLog === 'function',
        clear: typeof clearDebugLog === 'function'
    });
}); 