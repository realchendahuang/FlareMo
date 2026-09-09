CREATE TABLE `member_removal_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`phase` text DEFAULT 'created' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE INDEX `member_removal_jobs_member_idx` ON `member_removal_jobs` (`member_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `member_removal_jobs_status_idx` ON `member_removal_jobs` (`status`,`updated_at`);