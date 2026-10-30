-- Persist the report-input identity used for preview and final-artifact
-- freshness checks.  The file itself remains in the configured file store;
-- PostgreSQL records only the immutable identity and lifecycle metadata.

ALTER TABLE app.report_drafts
    ADD COLUMN input_fingerprint CHAR(64),
    ADD COLUMN preview_fingerprint CHAR(64),
    ADD COLUMN preview_token TEXT,
    ADD COLUMN preview_artifact_id UUID REFERENCES app.task_artifacts(id) ON DELETE SET NULL,
    ADD CONSTRAINT report_drafts_input_fingerprint_check
        CHECK (input_fingerprint IS NULL OR input_fingerprint ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT report_drafts_preview_fingerprint_check
        CHECK (preview_fingerprint IS NULL OR preview_fingerprint ~ '^[0-9a-f]{64}$');

ALTER TABLE app.report_revisions
    ADD COLUMN input_fingerprint CHAR(64),
    ADD CONSTRAINT report_revisions_input_fingerprint_check
        CHECK (input_fingerprint IS NULL OR input_fingerprint ~ '^[0-9a-f]{64}$');

ALTER TABLE app.task_artifacts
    ADD COLUMN input_fingerprint CHAR(64),
    ADD COLUMN stale_at TIMESTAMPTZ,
    ADD CONSTRAINT task_artifacts_input_fingerprint_check
        CHECK (input_fingerprint IS NULL OR input_fingerprint ~ '^[0-9a-f]{64}$');

CREATE INDEX task_artifacts_task_preview_fingerprint_idx
    ON app.task_artifacts(task_id, artifact_type, input_fingerprint, created_at DESC);
