-- Link task-draft media stored on the local filesystem to its owning task.
-- The draft JSON keeps only authenticated file references, never image bytes.

CREATE TABLE app.report_draft_files (
    task_id UUID NOT NULL REFERENCES app.tasks(id) ON DELETE RESTRICT,
    stored_file_id UUID NOT NULL REFERENCES app.stored_files(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, stored_file_id)
);

CREATE INDEX report_draft_files_file_idx
    ON app.report_draft_files(stored_file_id);
