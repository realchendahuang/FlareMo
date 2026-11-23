CREATE TABLE `memo_insights` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`input` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`executor` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memo_insights_user_status_created_idx` ON `memo_insights` (`user_id`,`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `memo_insights_user_created_idx` ON `memo_insights` (`user_id`,`created_at`,`id`);