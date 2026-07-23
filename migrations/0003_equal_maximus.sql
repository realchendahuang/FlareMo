ALTER TABLE `memos` ADD `client_id` text;--> statement-breakpoint
UPDATE `memos` AS `target`
SET `client_id` = trim(json_extract(`target`.`payload`, '$.client_id'))
WHERE CASE
    WHEN json_valid(`target`.`payload`) THEN json_type(`target`.`payload`, '$.client_id')
  END = 'text'
  AND length(trim(json_extract(`target`.`payload`, '$.client_id'))) BETWEEN 1 AND 128
  AND NOT EXISTS (
    SELECT 1
    FROM `memos` AS `earlier`
    WHERE `earlier`.`user_id` = `target`.`user_id`
      AND CASE
          WHEN json_valid(`earlier`.`payload`) THEN json_type(`earlier`.`payload`, '$.client_id')
        END = 'text'
      AND trim(json_extract(`earlier`.`payload`, '$.client_id')) = trim(json_extract(`target`.`payload`, '$.client_id'))
      AND (
        `earlier`.`created_at` < `target`.`created_at`
        OR (
          `earlier`.`created_at` = `target`.`created_at`
          AND `earlier`.`id` < `target`.`id`
        )
      )
  );--> statement-breakpoint
CREATE UNIQUE INDEX `memos_user_client_id_idx` ON `memos` (`user_id`,`client_id`);
