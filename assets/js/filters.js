/**
 * Gestion des filtres pour LogviewR
 */

// Initialiser l'état des filtres depuis la configuration
let filtersEnabled = false;

// Vérifier que la configuration est disponible
if (typeof window.config !== 'undefined' && window.config !== null) {
    filtersEnabled = window.config.filters_enabled ?? false;
} else {
    console.warn('Configuration non trouvée, les filtres sont désactivés par défaut');
}

// Exposer l'état des filtres globalement
window.getFiltersEnabled = function() {
    return filtersEnabled;
};

document.addEventListener('DOMContentLoaded', function() {
    const filterButton = document.getElementById('filterToggle');
    if (!filterButton) return;

    // Mettre à jour l'apparence du bouton
    function updateFilterButton() {
        filterButton.className = 'filter-toggle' + (filtersEnabled ? ' active' : '');
        filterButton.innerHTML = '<i class="fas fa-filter"></i> Filtres ' + (filtersEnabled ? 'ON' : 'OFF');
    }

    // Initialiser l'apparence du bouton
    updateFilterButton();

    // Gestionnaire de clic
    filterButton.addEventListener('click', function() {
        filtersEnabled = !filtersEnabled;
        
        // Mettre à jour l'apparence du bouton immédiatement
        updateFilterButton();
        
        // Envoyer la requête pour mettre à jour la configuration
        fetch('admin/ajax_actions.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: `action=update_filters&enabled=${filtersEnabled ? '1' : '0'}`
        }).then(response => response.json())
        .then(data => {
            if (data.success) {
                // Émettre un événement personnalisé pour notifier le changement d'état
                document.dispatchEvent(new CustomEvent('filtersStateChanged', {
                    detail: { enabled: filtersEnabled }
                }));
                
                // Recharger les logs si un fichier est ouvert
                if (typeof currentLogFile !== 'undefined' && currentLogFile) {
                    loadLog(currentLogFile).then(() => {
                        // Afficher une notification de succès
                        const message = filtersEnabled ? 
                            'Filtres activés - Les lignes filtrées sont maintenant masquées' :
                            'Filtres désactivés - Toutes les lignes sont affichées';
                        
                        showNotification(message, 'success');
                    });
                }
            } else {
                // En cas d'erreur, revenir à l'état précédent
                filtersEnabled = !filtersEnabled;
                updateFilterButton();
                showNotification('Erreur lors de la mise à jour des filtres', 'error');
            }
        }).catch(error => {
            console.error('Erreur:', error);
            filtersEnabled = !filtersEnabled;
            updateFilterButton();
            showNotification('Erreur de communication avec le serveur', 'error');
        });
    });

    // Fonction pour mettre à jour les badges de statistiques
    window.updateStatsBadges = function(stats) {
        if (!stats) return;
        
        // Mettre à jour les compteurs avec animation
        const badges = {
            'total': stats.total_lines || 0,
            'valid': stats.valid_lines || 0,
            'filtered': stats.filtered_lines || 0,
            'unreadable': stats.unreadable_lines || 0
        };

        Object.entries(badges).forEach(([type, value]) => {
            const element = document.querySelector(`.stats-badge.${type} .count`);
            if (element) {
                const currentValue = parseInt(element.textContent) || 0;
                animateNumber(element, currentValue, value);
            }
        });
    };

    // Fonction pour animer les nombres
    function animateNumber(element, start, end) {
        const duration = 500;
        const steps = 20;
        const increment = (end - start) / steps;
        let current = start;
        let step = 0;

        const timer = setInterval(() => {
            step++;
            current += increment;
            element.textContent = Math.round(current);

            if (step >= steps) {
                clearInterval(timer);
                element.textContent = end;
            }
        }, duration / steps);
    }

    // Fonction pour afficher les notifications
    function showNotification(message, type = 'info') {
        const notifications = document.getElementById('notifications');
        if (!notifications) return;

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'success' ? 'check-circle' : 'exclamation-circle'}"></i>
            ${message}
            <button class="close-notification">
                <i class="fas fa-times"></i>
            </button>
        `;

        notifications.appendChild(notification);

        // Ajouter le gestionnaire de fermeture
        notification.querySelector('.close-notification').addEventListener('click', () => {
            notification.remove();
        });

        // Auto-suppression après 5 secondes
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 5000);
    }
}); 