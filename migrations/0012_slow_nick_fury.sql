CREATE TABLE `embedding_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`operation` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`lease_until` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `embedding_tasks_status_next_idx` ON `embedding_tasks` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `embedding_tasks_resource_idx` ON `embedding_tasks` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `usage_counters` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`metric` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_counters_user_month_metric_idx` ON `usage_counters` (`user_id`,`month`,`metric`);--> statement-breakpoint
ALTER TABLE `memos` ADD `embedding_status` text DEFAULT 'not_indexed' NOT NULL;--> statement-breakpoint
ALTER TABLE `memos` ADD `embedding_version` text;--> statement-breakpoint
ALTER TABLE `memos` ADD `embedded_at` text;--> statement-breakpoint
ALTER TABLE `memos` ADD `embedding_error` text;