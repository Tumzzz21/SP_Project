-- Phase: email + password sign-in alongside Google.
-- Nullable on purpose: Google-signed-in accounts keep password_hash = NULL and
-- can only authenticate through Google; local accounts store a scrypt hash here.
-- The column is never selected by USER_COLUMNS, so hashes never reach views,
-- API responses, or logs.
ALTER TABLE users ADD COLUMN password_hash TEXT;
