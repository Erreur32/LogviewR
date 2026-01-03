// Centralized permission messages and labels

export const PERMISSION_LABELS: Record<string, string> = {
  calls: 'Accès au journal d\'appels',
  camera: 'Accès aux caméras',
  contacts: 'Accès à la base de contacts',
  downloader: 'Accès au gestionnaire de téléchargements',
  explorer: 'Accès aux fichiers',
  home: 'Gestion de l\'alarme et maison connectée',
  parental: 'Accès au contrôle parental',
  player: 'Contrôle du player',
  profile: 'Gestion des profils utilisateur',
  pvr: 'Programmation des enregistrements',
  settings: 'Modification des réglages',
  tv: 'Accès au guide TV',
  vm: 'Contrôle de la VM',
  wdo: 'Provisionnement des équipements'
};

export const getPermissionErrorMessage = (permission: string): string => {
  const label = PERMISSION_LABELS[permission] || permission;
  const baseMessage = `Le droit d'accès "${label}" est requis.`;
  const instructions = 'Ajoutez-le dans les paramètres de l\'application';
  return `${baseMessage} ${instructions}`;
};

export const getPermissionShortError = (permission: string): string => {
  const label = PERMISSION_LABELS[permission] || permission;
  return `Permission "${label}" requise`;
};
