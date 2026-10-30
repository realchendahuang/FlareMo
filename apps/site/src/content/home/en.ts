import type { HomeContent } from "../copy";

export const EN_HOME: HomeContent = {
  heroEyebrow: "Open-source · Cloudflare Edge-native · Memos-compatible",
  heroTitleLine1: "Zero Servers. Forever Yours.",
  heroTitleLine2: "Your Second Brain on the Edge.",
  heroSubtitle:
    "Minimal, never shallow. Quiet, never loud. Knowledge management built natively on Cloudflare Edge (Workers, D1, R2). Zero VPS maintenance, full Memos API ecosystem support, and persistent MCP memory for your AI copilots.",
  primaryCta: "Read Deploy Guide",
  secondaryCta: "GitHub Source",
  statMemos: "~2.5M text memos",
  statPhotos: "~10,000 photos · $0 egress",
  statServers: "300+ edge datacenters",
  statUptime: "Multi-region persistence & backup",
  featuresBadge: "Why FlareMo",
  featuresHeading: "Engineered for Focus and Longevity",
  featuresSubtitle:
    "Leave heavy server maintenance behind and enjoy pure, reliable, AI-native knowledge management",
  features: [
    {
      title: "Durable by default",
      description:
        "Memos live in your Cloudflare D1 database and R2 bucket with multi-region persistence. Drive failure, power outages, and moving hardware won't touch your data.",
    },
    {
      title: "Free tier, no fine print",
      description:
        "Cloudflare's free tier provides 5GB D1 database (~2.5 million text memos) and 10GB R2 storage (~10,000 photos). R2 has $0 egress fees so sharing notes won't surprise you with bandwidth charges.",
    },
    {
      title: "Offline-First & PWA",
      description:
        "Installable PWA for iOS, Android, and desktop. Write seamlessly on planes or subways. Drafts save instantly locally and sync sequentially when connectivity returns.",
    },
    {
      title: "AI-Native Long-Term Memory",
      description:
        "Built-in Model Context Protocol (MCP) endpoint allows AI agents (Claude, Cursor, Codex) to read and update your preferences and memory scopes with full human auditability.",
    },
    {
      title: "A Team Space for Sharing",
      description:
        "Publish notes to your team, comment under them, and @mention each other — sharing, not project management. Owner, Admin, and Member roles with 3-tier visibility (private, team, public); safe offboarding deletes private data cleanly.",
    },
    {
      title: "Memos Compatible & Import/Export",
      description:
        "Full compatibility with Memos /api/v1 endpoints and OpenAPI. Direct integration with existing third-party clients like Moe Memos, plus one-click import and export.",
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
      cloudflare: "Cloudflare multi-region enterprise storage",
      nas: "Single or RAID drive in your home",
      vps: "Single cloud vendor virtual disk",
    },
    {
      label: "Hardware Failure",
      cloudflare: "Auto-replicated, zero hardware risk",
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
      cloudflare: "Zero: No OS patches, no Docker compose",
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
      cloudflare: "$0 / month on generous free tier",
      nas: "High upfront hardware costs + electricity",
      vps: "Continuous monthly / annual hosting invoices",
    },
  ],
  screenshotsHeading: "Polished Visual Experience",
  screenshotsSubtitle:
    "Light mode, dark immersion, and mobile responsive design. Everything is live and working.",
  faqBadge: "Good to Know",
  faqHeading: "Frequently Asked Questions",
  faqItems: [
    {
      q: "Is the free tier really enough?",
      a: "More than enough. Cloudflare's free tier provides 5GB D1 database (~2.5 million text memos) and 10GB R2 storage (~10,000 compressed photos). Writing 100 memos every day would take 68 years to fill.",
    },
    {
      q: "How safe is my data?",
      a: "Data is stored on Cloudflare's enterprise-grade distributed infrastructure with multi-region replication. FlareMo also supports one-click exports to standard Memos bundles for regular offline archiving.",
    },
    {
      q: "Can I migrate from Memos or flomo?",
      a: "Yes. FlareMo imports ZIP or JSON export bundles from Memos and flomo, preserving timestamps, tags, and content while allowing custom conflict resolution.",
    },
    {
      q: "Do third-party apps and scripts still work?",
      a: "Yes. FlareMo implements the Memos /api/v1 endpoint surface and personal access tokens (PAT). Popular iOS/Android clients like Moe Memos connect directly.",
    },
    {
      q: "How does single-user differ from team mode?",
      a: "By default, it is a quiet single-user sanctuary. When team mode is enabled, admins invite members via one-time activation links. Memos can be private, team-visible, or public.",
    },
  ],
  ctaBadge: "Get Started",
  ctaHeading: "Five minutes to deploy. Yours for good.",
  ctaSubtitle:
    "No servers, no credit card required. Deploy on Cloudflare in 5 minutes.",
  ctaButton: "Open the Deploy Guide",
};
