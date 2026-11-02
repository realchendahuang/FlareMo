-- Agent Memory is removed. Clear queued/legacy references, then drop its
-- derived FTS table and every ledger table, children before the parent.
DELETE FROM `embedding_tasks` WHERE `resource_type` = 'memory';--> statement-breakpoint
DELETE FROM `import_task_rows` WHERE `table_name` = 'memory_items';--> statement-breakpoint
DROP TABLE IF EXISTS `memory_fts`;--> statement-breakpoint
DROP TABLE IF EXISTS `memory_compile_archives`;--> statement-breakpoint
DROP TABLE IF EXISTS `memory_events`;--> statement-breakpoint
DROP TABLE IF EXISTS `memory_evidence`;--> statement-breakpoint
DROP TABLE IF EXISTS `memory_rejections`;--> statement-breakpoint
DROP TABLE IF EXISTS `memory_relations`;--> statement-breakpoint
DROP TABLE IF EXISTS `memory_resource_links`;--> statement-breakpoint
DROP TABLE IF EXISTS `memory_revisions`;--> statement-breakpoint
DROP TABLE IF EXISTS `memory_items`;
