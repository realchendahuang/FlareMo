import type { ShowcaseContent } from "../showcase-i18n";

export const EN_SHOWCASE: ShowcaseContent = {
  memo1: {
    title: "Reading Notes: Attention and Synthesis",
    content:
      "The more fragmented the information, the more we need quiet space for synthesis. Capture raw observations early, and patterns gradually emerge.",
    quote: "Learning isn't hoarding answers—it's asking better questions.",
    tags: ["ideas", "reading"],
    time: "21m ago",
  },
  memo2: {
    title: "Turning Capture into the Start of Thought",
    content:
      "Thought during a walk: great tools eliminate friction between thinking and writing. Instant launch, instant search.\n• Keep a clear mainline\n• Tag key sparks\n• Weekly synthesis ritual",
    tags: ["thinking", "product"],
    time: "1h ago",
  },
  presets: [
    {
      text: "Drafted idempotent edge sync protocol while waiting at airport gate #architecture #ideas",
      title: "Edge Sub-Second Sync Design",
      quote:
        "Local SQLite persistence first, monotonic timestamp replication on reconnect.",
      tag: "architecture",
    },
    {
      text: "Offline PWA keeps cognitive flow unbroken during flight #ideas",
      title: "Offline-First Mobile Experience",
      quote:
        "Subway or air transit without connectivity never interrupts writing flow.",
      tag: "ideas",
    },
    {
      text: "Connected Telegram voice memo bot for hands-free thought capture #life",
      title: "Instant Audio Capture Pipeline",
      quote:
        "Voice memos automatically transcribed and structured into knowledge entries in seconds.",
      tag: "life",
    },
  ],
  ui: {
    statsRecords: "Memos",
    statsTags: "Tags",
    statsDays: "Days",
    trend: "Trend",
    calendar: "Calendar",
    timeline: "Timeline",
    archive: "Archive",
    trash: "Trash",
    dailyReview: "Daily Review",
    randomWalk: "Random Walk",
    memory: "Memory",
    calendarView: "Schedule",
    projects: "To-dos",
    tagIndex: "Tags",
    searchPlaceholder: "Search records...",
    composerPlaceholder: "What's on your mind? Capture it...",
    send: "Send",
    justNow: "just now",
    clearFilter: "✕ All",
    recordPrefix: "Memo",
    months: ["Jun", "Jul", "Aug", "Sep"],
    tags: [
      { name: "product", count: 22 },
      { name: "thinking", count: 22 },
      { name: "ideas", count: 22 },
      { name: "life", count: 21 },
      { name: "plans", count: 21 },
      { name: "reading", count: 22 },
    ],
  },
};
