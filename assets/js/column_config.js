// Configuration de l'ordre et de l'affichage des colonnes pour chaque type de log
const columnDisplayConfig = {
    // Configuration pour les logs Apache 404
    'apache-404': [

      ],
    
    // On peut ajouter d'autres types de logs ici
    'apache-access': [
        // Configuration pour les logs Apache access
    ],
    'apache-error': [
        // Configuration pour les logs Apache error
    ]
};

// Configuration personnalisée pour certains types de logs spécifiques
const customColumnConfig = {
    // Configuration spéciale pour les logs Apache 404
    'apache-404': {
    }
    // On peut ajouter d'autres types de logs ici si besoin
};

// Fonction pour obtenir la configuration des colonnes
function getColumnConfig(logType) {
    return columnDisplayConfig[logType] || [];
}

// Fonction pour obtenir la configuration personnalisée des colonnes
function getCustomColumnConfig(logType) {
    return customColumnConfig[logType];
}

// Fonction pour appliquer la configuration des colonnes à une table
function applyColumnConfig(table, logType) {
    const config = getColumnConfig(logType);
    config.forEach((colConfig, index) => {
        const column = table.column(colConfig.key);
        if (column) {
            // Appliquer la visibilité
            column.visible(colConfig.display);
            // Appliquer d'autres paramètres si nécessaire
            if (colConfig.width) {
                column.nodes().css('width', colConfig.width);
            }
            if (colConfig.align) {
                column.nodes().css('text-align', colConfig.align);
            }
        }
    });
}

// Fonction pour appliquer la configuration personnalisée à une table
function applyCustomColumnConfig(table, logType) {
    const config = getCustomColumnConfig(logType);
    if (!config) return false; // Si pas de config personnalisée, on utilise la config par défaut

    // Réorganiser les colonnes selon l'ordre défini
    if (config.order) {
        // Cache toutes les colonnes d'abord
        table.columns().visible(false);
        
        // Affiche et configure les colonnes dans l'ordre spécifié
        config.order.forEach((columnKey, index) => {
            try {
                const column = table.column(`${columnKey}:name`);
                const columnConfig = config.columns[columnKey];
                
                if (column && columnConfig) {
                    // Rendre la colonne visible si spécifié
                    column.visible(columnConfig.visible !== false);
                    
                    // Appliquer les styles à l'en-tête de la colonne
                    if (columnConfig.width) {
                        $(column.header()).css('width', columnConfig.width);
                    }
                    if (columnConfig.align) {
                        $(column.header()).css('text-align', columnConfig.align);
                    }
                    
                    // Réordonner les colonnes
                    if (index !== column.index()) {
                        table.colReorder.move(column.index(), index);
                    }
                }
            } catch (error) {
                console.warn(`Failed to configure column ${columnKey}:`, error);
            }
        });
    }
    
    return true; // Configuration personnalisée appliquée
} 