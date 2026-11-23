CREATE INDEX `memory_items_user_fact_key_created_idx` ON `memory_items` (`user_id`,`fact_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `memory_items_dormant_sweep_idx` ON `memory_items` (`last_accessed_at`,`created_at`) WHERE "memory_items"."status" = 'active' AND "memory_items"."verification" = 'observed' AND "memory_items"."needs_review" = 0;
