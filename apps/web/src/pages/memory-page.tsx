import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowLeftIcon,
  CheckIcon,
  LockIcon,
  LockOpenIcon,
  NotebookPenIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { cloneElement, isValidElement, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  archiveMemory,
  confirmMemory,
  createMemory,
  deleteMemory,
  listMemories,
  listMemoryReview,
  listMemoryRevisions,
  lockMemory,
  type Memory,
  promoteMemoryToMemo,
  unlockMemory,
  updateMemory,
} from "@/api";
import { FlareMoLogo } from "@/components/flaremo-logo";
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
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n";

type MemoryTab = "core" | "projects" | "recent" | "review" | "archive";

export function MemoryPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<MemoryTab>("core");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const listQuery = useQuery({
    queryKey: ["memories", "list"],
    queryFn: () => listMemories(),
  });

  const reviewQuery = useQuery({
    queryKey: ["memories", "review"],
    queryFn: () => listMemoryReview(),
  });

  const memories = useMemo(
    () => listQuery.data?.memories ?? [],
    [listQuery.data],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return memories;
    return memories.filter((memory) =>
      memory.content.toLowerCase().includes(q),
    );
  }, [memories, query]);

  const groups = useMemo(() => {
    const core = filtered.filter(
      (m) => m.tier === "core" && m.status === "active",
    );
    const projects = filtered.filter((m) => m.scope_type === "project");
    const recent = [...filtered].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    );
    const archive = filtered.filter((m) =>
      ["superseded", "archived", "deleted"].includes(m.status),
    );
    return { core, projects, recent, archive };
  }, [filtered]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["memories"] });
  };

  return (
    <div className="min-h-svh bg-background px-4 py-5 sm:py-8">
      <main className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
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
              {t("common.back")}
            </Link>
          </Button>
          <FlareMoLogo markClassName="size-5" />
        </header>

        <div className="flex items-end justify-between gap-3 px-1">
          <div>
            <h1 className="font-heading text-xl font-semibold">
              {t("memory.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("memory.subtitle")}
            </p>
          </div>
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" />
            {t("memory.newMemory")}
          </Button>
        </div>

        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            data-icon="inline-start"
          />
          <Input
            className="pl-9"
            placeholder={t("memory.searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as MemoryTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="core">{t("memory.tab.core")}</TabsTrigger>
            <TabsTrigger value="projects">
              {t("memory.tab.projects")}
            </TabsTrigger>
            <TabsTrigger value="recent">{t("memory.tab.recent")}</TabsTrigger>
            <TabsTrigger value="review">
              {t("memory.tab.review")}
              {reviewQuery.data && reviewQuery.data.memories.length > 0
                ? ` (${reviewQuery.data.memories.length})`
                : ""}
            </TabsTrigger>
            <TabsTrigger value="archive">{t("memory.tab.archive")}</TabsTrigger>
          </TabsList>

          <TabsContent value="core" className="mt-3">
            <MemoryList
              memories={groups.core}
              loading={listQuery.isLoading}
              onMutated={invalidate}
            />
          </TabsContent>
          <TabsContent value="projects" className="mt-3">
            <ProjectGroups memories={groups.projects} onMutated={invalidate} />
          </TabsContent>
          <TabsContent value="recent" className="mt-3">
            <MemoryList
              memories={groups.recent}
              loading={listQuery.isLoading}
              onMutated={invalidate}
              showSource
            />
          </TabsContent>
          <TabsContent value="review" className="mt-3">
            <MemoryList
              memories={reviewQuery.data?.memories ?? []}
              loading={reviewQuery.isLoading}
              onMutated={invalidate}
              review
            />
          </TabsContent>
          <TabsContent value="archive" className="mt-3">
            <MemoryList
              memories={groups.archive}
              loading={listQuery.isLoading}
              onMutated={invalidate}
            />
          </TabsContent>
        </Tabs>

        <MemoryCreateDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={invalidate}
        />
      </main>
    </div>
  );
}

function MemoryList({
  memories,
  loading,
  onMutated,
  showSource = false,
  review = false,
}: {
  memories: Memory[];
  loading: boolean;
  onMutated: () => void;
  showSource?: boolean;
  review?: boolean;
}) {
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (memories.length === 0) {
    return (
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle>
            {review ? t("memory.reviewEmpty") : t("memory.emptyTitle")}
          </EmptyTitle>
          <EmptyDescription>{t("memory.emptyDescription")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {memories.map((memory) => (
        <MemoryCard
          key={memory.id}
          memory={memory}
          showSource={showSource}
          review={review}
          onMutated={onMutated}
        />
      ))}
    </div>
  );
}

function MemoryCard({
  memory,
  showSource,
  review,
  onMutated,
}: {
  memory: Memory;
  showSource: boolean;
  review: boolean;
  onMutated: () => void;
}) {
  const { t } = useI18n();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showRevisions, setShowRevisions] = useState(false);

  const confirmMutation = useMutation({
    mutationFn: () => confirmMemory(bareId(memory.id)),
    onSuccess: () => {
      toast.success(t("toast.memoryConfirmed"));
      onMutated();
    },
  });

  const lockMutation = useMutation({
    mutationFn: () => lockMemory(bareId(memory.id)),
    onSuccess: () => {
      toast.success(t("toast.memoryLocked"));
      onMutated();
    },
  });

  const unlockMutation = useMutation({
    mutationFn: () => unlockMemory(bareId(memory.id)),
    onSuccess: () => {
      toast.success(t("toast.memoryUnlocked"));
      onMutated();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveMemory(bareId(memory.id)),
    onSuccess: () => {
      toast.success(t("toast.memoryArchived"));
      onMutated();
    },
  });

  const promoteMutation = useMutation({
    mutationFn: () => promoteMemoryToMemo(bareId(memory.id)),
    onSuccess: () => {
      toast.success(t("toast.saved"));
      onMutated();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMemory(bareId(memory.id)),
    onSuccess: () => {
      toast.success(t("toast.memoryDeleted"));
      onMutated();
    },
  });

  const id = bareId(memory.id);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm whitespace-pre-wrap">{memory.content}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{t(`memory.type.${memory.type}`)}</Badge>
          <Badge variant="outline">{t(`memory.kind.${memory.kind}`)}</Badge>
          <Badge variant="secondary">
            {t(`memory.scope.${memory.scope_type}`)}
          </Badge>
          <Badge variant="flame">
            {t(`memory.verification.${memory.verification}`)}
          </Badge>
          {memory.tier === "core" && <Badge>{t("memory.tier.core")}</Badge>}
          {showSource && memory.source_agent && (
            <span className="text-xs text-muted-foreground">
              {t("memory.sourceAgent")}: {memory.source_agent}
            </span>
          )}
          {review && memory.review_reason && (
            <span className="text-xs text-muted-foreground">
              {memory.review_reason}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {memory.verification !== "locked" &&
            memory.verification !== "confirmed" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => confirmMutation.mutate()}
              >
                <CheckIcon data-icon="inline-start" />
                {t("memory.confirm")}
              </Button>
            )}
          {memory.verification === "locked" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => unlockMutation.mutate()}
            >
              <LockOpenIcon data-icon="inline-start" />
              {t("memory.unlock")}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => lockMutation.mutate()}
            >
              <LockIcon data-icon="inline-start" />
              {t("memory.lock")}
            </Button>
          )}
          {memory.status === "active" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => archiveMutation.mutate()}
            >
              <ArchiveIcon data-icon="inline-start" />
              {t("memory.archive")}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <PencilIcon data-icon="inline-start" />
            {t("memory.edit")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowRevisions((value) => !value)}
          >
            {t("memory.revisions")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => promoteMutation.mutate()}
          >
            <NotebookPenIcon data-icon="inline-start" />
            {t("memory.toMemo")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2Icon data-icon="inline-start" />
            {t("memory.delete")}
          </Button>
        </div>

        {showRevisions && <MemoryRevisions memoryId={id} />}

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("memory.deleteConfirm")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("memory.content")}: {memory.content.slice(0, 80)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteMutation.mutate()}>
                {t("memory.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <MemoryEditDialog
          memory={memory}
          open={editing}
          onOpenChange={setEditing}
          onSaved={onMutated}
        />
      </CardContent>
    </Card>
  );
}

function MemoryRevisions({ memoryId }: { memoryId: string }) {
  const { t } = useI18n();
  const revisionsQuery = useQuery({
    queryKey: ["memories", "revisions", memoryId],
    queryFn: () => listMemoryRevisions(memoryId),
  });

  if (revisionsQuery.isLoading) {
    return <Skeleton className="h-16 w-full" />;
  }
  const revisions = revisionsQuery.data?.revisions ?? [];
  if (revisions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t("memory.noRevisions")}</p>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      {revisions.map((revision) => (
        <div className="text-xs text-muted-foreground" key={revision.id}>
          <time className="tabular-nums">
            {formatTimestamp(revision.created_at)}
          </time>
          <p className="mt-1 whitespace-pre-wrap">{revision.content}</p>
        </div>
      ))}
    </div>
  );
}

function ProjectGroups({
  memories,
  onMutated,
}: {
  memories: Memory[];
  onMutated: () => void;
}) {
  const { t } = useI18n();
  const byProject = useMemo(() => {
    const map = new Map<string, Memory[]>();
    for (const memory of memories) {
      const key = memory.scope_key ?? memory.scope_type;
      const list = map.get(key) ?? [];
      list.push(memory);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [memories]);

  if (byProject.length === 0) {
    return (
      <Empty className="min-h-56 border">
        <EmptyHeader>
          <EmptyTitle>{t("memory.emptyTitle")}</EmptyTitle>
          <EmptyDescription>{t("memory.emptyDescription")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {byProject.map(([project, items]) => (
        <section className="flex flex-col gap-2" key={project}>
          <h2 className="px-1 text-sm font-medium text-muted-foreground">
            {project} <span className="opacity-60">({items.length})</span>
          </h2>
          <MemoryList
            memories={items}
            loading={false}
            onMutated={onMutated}
            showSource
          />
        </section>
      ))}
    </div>
  );
}

function MemoryCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [type, setType] = useState<Memory["type"]>("semantic");
  const [kind, setKind] = useState<Memory["kind"]>("fact");
  const [scopeType, setScopeType] = useState<Memory["scope_type"]>("global");
  const [scopeKey, setScopeKey] = useState("");
  const [importance, setImportance] = useState(50);
  const [lock, setLock] = useState(false);

  const createMutation = useMutation({
    mutationFn: () =>
      createMemory({
        content,
        type,
        kind,
        scope_type: scopeType,
        scope_key: scopeKey.trim() || undefined,
        tier: "normal",
        importance,
        lock,
      }),
    onSuccess: () => {
      toast.success(t("common.save"));
      setContent("");
      setScopeKey("");
      onOpenChange(false);
      onCreated();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("memory.createFailed"),
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("memory.newMemory")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t("memory.content")}>
            <Textarea
              rows={4}
              value={content}
              placeholder="FlareMo 使用 D1 作为事实源"
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("memory.type")}>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={type}
                onChange={(event) =>
                  setType(event.target.value as Memory["type"])
                }
              >
                <option value="semantic">{t("memory.type.semantic")}</option>
                <option value="episodic">{t("memory.type.episodic")}</option>
                <option value="procedural">
                  {t("memory.type.procedural")}
                </option>
              </select>
            </Field>
            <Field label={t("memory.kind")}>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as Memory["kind"])
                }
              >
                {KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(`memory.kind.${value}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("memory.scope")}>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={scopeType}
                onChange={(event) =>
                  setScopeType(event.target.value as Memory["scope_type"])
                }
              >
                <option value="global">{t("memory.scope.global")}</option>
                <option value="workspace">{t("memory.scope.workspace")}</option>
                <option value="project">{t("memory.scope.project")}</option>
                <option value="agent">{t("memory.scope.agent")}</option>
              </select>
            </Field>
            <Field label={t("memory.importance")}>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                max={100}
                min={0}
                type="number"
                value={importance}
                onChange={(event) =>
                  setImportance(Number.parseInt(event.target.value, 10) || 0)
                }
              />
            </Field>
          </div>
          {scopeType !== "global" && (
            <Field label={t("memory.scopeKey")}>
              <Input
                value={scopeKey}
                placeholder="github:owner/repo"
                onChange={(event) => setScopeKey(event.target.value)}
              />
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={lock}
              type="checkbox"
              onChange={(event) => setLock(event.target.checked)}
            />
            {t("memory.lock")}
          </label>
        </div>
        <DialogFooter>
          <Button
            disabled={!content.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {t("memory.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemoryEditDialog({
  memory,
  open,
  onOpenChange,
  onSaved,
}: {
  memory: Memory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [content, setContent] = useState(memory.content);
  const [type, setType] = useState<Memory["type"]>(memory.type);
  const [kind, setKind] = useState<Memory["kind"]>(memory.kind);
  const [scopeType, setScopeType] = useState<Memory["scope_type"]>(
    memory.scope_type,
  );
  const [scopeKey, setScopeKey] = useState(memory.scope_key ?? "");
  const [importance, setImportance] = useState(memory.importance);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateMemory(bareId(memory.id), {
        content,
        type,
        kind,
        scope_type: scopeType,
        scope_key: scopeKey.trim() || undefined,
        importance,
      }),
    onSuccess: () => {
      toast.success(t("common.save"));
      onOpenChange(false);
      onSaved();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t("memory.updateFailed"),
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("memory.edit")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label={t("memory.content")}>
            <Textarea
              rows={4}
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("memory.type")}>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={type}
                onChange={(event) =>
                  setType(event.target.value as Memory["type"])
                }
              >
                <option value="semantic">{t("memory.type.semantic")}</option>
                <option value="episodic">{t("memory.type.episodic")}</option>
                <option value="procedural">
                  {t("memory.type.procedural")}
                </option>
              </select>
            </Field>
            <Field label={t("memory.kind")}>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as Memory["kind"])
                }
              >
                {KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(`memory.kind.${value}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("memory.scope")}>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={scopeType}
                onChange={(event) =>
                  setScopeType(event.target.value as Memory["scope_type"])
                }
              >
                <option value="global">{t("memory.scope.global")}</option>
                <option value="workspace">{t("memory.scope.workspace")}</option>
                <option value="project">{t("memory.scope.project")}</option>
                <option value="agent">{t("memory.scope.agent")}</option>
              </select>
            </Field>
            <Field label={t("memory.importance")}>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                max={100}
                min={0}
                type="number"
                value={importance}
                onChange={(event) =>
                  setImportance(Number.parseInt(event.target.value, 10) || 0)
                }
              />
            </Field>
          </div>
          {scopeType !== "global" && (
            <Field label={t("memory.scopeKey")}>
              <Input
                value={scopeKey}
                placeholder="github:owner/repo"
                onChange={(event) => setScopeKey(event.target.value)}
              />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button
            disabled={!content.trim() || updateMutation.isPending}
            onClick={() => updateMutation.mutate()}
          >
            {t("memory.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {isValidElement(children)
        ? cloneElement(children as React.ReactElement<{ id?: string }>, {
            id,
          })
        : children}
    </div>
  );
}

const KINDS: Memory["kind"][] = [
  "preference",
  "fact",
  "decision",
  "constraint",
  "entity",
  "event",
  "outcome",
  "lesson",
  "procedure",
];

function bareId(id: string) {
  return id.replace(/^memories\//, "");
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}
