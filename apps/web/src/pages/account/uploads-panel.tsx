import { AudioLinesIcon, ImageIcon } from "lucide-react";
import { useState } from "react";
import { InfoTip } from "@/components/info-tip";
import {
  SettingsRow,
  SettingsSectionGroup,
} from "@/components/settings-section";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";
import {
  getAudioCompressionEnabled,
  getImageCompressionEnabled,
  setAudioCompressionEnabled,
  setImageCompressionEnabled,
} from "@/lib/upload-settings";

export function UploadsPanel() {
  const { t } = useI18n();
  const [imageCompression, setImageCompressionState] = useState(
    getImageCompressionEnabled(),
  );
  const [audioCompression, setAudioCompressionState] = useState(
    getAudioCompressionEnabled(),
  );

  return (
    <div className="flex flex-col gap-5">
      <SettingsSectionGroup>
        <SettingsRow
          icon={ImageIcon}
          label={
            <div className="flex items-center gap-1.5">
              <span>{t("uploads.imageCompression")}</span>
              <InfoTip text={t("uploads.imageCompressionDescription")} />
            </div>
          }
          action={
            <Switch
              checked={imageCompression}
              onCheckedChange={(checked) => {
                setImageCompressionState(checked);
                setImageCompressionEnabled(checked);
              }}
            />
          }
        />
        <SettingsRow
          icon={AudioLinesIcon}
          label={
            <div className="flex items-center gap-1.5">
              <span>{t("uploads.audioCompression")}</span>
              <InfoTip text={t("uploads.audioCompressionDescription")} />
            </div>
          }
          action={
            <Switch
              checked={audioCompression}
              onCheckedChange={(checked) => {
                setAudioCompressionState(checked);
                setAudioCompressionEnabled(checked);
              }}
            />
          }
        />
      </SettingsSectionGroup>
    </div>
  );
}
