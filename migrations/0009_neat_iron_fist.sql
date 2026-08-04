CREATE TABLE `memos_webhook_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`webhook_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`lease_until` text,
	`delivered_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `memos_webhook_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`webhook_id`) REFERENCES `memos_webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memos_webhook_deliveries_event_webhook_idx` ON `memos_webhook_deliveries` (`event_id`,`webhook_id`);--> statement-breakpoint
CREATE INDEX `memos_webhook_deliveries_claim_idx` ON `memos_webhook_deliveries` (`status`,`next_attempt_at`,`lease_until`);--> statement-breakpoint
CREATE INDEX `memos_webhook_deliveries_event_idx` ON `memos_webhook_deliveries` (`event_id`);--> statement-breakpoint
CREATE TABLE `memos_webhook_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receiver_id` text NOT NULL,
	`activity_type` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`expanded_at` text,
	FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memos_webhook_events_receiver_created_idx` ON `memos_webhook_events` (`receiver_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `memos_webhook_events_expanded_created_idx` ON `memos_webhook_events` (`expanded_at`,`created_at`);