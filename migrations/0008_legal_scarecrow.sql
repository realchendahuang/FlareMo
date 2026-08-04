CREATE TABLE `memos_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receiver_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'unread' NOT NULL,
	`source_event_id` text NOT NULL,
	`memo_id` text NOT NULL,
	`related_memo_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memo_id`) REFERENCES `memos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_memo_id`) REFERENCES `memos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memos_notifications_receiver_source_type_idx` ON `memos_notifications` (`receiver_id`,`source_event_id`,`type`);--> statement-breakpoint
CREATE INDEX `memos_notifications_receiver_created_id_idx` ON `memos_notifications` (`receiver_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `memos_notifications_receiver_status_created_idx` ON `memos_notifications` (`receiver_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `memos_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`signing_secret` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memos_webhooks_user_created_id_idx` ON `memos_webhooks` (`user_id`,`created_at`,`id`);