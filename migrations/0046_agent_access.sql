CREATE TABLE `app_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`client_type` text NOT NULL,
	`redirect_uri` text,
	`created_by_auth_user_id` text,
	`created_at` text NOT NULL,
	`last_seen_at` text,
	FOREIGN KEY (`created_by_auth_user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `app_clients_created_by_idx` ON `app_clients` (`created_by_auth_user_id`);--> statement-breakpoint
CREATE TABLE `device_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`auth_user_id` text,
	`user_code_hash` text NOT NULL,
	`device_code_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` text NOT NULL,
	`approved_at` text,
	`redeemed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `app_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`auth_user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_authorizations_user_code_idx` ON `device_authorizations` (`user_code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_authorizations_device_code_idx` ON `device_authorizations` (`device_code_hash`);--> statement-breakpoint
CREATE INDEX `device_authorizations_expires_at_idx` ON `device_authorizations` (`expires_at`);--> statement-breakpoint
CREATE TABLE `device_refresh_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`auth_user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`access_key_id` text,
	`scopes` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `app_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`auth_user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`access_key_id`) REFERENCES `auth_apikeys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_refresh_tokens_hash_idx` ON `device_refresh_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `device_refresh_tokens_user_idx` ON `device_refresh_tokens` (`auth_user_id`);--> statement-breakpoint
CREATE INDEX `device_refresh_tokens_client_idx` ON `device_refresh_tokens` (`client_id`);--> statement-breakpoint
CREATE INDEX `device_refresh_tokens_expires_at_idx` ON `device_refresh_tokens` (`expires_at`);