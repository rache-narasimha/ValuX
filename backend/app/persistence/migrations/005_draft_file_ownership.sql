-- A stored draft-media file belongs to exactly one task. This prevents a
-- malformed direct database write from sharing a task-scoped image reference
-- across assignments.

ALTER TABLE app.report_draft_files
    ADD CONSTRAINT report_draft_files_file_unique UNIQUE (stored_file_id);
