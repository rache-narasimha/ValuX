"""End-to-end activation, MFA, recovery, role, and Mailpit regression check.

Run inside the application container after it is healthy:
    docker compose exec -T valuation-report python -m tests.test_auth_flow
"""

import http.cookiejar
import json
import re
import secrets
import string
import time
import urllib.error
import urllib.request
import uuid

from backend.app.auth import security, service
from backend.app.auth.config import EMAIL_MODE
from backend.app.auth.database import connection
from backend.app.auth.service import provision_user


APP = "http://localhost:4173"
MAILPIT = "http://mailpit:8025"
PREFIX = f"qa{uuid.uuid4().hex[:8]}"

if EMAIL_MODE != "mailpit":
    print("SKIP: authentication email-flow regression requires EMAIL_MODE=mailpit")
    raise SystemExit(0)


def strong_password() -> str:
    return f"Vs!{secrets.token_urlsafe(15)}9aA"


class Browser:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = ""

    def context(self):
        result = self.get_json("/api/auth/context")
        self.csrf = result["csrf"]
        return result

    def get_json(self, path):
        with self.opener.open(APP + path, timeout=15) as response:
            return json.loads(response.read())

    def get_error(self, path, expected):
        try:
            self.get_json(path)
        except urllib.error.HTTPError as error:
            assert error.code == expected
            return json.loads(error.read())
        raise AssertionError(f"{path}: expected HTTP {expected}")

    def post(self, path, payload, expected=200):
        request = urllib.request.Request(
            APP + path,
            data=json.dumps(payload).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "X-CSRF-Token": self.csrf},
        )
        try:
            with self.opener.open(request, timeout=20) as response:
                assert response.status == expected
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            body = json.loads(error.read())
            if error.code != expected:
                raise AssertionError(f"{path}: expected {expected}, received {error.code}: {body}") from error
            return body


def mail_text(recipient: str, subject: str) -> str:
    for _ in range(30):
        with urllib.request.urlopen(f"{MAILPIT}/api/v1/messages", timeout=10) as response:
            messages = json.loads(response.read())["messages"]
        match = next(
            (
                message
                for message in messages
                if message["Subject"] == subject
                and any(item["Address"] == recipient for item in message["To"])
            ),
            None,
        )
        if match:
            with urllib.request.urlopen(f"{MAILPIT}/api/v1/message/{match['ID']}", timeout=10) as response:
                return json.loads(response.read())["Text"]
        time.sleep(0.2)
    raise AssertionError(f"Mailpit did not receive {subject!r} for {recipient}")


def token_from(text: str, marker: str) -> str:
    match = re.search(re.escape(marker) + r"([^\s]+)", text)
    assert match, text
    return match.group(1).strip()


def activate(role: str):
    user_id = f"{PREFIX}{'f' if role == 'father' else 'e'}"
    email = f"{user_id}@valux.test"
    temporary = strong_password()
    permanent = strong_password()
    provision_user(user_id, f"QA {role.title()}", role, temporary, actor="integration-test")
    browser = Browser()
    browser.context()
    assert browser.post("/api/auth/login", {"identifier": user_id, "password": temporary})["next"] == "change_password"
    assert browser.post("/api/auth/change-password", {"password": permanent})["next"] == "mfa_setup"
    setup = browser.post("/api/auth/mfa/setup", {})
    enrolled = browser.post("/api/auth/mfa/enroll", {"code": security.totp_code(setup["secret"])})
    recovery_codes = enrolled["recoveryCodes"]
    assert browser.post("/api/auth/mfa/recovery-codes/confirm", {})["next"] == "email_setup"
    assert browser.post("/api/auth/email", {"email": email})["next"] == "email_verify"
    verification = token_from(
        mail_text(email, "Verify your ValuX recovery email"), "#verify-email="
    )
    verified = browser.post("/api/auth/email/verify", {"token": verification})
    assert verified["signedIn"] is True
    assert browser.get_json("/api/auth/me")["user"]["role"] == role
    return browser, user_id, email, permanent, recovery_codes


def cleanup():
    with connection() as database:
        database.execute("DELETE FROM auth.users WHERE user_id LIKE %s", (f"{PREFIX}%",))


def current_totp_secret(user_id: str) -> str:
    with connection() as database:
        record = database.execute(
            """
            SELECT m.secret_encrypted
            FROM auth.mfa_credentials m
            JOIN auth.users u ON u.id = m.user_id
            WHERE u.user_id = %s
            """,
            (user_id,),
        ).fetchone()
    return security.decrypt_secret(record["secret_encrypted"])


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


try:
    father, father_id, father_email, father_password, recovery_codes = activate("father")
    with father.opener.open(APP + "/settings/institutions", timeout=10) as response:
        assert response.status == 200
    father.post("/api/auth/logout", {})
    assert father.get_json("/api/auth/context")["authenticated"] is False

    father.context()
    assert father.post("/api/auth/login", {"identifier": father_email, "password": father_password})["next"] == "mfa_login"
    assert father.post(
        "/api/auth/mfa/verify",
        {"code": security.totp_code(current_totp_secret(father_id))},
    )["next"] == "complete"
    father.post("/api/auth/logout", {})

    father.context()
    father.post("/api/auth/forgot-password", {"identifier": father_id})
    reset_token = token_from(
        mail_text(father_email, "Reset your ValuX password"), "#reset-password="
    )
    replacement = strong_password()
    father.post("/api/auth/reset-password", {"token": reset_token, "password": replacement})
    assert father.post("/api/auth/reset-password", {"token": reset_token, "password": strong_password()}, expected=400)["ok"] is False
    with connection() as database:
        father_record = database.execute(
            "SELECT id FROM auth.users WHERE user_id = %s", (father_id,)
        ).fetchone()
        expired_token = service.create_account_token(
            database, father_record["id"], "password_reset", father_email
        )
        database.execute(
            "UPDATE auth.account_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = %s",
            (security.token_hash(expired_token),),
        )
    assert father.post(
        "/api/auth/reset-password",
        {"token": expired_token, "password": strong_password()},
        expected=400,
    )["ok"] is False

    father.context()
    assert father.post("/api/auth/login", {"identifier": father_id, "password": replacement})["next"] == "mfa_login"
    valid_totp = security.totp_code(current_totp_secret(father_id))
    invalid_totp = "000000" if valid_totp != "000000" else "000001"
    for _ in range(5):
        father.post("/api/auth/mfa/verify", {"code": invalid_totp}, expected=401)
    assert father.post("/api/auth/mfa/verify", {"code": invalid_totp}, expected=429)["code"] == "mfa_rate_limited"

    father.context()
    assert father.post("/api/auth/login", {"identifier": father_id, "password": replacement})["next"] == "mfa_login"
    assert father.post("/api/auth/mfa/recover", {"code": recovery_codes[0]})["next"] == "mfa_setup"
    setup = father.post("/api/auth/mfa/setup", {})
    father.post("/api/auth/mfa/enroll", {"code": security.totp_code(setup["secret"])})
    assert father.post("/api/auth/mfa/recovery-codes/confirm", {})["next"] == "complete"

    employee, employee_id, _employee_email, _employee_password, _employee_codes = activate("employee")
    no_redirect = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(employee.jar),
        NoRedirect(),
    )
    try:
        no_redirect.open(APP + "/settings/institutions", timeout=10)
        raise AssertionError("Employee opened father-only institution settings")
    except urllib.error.HTTPError as error:
        assert error.code == 303

    with connection() as database:
        employee_record = database.execute(
            "SELECT id FROM auth.users WHERE user_id = %s", (employee_id,)
        ).fetchone()
        database.execute(
            "UPDATE auth.sessions SET last_activity_at = NOW() - INTERVAL '31 minutes' WHERE user_id = %s",
            (employee_record["id"],),
        )
    assert employee.get_error("/api/auth/me", 401)["code"] == "session_expired"

    recovery_password = strong_password()
    service.assisted_recovery(employee_id, recovery_password, actor="integration-test")
    with connection() as database:
        recovered = database.execute(
            """
            SELECT u.status, u.email, COUNT(s.id) AS sessions, COUNT(m.user_id) AS mfa
            FROM auth.users u
            LEFT JOIN auth.sessions s ON s.user_id = u.id
            LEFT JOIN auth.mfa_credentials m ON m.user_id = u.id
            WHERE u.user_id = %s GROUP BY u.id
            """,
            (employee_id,),
        ).fetchone()
    assert recovered == {"status": "provisioned", "email": None, "sessions": 0, "mfa": 0}

    locked_id = f"{PREFIX}lock"
    locked_password = strong_password()
    provision_user(locked_id, "QA Locked", "employee", locked_password, actor="integration-test")
    locked = Browser()
    locked.context()
    for _ in range(5):
        locked.post("/api/auth/login", {"identifier": locked_id, "password": "Wrong!Password123"}, expected=401)
    assert locked.post("/api/auth/login", {"identifier": locked_id, "password": locked_password}, expected=429)["code"] == "rate_limited"

    print("PASS: activation, email, MFA, recovery, roles, lockout, and Mailpit")
finally:
    cleanup()
