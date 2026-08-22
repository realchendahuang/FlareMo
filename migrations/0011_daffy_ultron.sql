CREATE TABLE `memory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`type` text DEFAULT 'semantic' NOT NULL,
	`kind` text DEFAULT 'fact' NOT NULL,
	`scope_type` text DEFAULT 'global' NOT NULL,
	`scope_key` text,
	`tier` text DEFAULT 'normal' NOT NULL,
	`verification` text DEFAULT 'observed' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`importance` integer DEFAULT 50 NOT NULL,
	`confidence` integer DEFAULT 50 NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL,
	`review_reason` text,
	`created_by_type` text DEFAULT 'agent' NOT NULL,
	`source_agent` text,
	`source_session` text,
	`source_ref` text,
	`valid_from` text,
	`valid_to` text,
	`fingerprint` text NOT NULL,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` text,
	`embedding_status` text DEFAULT 'not_indexed' NOT NULL,
	`embedding_version` text,
	`embedded_at` text,
	`embedding_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_items_user_scope_status_idx` ON `memory_items` (`user_id`,`scope_type`,`scope_key`,`status`);--> statement-breakpoint
CREATE INDEX `memory_items_user_type_kind_idx` ON `memory_items` (`user_id`,`type`,`kind`);--> statement-breakpoint
CREATE INDEX `memory_items_user_tier_idx` ON `memory_items` (`user_id`,`tier`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_items_user_fingerprint_idx` ON `memory_items` (`user_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `memory_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`related_memory_id` text NOT NULL,
	`user_id` text NOT NULL,
	`type` text DEFAULT 'related_to' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_memory_id`) REFERENCES `memory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_relations_memory_related_type_idx` ON `memory_relations` (`memory_id`,`related_memory_id`,`type`);--> statement-breakpoint
CREATE INDEX `memory_relations_related_idx` ON `memory_relations` (`related_memory_id`,`type`);--> statement-breakpoint
CREATE TABLE `memory_resource_links` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`user_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_ref` text NOT NULL,
	`relation_type` text DEFAULT 'derived_from' NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_resource_links_memory_idx` ON `memory_resource_links` (`memory_id`);--> statement-breakpoint
CREATE INDEX `memory_resource_links_resource_idx` ON `memory_resource_links` (`resource_type`,`resource_ref`);--> statement-breakpoint
CREATE TABLE `memory_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`metadata_snapshot` text DEFAULT '{}' NOT NULL,
	`created_by_type` text NOT NULL,
	`created_by_agent` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_revisions_memory_created_idx` ON `memory_revisions` (`memory_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `memory_revisions_user_created_idx` ON `memory_revisions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE VIRTUAL TABLE `memory_fts` USING fts5(
	`memory_id` UNINDEXED,
	`content`,
	tokenize = 'trigram'
);--> statement-breakpoint
CREATE TRIGGER `memory_fts_insert` AFTER INSERT ON `memory_items` BEGIN
	INSERT INTO `memory_fts` (`memory_id`, `content`) VALUES (new.`id`, new.`content`);
END;--> statement-breakpoint
CREATE TRIGGER `memory_fts_update` AFTER UPDATE OF `content` ON `memory_items` BEGIN
	DELETE FROM `memory_fts` WHERE `memory_id` = old.`id`;
	INSERT INTO `memory_fts` (`memory_id`, `content`) VALUES (new.`id`, new.`content`);
END;--> statement-breakpoint
CREATE TRIGGER `memory_fts_delete` AFTER DELETE ON `memory_items` BEGIN
	DELETE FROM `memory_fts` WHERE `memory_id` = old.`id`;
END;