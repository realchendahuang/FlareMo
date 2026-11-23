-- The web edit dialog's 铁律 toggle used to set tier='core' without locking,
-- so memories the user marked as iron rules were never treated as rules: the
-- compiler hard-includes only verification='locked', and agents could still
-- supersede them. Lock the user's own active core memories so they become
-- what the UI promised. Agent-written rows are left alone. Idempotent.
UPDATE `memory_items`
SET `verification` = 'locked'
WHERE `tier` = 'core'
  AND `verification` = 'confirmed'
  AND `created_by_type` = 'user'
  AND `status` = 'active';
