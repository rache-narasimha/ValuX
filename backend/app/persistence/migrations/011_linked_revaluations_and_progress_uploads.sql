ALTER TABLE app.task_artifacts
    DROP CONSTRAINT task_artifacts_artifact_type_check,
    ADD CONSTRAINT task_artifacts_artifact_type_check CHECK (artifact_type IN (
        'valuation_docx', 'valuation_pdf', 'kvb_xlsx', 'valocity_docx', 'valocity_pdf',
        'estimation_xlsx', 'estimation_docx', 'estimation_pdf',
        'progress_docx', 'progress_pdf', 'completion_docx', 'completion_pdf', 'preview_pdf'
    ));

ALTER TABLE app.tasks
    DROP CONSTRAINT tasks_report_group_check,
    ADD CONSTRAINT tasks_report_group_check CHECK (report_group IN (
        'valuation', 'revaluation', 'estimation', 'progress', 'completion'
    )),
    ADD COLUMN linked_valuation_task_id UUID REFERENCES app.tasks(id) ON DELETE RESTRICT,
    ADD COLUMN linked_valuation_artifact_id UUID,
    ADD COLUMN revaluation_manual_entry BOOLEAN NOT NULL DEFAULT FALSE,
    ADD CONSTRAINT tasks_linked_valuation_artifact_owner
        FOREIGN KEY (linked_valuation_artifact_id, linked_valuation_task_id)
        REFERENCES app.task_artifacts(id, task_id) ON DELETE RESTRICT,
    ADD CONSTRAINT tasks_revaluation_link_check CHECK (
        (report_group = 'revaluation') = (linked_valuation_task_id IS NOT NULL)
        AND (linked_valuation_artifact_id IS NULL OR linked_valuation_task_id IS NOT NULL)
        AND (report_group <> 'revaluation' OR report_key IN ('valuation-general', 'valuation-agricultural'))
    );

CREATE INDEX tasks_linked_valuation_idx ON app.tasks(linked_valuation_task_id);
CREATE INDEX tasks_linked_valuation_artifact_idx ON app.tasks(linked_valuation_artifact_id);
