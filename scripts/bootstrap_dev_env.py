#!/usr/bin/env python3
"""Create ignored development secrets and test-account credentials once."""

import base64
import secrets
import string
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_ROOT / ".env"
CREDENTIAL_FILE = PROJECT_ROOT / "development-credentials.txt"


def password(length: int = 22) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%*-_"
    while True:
        value = "".join(secrets.choice(alphabet) for _ in range(length))
        if all(
            (
                any(character.islower() for character in value),
                any(character.isupper() for character in value),
                any(character.isdigit() for character in value),
                any(not character.isalnum() for character in value),
            )
        ):
            return value


def parsed_environment(contents: str) -> dict[str, str]:
    """Return simple KEY=value entries without evaluating the environment file."""
    result = {}
    for line in contents.splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key] = value
    return result


def updated_environment(contents: str, updates: dict[str, str]) -> str:
    """Replace known keys and append new keys while preserving unrelated settings."""
    remaining = dict(updates)
    lines = []
    for line in contents.splitlines():
        key = line.split("=", 1)[0] if "=" in line else None
        if key in remaining:
            lines.append(f"{key}={remaining.pop(key)}")
        else:
            lines.append(line)
    if remaining:
        lines.extend(("", "# Database connection roles"))
        lines.extend(f"{key}={value}" for key, value in remaining.items())
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    if ENV_FILE.exists():
        existing = ENV_FILE.read_text(encoding="utf-8")
        current = parsed_environment(existing)
        owner_user = current.get("POSTGRES_USER", "valux")
        owner_password = current.get("POSTGRES_PASSWORD", "")
        database_name = current.get("POSTGRES_DB", owner_user)
        runtime_user = current.get("APP_DATABASE_USER", f"{owner_user}_app")
        runtime_password = current.get(
            "APP_DATABASE_PASSWORD", secrets.token_urlsafe(30)
        )
        updates = {
            "POSTGRES_DB": database_name,
            "MIGRATION_DATABASE_URL": (
                f"postgresql://{owner_user}:{owner_password}@postgres:5432/{database_name}"
            ),
            "APP_DATABASE_USER": runtime_user,
            "APP_DATABASE_PASSWORD": runtime_password,
            "DATABASE_URL": (
                f"postgresql://{runtime_user}:{runtime_password}@postgres:5432/{database_name}"
            ),
        }
        ENV_FILE.write_text(
            updated_environment(existing, updates), encoding="utf-8"
        )
        ENV_FILE.chmod(0o600)
        print("Updated database role settings; unrelated .env values were retained.")
        return 0
    database_password = secrets.token_urlsafe(30)
    runtime_database_password = secrets.token_urlsafe(30)
    father_password = password()
    employee_password = password()
    values = {
        "POSTGRES_DB": "valux",
        "POSTGRES_USER": "valux",
        "POSTGRES_PASSWORD": database_password,
        "MIGRATION_DATABASE_URL": (
            f"postgresql://valux:{database_password}@postgres:5432/valux"
        ),
        "APP_DATABASE_USER": "valux_app",
        "APP_DATABASE_PASSWORD": runtime_database_password,
        "DATABASE_URL": (
            "postgresql://valux_app:"
            f"{runtime_database_password}@postgres:5432/valux"
        ),
        "AUTH_ENCRYPTION_KEY": base64.urlsafe_b64encode(
            secrets.token_bytes(32)
        ).decode("ascii"),
        "AUTH_RECOVERY_PEPPER": secrets.token_urlsafe(48),
        "APP_BASE_URL": "http://192.168.1.3:4180",
        "COOKIE_SECURE": "false",
        "SESSION_IDLE_MINUTES": "60",
        "SESSION_ABSOLUTE_HOURS": "24",
        "EMAIL_MODE": "mailpit",
        "SMTP_HOST": "mailpit",
        "SMTP_PORT": "1025",
        "SMTP_USERNAME": "",
        "SMTP_PASSWORD": "",
        "SMTP_USE_TLS": "false",
        "EMAIL_FROM": "ValuX <no-reply@valux.local>",
        "VALUX_TEST_FATHER_ID": "racheshiva01",
        "VALUX_TEST_FATHER_NAME": "K. Sivaprasad",
        "VALUX_TEST_FATHER_PASSWORD": father_password,
        "VALUX_TEST_EMPLOYEE_ID": "lavk0401",
        "VALUX_TEST_EMPLOYEE_NAME": "Lavakumar",
        "VALUX_TEST_EMPLOYEE_PASSWORD": employee_password,
    }
    ENV_FILE.write_text(
        "\n".join(f"{key}={value}" for key, value in values.items()) + "\n"
    )
    ENV_FILE.chmod(0o600)
    CREDENTIAL_FILE.write_text(
        "ValuX development test accounts\n"
        "===================================\n"
        f"Father User ID: racheshiva01\nOne-time password: {father_password}\n\n"
        f"Employee User ID: lavk0401\nOne-time password: {employee_password}\n\n"
        "These passwords expire after seven days once the accounts are provisioned.\n"
        "Delete this file after the test accounts have been activated.\n"
    )
    CREDENTIAL_FILE.chmod(0o600)
    print("Created ignored .env and development-credentials.txt files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
