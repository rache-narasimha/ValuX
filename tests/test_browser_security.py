"""Browser policy allows report previews while restricting executable sources."""

from backend.app.web.browser_security import response_headers, trusted_inline_script


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


if __name__ == "__main__":
    main()
