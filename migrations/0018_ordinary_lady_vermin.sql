DROP INDEX `attachments_cleanup_idx`;--> statement-breakpoint
CREATE INDEX `attachments_cleanup_idx` ON `attachments` (`created_at`) WHERE (state = 'deleting' or memo_id is null);