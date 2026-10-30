import type { ShowcaseContent } from "../showcase-i18n";

export const ES_SHOWCASE: ShowcaseContent = {
  memo1: {
    title: "Notas de lectura: Atención y claridad",
    content:
      "Cuanta más información nos rodea, más espacio silencioso necesitamos. Captura las observaciones sueltas: las conexiones emergerán solas.",
    quote:
      "Aprender no es acumular respuestas, sino formular mejores preguntas.",
    tags: ["ideas", "lectura"],
    time: "hace 21m",
  },
  memo2: {
    title: "Hacer de cada nota el inicio del pensamiento",
    content:
      "Pensamiento durante una caminata: las buenas herramientas eliminan la fricción. Abre y escribe al instante.\n• Mantener una línea clara\n• Etiquetar los chispazos clave\n• Revisión semanal",
    tags: ["reflexión", "producto"],
    time: "hace 1h",
  },
  presets: [
    {
      text: "Diseño del protocolo de sincronización idempotente en el aeropuerto #arquitectura #ideas",
      title: "Sincronización en el Edge",
      quote:
        "Persistencia local primero, sincronización incremental al reconectar.",
      tag: "arquitectura",
    },
    {
      text: "PWA offline mantiene el flujo de concentración en el metro o avión #ideas",
      title: "Experiencia Offline-First",
      quote: "Sin conexión, sin interrupciones.",
      tag: "ideas",
    },
    {
      text: "Bot de Telegram configurado para transcripción de notas de voz al vuelo #vida",
      title: "Captura de voz instantánea",
      quote:
        "Un audio casual se convierte en conocimiento estructurado en segundos.",
      tag: "vida",
    },
  ],
  ui: {
    statsRecords: "Notas",
    statsTags: "Etiquetas",
    statsDays: "Días",
    trend: "Tendencia",
    calendar: "Calendario",
    timeline: "Cronología",
    archive: "Archivo",
    trash: "Papelera",
    dailyReview: "Repaso diario",
    randomWalk: "Paseo aleatorio",
    memory: "Memoria",
    calendarView: "Agenda",
    projects: "Pendientes",
    tagIndex: "Etiquetas",
    searchPlaceholder: "Buscar notas...",
    composerPlaceholder: "¿En qué piensas ahora?...",
    send: "Enviar",
    justNow: "ahora",
    clearFilter: "✕ Todo",
    recordPrefix: "Nota",
    months: ["Jun", "Jul", "Ago", "Sep"],
    tags: [
      { name: "producto", count: 22 },
      { name: "reflexión", count: 22 },
      { name: "ideas", count: 22 },
      { name: "vida", count: 21 },
      { name: "planes", count: 21 },
      { name: "lectura", count: 22 },
    ],
  },
};
