import type { authApiKeys, authBootstrap, authUsers, users } from "./auth";
import type { articles, attachments, shares } from "./content";
import type { memoInsights } from "./insight";
import type {
  memoRevisions,
  memos,
  memosSseEvents,
  memoTags,
  reactions,
  shortcuts,
} from "./memos";
import type { dataTasks, memberRemovalJobs } from "./ops";
import type {
  memosNotifications,
  memosWebhookDeliveries,
  memosWebhookEvents,
  memosWebhooks,
  pushSubscriptions,
} from "./social";
import type { nativePushDevices, syncChanges } from "./sync";
import type { projects, taskActivity, tasks } from "./tasks";
import type { embeddingTasks, usageCounters } from "./usage";

export type MemoPayload = {
  tags?: string[];
  property?: {
    title?: string;
    has_link?: boolean;
    has_task_list?: boolean;
    has_code?: boolean;
    has_incomplete_tasks?: boolean;
  };
  location?: unknown;
  client_id?: string;
  [key: string]: unknown;
};

export type UserRow = typeof users.$inferSelect;
export type AuthUserRow = typeof authUsers.$inferSelect;
export type AuthApiKeyRow = typeof authApiKeys.$inferSelect;
export type AuthBootstrapRow = typeof authBootstrap.$inferSelect;
export type MemoRow = typeof memos.$inferSelect;
export type NewMemoRow = typeof memos.$inferInsert;
export type MemosSseEventRow = typeof memosSseEvents.$inferSelect;
export type MemoTagRow = typeof memoTags.$inferSelect;
export type MemoRevisionRow = typeof memoRevisions.$inferSelect;
export type ReactionRow = typeof reactions.$inferSelect;
export type ShortcutRow = typeof shortcuts.$inferSelect;
export type MemosWebhookRow = typeof memosWebhooks.$inferSelect;
export type MemosWebhookEventRow = typeof memosWebhookEvents.$inferSelect;
export type MemosWebhookDeliveryRow =
  typeof memosWebhookDeliveries.$inferSelect;
export type MemosNotificationRow = typeof memosNotifications.$inferSelect;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type ShareRow = typeof shares.$inferSelect;
export type ArticleRow = typeof articles.$inferSelect;
export type NewArticleRow = typeof articles.$inferInsert;
export type DataTaskRow = typeof dataTasks.$inferSelect;
export type NewDataTaskRow = typeof dataTasks.$inferInsert;
export type MemberRemovalJobRow = typeof memberRemovalJobs.$inferSelect;
export type NewMemberRemovalJobRow = typeof memberRemovalJobs.$inferInsert;
export type EmbeddingTaskRow = typeof embeddingTasks.$inferSelect;
export type NewEmbeddingTaskRow = typeof embeddingTasks.$inferInsert;
export type UsageCounterRow = typeof usageCounters.$inferSelect;
export type NewUsageCounterRow = typeof usageCounters.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type TaskActivityRow = typeof taskActivity.$inferSelect;
export type NewTaskActivityRow = typeof taskActivity.$inferInsert;
export type MemoInsightRow = typeof memoInsights.$inferSelect;
export type NewMemoInsightRow = typeof memoInsights.$inferInsert;
export type SyncChangeRow = typeof syncChanges.$inferSelect;
export type NewSyncChangeRow = typeof syncChanges.$inferInsert;
export type NativePushDeviceRow = typeof nativePushDevices.$inferSelect;
export type NewNativePushDeviceRow = typeof nativePushDevices.$inferInsert;
