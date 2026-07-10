CREATE TABLE `memo_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`memo_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`visibility` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`memo_id`) REFERENCES `memos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memo_revisions_memo_created_idx` ON `memo_revisions` (`memo_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `memo_revisions_user_created_idx` ON `memo_revisions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `memo_tags` (
	`memo_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tag` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`memo_id`, `tag`),
	FOREIGN KEY (`memo_id`) REFERENCES `memos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memo_tags_user_tag_memo_idx` ON `memo_tags` (`user_id`,`tag`,`memo_id`);--> statement-breakpoint
DROP INDEX `memos_user_status_created_idx`;--> statement-breakpoint
DROP INDEX `memos_user_updated_idx`;--> statement-breakpoint
CREATE INDEX `memos_user_status_pinned_created_id_idx` ON `memos` (`user_id`,`status`,`pinned`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `memos_user_updated_id_idx` ON `memos` (`user_id`,`updated_at`,`id`);--> statement-breakpoint
ALTER TABLE `attachments` ADD `state` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `attachments` ADD `etag` text;--> statement-breakpoint
CREATE INDEX `attachments_user_state_created_idx` ON `attachments` (`user_id`,`state`,`created_at`);--> statement-breakpoint
ALTER TABLE `shares` ADD `updated_at` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `shares` SET `updated_at` = `created_at` WHERE `updated_at` = '';--> statement-breakpoint
ALTER TABLE `shares` ADD `revoked_at` text;--> statement-breakpoint
CREATE INDEX `shares_user_memo_revoked_idx` ON `shares` (`user_id`,`memo_id`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `memo_relations_related_type_memo_idx` ON `memo_relations` (`related_memo_id`,`type`,`memo_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `memo_tags` (`memo_id`, `user_id`, `tag`, `created_at`)
SELECT
	`memos`.`id`,
	`memos`.`user_id`,
	LOWER(TRIM(`json_each`.`value`)),
	`memos`.`created_at`
FROM `memos`, json_each(`memos`.`payload`, '$.tags')
WHERE json_type(`memos`.`payload`, '$.tags') = 'array'
	AND typeof(`json_each`.`value`) = 'text'
	AND TRIM(`json_each`.`value`) != '';--> statement-breakpoint
CREATE VIRTUAL TABLE `memos_fts` USING fts5(
	`memo_id` UNINDEXED,
	`content`,
	tokenize = 'unicode61 remove_diacritics 2'
);--> statement-breakpoint
INSERT INTO `memos_fts` (`memo_id`, `content`)
SELECT `id`, `content` FROM `memos`;--> statement-breakpoint
CREATE TRIGGER `memos_fts_insert` AFTER INSERT ON `memos` BEGIN
	INSERT INTO `memos_fts` (`memo_id`, `content`) VALUES (new.`id`, new.`content`);
END;--> statement-breakpoint
CREATE TRIGGER `memos_fts_update` AFTER UPDATE OF `content` ON `memos` BEGIN
	DELETE FROM `memos_fts` WHERE `memo_id` = old.`id`;
	INSERT INTO `memos_fts` (`memo_id`, `content`) VALUES (new.`id`, new.`content`);
END;--> statement-breakpoint
CREATE TRIGGER `memos_fts_delete` AFTER DELETE ON `memos` BEGIN
	DELETE FROM `memos_fts` WHERE `memo_id` = old.`id`;
END;
