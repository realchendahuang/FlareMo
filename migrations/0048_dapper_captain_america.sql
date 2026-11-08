CREATE TABLE `native_push_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`platform` text NOT NULL,
	`token` text NOT NULL,
	`environment` text DEFAULT 'production' NOT NULL,
	`revoked_at` text,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_push_devices_token_idx` ON `native_push_devices` (`platform`,`token`);--> statement-breakpoint
CREATE INDEX `native_push_devices_user_idx` ON `native_push_devices` (`user_id`);--> statement-breakpoint
CREATE TABLE `sync_changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`op` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_changes_user_seq_idx` ON `sync_changes` (`user_id`,`seq`);--> statement-breakpoint
ALTER TABLE `articles` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `attachments` ADD `version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `memo_relations` ADD `updated_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;--> statement-breakpoint
ALTER TABLE `memos` ADD `version` integer DEFAULT 1 NOT NULL;