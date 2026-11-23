-- Native sync change log: triggers + one-time backfill (docs/native-clients.md
-- §4.3.1). 0048 created the columns and tables; this migration makes every
-- write path land in `sync_changes` and seeds one row per existing resource so
-- a first pull can align without a separate full-sync endpoint.
--
-- Design notes:
-- * One trigger pair per entity. `op` is derived from `deleted_at`, not from
--   the SQL verb: a soft delete is an UPDATE that sets `deleted_at`, and the
--   client must see it as `delete`. Hard deletes (30-day sweep, account
--   deletion) also emit a `delete` row so a tombstone survives the row.
-- * `memo_relations` has INSERT/DELETE only: comments are append-only today
--   (no edit path), and the backfill below fills its `updated_at`, so an
--   UPDATE trigger would only ever fire for that backfill itself. New rows
--   inserted by a write path that predates the column keep the 1970 sentinel
--   default, so the relation triggers fall back to `created_at` — the row's
--   real write time — instead of logging 1970 as the change time.
-- * The relation DELETE trigger reads the owner from `memos` with an
--   INSERT ... SELECT rather than a scalar subquery. When the parent memo is
--   hard-deleted, SQLite performs the ON DELETE CASCADE before the parent's
--   AFTER DELETE trigger and the parent row is already gone; the SELECT then
--   yields no row and we skip the change instead of violating NOT NULL. That
--   is lossless for clients: they receive the parent's `memo` delete and drop
--   the relation locally.
-- * `sync_changes.seq` is AUTOINCREMENT, so backfilled rows get a dense,
--   strictly increasing seq range (all pre-existing data sorts before every
--   future write).

CREATE TRIGGER `sync_memos_ai` AFTER INSERT ON `memos` BEGIN
  INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
  VALUES (NEW.`user_id`, 'memo', NEW.`id`,
          CASE WHEN NEW.`deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,
          NEW.`version`, NEW.`updated_at`);
END;--> statement-breakpoint
CREATE TRIGGER `sync_memos_au` AFTER UPDATE ON `memos` BEGIN
  INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
  VALUES (NEW.`user_id`, 'memo', NEW.`id`,
          CASE WHEN NEW.`deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,
          NEW.`version`, NEW.`updated_at`);
END;--> statement-breakpoint
CREATE TRIGGER `sync_memos_ad` AFTER DELETE ON `memos` BEGIN
  INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
  VALUES (OLD.`user_id`, 'memo', OLD.`id`, 'delete', OLD.`version`, OLD.`updated_at`);
END;--> statement-breakpoint

CREATE TRIGGER `sync_attachments_ai` AFTER INSERT ON `attachments` BEGIN
  INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
  VALUES (NEW.`user_id`, 'attachment', NEW.`id`,
          CASE WHEN NEW.`deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,
          NEW.`version`, NEW.`updated_at`);
END;--> statement-breakpoint
CREATE TRIGGER `sync_attachments_au` AFTER UPDATE ON `attachments` BEGIN
  INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
  VALUES (NEW.`user_id`, 'attachment', NEW.`id`,
          CASE WHEN NEW.`deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,
          NEW.`version`, NEW.`updated_at`);
END;--> statement-breakpoint
CREATE TRIGGER `sync_attachments_ad` AFTER DELETE ON `attachments` BEGIN
  INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
  VALUES (OLD.`user_id`, 'attachment', OLD.`id`, 'delete', OLD.`version`, OLD.`updated_at`);
END;--> statement-breakpoint

CREATE TRIGGER `sync_articles_ai` AFTER INSERT ON `articles` BEGIN
  INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
  VALUES (NEW.`user_id`, 'article', NEW.`id`,
          CASE WHEN NEW.`deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,
          NEW.`version`, NEW.`updated_at`);
END;--> statement-breakpoint
CREATE TRIGGER `sync_articles_au` AFTER UPDATE ON `articles` BEGIN
  INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
  VALUES (NEW.`user_id`, 'article', NEW.`id`,
          CASE WHEN NEW.`deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,
          NEW.`version`, NEW.`updated_at`);
END;--> statement-breakpoint
CREATE TRIGGER `sync_articles_ad` AFTER DELETE ON `articles` BEGIN
  INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
  VALUES (OLD.`user_id`, 'article', OLD.`id`, 'delete', OLD.`version`, OLD.`updated_at`);
END;--> statement-breakpoint

CREATE TRIGGER `sync_memo_relations_ai` AFTER INSERT ON `memo_relations` BEGIN
  INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
  SELECT `user_id`, 'relation', NEW.`memo_id`, 'upsert', 0,
         CASE WHEN NEW.`updated_at` = '1970-01-01T00:00:00.000Z'
              THEN NEW.`created_at` ELSE NEW.`updated_at` END
  FROM `memos` WHERE `id` = NEW.`memo_id`;
END;--> statement-breakpoint
CREATE TRIGGER `sync_memo_relations_ad` AFTER DELETE ON `memo_relations` BEGIN
  INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
  SELECT `user_id`, 'relation', OLD.`memo_id`, 'delete', 0,
         CASE WHEN OLD.`updated_at` = '1970-01-01T00:00:00.000Z'
              THEN OLD.`created_at` ELSE OLD.`updated_at` END
  FROM `memos` WHERE `id` = OLD.`memo_id`;
END;--> statement-breakpoint

-- Relations predate the column, so they carry the placeholder default. Their
-- only write time is creation, so that is the honest sync timestamp.
UPDATE `memo_relations` SET `updated_at` = `created_at`
WHERE `updated_at` = '1970-01-01T00:00:00.000Z';--> statement-breakpoint

-- Backfill: one row per existing resource, in dependency-free order (memos
-- first so clients can insert parents before the attachments/relations that
-- reference them). Idempotent only in the sense that this migration runs once;
-- re-running it after the triggers exist would duplicate rows, which is why it
-- stays a migration and not a maintenance job.
INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
SELECT `user_id`, 'memo', `id`,
       CASE WHEN `deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,
       `version`, `updated_at`
FROM `memos`;--> statement-breakpoint
INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
SELECT `user_id`, 'attachment', `id`,
       CASE WHEN `deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,
       `version`, `updated_at`
FROM `attachments`;--> statement-breakpoint
INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
SELECT `user_id`, 'article', `id`,
       CASE WHEN `deleted_at` IS NULL THEN 'upsert' ELSE 'delete' END,
       `version`, `updated_at`
FROM `articles`;--> statement-breakpoint
INSERT INTO `sync_changes` (`user_id`, `entity`, `entity_id`, `op`, `version`, `updated_at`)
SELECT `memos`.`user_id`, 'relation', `memo_relations`.`memo_id`, 'upsert', 0,
       `memo_relations`.`updated_at`
FROM `memo_relations`
JOIN `memos` ON `memos`.`id` = `memo_relations`.`memo_id`;
