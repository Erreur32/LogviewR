// Configuration des colonnes par type de log
const columnConfigs = {
    apache: {
        access: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            host: { name: 'Host', width: '120px', align: 'center', orderable: true },
            ip: { name: 'IP', width: '120px', align: 'center', orderable: true },
            user: { name: 'User', width: '100px', align: 'center', orderable: true },
            request: { name: 'Requête', width: '300px', align: 'left', orderable: true },
            status: { name: 'Code', width: '80px', align: 'center', orderable: true },
            size: { name: 'Taille', width: '100px', align: 'right', orderable: true },
            referer: { name: 'Referer', width: '200px', align: 'left', orderable: true },
            user_agent: { name: 'User-Agent', width: '200px', align: 'left', orderable: true }
        },
        error: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            level: { name: 'Niveau', width: '100px', align: 'center', orderable: true },
            message: { name: 'Message', width: 'auto', align: 'left', orderable: true }
        }
    },
    nginx: {
        access: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            ip: { name: 'IP', width: '120px', align: 'center', orderable: true },
            request: { name: 'Requête', width: '300px', align: 'left', orderable: true },
            status: { name: 'Code', width: '80px', align: 'center', orderable: true },
            size: { name: 'Taille', width: '100px', align: 'right', orderable: true },
            referer: { name: 'Referer', width: '200px', align: 'left', orderable: true },
            user_agent: { name: 'User-Agent', width: '200px', align: 'left', orderable: true }
        },
        error: {
            date: { name: 'Date', width: '150px', align: 'center', orderable: true },
            level: { name: 'Niveau', width: '100px', align: 'center', orderable: true },
            message: { name: 'Message', width: 'auto', align: 'left', orderable: true }
        }
    },
    raw: {
        raw_line: { name: 'Ligne brute', width: 'auto', align: 'left', orderable: true }
    }
};

// Initialisation du tableau
function initLogTable(response, logFile) {
    console.log('DEBUG - Début de l\'initialisation du tableau');

    // Vérifier si le tableau existe et est une instance de DataTable
    if ($.fn.DataTable.isDataTable('#logTable')) {
        console.log('DEBUG - Destruction de l\'ancien tableau');
        $('#logTable').DataTable().destroy();
        $('#output').empty();
    }

    if (!response.lines || response.lines.length === 0) {
        console.log('DEBUG - Aucune ligne de log trouvée');
        $('#output').html('<div class="alert alert-info">Aucune ligne de log trouvée</div>');
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
            // Injecter le HTML dans le conteneur
            tableContainer.html(html);

            // Initialisation du tableau
            try {
                console.log('DEBUG - Tentative d\'initialisation de DataTable');
                window.logTable = $('#logTable').DataTable({
                    data: response.lines,
                    columns: Object.entries(response.columns).map(([key, value]) => ({
                        data: key,
                        title: value.name,
                        className: `dt-${value.class || `column-${key}`}`,
                        width: columnConfigs[response.type]?.[response.subtype]?.[key]?.width || 'auto',
                        orderable: columnConfigs[response.type]?.[response.subtype]?.[key]?.orderable ?? true,
                        render: function(data) {
                            if (!data) return '';
                            return `<div class="badge-wrapper">${data}</div>`;
                        }
                    })),
                    pageLength: defaultLinesPerPage,
                    order: [[0, 'desc']],
                    language: {
                        emptyTable: "Aucune donnée disponible dans le tableau",
                        info: "Affichage de _START_ à _END_ sur _TOTAL_ entrées",
                        infoEmpty: "Affichage de 0 à 0 sur 0 entrée",
                        infoFiltered: "(filtré de _MAX_ entrées au total)",
                        infoThousands: ",",
                        lengthMenu: "Afficher _MENU_ entrées",
                        loadingRecords: "Chargement...",
                        processing: "Traitement...",
                        search: "Rechercher :",
                        zeroRecords: "Aucun élément correspondant trouvé",
                        paginate: {
                            first: "Premier",
                            last: "Dernier",
                            next: "Suivant",
                            previous: "Précédent"
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
                console.log('DEBUG - Tableau initialisé avec succès');
                console.log('DEBUG - Nombre de lignes dans le tableau:', window.logTable.rows().count());
            } catch (error) {
                console.error('Erreur lors de l\'initialisation du tableau:', error);
            }
        },
        error: function(xhr, status, error) {
            console.error('Erreur lors du chargement du template:', error);
            tableContainer.html('<div class="error-message">Erreur lors du chargement du tableau</div>');
        }
    });

    // Gestionnaires d'événements
    $('#levelFilter').on('change', function() {
        const level = $(this).val();
        if (window.logTable) {
            const levelColumnIndex = Object.keys(window.logTable.settings()[0].aoColumns).findIndex(col => 
                col === 'level' || col === 'niveau'
            );
            if (levelColumnIndex !== -1) {
                window.logTable.column(levelColumnIndex).search(level, true, false).draw();
            }
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