CREATE TABLE `memos_sse_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`parent` text,
	`visibility` text NOT NULL,
	`creator_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memos_sse_events_created_id_idx` ON `memos_sse_events` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `memos_sse_events_creator_id_idx` ON `memos_sse_events` (`creator_id`,`id`);