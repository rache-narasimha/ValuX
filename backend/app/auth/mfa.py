"""Authenticator enrollment, verification, and recovery use cases."""

import uuid
from datetime import timedelta
from typing import Any

from . import security
from .config import MFA_LOCKOUT_MINUTES, MFA_MAX_FAILURES
from .database import connection
from .models import AuthError, audit, now, public_user


def _assert_session_available(database, session) -> None:
    record = database.execute(
        """
        SELECT mfa_failed_attempts, mfa_locked_until
        FROM auth.sessions
        WHERE id = %s
        FOR UPDATE
        """,
        (session["id"],),
    ).fetchone()
    if not record:
        raise AuthError("Your session has expired. Sign in again.", 401, "session_expired")
    if record["mfa_locked_until"] and record["mfa_locked_until"] > now():
        raise AuthError(
            "Too many incorrect authenticator codes. Try again in 15 minutes.",
            429,
            "mfa_rate_limited",
        )
    if record["mfa_locked_until"]:
        database.execute(
            """
            UPDATE auth.sessions
            SET mfa_failed_attempts = 0, mfa_locked_until = NULL
            WHERE id = %s
            """,
            (session["id"],),
        )


def _record_failure(database, session) -> None:
    record = database.execute(
        "SELECT mfa_failed_attempts FROM auth.sessions WHERE id = %s FOR UPDATE",
        (session["id"],),
    ).fetchone()
    failures = (record["mfa_failed_attempts"] if record else 0) + 1
    locked_until = (
        now() + timedelta(minutes=MFA_LOCKOUT_MINUTES)
        if failures >= MFA_MAX_FAILURES
        else None
    )
    database.execute(
        """
        UPDATE auth.sessions
        SET mfa_failed_attempts = %s, mfa_locked_until = %s
        WHERE id = %s
        """,
        (failures, locked_until, session["id"]),
    )


def _clear_failures(database, session_id) -> None:
    database.execute(
        """
        UPDATE auth.sessions
        SET mfa_failed_attempts = 0, mfa_locked_until = NULL
        WHERE id = %s
        """,
        (session_id,),
    )


def setup(session):
    if session["scope"] != "activation" or session["activation_step"] != "mfa_setup":
        raise AuthError("Authenticator setup is not available for this session.", 403)
    with connection() as database:
        credential = database.execute(
            "SELECT * FROM auth.mfa_credentials WHERE user_id = %s",
            (session["user_id"],),
        ).fetchone()
        if credential and credential["confirmed_at"]:
            raise AuthError("Authenticator setup is already complete.", 409)
        secret = (
            security.decrypt_secret(credential["secret_encrypted"])
            if credential
            else security.new_totp_secret()
        )
        if not credential:
            database.execute(
                """
                INSERT INTO auth.mfa_credentials (user_id, secret_encrypted)
                VALUES (%s, %s)
                """,
                (session["user_id"], security.encrypt_secret(secret)),
            )
    uri = security.totp_uri(secret, session["login_id"])
    return {"secret": secret, "qr": security.qr_data_uri(uri)}


def verify_enrollment(session, code: str) -> list[str]:
    if session["scope"] != "activation" or session["activation_step"] != "mfa_setup":
        raise AuthError("Authenticator verification is not available.", 403)
    with connection() as database:
        _assert_session_available(database, session)
        credential = database.execute(
            "SELECT * FROM auth.mfa_credentials WHERE user_id = %s FOR UPDATE",
            (session["user_id"],),
        ).fetchone()
        valid_code = credential and security.verify_totp(
            security.decrypt_secret(credential["secret_encrypted"]), code.strip()
        )
        if not valid_code:
            _record_failure(database, session)
            database.commit()
            raise AuthError("That authenticator code is incorrect.", 400, "invalid_totp")
        codes = security.generate_recovery_codes()
        database.execute(
            "UPDATE auth.mfa_credentials SET confirmed_at = NOW() WHERE user_id = %s",
            (session["user_id"],),
        )
        database.execute(
            "DELETE FROM auth.recovery_codes WHERE user_id = %s", (session["user_id"],)
        )
        with database.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO auth.recovery_codes (id, user_id, code_hash)
                VALUES (%s, %s, %s)
                """,
                [
                    (
                        uuid.uuid4(),
                        session["user_id"],
                        security.recovery_hash(code_value),
                    )
                    for code_value in codes
                ],
            )
        database.execute(
            "UPDATE auth.sessions SET activation_step = 'recovery_codes' WHERE id = %s",
            (session["id"],),
        )
        _clear_failures(database, session["id"])
        audit(database, "mfa_enrolled", session["user_id"])
    return codes


def confirm_recovery_codes(session) -> str:
    if session["scope"] != "activation" or session["activation_step"] != "recovery_codes":
        raise AuthError("Recovery-code confirmation is not available.", 403)
    with connection() as database:
        user = database.execute(
            "SELECT * FROM auth.users WHERE id = %s FOR UPDATE", (session["user_id"],)
        ).fetchone()
        if user["email_verified_at"]:
            database.execute(
                "UPDATE auth.sessions SET scope = 'full', activation_step = NULL WHERE id = %s",
                (session["id"],),
            )
            database.execute(
                "UPDATE auth.users SET status = 'active', updated_at = NOW() WHERE id = %s",
                (session["user_id"],),
            )
            return "complete"
        database.execute(
            "UPDATE auth.sessions SET activation_step = 'email_setup' WHERE id = %s",
            (session["id"],),
        )
    return "email_setup"


def verify_login(session, code: str) -> dict[str, Any]:
    if session["scope"] != "mfa" or session["activation_step"] != "mfa_login":
        raise AuthError("MFA verification is not available for this session.", 403)
    with connection() as database:
        _assert_session_available(database, session)
        credential = database.execute(
            "SELECT * FROM auth.mfa_credentials WHERE user_id = %s AND confirmed_at IS NOT NULL",
            (session["user_id"],),
        ).fetchone()
        valid_code = credential and security.verify_totp(
            security.decrypt_secret(credential["secret_encrypted"]), code.strip()
        )
        if not valid_code:
            _record_failure(database, session)
            audit(database, "mfa_login_failed", session["user_id"])
            database.commit()
            raise AuthError("That authenticator code is incorrect.", 401, "invalid_totp")
        database.execute(
            "UPDATE auth.sessions SET scope = 'full', activation_step = NULL WHERE id = %s",
            (session["id"],),
        )
        _clear_failures(database, session["id"])
        user = database.execute(
            "SELECT * FROM auth.users WHERE id = %s", (session["user_id"],)
        ).fetchone()
        audit(database, "login_succeeded", session["user_id"])
        return public_user(user)


def use_recovery_code(session, code: str) -> str:
    if session["scope"] != "mfa" or session["activation_step"] != "mfa_login":
        raise AuthError("MFA recovery is not available for this session.", 403)
    with connection() as database:
        record = database.execute(
            """
            SELECT * FROM auth.recovery_codes
            WHERE user_id = %s AND code_hash = %s AND used_at IS NULL
            FOR UPDATE
            """,
            (session["user_id"], security.recovery_hash(code)),
        ).fetchone()
        if not record:
            raise AuthError("That recovery code is invalid or has already been used.", 401)
        database.execute(
            "DELETE FROM auth.mfa_credentials WHERE user_id = %s", (session["user_id"],)
        )
        database.execute(
            "DELETE FROM auth.recovery_codes WHERE user_id = %s", (session["user_id"],)
        )
        database.execute(
            "UPDATE auth.sessions SET scope = 'activation', activation_step = 'mfa_setup' WHERE id = %s",
            (session["id"],),
        )
        audit(database, "mfa_recovery_started", session["user_id"])
    return "mfa_setup"
