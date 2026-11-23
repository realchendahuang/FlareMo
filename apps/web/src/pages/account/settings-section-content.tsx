import type { DataTaskDto } from "@flaremo/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { lazy, type ReactNode, Suspense } from "react";
import type {
  CloudflareUsageReport,
  CurrentFlareMoUser,
  VectorUsageReport,
} from "@/api";
import { Skeleton } from "@/components/ui/skeleton";
import type { TranslationKey, TranslationParams } from "@/i18n";
import { PluginsCard } from "../admin/plugins-card";
import { AdminPanel, BrandingCard } from "../admin-page";
import { AccountPanel, type AccountPanelProps } from "./account-panel";
import { AppearancePanel } from "./appearance-panel";
import { ConnectedAppsPanel } from "./connected-apps-panel";
import { EmailSettingsCard, OauthSettingsCard } from "./integrations-card";
import { PushPanel } from "./push-panel";
import type { SettingsSection } from "./settings-nav";
import { TransferPanel } from "./transfer-panel";
import { UploadsPanel } from "./uploads-panel";
import { UsagePanel } from "./usage-panel";

const VoicePanel = lazy(() =>
  import("./voice-panel").then((module) => ({
    default: module.VoicePanel,
  })),
);

function VoicePanelSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-4">
      <Skeleton className="h-12 w-full rounded-xl" />
      <Skeleton className="h-28 w-full rounded-xl" />
    </div>
  );
}

/** The role badge the shell's user headers render. Reuses the admin.role.*
 *  keys so every locale translates it the same way as the team page. */
export function roleLabel(
  role: CurrentFlareMoUser["role"] | undefined,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): string {
  if (role === "owner") return t("admin.role.owner");
  if (role === "admin") return t("admin.role.admin");
  if (role === "reader") return t("admin.role.reader");
  return t("admin.role.member");
}

type SettingsSectionContentProps = {
  accountPanel: AccountPanelProps;
  cfUsageQuery: UseQueryResult<CloudflareUsageReport, Error>;
  dataTasksQuery: UseQueryResult<{ tasks: DataTaskDto[] }, Error>;
  isInstanceOwner: boolean;
  isTeamAdmin: boolean;
  onCreateExport: () => void;
  onRetryExport: () => void;
  retryExportIsPending: boolean;
  section: SettingsSection;
  showVoiceSettings: boolean;
  t: (key: TranslationKey, params?: TranslationParams) => string;
  vectorUsageQuery: UseQueryResult<VectorUsageReport, Error>;
  voiceUserId: string | undefined;
};

/** The one node the shell's detail pane shows for the active section. */
export function SettingsSectionContent({
  accountPanel,
  cfUsageQuery,
  dataTasksQuery,
  isInstanceOwner,
  isTeamAdmin,
  onCreateExport,
  onRetryExport,
  retryExportIsPending,
  section,
  showVoiceSettings,
  t,
  vectorUsageQuery,
  voiceUserId,
}: SettingsSectionContentProps): ReactNode {
  switch (section) {
    case "account":
      return <AccountPanel {...accountPanel} />;
    case "appearance":
      return <AppearancePanel t={t} />;
    case "uploads":
      return <UploadsPanel />;
    case "push":
      return <PushPanel />;
    case "voice":
      return showVoiceSettings ? (
        <Suspense fallback={<VoicePanelSkeleton />}>
          <VoicePanel key={voiceUserId} />
        </Suspense>
      ) : null;
    case "usage":
      return (
        <UsagePanel
          t={t}
          vectorUsageQuery={vectorUsageQuery}
          cfUsageQuery={cfUsageQuery}
        />
      );
    case "transfer":
      return (
        <TransferPanel
          dataTasksQuery={dataTasksQuery}
          createExportIsPending={retryExportIsPending}
          retryExportIsPending={retryExportIsPending}
          t={t}
          onCreateExport={onCreateExport}
          onRetryExport={onRetryExport}
        />
      );
    case "team":
      return isTeamAdmin ? <AdminPanel /> : null;
    case "branding":
      return isInstanceOwner ? <BrandingCard /> : null;
    case "plugins":
      return isInstanceOwner ? <PluginsCard /> : null;
    case "integrations":
      return isInstanceOwner ? (
        <div className="flex flex-col gap-5">
          <EmailSettingsCard />
          <OauthSettingsCard />
        </div>
      ) : null;
    case "connectedApps":
      return <ConnectedAppsPanel />;
  }
}
