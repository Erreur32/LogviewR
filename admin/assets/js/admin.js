/**
 * LogviewR - Administration Interface JavaScript
 * Handles all admin interface functionality including form submissions, tab switching,
 * and dynamic UI updates.
 */

// Namespace principal
const LogviewR = {
    // Gestionnaire de l'interface utilisateur
    UI: {
        // Conteneur de notifications
        notificationContainer: null,

        // Initialiser le conteneur de notifications
        initNotificationContainer() {
            if (!this.notificationContainer) {
                this.notificationContainer = document.createElement('div');
                this.notificationContainer.id = 'notification-container';
                this.notificationContainer.style.cssText = `
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 9999;
                    max-width: 400px;
                `;
                document.body.appendChild(this.notificationContainer);
            }
            return this.notificationContainer;
        },

        // Afficher une notification
        showNotification(message, type = 'info', duration = 5000) {
            const container = this.initNotificationContainer();
            
            const notification = document.createElement('div');
            notification.className = `alert alert-${type} alert-dismissible fade show`;
            notification.style.cssText = `
                margin-bottom: 10px;
                animation: slideIn 0.3s ease-out;
            `;

            notification.innerHTML = `
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            `;

            container.appendChild(notification);

            setTimeout(() => {
                notification.classList.remove('show');
                setTimeout(() => notification.remove(), 300);
            }, duration);

            const closeButton = notification.querySelector('.btn-close');
            if (closeButton) {
                closeButton.addEventListener('click', () => {
                    notification.classList.remove('show');
                    setTimeout(() => notification.remove(), 300);
                });
            }
        },

        // Afficher le statut de validation
        showValidationStatus(input, isValid, message = '') {
            if (!input) return;
            
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
    },

    // Gestionnaire de validation
    Validator: {
        // Règles de validation
        rules: {
            numeric: {
                'default_lines_per_page': { min: 10, max: 1000 },
                'max_lines_per_request': { min: 100, max: 100000 },
                'refresh_interval': { min: 1, max: 3600 }
            },
            debug: {
                'log_level': { values: ['DEBUG', 'INFO', 'WARNING', 'ERROR'] },
                'log_format': { required: true }
            },
            timezone: {
                'timezone': { required: true }
            }
        },

        // Valider un champ
        validateField(input) {
            if (!input) return false;

            // Ignore hidden or disabled fields
            if (input.type === 'hidden' || input.disabled || input.offsetParent === null) {
                return true;
            }

            // Permettre le champ 'Contenu à Exclure' vide (dans les patterns)
            if ((input.id === 'exclude_content' || input.name === 'config[filters][exclude][content]') && input.value.trim() === '') {
                LogviewR.UI.showValidationStatus(input, true, '');
                return true;
            }

            // Récupérer les règles en fonction du nom du champ
            let rules = null;
            const name = input.name;

            if (name.includes('app[')) {
                const field = name.replace('app[', '').replace(']', '');
                rules = this.rules.numeric[field];
            } else if (name.includes('debug[')) {
                const field = name.replace('debug[', '').replace(']', '');
                rules = this.rules.debug[field];
            } else if (name === 'timezone') {
                rules = this.rules.timezone.timezone;
            }

            // Si pas de règles spécifiques, validation basique
            if (!rules) {
                const isValid = input.value.trim() !== '';
                LogviewR.UI.showValidationStatus(input, isValid, isValid ? '' : 'Ce champ est obligatoire');
                return isValid;
            }

            // Validation selon les règles
            if (rules.values) {
                const isValid = rules.values.includes(input.value);
                LogviewR.UI.showValidationStatus(input, isValid, 
                    isValid ? '' : `La valeur doit être l'une des suivantes : ${rules.values.join(', ')}`);
                return isValid;
            } 
            
            if (rules.required) {
                const isValid = input.value.trim() !== '';
                LogviewR.UI.showValidationStatus(input, isValid, isValid ? '' : 'Ce champ est obligatoire');
                return isValid;
            } 
            
            if (rules.min !== undefined && rules.max !== undefined) {
                const value = parseInt(input.value);
                const isValid = !isNaN(value) && value >= rules.min && value <= rules.max;
                LogviewR.UI.showValidationStatus(input, isValid, 
                    isValid ? '' : `La valeur doit être comprise entre ${rules.min} et ${rules.max}`);
                return isValid;
            }

            return true;
        },

        // Valider un chemin
        validatePath(input) {
            const value = input.value.trim();
            const isValid = value.length > 0 && value.startsWith('/');
            LogviewR.UI.showValidationStatus(input, isValid, 
                isValid ? '' : 'Le chemin doit commencer par un slash (/)');
            return isValid;
        },

        // Valider des extensions
        validateExtensions(textarea) {
            const value = textarea.value.trim();
            const extensions = value.split('\n')
                .map(ext => ext.trim())
                .filter(ext => ext.length > 0);
            
            const invalidExtensions = extensions.filter(ext => 
                !/^\.?[a-zA-Z0-9]+$/.test(ext)
            );
            
            const isValid = invalidExtensions.length === 0;
            LogviewR.UI.showValidationStatus(textarea, isValid,
                isValid ? '' : `Extensions invalides : ${invalidExtensions.join(', ')}`);
            return isValid;
        },

        // Valider des filtres
        validateFilters(textarea) {
            const value = textarea.value.trim();
            const filters = value.split('\n')
                .map(filter => filter.trim())
                .filter(filter => filter.length > 0);
            
            const invalidFilters = filters.filter(filter => {
                try {
                    let regexStr = filter;
                    if (!regexStr.startsWith('/')) regexStr = '/' + regexStr;
                    if (!regexStr.endsWith('/')) regexStr = regexStr + '/';
                    new RegExp(regexStr);
                    return false;
                } catch (e) {
                    return true;
                }
            });
            
            const isValid = invalidFilters.length === 0;
            LogviewR.UI.showValidationStatus(textarea, isValid,
                isValid ? '' : `Filtres invalides : ${invalidFilters.join(', ')}`);
            return isValid;
        }
    },

    // Gestionnaire de patterns
    PatternManager: {
        async validatePattern(pattern) {
            try {
                const response = await fetch('ajax_actions.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        action: 'validate_pattern',
                        pattern: pattern
                    })
                });
                return await response.json();
            } catch (error) {
                console.error('Erreur de validation:', error);
                return { valid: false, message: 'Erreur de communication avec le serveur' };
            }
        },

        async savePatterns(patterns) {
            try {
                console.log('Envoi des patterns:', patterns);
                
                const formData = new FormData();
                formData.append('action', 'update_patterns');
                formData.append('patterns', JSON.stringify(patterns));
                
                const response = await fetch('ajax_actions.php', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`Erreur HTTP: ${response.status}`);
                }

                const result = await response.json();
                console.log('Réponse du serveur:', result);

                if (result.success) {
                    LogviewR.UI.showNotification('✅ Patterns sauvegardés avec succès !', 'success');
                    setTimeout(() => window.location.reload(), 1000);
                } else {
                    throw new Error(result.message || 'Erreur inconnue');
                }

                return result;
            } catch (error) {
                console.error('Erreur lors de la sauvegarde:', error);
                LogviewR.UI.showNotification('❌ Erreur: ' + error.message, 'error');
                throw error;
            }
        },

        async resetPatterns() {
            try {
                const response = await fetch('ajax_actions.php', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        action: 'reset_patterns'
                    })
                });
                return await response.json();
            } catch (error) {
                console.error('Erreur de réinitialisation:', error);
                return { success: false, message: 'Erreur de communication avec le serveur' };
            }
        }
    },

    // Initialisation
    init() {
        // Vérifier jQuery
        if (typeof jQuery === 'undefined') {
            console.error('jQuery is not loaded! Please include jQuery before admin.js');
            return;
        }

        // Initialiser les parsers
        window.apacheParser = {
            excludePatterns: window.apacheParser?.excludePatterns || []
        };
        
        window.nginxParser = {
            excludePatterns: window.nginxParser?.excludePatterns || []
        };

        // Gérer le thème
        this.initTheme();
        
        // Initialiser les onglets
        this.initTabs();
        
        // Initialiser les validations
        this.initValidations();
        
        // Initialiser les boutons de log
        this.initLogButtons();
        
        // Initialiser les gestionnaires d'événements
        this.initEventHandlers();
    },

    // Initialisation du thème
    initTheme() {
        const root = document.documentElement;
        if (!root) return;

        const savedTheme = localStorage.getItem('theme') || window.currentConfig?.theme || 'dark';
        root.setAttribute('data-theme', savedTheme);
        
        const theme = window.currentConfig?.themes?.[savedTheme] || {};
        Object.entries(theme).forEach(([key, value]) => {
            if (key && value) {
                root.style.setProperty(`--${key}`, value);
            }
        });
    },

    // Initialisation des onglets
    initTabs() {
        const tabs = document.querySelectorAll('.admin-tab');
        const tabContents = document.querySelectorAll('.admin-card');
        const activeTabInputs = document.querySelectorAll('input[name="active_tab"]');

        function updateActiveTabInputs(tabId) {
            activeTabInputs?.forEach(input => {
                if (input) input.value = tabId;
            });
        }

        function switchTab(tab) {
            if (!tab) return;
            
            const tabId = tab.getAttribute('data-tab');
            if (!tabId) return;
            
            tabs?.forEach(t => t?.classList.remove('active'));
            tabContents?.forEach(c => c && (c.style.display = 'none'));

            tab.classList.add('active');
            const content = document.getElementById(tabId + '-tab');
            if (content) {
                content.style.display = 'block';
                updateActiveTabInputs(tabId);
                
                const url = new URL(window.location);
                url.searchParams.set('tab', tabId);
                window.history.pushState({}, '', url);
            }
        }

        tabs?.forEach(tab => {
            if (tab) {
                tab.addEventListener('click', function(e) {
                    e.preventDefault();
                    switchTab(this);
                });
            }
        });

        const urlParams = new URLSearchParams(window.location.search);
        const activeTab = urlParams.get('tab') || 'general';
        const initialTab = document.querySelector(`.admin-tab[data-tab="${activeTab}"]`);
        if (initialTab) {
            switchTab(initialTab);
        }
    },

    // Initialisation des validations
    initValidations() {
        const forms = document.querySelectorAll('form');
        forms.forEach(form => {
            if (!form) return;

            const inputs = form.querySelectorAll('input, textarea');
            inputs.forEach(input => {
                if (!input) return;

                input.addEventListener('blur', () => this.Validator.validateField(input));
                input.addEventListener('input', () => this.Validator.validateField(input));
            });

            form.addEventListener('submit', (e) => {
                let isValid = true;
                const invalidFields = [];

                inputs.forEach(input => {
                    if (!this.Validator.validateField(input)) {
                        isValid = false;
                        invalidFields.push(input);
                                                    // Ajoute ce log pour voir le coupable !
                                                    console.log('Champ invalide:', input, 'Valeur:', input.value, 'Name:', input.name, 'Type:', input.type);
                    }
                });

                if (!isValid) {
                    e.preventDefault();
                    // Affiche le message global seulement si plusieurs champs sont invalides
                    if (invalidFields.length > 1) {
                        this.UI.showNotification('Veuillez corriger les erreurs dans le formulaire', 'error');
                    }
                    // Scroll vers le premier champ invalide
                    invalidFields[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
        });
    },

    // Initialisation des boutons de log
    initLogButtons() {
        const debugTab = document.getElementById('debug-tab');
        if (!debugTab) return;

        const elements = {
            refreshBtn: document.getElementById('refreshLogBtn'),
            toggleBtn: document.getElementById('toggleLogBtn'),
            clearBtn: document.getElementById('clearLogBtn'),
            logContent: document.getElementById('debug-log-content'),
            logStatus: document.getElementById('log-status')
        };

        if (!Object.values(elements).some(el => el !== null)) {
            console.log('Aucun élément de log trouvé dans l\'onglet debug');
            return;
        }

        if (elements.refreshBtn) {
            elements.refreshBtn.addEventListener('click', async function() {
                this.disabled = true;
                this.classList.add('btn-loading');
                
                try {
                    const response = await fetch('get_debug_log.php');
                    if (!response.ok) {
                        throw new Error(`Erreur HTTP: ${response.status}`);
                    }
                    const content = await response.text();
                    if (elements.logContent) {
                        elements.logContent.innerHTML = content.trim() === '' 
                            ? '<pre><code>Aucun log disponible</code></pre>'
                            : `<pre><code>${content}</code></pre>`;
                    }
                } catch (error) {
                    console.error('Erreur:', error);
                    if (elements.logStatus) {
                        elements.logStatus.textContent = 'Erreur lors du rafraîchissement';
                    }
                } finally {
                    this.disabled = false;
                    this.classList.remove('btn-loading');
                }
            });
        }

        if (elements.toggleBtn && elements.logContent) {
            elements.toggleBtn.addEventListener('click', function() {
                const isHidden = elements.logContent.classList.toggle('hidden');
                const icon = this.querySelector('i');
                const text = icon?.nextSibling;
                
                if (isHidden) {
                    icon.className = 'fas fa-eye';
                    if (text) text.textContent = ' Afficher';
                } else {
                    icon.className = 'fas fa-eye-slash';
                    if (text) text.textContent = ' Masquer';
                }
            });
        }

        if (elements.clearBtn) {
            elements.clearBtn.addEventListener('click', async function() {
                if (!confirm('Êtes-vous sûr de vouloir vider les logs ? Cette action est irréversible.')) {
                    return;
                }

                this.disabled = true;
                this.classList.add('btn-loading');

                try {
                    const response = await fetch('clear_debug_log.php', {
                        method: 'POST',
                        headers: {
                            'Accept': 'application/json',
                            'X-Requested-With': 'XMLHttpRequest'
                        }
                    });

                    if (!response.ok) {
                        throw new Error(`Erreur HTTP: ${response.status}`);
                    }

                    const result = await response.json();
                    if (result.success && elements.logContent) {
                        elements.logContent.innerHTML = '<pre><code>Logs vidés avec succès</code></pre>';
                    } else {
                        throw new Error(result.message || 'Erreur inconnue lors de la suppression des logs');
                    }
                } catch (error) {
                    console.error('Erreur:', error);
                    if (elements.logStatus) {
                        elements.logStatus.textContent = 'Erreur lors de la suppression';
                    }
                } finally {
                    this.disabled = false;
                    this.classList.remove('btn-loading');
                }
            });
        }
    },

    // Initialisation des gestionnaires d'événements
    initEventHandlers() {
        // Gestion des patterns
        const patternsForm = document.getElementById('patterns-form');
        const resetPatternsBtn = document.getElementById('reset-patterns-btn');
        
        if (patternsForm) {
            const patternInputs = patternsForm.querySelectorAll('input[name*="[pattern]"]');
            patternInputs.forEach(input => {
                input.addEventListener('input', async function() {
                    const result = await LogviewR.PatternManager.validatePattern(this.value);
                    LogviewR.UI.showValidationStatus(this, result.valid, result.message);
                });
            });

            patternsForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const formData = new FormData(this);
                const patterns = {};
                
                for (const [key, value] of formData.entries()) {
                    const matches = key.match(/patterns\[(.*?)\]\[(.*?)\](?:\[(.*?)\])?/);
                    if (matches) {
                        const [_, type, patternType, field] = matches;
                        
                        if (!patterns[type]) patterns[type] = {};
                        if (!patterns[type][patternType]) {
                            patterns[type][patternType] = {
                                pattern: '',
                                description: ''
                            };
                        }
                        
                        if (field) {
                            patterns[type][patternType][field] = value;
                        } else {
                            patterns[type][patternType] = value;
                        }
                    }
                }
                
                try {
                    const result = await LogviewR.PatternManager.savePatterns(patterns);
                    if (result.success) {
                        LogviewR.UI.showNotification('✅ Patterns sauvegardés avec succès !', 'success');
                        setTimeout(() => window.location.reload(), 1000);
                    } else {
                        throw new Error(result.message || 'Erreur lors de la sauvegarde');
                    }
                } catch (error) {
                    console.error('Erreur:', error);
                    LogviewR.UI.showNotification('❌ ' + error.message, 'error');
                }
            });
        }
        
        if (resetPatternsBtn) {
            resetPatternsBtn.addEventListener('click', async function(e) {
                e.preventDefault();
                
                if (confirm('⚠️ Êtes-vous sûr de vouloir réinitialiser tous les patterns ?\nCette action ne peut pas être annulée.')) {
                    const result = await LogviewR.PatternManager.resetPatterns();
                    LogviewR.UI.showNotification(result.message, result.success ? 'success' : 'error');
                    
                    if (result.success) {
                        setTimeout(() => window.location.reload(), 1000);
                    }
                }
            });
        }

        // Gestionnaire pour le formulaire debug (enregistrement instantané sur switch)
        const debugForm = document.getElementById('debug-form');
        if (debugForm) {
            // Fonction pour sérialiser et envoyer la config debug
            async function saveDebugConfigInstant() {
                const debugEnabled = document.getElementById('debug_enabled');
                const logToApache = document.getElementById('debug_log_to_apache');
                const requireLogin = document.getElementById('debug_require_login');
                
                const config = {
                    debug: {
                        enabled: debugEnabled.checked,
                        log_to_apache: logToApache.checked,
                        require_login: requireLogin.checked
                    }
                };

                try {
                    const response = await fetch('ajax_actions.php', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        body: 'action=update_config&config=' + JSON.stringify(config)
                    });

                    const result = await response.json();
                    if (result.success) {
                        LogviewR.UI.showNotification('✅ Configuration sauvegardée !', 'success');
                        // Recharger la page après un court délai
                        setTimeout(() => window.location.reload(), 1000);
                    } else {
                        throw new Error(result.message || 'Erreur lors de la sauvegarde.');
                    }
                } catch (error) {
                    LogviewR.UI.showNotification('❌ Erreur : ' + error.message, 'error');
                }
            }
            // Ajout listeners sur les switches
            const debugSwitch = document.getElementById('debug_enabled');
            const apacheSwitch = document.getElementById('debug_log_to_apache');
            const requireLoginSwitch = document.getElementById('debug_require_login');
            if (debugSwitch) debugSwitch.addEventListener('change', saveDebugConfigInstant);
            if (apacheSwitch) apacheSwitch.addEventListener('change', saveDebugConfigInstant);
            if (requireLoginSwitch) requireLoginSwitch.addEventListener('change', saveDebugConfigInstant);
        }
    }
};

// === LIVE PATH CHECK FOR LOG PATHS === 🚦
// This function will check the path on the server via AJAX and update the tip
function checkLogPathLive(input) {
    // Get the value of the input
    const path = input.value.trim();
    // If empty, clear validation (no error, no green)
    if (!path) {
        LogviewR.UI.showValidationStatus(input, false, '');
        return;
    }
    // Prepare AJAX request to check_path.php
    fetch('check_path.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ path })
    })
    .then(response => response.json())
    .then(result => {
        // Use the existing UI function to show the tip (green/red)
        LogviewR.UI.showValidationStatus(input, result.exists && result.readable, result.message);
    })
    .catch(() => {
        // On error, show invalid
        LogviewR.UI.showValidationStatus(input, false, 'Erreur lors de la vérification du chemin');
    });
}

// Helper: check if at least one log path is valid
function isAtLeastOneLogPathValid() {
    let valid = false;
    $('.path-input').each(function() {
        // Consider valid if the green tip is present (class .valid)
        const status = $(this).closest('.input-validation-container').find('.validation-status');
        if (status.hasClass('valid')) {
            valid = true;
        }
    });
    return valid;
}

// Attach the live check to all log path inputs
$(function() {
    // Target all log path inputs by class (path-input)
    $('.path-input').on('input', function() {
        // Call the live check on each input event
        checkLogPathLive(this);
    });
    // Optionally, trigger once at page load for initial state
    $('.path-input').each(function() {
        checkLogPathLive(this);
    });

    // Add global validation on form submit
    $('#paths-form').on('submit', function(e) {
        // Remove previous global error
        $('#log-paths-error').remove();
        if (!isAtLeastOneLogPathValid()) {
            e.preventDefault();
            // Insert a global error message above the form
            $('<div id="log-paths-error" class="alert alert-danger" style="margin-bottom:16px;"><i class="fas fa-exclamation-circle"></i> Au moins un chemin de log valide est requis !</div>')
                .insertBefore('#paths-form');
            // Optionally, scroll to the form
            document.getElementById('paths-form').scrollIntoView({behavior: 'smooth', block: 'center'});
        }
    });
});

// Initialiser l'application au chargement de la page
document.addEventListener('DOMContentLoaded', () => LogviewR.init()); 