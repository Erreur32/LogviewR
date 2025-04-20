// Gestion des onglets
document.addEventListener('DOMContentLoaded', function() {
    // Récupération de l'onglet actif depuis l'URL
    const urlParams = new URLSearchParams(window.location.search);
    const activeTab = urlParams.get('tab') || 'general';
    
    // Affichage de l'onglet actif
    showTab(activeTab);
    
    // Gestion des clics sur les onglets
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            const tabName = this.getAttribute('data-tab');
            showTab(tabName);
            
            // Mise à jour de l'URL sans recharger la page
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('tab', tabName);
            window.history.pushState({}, '', newUrl);
        });
    });
});

// Fonction pour afficher un onglet spécifique
function showTab(tabName) {
    // Masquer tous les onglets
    document.querySelectorAll('.admin-card').forEach(card => {
        card.style.display = 'none';
    });
    
    // Désactiver tous les onglets
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    
    // Afficher l'onglet sélectionné
    const activeCard = document.getElementById(`${tabName}-tab`);
    if (activeCard) {
        activeCard.style.display = 'block';
    }
    
    // Activer l'onglet dans la navigation
    const activeTab = document.querySelector(`.admin-tab[data-tab="${tabName}"]`);
    if (activeTab) {
        activeTab.classList.add('active');
    }
    
    // Mettre à jour le champ caché active_tab dans tous les formulaires
    document.querySelectorAll('input[name="active_tab"]').forEach(input => {
        input.value = tabName;
    });
} 