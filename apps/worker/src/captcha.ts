import { ForbiddenError } from "@flaremo/domain";
import type { FlareMoEnv } from "./env";

/**
 * Pluggable registration captcha. The kernel never hardcodes a vendor:
 * network-relevant capabilities must stay swappable per deployment (China
 * reachability rules out a one-size-fits-all choice), mirroring the
 * embedding-provider pattern.
 *
 * - `none` (default): self-hosted zero-config; no check.
 * - `tencent`: Tencent Cloud Captcha 2.0 (mainland-friendly). The browser
 *   widget issues ticket + randstr; the server verifies via signed
 *   DescribeCaptchaResult.
 * - `http`: generic escape hatch — the ticket is POSTed to
 *   FLAREMO_CAPTCHA_VERIFY_URL as JSON `{ticket, randstr, ip}` and any 2xx
 *   response whose body does not carry `success: false` counts as verified.
 *   Every other platform (Aliyun, GeeTest, Vaptcha, self-built) plugs in
 *   through this seam.
 *
 * Credentials: site key is a plain var (the browser needs it); the secret is
 * a Wrangler secret. All three self-registration paths (web register, Memos
 * current signup, Connect SignUp) enforce the same check; owner bootstrap and
 * admin-created members stay exempt.
 */

export type CaptchaProvider = "none" | "tencent" | "http";

export type CaptchaConfig = {
  provider: CaptchaProvider;
  /** Browser-facing key (Tencent CaptchaAppId). Null for none/http. */
  siteKey: string | null;
};

export function resolveCaptchaConfig(env: FlareMoEnv): CaptchaConfig {
  const provider = (env.FLAREMO_CAPTCHA_PROVIDER?.trim() ||
    "none") as CaptchaProvider;
  if (provider === "tencent") {
    return {
      provider,
      siteKey: env.FLAREMO_CAPTCHA_SITE_KEY?.trim() || null,
    };
  }
  if (provider === "http") {
    if (!env.FLAREMO_CAPTCHA_VERIFY_URL?.trim())
      return { provider: "none", siteKey: null };
    return { provider, siteKey: null };
  }
  return { provider: "none", siteKey: null };
}

function readCaptchaHeaders(request: Request): {
  ticket: string | null;
  randstr: string | null;
} {
  return {
    ticket: request.headers.get("x-flaremo-captcha-ticket")?.trim() || null,
    randstr: request.headers.get("x-flaremo-captcha-randstr")?.trim() || null,
  };
}

export async function verifyCaptchaRequest(
  env: FlareMoEnv,
  request: Request,
): Promise<void> {
  const config = resolveCaptchaConfig(env);
  if (config.provider === "none") return;

  const { ticket, randstr } = readCaptchaHeaders(request);
  if (!ticket) {
    throw new ForbiddenError("Captcha verification is required.");
  }

  const ip =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "";

  const verified =
    config.provider === "tencent"
      ? await verifyTencentCaptcha(env, {
          appSecretKey: env.FLAREMO_CAPTCHA_SECRET?.trim() || "",
          captchaAppId: config.siteKey || "",
          ticket,
          randstr: randstr || "",
          userIp: ip,
        })
      : await verifyHttpCaptcha(env, { ticket, randstr, ip });

  if (!verified) {
    throw new ForbiddenError("Captcha verification failed.");
  }
}

type TencentVerifyInput = {
  appSecretKey: string;
  captchaAppId: string;
  ticket: string;
  randstr: string;
  userIp: string;
};

/** Tencent Cloud TC3-HMAC-SHA256 signature for one request. */
async function tc3Signature(
  secretId: string,
  secretKey: string,
  timestamp: number,
  payload: string,
): Promise<{ authorization: string; date: string }> {
  const encoder = new TextEncoder();
  const hex = (buffer: ArrayBuffer) =>
    [...new Uint8Array(buffer)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const hashedPayload = hex(
    await crypto.subtle.digest("SHA-256", encoder.encode(payload)),
  );
  const canonicalRequest = `POST\n/\n\ncontent-type:application/json; charset=utf-8\nhost:captcha.tencentcloudapi.com\n\ncontent-type;host\n${hashedPayload}`;
  const hashedCanonical = hex(
    await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest)),
  );
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${date}/captcha/tc3_request\n${hashedCanonical}`;

  const key = async (material: Uint8Array | ArrayBuffer, message: string) => {
    // TypedArray views are themselves BufferSource; wrapping avoids the
    // SharedArrayBuffer-inclusive type of ArrayBuffer.slice().
    const raw = (
      material instanceof Uint8Array ? material : new Uint8Array(material)
    ) as BufferSource;
    const imported = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return crypto.subtle.sign("HMAC", imported, encoder.encode(message));
  };

  const secretDate = await key(encoder.encode(`TC3${secretKey}`), date);
  const secretService = await key(secretDate, "captcha");
  const secretSigning = await key(secretService, "tc3_request");
  const signature = hex(await key(secretSigning, stringToSign));

  return {
    authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${date}/captcha/tc3_request, SignedHeaders=content-type;host, Signature=${signature}`,
    date,
  };
}

async function verifyTencentCaptcha(
  env: FlareMoEnv,
  input: TencentVerifyInput,
): Promise<boolean> {
  const secretId = env.FLAREMO_CAPTCHA_SECRET_ID?.trim();
  if (!secretId || !input.appSecretKey || !input.captchaAppId) {
    // Misconfigured provider: fail closed rather than skip the check.
    return false;
  }
  const payload = JSON.stringify({
    CaptchaType: 9,
    CaptchaAppId: Number.parseInt(input.captchaAppId, 10) || 0,
    AppSecretKey: input.appSecretKey,
    Ticket: input.ticket,
    Randstr: input.randstr,
    UserIp: input.userIp,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const { authorization } = await tc3Signature(
    secretId,
    input.appSecretKey,
    timestamp,
    payload,
  );
  try {
    const response = await fetch("https://captcha.tencentcloudapi.com", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        host: "captcha.tencentcloudapi.com",
        "x-tc-action": "DescribeCaptchaResult",
        "x-tc-version": "2019-07-22",
        "x-tc-timestamp": String(timestamp),
        authorization,
      },
      body: payload,
    });
    if (!response.ok) return false;
    const body = (await response.json()) as {
      Response?: { CaptchaCode?: number };
    };
    // CaptchaCode 1 = verified; anything else (ticket replay, expired,
    // mismatch) is a failure.
    return body.Response?.CaptchaCode === 1;
  } catch {
    return false;
  }
}

async function verifyHttpCaptcha(
  env: FlareMoEnv,
  input: { ticket: string; randstr: string | null; ip: string },
): Promise<boolean> {
  const verifyUrl = env.FLAREMO_CAPTCHA_VERIFY_URL?.trim();
  if (!verifyUrl) return false;
  try {
    const response = await fetch(verifyUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ticket: input.ticket,
        randstr: input.randstr,
        ip: input.ip,
      }),
    });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
    };
    return body.success !== false;
  } catch {
    return false;
  }
}
