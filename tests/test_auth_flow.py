"""End-to-end activation, MFA, recovery, role, and Mailpit regression check.

Run inside the application container after it is healthy:
    docker compose exec -T app python -m tests.test_auth_flow
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
from backend.app.whatsapp import config as whatsapp_config


APP = "http://localhost:4173"
MAILPIT = "http://mailpit:8025"
PREFIX = f"qa{uuid.uuid4().hex[:8]}"
TEST_NUMBER_SEED = int(PREFIX[-4:], 16) % 40

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


def test_number(offset):
    return f"+120255501{TEST_NUMBER_SEED * 2 + offset:02d}"


def whatsapp_code(number):
    assert whatsapp_config.MODE == "mock", "Never send test codes through the live provider"
    code = mail_text(
        "whatsapp-verification@valux.test", f"Local WhatsApp test code for number ending {number[-4:]}"
    ).strip()
    assert re.fullmatch("[0-9]{6}", code)
    return code


def verify_whatsapp(browser, number, *, alerts, authenticator=None):
    payload = {"number": number, "alerts": alerts, "requestCode": True}
    if authenticator:
        payload["authenticator"] = authenticator
    result = browser.post("/api/auth/whatsapp/start", payload)
    assert result["ending"] == number[-4:] and "code" not in result
    assert browser.get_json("/api/auth/whatsapp")["pendingEnding"] == number[-4:]
    browser.post("/api/auth/whatsapp/start", payload, expected=429)
    code = whatsapp_code(number)
    wrong = "000000" if code != "000000" else "000001"
    assert browser.post("/api/auth/whatsapp/confirm", {"code": wrong}, expected=400)["code"] == "invalid_whatsapp_code"
    assert browser.post("/api/auth/whatsapp/confirm", {"code": code})["next"] == "complete"
    browser.post("/api/auth/whatsapp/confirm", {"code": code}, expected=400)
    state = browser.get_json("/api/auth/whatsapp")
    assert state["verified"] and state["ending"] == number[-4:] and state["alerts"] is alerts
    assert number not in json.dumps(state)


def sign_in_with_mobile(number, password, secret):
    browser = Browser()
    assert browser.context()["mobileSignInEnabled"] is True
    assert browser.post("/api/auth/login", {"identifier": number, "password": password})["next"] == "mfa_login"
    assert browser.get_error("/api/auth/me", 403)["code"] == "forbidden"
    assert browser.post("/api/auth/mfa/verify", {"code": security.totp_code(secret)})["next"] == "complete"
    return browser


def verify_existing_whatsapp():
    login = PREFIX + "existing"
    password = strong_password()
    provision_user(login, "Existing WhatsApp fixture", "employee", password, actor="integration-test")
    secret = security.new_totp_secret()
    with connection() as database:
        identifier = database.execute(
            "UPDATE auth.users SET status='active', must_change_password=FALSE, email=%s, "
            "email_verified_at=NOW() WHERE user_id=%s RETURNING id", (login + "@valux.test", login),
        ).fetchone()["id"]
        database.execute(
            "INSERT INTO auth.mfa_credentials (user_id,secret_encrypted,confirmed_at) VALUES (%s,%s,NOW())",
            (identifier, security.encrypt_secret(secret)),
        )
    browser = Browser()
    browser.context()
    assert browser.post("/api/auth/login", {"identifier": login, "password": password})["next"] == "mfa_login"
    assert browser.post("/api/auth/mfa/verify", {"code": security.totp_code(secret)})["next"] == "whatsapp_setup"
    assert browser.get_error("/api/auth/me", 401)["code"] == "whatsapp_required"
    number = f"+120255501{80 + TEST_NUMBER_SEED % 10}"
    mobile = Browser()
    mobile.context()
    assert mobile.post("/api/auth/login", {"identifier": number, "password": password}, expected=401)["code"] == "invalid_credentials"
    verify_whatsapp(browser, number, alerts=False)
    assert browser.get_json("/api/auth/me")["user"]["userId"] == login

    formatted_number = f"+1 (202) 555-{number[-4:]}"
    mobile = sign_in_with_mobile(formatted_number, password, secret)
    assert mobile.get_json("/api/auth/me")["user"]["userId"] == login
    assert mobile.get_json("/api/auth/whatsapp")["alerts"] is False
    mobile.post("/api/auth/logout", {})
    mobile.context()

    # Seeds an older failure recorded under the email identifier.
    with connection() as database:
        database.execute(
            "INSERT INTO auth.login_attempts (id, identifier_hash, user_id, ip_address, succeeded) "
            "VALUES (%s, %s, %s, '127.0.0.1', FALSE)",
            (uuid.uuid4(), security.identifier_hash(login + "@valux.test"), identifier),
        )
    for alias in (login, login + "@valux.test", number, formatted_number):
        assert mobile.post("/api/auth/login", {"identifier": alias, "password": "incorrect"}, expected=401)["code"] == "invalid_credentials"
    for alias in (formatted_number, login, login + "@valux.test"):
        assert mobile.post("/api/auth/login", {"identifier": alias, "password": password}, expected=429)["code"] == "rate_limited"


def activate(role: str):
    user_id = f"{PREFIX}{'f' if role == 'father' else 'e'}"
    email = f"{user_id}@valux.test"
    temporary = strong_password()
    permanent = strong_password()
    provision_user(user_id, f"QA {role.title()}", role, temporary, actor="integration-test")
    browser = Browser()
    assert browser.context()["mobileSignInEnabled"] is whatsapp_config.enabled()
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
    if whatsapp_config.REQUIRE_VERIFICATION:
        assert verified["signedIn"] is False and verified["next"] == "whatsapp_setup"
        assert browser.get_error("/api/auth/me", 401)["code"] == "whatsapp_required"
        verify_whatsapp(browser, test_number(0 if role == "father" else 1), alerts=role == "father")
    else:
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
    if whatsapp_config.REQUIRE_VERIFICATION:
        father.post("/api/auth/whatsapp/opt-out", {})
        assert father.get_json("/api/auth/whatsapp")["alerts"] is False
        assert father.get_json("/api/auth/me")["user"]["role"] == "father"
        mobile = sign_in_with_mobile(test_number(0), father_password, current_totp_secret(father_id))
        assert mobile.get_json("/api/auth/whatsapp")["alerts"] is False
        mobile.post("/api/auth/logout", {})
        with connection() as database:
            database.execute(
                "UPDATE app.whatsapp_challenges SET sent_at=NOW()-INTERVAL '2 minutes' WHERE user_id="
                "(SELECT id FROM auth.users WHERE user_id=%s)", (father_id,),
            )
        replacement_number = f"+120255501{90 + TEST_NUMBER_SEED % 10}"
        father.post("/api/auth/whatsapp/start", {
            "number": replacement_number, "requestCode": True, "alerts": True, "authenticator": "invalid",
        }, expected=400)
        verify_whatsapp(
            father, replacement_number, alerts=True, authenticator=security.totp_code(current_totp_secret(father_id)),
        )
        mobile = Browser()
        mobile.context()
        assert mobile.post("/api/auth/login", {"identifier": test_number(0), "password": father_password}, expected=401)["code"] == "invalid_credentials"
        mobile = sign_in_with_mobile(replacement_number, father_password, current_totp_secret(father_id))
        assert mobile.get_json("/api/auth/me")["user"]["userId"] == father_id
        mobile.post("/api/auth/logout", {})
        verify_existing_whatsapp()
        print("PASS: mandatory WhatsApp setup, optional consent, wrong and replayed codes, opt-out, and authenticated number replacement")
        print("PASS: verified mobile sign-in requires MFA, survives opting out, and shares password attempt limits")
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
            "UPDATE auth.sessions SET last_activity_at = NOW() - INTERVAL '61 minutes' WHERE user_id = %s",
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
