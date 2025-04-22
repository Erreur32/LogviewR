// Test direct que le script est chargé
console.log('Script de debug log chargé !');

// Debug log management
console.log('Debug log script loaded');

// Helper function to escape HTML
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Initialize UI elements
document.addEventListener('DOMContentLoaded', function() {
    const refreshBtn = document.getElementById('refresh-debug-log');
    const toggleBtn = document.getElementById('toggle-debug-log');
    const clearBtn = document.getElementById('clear-debug-log');
    const logContent = document.getElementById('debug-log-content');
    const logLevel = document.getElementById('debug-log-level');

    if (!refreshBtn || !toggleBtn || !clearBtn || !logContent || !logLevel) {
        console.error('Missing required debug log UI elements');
        return;
    }

    // Refresh log content
    refreshBtn.addEventListener('click', refreshDebugLog);
    logLevel.addEventListener('change', refreshDebugLog);

    // Toggle log visibility
    toggleBtn.addEventListener('click', function() {
        logContent.classList.toggle('hidden');
        toggleBtn.textContent = logContent.classList.contains('hidden') ? 'Afficher' : 'Masquer';
    });

    // Clear log content
    clearBtn.addEventListener('click', clearDebugLog);

    // Initial refresh
    refreshDebugLog();
});

// Refresh debug log content
function refreshDebugLog() {
    const logContent = document.getElementById('debug-log-content');
    const logLevel = document.getElementById('debug-log-level');
    
    if (!logContent || !logLevel) {
        console.error('Missing required elements for debug log refresh');
        return;
    }

    fetch('get_debug_log.php?level=' + encodeURIComponent(logLevel.value))
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.text();
        })
        .then(data => {
            logContent.innerHTML = escapeHtml(data).replace(/\n/g, '<br>');
        })
        .catch(error => {
            console.error('Error refreshing debug log:', error);
            logContent.innerHTML = `Erreur lors du chargement des logs: ${escapeHtml(error.message)}`;
        });
}

// Clear debug log
function clearDebugLog() {
    if (!confirm('Êtes-vous sûr de vouloir effacer tous les logs de debug ?')) {
        return;
    }

    fetch('clear_debug_log.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            refreshDebugLog();
        } else {
            throw new Error(data.error || 'Erreur inconnue');
        }
    })
    .catch(error => {
        console.error('Error clearing debug log:', error);
        alert(`Erreur lors de l'effacement des logs: ${error.message}`);
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