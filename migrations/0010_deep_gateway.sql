CREATE TABLE `data_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`phase` text DEFAULT 'created' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`manifest_key` text,
	`progress_done` integer DEFAULT 0 NOT NULL,
	`progress_total` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`lease_until` text,
	`expires_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `data_tasks_user_created_idx` ON `data_tasks` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `data_tasks_status_lease_idx` ON `data_tasks` (`status`,`lease_until`);--> statement-breakpoint
CREATE INDEX `data_tasks_expires_idx` ON `data_tasks` (`expires_at`);