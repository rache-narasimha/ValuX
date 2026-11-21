"""Browser response policy for the private ValuX application."""


def response_headers(nonce: str, *, secure_transport: bool) -> list[tuple[str, str]]:
    policy = [
        "default-src 'self'",
        "base-uri 'none'",
        f"script-src 'self' 'nonce-{nonce}'",
        "style-src 'self' 'unsafe-inline'",  # Existing charts use inline styles.
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-src 'self' blob:",
        "object-src 'self' blob:",  # Preserve the browser's PDF preview viewer.
        "form-action 'self'",
        "frame-ancestors 'self'",
    ]
    if secure_transport:
        policy.append("upgrade-insecure-requests")
    headers = [
        ("Content-Security-Policy", "; ".join(policy)),
        ("X-Content-Type-Options", "nosniff"),
        ("X-Frame-Options", "SAMEORIGIN"),
        ("Referrer-Policy", "same-origin"),
        ("Permissions-Policy", "microphone=(), payment=(), usb=()"),
        ("X-Permitted-Cross-Domain-Policies", "none"),
    ]
    if secure_transport:
        headers.append(("Strict-Transport-Security", "max-age=31536000"))
    return headers


def trusted_inline_script(fragment: bytes, nonce: str) -> bytes:
    """Authorize a script made by a trusted server producer, never arbitrary HTML.

    Its producer must still JSON-escape untrusted data. Do not apply nonces to
    scripts found in user-controlled HTML or by rewriting a whole document.
    """
    if not fragment.startswith(b"<script>"):
        raise ValueError("Expected a trusted server script fragment.")
    return f'<script nonce="{nonce}">'.encode("ascii") + fragment[len(b"<script>"):]
