import type { HomeContent } from "../copy";

export const EN_HOME: HomeContent = {
  heroEyebrow: "Open-source · Cloudflare-native · Knowledge Management",
  heroTitleLine1: "Zero Servers. Forever Yours.",
  heroTitleLine2: "An AI-native second brain that grows with you.",
  heroSubtitle:
    "Minimal, never shallow. Quiet, never loud. Write freely on Cloudflare Edge — where notes grow into tasks, articles and a knowledge base, with MCP access for your AI agents.",
  primaryCta: "Read Deploy Guide",
  secondaryCta: "View on GitHub",
  statMemos: "~2.5M text notes",
  statPhotos: "~10,000 compressed photos · $0 egress",
  statServers: "300+ edge datacenters",
  statUptime: "Multi-region persistence & backup",
  featuresBadge: "Why FlareMo",
  featuresHeading: "Engineered for Focus and Longevity",
  featuresSubtitle:
    "Skip server maintenance. Build a second brain that stays on.",
  features: [
    {
      title: "Durable by default",
      description:
        "Notes live in your Cloudflare D1 database and R2 bucket, replicated across regions. Dead drives, power cuts, and server migrations won't touch your data.",
    },
    {
      title: "Free tier, no fine print",
      description:
        "Cloudflare's free tier includes 5GB on D1 (~2.5 million text notes) and 10GB on R2 (~10,000 photos). With zero egress fees on R2, sharing notes never triggers surprise bandwidth bills.",
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
      a: "More than enough. Cloudflare's free tier gives you 5GB on D1 (~2.5 million text notes) and 10GB on R2 (~10,000 compressed photos). Writing 100 notes a day would take 68 years to fill.",
    },
    {
      q: "How safe is my data?",
      a: "Notes live on Cloudflare's distributed infrastructure, replicated across regions. FlareMo can also export everything — notes, tasks, articles and attachments — into a single bundle you archive offline, for a second copy that's always yours.",
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
  ctaBadge: "Get Started",
  ctaHeading: "Five minutes to deploy. Yours for good.",
  ctaSubtitle:
    "No servers, no credit card required. Deploy on Cloudflare in 5 minutes.",
  ctaButton: "Open the Deploy Guide",
};
