"""Focused regression checks for password, TOTP, and recovery primitives."""

import time

from backend.app.auth import security


password = "ValSphere-Secure!2026"
stored = security.hash_password(password)
assert security.verify_password(password, stored)
assert not security.verify_password("incorrect", stored)

for weak in ("short", "alllowercase123!", "ALLUPPERCASE123!", "NoNumbersHere!"):
    try:
        security.validate_password(weak)
    except ValueError:
        pass
    else:
        raise AssertionError(f"Weak password accepted: {weak}")

try:
    security.validate_password("A1!" + "a" * 126)
except ValueError:
    pass
else:
    raise AssertionError("Password longer than 128 characters was accepted")

secret = security.new_totp_secret()
timestamp = int(time.time())
code = security.totp_code(secret, timestamp)
assert security.verify_totp(secret, code, timestamp)
assert not security.verify_totp(secret, "000000" if code != "000000" else "111111", timestamp)

encrypted = security.encrypt_secret(secret)
assert encrypted != secret
assert security.decrypt_secret(encrypted) == secret

codes = security.generate_recovery_codes()
assert len(codes) == len(set(codes)) == 8
assert all(len(code) == 14 for code in codes)
assert security.recovery_hash(codes[0]) == security.recovery_hash(codes[0].lower().replace("-", ""))

print("PASS: authentication cryptographic primitives")
