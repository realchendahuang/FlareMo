CREATE TABLE `reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`content_id` text NOT NULL,
	`reaction_type` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_id`) REFERENCES `memos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reactions_creator_content_type_idx` ON `reactions` (`creator_id`,`content_id`,`reaction_type`);--> statement-breakpoint
CREATE INDEX `reactions_content_created_id_idx` ON `reactions` (`content_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `reactions_creator_idx` ON `reactions` (`creator_id`);--> statement-breakpoint
CREATE TABLE `shortcuts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`filter` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shortcuts_user_created_id_idx` ON `shortcuts` (`user_id`,`created_at`,`id`);