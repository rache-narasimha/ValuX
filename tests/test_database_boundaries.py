"""Regression checks for schema isolation and the web runtime database role."""

from backend.app.auth.config import APP_DATABASE_USER
from backend.app.auth.database import connection


EXPECTED_AUTH_TABLES = {
    "account_tokens",
    "audit_events",
    "login_attempts",
    "mfa_credentials",
    "password_history",
    "recovery_codes",
    "schema_migrations",
    "sessions",
    "users",
}


with connection() as database:
    role = database.execute(
        """
        SELECT current_user AS name, rolsuper, rolcreatedb, rolcreaterole
        FROM pg_roles
        WHERE rolname = current_user
        """
    ).fetchone()
    assert role == {
        "name": APP_DATABASE_USER,
        "rolsuper": False,
        "rolcreatedb": False,
        "rolcreaterole": False,
    }

    auth_tables = {
        row["table_name"]
        for row in database.execute(
            """
            SELECT tablename AS table_name
            FROM pg_catalog.pg_tables
            WHERE schemaname = 'auth'
            """
        )
    }
    assert auth_tables == EXPECTED_AUTH_TABLES

    public_tables = database.execute(
        """
        SELECT COUNT(*) AS count
        FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
        """
    ).fetchone()["count"]
    assert public_tables == 0

    privileges = database.execute(
        """
        SELECT
            has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
            has_schema_privilege(current_user, 'auth', 'USAGE') AS auth_usage,
            has_table_privilege(current_user, 'auth.users', 'SELECT') AS users_select,
            has_table_privilege(current_user, 'auth.users', 'INSERT') AS users_insert,
            has_table_privilege(
                current_user, 'auth.audit_events', 'INSERT'
            ) AS audit_insert,
            has_table_privilege(
                current_user, 'auth.audit_events', 'UPDATE'
            ) AS audit_update,
            has_table_privilege(
                current_user, 'auth.login_attempts', 'DELETE'
            ) AS login_attempt_delete,
            has_table_privilege(
                current_user, 'auth.schema_migrations', 'SELECT'
            ) AS migration_read
        """
    ).fetchone()
    assert privileges == {
        "public_create": False,
        "auth_usage": True,
        "users_select": True,
        "users_insert": True,
        "audit_insert": True,
        "audit_update": False,
        "login_attempt_delete": False,
        "migration_read": False,
    }

print("PASS: authentication schema and runtime-role boundaries")
