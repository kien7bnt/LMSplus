-- ============================================================================
-- MIGRATION 004 (UP): ACADEMIC FORUMS & MODERATION
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS forums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
    subject_class_id UUID NULL REFERENCES subject_classes(id) ON DELETE CASCADE,
    forum_scope VARCHAR(32) NOT NULL DEFAULT 'CLASS_ONLY', -- CLASS_ONLY, SUBJECT_SHARED
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forum_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    category_type VARCHAR(32) NOT NULL DEFAULT 'QA', -- QA, DISCUSSION, GRADED_DISCUSSION, ANNOUNCEMENT
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forum_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES forum_categories(id) ON DELETE RESTRICT,
    subject_class_id UUID NULL REFERENCES subject_classes(id) ON DELETE SET NULL,
    lesson_id UUID NULL REFERENCES lessons(id) ON DELETE SET NULL,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    topic_type VARCHAR(32) NOT NULL DEFAULT 'QA',
    title VARCHAR(300) NOT NULL,
    body_json JSONB NOT NULL,
    mentioned_user_ids UUID[] NOT NULL DEFAULT '{}',
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    is_graded BOOLEAN NOT NULL DEFAULT FALSE,
    max_score NUMERIC(6,2) NULL,
    reply_count INTEGER NOT NULL DEFAULT 0,
    view_count INTEGER NOT NULL DEFAULT 0,
    last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_forum_topics_feed
    ON forum_topics(forum_id, is_pinned DESC, last_activity_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS forum_replies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
    parent_reply_id UUID NULL REFERENCES forum_replies(id) ON DELETE CASCADE,
    depth_level SMALLINT NOT NULL DEFAULT 1,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    body_json JSONB NOT NULL,
    mentioned_user_ids UUID[] NOT NULL DEFAULT '{}',
    is_instructor_endorsed BOOLEAN NOT NULL DEFAULT FALSE,
    awarded_score NUMERIC(6,2) NULL,
    graded_by UUID NULL REFERENCES users(id),
    status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT chk_max_reply_depth CHECK (depth_level IN (1, 2))
);
CREATE INDEX IF NOT EXISTS idx_forum_replies_topic
    ON forum_replies(topic_id, created_at ASC) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS forum_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id UUID NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_topic_sub UNIQUE (topic_id, user_id)
);

CREATE TABLE IF NOT EXISTS forum_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(16) NOT NULL, -- TOPIC, REPLY
    target_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reaction_type VARCHAR(24) NOT NULL DEFAULT 'HELPFUL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_forum_reaction UNIQUE (target_type, target_id, user_id, reaction_type)
);

CREATE TABLE IF NOT EXISTS forum_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type VARCHAR(16) NOT NULL,
    target_id UUID NOT NULL,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason_code VARCHAR(32) NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    resolved_by UUID NULL REFERENCES users(id),
    resolved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forum_moderation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    forum_id UUID NOT NULL REFERENCES forums(id) ON DELETE CASCADE,
    target_type VARCHAR(16) NOT NULL,
    target_id UUID NOT NULL,
    moderator_id UUID NOT NULL REFERENCES users(id),
    action VARCHAR(32) NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
