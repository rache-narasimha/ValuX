"""Exercise the real response policy without changing business records."""

import json
import re
from urllib import error, request

from backend.app.auth.config import COOKIE_SECURE
from backend.app.auth.database import connection
from backend.app.auth.service import create_session, revoke_session


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    opener = request.build_opener(NoRedirect)
    with connection() as database:
        user = database.execute("SELECT id FROM auth.users WHERE status='active' AND role='father' ORDER BY created_at LIMIT 1").fetchone()
    token = create_session(user["id"], "full", None, "127.0.0.1", "Browser response security regression")

    def call(path, *, authenticated=False, data=None, headers=None, method=None):
        defaults = {"Cookie": f"valux_session={token}"} if authenticated else {}
        req = request.Request("http://localhost:4173" + path, data=data,
                              headers={**defaults, **(headers or {})}, method=method)
        try:
            response = opener.open(req, timeout=30)
        except error.HTTPError as failure:
            response = failure
        body = response.read()
        policy = response.headers["Content-Security-Policy"]
        nonce = re.search(r"'nonce-([A-Za-z0-9_-]+)'", policy).group(1)
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "SAMEORIGIN"
        assert "form-action 'self'" in policy and "connect-src 'self'" in policy
        assert bool(response.headers.get("Strict-Transport-Security")) == COOKIE_SECURE
        return response, body, nonce

    try:
        a, body, nonce_a = call("/auth")
        b, _, nonce_b = call("/auth")
        assert a.status == b.status == 200 and nonce_a != nonce_b
        assert b"SLN Consultancy" in body and b"Enterprise 256-bit" not in body
        for path in ("/", "/tasks", "/tasks/new", "/practice", "/valuation/general?practice=1", "/valuation/agricultural?practice=1", "/estimation?practice=1", "/progress-completion?practice=1"):
            response, body, nonce = call(path, authenticated=True)
            assert response.status == 200, path
            assert response.headers["Cache-Control"] == "no-store"
            scripts = re.findall(rb"<script([^>]*)>(.*?)</script>", body, re.DOTALL)
            inline = [attrs for attrs, text in scripts if text.strip()]
            assert len(inline) >= 2 and all(f'nonce="{nonce}"'.encode() in attrs for attrs in inline), path
        for path in ("/api/tasks", "/api/institutions", "/api/employees", "/api/schema", "/api/agricultural/schema", "/api/auth/me", "/downloads/missing.xlsx", "/previews/missing.pdf"):
            response, _, _ = call(path)
            assert response.status == 401, (path, response.status)
        for path in ("/.env", "/.git/config", "/backend/server.py", "/outputs/generated_reports/"):
            response, _, _ = call(path)
            assert response.status == 303 and response.headers["Location"].startswith("/auth?next="), path
        response, body, _ = call("/api/auth/context")
        state = json.loads(body)
        assert not state["authenticated"] and "user" not in state
        assert response.headers["Cache-Control"] == "no-store"
        response, _, _ = call("/api/auth/login", data=b'{"identifier":"security-probe","password":"not-a-real-password"}', headers={"Content-Type": "application/json", "Origin": "https://example.invalid"})
        assert response.status == 403  # Before credential lookup or a login attempt.
        response, _, _ = call("/api/auth/login", method="OPTIONS", headers={"Origin": "https://example.invalid", "Access-Control-Request-Method": "POST"})
        assert not response.headers.get("Access-Control-Allow-Origin")
        print("PASS: response-wide CSP, fresh nonces and authenticated bootstrap scripts; private routes, CSRF and CORS boundaries remain enforced")
    finally:
        revoke_session(token, "127.0.0.1")


if __name__ == "__main__":
    main()
