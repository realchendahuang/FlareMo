import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  ClipboardIcon,
  ImageUpIcon,
  KeyRoundIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  type AdminUser,
  type BrandingMarkVariant,
  clearAdminBrandingMark,
  createAdminUser,
  deleteAdminUser,
  getAdminBranding,
  listAdminUsers,
  requestAdminPasswordReset,
  updateAdminBrandingProductName,
  updateAdminUserRole,
  uploadAdminBrandingMark,
} from "@/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/i18n";
import { errorMessage } from "@/lib/error";

export function AdminPanel() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: listAdminUsers,
    retry: false,
  });

  const createUserMutation = useMutation({
    mutationFn: createAdminUser,
    onSuccess: () => {
      setName("");
      setEmail("");
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
  const deleteUserMutation = useMutation({
    mutationFn: deleteAdminUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
  const updateRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: "admin" | "member" }) =>
      updateAdminUserRole(id, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      void queryClient.invalidateQueries({
        queryKey: ["current-flaremo-user"],
      });
    },
  });

  const handleCreateUser = async () => {
    setCreateError(null);
    try {
      const result = await createUserMutation.mutateAsync({
        name: name.trim(),
        email: email.trim(),
      });
      setCreatedLink(`${window.location.origin}${result.activation_path}`);
      setCopied(false);
    } catch (error) {
      setCreateError(errorMessage(error, t("admin.userCreateFailed")));
    }
  };

  const handleDeleteUser = async (user: AdminUser) => {
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

  const handleUpdateRole = async (user: AdminUser) => {
    try {
      await updateRoleMutation.mutateAsync({
        id: user.id,
        role: user.role === "admin" ? "member" : "admin",
      });
    } catch (error) {
      setCreateError(errorMessage(error, t("admin.roleUpdateFailed")));
    }
  };

  const handleCopyResetLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      toast.error(t("admin.resetCopyFailed"));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <BrandingCard />
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t("admin.usersTitle")}</CardTitle>
          <Button
            size="sm"
            type="button"
            onClick={() => {
              setCreateError(null);
              setCreatedLink(null);
              setCreateOpen(true);
            }}
          >
            <PlusIcon data-icon="inline-start" />
            {t("admin.createUser")}
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {resetLink && (
            <ResetLinkBlock
              copied={copied}
              link={resetLink}
              onCopy={() => void handleCopyResetLink(resetLink)}
              onDismiss={() => setResetLink(null)}
              t={t}
            />
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
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <Badge variant="secondary">@{user.username}</Badge>
                    <Badge
                      variant={user.role !== "member" ? "default" : "outline"}
                    >
                      {user.role === "owner"
                        ? t("admin.role.owner")
                        : user.role === "admin"
                          ? t("admin.role.admin")
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
                      disabled={updateRoleMutation.isPending}
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleUpdateRole(user)}
                    >
                      {user.role === "admin"
                        ? t("admin.makeMember")
                        : t("admin.makeAdmin")}
                    </Button>
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
                      onClick={() => setDeleteTarget(user)}
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

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.deleteUser")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.deleteConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="ghost">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) void handleDeleteUser(deleteTarget);
              }}
            >
              {t("admin.deleteUser")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          {createdLink ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("admin.userCreatedTitle")}</DialogTitle>
              </DialogHeader>
              <ResetLinkBlock
                copied={copied}
                link={createdLink}
                onCopy={() => void handleCopyResetLink(createdLink)}
                t={t}
              />
              <DialogFooter>
                <Button
                  type="button"
                  onClick={() => {
                    setCreatedLink(null);
                    setCreateOpen(false);
                  }}
                >
                  {t("common.close")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("admin.createUser")}</DialogTitle>
              </DialogHeader>
              <form
                className="flex flex-col gap-3"
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
                    autoFocus
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
                <p className="text-xs leading-5 text-muted-foreground">
                  {t("admin.activationDescription")}
                </p>
                {createError && (
                  <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                    {createError}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    disabled={createUserMutation.isPending}
                    type="button"
                    variant="outline"
                    onClick={() => setCreateOpen(false)}
                  >
                    {t("common.cancel")}
                  </Button>
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
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResetLinkBlock({
  copied,
  link,
  onCopy,
  onDismiss,
  t,
}: {
  copied: boolean;
  link: string;
  onCopy: () => void;
  onDismiss?: () => void;
  t: (key: Parameters<ReturnType<typeof useI18n>["t"]>[0]) => string;
}) {
  return (
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
        {link}
      </code>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" type="button" onClick={onCopy}>
          {copied ? (
            <CheckIcon data-icon="inline-start" />
          ) : (
            <ClipboardIcon data-icon="inline-start" />
          )}
          {copied ? t("auth.copied") : t("admin.copyResetLink")}
        </Button>
        {onDismiss && (
          <Button size="sm" type="button" variant="outline" onClick={onDismiss}>
            {t("admin.hideResetLink")}
          </Button>
        )}
      </div>
    </div>
  );
}

const ACCEPTED_MARK_TYPES = "image/png,image/webp,image/svg+xml";

function BrandingCard() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [productName, setProductName] = useState("");
  const lightInputRef = useRef<HTMLInputElement>(null);
  const darkInputRef = useRef<HTMLInputElement>(null);

  const brandingQuery = useQuery({
    queryKey: ["admin-branding"],
    queryFn: getAdminBranding,
    retry: false,
  });

  useEffect(() => {
    if (brandingQuery.data) {
      setProductName(brandingQuery.data.product_name ?? "");
    }
  }, [brandingQuery.data]);

  const saveNameMutation = useMutation({
    mutationFn: () =>
      updateAdminBrandingProductName(productName.trim() || null),
    onSuccess: () => {
      toast.success(t("admin.branding.saved"));
      void queryClient.invalidateQueries({ queryKey: ["admin-branding"] });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.branding.failed"))),
  });

  const uploadMarkMutation = useMutation({
    mutationFn: ({
      variant,
      file,
    }: {
      variant: BrandingMarkVariant;
      file: File;
    }) => uploadAdminBrandingMark(variant, file),
    onSuccess: () => {
      toast.success(t("admin.branding.markUploaded"));
      void queryClient.invalidateQueries({ queryKey: ["admin-branding"] });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.branding.failed"))),
  });

  const clearMarkMutation = useMutation({
    mutationFn: (variant: BrandingMarkVariant) =>
      clearAdminBrandingMark(variant),
    onSuccess: () => {
      toast.success(t("admin.branding.markRemoved"));
      void queryClient.invalidateQueries({ queryKey: ["admin-branding"] });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t("admin.branding.failed"))),
  });

  const handleFileChange = (
    variant: BrandingMarkVariant,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      void uploadMarkMutation.mutateAsync({ variant, file });
    }
  };

  const renderMarkRow = (
    variant: BrandingMarkVariant,
    label: string,
    url: string | null,
    inputRef: React.RefObject<HTMLInputElement | null>,
  ) => (
    <div className="flex items-center gap-3">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted/40 dark:bg-muted/20">
        {url ? (
          <img alt="" className="size-8 object-contain" src={url} />
        ) : (
          <ImageUpIcon className="size-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <div className="mt-1 flex gap-2">
          <input
            accept={ACCEPTED_MARK_TYPES}
            className="hidden"
            ref={inputRef}
            type="file"
            onChange={(event) => handleFileChange(variant, event)}
          />
          <Button
            disabled={uploadMarkMutation.isPending}
            size="sm"
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
          >
            {url ? t("admin.branding.replace") : t("admin.branding.upload")}
          </Button>
          {url && (
            <Button
              disabled={clearMarkMutation.isPending}
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => void clearMarkMutation.mutateAsync(variant)}
            >
              <Trash2Icon data-icon="inline-start" />
              {t("admin.branding.remove")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t("admin.branding.title")}</CardTitle>
        <Button
          size="sm"
          type="button"
          variant="outline"
          onClick={() => setEditOpen(true)}
        >
          <PencilIcon data-icon="inline-start" />
          {t("common.edit")}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted/40 dark:bg-muted/20">
            {brandingQuery.data?.mark_dark_url ? (
              <img
                alt=""
                className="size-8 object-contain"
                src={brandingQuery.data.mark_dark_url}
              />
            ) : (
              <ImageUpIcon className="size-4 text-muted-foreground" />
            )}
          </div>
          <p className="min-w-0 truncate text-sm">
            {brandingQuery.data?.product_name ||
              t("admin.branding.statusDefault")}
          </p>
        </div>
      </CardContent>
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.branding.title")}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void saveNameMutation.mutateAsync();
            }}
          >
            <label
              className="flex flex-col gap-1.5 text-sm font-medium"
              htmlFor="branding-product-name"
            >
              {t("admin.branding.productName")}
              <Input
                autoComplete="off"
                id="branding-product-name"
                maxLength={40}
                placeholder={t("admin.branding.productNamePlaceholder")}
                value={productName}
                onChange={(event) => setProductName(event.target.value)}
              />
            </label>
            {saveNameMutation.isError && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {t("admin.branding.failed")}
              </p>
            )}
            <DialogFooter>
              <Button
                disabled={
                  saveNameMutation.isPending ||
                  productName.trim() ===
                    (brandingQuery.data?.product_name ?? "")
                }
                type="submit"
              >
                {saveNameMutation.isPending && (
                  <Loader2Icon
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                )}
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
          <div className="flex flex-col gap-3 border-t pt-3">
            {renderMarkRow(
              "light",
              t("admin.branding.markLight"),
              brandingQuery.data?.mark_light_url ?? null,
              lightInputRef,
            )}
            {renderMarkRow(
              "dark",
              t("admin.branding.markDark"),
              brandingQuery.data?.mark_dark_url ?? null,
              darkInputRef,
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
