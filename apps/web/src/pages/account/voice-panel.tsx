import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  deleteVoiceSettings,
  getVoiceSettings,
  saveVoiceSettings,
  testVoiceSettings,
  type VoiceSettings,
} from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n";

// Mounted only after a fresh, user-scoped administrator permission check succeeds.
export function VoicePanel() {
  const cache = useQueryClient();
  const { t } = useI18n();
  const mounted = useRef(false);
  const [config, setConfig] = useState<VoiceSettings | null>(null);
  const [provider, setProvider] = useState("tencent");
  const [model, setModel] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [fields, setFields] = useState({
    appId: "",
    secretId: "",
    secretKey: "",
    apiKey: "",
  });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    void getVoiceSettings()
      .then((value) => {
        if (!active) return;
        setConfig(value);
        setProvider(value.provider ?? "tencent");
        setModel(value.model);
        setEnabled(value.enabled);
      })
      .catch(() => {
        if (active) setMessage(t("voiceSettings.loadError"));
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [t]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      if (!mounted.current) return;
      setFields({ appId: "", secretId: "", secretKey: "", apiKey: "" });
      const value = await getVoiceSettings();
      if (!mounted.current) return;
      setConfig(value);
      setEnabled(value.enabled);
      setProvider(value.provider ?? "tencent");
      setModel(value.model);
      await cache.invalidateQueries({ queryKey: ["capture-status"] });
      setMessage(success);
    } catch {
      if (!mounted.current) return;
      setMessage(t("voiceSettings.error"));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("voiceSettings.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>
          {t("voiceSettings.description")} {t("voiceSettings.migration")}
        </p>
        {config && (
          <>
            <p>
              {config.configured
                ? t("voiceSettings.configured")
                : t("voiceSettings.unconfigured")}
            </p>
            {!config.canStore && <p>{t("voiceSettings.masterKey")}</p>}
            {config.unreadable && <p>{t("voiceSettings.unreadable")}</p>}
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  () =>
                    saveVoiceSettings({
                      revision: config.revision,
                      enabled,
                      credentials: { provider, model, ...fields },
                    }),
                  t("voiceSettings.saved"),
                );
              }}
            >
              <label className="block">
                {t("voiceSettings.provider")}
                <select
                  className="block w-full rounded border border-input bg-background p-2 text-foreground [color-scheme:light_dark]"
                  value={provider}
                  disabled={busy || !config.canStore}
                  onChange={(event) => {
                    setProvider(event.target.value);
                    setModel("");
                    setFields({
                      appId: "",
                      secretId: "",
                      secretKey: "",
                      apiKey: "",
                    });
                  }}
                >
                  <option
                    className="bg-background text-foreground"
                    value="tencent"
                  >
                    {t("voiceSettings.tencent")}
                  </option>
                  <option
                    className="bg-background text-foreground"
                    value="dashscope"
                  >
                    DashScope
                  </option>
                </select>
              </label>
              <label className="block" htmlFor="voice-model">
                {t("voiceSettings.model")}
                <Input
                  id="voice-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  disabled={busy || !config.canStore}
                />
              </label>
              {(provider === "tencent"
                ? (["appId", "secretId", "secretKey"] as const)
                : (["apiKey"] as const)
              ).map((field) => (
                <label className="block" key={field} htmlFor={`voice-${field}`}>
                  {field}
                  <Input
                    id={`voice-${field}`}
                    type="password"
                    autoComplete="new-password"
                    value={fields[field]}
                    disabled={busy || !config.canStore}
                    onChange={(event) =>
                      setFields({ ...fields, [field]: event.target.value })
                    }
                  />
                </label>
              ))}
              <label className="flex gap-2">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={busy || !config.canStore}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                {t("voiceSettings.enabled")}
              </label>
              <Button
                type="submit"
                disabled={busy || !config.canStore || config.unreadable}
              >
                {t("voiceSettings.save")}
              </Button>
            </form>
            <p className="text-sm text-muted-foreground">
              {t("voiceSettings.testWarning")}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || !config.enabled || !config.configured}
                onClick={() =>
                  void run(testVoiceSettings, t("voiceSettings.testSuccess"))
                }
              >
                {t("voiceSettings.test")}
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t("voiceSettings.confirmDelete")))
                    void run(
                      () => deleteVoiceSettings(config.revision),
                      t("voiceSettings.deleted"),
                    );
                }}
              >
                {t("voiceSettings.delete")}
              </Button>
            </div>
          </>
        )}
        <p role="status">{message}</p>
      </CardContent>
    </Card>
  );
}
