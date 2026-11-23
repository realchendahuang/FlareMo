/**
 * Security headers for the standalone, server-rendered public pages
 * (`/share/:token`, `/article/:slug`).
 *
 * These documents are zero-JS by design, so the policy can be strict: no
 * scripts, no connections, no framing. Inline styles stay allowed because the
 * whole stylesheet is embedded in a `<style>` element, and remote images stay
 * allowed so authors can reference external illustrations.
 */
export const PUBLIC_PAGE_SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'none'",
    "img-src 'self' data: https:",
    "media-src 'self' https:",
    "style-src 'unsafe-inline'",
    "font-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
  ].join("; "),
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
} as const;
