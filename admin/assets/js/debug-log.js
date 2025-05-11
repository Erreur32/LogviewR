// Test direct que le script est chargé
console.log('Script de debug log chargé !');

// Debug Log Management Module
console.log('🔧 Initialisation du module de debug log...');

// Constants for configuration
const CONFIG = {
    REFRESH_INTERVAL: 5000,
    MAX_LOG_SIZE: 1000000, // 1MB
    AUTO_SCROLL: true,
    ELEMENT_IDS: {
        refreshBtn: 'refreshLogBtn',
        toggleBtn: 'toggleLogBtn',
        clearBtn: 'clearLogBtn',
        logContent: 'debug-log-content'
    }
};

// Helper function to escape HTML to prevent XSS
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Create a status message container
function createStatusContainer() {
    let container = document.getElementById('debug-status-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'debug-status-container';
        container.className = 'status-container';
        document.body.appendChild(container);
    }
    return container;
}

// Show status messages with emoji indicators
function showStatus(message, type = 'info', duration = 5000) {
    const container = createStatusContainer();
    const statusElement = document.createElement('div');
    
    // Emoji mapping for different status types
    const emojis = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    statusElement.className = `alert alert-${type} alert-dismissible fade show`;
    statusElement.innerHTML = `
        ${emojis[type] || ''} ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;

    container.appendChild(statusElement);
    
    // Auto-remove after duration
    setTimeout(() => {
        statusElement.classList.remove('show');
        setTimeout(() => statusElement.remove(), 300);
    }, duration);
}

// Function to safely get DOM elements
function getDebugElements() {
    const elements = {};
    let missingElements = [];

    // Try to get each element
    Object.entries(CONFIG.ELEMENT_IDS).forEach(([key, id]) => {
        const element = document.getElementById(id);
        if (element) {
            elements[key] = element;
        } else {
            missingElements.push(id);
        }
    });

    return { elements, missingElements };
}

// Initialize debug log functionality
function initializeDebugLog() {
    console.log('🚀 Tentative d\'initialisation des éléments UI du debug log...');

    const { elements, missingElements } = getDebugElements();

    // If we're not on the debug page, just return silently
    if (missingElements.length === Object.keys(CONFIG.ELEMENT_IDS).length) {
        console.log('📝 Page de debug non détectée, initialisation ignorée');
        return;
    }

    // If some elements are missing but not all, log a warning
    if (missingElements.length > 0) {
        console.warn('⚠️ Certains éléments sont manquants:', missingElements.join(', '));
        showStatus(`Attention: Certains éléments sont manquants - ${missingElements.join(', ')}`, 'warning');
        return;
    }

    // Refresh log content with error handling
    async function refreshDebugLog() {
        const { logContent, logLevel, refreshBtn } = elements;
        
        if (!logContent) return;

        if (refreshBtn) {
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Rafraîchissement...';
        }

        try {
            const response = await fetch(`get_debug_log.php${logLevel ? `?level=${encodeURIComponent(logLevel.value)}` : ''}`);
            
            if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
            }

            const data = await response.text();
            
            if (data.length > CONFIG.MAX_LOG_SIZE) {
                showStatus('Le fichier de log est très volumineux, considérez le vider', 'warning');
            }

            logContent.innerHTML = `<pre><code>${escapeHtml(data) || 'Aucun log disponible'}</code></pre>`;
            
            if (CONFIG.AUTO_SCROLL) {
                logContent.scrollTop = logContent.scrollHeight;
            }

            showStatus('Logs rafraîchis avec succès', 'success');
        } catch (error) {
            console.error('❌ Erreur lors du rafraîchissement:', error);
            showStatus(`Erreur de rafraîchissement: ${error.message}`, 'error');
        } finally {
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Rafraîchir';
            }
        }
}

    // Clear log content with confirmation
    async function clearDebugLog() {
        const { clearBtn, logContent } = elements;
        
        if (!logContent || !clearBtn) return;

        if (!confirm('⚠️ Êtes-vous sûr de vouloir effacer tous les logs de debug ?')) {
        return;
    }

        clearBtn.disabled = true;
        clearBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Suppression...';

        try {
            const response = await fetch('clear_debug_log.php', {
        method: 'POST',
        headers: {
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
        }
            });

        if (!response.ok) {
                throw new Error(`Erreur HTTP: ${response.status}`);
        }

            const result = await response.json();
            
            if (result.success) {
                logContent.innerHTML = '<pre><code>Logs effacés avec succès</code></pre>';
                showStatus('Logs effacés avec succès', 'success');
        } else {
                throw new Error(result.message || 'Erreur lors de la suppression');
        }
        } catch (error) {
            console.error('❌ Erreur lors de la suppression:', error);
            showStatus(`Erreur de suppression: ${error.message}`, 'error');
        } finally {
            clearBtn.disabled = false;
            clearBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Vider';
}
    }

    // Toggle log visibility with animation
function toggleDebugLog() {
        const { toggleBtn, logContent } = elements;
        
        if (!logContent || !toggleBtn) return;

        const isHidden = logContent.classList.toggle('hidden');
        const icon = toggleBtn.querySelector('i') || document.createElement('i');
        
        icon.className = isHidden ? 'fas fa-eye' : 'fas fa-eye-slash';
        toggleBtn.innerHTML = `${icon.outerHTML} ${isHidden ? 'Afficher' : 'Masquer'}`;
        
        showStatus(`Logs ${isHidden ? 'masqués' : 'affichés'}`, 'info');
    }

    // Add event listeners safely
    if (elements.refreshBtn) {
        elements.refreshBtn.addEventListener('click', refreshDebugLog);
    }
    
    if (elements.toggleBtn) {
        elements.toggleBtn.addEventListener('click', toggleDebugLog);
    }

    if (elements.clearBtn) {
        elements.clearBtn.addEventListener('click', clearDebugLog);
    }
    
    if (elements.logLevel) {
        elements.logLevel.addEventListener('change', refreshDebugLog);
    }

    // Initial refresh if we have the required elements
    if (elements.logContent) {
        refreshDebugLog();
    }
    
    console.log('✅ Module de debug log initialisé avec succès');
}

// Wait for DOM to be fully loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeDebugLog);
} else {
    initializeDebugLog();
} 