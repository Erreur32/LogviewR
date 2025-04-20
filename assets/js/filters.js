/**
 * Gestion des filtres pour LogviewR
 */

// Initialiser l'état des filtres (true par défaut)
let filtersEnabled = localStorage.getItem('filtersEnabled') !== '0';

// Exposer l'état des filtres globalement
window.getFiltersEnabled = function() {
    return filtersEnabled;  // Retourne un booléen
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
        localStorage.setItem('filtersEnabled', filtersEnabled ? '1' : '0');
        updateFilterButton();
        
        // Recharger les logs
        if (typeof currentLogFile !== 'undefined' && currentLogFile) {
            loadLog(currentLogFile);
        }
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
}); 