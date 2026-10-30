-- Comments inherit their parent's visibility but were written without its
-- team_id, so a comment on a team memo was readable by its author only:
-- other members could not see it, and the parent author's comment
-- notification was dropped at read time. Copy the parent's team onto every
-- comment that lacks one. Idempotent; touches comment rows only.
UPDATE `memos`
SET `team_id` = (
  SELECT `parent`.`team_id`
  FROM `memo_relations` AS `relation`
  JOIN `memos` AS `parent` ON `parent`.`id` = `relation`.`related_memo_id`
  WHERE `relation`.`memo_id` = `memos`.`id`
    AND `relation`.`type` = 'comment'
)
WHERE `team_id` IS NULL
  AND EXISTS (
    SELECT 1
    FROM `memo_relations` AS `relation`
    JOIN `memos` AS `parent` ON `parent`.`id` = `relation`.`related_memo_id`
    WHERE `relation`.`memo_id` = `memos`.`id`
      AND `relation`.`type` = 'comment'
      AND `parent`.`team_id` IS NOT NULL
  );
