-- ============================================================================
-- MIGRATION 004 (DOWN): ROLLBACK FORUMS & MODERATION
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS forum_moderation_logs;
DROP TABLE IF EXISTS forum_reports;
DROP TABLE IF EXISTS forum_reactions;
DROP TABLE IF EXISTS forum_subscriptions;
DROP TABLE IF EXISTS forum_replies;
DROP TABLE IF EXISTS forum_topics;
DROP TABLE IF EXISTS forum_categories;
DROP TABLE IF EXISTS forums;

COMMIT;
