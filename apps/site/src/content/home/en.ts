import type { HomeContent } from "../copy";

export const EN_HOME: HomeContent = {
  heroEyebrow: "Open-source · Cloudflare-native · Knowledge Management",
  heroTitleLine1: "Zero Servers. Forever Yours.",
  heroTitleLine2: "An AI-native second brain that grows with you.",
  heroSubtitle:
    "Minimal, never shallow. Quiet, never loud. An AI-native second brain on Cloudflare Edge: write it down, and let notes grow into tasks, articles and a knowledge base — plus a long-term memory your AI agents can read and write.",
  primaryCta: "Read Deploy Guide",
  secondaryCta: "GitHub Source",
  statMemos: "~2.5M text notes",
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
        "Notes live in your Cloudflare D1 database and R2 bucket with multi-region persistence. Drive failure, power outages, and moving hardware won't touch your data.",
    },
    {
      title: "Free tier, no fine print",
      description:
        "Cloudflare's free tier provides 5GB D1 database (~2.5 million text notes) and 10GB R2 storage (~10,000 photos). R2 has $0 egress fees so sharing notes won't surprise you with bandwidth charges.",
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
      title: "Your Data, Always Yours",
      description:
        "Export every note, task, article and attachment in one bundle; imports support conflict strategies and roll back cleanly when something fails.",
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
      a: "More than enough. Cloudflare's free tier provides 5GB D1 database (~2.5 million text notes) and 10GB R2 storage (~10,000 compressed photos). Writing 100 notes every day would take 68 years to fill.",
    },
    {
      q: "How safe is my data?",
      a: "Notes live on Cloudflare's distributed infrastructure with multi-region replication. FlareMo can also export everything — notes, tasks, articles and attachments — into a single bundle you archive offline, so you always keep a second copy.",
    },
    {
      q: "Can I bring my old notes over?",
      a: "Yes. A bundled converter turns another tool's export into a FlareMo import bundle, keeping timestamps, tags, pins and visibility. Known limits: comments become standalone records, and externally linked attachments are not migrated.",
    },
    {
      q: "Can I connect my own scripts and tools?",
      a: "Yes. An open API with revocable Personal Access Tokens covers automation; for AI workflows, the built-in CLI and MCP endpoint let clients read and write the same Agent Memory. The exact supported surface is documented in the compatibility matrix.",
    },
    {
      q: "How does single-user differ from team mode?",
      a: "By default, it is a quiet single-user sanctuary. When team mode is enabled, admins invite members via one-time activation links. Notes can be private, team-visible, or public.",
    },
  ],
  ctaBadge: "Get Started",
  ctaHeading: "Five minutes to deploy. Yours for good.",
  ctaSubtitle:
    "No servers, no credit card required. Deploy on Cloudflare in 5 minutes.",
  ctaButton: "Open the Deploy Guide",
};
