/**
 * LogviewR - Administration Interface JavaScript
 * Handles all admin interface functionality including form submissions, tab switching,
 * and dynamic UI updates.
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialize parser objects for dynamic updates
    window.apacheParser = {
        excludePatterns: window.apacheParser?.excludePatterns || []
    };
    
    window.nginxParser = {
        excludePatterns: window.nginxParser?.excludePatterns || []
    };

    // Theme Management
    const root = document.documentElement;
    const savedTheme = localStorage.getItem('theme') || window.currentConfig?.theme || 'dark';
    root.setAttribute('data-theme', savedTheme);
    
    // Appliquer les variables CSS du thème
    const theme = window.currentConfig?.themes?.[savedTheme] || {};
    Object.entries(theme).forEach(([key, value]) => {
        root.style.setProperty(`--${key}`, value);
    });

    // Fonction pour réinitialiser les thèmes par défaut
    async function resetThemes() {
        const defaultThemes = {
            light: {
                primary_color: '#3498db',
                text_color: '#333333',
                bg_color: '#ffffff'
            },
            dark: {
                primary_color: '#3498db',
                text_color: '#ffffff',
                bg_color: '#1a1a1a'
            }
        };

        const formData = new FormData();
        formData.append('action', 'update_config');
        formData.append('themes', JSON.stringify(defaultThemes));

        try {
            const response = await fetch('ajax_actions.php', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Erreur lors de la réinitialisation des thèmes');
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.message || 'Erreur lors de la réinitialisation');
            }

            // Mettre à jour l'interface
            window.currentConfig.themes = defaultThemes;
            
            // Mettre à jour les inputs de couleur
            Object.entries(defaultThemes).forEach(([themeName, colors]) => {
                Object.entries(colors).forEach(([colorName, colorValue]) => {
                    const input = document.querySelector(`input[name="themes[${themeName}][${colorName}]"]`);
                    if (input) {
                        input.value = colorValue;
                    }
                });
            });

            // Appliquer les couleurs du thème actif
            const currentTheme = root.getAttribute('data-theme');
            Object.entries(defaultThemes[currentTheme]).forEach(([key, value]) => {
                root.style.setProperty(`--${key}`, value);
            });

            // Afficher un message de succès
            alert('Les thèmes ont été réinitialisés avec succès !');
        } catch (error) {
            console.error('Erreur:', error);
            alert('Erreur lors de la réinitialisation des thèmes : ' + error.message);
        }
    }

    // Gestionnaire du bouton de réinitialisation
    const resetButton = document.getElementById('reset-themes');
    if (resetButton) {
        resetButton.addEventListener('click', resetThemes);
    }

    // Fonction pour sauvegarder les changements de thème
    async function saveThemeChanges(themeName, changes = {}) {
        const formData = new FormData();
        formData.append('action', 'update_config');
        formData.append('theme', themeName);
        
        if (Object.keys(changes).length > 0) {
            for (const [key, value] of Object.entries(changes)) {
                formData.append(`themes[${themeName}][${key}]`, value);
            }
        }

        try {
            const response = await fetch('ajax_actions.php', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Erreur lors de la sauvegarde du thème');
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.message || 'Erreur lors de la sauvegarde');
            }
        } catch (error) {
            console.error('Erreur:', error);
        }
    }

    // Gestion des changements de couleurs
    const colorInputs = document.querySelectorAll('input[type="color"]');
    colorInputs.forEach(input => {
        input.addEventListener('change', function() {
            const themeName = this.name.split('[')[1].split(']')[0];
            const colorName = this.name.split('[')[2].split(']')[0];
            const colorValue = this.value;
            
            // Mettre à jour la configuration
            if (!window.currentConfig.themes[themeName]) {
                window.currentConfig.themes[themeName] = {};
            }
            window.currentConfig.themes[themeName][colorName] = colorValue;
            
            // Appliquer la couleur si c'est le thème actif
            if (themeName === root.getAttribute('data-theme')) {
                root.style.setProperty(`--${colorName}`, colorValue);
            }

            // Sauvegarder les changements
            saveThemeChanges(themeName, {[colorName]: colorValue});
        });
    });

    const themeSelectors = document.querySelectorAll('input[name="theme"]');
    themeSelectors.forEach(selector => {
        selector.addEventListener('change', function() {
            const newTheme = this.value;
            
            // Mettre à jour l'attribut data-theme
            root.setAttribute('data-theme', newTheme);
            
            // Sauvegarder dans le localStorage
            localStorage.setItem('theme', newTheme);
            
            // Appliquer les variables CSS du thème
            const theme = window.currentConfig?.themes?.[newTheme] || {};
            Object.entries(theme).forEach(([key, value]) => {
                root.style.setProperty(`--${key}`, value);
            });

            // Sauvegarder le changement de thème
            saveThemeChanges(newTheme);
        });
    });

    // Tab Management
    const tabs = document.querySelectorAll('.admin-tab');
    const tabContents = document.querySelectorAll('.admin-card');
    const activeTabInputs = document.querySelectorAll('input[name="active_tab"]');

    function updateActiveTabInputs(tabId) {
        activeTabInputs.forEach(input => {
            input.value = tabId;
        });
    }

    function switchTab(tab) {
        const tabId = tab.getAttribute('data-tab');
        
        // Deactivate all tabs
        tabs.forEach(t => t.classList.remove('active'));
        tabContents.forEach(c => c.style.display = 'none');

        // Activate clicked tab
        tab.classList.add('active');
        const content = document.getElementById(tabId + '-tab');
        if (content) {
            content.style.display = 'block';
            updateActiveTabInputs(tabId);
            
            // Update URL without page reload
            const url = new URL(window.location);
            url.searchParams.set('tab', tabId);
            window.history.pushState({}, '', url);
        }
    }

    // Add click events to tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', function(e) {
            e.preventDefault();
            switchTab(this);
        });
    });

    // Get active tab from URL
    const urlParams = new URLSearchParams(window.location.search);
    const activeTab = urlParams.get('tab') || 'general';
    const initialTab = document.querySelector(`.admin-tab[data-tab="${activeTab}"]`);
    if (initialTab) {
        switchTab(initialTab);
    }

    // Debug Toggle Management
    const debugToggle = document.querySelector('input[name="debug[enabled]"]');
    if (debugToggle) {
        let isProcessing = false;
        
        debugToggle.addEventListener('change', function() {
            if (isProcessing) return;
            isProcessing = true;
            
            const form = this.closest('form');
            if (form) {
                // Désactiver tous les autres gestionnaires d'événements
                const originalSubmit = form.onsubmit;
                form.onsubmit = null;
                
                // Soumettre le formulaire
                form.submit();
                
                // Réactiver le gestionnaire original après un court délai
                setTimeout(() => {
                    form.onsubmit = originalSubmit;
                    isProcessing = false;
                }, 1000);
            } else {
                isProcessing = false;
            }
        });
    }

    // NPM Switch Management
    const npmSwitch = document.getElementById('use_npm');
    const nginxTitle = document.querySelector('.option-group h3 i.fa-cubes').parentNode;
    const nginxPatterns = document.getElementById('nginx_patterns');
    const npmPatterns = document.getElementById('npm_patterns');
    
    if (npmSwitch) {
        npmSwitch.addEventListener('change', function() {
            const value = this.checked ? '1' : '0';
            this.value = value;
            
            // Update title
            if (this.checked) {
                nginxTitle.innerHTML = '<i class="fas fa-cubes"></i> Nginx Proxy Manager';
                if (nginxPatterns) nginxPatterns.style.display = 'none';
                if (npmPatterns) npmPatterns.style.display = 'block';
            } else {
                nginxTitle.innerHTML = '<i class="fas fa-cubes"></i> Nginx';
                if (nginxPatterns) nginxPatterns.style.display = 'block';
                if (npmPatterns) npmPatterns.style.display = 'none';
            }
        });
    }

    // Switch Management
    const switches = document.querySelectorAll('input[type="checkbox"][data-switch]');
    let isProcessing = false; // Pour éviter les actions simultanées

    switches.forEach(switchEl => {
        switchEl.addEventListener('change', async function() {
            if (isProcessing) {
                this.checked = !this.checked; // Annuler le changement si une action est en cours
                return;
            }

            isProcessing = true;
            const formData = new FormData();
            formData.append('action', 'save_switch');
            formData.append('name', this.name);
            formData.append('value', this.checked ? '1' : '0');

            try {
                const response = await fetch('ajax_actions.php', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error('Erreur lors de la mise à jour');
                }

                const result = await response.json();
                if (result.success) {
                    showMessage(result.message || 'Switch mis à jour avec succès', 'success');
                    
                    // Mettre à jour l'interface sans recharger la page
                    if (this.name === 'use_npm') {
                        const nginxTitle = document.querySelector('.option-group h3 i.fa-cubes').parentNode;
                        if (this.checked) {
                            nginxTitle.innerHTML = '<i class="fas fa-cubes"></i> Nginx Proxy Manager';
                        } else {
                            nginxTitle.innerHTML = '<i class="fas fa-cubes"></i> Nginx';
                        }
                    }
                } else {
                    throw new Error(result.message || 'Erreur lors de la mise à jour');
                }
            } catch (error) {
                showMessage(error.message, 'error');
                // Revert switch state on error
                this.checked = !this.checked;
            } finally {
                isProcessing = false;
            }
        });
    });

    // Form Management
    const forms = document.querySelectorAll('form[data-form="main"]');
    forms.forEach(form => {
        form.addEventListener('submit', async function(e) {
            e.preventDefault();
            if (isProcessing) return; // Éviter les soumissions simultanées

            const activeTab = document.querySelector('.admin-tab.active').getAttribute('data-tab');

            // Validation spécifique pour l'onglet filtres et exclusions
            if (activeTab === 'filters') {
                let hasErrors = false;
                let errorMessages = [];

                // Vérifier les extensions exclues
                const excludedExtensions = document.getElementById('excluded_extensions');
                if (excludedExtensions && !validateExtensions(excludedExtensions)) {
                    hasErrors = true;
                    errorMessages.push('Extensions exclues invalides');
                }

                // Vérifier tous les champs de pattern
                const patternInputs = form.querySelectorAll('.pattern-input');
                let hasInvalidPatterns = false;
                patternInputs.forEach(input => {
                    if (!validateFilter(input)) {
                        hasInvalidPatterns = true;
                        input.classList.add('is-invalid');
                    }
                });

                if (hasInvalidPatterns) {
                    hasErrors = true;
                    errorMessages.push('Patterns de filtrage invalides');
                }

                // Vérifier tous les chemins
                const pathInputs = form.querySelectorAll('.path-input');
                let hasInvalidPaths = false;
                pathInputs.forEach(input => {
                    if (!validatePath(input)) {
                        hasInvalidPaths = true;
                    }
                });

                if (hasInvalidPaths) {
                    hasErrors = true;
                    errorMessages.push('Chemins invalides');
                }

                // Si des erreurs sont présentes
                if (hasErrors) {
                    showMessage('Veuillez corriger les erreurs suivantes avant de sauvegarder :\n- ' + errorMessages.join('\n- '), 'error');
                    return;
                }
            }

            isProcessing = true;
            const formData = new FormData(this);
            formData.set('action', 'save_all');
            formData.set('active_tab', activeTab);

            // Disable submit button
            const submitButton = this.querySelector('button[type="submit"]');
            const originalButtonText = submitButton.innerHTML;
            submitButton.disabled = true;
            submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...';

            try {
                const response = await fetch('ajax_actions.php', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error('Erreur lors de la mise à jour');
                }

                const result = await response.json();
                
                if (result.success) {
                    showMessage(result.message || 'Configuration mise à jour avec succès', 'success');
                    
                    // Mettre à jour l'interface sans recharger la page
                    if (activeTab === 'filters') {
                        // Recharger uniquement l'onglet des filtres si nécessaire
                        const filtersTab = document.getElementById('filters-tab');
                        if (filtersTab) {
                            // Mettre à jour les valeurs des filtres
                            const filterInputs = filtersTab.querySelectorAll('textarea.pattern-input');
                            filterInputs.forEach(input => {
                                adjustHeight(input);
                            });
                        }
                    }
                } else {
                    throw new Error(result.message || 'Erreur lors de la mise à jour');
                }
            } catch (error) {
                showMessage(error.message, 'error');
            } finally {
                // Re-enable submit button
                submitButton.disabled = false;
                submitButton.innerHTML = originalButtonText;
                isProcessing = false;
            }
        });
    });

    // Message Display Function
    function showMessage(message, type = 'success') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `alert alert-${type}`;
        
        // Ajout d'icônes et de styles selon le type
        let icon, bgColor, textColor;
        if (type === 'success') {
            icon = 'check-circle';
            bgColor = 'var(--admin-success)';
            textColor = '#ffffff';
        } else if (type === 'error') {
            icon = 'exclamation-circle';
            bgColor = 'var(--admin-danger)';
            textColor = '#ffffff';
        } else if (type === 'warning') {
            icon = 'exclamation-triangle';
            bgColor = 'var(--admin-warning)';
            textColor = '#000000';
        }

        // Style personnalisé pour le message
        messageDiv.style.cssText = `
            background-color: ${bgColor};
            color: ${textColor};
            padding: 15px 20px;
            border-radius: 8px;
            margin: 10px 0;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            animation: slideIn 0.3s ease-out;
        `;

        // Ajout de l'icône et du message
        messageDiv.innerHTML = `
            <i class="fas fa-${icon}" style="font-size: 1.2em;"></i>
            <span>${message}</span>
        `;
        
        // Insertion du message au début du conteneur
        document.querySelector('.admin-container').insertBefore(
            messageDiv, 
            document.querySelector('.admin-container').firstChild
        );

        // Animation de disparition
        setTimeout(() => {
            messageDiv.style.animation = 'fadeOut 0.5s ease-out';
            setTimeout(() => messageDiv.remove(), 500);
        }, 5000);
    }

    // Ajout des styles d'animation dans le head
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateY(-100%);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }
        
        @keyframes fadeOut {
            from {
                opacity: 1;
            }
            to {
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);

    // Textarea Height Adjustment
    const textareas = document.querySelectorAll('.filter-group textarea.pattern-input');
    
    function adjustHeight(textarea) {
        textarea.style.height = 'auto';
        const scrollHeight = textarea.scrollHeight;
        textarea.style.height = scrollHeight + 'px';
        
        // Adjust minimum height based on content
        const lineCount = textarea.value.split('\n').length;
        const minHeight = Math.max(32, lineCount * 24); // 24px per line
        textarea.style.minHeight = minHeight + 'px';
    }
    
    textareas.forEach(textarea => {
        // Initial height adjustment
        adjustHeight(textarea);
        
        // Adjust height on input
        textarea.addEventListener('input', function() {
            adjustHeight(this);
        });
        
        // Adjust height on window resize
        window.addEventListener('resize', function() {
            adjustHeight(textarea);
        });

        // Adjust height on paste
        textarea.addEventListener('paste', function() {
            setTimeout(() => adjustHeight(this), 0);
        });
    });

    // Path Validation
    function validatePath(input) {
        const path = input.value.trim();
        const container = input.closest('.path-input-container');

        // Empty path check
        if (path === '') {
            showValidationStatus(input, false, 'Le chemin ne peut pas être vide');
            return false;
        }

        // Format check
        const isWindows = path.match(/^[a-zA-Z]:\\/) !== null;
        const isUnix = path.startsWith('/');
        
        if (!isWindows && !isUnix) {
            showValidationStatus(input, false, 'Format invalide - Doit commencer par \'/\' (Unix) ou \'C:\\\' (Windows)');
            return false;
        }

        // Check existence and permissions via AJAX
        fetch('check_path.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'path=' + encodeURIComponent(path)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Erreur lors de la vérification du chemin');
            }
            return response.json();
        })
        .then(data => {
            if (data.error) {
                showValidationStatus(input, false, data.error);
                return;
            }
            if (data.exists) {
                if (data.readable) {
                    showValidationStatus(input, true, 'Chemin valide et accessible');
                } else {
                    showValidationStatus(input, false, 'Droits d\'accès insuffisants pour www-data');
                }
            } else {
                showValidationStatus(input, false, data.message || 'Le dossier n\'existe pas');
            }
        })
        .catch(error => {
            console.error('Erreur lors de la vérification:', error);
            showValidationStatus(input, false, 'Erreur lors de la vérification du chemin');
        });

        return true;
    }

    // Extension Validation
    function validateExtensions(textarea) {
        const extensions = textarea.value.trim().split('\n').filter(ext => ext.trim() !== '');
        
        if (extensions.length === 0) {
            showValidationStatus(textarea, true, 'Aucune extension spécifiée');
            return true;
        }

        const invalidExtensions = extensions.filter(ext => {
            const cleanExt = ext.trim();
            return !/^[a-zA-Z0-9_-]+$/.test(cleanExt);
        });

        if (invalidExtensions.length > 0) {
            showValidationStatus(textarea, false, 'Format invalide - Utilisez uniquement lettres, chiffres, tiret et underscore (ex: jpg, png)');
            return false;
        }

        showValidationStatus(textarea, true, 'Format valide');
        return true;
    }

    // Filter Validation
    function validateFilter(textarea) {
        const patterns = textarea.value.trim().split('\n').filter(line => line.trim() !== '');
        let isValid = true;
        let errorMessage = '';

        for (const pattern of patterns) {
            if (!pattern.startsWith('/') || !pattern.endsWith('/')) {
                isValid = false;
                errorMessage = 'Le pattern doit commencer et finir par /';
                break;
            }

            try {
                // Test if the pattern is a valid regex
                const regexStr = pattern.slice(1, -1);
                new RegExp(regexStr);
            } catch (e) {
                isValid = false;
                errorMessage = 'Expression régulière invalide';
                break;
            }
        }

        const container = textarea.closest('.input-validation-container');
        const statusEl = container.querySelector('.validation-status');
        const messageEl = container.querySelector('.validation-message');

        statusEl.innerHTML = isValid ? '<i class="fas fa-check"></i>' : '<i class="fas fa-times"></i>';
        statusEl.className = 'validation-status ' + (isValid ? 'valid' : 'invalid');
        
        messageEl.textContent = errorMessage;
        messageEl.className = 'validation-message ' + (isValid ? '' : 'error');
        
        textarea.className = 'pattern-input ' + (isValid ? 'is-valid' : 'is-invalid');
        
        return isValid;
    }

    // Validation Status Display
    function showValidationStatus(input, isValid, message = '') {
        const container = input.closest('.path-input-container, .exclusion-group');
        
        // Create or get validation container
        let validationContainer = container.querySelector('.validation-wrapper');
        if (!validationContainer) {
            validationContainer = document.createElement('div');
            validationContainer.className = 'validation-wrapper';
            input.parentNode.appendChild(validationContainer);
        }

        // Create or get status indicator
        let statusContainer = validationContainer.querySelector('.validation-status');
        if (!statusContainer) {
            statusContainer = document.createElement('div');
            statusContainer.className = 'validation-status';
            validationContainer.appendChild(statusContainer);
        }

        // Create or get message container
        let messageContainer = validationContainer.querySelector('.validation-message');
        if (!messageContainer) {
            messageContainer = document.createElement('div');
            messageContainer.className = 'validation-message';
            validationContainer.appendChild(messageContainer);
        }

        // Update status icon and class
        statusContainer.innerHTML = `<i class="fas ${isValid ? 'fa-check-circle' : 'fa-exclamation-circle'}"></i>`;
        statusContainer.className = `validation-status ${isValid ? 'valid' : 'invalid'}`;
        
        // Update message only if invalid
        if (!isValid && message) {
            messageContainer.textContent = message;
            messageContainer.className = 'validation-message error';
            messageContainer.style.display = 'block';
        } else {
            messageContainer.style.display = 'none';
        }
        
        // Update input class
        input.classList.remove('is-valid', 'is-invalid');
        input.classList.add(isValid ? 'is-valid' : 'is-invalid');
    }

    // Initialize validations
    const pathInputs = document.querySelectorAll('.path-input');
    pathInputs.forEach(input => {
        input.addEventListener('input', () => validatePath(input));
        validatePath(input);
    });

    const extensionTextarea = document.querySelector('#excluded_extensions');
    if (extensionTextarea) {
        extensionTextarea.addEventListener('input', () => validateExtensions(extensionTextarea));
        validateExtensions(extensionTextarea);
    }

    const filterTextareas = document.querySelectorAll('.filter-group textarea.pattern-input');
    filterTextareas.forEach(textarea => {
        textarea.addEventListener('input', () => validateFilter(textarea));
        validateFilter(textarea);
    });

    // Format Examples Toggle
    const toggleBtn = document.getElementById('toggleExamplesBtn');
    const formatInfo = document.querySelector('.format-info-container');

    if (toggleBtn && formatInfo) {
        toggleBtn.addEventListener('click', function() {
            formatInfo.classList.toggle('show');
            this.classList.toggle('active');
            
            // Update button text
            const btnText = this.querySelector('span') || document.createElement('span');
            btnText.textContent = formatInfo.classList.contains('show') ? 'Masquer les exemples' : 'Voir les exemples de format';
            
            if (!this.contains(btnText)) {
                this.appendChild(btnText);
            }
        });
    }
}); 