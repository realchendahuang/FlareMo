import type { ShowcaseContent } from "../showcase-i18n";

export const FR_SHOWCASE: ShowcaseContent = {
  memo1: {
    title: "Notes de lecture : Attention et synthèse",
    content:
      "Plus l'information abonde, plus nous avons besoin de calme. Notez vos observations éparses : les connexions apparaîtront naturellement.",
    quote:
      "Apprendre ne consiste pas à accumuler des réponses, mais à poser de meilleures questions.",
    tags: ["idées", "lecture"],
    time: "il y a 21m",
  },
  memo2: {
    title: "Faire de la note le point de départ de la pensée",
    content:
      "Réflexion pendant une marche : un bon outil supprime les frictions cognitives. Ouvrez et écrivez instantanément.\n• Garder une ligne directrice claire\n• Étiqueter les idées clés\n• Revue hebdomadaire",
    tags: ["pensée", "produit"],
    time: "il y a 1h",
  },
  presets: [
    {
      text: "Conception du protocole de synchronisation idempotent en salle d'attente #architecture #idées",
      title: "Synchronisation Edge en millisecondes",
      quote:
        "Persistance locale d'abord, synchronisation incrémentielle dès le retour du réseau.",
      tag: "architecture",
    },
    {
      text: "Le mode PWA hors-ligne maintient le flux intact en vol ou en métro #idées",
      title: "Expérience Offline-First",
      quote: "Aucune coupure de pensée même sans connexion.",
      tag: "idées",
    },
    {
      text: "Bot Telegram configuré pour capturer des mémos vocaux transcrits instantanément #vie",
      title: "Capture vocale instantanée",
      quote:
        "Un message vocal se transforme en note structurée en quelques secondes.",
      tag: "vie",
    },
  ],
  ui: {
    statsRecords: "Notes",
    statsTags: "Tags",
    statsDays: "Jours",
    trend: "Tendance",
    calendar: "Calendrier",
    timeline: "Fil",
    archive: "Archives",
    trash: "Corbeille",
    dailyReview: "Revue du jour",
    randomWalk: "Exploration",
    memory: "Mémoire",
    calendarView: "Agenda",
    projects: "Tâches",
    tagIndex: "Index des tags",
    searchPlaceholder: "Rechercher...",
    composerPlaceholder: "À quoi pensez-vous en ce moment ?...",
    send: "Publier",
    justNow: "à l'instant",
    clearFilter: "✕ Tout",
    recordPrefix: "Note",
    months: ["Juin", "Juil", "Août", "Sept"],
    tags: [
      { name: "produit", count: 22 },
      { name: "pensée", count: 22 },
      { name: "idées", count: 22 },
      { name: "vie", count: 21 },
      { name: "plans", count: 21 },
      { name: "lecture", count: 22 },
    ],
  },
};
