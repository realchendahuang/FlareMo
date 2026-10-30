import type { HomeContent } from "../copy";

export const ES_HOME: HomeContent = {
  heroEyebrow:
    "Cero servidores · Borde global sub-100ms · Autohospedaje gratuito",
  heroTitleLine1: "Cero servidores. Tuyo para siempre.",
  heroTitleLine2: "Tu segundo cerebro en el Edge.",
  heroSubtitle:
    "Mínimo, nunca superficial. Sereno, nunca estridente. Sistema de gestión del conocimiento basado en Cloudflare (Workers, D1, R2). Sin mantenimiento de VPS, compatible con Memos API y memoria duradera para IA.",
  primaryCta: "Guía de despliegue",
  secondaryCta: "Código en GitHub",
  statMemos: "~2,5 millones de notas",
  statPhotos: "10.000 fotos · 0$ tráfico",
  statServers: "Latencia ultrabaja 24/7",
  statUptime: "Replicación multirregional",
  featuresBadge: "Funciones clave",
  featuresHeading: "¿Por qué elegir FlareMo?",
  featuresSubtitle:
    "Olvídate del mantenimiento de servidores y disfruta de una gestión de conocimiento limpia y nativa de IA",
  features: [
    {
      title: "Durabilidad por diseño",
      description:
        "Tus notas viven en Cloudflare D1 y R2 con persistencia multirregional. Fallos de disco o cortes de luz jamás tocarán tus datos.",
    },
    {
      title: "Plan gratuito sin letra pequeña",
      description:
        "El plan gratuito alberga 2,5 millones de notas y 10.000 fotos. R2 no cobra por transferencia saliente, sin sorpresas en tu factura.",
    },
    {
      title: "Funciona sin conexión y PWA",
      description:
        "PWA instalable. Escribe en aviones o el metro. Tus borradores se guardan en local y se sincronizan al recuperar la red.",
    },
    {
      title: "Memoria de IA a largo plazo",
      description:
        "Mediante /memory/mcp, agentes de IA (Claude, Cursor) leen y actualizan tu contexto y preferencias persistentes de forma auditada.",
    },
    {
      title: "Un espacio de equipo para compartir",
      description:
        "Publica notas para tu equipo, comenta debajo de ellas y menciónense con @: para compartir, no para gestionar proyectos. Roles de Propietario, Administrador y Miembro con 3 niveles de visibilidad (privado, equipo, público); al salir un miembro, sus datos privados se borran de forma segura.",
    },
    {
      title: "Compatibilidad con Memos",
      description:
        "Compatibilidad total con la API /api/v1 de Memos y OpenAPI. Conexión directa con clientes como Moe Memos e importación/exportación.",
    },
    {
      title: "Notas, pendientes y proyectos",
      description:
        "Las notas rápidas siguen siendo rápidas; los textos largos tienen un lienzo a pantalla completa. Programa una nota para un día y sus pendientes se convierten en tareas, sincronizadas en ambos sentidos. Consulta Hoy, Próximos 7 días o el tablero de un proyecto, con recordatorios el día del vencimiento y Web Push opcional.",
    },
  ],
  comparisonBadge: "Comparativa",
  comparisonHeading: "Tres formas de autoalojarse, lado a lado",
  comparisonSubtitle:
    "Comparando el enfoque Cloudflare Native frente a NAS caseros y servidores VPS",
  comparisonRows: [
    {
      label: "Ubicación de datos",
      cloudflare: "Almacenamiento distribuido multirregional Cloudflare",
      nas: "Disco duro único o RAID en tu propia casa",
      vps: "Disco virtual en un centro de datos único",
    },
    {
      label: "Riesgo de hardware",
      cloudflare: "Conmutación por error automática, cero riesgo",
      nas: "Fallo de disco o corte eléctrico = pérdida total",
      vps: "Caída del hipervisor o error de configuración",
    },
    {
      label: "Latencia global",
      cloudflare: "300+ nodos perimetrales con respuesta en milisegundos",
      nas: "Limitado por la subida de tu fibra y túneles DDNS",
      vps: "Depende de la distancia al centro de datos único",
    },
    {
      label: "Mantenimiento diario",
      cloudflare: "Cero: sin parches de sistema ni Docker",
      nas: "Actualizaciones de SO y revisión de discos SMART",
      vps: "Parches de seguridad y configuración de cortafuegos",
    },
    {
      label: "SSL y Dominios",
      cloudflare: "HTTPS automatizado y dominios personalizados sin coste",
      nas: "Gestión manual de certificados y DDNS",
      vps: "Mantenimiento de Nginx y certificados Let's Encrypt",
    },
    {
      label: "Coste recurrente",
      cloudflare: "0 $ / mes en el generoso plan gratuito",
      nas: "Alto coste de hardware inicial + gasto de electricidad",
      vps: "Facturas mensuales o anuales de alojamiento",
    },
  ],
  screenshotsHeading: "Experiencia visual refinada",
  screenshotsSubtitle:
    "Modo claro, modo oscuro y diseño adaptable para móviles. Todo en producción y funcionando.",
  faqBadge: "Conviene saber",
  faqHeading: "Preguntas Frecuentes",
  faqItems: [
    {
      q: "¿Es suficiente el plan gratuito?",
      a: "De sobra. 5 GB de D1 (~2,5M de notas) y 10 GB de R2 (~10.000 fotos). Escribiendo 100 notas diarias tardarías 68 años en llenarlo.",
    },
    {
      q: "¿Están seguros mis datos?",
      a: "Están almacenados en la infraestructura global de Cloudflare. Además, puedes exportar una copia completa en formato Memos cuando desees.",
    },
    {
      q: "¿Puedo migrar desde Memos o flomo?",
      a: "Sí, sube tu archivo ZIP o JSON de exportación para importar todo conservando fechas, etiquetas y contenido.",
    },
    {
      q: "¿Funcionan las apps móviles existentes?",
      a: "Sí, FlareMo implementa los endpoints /api/v1 y tokens PAT de Memos para enlazar con clientes como Moe Memos.",
    },
    {
      q: "¿Qué diferencia hay entre modo personal y equipo?",
      a: "Por defecto es un diario personal cifrado. Al activar el modo de equipo, puedes invitar a colegas y compartir notas de manera selectiva.",
    },
  ],
  ctaBadge: "Empieza ahora",
  ctaHeading: "Cinco minutos para desplegar. Tuyo para siempre.",
  ctaSubtitle:
    "Sin servidores, sin tarjeta de crédito. Despliega en Cloudflare en 5 minutos.",
  ctaButton: "Ver guía de despliegue en 5 minutos",
};
