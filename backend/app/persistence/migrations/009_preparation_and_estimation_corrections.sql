ALTER TABLE app.tasks
    ADD COLUMN preparation_source text CHECK (preparation_source IN ('online', 'template', 'retrospective')),
    ADD COLUMN template_downloaded_at timestamptz,
    ADD COLUMN estimation_correction_pending boolean NOT NULL DEFAULT false,
    ADD COLUMN estimation_review_required boolean NOT NULL DEFAULT false;

CREATE INDEX tasks_preparation_source_idx ON app.tasks (preparation_source);

ALTER TABLE app.task_artifacts DROP CONSTRAINT task_artifacts_artifact_type_check;
ALTER TABLE app.task_artifacts ADD CONSTRAINT task_artifacts_artifact_type_check CHECK (artifact_type IN (
    'valuation_docx', 'valuation_pdf', 'kvb_xlsx', 'valocity_docx', 'valocity_pdf',
    'estimation_xlsx', 'estimation_docx', 'estimation_pdf', 'progress_docx', 'completion_docx', 'preview_pdf'
));
