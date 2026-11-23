"""Browser policy allows report previews while restricting executable sources."""

from unittest.mock import patch

from fastapi import Request

from backend.app.web.browser_security import response_headers, trusted_inline_script
from backend.app.web.handler import Handler


def test_public_privacy_policy():
    def request(method, path):
        return Handler(Request({"type": "http", "method": method, "path": path, "query_string": b"", "headers": []})).dispatch()

    with patch("backend.app.auth.routes.require_full_session", side_effect=AssertionError("unexpected session lookup")):
        page = request("GET", "/privacy")
        assert page.status_code == 200
        assert b"ValuX privacy policy" in page.body and b"support.valux@gmail.com" in page.body
        assert page.headers["content-type"] == "text/html"
        assert "Content-Security-Policy" in page.headers and "Set-Cookie" not in page.headers
        head = request("HEAD", "/privacy")
        assert head.status_code == 200 and not head.body
        assert int(head.headers["content-length"]) == len(page.body)
        assert b'href="/privacy"' in request("GET", "/auth").body
    print("PASS: public privacy page, sign-in link, HEAD metadata, and secure response headers")


def main():
    policy = dict(response_headers("test-nonce", secure_transport=False))
    csp = policy["Content-Security-Policy"]
    assert "script-src 'self' 'nonce-test-nonce'" in csp
    assert "unsafe-eval" not in csp and "script-src 'self' 'unsafe-inline'" not in csp
    assert "connect-src 'self'" in csp and "form-action 'self'" in csp
    assert "base-uri 'none'" in csp and "frame-ancestors 'self'" in csp
    assert "frame-src 'self' blob:" in csp and "object-src 'self' blob:" in csp
    assert "Strict-Transport-Security" not in policy
    assert "upgrade-insecure-requests" not in csp
    secure = dict(response_headers("another-nonce", secure_transport=True))
    assert secure["Strict-Transport-Security"] == "max-age=31536000"
    assert "upgrade-insecure-requests" in secure["Content-Security-Policy"]
    script = b'<script>window.context={"name":"\\u003cscript>"};</script>'
    assert trusted_inline_script(script, "test-nonce") == b'<script nonce="test-nonce">window.context={"name":"\\u003cscript>"};</script>'
    try:
        trusted_inline_script(b'<p>User HTML</p><script>unexpected()</script>', "test-nonce")
    except ValueError:
        pass
    else:
        raise AssertionError("Never authorize scripts found in arbitrary HTML")
    print("PASS: nonce CSP, HTTPS-only HSTS, local HTTP compatibility and PDF-source allowances")
    test_public_privacy_policy()


if __name__ == "__main__":
    main()
