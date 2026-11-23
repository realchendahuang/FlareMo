import {
  forwardRef,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useI18n } from "@/i18n";

/**
 * Sandbox host for `kind: "sandbox"` plugin cards. The plugin's self-contained
 * HTML runs in an opaque-origin iframe (`allow-scripts`, no same-origin) with
 * an injected CSP that blocks every network channel. The host passes the card
 * data in over postMessage, and the injected bridge serializes the card back
 * to a PNG on export — the host never touches the iframe DOM and the plugin
 * can never touch the app.
 */

const BRIDGE_VERSION = 1;
const READY_TIMEOUT_MS = 8_000;
const EXPORT_TIMEOUT_MS = 10_000;
const MAX_EXPORT_CHARS = 16_000_000; // ≈12MB of PNG bytes as a data URL

const SANDBOX_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; script-src 'unsafe-inline'; media-src data:;";

/**
 * Injected before any plugin code. Provides `window.FlareMo` (postMessage
 * wrappers) plus the capture pipeline: clone the capture target, inline every
 * computed style, swap canvases for their bitmap, rasterize through an SVG
 * foreignObject, and return the PNG data URL. The host only relays messages.
 */
const BRIDGE_SCRIPT = `(function () {
  function post(message) {
    parent.postMessage(Object.assign({ __flaremo: 1, bridge: ${BRIDGE_VERSION} }, message), "*");
  }
  function inlineStyles(src, dst) {
    var computed = getComputedStyle(src);
    var css = "";
    for (var i = 0; i < computed.length; i += 1) {
      var prop = computed[i];
      var value = computed.getPropertyValue(prop);
      if (value) css += prop + ":" + value + ";";
    }
    dst.setAttribute("style", css);
    return css;
  }
  function capture(scale, target) {
    return new Promise(function (resolve, reject) {
      try {
        var width = Math.ceil(target.offsetWidth || target.scrollWidth || 0);
        var height = Math.ceil(target.scrollHeight || target.offsetHeight || 0);
        if (!width || !height) { reject(new Error("empty capture target")); return; }
        var clone = target.cloneNode(true);
        var srcNodes = [target].concat(Array.prototype.slice.call(target.querySelectorAll("*")));
        var dstNodes = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll("*")));
        for (var i = 0; i < srcNodes.length; i += 1) {
          var src = srcNodes[i];
          var dst = dstNodes[i];
          if (!dst || !dst.style || !src) continue;
          var css = inlineStyles(src, dst);
          if (src.tagName === "CANVAS" && dst.tagName === "CANVAS") {
            try {
              var img = document.createElement("img");
              img.setAttribute("src", src.toDataURL("image/png"));
              img.setAttribute("style", css);
              dst.parentNode.replaceChild(img, dst);
            } catch (err) { /* tainted canvas: keep the blank clone */ }
          }
        }
        clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        var serialized = new XMLSerializer().serializeToString(clone);
        var svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + width * scale +
          '" height="' + height * scale + '" viewBox="0 0 ' + width + " " + height +
          '"><foreignObject width="100%" height="100%">' + serialized + "</foreignObject></svg>";
        var image = new Image();
        image.onload = function () {
          var canvas = document.createElement("canvas");
          canvas.width = width * scale;
          canvas.height = height * scale;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(image, 0, 0, width * scale, height * scale);
          resolve(canvas.toDataURL("image/png"));
        };
        image.onerror = function () { reject(new Error("rasterize failed")); };
        image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      } catch (err) { reject(err); }
    });
  }
  window.FlareMo = {
    bridge: ${BRIDGE_VERSION},
    ready: function () { post({ type: "ready" }); },
    onUpdate: function (cb) { window.__flaremoOnUpdate = cb; },
    capture: function () {
      return capture(2, window.__flaremoCaptureTarget || document.body);
    }
  };
  window.addEventListener("message", function (event) {
    var msg = event.data;
    if (!msg || msg.__flaremo !== 1) return;
    if (msg.type === "init" || msg.type === "update") {
      try {
        if (typeof window.__flaremoOnUpdate === "function") {
          window.__flaremoOnUpdate(msg.payload || {});
        }
      } catch (err) {
        post({ type: "error", message: String((err && err.message) || err) });
      }
      var reportSize = function () {
        var target = window.__flaremoCaptureTarget || document.body;
        var h = Math.ceil(target.scrollHeight || target.offsetHeight || 0);
        if (h) {
          post({ type: "resize", height: h });
        }
      };
      if (msg.type === "init") {
        var announce = function () {
          reportSize();
          post({ type: "ready" });
        };
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(function () { setTimeout(announce, 0); }, announce);
        } else {
          setTimeout(announce, 0);
        }
      } else {
        setTimeout(reportSize, 0);
      }
    }
    if (msg.type === "export") {
      capture(msg.scale || 2, window.__flaremoCaptureTarget || document.body)
        .then(function (png) { post({ type: "exported", requestId: msg.requestId, png: png }); })
        .catch(function (err) {
          post({ type: "export-error", requestId: msg.requestId, message: String((err && err.message) || err) });
        });
    }
  });
})();`;

export function buildSandboxSrcdoc(html: string, locale = "en-US"): string {
  // The frame is opaque-origin, so plugin cards cannot reach the app's font
  // tokens; their Han glyphs come from the browser's own fallback, which is
  // disambiguated by the document language. Stamping lang/dir here is what
  // keeps a Japanese user's exported card out of Chinese glyph forms, and it
  // works even when the plugin omits <html> (the parser creates one).
  const dir = locale === "ar" ? "rtl" : "ltr";
  const boot = `document.documentElement.lang=${JSON.stringify(locale)};document.documentElement.dir=${JSON.stringify(dir)};`;
  const injection = `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><script>${boot}${BRIDGE_SCRIPT}</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${injection}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(
      /<html[^>]*>/i,
      (match) => `${match}<head>${injection}</head>`,
    );
  }
  return `<head>${injection}</head>${html}`;
}

export type SandboxPayload = {
  data: {
    body: string;
    date: string;
    day: string;
    stats: string;
    locale: string;
    brand: {
      product: string;
      markLight: string | null;
      markDark: string | null;
    };
  };
  options: Record<string, string | number | boolean>;
  mode: "light" | "dark";
};

export type ShareCardSandboxHandle = {
  exportPng: () => Promise<string | null>;
};

type Props = {
  html: string;
  width: number;
  height: number;
  payload: SandboxPayload;
  onReadyChange?: (ready: boolean) => void;
  onError?: (message: string) => void;
};

export const ShareCardSandboxHost = forwardRef<ShareCardSandboxHandle, Props>(
  function ShareCardSandboxHost(
    { html, width, height, payload, onReadyChange, onError },
    ref: Ref<ShareCardSandboxHandle>,
  ) {
    const { t } = useI18n();
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const readyRef = useRef(false);
    const exportResolver = useRef<
      ((value: { ok: boolean; png?: string; error?: string }) => void) | null
    >(null);
    const requestIdRef = useRef(0);
    const [ready, setReady] = useState(false);
    const [contentHeight, setContentHeight] = useState<number | null>(null);
    const locale = payload.data.locale;
    const srcdoc = useMemo(
      () => buildSandboxSrcdoc(html, locale),
      [html, locale],
    );

    // Keep the latest callbacks without re-running the message-listener effect
    // (which would reset the ready latch and restart the init loop).
    const onErrorRef = useRef(onError);
    const onReadyChangeRef = useRef(onReadyChange);
    useEffect(() => {
      onErrorRef.current = onError;
      onReadyChangeRef.current = onReadyChange;
    });

    useEffect(() => {
      readyRef.current = false;
      setReady(false);
      const frame = iframeRef.current;
      if (!frame) return undefined;
      const timeout = window.setTimeout(() => {
        if (!readyRef.current) {
          onErrorRef.current?.("Plugin did not finish loading in time.");
        }
      }, READY_TIMEOUT_MS);

      const handleMessage = (event: MessageEvent) => {
        // Opaque-origin frames report origin "null"; identity check is the source.
        if (event.source !== frame.contentWindow) return;
        const message = event.data as {
          __flaremo?: number;
          type?: string;
          png?: string;
          requestId?: number;
          message?: string;
          height?: number;
        } | null;
        if (message?.__flaremo !== 1) return;
        if (message.type === "ready" && !readyRef.current) {
          readyRef.current = true;
          window.clearTimeout(timeout);
          setReady(true);
          onReadyChangeRef.current?.(true);
        }
        if (message.type === "resize" && typeof message.height === "number") {
          setContentHeight(message.height);
        }
        if (message.type === "exported" || message.type === "export-error") {
          const resolve = exportResolver.current;
          exportResolver.current = null;
          if (message.type === "exported") {
            const png = message.png ?? "";
            if (!png || png.length > MAX_EXPORT_CHARS) {
              resolve?.({
                ok: false,
                error: "Export result is missing or too large.",
              });
            } else {
              resolve?.({ ok: true, png });
            }
          } else {
            resolve?.({
              ok: false,
              error: message.message ?? "Plugin export failed.",
            });
          }
        }
        if (message.type === "error") {
          onErrorRef.current?.(message.message ?? "Plugin error.");
        }
      };
      window.addEventListener("message", handleMessage);
      return () => {
        window.clearTimeout(timeout);
        window.removeEventListener("message", handleMessage);
        exportResolver.current = null;
      };
    }, []);

    // The initial payload must wait for the frame; updates can go straight out.
    // Re-post init until the plugin reports ready: srcdoc parsing is async and a
    // single post can race the bridge script.
    useEffect(() => {
      const frame = iframeRef.current;
      if (!frame) return undefined;
      const send = (type: "init" | "update") => {
        frame.contentWindow?.postMessage({ __flaremo: 1, type, payload }, "*");
      };
      send(ready ? "update" : "init");
      if (ready) return undefined;
      const interval = window.setInterval(() => {
        if (readyRef.current) {
          window.clearInterval(interval);
          return;
        }
        send("init");
      }, 500);
      const stop = window.setTimeout(
        () => window.clearInterval(interval),
        READY_TIMEOUT_MS,
      );
      return () => {
        window.clearInterval(interval);
        window.clearTimeout(stop);
      };
    }, [payload, ready]);

    useImperativeHandle(
      ref,
      () => ({
        exportPng: () =>
          new Promise<string | null>((resolve) => {
            const frame = iframeRef.current;
            if (!frame?.contentWindow || !readyRef.current) {
              resolve(null);
              return;
            }
            const requestId = ++requestIdRef.current;
            const timeout = window.setTimeout(() => {
              exportResolver.current = null;
              resolve(null);
            }, EXPORT_TIMEOUT_MS);
            exportResolver.current = (result) => {
              window.clearTimeout(timeout);
              resolve(result.ok ? (result.png ?? null) : null);
            };
            frame.contentWindow.postMessage(
              { __flaremo: 1, type: "export", requestId, scale: 2 },
              "*",
            );
          }),
      }),
      [],
    );

    return (
      <iframe
        className="block border-0"
        ref={iframeRef}
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        style={{
          width,
          height: contentHeight ? Math.max(height, contentHeight) : height,
        }}
        title={t("share.sandboxFrameTitle")}
      />
    );
  },
);
