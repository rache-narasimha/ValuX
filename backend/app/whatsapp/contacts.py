"""Bind a verified number and alert consent to the signed-in account."""

import hmac
import re
import secrets
import time
import uuid
from datetime import timedelta

from psycopg.errors import UniqueViolation

from ..auth import security
from ..auth.config import AUTH_RECOVERY_PEPPER, SESSION_IDLE_MINUTES
from ..auth.database import connection
from ..auth.models import AuthError, audit, now
from . import config, provider

SETUP = "whatsapp_setup"
CODE_LIFETIME = timedelta(minutes=10)


def _digest(purpose, value):
    return hmac.digest(AUTH_RECOVERY_PEPPER.encode(), f"valux-whatsapp:{purpose}:{value}".encode(), "sha256").hex()


def normalize_phone(value):
    phone = re.sub(r"[ ()-]", "", value.strip()) if isinstance(value, str) else ""
    if not re.fullmatch(r"\+[1-9][0-9]{7,14}", phone):
        raise AuthError("Enter your WhatsApp number with its country code, for example +91 followed by your mobile number.")
    return phone


def phone_lookup_key(phone):
    return _digest("number", phone)


def needs_setup(database, user_id):
    return config.REQUIRE_VERIFICATION and not database.execute(
        "SELECT 1 FROM app.whatsapp_contacts WHERE user_id = %s", (user_id,)
    ).fetchone()


def verify_storage():
    if config.enabled():
        with connection() as database:
            database.execute("SELECT 1 FROM app.whatsapp_contacts LIMIT 0")
            database.execute("SELECT 1 FROM app.whatsapp_challenges LIMIT 0")
            database.execute("SELECT 1 FROM app.whatsapp_outbox LIMIT 0")


def finish_authentication(database, user_id, session_id, *, activate=False):
    if needs_setup(database, user_id):
        database.execute(
            "UPDATE auth.sessions SET scope = 'activation', activation_step = %s WHERE id = %s",
            (SETUP, session_id),
        )
        return SETUP
    database.execute(
        "UPDATE auth.sessions SET scope = 'full', activation_step = NULL WHERE id = %s", (session_id,)
    )
    if activate:
        database.execute(
            "UPDATE auth.users SET status = 'active', updated_at = NOW() WHERE id = %s", (user_id,)
        )
        audit(database, "activation_completed", user_id)
    return "complete"


def enforce_session(session):
    if session and session["scope"] == "full" and session["status"] == "active" and config.REQUIRE_VERIFICATION:
        with connection() as database:
            if needs_setup(database, session["user_id"]):
                database.execute(
                    "UPDATE auth.sessions SET scope = 'activation', activation_step = %s "
                    "WHERE id = %s AND scope = 'full' AND revoked_at IS NULL",
                    (SETUP, session["id"]),
                )
                return {**session, "scope": "activation", "activation_step": SETUP}
    if session and session["activation_step"] == SETUP and session["status"] in {"active", "activating"}:
        with connection() as database:
            if needs_setup(database, session["user_id"]):
                return session
            current = _lock_account(database, session)
            finish_authentication(
                database, session["user_id"], session["id"], activate=current["status"] == "activating"
            )
        return {**session, "scope": "full", "status": "active", "activation_step": None}
    return session


def _setting_allowed(session):
    return (
        session["scope"] == "full" and session["status"] == "active"
    ) or (
        session["scope"] == "activation" and session["activation_step"] == SETUP
        and session["status"] in {"activating", "active"}
    )


def _lock_account(database, session):
    account = database.execute(
        "SELECT status, email_verified_at FROM auth.users WHERE id = %s FOR UPDATE", (session["user_id"],)
    ).fetchone()
    current = database.execute(
        "SELECT scope, activation_step FROM auth.sessions WHERE id = %s AND user_id = %s "
        "AND revoked_at IS NULL AND expires_at > NOW() "
        "AND last_activity_at > NOW() - make_interval(mins => %s) FOR UPDATE",
        (session["id"], session["user_id"], SESSION_IDLE_MINUTES),
    ).fetchone()
    if not account or not account["email_verified_at"] or not current or not _setting_allowed({**account, **current}):
        raise AuthError("Sign in again to manage your WhatsApp number.", 401, "session_expired")
    return {**account, **current}


def _fresh_authenticator(database, session, code):
    from ..auth import mfa

    mfa._assert_session_available(database, session)
    credential = database.execute(
        "SELECT secret_encrypted, last_account_totp_counter FROM auth.mfa_credentials "
        "WHERE user_id = %s AND confirmed_at IS NOT NULL FOR UPDATE", (session["user_id"],)
    ).fetchone()
    matched = None
    if credential and isinstance(code, str) and re.fullmatch(r"[0-9]{6}", code):
        counter = int(time.time()) // 30
        secret = security.decrypt_secret(credential["secret_encrypted"])
        matched = next((step for step in (counter - 1, counter, counter + 1)
                        if secrets.compare_digest(security.totp_code(secret, step * 30), code)), None)
    previous = credential["last_account_totp_counter"] if credential else None
    if matched is None or (previous is not None and matched <= previous):
        mfa._record_failure(database, session)
        audit(database, "whatsapp_number_reauthentication_failed", session["user_id"])
        database.commit()
        raise AuthError("Use a fresh code from your authenticator app.", 400, "reauthentication_failed")
    database.execute(
        "UPDATE auth.mfa_credentials SET last_account_totp_counter = %s WHERE user_id = %s",
        (matched, session["user_id"]),
    )
    mfa._clear_failures(database, session["id"])


def status(session):
    if not config.enabled():
        return {"enabled": False}
    if not _setting_allowed(session):
        raise AuthError("Complete sign-in to manage your WhatsApp number.", 403, "forbidden")
    with connection() as database:
        contact = database.execute(
            "SELECT phone_encrypted, opted_in_at FROM app.whatsapp_contacts WHERE user_id = %s", (session["user_id"],)
        ).fetchone()
        pending = database.execute(
            "SELECT phone_encrypted FROM app.whatsapp_challenges WHERE user_id = %s "
            "AND session_id = %s AND code_hash IS NOT NULL AND failed_attempts < 5 AND expires_at > NOW()",
            (session["user_id"], session["id"]),
        ).fetchone()
    return {
        "enabled": True,
        "verified": bool(contact),
        "ending": security.decrypt_secret(contact["phone_encrypted"])[-4:] if contact else None,
        "alerts": bool(contact and contact["opted_in_at"]),
        "pendingEnding": security.decrypt_secret(pending["phone_encrypted"])[-4:] if pending else None,
    }


def start(session, payload):
    if not config.enabled():
        raise AuthError("WhatsApp verification is unavailable.", 503, "whatsapp_unavailable")
    number = normalize_phone(payload.get("number"))
    if payload.get("requestCode") is not True or not isinstance(payload.get("alerts"), bool):
        raise AuthError("Confirm that ValuX may send a verification code to this number.")
    phone_key = phone_lookup_key(number)
    challenge_id = uuid.uuid4()
    code = f"{secrets.randbelow(1_000_000):06d}"
    with connection() as database:
        current = _lock_account(database, session)
        last = database.execute(
            "SELECT sent_at, window_started_at, window_count FROM app.whatsapp_challenges WHERE user_id = %s",
            (session["user_id"],),
        ).fetchone()
        instant = now()
        within_window = last and last["window_started_at"] > instant - timedelta(hours=1)
        if last and last["sent_at"] > instant - timedelta(minutes=1):
            raise AuthError("Wait one minute before requesting another WhatsApp code.", 429, "code_cooldown")
        if within_window and last["window_count"] >= 5:
            raise AuthError("Too many WhatsApp codes requested. Try again later.", 429, "code_rate_limited")
        if current["scope"] == "full":
            _fresh_authenticator(database, session, payload.get("authenticator"))
        database.execute(
            """
            INSERT INTO app.whatsapp_challenges
              (user_id, id, session_id, phone_key, phone_encrypted, code_hash, consent,
               sent_at, expires_at, window_started_at, window_count)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT(user_id) DO UPDATE SET id=excluded.id, session_id=excluded.session_id,
              phone_key=excluded.phone_key, phone_encrypted=excluded.phone_encrypted, code_hash=excluded.code_hash,
              consent=excluded.consent, failed_attempts=0, sent_at=excluded.sent_at, expires_at=excluded.expires_at,
              window_started_at=excluded.window_started_at, window_count=excluded.window_count
            """,
            (session["user_id"], challenge_id, session["id"], phone_key, security.encrypt_secret(number),
             _digest("code", f"{challenge_id}:{code}"), payload["alerts"], instant, instant + CODE_LIFETIME,
             last["window_started_at"] if within_window else instant, last["window_count"] + 1 if within_window else 1),
        )
    try:
        provider.send_code(number, code)
    except provider.DeliveryError as error:
        if error.outcome != "uncertain":
            with connection() as database:
                _clear_challenge(database, challenge_id)
            raise AuthError("WhatsApp could not send a verification code. Try again shortly.", 503, "whatsapp_unavailable") from None
        return {"ending": number[-4:], "uncertain": True}
    return {"ending": number[-4:]}


def _clear_challenge(database, challenge_id):
    database.execute(
        "UPDATE app.whatsapp_challenges SET phone_key=NULL, phone_encrypted=NULL, code_hash=NULL, consent=FALSE "
        "WHERE id = %s", (challenge_id,)
    )


def _cancel_queued(database, user_id):
    database.execute(
        "UPDATE app.whatsapp_outbox SET status='cancelled' WHERE recipient_id=%s AND status='queued'", (user_id,)
    )


def confirm(session, code):
    if not config.enabled():
        raise AuthError("WhatsApp verification is unavailable.", 503, "whatsapp_unavailable")
    try:
        with connection() as database:
            account = _lock_account(database, session)
            pending = database.execute(
                "SELECT * FROM app.whatsapp_challenges WHERE user_id=%s AND session_id=%s "
                "AND code_hash IS NOT NULL AND expires_at > NOW() FOR UPDATE",
                (session["user_id"], session["id"]),
            ).fetchone()
            if not pending or pending["failed_attempts"] >= 5:
                raise AuthError("Request a new WhatsApp verification code.", 400, "code_expired")
            if not isinstance(code, str) or not re.fullmatch(r"[0-9]{6}", code) or not hmac.compare_digest(
                pending["code_hash"], _digest("code", f"{pending['id']}:{code}")
            ):
                database.execute(
                    "UPDATE app.whatsapp_challenges SET failed_attempts=failed_attempts+1 WHERE id=%s",
                    (pending["id"],),
                )
                if pending["failed_attempts"] == 4:
                    _clear_challenge(database, pending["id"])
                database.commit()
                raise AuthError("That WhatsApp code is incorrect.", 400, "invalid_whatsapp_code")
            opted_in = now() if pending["consent"] else None
            database.execute(
                """
                INSERT INTO app.whatsapp_contacts
                  (user_id, phone_key, phone_encrypted, revision, opted_in_at, consent_version)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT(user_id) DO UPDATE SET phone_key=excluded.phone_key,
                  phone_encrypted=excluded.phone_encrypted, revision=excluded.revision,
                  verified_at=NOW(), opted_in_at=excluded.opted_in_at,
                  opted_out_at=NULL, consent_version=excluded.consent_version
                """,
                (session["user_id"], pending["phone_key"], pending["phone_encrypted"], uuid.uuid4(),
                 opted_in, config.CONSENT_VERSION if opted_in else None),
            )
            _clear_challenge(database, pending["id"])
            _cancel_queued(database, session["user_id"])
            audit(database, "whatsapp_number_verified", session["user_id"], details={"assignmentAlerts": bool(opted_in)})
            if account["scope"] == "activation":
                finish_authentication(
                    database, session["user_id"], session["id"], activate=account["status"] == "activating"
                )
    except UniqueViolation:
        raise AuthError("This number is already registered to another account.", 409, "phone_in_use") from None


def _disable(database, user_id):
    changed = database.execute(
        "UPDATE app.whatsapp_contacts SET opted_in_at=NULL, opted_out_at=NOW(), revision=%s "
        "WHERE user_id=%s AND opted_in_at IS NOT NULL RETURNING user_id",
        (uuid.uuid4(), user_id),
    ).fetchone()
    _cancel_queued(database, user_id)
    if changed:
        audit(database, "whatsapp_alerts_opted_out", user_id)


def opt_out(session):
    with connection() as database:
        _lock_account(database, session)
        database.execute("UPDATE app.whatsapp_challenges SET consent=FALSE WHERE user_id=%s", (session["user_id"],))
        _disable(database, session["user_id"])


def stop_from_number(database, number):
    phone_key = phone_lookup_key(normalize_phone(number))
    users = database.execute(
        """
        SELECT user_id FROM app.whatsapp_contacts WHERE phone_key=%s
        UNION SELECT user_id FROM app.whatsapp_challenges WHERE phone_key=%s ORDER BY user_id
        """,
        (phone_key, phone_key),
    ).fetchall()
    for user in users:
        user_id = user["user_id"]
        database.execute("SELECT id FROM auth.users WHERE id=%s FOR UPDATE", (user_id,))
        database.execute(
            "UPDATE app.whatsapp_challenges SET consent=FALSE WHERE user_id=%s AND phone_key=%s",
            (user_id, phone_key),
        )
        if database.execute(
            "SELECT 1 FROM app.whatsapp_contacts WHERE user_id=%s AND phone_key=%s", (user_id, phone_key)
        ).fetchone():
            _disable(database, user_id)


def operator_opt_out(login_id):
    with connection() as database:
        user = database.execute(
            "SELECT id FROM auth.users WHERE user_id=%s FOR UPDATE", (login_id.strip().lower(),)
        ).fetchone()
        if not user:
            raise AuthError("User ID was not found.", 404, "not_found")
        database.execute("UPDATE app.whatsapp_challenges SET consent=FALSE WHERE user_id=%s", (user["id"],))
        _disable(database, user["id"])
