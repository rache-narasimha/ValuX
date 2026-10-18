"""Authentication use cases and durable session lifecycle."""

import re
import uuid
from datetime import timedelta
from typing import Any

from psycopg.errors import UniqueViolation

from . import security
from .config import (
    ACTIVATION_DAYS,
    EMAIL_VERIFICATION_HOURS,
    LOCKOUT_MINUTES,
    LOGIN_MAX_FAILURES,
    LOGIN_WINDOW_MINUTES,
    PASSWORD_RESET_MINUTES,
    SESSION_ABSOLUTE_HOURS,
    SESSION_IDLE_MINUTES,
    TOKEN_COOLDOWN_SECONDS,
)
from .database import connection
from .mfa import (
    confirm_recovery_codes,
    setup as mfa_setup,
    use_recovery_code,
    verify_enrollment as verify_mfa_enrollment,
    verify_login as verify_login_mfa,
)
from .models import AuthError, audit, now, public_user, user_for_id
from .password_policy import (
    assert_password_is_new as _assert_password_is_new,
    new_password_hash as _new_password_hash,
    record_password_hash as _record_password_hash,
)


EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
USER_ID_PATTERN = re.compile(r"^[a-z][a-z0-9._-]{2,31}$")
DUMMY_PASSWORD_HASH = security.hash_password("ValuX-Dummy!Password2026")


def provision_user(
    user_id: str,
    display_name: str,
    role: str,
    temporary_password: str,
    actor: str = "operator",
) -> dict[str, Any]:
    user_id = user_id.strip().lower()
    display_name = display_name.strip()
    if not USER_ID_PATTERN.fullmatch(user_id):
        raise AuthError("User ID must be 3–32 lowercase letters, numbers, dots, dashes, or underscores.")
    if not display_name:
        raise AuthError("Display name is required.")
    if role not in {"father", "employee"}:
        raise AuthError("Role must be father or employee.")
    password_hash = security.hash_password(temporary_password)
    try:
        with connection() as database:
            user = database.execute(
                """
                INSERT INTO auth.users (
                    id, user_id, display_name, role, status, password_hash,
                    must_change_password, activation_expires_at
                ) VALUES (%s, %s, %s, %s, 'provisioned', %s, TRUE, %s)
                RETURNING *
                """,
                (
                    uuid.uuid4(),
                    user_id,
                    display_name,
                    role,
                    password_hash,
                    now() + timedelta(days=ACTIVATION_DAYS),
                ),
            ).fetchone()
            audit(database, "account_provisioned", user["id"], actor=actor)
            _record_password_hash(database, user["id"], password_hash)
            return public_user(user)
    except UniqueViolation as error:
        raise AuthError("That User ID is already assigned.", 409, "duplicate_user") from error


def assisted_recovery(user_id: str, temporary_password: str, actor: str = "operator") -> None:
    with connection() as database:
        user = database.execute(
            "SELECT * FROM auth.users WHERE user_id = %s FOR UPDATE",
            (user_id.strip().lower(),),
        ).fetchone()
        if not user:
            raise AuthError("User ID was not found.", 404, "not_found")
        password_hash = _new_password_hash(database, user, temporary_password)
        database.execute("DELETE FROM auth.sessions WHERE user_id = %s", (user["id"],))
        database.execute("DELETE FROM auth.mfa_credentials WHERE user_id = %s", (user["id"],))
        database.execute("DELETE FROM auth.recovery_codes WHERE user_id = %s", (user["id"],))
        database.execute("DELETE FROM auth.account_tokens WHERE user_id = %s", (user["id"],))
        database.execute(
            """
            UPDATE auth.users SET status = 'provisioned', password_hash = %s,
                must_change_password = TRUE, activation_expires_at = %s,
                email = NULL, pending_email = NULL, email_verified_at = NULL,
                locked_until = NULL, updated_at = NOW()
            WHERE id = %s
            """,
            (password_hash, now() + timedelta(days=ACTIVATION_DAYS), user["id"]),
        )
        _record_password_hash(database, user["id"], password_hash)
        audit(database, "operator_assisted_recovery", user["id"], actor=actor)


def set_disabled(user_id: str, disabled: bool, actor: str = "operator") -> None:
    with connection() as database:
        user = database.execute(
            """
            SELECT u.*, m.confirmed_at AS mfa_confirmed_at
            FROM auth.users u
            LEFT JOIN auth.mfa_credentials m ON m.user_id = u.id
            WHERE u.user_id = %s FOR UPDATE OF u
            """,
            (user_id.strip().lower(),),
        ).fetchone()
        if not user:
            raise AuthError("User ID was not found.", 404, "not_found")
        status = "disabled" if disabled else (
            "active" if user["email_verified_at"] and user["mfa_confirmed_at"] else "provisioned"
        )
        database.execute(
            """
            UPDATE auth.users SET status = %s,
                activation_expires_at = CASE WHEN %s = 'provisioned' THEN %s ELSE activation_expires_at END,
                updated_at = NOW() WHERE id = %s
            """,
            (status, status, now() + timedelta(days=ACTIVATION_DAYS), user["id"]),
        )
        if disabled:
            database.execute("DELETE FROM auth.sessions WHERE user_id = %s", (user["id"],))
        audit(
            database,
            "account_disabled" if disabled else "account_enabled",
            user["id"],
            actor=actor,
        )


def create_session(user_id, scope: str, step: str | None, ip: str, user_agent: str):
    raw_token = security.new_token()
    with connection() as database:
        database.execute(
            """
            INSERT INTO auth.sessions (
                id, token_hash, user_id, scope, activation_step,
                expires_at, ip_address, user_agent
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                uuid.uuid4(),
                security.token_hash(raw_token),
                user_id,
                scope,
                step,
                now() + timedelta(hours=SESSION_ABSOLUTE_HOURS),
                ip,
                user_agent[:500],
            ),
        )
    return raw_token


def session_for_token(raw_token: str | None, refresh: bool = True):
    if not raw_token:
        return None
    with connection() as database:
        session = database.execute(
            """
            SELECT s.*, u.user_id AS login_id, u.display_name, u.role, u.status,
                   u.email, u.email_verified_at
            FROM auth.sessions s
            JOIN auth.users u ON u.id = s.user_id
            WHERE s.token_hash = %s AND s.revoked_at IS NULL
              AND s.expires_at > NOW()
              AND s.last_activity_at > NOW() - make_interval(mins => %s)
            """,
            (security.token_hash(raw_token), SESSION_IDLE_MINUTES),
        ).fetchone()
        if not session:
            database.execute(
                "DELETE FROM auth.sessions WHERE token_hash = %s",
                (security.token_hash(raw_token),),
            )
            return None
        if refresh:
            database.execute(
                "UPDATE auth.sessions SET last_activity_at = NOW() WHERE id = %s",
                (session["id"],),
            )
        return session


def update_session(session_id, scope: str, step: str | None) -> None:
    with connection() as database:
        database.execute(
            """
            UPDATE auth.sessions SET scope = %s, activation_step = %s,
                last_activity_at = NOW() WHERE id = %s
            """,
            (scope, step, session_id),
        )


def revoke_session(raw_token: str | None, ip: str | None = None) -> None:
    if not raw_token:
        return
    with connection() as database:
        session = database.execute(
            "SELECT id, user_id FROM auth.sessions WHERE token_hash = %s",
            (security.token_hash(raw_token),),
        ).fetchone()
        if session:
            database.execute(
                "UPDATE auth.sessions SET revoked_at = NOW() WHERE id = %s",
                (session["id"],),
            )
            audit(database, "logout", session["user_id"], ip=ip)


def _next_activation_step(database, user) -> str:
    if user["must_change_password"]:
        return "change_password"
    mfa = database.execute(
        "SELECT confirmed_at FROM auth.mfa_credentials WHERE user_id = %s",
        (user["id"],),
    ).fetchone()
    if not mfa or not mfa["confirmed_at"]:
        return "mfa_setup"
    if not user["email_verified_at"]:
        return "email_setup" if not user["pending_email"] else "email_verify"
    return "complete"


def login(identifier: str, password: str, ip: str, user_agent: str):
    identifier = identifier.strip().lower()
    hashed_identifier = security.identifier_hash(identifier)
    with connection() as database:
        recent_failures = database.execute(
            """
            SELECT COUNT(*) AS count FROM auth.login_attempts
            WHERE identifier_hash = %s AND succeeded = FALSE
              AND attempted_at > NOW() - make_interval(mins => %s)
            """,
            (hashed_identifier, LOGIN_WINDOW_MINUTES),
        ).fetchone()["count"]
        if recent_failures >= LOGIN_MAX_FAILURES:
            raise AuthError(
                "Too many unsuccessful attempts. Try again in 15 minutes.",
                429,
                "rate_limited",
            )
        user = database.execute(
            """
            SELECT * FROM auth.users
            WHERE user_id = %s OR (email = %s AND email_verified_at IS NOT NULL)
            """,
            (identifier, identifier),
        ).fetchone()
        password_valid = security.verify_password(
            password, user["password_hash"] if user else DUMMY_PASSWORD_HASH
        )
        valid = bool(user and password_valid)
        database.execute(
            """
            INSERT INTO auth.login_attempts
                (id, identifier_hash, user_id, ip_address, succeeded)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (uuid.uuid4(), hashed_identifier, user["id"] if user else None, ip, valid),
        )
        if not valid:
            audit(database, "login_failed", user["id"] if user else None, ip=ip)
            if user and recent_failures + 1 >= LOGIN_MAX_FAILURES:
                database.execute(
                    "UPDATE auth.users SET locked_until = %s WHERE id = %s",
                    (now() + timedelta(minutes=LOCKOUT_MINUTES), user["id"]),
                )
                audit(database, "account_locked", user["id"], ip=ip)
            # Persist the failed-attempt and lockout records before returning a
            # controlled authentication error from the surrounding transaction.
            database.commit()
            raise AuthError("Incorrect User ID/email or password.", 401, "invalid_credentials")
        if user["status"] == "disabled":
            raise AuthError("This account is disabled. Contact the account operator.", 403, "disabled")
        if user["locked_until"] and user["locked_until"] > now():
            raise AuthError("This account is temporarily locked. Try again later.", 423, "locked")
        database.execute(
            "UPDATE auth.users SET locked_until = NULL, updated_at = NOW() WHERE id = %s",
            (user["id"],),
        )
        if user["status"] == "provisioned" and (
            not user["activation_expires_at"] or user["activation_expires_at"] < now()
        ):
            raise AuthError("The activation password has expired. Contact the account operator.", 403, "activation_expired")
        step = _next_activation_step(database, user)
        scope = "mfa" if user["status"] == "active" and step == "complete" else "activation"
        step = "mfa_login" if scope == "mfa" else step
        audit(database, "primary_login_succeeded", user["id"], ip=ip)
    token = create_session(user["id"], scope, step, ip, user_agent)
    return token, step, public_user(user)


def change_activation_password(session, new_password: str) -> str:
    if session["scope"] != "activation" or session["activation_step"] != "change_password":
        raise AuthError("Password setup is not available for this session.", 403)
    with connection() as database:
        user = database.execute(
            "SELECT * FROM auth.users WHERE id = %s FOR UPDATE", (session["user_id"],)
        ).fetchone()
        password_hash = _new_password_hash(database, user, new_password)
        database.execute(
            """
            UPDATE auth.users SET password_hash = %s, must_change_password = FALSE,
                status = 'activating', activation_expires_at = NULL, updated_at = NOW()
            WHERE id = %s
            """,
            (password_hash, user["id"]),
        )
        _record_password_hash(database, user["id"], password_hash)
        database.execute(
            "UPDATE auth.sessions SET activation_step = 'mfa_setup' WHERE id = %s",
            (session["id"],),
        )
        audit(database, "permanent_password_set", user["id"])
    return "mfa_setup"


def create_account_token(database, user_id, token_type: str, target_email=None):
    recent = database.execute(
        """
        SELECT 1 FROM auth.account_tokens
        WHERE user_id = %s AND token_type = %s AND used_at IS NULL
          AND created_at > NOW() - make_interval(secs => %s)
        """,
        (user_id, token_type, TOKEN_COOLDOWN_SECONDS),
    ).fetchone()
    if recent:
        return None
    database.execute(
        "DELETE FROM auth.account_tokens WHERE user_id = %s AND token_type = %s AND used_at IS NULL",
        (user_id, token_type),
    )
    raw = security.new_token()
    lifetime = EMAIL_VERIFICATION_HOURS * 60 if token_type == "email_verification" else PASSWORD_RESET_MINUTES
    database.execute(
        """
        INSERT INTO auth.account_tokens
            (id, user_id, token_type, token_hash, target_email, expires_at)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (
            uuid.uuid4(), user_id, token_type, security.token_hash(raw), target_email,
            now() + timedelta(minutes=lifetime),
        ),
    )
    return raw


def invalidate_account_token(raw_token: str) -> None:
    with connection() as database:
        database.execute(
            "UPDATE auth.account_tokens SET used_at = NOW() WHERE token_hash = %s",
            (security.token_hash(raw_token),),
        )


def begin_email_verification(session, email: str):
    if session["scope"] != "activation" or session["activation_step"] not in {"email_setup", "email_verify"}:
        raise AuthError("Recovery-email setup is not available for this session.", 403)
    email = email.strip().lower()
    if not EMAIL_PATTERN.fullmatch(email):
        raise AuthError("Enter a valid email address.")
    try:
        with connection() as database:
            user = database.execute(
                "SELECT * FROM auth.users WHERE id = %s FOR UPDATE", (session["user_id"],)
            ).fetchone()
            database.execute(
                "UPDATE auth.users SET pending_email = %s, updated_at = NOW() WHERE id = %s",
                (email, user["id"]),
            )
            token = create_account_token(database, user["id"], "email_verification", email)
            database.execute(
                "UPDATE auth.sessions SET activation_step = 'email_verify' WHERE id = %s",
                (session["id"],),
            )
            return token, {**user, "pending_email": email}
    except UniqueViolation as error:
        raise AuthError("That email address is already linked to another account.", 409) from error


def resend_email_verification(session):
    if session["scope"] != "activation" or session["activation_step"] != "email_verify":
        raise AuthError("Email verification is not pending for this session.", 403)
    with connection() as database:
        user = database.execute("SELECT * FROM auth.users WHERE id = %s", (session["user_id"],)).fetchone()
        if not user["pending_email"]:
            raise AuthError("Add a recovery email first.")
        token = create_account_token(database, user["id"], "email_verification", user["pending_email"])
        return token, user


def verify_email_token(raw_token: str, current_session=None):
    with connection() as database:
        record = database.execute(
            """
            SELECT t.*, u.*,
                   t.id AS token_id, t.user_id AS token_user_id
            FROM auth.account_tokens t
            JOIN auth.users u ON u.id = t.user_id
            WHERE t.token_hash = %s AND t.token_type = 'email_verification'
              AND t.used_at IS NULL AND t.expires_at > NOW()
            FOR UPDATE OF t, u
            """,
            (security.token_hash(raw_token),),
        ).fetchone()
        if not record or record["target_email"] != record["pending_email"]:
            raise AuthError("This verification link is invalid or has expired.")
        database.execute("UPDATE auth.account_tokens SET used_at = NOW() WHERE id = %s", (record["token_id"],))
        database.execute(
            """
            UPDATE auth.users SET email = %s, pending_email = NULL,
                email_verified_at = NOW(), status = 'active', updated_at = NOW()
            WHERE id = %s
            """,
            (record["target_email"], record["token_user_id"]),
        )
        same_session = bool(
            current_session
            and current_session["user_id"] == record["token_user_id"]
            and current_session["scope"] == "activation"
        )
        if same_session:
            database.execute(
                "UPDATE auth.sessions SET scope = 'full', activation_step = NULL WHERE id = %s",
                (current_session["id"],),
            )
        audit(database, "email_verified", record["token_user_id"])
        audit(database, "activation_completed", record["token_user_id"])
        user = database.execute("SELECT * FROM auth.users WHERE id = %s", (record["token_user_id"],)).fetchone()
        return public_user(user), same_session


def request_password_reset(identifier: str):
    identifier = identifier.strip().lower()
    with connection() as database:
        user = database.execute(
            """
            SELECT * FROM auth.users
            WHERE status = 'active' AND email_verified_at IS NOT NULL
              AND (user_id = %s OR email = %s)
            """,
            (identifier, identifier),
        ).fetchone()
        if not user:
            return None, None
        token = create_account_token(database, user["id"], "password_reset", user["email"])
        audit(database, "password_reset_requested", user["id"])
        return token, user


def reset_password(raw_token: str, new_password: str) -> None:
    with connection() as database:
        record = database.execute(
            """
            SELECT t.id AS token_id, t.user_id, u.id AS id, u.password_hash
            FROM auth.account_tokens t
            JOIN auth.users u ON u.id = t.user_id
            WHERE t.token_hash = %s AND t.token_type = 'password_reset'
              AND t.used_at IS NULL AND t.expires_at > NOW()
              AND u.status = 'active'
            FOR UPDATE OF t, u
            """,
            (security.token_hash(raw_token),),
        ).fetchone()
        if not record:
            raise AuthError("This reset link is invalid or has expired.")
        password_hash = _new_password_hash(database, record, new_password)
        database.execute(
            "UPDATE auth.users SET password_hash = %s, updated_at = NOW() WHERE id = %s",
            (password_hash, record["user_id"]),
        )
        _record_password_hash(database, record["user_id"], password_hash)
        database.execute("UPDATE auth.account_tokens SET used_at = NOW() WHERE id = %s", (record["token_id"],))
        database.execute("UPDATE auth.sessions SET revoked_at = NOW() WHERE user_id = %s", (record["user_id"],))
        audit(database, "password_reset_completed", record["user_id"])
