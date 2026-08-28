import type { FlareMoEnv } from "./env";

/**
 * Pluggable transactional email for registration verification.
 *
 * - `none` (default): self-hosted zero-config; registration does not require
 *   email verification.
 * - `cloudflare`: Cloudflare Email Sending (Workers Paid plan) via the
 *   `EMAIL` binding (`env.EMAIL.send({to, from, subject, html, text})`).
 *   The sender address must be a verified domain in the account.
 *
 * The seam mirrors the embedding/captcha provider pattern: the kernel never
 * hardcodes a vendor, and a deployment that does not configure a provider
 * keeps the exact self-hosted behavior.
 */

export type EmailProvider = "none" | "cloudflare";

export type EmailConfig = {
  provider: EmailProvider;
  /** Verified sender address, e.g. "no-reply@flaremo.app". */
  from: string | null;
};

export function resolveEmailConfig(env: FlareMoEnv): EmailConfig {
  const provider = (env.FLAREMO_EMAIL_PROVIDER?.trim() ||
    "none") as EmailProvider;
  if (provider === "cloudflare") {
    return {
      provider,
      from: env.FLAREMO_EMAIL_FROM?.trim() || null,
    };
  }
  return { provider: "none", from: null };
}

export type SendVerificationEmailInput = {
  to: string;
  /** Single-use verification token (already minted). */
  token: string;
  /** Public origin of the deployment, e.g. https://app.flaremo.app. */
  publicUrl: string;
};

/**
 * Send the registration verification email. Returns false when the provider
 * is not configured or the send fails — the caller decides whether that
 * blocks registration (provider configured) or is skipped (provider none).
 */
export async function sendVerificationEmail(
  env: FlareMoEnv,
  input: SendVerificationEmailInput,
): Promise<boolean> {
  const config = resolveEmailConfig(env);
  if (config.provider === "none" || !config.from) return false;

  const verifyUrl = `${input.publicUrl.replace(/\/+$/, "")}/verify-email?token=${encodeURIComponent(input.token)}`;
  const html = [
    '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">',
    '<h2 style="margin:0 0 12px">Verify your email</h2>',
    '<p style="color:#444;line-height:1.6">Welcome to FlareMo! Confirm this address to finish creating your account.</p>',
    `<p><a href="${verifyUrl}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Verify email</a></p>`,
    `<p style="color:#888;font-size:12px">Or paste this link: ${verifyUrl}</p>`,
    '<p style="color:#888;font-size:12px">This link expires in 24 hours. If you did not sign up, you can ignore this email.</p>',
    "</div>",
  ].join("");

  try {
    const binding = (
      env as FlareMoEnv & {
        EMAIL?: { send: (msg: unknown) => Promise<unknown> };
      }
    ).EMAIL;
    if (!binding) return false;
    await binding.send({
      to: input.to,
      from: config.from,
      subject: "Verify your FlareMo email",
      html,
      text: `Welcome to FlareMo! Confirm this address to finish creating your account.\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    });
    return true;
  } catch {
    return false;
  }
}
