import type { UseQueryResult } from "@tanstack/react-query";
import type { VectorUsageReport } from "@/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TranslationKey } from "@/i18n";
import { formatBytes } from "@/lib/utils";

type UsagePanelProps = {
  t: (key: TranslationKey) => string;
  vectorUsageQuery: UseQueryResult<VectorUsageReport, Error>;
};

export function UsagePanel({ t, vectorUsageQuery }: UsagePanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("usage.vectorTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {vectorUsageQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : vectorUsageQuery.isError || !vectorUsageQuery.data ? (
          <p className="text-sm text-muted-foreground">
            {t("usage.vectorUnavailable")}
          </p>
        ) : (
          <VectorUsagePanel report={vectorUsageQuery.data} t={t} />
        )}
      </CardContent>
    </Card>
  );
}

function VectorUsagePanel({
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-6 text-sm">
        <span className="text-muted-foreground">
          {t("usage.model")}: {report.model}
        </span>
        <span className="text-muted-foreground">
          {t("usage.dimensions")}: {report.dimensions}
        </span>
        <span className="text-muted-foreground">
          {t("usage.vectors")}: {totalVectors}
        </span>
      </div>
      <UsageBar
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
      <p className="text-xs text-muted-foreground">{t("usage.disclaimer")}</p>
    </div>
  );
}

// Used-vs-limit rows for the injectable plan quotas. Rows with a null limit
// (self-hosted default) stay hidden so the panel stays noise-free; when every
// limit is null there is nothing to render.
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
  used,
  limit,
  formatValue,
}: {
  label: string;
  used: number;
  limit: number;
  formatValue?: (value: number) => string;
}) {
  const format = formatValue ?? ((value: number) => value.toLocaleString());
  const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-flame-500 transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
