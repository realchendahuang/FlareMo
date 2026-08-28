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

type DeliverEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Deliver a transactional email through the configured provider. Returns
 * false when no provider is configured or the send fails; the caller decides
 * whether that blocks the flow.
 */
async function deliverEmail(
  env: FlareMoEnv,
  input: DeliverEmailInput,
): Promise<boolean> {
  const config = resolveEmailConfig(env);
  if (config.provider === "none" || !config.from) return false;

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
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return true;
  } catch {
    return false;
  }
}

function actionButtonHtml(url: string, label: string) {
  return `<p><a href="${url}" style="display:inline-block;background:#f97316;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">${label}</a></p>`;
}

function footerHtml(url: string, expiryHours: number, ignoreNote: string) {
  return [
    `<p style="color:#888;font-size:12px">Or paste this link: ${url}</p>`,
    `<p style="color:#888;font-size:12px">This link expires in ${expiryHours} hours. ${ignoreNote}</p>`,
  ].join("");
}

/**
 * Send the registration verification email.
 */
export async function sendVerificationEmail(
  env: FlareMoEnv,
  input: SendVerificationEmailInput,
): Promise<boolean> {
  const verifyUrl = `${input.publicUrl.replace(/\/+$/, "")}/verify-email?token=${encodeURIComponent(input.token)}`;
  return deliverEmail(env, {
    to: input.to,
    subject: "Verify your FlareMo email",
    html: [
      '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">',
      '<h2 style="margin:0 0 12px">Verify your email</h2>',
      '<p style="color:#444;line-height:1.6">Welcome to FlareMo! Confirm this address to finish creating your account.</p>',
      actionButtonHtml(verifyUrl, "Verify email"),
      footerHtml(
        verifyUrl,
        24,
        "If you did not sign up, you can ignore this email.",
      ),
      "</div>",
    ].join(""),
    text: `Welcome to FlareMo! Confirm this address to finish creating your account.\n\n${verifyUrl}\n\nThis link expires in 24 hours.`,
  });
}

/**
 * Send the self-service password reset email. The link opens the existing
 * /reset page, which submits the token to Better Auth's reset-password
 * endpoint; the recipient always sets their own new password.
 */
export async function sendPasswordResetEmail(
  env: FlareMoEnv,
  input: SendVerificationEmailInput,
): Promise<boolean> {
  const resetUrl = `${input.publicUrl.replace(/\/+$/, "")}/reset?token=${encodeURIComponent(input.token)}`;
  return deliverEmail(env, {
    to: input.to,
    subject: "Reset your FlareMo password",
    html: [
      '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">',
      '<h2 style="margin:0 0 12px">Reset your password</h2>',
      '<p style="color:#444;line-height:1.6">We received a request to reset the FlareMo password for this address. Click below to choose a new one.</p>',
      actionButtonHtml(resetUrl, "Reset password"),
      footerHtml(
        resetUrl,
        1,
        "If you did not request this, you can ignore this email and your password stays unchanged.",
      ),
      "</div>",
    ].join(""),
    text: `We received a request to reset the FlareMo password for this address.\n\n${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`,
  });
}

/**
 * Send the "verify your new email address" mail for an email change. The
 * change only takes effect after the recipient confirms ownership of the new
 * address through this link.
 */
export async function sendEmailChangeVerificationEmail(
  env: FlareMoEnv,
  input: SendVerificationEmailInput,
): Promise<boolean> {
  const verifyUrl = `${input.publicUrl.replace(/\/+$/, "")}/verify-email-change?token=${encodeURIComponent(input.token)}`;
  return deliverEmail(env, {
    to: input.to,
    subject: "Confirm your new FlareMo email",
    html: [
      '<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px">',
      '<h2 style="margin:0 0 12px">Confirm your new email</h2>',
      '<p style="color:#444;line-height:1.6">A request was made to use this address as your FlareMo login email. Confirm it to finish the change.</p>',
      actionButtonHtml(verifyUrl, "Confirm new email"),
      footerHtml(
        verifyUrl,
        24,
        "Your current email keeps working until you confirm. If this was not you, ignore this email.",
      ),
      "</div>",
    ].join(""),
    text: `A request was made to use this address as your FlareMo login email.\n\n${verifyUrl}\n\nThis link expires in 24 hours. Your current email keeps working until you confirm.`,
  });
}
