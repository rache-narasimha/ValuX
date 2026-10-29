-- Prevent a task from pointing at another task's report revision, artifact, or
-- estimation snapshot. These composite references keep file and snapshot
-- metadata attached to the business record that owns it.

ALTER TABLE app.report_revisions
    ADD CONSTRAINT report_revisions_id_task_unique UNIQUE (id, task_id);

ALTER TABLE app.task_artifacts
    ADD CONSTRAINT task_artifacts_id_task_unique UNIQUE (id, task_id),
    DROP CONSTRAINT task_artifacts_report_revision_id_fkey,
    ADD CONSTRAINT task_artifacts_revision_same_task_fkey
        FOREIGN KEY (report_revision_id, task_id)
        REFERENCES app.report_revisions(id, task_id)
        ON DELETE RESTRICT;

ALTER TABLE app.estimation_snapshots
    ADD CONSTRAINT estimation_snapshots_id_task_unique
        UNIQUE (id, estimation_task_id),
    DROP CONSTRAINT estimation_snapshots_source_revision_id_fkey,
    ADD CONSTRAINT estimation_snapshots_revision_same_task_fkey
        FOREIGN KEY (source_revision_id, estimation_task_id)
        REFERENCES app.report_revisions(id, task_id)
        ON DELETE RESTRICT;

ALTER TABLE app.tasks
    DROP CONSTRAINT tasks_linked_estimation_snapshot_id_fkey,
    DROP CONSTRAINT tasks_latest_artifact_id_fkey,
    DROP CONSTRAINT tasks_final_artifact_id_fkey,
    ADD CONSTRAINT tasks_snapshot_same_estimation_fkey
        FOREIGN KEY (linked_estimation_snapshot_id, linked_estimation_task_id)
        REFERENCES app.estimation_snapshots(id, estimation_task_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT tasks_latest_artifact_same_task_fkey
        FOREIGN KEY (latest_artifact_id, id)
        REFERENCES app.task_artifacts(id, task_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT tasks_final_artifact_same_task_fkey
        FOREIGN KEY (final_artifact_id, id)
        REFERENCES app.task_artifacts(id, task_id)
        ON DELETE RESTRICT;
