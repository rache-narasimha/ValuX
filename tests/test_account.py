"""Signed-in account HTTP regression. Use Mailpit, never real email delivery."""

import base64
import http.cookiejar
import io
import json
import time
import urllib.error
import urllib.request
import uuid

from PIL import Image

from backend.app.auth import config, security, service
from backend.app.auth.database import connection


assert config.EMAIL_MODE == "mailpit", "Run account mail checks with Mailpit only"
APP = "http://localhost:4173"
login = "accountqa" + uuid.uuid4().hex[:10]
password = "QA-Current!" + uuid.uuid4().hex
replacement = "QA-Replaced!" + uuid.uuid4().hex
identifier = None


class Browser:
    def __init__(self, token):
        self.cookie = f"{config.SESSION_COOKIE}={token}; {config.CSRF_COOKIE}=" + "x" * 40
        self.token = token

    def request(self, path, payload=None, expected=200):
        request = urllib.request.Request(APP + path, headers={"Cookie": self.cookie, "X-CSRF-Token": "x" * 40, "Content-Type": "application/json"},
                                         data=None if payload is None else json.dumps(payload).encode())
        try:
            response = urllib.request.urlopen(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        body = response.read()
        assert response.status == expected, (path, response.status, body[:200])
        for value in response.headers.get_all("Set-Cookie", []):
            if value.startswith(config.SESSION_COOKIE + "="):
                self.token = value.split(";", 1)[0].split("=", 1)[1]
                self.cookie = value.split(";", 1)[0] + f"; {config.CSRF_COOKIE}=" + "x" * 40
        return json.loads(body) if response.headers.get_content_type() == "application/json" else body, response.headers


try:
    service.provision_user(login, "Account QA", "employee", password)
    secret = security.new_totp_secret()
    with connection() as database:
        identifier = database.execute("UPDATE auth.users SET status='active', must_change_password=FALSE, email=%s, email_verified_at=NOW() WHERE user_id=%s RETURNING id", (login + "@valux.test", login)).fetchone()["id"]
        database.execute("INSERT INTO auth.mfa_credentials (user_id,secret_encrypted,confirmed_at) VALUES (%s,%s,NOW())", (identifier, security.encrypt_secret(secret)))
    raw = service.create_session(identifier, "full", None, "127.0.0.1", "account-qa")
    browser = Browser(raw)
    other = Browser(service.create_session(identifier, "full", None, "127.0.0.1", "other-qa"))
    page, _ = browser.request("/account")
    assert b'My Account' in page and b'account-name" readonly' in page
    browser.request("/api/auth/profile/photo", {"photo": None, "name": "Changed"}, 400)
    browser.request("/api/auth/profile/photo", {"photo": "not-an-image"}, 400)
    buffer = io.BytesIO()
    Image.new("RGB", (600, 300), "navy").save(buffer, format="PNG")
    result, _ = browser.request("/api/auth/profile/photo", {"photo": base64.b64encode(buffer.getvalue()).decode()})
    assert result["user"]["photoUrl"] and result["user"]["name"] == "Account QA"
    content, headers = browser.request(result["user"]["photoUrl"])
    assert headers["Content-Type"] == "image/jpeg" and headers["Cache-Control"] == "no-store"
    photo = Image.open(io.BytesIO(content))
    assert photo.size == (384, 384)
    values = {"currentPassword": password, "newPassword": replacement, "confirmPassword": replacement, "code": security.totp_code(secret)}
    browser.request("/api/auth/account/password", {**values, "currentPassword": "wrong"}, 400)
    browser.request("/api/auth/account/password", {**values, "code": "not-a-code"}, 400)
    browser.request("/api/auth/account/password", {**values, "confirmPassword": "different"}, 400)
    browser.request("/api/auth/account/password", {**values, "newPassword": "weak", "confirmPassword": "weak"}, 400)
    result, _ = browser.request("/api/auth/account/password", values)
    assert result["confirmationSent"] and browser.token != raw
    assert service.session_for_token(raw, refresh=False) is None
    other.request("/api/auth/me", expected=401)
    assert service.session_for_token(browser.token, refresh=False)["scope"] == "full"
    # Reusing the same security code cannot authorize another password change.
    browser.request("/api/auth/account/password", {**values, "currentPassword": replacement}, 400)
    fresh_code = security.totp_code(secret, (int(time.time()) // 30 + 1) * 30)
    error, _ = browser.request("/api/auth/account/password", {"currentPassword": replacement, "newPassword": password, "confirmPassword": password, "code": fresh_code}, 400)
    assert error["code"] == "password_reused"
    with urllib.request.urlopen("http://mailpit:8025/api/v1/messages", timeout=10) as response:
        messages = json.loads(response.read())["messages"]
    assert any(item["Subject"] == "Your ValuX password was changed" and any(address["Address"] == login + "@valux.test" for address in item["To"]) for item in messages)
    with connection() as database:
        database.execute("UPDATE auth.sessions SET last_activity_at=NOW()-INTERVAL '59 minutes' WHERE token_hash=%s", (security.token_hash(browser.token),))
        before = database.execute("SELECT last_activity_at FROM auth.sessions WHERE token_hash=%s", (security.token_hash(browser.token),)).fetchone()["last_activity_at"]
    browser.request("/api/notifications")
    browser.request("/api/auth/profile/photo")
    with connection() as database:
        after = database.execute("SELECT last_activity_at FROM auth.sessions WHERE token_hash=%s", (security.token_hash(browser.token),)).fetchone()["last_activity_at"]
    assert before == after, "Background requests must not keep an idle session alive"
    browser.request("/api/auth/activity", {})
    result, _ = browser.request("/api/auth/profile/photo", {"photo": None})
    assert result["user"]["photoUrl"] is None
    browser.request("/api/auth/profile/photo", expected=404)
    limited = Browser(service.create_session(identifier, "full", None, "127.0.0.1", "rate-limit-qa"))
    for _ in range(5):
        limited.request("/api/auth/account/password", {**values, "currentPassword": "wrong"}, 400)
    limited.request("/api/auth/account/password", {**values, "currentPassword": replacement}, 429)
    with connection() as database:
        database.execute("UPDATE auth.sessions SET expires_at=NOW()-INTERVAL '1 second' WHERE token_hash=%s", (security.token_hash(browser.token),))
    browser.request("/api/auth/activity", {}, 401)
    assert config.SESSION_IDLE_MINUTES == 60 and config.SESSION_ABSOLUTE_HOURS == 24
    print("PASS: account identity, photo, reauthentication, password history, session rotation/expiry, polling and confirmation email")
finally:
    if identifier:
        with connection() as database:
            database.execute("DELETE FROM auth.users WHERE id=%s", (identifier,))
