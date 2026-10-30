import {
  AtSignIcon,
  CameraIcon,
  RefreshCcwIcon,
  RotateCcwIcon,
  UploadIcon,
  UserRoundIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { InfoTip } from "@/components/info-tip";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { TranslationKey, TranslationParams } from "@/i18n";
import { formatDate } from "@/lib/date-format";
import { prepareAvatarFile } from "@/lib/upload-compression";
import { cn } from "@/lib/utils";
import {
  CUTE_AVATAR_PRESETS,
  useCloseOnSuccess,
} from "./account-panel-presets";
import { SettingsRow } from "./apple-settings-ui";

/**
 * The account group's avatar, display name and username rows plus their three
 * edit dialogs. It renders only the rows and the (portalled) dialogs — the
 * surrounding `SettingsSectionGroup` stays in the panel, so the group's single
 * card still holds every account row.
 */
type AccountProfileSectionProps = {
  currentAvatarUrl?: string | null;
  currentName?: string;
  name: string;
  nameError: string | null;
  setName: (value: string) => void;
  onNameSubmit: () => Promise<void>;
  updateNameIsPending: boolean;

  avatarError: string | null;
  avatarIsPending: boolean;
  onAvatarUpload: (file: File) => Promise<void>;
  onAvatarUrlSubmit: (url: string) => Promise<void>;
  onAvatarDelete: () => Promise<void>;

  currentUsername: string;
  accountError: string | null;
  updateUsernameIsPending: boolean;
  readerExpiry?: string | null;
  setUsername: (value: string) => void;
  username: string;
  onUsernameSubmit: () => Promise<void>;

  t: (key: TranslationKey, params?: TranslationParams) => string;
};

export function AccountProfileSection({
  currentAvatarUrl,
  currentName,
  name,
  nameError,
  setName,
  onNameSubmit,
  updateNameIsPending,

  avatarError,
  avatarIsPending,
  onAvatarUpload,
  onAvatarUrlSubmit,
  onAvatarDelete,

  currentUsername,
  accountError,
  updateUsernameIsPending,
  readerExpiry,
  setUsername,
  username,
  onUsernameSubmit,

  t,
}: AccountProfileSectionProps) {
  // Dialog visibility states
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [usernameOpen, setUsernameOpen] = useState(false);

  const [avatarInputUrl, setAvatarInputUrl] = useState("");
  const [presetSeed, setPresetSeed] = useState("");
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto-close dialogs on mutation success
  useCloseOnSuccess(avatarIsPending, avatarError !== null, () => {
    setAvatarOpen(false);
    setAvatarInputUrl("");
    setPresetSeed("");
  });
  useCloseOnSuccess(updateNameIsPending, nameError !== null, () =>
    setNameOpen(false),
  );
  useCloseOnSuccess(updateUsernameIsPending, accountError !== null, () =>
    setUsernameOpen(false),
  );

  const expiryDate = readerExpiry ? new Date(readerExpiry) : null;
  const expiryLabel =
    expiryDate && readerExpiry && !Number.isNaN(expiryDate.getTime())
      ? formatDate(readerExpiry)
      : null;

  return (
    <>
      <SettingsRow
        icon={CameraIcon}
        label={t("auth.avatar")}
        value={
          <Avatar
            className="size-7 shrink-0"
            name={currentName || currentUsername}
            size="sm"
            src={currentAvatarUrl}
          />
        }
        chevron
        onClick={() => {
          setAvatarInputUrl(currentAvatarUrl ?? "");
          setAvatarOpen(true);
        }}
      />
      <SettingsRow
        icon={UserRoundIcon}
        label={t("auth.nameTitle")}
        value={currentName || "—"}
        chevron
        onClick={() => {
          setName(currentName ?? "");
          setNameOpen(true);
        }}
      />
      <SettingsRow
        icon={AtSignIcon}
        label={
          <div className="flex items-center gap-1.5">
            <span>{t("auth.usernameHandle")}</span>
            {expiryLabel && (
              <InfoTip text={t("account.readerUntil", { date: expiryLabel })} />
            )}
          </div>
        }
        value={currentUsername ? `@${currentUsername}` : "—"}
        chevron
        onClick={() => setUsernameOpen(true)}
      />

      {/* Avatar Edit Dialog */}
      <Dialog open={avatarOpen} onOpenChange={setAvatarOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("auth.changeAvatar")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-2">
            <Avatar
              className="size-24 text-3xl shadow-md ring-2 ring-border"
              name={currentName || currentUsername}
              size="xl"
              src={avatarInputUrl.trim() || currentAvatarUrl}
            />

            <input
              ref={avatarFileInputRef}
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              type="file"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  const prepared = await prepareAvatarFile(file);
                  await onAvatarUpload(prepared);
                } finally {
                  if (avatarFileInputRef.current) {
                    avatarFileInputRef.current.value = "";
                  }
                }
              }}
            />

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                disabled={avatarIsPending}
                size="sm"
                type="button"
                variant="outline"
                onClick={() => avatarFileInputRef.current?.click()}
              >
                {avatarIsPending ? (
                  <Spinner className="size-4" />
                ) : (
                  <UploadIcon className="size-4" />
                )}
                {t("auth.uploadAvatar")}
              </Button>
              {currentAvatarUrl && (
                <Button
                  disabled={avatarIsPending}
                  size="sm"
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setAvatarInputUrl("");
                    void onAvatarDelete();
                  }}
                >
                  <RotateCcwIcon className="size-4" />
                  {t("auth.removeAvatar")}
                </Button>
              )}
            </div>

            {/* Cute Avatar Presets */}
            <div className="flex w-full flex-col gap-2 pt-2 border-t">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("auth.avatarPresets")}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() =>
                    setPresetSeed(Math.random().toString(36).slice(2, 8))
                  }
                  type="button"
                >
                  <RefreshCcwIcon className="size-3" />
                  {t("auth.shufflePresets")}
                </Button>
              </div>

              <div className="grid grid-cols-6 gap-2">
                {CUTE_AVATAR_PRESETS.map((preset) => {
                  const seed = presetSeed || currentUsername || "user";
                  const url = preset.getUrl(seed);
                  const isSelected = avatarInputUrl === url;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.name}
                      onClick={() => setAvatarInputUrl(url)}
                      className={cn(
                        "group relative flex aspect-square items-center justify-center overflow-hidden rounded-full border-2 p-0.5 transition-all cursor-pointer hover:scale-105 active:scale-95 bg-muted/40",
                        isSelected
                          ? "border-primary ring-2 ring-primary/20 shadow-xs"
                          : "border-border/60 hover:border-border",
                      )}
                    >
                      <img
                        alt={preset.name}
                        className="size-full rounded-full object-cover"
                        loading="lazy"
                        src={url}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex w-full items-center gap-2 pt-2 border-t">
              <Input
                disabled={avatarIsPending}
                placeholder={t("auth.avatarUrl")}
                type="url"
                value={avatarInputUrl}
                onChange={(e) => setAvatarInputUrl(e.target.value)}
              />
              <Button
                disabled={avatarIsPending || !avatarInputUrl.trim()}
                size="sm"
                type="button"
                onClick={() => void onAvatarUrlSubmit(avatarInputUrl.trim())}
              >
                {t("common.save")}
              </Button>
            </div>

            {avatarError && (
              <p className="w-full rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {avatarError}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Name Edit Dialog */}
      <Dialog open={nameOpen} onOpenChange={setNameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("auth.nameTitle")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void onNameSubmit();
            }}
          >
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="account-name"
            >
              {t("auth.displayName")}
              <Input
                autoComplete="name"
                disabled={updateNameIsPending}
                id="account-name"
                maxLength={100}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            {nameError && <Alert variant="destructive">{nameError}</Alert>}
            <DialogFooter className="mt-2">
              <Button
                disabled={updateNameIsPending}
                type="button"
                variant="outline"
                onClick={() => setNameOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={updateNameIsPending} type="submit">
                {updateNameIsPending ? t("auth.saving") : t("auth.saveName")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Username Edit Dialog */}
      <Dialog open={usernameOpen} onOpenChange={setUsernameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("auth.profileTitle")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void onUsernameSubmit();
            }}
          >
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="account-username"
            >
              {t("auth.usernameHandle")}
              <div className="relative flex items-center">
                <span className="absolute left-3 text-muted-foreground text-sm font-medium select-none pointer-events-none">
                  @
                </span>
                <Input
                  autoCapitalize="none"
                  autoComplete="username"
                  className="pl-7"
                  disabled={updateUsernameIsPending}
                  id="account-username"
                  maxLength={30}
                  minLength={3}
                  pattern="[A-Za-z0-9_]+"
                  required
                  value={username.replace(/^@/, "")}
                  onChange={(event) =>
                    setUsername(event.target.value.replace(/^@/, ""))
                  }
                />
              </div>
            </label>
            {accountError && (
              <Alert variant="destructive">{accountError}</Alert>
            )}
            <DialogFooter className="mt-2">
              <Button
                disabled={updateUsernameIsPending}
                type="button"
                variant="outline"
                onClick={() => setUsernameOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button disabled={updateUsernameIsPending} type="submit">
                {updateUsernameIsPending
                  ? t("auth.saving")
                  : t("auth.saveUsername")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
