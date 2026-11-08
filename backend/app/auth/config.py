"""Environment-backed authentication settings."""

import os
from pathlib import Path


AUTH_ROOT = Path(__file__).resolve().parent
MIGRATIONS_DIR = AUTH_ROOT / "migrations"
DATABASE_URL = os.environ.get("DATABASE_URL", "")
MIGRATION_DATABASE_URL = os.environ.get("MIGRATION_DATABASE_URL", "")
APP_DATABASE_USER = os.environ.get("APP_DATABASE_USER", "valsphere_app")
APP_DATABASE_PASSWORD = os.environ.get("APP_DATABASE_PASSWORD", "")
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:4180").rstrip("/")
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
SESSION_COOKIE = "valux_session"
CSRF_COOKIE = "valux_csrf"
SESSION_IDLE_MINUTES = int(os.environ.get("SESSION_IDLE_MINUTES", "60"))
SESSION_ABSOLUTE_HOURS = int(os.environ.get("SESSION_ABSOLUTE_HOURS", "24"))
ACTIVATION_DAYS = 7
EMAIL_VERIFICATION_HOURS = 24
PASSWORD_RESET_MINUTES = 30
TOKEN_COOLDOWN_SECONDS = 60
LOGIN_WINDOW_MINUTES = 15
LOGIN_MAX_FAILURES = 5
LOCKOUT_MINUTES = 15
PASSWORD_HISTORY_LENGTH = 5
MFA_MAX_FAILURES = 5
MFA_LOCKOUT_MINUTES = 15

AUTH_ENCRYPTION_KEY = os.environ.get("AUTH_ENCRYPTION_KEY", "")
AUTH_RECOVERY_PEPPER = os.environ.get("AUTH_RECOVERY_PEPPER", "")

EMAIL_MODE = os.environ.get("EMAIL_MODE", "mailpit").lower()
SMTP_HOST = os.environ.get("SMTP_HOST", "mailpit")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "1025"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "false").lower() == "true"
EMAIL_FROM = os.environ.get("EMAIL_FROM", "ValuX <no-reply@valux.local>")


def validate_secrets() -> None:
    """Fail fast when cryptographic configuration is not suitable."""
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required")
    if not AUTH_ENCRYPTION_KEY:
        raise RuntimeError("AUTH_ENCRYPTION_KEY is required")
    if len(AUTH_RECOVERY_PEPPER) < 24:
        raise RuntimeError("AUTH_RECOVERY_PEPPER must contain at least 24 characters")
    if EMAIL_MODE not in {"mailpit", "smtp"}:
        raise RuntimeError("EMAIL_MODE must be either 'mailpit' or 'smtp'")


def validate_migration_settings() -> None:
    """Reject incomplete database-role configuration before migration."""
    if not MIGRATION_DATABASE_URL:
        raise RuntimeError("MIGRATION_DATABASE_URL is required")
    if not APP_DATABASE_USER:
        raise RuntimeError("APP_DATABASE_USER is required")
    if len(APP_DATABASE_PASSWORD) < 24:
        raise RuntimeError("APP_DATABASE_PASSWORD must contain at least 24 characters")
