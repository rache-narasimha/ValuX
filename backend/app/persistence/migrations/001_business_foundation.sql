-- Durable business-data foundation for ValuX / SLN Property Reports.
-- Authentication remains isolated in the existing auth schema.

CREATE TABLE app.institutions (
    id UUID PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    institution_type TEXT NOT NULL
        CHECK (institution_type IN ('Bank', 'NBFC')),
    color CHAR(7) NOT NULL DEFAULT '#087ea4'
        CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (code = UPPER(BTRIM(code))),
    CHECK (BTRIM(code) <> ''),
    CHECK (BTRIM(name) <> '')
);

CREATE INDEX institutions_active_type_idx
    ON app.institutions(active, institution_type, name);

CREATE TABLE app.tasks (
    id UUID PRIMARY KEY,
    task_code TEXT NOT NULL UNIQUE,
    report_key TEXT NOT NULL
        CHECK (report_key IN (
            'valuation-general', 'valuation-agricultural', 'estimation',
            'progress', 'completion'
        )),
    report_group TEXT NOT NULL
        CHECK (report_group IN (
            'valuation', 'estimation', 'progress', 'completion'
        )),
    institution_id UUID NOT NULL
        REFERENCES app.institutions(id) ON DELETE RESTRICT,
    institution_code_snapshot TEXT NOT NULL,
    institution_name_snapshot TEXT NOT NULL,
    institution_type_snapshot TEXT NOT NULL
        CHECK (institution_type_snapshot IN ('Bank', 'NBFC')),
    branch TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    property_brief TEXT NOT NULL,
    assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    assignee_name_snapshot TEXT,
    created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    priority TEXT NOT NULL CHECK (priority IN ('Urgent', 'High', 'Normal')),
    status TEXT NOT NULL
        CHECK (status IN (
            'Unassigned', 'In Progress', 'On Hold',
            'Completed', 'Closed', 'Cancelled'
        )),
    hold_reason TEXT,
    cancellation_reason TEXT,
    assigned_date DATE NOT NULL,
    due_date DATE NOT NULL,
    linked_estimation_task_id UUID
        REFERENCES app.tasks(id) ON DELETE RESTRICT,
    duplicate_key TEXT,
    report_generated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    reopened_at TIMESTAMPTZ,
    completion_blocked_at TIMESTAMPTZ,
    completion_blocked_by_task_id UUID
        REFERENCES app.tasks(id) ON DELETE RESTRICT,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (BTRIM(task_code) <> ''),
    CHECK (BTRIM(branch) <> ''),
    CHECK (BTRIM(customer_name) <> ''),
    CHECK (BTRIM(property_brief) <> ''),
    CHECK (due_date >= assigned_date),
    CHECK (status <> 'Unassigned' OR assignee_user_id IS NULL),
    CHECK (
        status NOT IN ('In Progress', 'On Hold', 'Completed', 'Closed') OR
        assignee_user_id IS NOT NULL
    ),
    CHECK (
        (status = 'On Hold' AND NULLIF(BTRIM(hold_reason), '') IS NOT NULL) OR
        (status <> 'On Hold' AND hold_reason IS NULL)
    ),
    CHECK (
        (report_group IN ('progress', 'completion')) =
        (linked_estimation_task_id IS NOT NULL)
    ),
    CHECK (
        (completion_blocked_at IS NULL) =
        (completion_blocked_by_task_id IS NULL)
    )
);

COMMENT ON COLUMN app.tasks.completion_blocked_at IS
    'Permanent lock set on an estimation when its linked Completion task first reaches Completed.';

CREATE UNIQUE INDEX tasks_active_duplicate_key_unique
    ON app.tasks(duplicate_key)
    WHERE duplicate_key IS NOT NULL
      AND report_group IN ('valuation', 'estimation')
      AND status <> 'Cancelled';

CREATE UNIQUE INDEX tasks_active_progress_date_unique
    ON app.tasks(linked_estimation_task_id, assigned_date)
    WHERE report_group = 'progress' AND status <> 'Cancelled';

CREATE UNIQUE INDEX tasks_active_completion_unique
    ON app.tasks(linked_estimation_task_id)
    WHERE report_group = 'completion' AND status <> 'Cancelled';

CREATE INDEX tasks_status_updated_idx ON app.tasks(status, updated_at DESC);
CREATE INDEX tasks_assignee_status_idx
    ON app.tasks(assignee_user_id, status, updated_at DESC);
CREATE INDEX tasks_institution_date_idx
    ON app.tasks(institution_id, assigned_date DESC);
CREATE INDEX tasks_report_group_status_idx
    ON app.tasks(report_group, status, updated_at DESC);
CREATE INDEX tasks_linked_estimation_idx
    ON app.tasks(linked_estimation_task_id, report_group, status);

CREATE TABLE app.task_activities (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES app.tasks(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL,
    actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    actor_name_snapshot TEXT NOT NULL,
    message TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (BTRIM(event_type) <> ''),
    CHECK (BTRIM(actor_name_snapshot) <> ''),
    CHECK (BTRIM(message) <> ''),
    CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX task_activities_task_time_idx
    ON app.task_activities(task_id, created_at DESC);
CREATE INDEX task_activities_actor_time_idx
    ON app.task_activities(actor_user_id, created_at DESC);

CREATE TABLE app.task_payments (
    task_id UUID PRIMARY KEY REFERENCES app.tasks(id) ON DELETE RESTRICT,
    estimated_fee NUMERIC(14, 2) CHECK (estimated_fee >= 0),
    agreed_fee NUMERIC(14, 2) CHECK (agreed_fee >= 0),
    received_amount NUMERIC(14, 2) NOT NULL DEFAULT 0
        CHECK (received_amount >= 0),
    due_date DATE,
    updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        received_amount = 0 OR
        received_amount <= COALESCE(agreed_fee, estimated_fee)
    )
);

CREATE INDEX task_payments_due_date_idx ON app.task_payments(due_date);

CREATE TABLE app.stored_files (
    id UUID PRIMARY KEY,
    storage_backend TEXT NOT NULL DEFAULT 'local'
        CHECK (storage_backend IN ('local', 'object')),
    storage_key TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9A-Fa-f]{64}$'),
    created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at TIMESTAMPTZ,
    CHECK (BTRIM(storage_key) <> ''),
    CHECK (BTRIM(original_filename) <> ''),
    CHECK (BTRIM(content_type) <> '')
);

CREATE INDEX stored_files_created_idx ON app.stored_files(created_at DESC);

CREATE TABLE app.report_revisions (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES app.tasks(id) ON DELETE RESTRICT,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    report_key TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    template_version TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (task_id, revision_number),
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX report_revisions_task_time_idx
    ON app.report_revisions(task_id, created_at DESC);

CREATE TABLE app.task_artifacts (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES app.tasks(id) ON DELETE RESTRICT,
    stored_file_id UUID NOT NULL
        REFERENCES app.stored_files(id) ON DELETE RESTRICT,
    report_revision_id UUID
        REFERENCES app.report_revisions(id) ON DELETE RESTRICT,
    artifact_type TEXT NOT NULL
        CHECK (artifact_type IN (
            'valuation_docx', 'kvb_xlsx', 'valocity_docx', 'valocity_pdf',
            'estimation_xlsx', 'progress_docx', 'completion_docx',
            'preview_pdf'
        )),
    artifact_source TEXT NOT NULL
        CHECK (artifact_source IN ('generated', 'uploaded')),
    created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    superseded_at TIMESTAMPTZ,
    UNIQUE (stored_file_id)
);

CREATE INDEX task_artifacts_task_time_idx
    ON app.task_artifacts(task_id, created_at DESC);
CREATE INDEX task_artifacts_current_idx
    ON app.task_artifacts(task_id, artifact_type, created_at DESC)
    WHERE superseded_at IS NULL;

CREATE TABLE app.report_drafts (
    task_id UUID PRIMARY KEY REFERENCES app.tasks(id) ON DELETE RESTRICT,
    report_key TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX report_drafts_updated_idx ON app.report_drafts(updated_at DESC);

CREATE TABLE app.estimation_snapshots (
    id UUID PRIMARY KEY,
    estimation_task_id UUID NOT NULL
        REFERENCES app.tasks(id) ON DELETE RESTRICT,
    source_revision_id UUID
        REFERENCES app.report_revisions(id) ON DELETE RESTRICT,
    snapshot_number INTEGER NOT NULL CHECK (snapshot_number > 0),
    applicant_name TEXT NOT NULL,
    applicant_address TEXT NOT NULL DEFAULT '',
    project_location TEXT NOT NULL,
    work_description TEXT NOT NULL DEFAULT '',
    property_type TEXT NOT NULL,
    construction_type TEXT NOT NULL DEFAULT '',
    property_subtype TEXT NOT NULL DEFAULT '',
    total_estimated_cost NUMERIC(16, 2) NOT NULL
        CHECK (total_estimated_cost >= 0),
    created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (estimation_task_id, snapshot_number),
    CHECK (BTRIM(applicant_name) <> ''),
    CHECK (BTRIM(project_location) <> ''),
    CHECK (BTRIM(property_type) <> '')
);

CREATE INDEX estimation_snapshots_task_time_idx
    ON app.estimation_snapshots(estimation_task_id, created_at DESC);

CREATE TABLE app.estimation_snapshot_items (
    id UUID PRIMARY KEY,
    snapshot_id UUID NOT NULL
        REFERENCES app.estimation_snapshots(id) ON DELETE RESTRICT,
    item_key TEXT NOT NULL,
    label TEXT NOT NULL,
    source_type TEXT NOT NULL
        CHECK (source_type IN ('component', 'common', 'workbook')),
    estimated_cost NUMERIC(16, 2) NOT NULL CHECK (estimated_cost >= 0),
    display_order INTEGER NOT NULL CHECK (display_order >= 0),
    details JSONB NOT NULL DEFAULT '{}'::JSONB,
    UNIQUE (snapshot_id, item_key),
    CHECK (BTRIM(item_key) <> ''),
    CHECK (BTRIM(label) <> ''),
    CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX estimation_snapshot_items_order_idx
    ON app.estimation_snapshot_items(snapshot_id, display_order);

ALTER TABLE app.tasks
    ADD COLUMN linked_estimation_snapshot_id UUID
        REFERENCES app.estimation_snapshots(id) ON DELETE RESTRICT,
    ADD COLUMN latest_artifact_id UUID
        REFERENCES app.task_artifacts(id) ON DELETE RESTRICT,
    ADD COLUMN final_artifact_id UUID
        REFERENCES app.task_artifacts(id) ON DELETE RESTRICT;

CREATE INDEX tasks_linked_snapshot_idx
    ON app.tasks(linked_estimation_snapshot_id);

COMMENT ON SCHEMA app IS
    'Durable SLN workflow, payment, report-draft, artifact and estimation-link data';
