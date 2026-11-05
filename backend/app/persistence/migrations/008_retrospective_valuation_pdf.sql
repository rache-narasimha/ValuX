ALTER TABLE app.task_artifacts
    DROP CONSTRAINT task_artifacts_artifact_type_check;

ALTER TABLE app.task_artifacts
    ADD CONSTRAINT task_artifacts_artifact_type_check
    CHECK (artifact_type IN (
        'valuation_docx', 'valuation_pdf', 'kvb_xlsx', 'valocity_docx', 'valocity_pdf',
        'estimation_xlsx', 'progress_docx', 'completion_docx', 'preview_pdf'
    ));
