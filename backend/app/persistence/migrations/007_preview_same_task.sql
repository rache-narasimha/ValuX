-- A persisted preview may only reference an artifact owned by the same task.

ALTER TABLE app.report_drafts
    DROP CONSTRAINT report_drafts_preview_artifact_id_fkey,
    ADD CONSTRAINT report_drafts_preview_same_task_fkey
        FOREIGN KEY (preview_artifact_id, task_id)
        REFERENCES app.task_artifacts(id, task_id)
        ON DELETE SET NULL (preview_artifact_id);
