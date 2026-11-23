CREATE INDEX `memory_items_user_updated_id_idx` ON `memory_items` (`user_id`,`updated_at`,`id`);--> statement-breakpoint
CREATE INDEX `memory_evidence_memory_created_idx` ON `memory_evidence` (`memory_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `attachments_memo_created_idx` ON `attachments` (`memo_id`,`created_at`);
