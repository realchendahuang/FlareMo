import { ChevronDownIcon } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import { extractOutline } from "@/lib/markdown-outline";
import { cn } from "@/lib/utils";

/** Table of contents for a long transcript, with the active section marked. */
export function MemoOutline({
  className,
  content,
}: {
  className?: string;
  content: string;
}) {
  const { t } = useI18n();
  const entries = useMemo(() => extractOutline(content), [content]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (entries.length === 0) return;
    const targets = entries
      .map((entry) => document.getElementById(entry.id))
      .filter((node): node is HTMLElement => node !== null);
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (records) => {
        const visible = records
          .filter((record) => record.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -70% 0px" },
    );
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [entries]);

  if (entries.length < 2) return null;

  const list = (
    <ol className="flex flex-col gap-1">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            className={cn(
              "block truncate rounded-md px-2 py-1 text-xs transition-colors hover:bg-muted hover:text-foreground",
              entry.depth > 2 && "pl-5",
              entry.depth === 2 && "pl-3.5",
              activeId === entry.id
                ? "bg-flame-50 font-medium text-flame-700 dark:bg-flame-400/12 dark:text-flame-200"
                : "text-muted-foreground",
            )}
            href={`#${entry.id}`}
            onClick={(event) => {
              event.preventDefault();
              document
                .getElementById(entry.id)
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
              setActiveId(entry.id);
            }}
          >
            {entry.text}
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      {/* Narrow screens collapse the outline so it does not push the body down. */}
      <Collapsible.Root className={cn("lg:hidden", className)}>
        <Collapsible.Trigger className="flex w-full items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground">
          {t("reading.outline")}
          <ChevronDownIcon className="size-3.5 transition-transform data-[state=open]:rotate-180" />
        </Collapsible.Trigger>
        <Collapsible.Content className="pt-2">{list}</Collapsible.Content>
      </Collapsible.Root>

      <nav
        aria-label={t("reading.outline")}
        className={cn(
          "hidden max-h-[70vh] overflow-y-auto lg:block sticky top-24",
          className,
        )}
      >
        {list}
      </nav>
    </>
  );
}
