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
                width: '150px', 
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
        date: { 
            name: 'Date', 
            width: '150px', 
            align: 'center', 
            orderable: true,
            render: function(data) {
                return data ? data.replace(' +0200', '') : '';
            }
        },
        host: { 
            name: 'Host', 
            width: '200px', 
            align: 'center', 
            orderable: true 
        },
        ip: { 
            name: 'IP', 
            width: '150px', 
            align: 'center', 
            orderable: true 
        },
        real_ip: { 
            name: 'Real IP', 
            width: '150px', 
            align: 'center', 
            orderable: true 
        },
        size: { 
            name: 'Size', 
            width: '80px', 
            align: 'right', 
            orderable: true,
            render: function(data) {
                return data || '0.0B';
            }
        },
        referer: { 
            name: 'Referer', 
            width: '150px', 
            align: 'left', 
            orderable: true,
            render: function(data) {
                return data || '-';
            }
        },
        user_agent: { 
            name: 'User-Agent', 
            width: '200px', 
            align: 'left', 
            orderable: true,
            render: function(data) {
                return data || '-';
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

// Fonction pour initialiser le tableau
function initLogTable(response, logFile) {
    console.log('DEBUG - Start of table initialization');

    if ($.fn.DataTable.isDataTable('#logTable')) {
        $('#logTable').DataTable().destroy();
        $('#output').empty();
    }

    if (!response.lines || response.lines.length === 0) {
        $('#output').html('<div class="alert alert-info">No log lines found</div>');
        return;
    }

    const tableContainer = $('#output');

    // Création des en-têtes de colonnes à partir de la configuration
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
            tableContainer.html(html);

            try {
                console.log('DEBUG - Attempting to initialize DataTable');
                
                // Initialisation du tableau avec la configuration du PHP
                window.logTable = $('#logTable').DataTable({
                    data: response.lines,
                    columns: Object.entries(response.columns).map(([key, column]) => ({
                        data: key,
                        name: key,
                        title: column.name,
                        className: column.class,
                        width: column.width,
                        orderable: column.sortable,
                        searchable: column.searchable,
                        visible: column.visible,
                        render: function(data, type, row) {
                            if (!data) return '';
                            
                            // Gestion du rendu selon le type
                            switch (column.render_type) {
                                case 'date':
                                    return `<span class="sortable-date" data-sort-value="${Date.parse(data)}">${data}</span>`;
                                case 'ip_badge':
                                    return `<span class="log-badge ip">${data}</span>`;
                                case 'level_badge':
                                    return `<span class="log-badge level-${data.toLowerCase()}">${data}</span>`;
                                case 'referer_badge':
                                    if (data === '-') return '<span class="log-badge referer-empty">-</span>';
                                    const truncated = column.truncate && data.length > column.truncate 
                                        ? data.substring(0, column.truncate) + '...' 
                                        : data;
                                    return `<span class="log-badge referer" title="${data}"><a href="${data}" target="_blank">${truncated}</a></span>`;
                                case 'text':
                                    if (column.truncate && data.length > column.truncate) {
                                        return `<span title="${data}">${data.substring(0, column.truncate)}...</span>`;
                                    }
                                    return data;
                                default:
                            return `<div class="badge-wrapper">${data}</div>`;
                        }
                        }
                    })),
                    pageLength: defaultLinesPerPage,
                    order: [[0, 'desc']],
                    deferRender: true,
                    processing: true,
                    scrollX: true,
                    scrollY: '60vh',
                    scrollCollapse: true,
                    dom: 'rt<"bottom"ip>',
                    colReorder: true
                });

                // Gestionnaires d'événements pour les filtres
                setupEventHandlers();
                
                console.log('DEBUG - Table initialized successfully');

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

// Configuration des gestionnaires d'événements
function setupEventHandlers() {
    // Filtre de niveau
    $('#levelFilter').on('change', function() {
        const level = $(this).val();
        if (window.logTable) {
            window.logTable.column('level:name').search(level).draw();
        }
    });

    // Filtre persistant
$('#persistentFilter').on('input', function() {
    if (window.logTable) {
            window.logTable.search($(this).val()).draw();
    }
});

    // Nombre de lignes par page
$('#lengthMenu').on('change', function() {
    if (window.logTable) {
            window.logTable.page.len($(this).val()).draw();
        }
    });

    // Sauvegarde des préférences
    window.logTable.on('search.dt', function() {
        localStorage.setItem('logTableSearch', window.logTable.search());
    });

    window.logTable.on('page.dt', function() {
        localStorage.setItem('logTablePage', window.logTable.page.info().page);
    });

    // Restauration des préférences
    const savedSearch = localStorage.getItem('logTableSearch');
    if (savedSearch) {
        window.logTable.search(savedSearch).draw();
    }

    const savedPage = localStorage.getItem('logTablePage');
    if (savedPage) {
        window.logTable.page(parseInt(savedPage)).draw('page');
    }
}

// Fonction de rafraîchissement
function refreshTable() {
    if (!currentLogFile || !window.logTable) return;
    
    const button = $('#refreshLogs');
    const icon = button.find('i');
    
    if (button.hasClass('loading')) return;
    
    button.addClass('loading').prop('disabled', true);
    icon.addClass('fa-spin');
    
    const currentState = {
        search: window.logTable.search(),
        page: window.logTable.page(),
        order: window.logTable.order(),
        length: window.logTable.page.len()
    };

    $('#logTable').fadeOut(150);
    
    loadLog(currentLogFile, true)
        .then(() => {
            if (currentState.search) {
                window.logTable.search(currentState.search);
            }
            if (currentState.order.length) {
                window.logTable.order(currentState.order);
            }
            window.logTable.page.len(currentState.length);
            
            $('#logTable').fadeIn(150);
            return window.logTable.page(currentState.page).draw('page');
        })
        .catch(error => {
            console.error('Refresh error:', error);
            $('#errorMessage')
                .text('Failed to refresh data. Please try again.')
                .removeClass('d-none')
                .fadeIn();
            
            setTimeout(() => {
                $('#errorMessage').fadeOut();
            }, 5000);
        })
        .finally(() => {
            button.removeClass('loading').prop('disabled', false);
            icon.removeClass('fa-spin');
        });
}

// Gestionnaire pour le bouton de rafraîchissement
$('#refreshLogs').on('click', function(e) {
    e.preventDefault();
    refreshTable();
}); 