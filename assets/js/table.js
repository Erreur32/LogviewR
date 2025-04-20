// Configuration des colonnes par type de log
const columnConfigs = {
    apache: {
        access: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            host: { name: 'Host', width: '120px', align: 'center', orderable: true },
            ip: { name: 'IP', width: '120px', align: 'center', orderable: true },
            user: { name: 'User', width: '100px', align: 'center', orderable: true },
            request: { name: 'Request', width: '300px', align: 'left', orderable: true },
            status: { 
                name: 'Code', 
                width: '80px', 
                align: 'center', 
                orderable: true,
                render: function(data) {
                    if (data === '404') {
                        return '<span class="badge badge-danger">404</span>';
                    }
                    return data;
                }
            },
            size: { name: 'Size', width: '100px', align: 'right', orderable: true },
            referer: { 
                name: 'Referer', 
                width: '200px', 
                align: 'left', 
                orderable: true,
                render: function(data) {
                    if (!data || data === '-') {
                        return '<span class="text-muted">-</span>';
                    }
                    return data;
                }
            },
            user_agent: { name: 'User-Agent', width: '200px', align: 'left', orderable: true }
        },
        error: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            level: { 
                name: 'Level', 
                width: '100px', 
                align: 'center', 
                orderable: true,
                render: function(data) {
                    const levelClass = {
                        'error': 'badge-danger',
                        'warn': 'badge-warning',
                        'info': 'badge-info',
                        'debug': 'badge-secondary'
                    }[data.toLowerCase()] || 'badge-secondary';
                    return `<span class="badge ${levelClass}">${data}</span>`;
                }
            },
            message: { 
                name: 'Message', 
                width: 'auto', 
                align: 'left', 
                orderable: true,
                render: function(data) {
                    if (data.includes('404')) {
                        return `<span class="text-danger">${data}</span>`;
                    }
                    return data;
                }
            }
        }
    },
    'apache-404': {
        host: { name: 'Host', width: '150px', align: 'center', orderable: true },
        ip: { name: 'IP', width: '120px', align: 'center', orderable: true },
        real_ip: { name: 'Real IP', width: '120px', align: 'center', orderable: true },
        date: { name: 'Date', width: '150px', align: 'center', orderable: true },
        request: { 
            name: 'Request', 
            width: '300px', 
            align: 'left', 
            orderable: true,
            render: function(data) {
                return `<div class="request-wrapper">${data}</div>`;
            }
        },
        size: { name: 'Size', width: '100px', align: 'right', orderable: true },
        referer: { 
            name: 'Referer', 
            width: '200px', 
            align: 'left', 
            orderable: true,
            render: function(data) {
                if (!data || data === '-') {
                    return '<span class="text-muted">-</span>';
                }
                return data;
            }
        },
        user_agent: { 
            name: 'User-Agent', 
            width: '200px', 
            align: 'left', 
            orderable: true,
            render: function(data) {
                if (!data || data === '-') {
                    return '<span class="text-muted">-</span>';
                }
                return data;
            }
        }
    },
    'apache-referer': {
        host: { 
            name: 'Host', 
            width: '150px', 
            align: 'center', 
            orderable: true,
            render: function(data) {
                if (!data) return '<span class="text-muted">-</span>';
                return `<div class="badge-wrapper"><span class="apache-badge host">${data}</span></div>`;
            }
        },
        ip: { 
            name: 'IP', 
            width: '120px', 
            align: 'center', 
            orderable: true,
            render: function(data) {
                if (!data) return '<span class="text-muted">-</span>';
                return `<div class="badge-wrapper"><span class="apache-badge ip">${data}</span></div>`;
            }
        },
        date: { 
            name: 'Date', 
            width: '150px', 
            align: 'center', 
            orderable: true 
        },
        request: { 
            name: 'Request', 
            width: '300px', 
            align: 'left', 
            orderable: true,
            render: function(data) {
                return `<div class="request-wrapper">${data}</div>`;
            }
        },
        referer: { 
            name: 'Referer', 
            width: '300px', 
            align: 'left', 
            orderable: true,
            render: function(data) {
                if (!data || data === '-') {
                    return '<span class="text-muted">-</span>';
                }
                return `<div class="badge-wrapper"><span class="apache-badge referer">${data}</span></div>`;
            }
        }
    },
    nginx: {
        access: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            ip: { name: 'IP', width: '120px', align: 'center', orderable: true },
            request: { name: 'Request', width: '300px', align: 'left', orderable: true },
            status: { name: 'Code', width: '80px', align: 'center', orderable: true },
            size: { name: 'Size', width: '100px', align: 'right', orderable: true },
            referer: { name: 'Referer', width: '200px', align: 'left', orderable: true },
            user_agent: { name: 'User-Agent', width: '200px', align: 'left', orderable: true }
        },
        error: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            level: { name: 'Level', width: '100px', align: 'center', orderable: true },
            message: { name: 'Message', width: 'auto', align: 'left', orderable: true }
        }
    },
    'npm-proxy-host': {
        access: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            status_in: { name: 'Status In', width: '80px', align: 'center', orderable: true },
            status_out: { name: 'Status Out', width: '80px', align: 'center', orderable: true },
            method: { name: 'Method', width: '80px', align: 'center', orderable: true },
            protocol: { name: 'Protocol', width: '80px', align: 'center', orderable: true },
            host: { name: 'Host', width: '150px', align: 'center', orderable: true },
            request: { name: 'Request', width: '300px', align: 'left', orderable: true },
            client_ip: { name: 'Client IP', width: '120px', align: 'center', orderable: true },
            length: { name: 'Size', width: '80px', align: 'right', orderable: true },
            gzip: { name: 'Gzip', width: '60px', align: 'center', orderable: true },
            sent_to: { name: 'Sent To', width: '120px', align: 'center', orderable: true },
            user_agent: { name: 'User-Agent', width: '200px', align: 'left', orderable: true },
            referer: { name: 'Referer', width: '200px', align: 'left', orderable: true }
        },
        error: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            level: { name: 'Level', width: '80px', align: 'center', orderable: true },
            process: { name: 'Process', width: '100px', align: 'center', orderable: true },
            connection: { name: 'Connection', width: '100px', align: 'center', orderable: true },
            message: { name: 'Message', width: '300px', align: 'left', orderable: true },
            client: { name: 'Client', width: '120px', align: 'center', orderable: true },
            server: { name: 'Server', width: '120px', align: 'center', orderable: true },
            request: { name: 'Request', width: '200px', align: 'left', orderable: true },
            host: { name: 'Host', width: '150px', align: 'center', orderable: true }
        }
    },
    'npm-fallback-access': {
        date: { name: 'Date', width: '150px', align: 'center', orderable: true },
        status: { name: 'Status', width: '80px', align: 'center', orderable: true },
        method: { name: 'Method', width: '80px', align: 'center', orderable: true },
        protocol: { name: 'Protocol', width: '80px', align: 'center', orderable: true },
        host: { name: 'Host', width: '150px', align: 'center', orderable: true },
        request: { name: 'Request', width: '300px', align: 'left', orderable: true },
        client_ip: { name: 'Client IP', width: '120px', align: 'center', orderable: true },
        length: { name: 'Size', width: '80px', align: 'right', orderable: true },
        gzip: { name: 'Gzip', width: '60px', align: 'center', orderable: true },
        user_agent: { name: 'User-Agent', width: '200px', align: 'left', orderable: true },
        referer: { name: 'Referer', width: '200px', align: 'left', orderable: true }
    },
    'npm-fallback-error': {
        date: { name: 'Date', width: '150px', align: 'center', orderable: true },
        level: { name: 'Level', width: '80px', align: 'center', orderable: true },
        process: { name: 'Process', width: '100px', align: 'center', orderable: true },
        connection: { name: 'Connection', width: '100px', align: 'center', orderable: true },
        message: { name: 'Message', width: '300px', align: 'left', orderable: true },
        client: { name: 'Client', width: '120px', align: 'center', orderable: true },
        server: { name: 'Server', width: '120px', align: 'center', orderable: true },
        request: { name: 'Request', width: '200px', align: 'left', orderable: true },
        host: { name: 'Host', width: '150px', align: 'center', orderable: true }
    },
    'npm-dead-host': {
        access: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            status_in: { name: 'Status In', width: '80px', align: 'center', orderable: true },
            status_out: { name: 'Status Out', width: '80px', align: 'center', orderable: true },
            method: { name: 'Method', width: '80px', align: 'center', orderable: true },
            protocol: { name: 'Protocol', width: '80px', align: 'center', orderable: true },
            host: { name: 'Host', width: '150px', align: 'center', orderable: true },
            request: { name: 'Request', width: '300px', align: 'left', orderable: true },
            client_ip: { name: 'Client IP', width: '120px', align: 'center', orderable: true },
            length: { name: 'Size', width: '80px', align: 'right', orderable: true },
            gzip: { name: 'Gzip', width: '60px', align: 'center', orderable: true },
            sent_to: { name: 'Sent To', width: '120px', align: 'center', orderable: true },
            user_agent: { name: 'User-Agent', width: '200px', align: 'left', orderable: true },
            referer: { name: 'Referer', width: '200px', align: 'left', orderable: true }
        },
        error: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            level: { name: 'Level', width: '80px', align: 'center', orderable: true },
            process: { name: 'Process', width: '100px', align: 'center', orderable: true },
            connection: { name: 'Connection', width: '100px', align: 'center', orderable: true },
            message: { name: 'Message', width: '300px', align: 'left', orderable: true },
            client: { name: 'Client', width: '120px', align: 'center', orderable: true },
            server: { name: 'Server', width: '120px', align: 'center', orderable: true },
            request: { name: 'Request', width: '200px', align: 'left', orderable: true },
            host: { name: 'Host', width: '150px', align: 'center', orderable: true }
        }
    },
    'npm-default-host': {
        access: {
            client_ip: { name: 'Client IP', width: '120px', align: 'center', orderable: true },
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            request: { name: 'Request', width: '300px', align: 'left', orderable: true },
            status: { name: 'Status', width: '80px', align: 'center', orderable: true },
            size: { name: 'Size', width: '100px', align: 'right', orderable: true },
            referer: { name: 'Referer', width: '200px', align: 'left', orderable: true },
            user_agent: { name: 'User-Agent', width: '200px', align: 'left', orderable: true }
        },
        error: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            level: { 
                name: 'Level', 
                width: '80px', 
                align: 'center', 
                orderable: true,
                render: function(data) {
                    const levelClass = {
                        'error': 'badge-danger',
                        'warn': 'badge-warning',
                        'info': 'badge-info',
                        'debug': 'badge-secondary'
                    }[data.toLowerCase()] || 'badge-secondary';
                    return `<span class="badge ${levelClass}">${data}</span>`;
                }
            },
            pid: { name: 'PID', width: '100px', align: 'center', orderable: true },
            connection: { name: 'Connection', width: '100px', align: 'center', orderable: true },
            message: { name: 'Message', width: '300px', align: 'left', orderable: true },
            client: { name: 'Client', width: '120px', align: 'center', orderable: true },
            server: { name: 'Server', width: '120px', align: 'center', orderable: true },
            request: { name: 'Request', width: '200px', align: 'left', orderable: true },
            host: { name: 'Host', width: '150px', align: 'center', orderable: true }
        }
    },
    'npm-dead-host-access': {
        date: { name: 'Date', width: '150px', align: 'center', orderable: true },
        status_in: { name: 'Status In', width: '80px', align: 'center', orderable: true },
        status_out: { name: 'Status Out', width: '80px', align: 'center', orderable: true },
        method: { name: 'Method', width: '80px', align: 'center', orderable: true },
        protocol: { name: 'Protocol', width: '80px', align: 'center', orderable: true },
        host: { name: 'Host', width: '150px', align: 'center', orderable: true },
        request: { name: 'Request', width: '300px', align: 'left', orderable: true },
        client_ip: { name: 'Client IP', width: '120px', align: 'center', orderable: true },
        length: { name: 'Size', width: '80px', align: 'right', orderable: true },
        gzip: { name: 'Gzip', width: '60px', align: 'center', orderable: true },
        sent_to: { name: 'Sent To', width: '120px', align: 'center', orderable: true },
        user_agent: { name: 'User-Agent', width: '200px', align: 'left', orderable: true },
        referer: { name: 'Referer', width: '200px', align: 'left', orderable: true }
    },
    'npm-dead-host-error': {
        date: { name: 'Date', width: '150px', align: 'center', orderable: true },
        level: { name: 'Level', width: '80px', align: 'center', orderable: true },
        process: { name: 'Process', width: '100px', align: 'center', orderable: true },
        connection: { name: 'Connection', width: '100px', align: 'center', orderable: true },
        message: { name: 'Message', width: '300px', align: 'left', orderable: true },
        client: { name: 'Client', width: '120px', align: 'center', orderable: true },
        server: { name: 'Server', width: '120px', align: 'center', orderable: true },
        request: { name: 'Request', width: '200px', align: 'left', orderable: true },
        host: { name: 'Host', width: '150px', align: 'center', orderable: true }
    },
    syslog: {
        date: { name: 'Date', width: '150px', align: 'center', orderable: true },
        host: { name: 'Host', width: '120px', align: 'center', orderable: true },
        process: { name: 'Process', width: '120px', align: 'center', orderable: true },
        pid: { name: 'PID', width: '80px', align: 'center', orderable: true },
        level: { name: 'Level', width: '80px', align: 'center', orderable: true },
        message: { name: 'Message', width: 'auto', align: 'left', orderable: true }
    },
    auth: {
        date: { name: 'Date', width: '150px', align: 'center', orderable: true },
        host: { name: 'Host', width: '120px', align: 'center', orderable: true },
        process: { name: 'Process', width: '120px', align: 'center', orderable: true },
        pid: { name: 'PID', width: '80px', align: 'center', orderable: true },
        user: { name: 'User', width: '100px', align: 'center', orderable: true },
        session: { name: 'Session', width: '100px', align: 'center', orderable: true },
        message: { name: 'Message', width: 'auto', align: 'left', orderable: true }
    },
    raw: {
        raw_line: { name: 'Raw line', width: 'auto', align: 'left', orderable: true }
    }
};

// Fonction pour mettre à jour les badges de statistiques
function updateStatsBadges(stats) {
    // Réinitialiser tous les badges
    $('.stats-badge').text('0');
    
    if (!stats || Object.keys(stats).length === 0) {
        return;
    }
    
    // Mettre à jour les badges avec les nouvelles statistiques
    if (stats.total_lines !== undefined) {
        $('#total-lines-badge').text(stats.total_lines);
    }
    if (stats.valid_lines !== undefined) {
        $('#valid-lines-badge').text(stats.valid_lines);
    }
    if (stats.skipped_lines !== undefined) {
        $('#skipped-lines-badge').text(stats.skipped_lines);
    }
    if (stats.unreadable_lines !== undefined) {
        $('#unreadable-lines-badge').text(stats.unreadable_lines);
    }
    if (stats.filtered_lines !== undefined) {
        $('#filtered-lines-badge').text(stats.filtered_lines);
    }
}

// Fonction pour obtenir l'état des filtres
window.getFiltersEnabled = function() {
    return {
        level: $('#levelFilter').val() || '',
        search: $('#persistentFilter').val() || '',
        length: $('#lengthMenu').val() || defaultLinesPerPage
    };
};

// Fonction pour rafraîchir le tableau
function refreshTable() {
    console.log('DEBUG - Début du rafraîchissement du tableau');
    if (!currentLogFile || !window.logTable) {
        console.log('DEBUG - Pas de fichier ou tableau non initialisé');
        return;
    }
    
    const button = $('#refreshLogs');
    const icon = button.find('i');
    const wrapper = $('.dataTables_wrapper');
    
    // Prevent multiple clicks while loading
    if (button.hasClass('loading')) {
        console.log('DEBUG - Le bouton est déjà en cours de chargement');
        return;
    }
    
    console.log('DEBUG - Activation de l\'état de chargement');
    // Add loading state and disable button
    button.addClass('loading').prop('disabled', true);
    icon.addClass('fa-spin');
    wrapper.addClass('loading');
    
    // Save current state
    const currentState = {
        search: window.logTable.search(),
        page: window.logTable.page(),
        order: window.logTable.order(),
        length: window.logTable.page.len()
    };
    console.log('DEBUG - État actuel sauvegardé:', currentState);

    // Show loading indicator in table with fade effect
    $('#logTable').fadeOut(150).addClass('loading-data');
    
    // Reload data with timeout for minimum animation duration
    const minLoadingTime = 300; // Reduced minimum loading time
    const loadingStart = Date.now();
    
    return loadLog(currentLogFile, true)
        .then(() => {
            console.log('DEBUG - Chargement des données terminé');
            // Ensure minimum loading time for better UX
            const elapsed = Date.now() - loadingStart;
            if (elapsed < minLoadingTime) {
                return new Promise(resolve => setTimeout(resolve, minLoadingTime - elapsed));
            }
        })
        .then(() => {
            console.log('DEBUG - Restauration de l\'état');
            // Restore state
            if (currentState.search) {
                window.logTable.search(currentState.search);
            }
            if (currentState.order.length) {
                window.logTable.order(currentState.order);
            }
            window.logTable.page.len(currentState.length);
            
            // Fade in the table
            $('#logTable').fadeIn(150);
            
            return window.logTable.page(currentState.page).draw('page');
        })
        .catch(error => {
            console.error('DEBUG - Erreur lors du rafraîchissement:', error);
            $('#errorMessage')
                .text('Failed to refresh data. Please try again.')
                .removeClass('d-none')
                .fadeIn();
            
            setTimeout(() => {
                $('#errorMessage').fadeOut();
            }, 5000);
        })
        .finally(() => {
            console.log('DEBUG - Nettoyage des états de chargement');
            // Remove loading states with smooth transition
            wrapper.removeClass('loading');
            setTimeout(() => {
                button.removeClass('loading').prop('disabled', false);
                icon.removeClass('fa-spin');
                $('#logTable').removeClass('loading-data');
            }, 150);
            
            // Force redraw to ensure all states are cleared
            if (window.logTable) {
                console.log('DEBUG - Redessinage forcé du tableau');
                window.logTable.draw(false);
            }
            console.log('DEBUG - Rafraîchissement terminé');
        });
}

// Initialisation du tableau
function initLogTable(response, logFile) {
    console.log('DEBUG - Start of table initialization');
    console.log('DEBUG - Log type:', response.type);
    console.log('DEBUG - Columns:', response.columns);
    console.log('DEBUG - Lines:', response.lines);

    // Vérifier si le tableau existe et est une instance de DataTable
    if ($.fn.DataTable.isDataTable('#logTable')) {
        console.log('DEBUG - Destroying old table');
        $('#logTable').DataTable().destroy();
        $('#output').empty();
    }

    if (!response.lines || response.lines.length === 0) {
        console.log('DEBUG - No log lines found');
        $('#output').html('<div class="alert alert-info">No log lines found</div>');
        return;
    }

    // Initialiser le conteneur du tableau
    const tableContainer = $('#output');

    // Création des en-têtes de colonnes
    const headers = Object.entries(response.columns)
        .map(([key, value]) => `<th>${value.name}</th>`)
        .join('');

    // Appel AJAX pour récupérer le template HTML
    $.ajax({
        url: 'assets/php/table_template.php',
        method: 'POST',
        data: {
            logFile: logFile,
            response: JSON.stringify(response),
            headers: headers
        },
        success: function(html) {
            console.log('DEBUG - Template loaded successfully');
            // Injecter le HTML dans le conteneur
            tableContainer.html(html);

            // Initialisation du tableau
            try {
                console.log('DEBUG - Attempting to initialize DataTable');
                
                // Préparer les colonnes
                const columns = Object.entries(response.columns).map(([key, value], index) => {
                    // Utiliser la configuration spécifique au type de log
                    const logType = response.type.split('-')[0]; // ex: 'apache' from 'apache-referer'
                    const subType = response.type.split('-')[1]; // ex: 'referer' from 'apache-referer'
                    const columnConfig = columnConfigs[logType]?.[subType]?.[key] || {};
                    console.log('DEBUG - Processing column:', {
                        key,
                        value,
                        index,
                        columnConfig,
                        logType,
                        subType
                    });
                    return {
                        data: key,
                        name: key,
                        title: value.name,
                        className: `dt-${value.class || `column-${key}`}`,
                        width: columnConfig.width || 'auto',
                        orderable: columnConfig.orderable ?? true,
                        searchable: true,
                        visible: true,
                        render: columnConfig.render || function(data) {
                            if (!data) return '';
                            return `<div class="badge-wrapper">${data}</div>`;
                        }
                    };
                });

                console.log('DEBUG - Final columns configuration:', columns);

                // Vérifier que les colonnes sont correctement définies
                if (!columns || columns.length === 0) {
                    console.error('No columns defined for table initialization');
                    return;
                }

                window.logTable = $('#logTable').DataTable({
                    data: response.lines,
                    columns: columns,
                    pageLength: defaultLinesPerPage,
                    order: [[0, 'desc']],
                    language: {
                        emptyTable: "No data available in table",
                        info: "Showing _START_ to _END_ of _TOTAL_ entries",
                        infoEmpty: "Showing 0 to 0 of 0 entries",
                        infoFiltered: "(filtered from _MAX_ total entries)",
                        infoThousands: ",",
                        lengthMenu: "Show _MENU_ entries",
                        loadingRecords: "Loading...",
                        processing: "Processing...",
                        search: "Search:",
                        zeroRecords: "No matching records found",
                        paginate: {
                            first: "First",
                            last: "Last",
                            next: "Next",
                            previous: "Previous"
                        }
                    },
                    deferRender: true,
                    processing: true,
                    scrollX: true,
                    scrollY: '60vh',
                    scrollCollapse: true,
                    dom: 'rt<"bottom"ip>',
                    escapeHtml: false
                });
                console.log('DEBUG - Table initialized successfully');
                console.log('DEBUG - Number of rows in table:', window.logTable.rows().count());

                // Déplacer les gestionnaires d'événements ici, après l'initialisation
                // Gestionnaire pour le filtre de niveau
                $('#levelFilter').on('change', function() {
                    const level = $(this).val();
                    const levelColumnIndex = Object.keys(window.logTable.settings()[0].aoColumns).findIndex(col => 
                        col === 'level' || col === 'niveau'
                    );
                    if (levelColumnIndex !== -1) {
                        window.logTable.column(levelColumnIndex).search(level, true, false).draw();
                    }
                });

                // Filtre persistant
                window.logTable.on('search.dt', function() {
                    const searchValue = window.logTable.search();
                    localStorage.setItem('logTableSearch', searchValue);
                });

                const savedSearch = localStorage.getItem('logTableSearch');
                if (savedSearch) {
                    window.logTable.search(savedSearch).draw();
                }

                // Changement de page
                window.logTable.on('page.dt', function() {
                    const pageInfo = window.logTable.page.info();
                    localStorage.setItem('logTablePage', pageInfo.page);
                });

                const savedPage = localStorage.getItem('logTablePage');
                if (savedPage) {
                    window.logTable.page(parseInt(savedPage)).draw('page');
                }

                // Gestionnaires pour les autres filtres
                $('#persistentFilter').on('input', function() {
                    const filterValue = $(this).val();
                    window.logTable.search(filterValue).draw();
                });

                $('#lengthMenu').on('change', function() {
                    const length = $(this).val();
                    window.logTable.page.len(length).draw();
                });

            } catch (error) {
                console.error('Error during table initialization:', error);
            }
        },
        error: function(xhr, status, error) {
            console.error('Error loading template:', error);
            tableContainer.html('<div class="error-message">Error loading table</div>');
        }
    });
}

// Gestionnaires d'événements pour les filtres
$('#persistentFilter').on('input', function() {
    const filterValue = $(this).val();
    if (window.logTable) {
        window.logTable.search(filterValue).draw();
    }
});

$('#lengthMenu').on('change', function() {
    const length = $(this).val();
    if (window.logTable) {
        window.logTable.page.len(length).draw();
    }
});

// Gestionnaire pour le bouton de rafraîchissement
$('#refreshLogs').on('click', function(e) {
    e.preventDefault();
    refreshTable();
}); 