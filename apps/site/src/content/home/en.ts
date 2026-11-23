import type { HomeContent } from "../copy";

export const EN_HOME: HomeContent = {
  heroEyebrow: "Open-source · Cloudflare-native · Knowledge Management",
  heroTitleLine1: "Zero servers to run.",
  heroTitleLine2: "An AI-native second brain.",
  heroSubtitle:
    "Write on Cloudflare's edge and let notes grow into tasks, articles and a searchable knowledge base — the same notes your AI agents can read and write over MCP.",
  primaryCta: "Read Deploy Guide",
  secondaryCta: "View on GitHub",
  heroFacts: [
    { label: "D1 storage", value: "5 GB", detail: "~2.5M text notes" },
    { label: "R2 storage", value: "10 GB", detail: "~10k photos · $0 egress" },
    { label: "Edge network", value: "300+", detail: "locations, sub-100ms" },
    { label: "Time to deploy", value: "5 min", detail: "from clone to live" },
  ],
  featuresBadge: "Why FlareMo",
  featuresHeading: "Engineered for Focus and Longevity",
  featuresSubtitle:
    "Skip server maintenance. Build a second brain that stays on.",
  features: [
    {
      title: "Durable by default",
      description:
        "Notes live in your Cloudflare D1 database and R2 bucket, replicated across regions. A dead laptop or a migration doesn't take them with it.",
    },
    {
      title: "Free tier, clear limits",
      description:
        "Cloudflare's free tier includes 5GB on D1 (~2.5 million text notes) and 10GB on R2 (~10,000 photos). R2 charges no egress fees, so sharing stays free while you stay inside the quotas.",
    },
    {
      title: "Offline-First & PWA",
      description:
        "Installable PWA for iOS, Android, and desktop. Write offline on planes or subways. Drafts save locally as you type and sync in order once you're back online.",
    },
    {
      title: "AI Works on Your Notes",
      description:
        "A built-in Model Context Protocol (MCP) endpoint lets AI agents (Claude, Cursor, Codex) search, read and write your own notes. Nothing is auto-summarized into a separate memory store.",
    },
    {
      title: "A Team Space for Sharing",
      description:
        "Publish notes to your team, leave comments, and @mention teammates — lightweight sharing, not project management. Four roles (Owner, Admin, Member, Reader) and three visibility tiers (private, team, public); offboarding scrubs private data cleanly.",
    },
    {
      title: "Your Data, Always Yours",
      description:
        "Export every note, task, article and attachment in one bundle. On import, choose a conflict strategy; if something fails, it rolls back cleanly.",
    },
    {
      title: "Notes, To-dos & Projects",
      description:
        "Quick notes stay quick; long-form gets a full-screen canvas. Schedule a note for a day and its to-dos become tasks, synced both ways. See Today, Next 7 days, or a project board, with due-day reminders and optional Web Push.",
    },
  ],
  comparisonBadge: "Side-by-Side",
  comparisonHeading: "Three ways to self-host, side by side",
  comparisonSubtitle:
    "Comparing Cloudflare Serverless against home NAS and traditional VPS self-hosting",
  comparisonRows: [
    {
      label: "Data Location",
      cloudflare: "Cloudflare multi-region storage",
      nas: "Single or RAID drive in your home",
      vps: "Single cloud vendor virtual disk",
    },
    {
      label: "Hardware Failure",
      cloudflare: "Replicated across regions; no disk to replace",
      nas: "Drive crash or power surge risks total loss",
      vps: "Host outage or hypervisor crash risks loss",
    },
    {
      label: "Global Latency",
      cloudflare: "300+ edge locations, sub-100ms worldwide",
      nas: "Bound to home upload speeds & tunnels",
      vps: "Single datacenter region, high cross-border lag",
    },
    {
      label: "Daily Upkeep",
      cloudflare: "No OS patches, no Docker to babysit",
      nas: "OS updates, SMART drive health monitoring",
      vps: "Kernel updates, security patches, watchdogs",
    },
    {
      label: "SSL & Domains",
      cloudflare: "Automated HTTPS and custom domain binding",
      nas: "Manual certs, dynamic DNS & port forwarding",
      vps: "Nginx/Caddy maintenance & Let's Encrypt renewals",
    },
    {
      label: "Ongoing Cost",
      cloudflare: "$0 on the free tier (limits apply)",
      nas: "High upfront hardware costs + electricity",
      vps: "Continuous monthly / annual hosting invoices",
    },
  ],
  screenshotsHeading: "A look inside",
  screenshotsSubtitle:
    "Light, dark, and on your phone — real captures from the shipped app, not a mock.",
  faqHeading: "Frequently Asked Questions",
  faqItems: [
    {
      q: "Is the free tier really enough?",
      a: "At roughly 2 KB per note, 5 GB on D1 holds about 2.5 million text notes, and 10 GB on R2 holds about 10,000 compressed photos. The real ceiling depends on your content; most people never reach it.",
    },
    {
      q: "How safe is my data?",
      a: "Notes live on Cloudflare's distributed infrastructure, replicated across regions. FlareMo can also export everything — notes, tasks, articles and attachments — into a single bundle you archive offline, for a second copy you control.",
    },
    {
      q: "Can I bring my old notes over?",
      a: "Yes. A bundled converter turns another tool's export into a FlareMo import bundle, keeping timestamps, tags, pins and visibility. Known limits: comments become standalone records, and externally linked attachments are not migrated.",
    },
    {
      q: "Can I connect my own scripts and tools?",
      a: "Yes. Revocable Personal Access Tokens back the open API for your scripts. For AI workflows, the built-in `/mcp` endpoint exposes list, search, read, create, update and delete over your notes, and the `flaremo-notes` skill covers the usage rules.",
    },
    {
      q: "How does single-user differ from team mode?",
      a: "Out of the box, FlareMo is a quiet single-user sanctuary. Turn on team mode to invite teammates with one-time activation links, then set any note to private (personal only), team-visible (team members can read and discuss), or public.",
    },
  ],
  ctaHeading: "Five minutes to deploy. Yours to keep.",
  ctaSubtitle:
    "No servers, no credit card required. Deploy on Cloudflare in 5 minutes.",
  ctaButton: "Open the Deploy Guide",
};
