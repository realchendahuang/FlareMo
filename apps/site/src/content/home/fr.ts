import type { HomeContent } from "../copy";

export const FR_HOME: HomeContent = {
  heroEyebrow: "Open source · Cloudflare natif · Gestion des connaissances",
  heroTitleLine1: "Aucun serveur à gérer.",
  heroTitleLine2: "Un second cerveau natif IA.",
  heroSubtitle:
    "Écrivez sur l'edge de Cloudflare : vos notes deviennent tâches, articles et base de connaissances consultable — les mêmes que vos agents IA peuvent lire et écrire via MCP.",
  primaryCta: "Guide de déploiement",
  secondaryCta: "Code source GitHub",
  heroFacts: [
    { label: "Stockage D1", value: "5 Go", detail: "~2,5 millions de notes" },
    {
      label: "Stockage R2",
      value: "10 Go",
      detail: "~10 000 photos · trafic 0 $",
    },
    { label: "Réseau edge", value: "300+", detail: "emplacements, < 100 ms" },
    {
      label: "Déploiement",
      value: "5 min",
      detail: "du clone à la mise en ligne",
    },
  ],
  featuresBadge: "Atouts clés",
  featuresHeading: "Pourquoi choisir FlareMo",
  featuresSubtitle:
    "Oubliez la maintenance de serveur et profitez d'une gestion de connaissances pure et native pour l'IA",
  features: [
    {
      title: "Durabilité par défaut",
      description:
        "Vos notes résident dans Cloudflare D1 et R2 avec réplication multi-régions. Un disque qui lâche ou une migration ne les emporte pas.",
    },
    {
      title: "Niveau gratuit, limites claires",
      description:
        "Le forfait gratuit inclut 5 Go sur D1 (≈ 2,5 millions de notes) et 10 Go sur R2 (≈ 10 000 photos). R2 ne facture pas le trafic sortant tant que vous restez dans ces quotas.",
    },
    {
      title: "Fonctionne hors-ligne & PWA",
      description:
        "PWA installable. Rédigez en avion ou dans le métro. Vos brouillons se synchronisent automatiquement au retour de la connexion.",
    },
    {
      title: "L'IA travaille sur vos notes",
      description:
        "Un endpoint MCP intégré permet à vos agents IA (Claude, Cursor, Codex) de chercher, lire et écrire vos propres notes. Rien n'est résumé automatiquement dans un stockage de mémoire séparé.",
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
      cloudflare: "Stockage multi-régions Cloudflare",
      nas: "Disque dur physique unique ou RAID chez soi",
      vps: "Disque virtuel dans un centre de données unique",
    },
    {
      label: "Risque matériel",
      cloudflare: "Répliqué entre régions, aucun disque à gérer",
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
      cloudflare: "Ni patch d'OS ni Docker à maintenir",
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
      cloudflare: "0 € dans l'offre gratuite (quotas inclus)",
      nas: "Coût matériel élevé + consommation électrique",
      vps: "Factures mensuelles récurrentes d'hébergement",
    },
  ],
  screenshotsHeading: "Un aperçu de l'intérieur",
  screenshotsSubtitle:
    "Clair, sombre et mobile : de vraies captures de l'application livrée, pas une maquette.",
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
      a: "Oui. Une API ouverte avec jetons personnels révocables couvre l'automatisation ; pour l'IA, l'endpoint `/mcp` expose la liste, la recherche, la lecture, la création, la modification et la suppression de vos notes, et le skill `flaremo-notes` couvre les règles d'usage. La surface exacte est documentée dans la matrice de compatibilité.",
    },
    {
      q: "Quelle différence entre mode solo et équipe ?",
      a: "Par défaut, c'est un carnet personnel confidentiel. En activant le mode équipe, vous invitez des membres par lien à usage unique ; chaque note peut être privée (vous seul), visible par l'équipe (lecture et commentaires) ou publique.",
    },
  ],
  ctaHeading: "Cinq minutes pour déployer. Et c'est à vous.",
  ctaSubtitle:
    "Sans serveur, sans carte bancaire. Déployez sur Cloudflare en 5 minutes.",
  ctaButton: "Lire le guide de déploiement en 5 min",
};
