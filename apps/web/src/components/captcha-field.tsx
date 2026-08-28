import { useEffect, useRef, useState } from "react";
import type { TranslationKey } from "@/i18n";
import { useI18n } from "@/i18n";

/**
 * Dynamic captcha host for the register form. Renders nothing for provider
 * `none`; for `tencent` it lazy-loads the Tencent Captcha script once, shows
 * the floating widget, and reports the issued ticket via onVerify. The
 * generic `http` provider is not widget-capable yet — the register form
 * blocks submission until a ticket header is present, so operator-side
 * integrations can inject their own widget through the same seam.
 */
export function CaptchaField({
  provider,
  siteKey,
  onTicket,
  disabled,
}: {
  provider: "none" | "tencent" | "http";
  siteKey: string | null;
  onTicket: (ticket: string, randstr: string) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const [verifying, setVerifying] = useState(false);
  const [failed, setFailed] = useState(false);
  const callbackRef = useRef(onTicket);
  callbackRef.current = onTicket;

  useEffect(() => {
    if (provider !== "tencent" || !siteKey) return;
    setFailed(false);
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-flaremo-captcha]",
    );
    const load = () => {
      const win = window as unknown as {
        TencentCaptcha?: (appId: string, cb: (res: unknown) => void) => void;
      };
      if (!win.TencentCaptcha) return;
      win.TencentCaptcha(String(siteKey), (result) => {
        const res = result as {
          ret?: number;
          ticket?: string;
          randstr?: string;
        };
        if (res.ret === 0 && res.ticket) {
          setFailed(false);
          callbackRef.current(res.ticket, res.randstr ?? "");
        } else {
          setFailed(true);
        }
      });
    };
    if (existing) {
      existing.addEventListener("load", load);
      return () => existing.removeEventListener("load", load);
    }
    const script = document.createElement("script");
    script.dataset.flaremoCaptcha = "1";
    script.src = "https://ssl.captcha.qq.com/TCaptcha.js";
    script.async = true;
    script.addEventListener("load", load);
    document.head.appendChild(script);
    return () => script.removeEventListener("load", load);
  }, [provider, siteKey]);

  if (provider === "none") return null;

  return (
    <div className="flex flex-col gap-1.5">
      {provider === "tencent" ? (
        <button
          className="w-fit rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          disabled={disabled || verifying}
          onClick={() => {
            setVerifying(true);
            setFailed(false);
            // The Tencent widget shows itself; this button is the fallback
            // trigger for the load callback installed above.
            window.setTimeout(() => setVerifying(false), 600);
          }}
          type="button"
        >
          {verifying ? t("auth.captchaVerifying") : t("auth.captchaRequired")}
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">
          {t("auth.captchaRequired")}
        </p>
      )}
      {failed && (
        <p className="text-sm text-destructive">{t("auth.captchaFailed")}</p>
      )}
    </div>
  );
}

export function captchaButtonLabel(
  t: (key: TranslationKey) => string,
  provider: "none" | "tencent" | "http",
) {
  return provider === "none" ? null : t("auth.captchaRequired");
}
