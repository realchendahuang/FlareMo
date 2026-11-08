import type { ApproveDeviceAuthorizationResponseDto } from "@flaremo/contracts";
import { USER_CODE_LENGTH } from "@flaremo/contracts";
import { Link } from "@tanstack/react-router";
import { CircleCheckIcon, LinkIcon } from "lucide-react";
import { useState } from "react";
import { ApiError, approveDeviceAuthorization } from "@/api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { WorkspacePageHeader } from "@/components/workspace/workspace-page-header";
import { type TranslationKey, type TranslationParams, useI18n } from "@/i18n";
import {
  formatPairingCode,
  normalizePairingCode,
  scopeDetail,
  scopeLabel,
} from "@/lib/connect";

/**
 * The browser half of the device-authorization flow (RFC 8628): the client
 * shows a pairing code, the signed-in user types it here, and the Worker binds
 * that pending authorization to this account.
 */
export function ConnectPage({ initialCode }: { initialCode?: string }) {
  const { t } = useI18n();
  const [code, setCode] = useState(() =>
    normalizePairingCode(initialCode ?? ""),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] =
    useState<ApproveDeviceAuthorizationResponseDto | null>(null);

  const handleSubmit = async () => {
    if (code.length !== USER_CODE_LENGTH) {
      setError(t("connect.errorIncomplete"));
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await approveDeviceAuthorization({ user_code: code });
      setApproved(result);
    } catch (submitError) {
      setError(connectErrorMessage(submitError, t));
    } finally {
      setPending(false);
    }
  };

  return (
    <WorkspaceLayout
      header={({
        sidebarCollapsed,
        toggleSidebarCollapsed,
        mobileSheetOpen,
        setMobileSheetOpen,
        explorer,
      }) => (
        <WorkspacePageHeader
          explorer={explorer}
          icon={
            <LinkIcon className="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
          }
          mobileSheetOpen={mobileSheetOpen}
          setMobileSheetOpen={setMobileSheetOpen}
          sidebarCollapsed={sidebarCollapsed}
          title={t("connect.title")}
          toggleSidebarCollapsed={toggleSidebarCollapsed}
        />
      )}
    >
      <div className="flex flex-col gap-4 py-2">
        {approved ? (
          <ApprovedCard approved={approved} />
        ) : (
          <Card>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
                {t("connect.description")}
              </p>
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSubmit();
                }}
              >
                <label
                  className="flex flex-col gap-1.5 text-sm font-medium"
                  htmlFor="connect-code"
                >
                  {t("connect.codeLabel")}
                  <Input
                    autoCapitalize="characters"
                    autoComplete="one-time-code"
                    autoFocus
                    className="h-11 text-center font-mono text-lg uppercase tracking-[0.3em]"
                    disabled={pending}
                    enterKeyHint="done"
                    id="connect-code"
                    maxLength={9}
                    placeholder={t("connect.codePlaceholder")}
                    spellCheck={false}
                    value={formatPairingCode(code)}
                    onChange={(event) =>
                      setCode(normalizePairingCode(event.target.value))
                    }
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  {t("connect.codeHint")}
                </p>
                {error && <Alert variant="destructive">{error}</Alert>}
                <Button
                  className="mt-1 w-full"
                  disabled={pending}
                  type="submit"
                  variant="brand"
                >
                  {pending ? (
                    <>
                      <Spinner data-icon="inline-start" />
                      {t("connect.submitting")}
                    </>
                  ) : (
                    t("connect.submit")
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </WorkspaceLayout>
  );
}

function ApprovedCard({
  approved,
}: {
  approved: ApproveDeviceAuthorizationResponseDto;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/12 text-success-emphasis">
            <CircleCheckIcon className="size-5" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <CardTitle className="text-lg">
              {t("connect.approvedTitle")}
            </CardTitle>
            <CardDescription className="text-sm leading-relaxed text-pretty">
              {t("connect.approvedDescription", {
                name: approved.client_name,
              })}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            {t("connect.grantedScopes")}
          </p>
          <ul className="flex flex-col gap-1.5">
            {approved.scopes.map((scope) => {
              const detail = scopeDetail(scope, t);
              return (
                <li
                  className="flex flex-wrap items-baseline gap-x-2 text-sm"
                  key={scope}
                >
                  <span className="font-medium">{scopeLabel(scope, t)}</span>
                  {detail && (
                    <span className="text-muted-foreground">{detail}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <Button
          className="w-fit"
          render={<Link search={{ section: "connectedApps" }} to="/account" />}
          variant="outline"
        >
          {t("connect.manageApps")}
        </Button>
      </CardContent>
    </Card>
  );
}

/** The approval endpoint only says which failure happened through its status
 *  and English message; map those to the two human cases users can act on. */
function connectErrorMessage(
  error: unknown,
  t: (key: TranslationKey, params?: TranslationParams) => string,
): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return t("connect.errorSession");
    if (error.status === 404) return t("connect.errorNotFound");
    if (error.status === 400) {
      const message = error.message.toLowerCase();
      if (message.includes("expired")) return t("connect.errorExpired");
      if (message.includes("used")) return t("connect.errorUsed");
      if (message.includes("complete")) return t("connect.errorIncomplete");
    }
  }
  return t("connect.errorFailed");
}
