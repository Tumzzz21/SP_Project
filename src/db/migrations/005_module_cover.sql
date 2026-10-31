-- 005_module_cover.sql
-- Add cover image support to modules.

ALTER TABLE modules ADD COLUMN cover_image TEXT DEFAULT '';
