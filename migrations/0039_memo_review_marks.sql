CREATE TABLE `memo_review_marks` (
	`user_id` text NOT NULL,
	`memo_id` text NOT NULL,
	`last_reviewed_on` text,
	`muted` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `memo_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memo_id`) REFERENCES `memos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memo_review_marks_memo_idx` ON `memo_review_marks` (`memo_id`);