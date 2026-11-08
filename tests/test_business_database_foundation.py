"""Structural checks for the durable business-data foundation."""

from backend.app.auth.config import APP_DATABASE_USER
from backend.app.auth.database import connection


EXPECTED_APP_TABLES = {
    "notifications",
    "estimation_snapshot_items",
    "estimation_snapshots",
    "institutions",
    "report_drafts",
    "report_draft_files",
    "report_revisions",
    "schema_migrations",
    "stored_files",
    "task_activities",
    "task_artifacts",
    "task_payments",
    "tasks",
}

EXPECTED_INDEXES = {
    "tasks_active_completion_unique",
    "tasks_active_duplicate_key_unique",
    "tasks_active_progress_date_unique",
    "tasks_linked_estimation_idx",
    "tasks_linked_snapshot_idx",
}


with connection() as database:
    current_user = database.execute("SELECT current_user AS name").fetchone()["name"]
    assert current_user == APP_DATABASE_USER

    app_tables = {
        row["table_name"]
        for row in database.execute(
            """
            SELECT tablename AS table_name
            FROM pg_catalog.pg_tables
            WHERE schemaname = 'app'
            """
        )
    }
    assert app_tables == EXPECTED_APP_TABLES

    app_indexes = {
        row["index_name"]
        for row in database.execute(
            """
            SELECT indexname AS index_name
            FROM pg_catalog.pg_indexes
            WHERE schemaname = 'app'
            """
        )
    }
    assert EXPECTED_INDEXES <= app_indexes

    same_task_constraints = {
        row["constraint_name"]
        for row in database.execute(
            """
            SELECT constraint_name
            FROM information_schema.table_constraints
            WHERE constraint_schema = 'app'
              AND constraint_name IN (
                  'task_artifacts_revision_same_task_fkey',
                  'estimation_snapshots_revision_same_task_fkey',
                  'tasks_snapshot_same_estimation_fkey',
                  'tasks_latest_artifact_same_task_fkey',
                  'tasks_final_artifact_same_task_fkey',
                  'report_draft_files_file_unique'
              )
            """
        )
    }
    assert same_task_constraints == {
        "task_artifacts_revision_same_task_fkey",
        "estimation_snapshots_revision_same_task_fkey",
        "tasks_snapshot_same_estimation_fkey",
        "tasks_latest_artifact_same_task_fkey",
        "tasks_final_artifact_same_task_fkey",
        "report_draft_files_file_unique",
    }

    privileges = database.execute(
        """
        SELECT
            has_schema_privilege(current_user, 'app', 'USAGE') AS app_usage,
            has_schema_privilege(current_user, 'app', 'CREATE') AS app_create,
            has_table_privilege(current_user, 'app.tasks', 'SELECT') AS tasks_select,
            has_table_privilege(current_user, 'app.tasks', 'UPDATE') AS tasks_update,
            has_table_privilege(current_user, 'app.tasks', 'DELETE') AS tasks_delete,
            has_table_privilege(
                current_user, 'app.task_activities', 'INSERT'
            ) AS activity_insert,
            has_table_privilege(
                current_user, 'app.task_activities', 'UPDATE'
            ) AS activity_update,
            has_table_privilege(
                current_user, 'app.report_drafts', 'DELETE'
            ) AS draft_delete,
            has_table_privilege(
                current_user, 'app.report_draft_files', 'DELETE'
            ) AS draft_file_delete,
            has_table_privilege(
                current_user, 'app.report_revisions', 'UPDATE'
            ) AS revision_update,
            has_table_privilege(
                current_user, 'app.schema_migrations', 'SELECT'
            ) AS migration_read
        """
    ).fetchone()
    assert privileges == {
        "app_usage": True,
        "app_create": False,
        "tasks_select": True,
        "tasks_update": True,
        "tasks_delete": False,
        "activity_insert": True,
        "activity_update": False,
        "draft_delete": True,
        "draft_file_delete": True,
        "revision_update": False,
        "migration_read": False,
    }

    completion_lock_comment = database.execute(
        """
        SELECT col_description('app.tasks'::regclass, ordinal_position) AS comment
        FROM information_schema.columns
        WHERE table_schema = 'app'
          AND table_name = 'tasks'
          AND column_name = 'completion_blocked_at'
        """
    ).fetchone()["comment"]
    assert completion_lock_comment
    assert "first reaches Completed" in completion_lock_comment

    seeded_codes = {
        row["code"]
        for row in database.execute(
            "SELECT code FROM app.institutions WHERE active ORDER BY code"
        )
    }
    assert {"CANARA", "KB", "KVB"} <= seeded_codes

print("PASS: durable business-data schema and runtime-role boundaries")
