-- PATs created before scope support have no permissions. Narrow those legacy
-- credentials to the notes scope; explicitly scoped rows are left unchanged.
-- Idempotent so the backfill is safe to replay in tests and maintenance work.
UPDATE `auth_apikeys`
SET `permissions` = '{"memos":["read","write"]}'
WHERE `permissions` IS NULL OR `permissions` = '';
