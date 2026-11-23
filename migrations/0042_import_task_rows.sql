CREATE TABLE `import_task_rows` (
	`task_id` text NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `table_name`, `row_id`),
	FOREIGN KEY (`task_id`) REFERENCES `data_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_task_rows_task_idx` ON `import_task_rows` (`task_id`);