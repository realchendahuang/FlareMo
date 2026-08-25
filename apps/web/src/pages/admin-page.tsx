import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeftIcon,
  ClipboardIcon,
  KeyRoundIcon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import {
  type AdminUser,
  createAdminUser,
  deleteAdminUser,
  getAdminSettings,
  listAdminUsers,
  requestAdminPasswordReset,
  updateAdminSettings,
} from "@/api";
import { errorMessage } from "@/components/auth-page-frame";
import { FlareMoLogo } from "@/components/flaremo-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/i18n";

const MIN_PASSWORD_LENGTH = 12;

export function AdminPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["admin-settings"],
    queryFn: getAdminSettings,
    retry: false,
  });
  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: listAdminUsers,
    retry: false,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: updateAdminSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-settings"] });
    },
  });
  const createUserMutation = useMutation({
    mutationFn: createAdminUser,
    onSuccess: () => {
      setName("");
      setEmail("");
      setPassword("");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
  const deleteUserMutation = useMutation({
    mutationFn: deleteAdminUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const handleCreateUser = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setCreateError(t("auth.passwordLength"));
      return;
    }
    setCreateError(null);
    try {
      await createUserMutation.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        password,
      });
    } catch (error) {
      setCreateError(errorMessage(error, t("admin.userCreateFailed")));
    }
  };

  const handleDeleteUser = async (user: AdminUser) => {
    if (!window.confirm(t("admin.deleteConfirm"))) return;
    try {
      await deleteUserMutation.mutateAsync(user.id);
    } catch (error) {
      setCreateError(errorMessage(error, t("admin.userDeleteFailed")));
    }
  };

  const handleResetPassword = async (user: AdminUser) => {
    try {
      const result = await requestAdminPasswordReset(user.id);
      const base = window.location.origin;
      setResetLink(`${base}${result.reset_path}`);
      setCopied(false);
    } catch (error) {
      setCreateError(errorMessage(error, t("admin.resetFailed")));
    }
  };

  const handleCopyResetLink = async () => {
    if (!resetLink) return;
    try {
      await navigator.clipboard.writeText(resetLink);
      setCopied(true);
    } catch {
      setCreateError(t("admin.resetCopyFailed"));
    }
  };

  const registrationOpen = settingsQuery.data?.registration_open ?? false;

  return (
    <div className="min-h-svh bg-background px-4 py-5 sm:py-8">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link
              search={{
                q: undefined,
                tag: undefined,
                view: undefined,
                untagged: undefined,
              }}
              to="/"
            >
              <ArrowLeftIcon data-icon="inline-start" />
              {t("admin.backToWorkspace")}
            </Link>
          </Button>
          <FlareMoLogo markClassName="size-5" />
        </header>

        <section className="border-b pb-4">
          <h1 className="font-heading text-2xl font-semibold">
            {t("admin.title")}
          </h1>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>{t("admin.registrationTitle")}</CardTitle>
            <CardDescription>
              {t("admin.registrationDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {settingsQuery.isLoading ? (
              <Skeleton className="h-8 w-full" />
            ) : settingsQuery.isError ? (
              <p className="text-sm text-destructive">
                {t("admin.settingsLoadFailed")}
              </p>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
                <span className="text-sm font-medium">
                  {registrationOpen
                    ? t("admin.registrationOpen")
                    : t("admin.registrationClosedState")}
                </span>
                <Switch
                  checked={registrationOpen}
                  disabled={updateSettingsMutation.isPending}
                  onCheckedChange={async (next) => {
                    try {
                      await updateSettingsMutation.mutateAsync({
                        registration_open: next,
                      });
                    } catch (error) {
                      setCreateError(
                        errorMessage(error, t("admin.settingsSaveFailed")),
                      );
                    }
                  }}
                />
              </div>
            )}
            {updateSettingsMutation.isError && (
              <p className="mt-3 text-sm text-destructive">
                {t("admin.settingsSaveFailed")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("admin.usersTitle")}</CardTitle>
            <CardDescription>{t("admin.usersDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateUser();
              }}
            >
              <label
                className="flex flex-col gap-1.5 text-sm font-medium"
                htmlFor="admin-name"
              >
                {t("auth.displayName")}
                <Input
                  autoComplete="off"
                  disabled={createUserMutation.isPending}
                  id="admin-name"
                  maxLength={80}
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label
                className="flex flex-col gap-1.5 text-sm font-medium"
                htmlFor="admin-email"
              >
                {t("auth.email")}
                <Input
                  autoComplete="off"
                  disabled={createUserMutation.isPending}
                  id="admin-email"
                  maxLength={320}
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label
                className="flex flex-col gap-1.5 text-sm font-medium"
                htmlFor="admin-password"
              >
                {t("auth.password")}
                <Input
                  autoComplete="new-password"
                  disabled={createUserMutation.isPending}
                  id="admin-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <div className="sm:col-span-2">
                <Button disabled={createUserMutation.isPending} type="submit">
                  {createUserMutation.isPending && (
                    <Loader2Icon
                      className="animate-spin"
                      data-icon="inline-start"
                    />
                  )}
                  {createUserMutation.isPending
                    ? t("admin.creatingUser")
                    : t("admin.createUser")}
                </Button>
              </div>
            </form>
            {createError && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {createError}
              </p>
            )}

            {resetLink && (
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3">
                <div className="flex items-start gap-2">
                  <KeyRoundIcon className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-amber-900 dark:text-amber-100">
                      {t("admin.resetLinkTitle")}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">
                      {t("admin.resetLinkDescription")}
                    </p>
                  </div>
                </div>
                <code className="mt-3 block overflow-x-auto rounded-lg bg-background/80 px-3 py-2 text-xs text-foreground">
                  {resetLink}
                </code>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void handleCopyResetLink()}>
                    {copied ? (
                      <span>{t("auth.copied")}</span>
                    ) : (
                      <ClipboardIcon data-icon="inline-start" />
                    )}
                    {copied ? t("auth.copied") : t("admin.copyResetLink")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setResetLink(null)}
                  >
                    {t("admin.hideResetLink")}
                  </Button>
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              {usersQuery.isLoading && (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              )}
              {usersQuery.isError && (
                <p className="text-sm text-destructive">
                  {t("admin.usersLoadFailed")}
                </p>
              )}
              {usersQuery.data && (
                <p className="mb-3 text-sm text-muted-foreground">
                  {t("admin.userCount", {
                    count: String(usersQuery.data.users.length),
                  })}
                </p>
              )}
              {usersQuery.data?.users.map((user) => (
                <div
                  key={user.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {user.name}
                      </p>
                      <Badge variant="secondary">@{user.username}</Badge>
                      <Badge
                        variant={user.role === "owner" ? "default" : "outline"}
                      >
                        {user.role === "owner"
                          ? t("admin.role.owner")
                          : t("admin.role.member")}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                  {user.role !== "owner" && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleResetPassword(user)}
                      >
                        <KeyRoundIcon data-icon="inline-start" />
                        {t("admin.resetPassword")}
                      </Button>
                      <Button
                        disabled={deleteUserMutation.isPending}
                        size="sm"
                        variant="outline"
                        onClick={() => void handleDeleteUser(user)}
                      >
                        <Trash2Icon data-icon="inline-start" />
                        {t("admin.deleteUser")}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
