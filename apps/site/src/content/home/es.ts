import type { HomeContent } from "../copy";

export const ES_HOME: HomeContent = {
  heroEyebrow: "Código abierto · Cloudflare nativo · Gestión del conocimiento",
  heroTitleLine1: "Cero servidores. Tuyo para siempre.",
  heroTitleLine2: "Un segundo cerebro nativo de IA que crece contigo.",
  heroSubtitle:
    "Mínimo, nunca superficial. Sereno, nunca estridente. Escribe con libertad en Cloudflare Edge: tus notas se convierten en tareas, artículos y una base de conocimiento, además de una memoria a largo plazo compartida por tus agentes de IA.",
  primaryCta: "Guía de despliegue",
  secondaryCta: "Código en GitHub",
  statMemos: "~2,5 millones de notas",
  statPhotos: "10.000 fotos comprimidas · 0$ tráfico",
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
        "Publica notas para tu equipo, comenta debajo de ellas y menciónense con @: para compartir, no para gestionar proyectos. Roles de Propietario, Administrador, Miembro y Lector con 3 niveles de visibilidad (privado, equipo, público); al salir un miembro, sus datos privados se borran de forma segura.",
    },
    {
      title: "Tus datos, siempre tuyos",
      description:
        "Exporta notas, tareas, artículos y adjuntos en un solo paquete; la importación admite estrategias de conflicto y revierte limpiamente si algo falla.",
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
      a: "Las notas viven en la infraestructura distribuida de Cloudflare, con réplica en varias regiones. FlareMo también puede exportarlo todo —notas, tareas, artículos y adjuntos— en un paquete para archivar sin conexión, así siempre conservas una segunda copia.",
    },
    {
      q: "¿Puedo migrar mis notas existentes?",
      a: "Sí. Un conversor incluido transforma la exportación de otra herramienta en un paquete de importación de FlareMo, conservando fechas, etiquetas, fijados y visibilidad. Límites conocidos: los comentarios pasan a ser registros independientes y los adjuntos enlazados externamente no se migran.",
    },
    {
      q: "¿Puedo conectar mis propios scripts y herramientas?",
      a: "Sí. Una API abierta con tokens personales revocables cubre la automatización; para IA, el CLI y el endpoint MCP integrados leen y escriben la misma Agent Memory. El alcance exacto está en la matriz de compatibilidad.",
    },
    {
      q: "¿Qué diferencia hay entre modo personal y equipo?",
      a: "Por defecto es un diario personal cifrado. Al activar el modo de equipo, invitas a colegas con enlaces de un solo uso; cada nota puede ser privada (solo tú), visible para el equipo (lectura y comentarios) o pública.",
    },
  ],
  ctaBadge: "Empieza ahora",
  ctaHeading: "Cinco minutos para desplegar. Tuyo para siempre.",
  ctaSubtitle:
    "Sin servidores, sin tarjeta de crédito. Despliega en Cloudflare en 5 minutos.",
  ctaButton: "Ver guía de despliegue en 5 minutos",
};
