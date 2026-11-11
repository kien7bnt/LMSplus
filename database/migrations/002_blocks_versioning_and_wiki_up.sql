-- ============================================================================
-- MIGRATION 002 (UP): NOTION-STYLE BLOCK EDITOR, VERSIONING & ACADEMIC WIKI
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS shared_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NULL REFERENCES subjects(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    block_type VARCHAR(64) NOT NULL,
    schema_version VARCHAR(16) NOT NULL DEFAULT '1.0',
    content_json JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    version_number INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS lesson_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    parent_block_id UUID NULL REFERENCES lesson_blocks(id) ON DELETE CASCADE,
    shared_block_id UUID NULL REFERENCES shared_blocks(id) ON DELETE SET NULL,
    block_type VARCHAR(64) NOT NULL,
    schema_version VARCHAR(16) NOT NULL DEFAULT '1.0',
    content_json JSONB NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 1000,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id),
    updated_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_lesson_blocks_lesson_order
    ON lesson_blocks(lesson_id, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lesson_blocks_json_gin
    ON lesson_blocks USING GIN (content_json);

CREATE TABLE IF NOT EXISTS lesson_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    version_status VARCHAR(32) NOT NULL DEFAULT 'PUBLISHED',
    schema_version VARCHAR(16) NOT NULL DEFAULT '1.0',
    blocks_snapshot_json JSONB NOT NULL,
    changelog_note TEXT,
    published_at TIMESTAMPTZ NULL,
    published_by UUID NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id),
    CONSTRAINT uq_lesson_version_num UNIQUE (lesson_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_lesson_versions_lookup
    ON lesson_versions(lesson_id, version_status);

ALTER TABLE lessons
    DROP CONSTRAINT IF EXISTS fk_lessons_published_version;
ALTER TABLE lessons
    ADD CONSTRAINT fk_lessons_published_version
    FOREIGN KEY (published_version_id) REFERENCES lesson_versions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS learning_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NULL REFERENCES subjects(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    resource_type VARCHAR(32) NOT NULL,
    storage_provider VARCHAR(32) NOT NULL DEFAULT 'S3_COMPATIBLE',
    storage_key VARCHAR(1024) NOT NULL,
    mime_type VARCHAR(128),
    file_size_bytes BIGINT,
    duration_seconds INTEGER NULL,
    checksum_sha256 VARCHAR(64),
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'READY',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS lesson_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    resource_id UUID NOT NULL REFERENCES learning_resources(id) ON DELETE RESTRICT,
    display_title VARCHAR(255) NOT NULL,
    is_downloadable BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id),
    CONSTRAINT uq_lesson_resource UNIQUE (lesson_id, resource_id)
);

CREATE TABLE IF NOT EXISTS wiki_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id UUID NULL REFERENCES subjects(id) ON DELETE SET NULL,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(160) NOT NULL UNIQUE,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wiki_terms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    subject_id UUID NULL REFERENCES subjects(id) ON DELETE SET NULL,
    category_id UUID NULL REFERENCES wiki_categories(id) ON DELETE SET NULL,
    short_definition TEXT NOT NULL,
    detailed_content_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT', -- DRAFT, PENDING_REVIEW, PUBLISHED, ARCHIVED
    current_revision_id UUID NULL,
    approved_by UUID NULL REFERENCES users(id),
    approved_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NULL REFERENCES users(id),
    updated_by UUID NULL REFERENCES users(id),
    deleted_at TIMESTAMPTZ NULL,
    CONSTRAINT uq_wiki_term_subject_slug UNIQUE NULLS NOT DISTINCT (subject_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_wiki_terms_search
    ON wiki_terms(canonical_name, status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS wiki_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term_id UUID NOT NULL REFERENCES wiki_terms(id) ON DELETE CASCADE,
    alias_name VARCHAR(255) NOT NULL,
    language_code VARCHAR(10) NOT NULL DEFAULT 'vi',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_term_alias UNIQUE (term_id, alias_name)
);
CREATE INDEX IF NOT EXISTS idx_wiki_aliases_lookup ON wiki_aliases(LOWER(alias_name));

CREATE TABLE IF NOT EXISTS wiki_relations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_term_id UUID NOT NULL REFERENCES wiki_terms(id) ON DELETE CASCADE,
    target_term_id UUID NOT NULL REFERENCES wiki_terms(id) ON DELETE CASCADE,
    relation_type VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_wiki_relation UNIQUE (source_term_id, target_term_id, relation_type)
);

CREATE TABLE IF NOT EXISTS wiki_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    term_id UUID NOT NULL REFERENCES wiki_terms(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    short_definition TEXT NOT NULL,
    detailed_content_json JSONB NOT NULL,
    change_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID NOT NULL REFERENCES users(id),
    CONSTRAINT uq_wiki_term_rev UNIQUE (term_id, revision_number)
);

CREATE TABLE IF NOT EXISTS lesson_term_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    block_id UUID NULL REFERENCES lesson_blocks(id) ON DELETE CASCADE,
    term_id UUID NOT NULL REFERENCES wiki_terms(id) ON DELETE CASCADE,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_lesson_block_term UNIQUE NULLS NOT DISTINCT (lesson_id, block_id, term_id)
);

COMMIT;
