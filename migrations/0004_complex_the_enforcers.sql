ALTER TABLE `attachments` ADD `client_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_user_client_id_idx` ON `attachments` (`user_id`,`client_id`);