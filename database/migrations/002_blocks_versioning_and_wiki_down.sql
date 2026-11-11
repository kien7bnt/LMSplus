-- ============================================================================
-- MIGRATION 002 (DOWN): ROLLBACK BLOCK EDITOR, VERSIONING & WIKI
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS lesson_term_links;
DROP TABLE IF EXISTS wiki_revisions;
DROP TABLE IF EXISTS wiki_relations;
DROP TABLE IF EXISTS wiki_aliases;
DROP TABLE IF EXISTS wiki_terms;
DROP TABLE IF EXISTS wiki_categories;
DROP TABLE IF EXISTS lesson_attachments;
DROP TABLE IF EXISTS learning_resources;
ALTER TABLE lessons DROP CONSTRAINT IF EXISTS fk_lessons_published_version;
DROP TABLE IF EXISTS lesson_versions;
DROP TABLE IF EXISTS lesson_blocks;
DROP TABLE IF EXISTS shared_blocks;

COMMIT;
