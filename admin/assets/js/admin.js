/**
 * LogviewR - Administration Interface JavaScript
 * Handles all admin interface functionality including form submissions, tab switching,
 * and dynamic UI updates.
 */

// Wait for both DOM and jQuery to be ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initialisation du script admin...');

    // Check if jQuery is available
    if (typeof jQuery === 'undefined') {
        console.error('jQuery is not loaded! Please include jQuery before admin.js');
        return;
    }

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

    // Fonction pour initialiser les validations d'un onglet
    function initializeTabValidations() {
        console.log('🔍 Initialisation des validations...');
        const generalTab = document.getElementById('general-tab');
        
        if (!generalTab) {
            console.warn('⚠️ Onglet général non trouvé');
            return;
        }

        // Validation des champs numériques généraux
        const inputs = {
            'max_execution_time': { min: 1, max: 300 },
            'default_lines_per_page': { min: 10, max: 1000 },
            'max_lines_per_request': { min: 100, max: 10000 },
            'refresh_interval': { min: 5, max: 1800 } // 5 secondes minimum, 30 minutes maximum
        };

        Object.entries(inputs).forEach(([field, limits]) => {
            const input = generalTab.querySelector(`input[name="app[${field}]"]`);
            if (input) {
                console.log(`✨ Configuration de la validation pour ${field}`);
                
                input.addEventListener('input', function() {
                    console.log(`🔄 Validation de ${field}: ${this.value}`);
                    validateNumber(this, limits.min, limits.max);
                });
                input.addEventListener('blur', function() {
                    validateNumber(this, limits.min, limits.max);
                });
            } else {
                console.warn(`⚠️ Champ ${field} non trouvé`);
            }
        });

        // Validation des extensions
        const extensionsInput = generalTab.querySelector('textarea[name="app[excluded_extensions]"]');
        if (extensionsInput) {
            extensionsInput.addEventListener('input', function() {
                validateExtensions(this);
            });
            extensionsInput.addEventListener('blur', function() {
                validateExtensions(this);
            });
        }
    }

    // Initialiser les validations
    initializeTabValidations();

    // Initialiser les boutons de log
    initializeLogButtons();

    // Gestion de l'intervalle de rafraîchissement - Configuration initiale
    const refreshInput = document.querySelector('input[name="app[refresh_interval]"]');
    if (refreshInput) {
        const currentValue = parseInt(refreshInput.value);
        if (!isNaN(currentValue)) {
            refreshInput.value = currentValue;
        }
    }

    // Debug Toggle Management - Le changement ne prend effet qu'après avoir cliqué sur "Enregistrer"
    const debugToggle = document.querySelector('input[name="debug[enabled]"]');
    if (debugToggle) {
        debugToggle.addEventListener('change', function() {
            const saveButton = document.querySelector('form[data-form="main"] button[type="submit"]');
            if (saveButton) {
                // Ajouter l'animation au bouton
                saveButton.classList.add('pulse-animation');
                setTimeout(() => {
                    saveButton.classList.remove('pulse-animation');
                }, 5000);
                
                // Afficher un message d'avertissement
                const message = this.checked ?
                    '⚠️ Le mode debug sera activé après avoir cliqué sur "Enregistrer". Les permissions des fichiers seront vérifiées.' :
                    '⚠️ Le mode debug sera désactivé après avoir cliqué sur "Enregistrer".';
                
                showStatus(message, 'warning');
            }
            console.log('🔧 Debug mode will be ' + (this.checked ? 'enabled' : 'disabled') + ' after saving');
        });
    }

    // Ajouter les styles CSS pour les animations
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

        .btn-pulse {
            animation: pulse 1.5s infinite;
        }
        
        @keyframes pulse {
            0% {
                box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0.7);
            }
            70% {
                box-shadow: 0 0 0 10px rgba(var(--primary-rgb), 0);
            }
            100% {
                box-shadow: 0 0 0 0 rgba(var(--primary-rgb), 0);
            }
        }
    `;
    document.head.appendChild(style);

    // Fonction pour réinitialiser les thèmes par défaut
    async function resetThemes() {
        const resetButton = document.getElementById('reset-themes');
        if (!resetButton) {
            console.warn('Reset themes button not found');
            return;
        }

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
            showMessage('Les thèmes ont été réinitialisés avec succès !', 'success');
        } catch (error) {
            console.error('Erreur:', error);
            showMessage('Erreur lors de la réinitialisation des thèmes : ' + error.message, 'error');
        }
    }

    // Gestionnaire du bouton de réinitialisation
    const resetButton = document.getElementById('reset-themes');
    if (resetButton) {
        resetButton.addEventListener('click', resetThemes);
    } else {
        console.warn('Reset themes button not found in the DOM');
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
            showMessage('Erreur lors de la sauvegarde du thème : ' + error.message, 'error');
        }
    }

    // Gestion des changements de couleurs
    const colorInputs = document.querySelectorAll('input[type="color"]');
    if (colorInputs.length > 0) {
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
    } else {
        console.warn('No color inputs found in the DOM');
    }

    const themeSelectors = document.querySelectorAll('input[name="theme"]');
    if (themeSelectors.length > 0) {
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
    } else {
        console.warn('No theme selectors found in the DOM');
    }

    // Main Form Management
    const mainForm = document.querySelector('form[data-form="main"]');
    if (mainForm) {
        mainForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Disable submit button to prevent multiple submissions
            const submitButton = this.querySelector('button[type="submit"]');
            if (submitButton) {
                submitButton.disabled = true;
                submitButton.classList.remove('btn-pulse');
                submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enregistrement...';
            }

            try {
                const formData = new FormData(this);
                formData.append('action', 'update_config');

                // Ajouter les paramètres manquants
                const maxExecutionTime = document.querySelector('input[name="app[max_execution_time]"]');
                const maxLinesPerRequest = document.querySelector('input[name="app[max_lines_per_request]"]');
                const defaultLinesPerPage = document.querySelector('input[name="app[default_lines_per_page]"]');
                const excludedExtensions = document.querySelector('textarea[name="app[excluded_extensions]"]');

                if (maxExecutionTime) formData.append('app[max_execution_time]', maxExecutionTime.value);
                if (maxLinesPerRequest) formData.append('app[max_lines_per_request]', maxLinesPerRequest.value);
                if (defaultLinesPerPage) formData.append('app[default_lines_per_page]', defaultLinesPerPage.value);
                if (excludedExtensions) formData.append('app[excluded_extensions]', excludedExtensions.value);

                const response = await fetch('ajax_actions.php', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }

                const result = await response.json();
                
                if (result.success) {
                    showMessage('✨ Configuration enregistrée avec succès ! La page va se recharger...', 'success');
                    // Recharger la page après 2 secondes pour afficher les changements
                    setTimeout(() => {
                        window.location.reload();
                    }, 2000);
                } else {
                    throw new Error(result.message || 'Échec de l\'enregistrement des paramètres');
                }
            } catch (error) {
                console.error('Error:', error);
                showMessage(error.message || 'Une erreur est survenue lors de l\'enregistrement 😢', 'error');
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.innerHTML = 'Enregistrer';
                }
            }
        });
    } else {
        console.warn('Main form not found in the DOM');
    }

    // Message Display Function
    function showMessage(message, type = 'success') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `alert alert-${type}`;
        
        // Add icons and styles based on type
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

        // Custom style for the message
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

        // Add icon and message
        messageDiv.innerHTML = `
            <i class="fas fa-${icon}" style="font-size: 1.2em;"></i>
            <span>${message}</span>
        `;
        
        // Insert message at the beginning of the container
        const container = document.querySelector('.admin-container');
        if (container) {
            container.insertBefore(messageDiv, container.firstChild);
        } else {
            console.warn('Admin container not found in the DOM');
        }

        // Auto-dismiss after 5 seconds
        setTimeout(() => {
            messageDiv.style.animation = 'fadeOut 0.5s ease-out';
            setTimeout(() => messageDiv.remove(), 500);
        }, 5000);
    }

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

    // Gestion du switch Nginx/NPM
    const npmSwitch = document.getElementById('use_npm');
    if (npmSwitch) {
        npmSwitch.addEventListener('change', function() {
            const nginxPathInput = document.getElementById('nginx_path');
            const nginxPathLabel = nginxPathInput.previousElementSibling;
            
            // Mettre à jour le label et le placeholder
            if (this.checked) {
                nginxPathLabel.textContent = 'Nginx Proxy Manager Logs Path';
                nginxPathInput.placeholder = '/path/to/npm/logs';
            } else {
                nginxPathLabel.textContent = 'Nginx Logs Path';
                nginxPathInput.placeholder = '/path/to/nginx/logs';
            }
        });
    }

    // Gestion du bouton Apache log
    const apacheLogButton = document.getElementById('apache_log_button');
    if (apacheLogButton) {
        apacheLogButton.addEventListener('click', function() {
            const apachePathInput = document.getElementById('apache_path');
            const apachePathLabel = apachePathInput.previousElementSibling;
            
            // Activer le bouton
            this.classList.add('active');
            
            // Mettre à jour le label et le placeholder
            apachePathLabel.textContent = 'Apache Logs Path';
            apachePathInput.placeholder = '/path/to/apache/logs';
            
            // Désactiver les autres boutons
            const otherButtons = document.querySelectorAll('.log-type-button:not(#apache_log_button)');
            otherButtons.forEach(button => button.classList.remove('active'));
        });
    }

    // Switch Management - Handles all switches including NPM/Nginx toggle
    const switches = document.querySelectorAll('input[type="checkbox"][data-switch]');
    let isProcessing = false; // To prevent simultaneous actions

    // Remove any existing event listeners
    switches.forEach(switchEl => {
        const newSwitch = switchEl.cloneNode(true);
        switchEl.parentNode.replaceChild(newSwitch, switchEl);
    });

    // Add new event listeners
    document.querySelectorAll('input[type="checkbox"][data-switch]').forEach(switchEl => {
        switchEl.addEventListener('change', async function() {
            if (isProcessing) {
                this.checked = !this.checked; // Cancel the change if an action is in progress
                return;
            }

            isProcessing = true;
            const formData = new FormData();
            formData.append('action', 'save_switch');
            
            // Handle special case for Nginx/NPM switch
            if (this.name === 'nginx[use_npm]') {
                formData.append('name', 'use_npm');
            } else {
                formData.append('name', this.name);
            }
            
            formData.append('value', this.checked ? '1' : '0');

            try {
                const response = await fetch('ajax_actions.php', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error('Error during update');
                }

                const result = await response.json();
                
                // Check if action was recognized
                if (result.error && result.error === 'Action non reconnue') {
                    throw new Error('Action non reconnue par le serveur');
                }
                
                if (result.success) {
                    showMessage(result.message || 'Switch updated successfully', 'success');
                    
                    // Update UI without page reload
                    if (this.name === 'nginx[use_npm]') {
                        const nginxTitle = document.querySelector('.option-group h3 i.fa-cubes').parentNode;
                        const nginxPatterns = document.getElementById('nginx_patterns');
                        const npmPatterns = document.getElementById('npm_patterns');
                        const nginxPathInput = document.querySelector('input[name="paths[nginx_logs]"]');
                        
                        if (this.checked) {
                            nginxTitle.innerHTML = '<i class="fas fa-cubes"></i> Nginx Proxy Manager';
                            if (nginxPatterns) nginxPatterns.style.display = 'none';
                            if (npmPatterns) npmPatterns.style.display = 'block';
                            if (nginxPathInput) {
                                nginxPathInput.value = '/var/log/nginx-proxy-manager';
                                nginxPathInput.placeholder = 'Chemin des logs Nginx Proxy Manager';
                            }
                        } else {
                            nginxTitle.innerHTML = '<i class="fas fa-cubes"></i> Nginx';
                            if (nginxPatterns) nginxPatterns.style.display = 'block';
                            if (npmPatterns) npmPatterns.style.display = 'none';
                            if (nginxPathInput) {
                                nginxPathInput.value = '/var/log/nginx';
                                nginxPathInput.placeholder = 'Chemin des logs Nginx';
                            }
                        }
                    }
                } else {
                    throw new Error(result.message || 'Error during update');
                }
            } catch (error) {
                console.error('Error:', error);
                showMessage(error.message, 'error');
                // Revert switch state on error
                this.checked = !this.checked;
            } finally {
                isProcessing = false;
            }
        });
    });

    // Remove any jQuery event handlers for switches
    if (typeof jQuery !== 'undefined') {
        jQuery('input[type="checkbox"][data-switch]').off('change');
    }

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

    // Fonction de validation des chemins
    function validatePath(input) {
        const value = input.value.trim();
        if (!value) {
            showValidationStatus(input, false, 'Le chemin ne peut pas être vide');
            return false;
        }
        
        // Vérifier si le chemin commence par un slash
        if (!value.startsWith('/')) {
            showValidationStatus(input, false, 'Le chemin doit commencer par un slash (/)');
            return false;
        }
        
        showValidationStatus(input, true);
        return true;
    }

    // Fonction de validation des extensions
    function validateExtensions(textarea) {
        const value = textarea.value.trim();
        const extensions = value.split('\n').map(ext => ext.trim()).filter(ext => ext);
        
        // Vérifier le format des extensions
        const invalidExtensions = extensions.filter(ext => !/^\.?[a-zA-Z0-9]+$/.test(ext));
        
        if (invalidExtensions.length > 0) {
            showValidationStatus(textarea, false, 'Format d\'extension invalide : ' + invalidExtensions.join(', '));
            return false;
        }
        
        showValidationStatus(textarea, true);
        return true;
    }

    // Fonction pour afficher le statut de validation
    function showValidationStatus(input, isValid, message = '') {
        const container = input.closest('.input-validation-container');
        if (!container) return;
        
        const status = container.querySelector('.validation-status');
        const messageDiv = container.querySelector('.validation-message');
        
        if (status) {
            status.className = 'validation-status ' + (isValid ? 'valid' : 'invalid');
        }
        
        if (messageDiv) {
            messageDiv.textContent = message;
            messageDiv.style.display = message ? 'block' : 'none';
        }
        
        input.classList.toggle('is-invalid', !isValid);
        input.classList.toggle('is-valid', isValid);
    }

    // Initialiser les validations
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

    // Debug switch event listener
    document.getElementById('debugSwitch').addEventListener('change', function(e) {
        const saveBtn = document.querySelector('.btn-save');
        const message = e.target.checked ? 
            '⚠️ Le mode debug sera activé après avoir cliqué sur "Enregistrer".' :
            '⚠️ Le mode debug sera désactivé après avoir cliqué sur "Enregistrer".';
        
        // Show status message
        showStatus(message, 'warning');
        
        // Add pulsing animation to save button
        saveBtn.classList.add('pulse-animation');
        
        // Remove animation after 5 seconds
        setTimeout(() => {
            saveBtn.classList.remove('pulse-animation');
        }, 5000);
    });

    // Function to show status messages
    function showStatus(message, type = 'info') {
        const statusContainer = document.getElementById('status-container') || createStatusContainer();
        const statusElement = document.createElement('div');
        statusElement.className = `alert alert-${type} alert-dismissible fade show`;
        statusElement.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        
        statusContainer.appendChild(statusElement);
        
        // Auto-hide after 10 seconds
        setTimeout(() => {
            if (statusElement && statusElement.parentNode) {
                statusElement.classList.remove('show');
                setTimeout(() => statusElement.remove(), 300);
            }
        }, 10000);
    }

    // Fonction pour créer le conteneur de statut s'il n'existe pas
    function createStatusContainer() {
        const container = document.createElement('div');
        container.id = 'status-container';
        container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 9999; max-width: 400px;';
        document.body.appendChild(container);
        return container;
    }

    // Gestion des boutons de log
    function initializeLogButtons() {
        console.log('🔄 Initialisation des boutons de log...');
        
        // Vérifier si nous sommes dans l'onglet debug
        const debugTab = document.getElementById('debug-tab');
        if (!debugTab || debugTab.style.display === 'none') {
            console.log('📝 Onglet debug non actif, skip initialisation des boutons');
            return;
        }

        // Récupérer les éléments avec gestion des erreurs
        const elements = {
            refreshBtn: document.getElementById('refreshLogBtn'),
            toggleBtn: document.getElementById('toggleLogBtn'),
            clearBtn: document.getElementById('clearLogBtn'),
            logContent: document.getElementById('debug-log-content'),
            logStatus: document.getElementById('log-status')
        };

        // Vérifier que tous les éléments sont présents
        const missingElements = Object.entries(elements)
            .filter(([key, element]) => !element)
            .map(([key]) => key);

        if (missingElements.length > 0) {
            console.warn('⚠️ Éléments manquants:', missingElements.join(', '));
            return;
        }

        // Fonction pour afficher le statut
        function showStatus(message, type = 'success') {
            if (elements.logStatus) {
                elements.logStatus.textContent = message;
                elements.logStatus.className = `log-status ${type}`;
                elements.logStatus.style.display = 'block';
                setTimeout(() => {
                    elements.logStatus.style.display = 'none';
                }, 5000);
            }
        }

        // Initialiser le bouton Rafraîchir
        elements.refreshBtn.addEventListener('click', async function() {
            console.log('🔄 Clic sur Rafraîchir');
            this.disabled = true;
            this.classList.add('btn-loading');
            
            try {
                const response = await fetch('get_debug_log.php');
                if (!response.ok) {
                    throw new Error(`Erreur HTTP: ${response.status}`);
                }
                const content = await response.text();
                elements.logContent.innerHTML = `<pre><code>${content}</code></pre>`;
                showStatus('✨ Logs rafraîchis avec succès');
            } catch (error) {
                console.error('❌ Erreur:', error);
                showStatus(`❌ Erreur: ${error.message}`, 'error');
            } finally {
                this.disabled = false;
                this.classList.remove('btn-loading');
            }
        });

        // Initialiser le bouton Masquer/Afficher
        elements.toggleBtn.addEventListener('click', function() {
            console.log('👁️ Clic sur Masquer/Afficher');
            const isHidden = elements.logContent.classList.toggle('hidden');
            const icon = this.querySelector('i');
            const text = this.querySelector('i').nextSibling;
            
            if (isHidden) {
                icon.className = 'fas fa-eye';
                text.textContent = ' Afficher';
                showStatus('🙈 Logs masqués');
            } else {
                icon.className = 'fas fa-eye-slash';
                text.textContent = ' Masquer';
                showStatus('👀 Logs affichés');
            }
        });

        // Initialiser le bouton Vider
        elements.clearBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            console.log('🗑️ Clic sur Vider');

            if (!confirm('Êtes-vous sûr de vouloir vider le fichier de log ?')) {
                console.log('❌ Opération annulée');
                return;
            }

            this.disabled = true;
            this.classList.add('btn-loading');
            showStatus('⏳ Envoi de la requête...', 'info');

            try {
                const response = await fetch('clear_debug_log.php', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Accept': 'application/json',
                        'X-Requested-With': 'XMLHttpRequest'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Erreur HTTP: ${response.status}`);
                }

                const result = await response.json();
                if (result.success) {
                    console.log('✨ Succès:', result);
                    showStatus('✨ Logs réinitialisés avec succès');
                    elements.refreshBtn.click();
                } else {
                    throw new Error(result.message || 'Erreur inconnue');
                }
            } catch (error) {
                console.error('❌ Erreur:', error);
                showStatus(`❌ Erreur: ${error.message}`, 'error');
            } finally {
                this.disabled = false;
                this.classList.remove('btn-loading');
            }
        });

        console.log('✅ Initialisation des boutons de log terminée');
    }

    // Initialiser les boutons quand le DOM est chargé
    initializeLogButtons();

    // Fonction de validation des nombres
    function validateNumber(input, min = 0, max = null) {
        const value = parseInt(input.value);
        const isValid = !isNaN(value) && value >= min && (max === null || value <= max);
        
        if (!isValid) {
            const message = max === null 
                ? `La valeur doit être un nombre supérieur ou égal à ${min}`
                : `La valeur doit être un nombre entre ${min} et ${max}`;
            showValidationStatus(input, false, message);
            return false;
        }
        
        showValidationStatus(input, true);
        return true;
    }

    // Fonction de validation des dates
    function validateDateFormat(input) {
        const value = input.value.trim();
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        const isValid = dateRegex.test(value);
        
        if (!isValid) {
            showValidationStatus(input, false, 'Le format de date doit être YYYY-MM-DD');
            return false;
        }
        
        // Vérifier si la date est valide
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        const isValidDate = date.getFullYear() === year && 
                           date.getMonth() === month - 1 && 
                           date.getDate() === day;
        
        if (!isValidDate) {
            showValidationStatus(input, false, 'La date n\'est pas valide');
            return false;
        }
        
        showValidationStatus(input, true);
        return true;
    }
}); 