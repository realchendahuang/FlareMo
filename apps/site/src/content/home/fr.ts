import type { HomeContent } from "../copy";

export const FR_HOME: HomeContent = {
  heroEyebrow: "Open source · Cloudflare natif · Gestion des connaissances",
  heroTitleLine1: "Zéro serveur. Pour toujours à vous.",
  heroTitleLine2: "Un second cerveau natif IA qui grandit avec vous.",
  heroSubtitle:
    "Minimal, jamais superficiel. Discret, jamais criard. Écrivez librement sur Cloudflare Edge : vos notes deviennent tâches, articles et base de connaissances, plus une mémoire à long terme partagée par vos agents IA.",
  primaryCta: "Guide de déploiement",
  secondaryCta: "Code source GitHub",
  statMemos: "~2,5 millions de notes",
  statPhotos: "10 000 photos compressées · 0$ trafic",
  statServers: "Ultra-basse latence 24/7",
  statUptime: "Réplication multi-régions",
  featuresBadge: "Atouts clés",
  featuresHeading: "Pourquoi choisir FlareMo",
  featuresSubtitle:
    "Oubliez la maintenance de serveur et profitez d'une gestion de connaissances pure et native pour l'IA",
  features: [
    {
      title: "Durabilité par défaut",
      description:
        "Vos notes résident dans Cloudflare D1 et R2 avec réplication multi-régions. Pannes de disques et coupures de courant n'atteignent jamais vos données.",
    },
    {
      title: "Niveau gratuit, sans surprise",
      description:
        "Le forfait gratuit contient 2,5 millions de notes et 10 000 photos. Aucun frais de transfert sortant avec Cloudflare R2.",
    },
    {
      title: "Fonctionne hors-ligne & PWA",
      description:
        "PWA installable. Rédigez en avion ou dans le métro. Vos brouillons se synchronisent automatiquement au retour de la connexion.",
    },
    {
      title: "Mémoire IA à long terme",
      description:
        "Grâce au point d'accès /memory/mcp, vos agents IA (Claude, Cursor) lisent et enrichissent votre mémoire persistante en toute sécurité.",
    },
    {
      title: "Un espace d'équipe pour partager",
      description:
        "Publiez vos notes auprès de l'équipe, commentez-les et mentionnez-vous avec @ : un lieu de partage, pas un outil de gestion de projet. Rôles Propriétaire, Admin, Membre et Lecteur avec 3 niveaux de visibilité (privé, équipe, public) ; suppression propre des données privées lors d'un départ.",
    },
    {
      title: "Vos données, toujours à vous",
      description:
        "Exportez notes, tâches, articles et pièces jointes dans une seule archive ; les imports gèrent les conflits et s'annulent proprement en cas d'échec.",
    },
    {
      title: "Notes, to-dos et projets",
      description:
        "Les notes rapides restent rapides ; les textes longs disposent d'un canevas plein écran. Planifiez une note pour un jour et ses to-dos deviennent des tâches, synchronisées dans les deux sens. Consultez Aujourd'hui, les 7 prochains jours ou un tableau de projet, avec rappels le jour de l'échéance et Web Push optionnel.",
    },
  ],
  comparisonBadge: "Comparatif",
  comparisonHeading: "Trois façons de s'auto-héberger, côte à côte",
  comparisonSubtitle:
    "Comparaison de Cloudflare Serverless avec les NAS domestiques et les VPS classiques",
  comparisonRows: [
    {
      label: "Emplacement des données",
      cloudflare: "Stockage distribué multi-régions Cloudflare",
      nas: "Disque dur physique unique ou RAID chez soi",
      vps: "Disque virtuel dans un centre de données unique",
    },
    {
      label: "Risque matériel",
      cloudflare: "Basculement automatique, zéro risque matériel",
      nas: "Panne de disque ou inondation = perte totale",
      vps: "Panne de machine hôte ou mauvaise manipulation",
    },
    {
      label: "Latence d'accès mondiale",
      cloudflare: "300+ datacenters edge, réponse en millisecondes",
      nas: "Limité par l'envoi de la box, tunnels requis",
      vps: "Dépendant de l'emplacement unique du serveur",
    },
    {
      label: "Maintenance quotidienne",
      cloudflare: "Zéro : pas de patch d'OS ni de Docker",
      nas: "Mises à jour d'OS et surveillance SMART nécessaires",
      vps: "Patchs de sécurité, pare-feu et surveillance",
    },
    {
      label: "SSL & Domaines",
      cloudflare: "HTTPS automatisé et liaison de domaine sans frais",
      nas: "Gestion manuelle de certificats et DDNS",
      vps: "Configuration Nginx et renouvellements Let's Encrypt",
    },
    {
      label: "Coût continu",
      cloudflare: "0 € / mois avec le généreux forfait gratuit",
      nas: "Coût matériel élevé + consommation électrique",
      vps: "Factures mensuelles récurrentes d'hébergement",
    },
  ],
  screenshotsHeading: "Une interface soignée et vivante",
  screenshotsSubtitle:
    "Modes clair, sombre et vue mobile réactive. Tout est fonctionnel et connecté au backend.",
  faqBadge: "À savoir",
  faqHeading: "Questions fréquentes",
  faqItems: [
    {
      q: "Le quota gratuit est-il suffisant ?",
      a: "Largement. 5 Go de D1 (~2,5M de notes) et 10 Go de R2 (~10 000 photos). Écrire 100 notes par jour prendrait 68 ans pour remplir cet espace.",
    },
    {
      q: "Mes données sont-elles en sécurité ?",
      a: "Les notes vivent sur l'infrastructure distribuée de Cloudflare, répliquée sur plusieurs régions. FlareMo peut aussi tout exporter — notes, tâches, articles et pièces jointes — dans un paquet que vous archivez hors ligne : vous gardez toujours une seconde copie.",
    },
    {
      q: "Puis-je migrer mes notes existantes ?",
      a: "Oui. Un convertisseur fourni transforme l'export d'un autre outil en paquet d'import FlareMo, en conservant dates, étiquettes, épinglages et visibilité. Limites connues : les commentaires deviennent des enregistrements autonomes et les pièces jointes liées en externe ne sont pas migrées.",
    },
    {
      q: "Puis-je connecter mes propres scripts et outils ?",
      a: "Oui. Une API ouverte avec jetons personnels révocables couvre l'automatisation ; pour l'IA, le CLI et le point MCP intégrés lisent et écrivent la même Agent Memory. La surface exacte est documentée dans la matrice de compatibilité.",
    },
    {
      q: "Quelle différence entre mode solo et équipe ?",
      a: "Par défaut, c'est un carnet personnel confidentiel. En activant le mode équipe, vous invitez des membres par lien à usage unique ; chaque note peut être privée (vous seul), visible par l'équipe (lecture et commentaires) ou publique.",
    },
  ],
  ctaBadge: "C'est parti",
  ctaHeading: "Cinq minutes pour déployer. À vous pour de bon.",
  ctaSubtitle:
    "Sans serveur, sans carte bancaire. Déployez sur Cloudflare en 5 minutes.",
  ctaButton: "Lire le guide de déploiement en 5 min",
};
