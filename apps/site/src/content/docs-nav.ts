import type { DocGroup } from "@/lib/docs-source.generated";
import type { Locale } from "@/lib/seo";

export type DocNavGroup = {
  id: DocGroup;
  label: string;
};

const ZH_GROUPS: Record<DocGroup, string> = {
  start: "开始",
  concept: "架构与概念",
  compatibility: "兼容与生态",
  agent: "Agent 集成",
  reference: "参考",
};

const EN_GROUPS: Record<DocGroup, string> = {
  start: "Get started",
  concept: "Architecture and concepts",
  compatibility: "Compatibility and ecosystem",
  agent: "Agent integrations",
  reference: "Reference",
};

export function getDocNavGroups(locale: Locale): DocNavGroup[] {
  const labels = locale === "zh-CN" ? ZH_GROUPS : EN_GROUPS;
  const order: DocGroup[] = ["start", "concept", "compatibility", "agent", "reference"];
  return order.map((id) => ({ id, label: labels[id] }));
}

export function docPath(slug: string, locale: Locale): string {
  return locale === "zh-CN" ? `/docs/${slug}` : `/en/docs/${slug}`;
}