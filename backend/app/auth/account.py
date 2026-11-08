"""Signed-in profile photo and password use cases. Identity fields stay immutable."""

import base64
import binascii
import io
import re
import secrets
import time
import uuid
from datetime import timedelta

from PIL import Image, ImageOps, UnidentifiedImageError

from . import config, mfa, password_policy, security
from .database import connection
from .models import AuthError, audit, now, public_user


def update_photo(session, payload):
    if set(payload) != {"photo"}:
        raise AuthError("Only your profile photo can be changed.", 400, "readonly_identity")
    value = payload.get("photo")
    content = None
    if value is not None:
        if not isinstance(value, str) or len(value) > 2800000:
            raise AuthError("Choose a JPEG, PNG or WebP photo up to 2 MB.")
        try:
            raw = base64.b64decode(value, validate=True)
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError("Photo too large")
            with Image.open(io.BytesIO(raw)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"} or source.width * source.height > 20000000:
                    raise ValueError("Unsupported photo")
                image = ImageOps.fit(ImageOps.exif_transpose(source).convert("RGB"), (384, 384))
                output = io.BytesIO()
                image.save(output, format="JPEG", quality=88)
                content = output.getvalue()
        except (ValueError, OSError, binascii.Error, UnidentifiedImageError, Image.DecompressionBombError) as error:
            raise AuthError("Choose a valid JPEG, PNG or WebP photo up to 2 MB.") from error
    with connection() as database:
        user = database.execute(
            "UPDATE auth.users SET profile_photo = %s, profile_photo_updated_at = NOW() "
            "WHERE id = %s RETURNING *", (content, session["user_id"]),
        ).fetchone()
        audit(database, "profile_photo_updated" if content else "profile_photo_removed", session["user_id"])
    return public_user(user)


def photo(session):
    with connection() as database:
        row = database.execute("SELECT profile_photo FROM auth.users WHERE id = %s", (session["user_id"],)).fetchone()
        if not row or not row["profile_photo"]:
            raise AuthError("No profile photo is set.", 404, "not_found")
        return bytes(row["profile_photo"])


def change_password(session, payload, ip, user_agent):
    current = str(payload.get("currentPassword", ""))
    candidate = str(payload.get("newPassword", ""))
    if candidate != str(payload.get("confirmPassword", "")):
        raise AuthError("The new passwords do not match.")
    token = security.new_token()
    with connection() as database:
        user = database.execute("SELECT * FROM auth.users WHERE id = %s FOR UPDATE", (session["user_id"],)).fetchone()
        valid = database.execute(
            "SELECT id FROM auth.sessions WHERE id = %s AND scope = 'full' AND revoked_at IS NULL "
            "AND expires_at > NOW() AND last_activity_at > NOW() - make_interval(mins => %s) FOR UPDATE",
            (session["id"], config.SESSION_IDLE_MINUTES),
        ).fetchone()
        if not valid or not user or user["status"] != "active":
            raise AuthError("Your session has expired. Sign in again.", 401, "session_expired")
        mfa._assert_session_available(database, session)
        credential = database.execute(
            "SELECT * FROM auth.mfa_credentials WHERE user_id = %s AND confirmed_at IS NOT NULL FOR UPDATE",
            (user["id"],),
        ).fetchone()
        code = str(payload.get("code", "")).strip()
        counter = int(time.time()) // 30
        secret = security.decrypt_secret(credential["secret_encrypted"]) if credential else ""
        matched = next((step for step in (counter - 1, counter, counter + 1)
                        if credential and re.fullmatch(r"[0-9]{6}", code)
                        and secrets.compare_digest(security.totp_code(secret, step * 30), code)), None)
        previous = credential.get("last_account_totp_counter") if credential else None
        if not security.verify_password(current, user["password_hash"]) or matched is None or (previous is not None and matched <= previous):
            mfa._record_failure(database, session)
            audit(database, "account_password_change_failed", user["id"], ip=ip)
            database.commit()
            raise AuthError("Check your current password and use a fresh authenticator code.", 400, "reauthentication_failed")
        try:
            replacement = password_policy.new_password_hash(database, user, candidate)
        except ValueError as error:
            raise AuthError(str(error)) from error
        database.execute("UPDATE auth.users SET password_hash = %s, updated_at = NOW() WHERE id = %s", (replacement, user["id"]))
        password_policy.record_password_hash(database, user["id"], replacement)
        database.execute("UPDATE auth.mfa_credentials SET last_account_totp_counter = %s WHERE user_id = %s", (matched, user["id"]))
        database.execute("UPDATE auth.sessions SET revoked_at = NOW() WHERE user_id = %s AND revoked_at IS NULL", (user["id"],))
        database.execute(
            "INSERT INTO auth.sessions (id, user_id, token_hash, scope, expires_at, ip_address, user_agent) "
            "VALUES (%s, %s, %s, 'full', %s, %s, %s)",
            (uuid.uuid4(), user["id"], security.token_hash(token), now() + timedelta(hours=config.SESSION_ABSOLUTE_HOURS), ip, user_agent[:500]),
        )
        audit(database, "account_password_changed", user["id"], ip=ip, details={"otherSessionsRevoked": True})
    return token, user
