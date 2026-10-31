import type { HomeContent } from "../copy";

export const FR_HOME: HomeContent = {
  heroEyebrow: "Zéro serveur · Latence sub-100ms · Hébergement gratuit à vie",
  heroTitleLine1: "Zéro serveur. Pour toujours à vous.",
  heroTitleLine2: "Votre second cerveau sur l'Edge.",
  heroSubtitle:
    "Minimal, jamais superficiel. Discret, jamais criard. Gestionnaire de connaissances propulsé par Cloudflare (Workers, D1, R2). Zéro maintenance VPS, compatible Memos API et mémoire persistante pour vos agents IA.",
  primaryCta: "Guide de déploiement",
  secondaryCta: "Code source GitHub",
  statMemos: "~2,5 millions de notes",
  statPhotos: "10 000 photos · 0$ trafic",
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
        "Publiez vos notes auprès de l'équipe, commentez-les et mentionnez-vous avec @ : un lieu de partage, pas un outil de gestion de projet. Rôles Propriétaire, Admin et Membre avec 3 niveaux de visibilité (privé, équipe, public) ; suppression propre des données privées lors d'un départ.",
    },
    {
      title: "Compatibilité Memos totale",
      description:
        "Compatible avec l'API Memos /api/v1 et OpenAPI. Connexion directe aux clients mobiles existants et import/export sans friction.",
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
      a: "Elles sont stockées sur l'infrastructure robuste de Cloudflare. Vous pouvez également exporter une sauvegarde complète Memos à tout moment.",
    },
    {
      q: "Puis-je migrer depuis Memos ?",
      a: "Oui, chargez simplement votre fichier d'exportation ZIP ou JSON pour tout importer avec conservation des dates et étiquettes.",
    },
    {
      q: "Mes applications mobiles existantes fonctionnent-elles ?",
      a: "Oui, FlareMo implémente l'API /api/v1 et les jetons PAT de Memos pour fonctionner avec les applications comme Moe Memos.",
    },
    {
      q: "Quelle différence entre mode solo et équipe ?",
      a: "Par défaut, c'est un carnet personnel confidentiel. En activant le mode équipe, vous pouvez inviter des membres et partager des notes sélectivement.",
    },
  ],
  ctaBadge: "C'est parti",
  ctaHeading: "Cinq minutes pour déployer. À vous pour de bon.",
  ctaSubtitle:
    "Sans serveur, sans carte bancaire. Déployez sur Cloudflare en 5 minutes.",
  ctaButton: "Lire le guide de déploiement en 5 min",
};
