"""HTTP adapter for ValuX authentication endpoints."""

import json
import secrets
import smtplib
from http.cookies import SimpleCookie
from pathlib import Path

from . import mailer, service
from .config import (
    COOKIE_SECURE,
    CSRF_COOKIE,
    SESSION_ABSOLUTE_HOURS,
    SESSION_COOKIE,
)


# PAGES_DIR lives outside the auth package; importing lazily avoids a config cycle.
AUTH_PAGE = Path(__file__).resolve().parents[3] / "frontend" / "pages" / "auth.html"


def cookies(handler) -> SimpleCookie:
    parsed = SimpleCookie()
    parsed.load(handler.headers.get("Cookie", ""))
    return parsed


def cookie_value(handler, name: str) -> str | None:
    morsel = cookies(handler).get(name)
    return morsel.value if morsel else None


def _cookie_header(name: str, value: str, max_age: int, http_only: bool = False) -> str:
    parts = [f"{name}={value}", "Path=/", "SameSite=Lax", f"Max-Age={max_age}"]
    if http_only:
        parts.append("HttpOnly")
    if COOKIE_SECURE:
        parts.append("Secure")
    return "; ".join(parts)


def session_cookie(token: str) -> tuple[str, str]:
    return (
        "Set-Cookie",
        _cookie_header(
            SESSION_COOKIE,
            token,
            SESSION_ABSOLUTE_HOURS * 60 * 60,
            http_only=True,
        ),
    )


def clear_session_cookie() -> tuple[str, str]:
    return ("Set-Cookie", _cookie_header(SESSION_COOKIE, "", 0, http_only=True))


def csrf_context(handler) -> tuple[str, list[tuple[str, str]]]:
    token = cookie_value(handler, CSRF_COOKIE)
    if token and len(token) >= 32:
        return token, []
    token = secrets.token_urlsafe(32)
    return token, [("Set-Cookie", _cookie_header(CSRF_COOKIE, token, 12 * 60 * 60))]


def verify_csrf(handler) -> None:
    expected = cookie_value(handler, CSRF_COOKIE) or ""
    supplied = handler.headers.get("X-CSRF-Token", "")
    if not expected or not supplied or not secrets.compare_digest(expected, supplied):
        raise service.AuthError("Your security token expired. Refresh the page and try again.", 403, "csrf")


def current_session(handler, required_scope: str | None = None):
    session = service.session_for_token(cookie_value(handler, SESSION_COOKIE))
    if not session:
        if required_scope:
            raise service.AuthError("Your session has expired. Sign in again.", 401, "session_expired")
        return None
    if required_scope and session["scope"] != required_scope:
        raise service.AuthError("This action is not available for the current session.", 403, "forbidden")
    return session


def require_full_session(handler, role: str | None = None):
    session = current_session(handler, "full")
    if session["status"] != "active":
        raise service.AuthError("This account is not active.", 403, "inactive")
    if role and session["role"] != role:
        raise service.AuthError("You do not have permission to open this page.", 403, "forbidden")
    return session


def read_payload(handler, limit: int = 64 * 1024) -> dict:
    try:
        size = int(handler.headers.get("Content-Length", "0"))
    except ValueError as error:
        raise service.AuthError("Invalid request length.") from error
    if size <= 0 or size > limit:
        raise service.AuthError("Invalid request body.")
    try:
        payload = json.loads(handler.rfile.read(size))
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise service.AuthError("Invalid JSON request.") from error
    if not isinstance(payload, dict):
        raise service.AuthError("Invalid request body.")
    return payload


def _client(handler):
    return handler.client_address[0], handler.headers.get("User-Agent", "")


def _auth_state(session):
    if not session:
        return {"authenticated": False}
    user = service.user_for_id(session["user_id"])
    return {
        "authenticated": session["scope"] == "full",
        "scope": session["scope"],
        "next": session["activation_step"],
        "user": service.public_user(user),
        "pendingEmail": user.get("pending_email"),
    }


def handle_get(handler, path: str) -> bool:
    if path in {"/auth", "/auth/"}:
        handler.send_file(AUTH_PAGE, cache="no-store")
        return True
    if path == "/api/health":
        from .database import healthcheck

        healthy = healthcheck()
        handler.send_json({"ok": healthy}, 200 if healthy else 503)
        return True
    if path == "/api/auth/context":
        csrf, headers = csrf_context(handler)
        state = _auth_state(current_session(handler))
        handler.send_json({**state, "csrf": csrf}, headers=headers)
        return True
    if path == "/api/auth/me":
        session = require_full_session(handler)
        csrf, headers = csrf_context(handler)
        handler.send_json({"user": service.public_user(service.user_for_id(session["user_id"])), "csrf": csrf}, headers=headers)
        return True
    return False


def handle_post(handler, path: str) -> bool:
    if not path.startswith("/api/auth/"):
        return False
    try:
        verify_csrf(handler)
        payload = read_payload(handler)
        ip, user_agent = _client(handler)

        if path == "/api/auth/login":
            token, next_step, user = service.login(
                str(payload.get("identifier", "")),
                str(payload.get("password", "")),
                ip,
                user_agent,
            )
            handler.send_json(
                {"ok": True, "next": next_step, "user": user},
                headers=[session_cookie(token)],
            )
            return True

        if path == "/api/auth/logout":
            service.revoke_session(cookie_value(handler, SESSION_COOKIE), ip)
            handler.send_json({"ok": True}, headers=[clear_session_cookie()])
            return True

        if path == "/api/auth/change-password":
            session = current_session(handler, "activation")
            next_step = service.change_activation_password(session, str(payload.get("password", "")))
            handler.send_json({"ok": True, "next": next_step})
            return True

        if path == "/api/auth/mfa/setup":
            session = current_session(handler, "activation")
            handler.send_json({"ok": True, **service.mfa_setup(session)})
            return True

        if path == "/api/auth/mfa/enroll":
            session = current_session(handler, "activation")
            codes = service.verify_mfa_enrollment(session, str(payload.get("code", "")))
            handler.send_json({"ok": True, "next": "recovery_codes", "recoveryCodes": codes})
            return True

        if path == "/api/auth/mfa/recovery-codes/confirm":
            session = current_session(handler, "activation")
            next_step = service.confirm_recovery_codes(session)
            handler.send_json({"ok": True, "next": next_step})
            return True

        if path == "/api/auth/mfa/verify":
            session = current_session(handler, "mfa")
            user = service.verify_login_mfa(session, str(payload.get("code", "")))
            handler.send_json({"ok": True, "next": "complete", "user": user})
            return True

        if path == "/api/auth/mfa/recover":
            session = current_session(handler, "mfa")
            next_step = service.use_recovery_code(session, str(payload.get("code", "")))
            handler.send_json({"ok": True, "next": next_step})
            return True

        if path == "/api/auth/email":
            session = current_session(handler, "activation")
            token, user = service.begin_email_verification(session, str(payload.get("email", "")))
            if token:
                try:
                    mailer.send_verification(user["pending_email"], user["display_name"], token)
                except (OSError, TimeoutError, smtplib.SMTPException):
                    service.invalidate_account_token(token)
                    raise
            handler.send_json({"ok": True, "next": "email_verify", "email": user["pending_email"]})
            return True

        if path == "/api/auth/email/resend":
            session = current_session(handler, "activation")
            token, user = service.resend_email_verification(session)
            if token:
                try:
                    mailer.send_verification(user["pending_email"], user["display_name"], token)
                except (OSError, TimeoutError, smtplib.SMTPException):
                    service.invalidate_account_token(token)
                    raise
                message = "Verification email sent."
            else:
                message = "A verification email was sent recently. Please wait before trying again."
            handler.send_json({"ok": True, "message": message})
            return True

        if path == "/api/auth/email/verify":
            session = current_session(handler)
            user, signed_in = service.verify_email_token(str(payload.get("token", "")), session)
            handler.send_json({"ok": True, "user": user, "signedIn": signed_in})
            return True

        if path == "/api/auth/forgot-password":
            token, user = service.request_password_reset(str(payload.get("identifier", "")))
            if token and user:
                try:
                    mailer.send_password_reset(user["email"], user["display_name"], token)
                except (OSError, TimeoutError, smtplib.SMTPException):
                    service.invalidate_account_token(token)
            handler.send_json(
                {"ok": True, "message": "If a verified account matches, a reset link has been sent."}
            )
            return True

        if path == "/api/auth/reset-password":
            service.reset_password(str(payload.get("token", "")), str(payload.get("password", "")))
            handler.send_json(
                {"ok": True, "message": "Password reset. Sign in with your new password and authenticator."},
                headers=[clear_session_cookie()],
            )
            return True

        handler.send_json({"ok": False, "error": "Authentication endpoint not found."}, 404)
        return True
    except service.AuthError as error:
        handler.send_json({"ok": False, "error": str(error), "code": error.code}, error.status)
        return True
    except (OSError, TimeoutError, smtplib.SMTPException):
        handler.send_json(
            {"ok": False, "error": "Email delivery is temporarily unavailable. Try again shortly."},
            503,
        )
        return True
    except Exception as error:
        handler.log_error("Authentication request failed: %s", type(error).__name__)
        handler.send_json(
            {"ok": False, "error": "The authentication service encountered an unexpected error."},
            500,
        )
        return True


def authentication_context_script(session) -> bytes:
    user = service.public_user(service.user_for_id(session["user_id"]))
    safe_json = json.dumps({"user": user}, separators=(",", ":")).replace("<", "\\u003c")
    return f"<script>window.__VALUX_AUTH_CONTEXT__={safe_json};</script>".encode("utf-8")
