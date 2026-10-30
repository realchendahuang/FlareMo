import type { UseQueryResult } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import type { CloudflareUsageReport, VectorUsageReport } from "@/api";
import { Skeleton } from "@/components/ui/skeleton";
import type { TranslationKey } from "@/i18n";
import { formatBytes } from "@/lib/utils";
import { SettingsRow, SettingsSectionGroup } from "./apple-settings-ui";

type UsagePanelProps = {
  t: (key: TranslationKey) => string;
  vectorUsageQuery: UseQueryResult<VectorUsageReport, Error>;
  cfUsageQuery: UseQueryResult<CloudflareUsageReport, Error>;
};

export function UsagePanel({
  t,
  vectorUsageQuery,
  cfUsageQuery,
}: UsagePanelProps) {
  return (
    <div className="flex flex-col gap-5">
      <SettingsSectionGroup
        title={t("usage.vectorTitle")}
        footer={
          <span className="flex items-start gap-1.5 pt-1 text-xs text-muted-foreground">
            <InfoIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>{t("usage.disclaimer")}</span>
          </span>
        }
      >
        {vectorUsageQuery.isLoading ? (
          <div className="p-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : vectorUsageQuery.isError || !vectorUsageQuery.data ? (
          <div className="p-4 text-sm text-muted-foreground">
            {t("usage.vectorUnavailable")}
          </div>
        ) : (
          <VectorUsageContent report={vectorUsageQuery.data} t={t} />
        )}
      </SettingsSectionGroup>
      {cfUsageQuery.data?.available &&
      (cfUsageQuery.data.workers ||
        cfUsageQuery.data.d1 ||
        cfUsageQuery.data.r2) ? (
        <SettingsSectionGroup
          title={t("usage.cfTitle")}
          footer={
            <span className="flex items-start gap-1.5 pt-1 text-xs text-muted-foreground">
              <InfoIcon
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0"
              />
              <span>{t("usage.cfDisclaimer")}</span>
            </span>
          }
        >
          <CloudflareUsageContent report={cfUsageQuery.data} t={t} />
        </SettingsSectionGroup>
      ) : null}
    </div>
  );
}

function VectorUsageContent({
  report,
  t,
}: {
  report: VectorUsageReport;
  t: (key: TranslationKey) => string;
}) {
  const totalStored = report.indexes.reduce(
    (sum, index) => sum + index.stored_dimensions,
    0,
  );
  const totalVectors = report.indexes.reduce(
    (sum, index) => sum + index.vectors_count,
    0,
  );

  return (
    <div className="flex flex-col divide-y divide-border/40">
      <SettingsRow label={t("usage.model")} value={report.model} />
      <SettingsRow
        label={t("usage.vectors")}
        value={`${totalVectors.toLocaleString()} (${report.dimensions} dim)`}
      />
      <div className="flex flex-col gap-4 px-3.5 py-4">
        <UsageBar
          hint={t("usage.storedHint")}
          label={t("usage.stored")}
          used={totalStored}
          limit={report.stored_limit}
        />
        <UsageBar
          label={t("usage.queried")}
          used={report.queried_dimensions_this_month}
          limit={report.queried_limit}
        />
        {report.plan && <PlanQuotaBars plan={report.plan} t={t} />}
      </div>
    </div>
  );
}

function CloudflareUsageContent({
  report,
  t,
}: {
  report: CloudflareUsageReport;
  t: (key: TranslationKey) => string;
}) {
  const locale = (value: number) => value.toLocaleString();
  return (
    <div className="flex flex-col divide-y divide-border/40">
      <SettingsRow
        label={t("usage.cfPeriod")}
        value={`${report.window.since.slice(0, 10)} ~ ${report.window.until.slice(0, 10)} (UTC)`}
      />
      {report.workers && (
        <SettingsRow
          label={t("usage.cfWorkerRequests")}
          value={report.workers.requests.toLocaleString()}
        />
      )}
      {report.d1 && (
        <>
          <SettingsRow
            label={t("usage.cfD1Storage")}
            value={
              report.d1.storageBytes !== null
                ? formatBytes(report.d1.storageBytes)
                : "—"
            }
          />
          <SettingsRow
            label={t("usage.cfD1Rows")}
            value={`${report.d1.rowsRead.toLocaleString()} / ${report.d1.rowsWritten.toLocaleString()}`}
          />
        </>
      )}
      {report.r2 && (
        <>
          <SettingsRow
            label={t("usage.cfR2Storage")}
            value={
              report.r2.storageBytes !== null
                ? formatBytes(report.r2.storageBytes)
                : "—"
            }
          />
          <SettingsRow
            label={t("usage.cfR2Objects")}
            value={
              report.r2.objectCount !== null
                ? report.r2.objectCount.toLocaleString()
                : "—"
            }
          />
          <SettingsRow
            label={t("usage.cfR2Ops")}
            value={`${locale(report.r2.classAOps)} / ${locale(report.r2.classBOps)}`}
          />
        </>
      )}
      {report.errors.length > 0 && (
        <div className="p-4 text-xs text-muted-foreground">
          {t("usage.cfPartial")} ({report.errors.join("; ")})
        </div>
      )}
    </div>
  );
}

type QuotaRow = {
  key: TranslationKey;
  used: number;
  limit: number | null;
  format: (value: number) => string;
};

const localeFormat = (value: number) => value.toLocaleString();

function PlanQuotaBars({
  plan,
  t,
}: {
  plan: NonNullable<VectorUsageReport["plan"]>;
  t: (key: TranslationKey) => string;
}) {
  const userRows: QuotaRow[] | null = plan.user
    ? [
        {
          key: "usage.planStorage",
          used: plan.user.usage.attachmentStorageBytes,
          limit: plan.user.limits.attachmentStorageBytes,
          format: formatBytes,
        },
        {
          key: "usage.planEmbeddingTokens",
          used: plan.user.usage.aiEmbeddingTokensPerMonth,
          limit: plan.user.limits.aiEmbeddingTokensPerMonth,
          format: localeFormat,
        },
        {
          key: "usage.planSearchQueries",
          used: plan.user.usage.semanticSearchQueriesPerMonth,
          limit: plan.user.limits.semanticSearchQueriesPerMonth,
          format: localeFormat,
        },
        {
          key: "usage.planMemos",
          used: plan.user.usage.maxMemosPerUser,
          limit: plan.user.limits.maxMemosPerUser,
          format: localeFormat,
        },
        {
          key: "usage.planMemories",
          used: plan.user.usage.maxMemoryItemsPerUser,
          limit: plan.user.limits.maxMemoryItemsPerUser,
          format: localeFormat,
        },
      ]
    : null;
  const userLimited = userRows?.filter((row) => row.limit !== null) ?? [];

  const deploymentRows: QuotaRow[] = [
    {
      key: "usage.planStorage",
      used: plan.usage.attachmentStorageBytes,
      limit: plan.limits.attachmentStorageBytes,
      format: formatBytes,
    },
    {
      key: "usage.planEmbeddingTokens",
      used: plan.usage.aiEmbeddingTokensPerMonth,
      limit: plan.limits.aiEmbeddingTokensPerMonth,
      format: localeFormat,
    },
    {
      key: "usage.planSearchQueries",
      used: plan.usage.semanticSearchQueriesPerMonth,
      limit: plan.limits.semanticSearchQueriesPerMonth,
      format: localeFormat,
    },
    {
      key: "usage.planMembers",
      used: plan.usage.maxMembersPerDeployment,
      limit: plan.limits.maxMembersPerDeployment,
      format: localeFormat,
    },
  ];
  const deploymentLimited = deploymentRows.filter((row) => row.limit !== null);

  if (userLimited.length === 0 && deploymentLimited.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      {userLimited.length > 0 && (
        <>
          <p className="text-sm font-medium">{t("usage.planUserTitle")}</p>
          {userLimited.map((row) => (
            <UsageBar
              key={`user-${row.key}`}
              label={t(row.key)}
              used={row.used}
              limit={row.limit as number}
              formatValue={row.format}
            />
          ))}
        </>
      )}
      {deploymentLimited.length > 0 && (
        <>
          <p className="text-sm font-medium">{t("usage.planTitle")}</p>
          {deploymentLimited.map((row) => (
            <UsageBar
              key={`deployment-${row.key}`}
              label={t(row.key)}
              used={row.used}
              limit={row.limit as number}
              formatValue={row.format}
            />
          ))}
        </>
      )}
    </div>
  );
}

function UsageBar({
  label,
  hint,
  used,
  limit,
  formatValue,
}: {
  label: string;
  hint?: string;
  used: number;
  limit: number;
  formatValue?: (value: number) => string;
}) {
  const format = formatValue ?? ((value: number) => value.toLocaleString());
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
        <span className="flex items-baseline gap-2">
          <span>{label}</span>
          {hint ? (
            <span className="text-xs text-muted-foreground">{hint}</span>
          ) : null}
        </span>
        <span className="ml-auto text-muted-foreground tabular-nums">
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        {percent > 0 ? (
          <div
            className="h-full min-w-4 rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        ) : null}
      </div>
    </div>
  );
}
