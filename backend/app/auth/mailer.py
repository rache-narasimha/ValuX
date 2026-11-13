"""Email delivery for verification and password recovery."""

import smtplib
import ssl
from email.message import EmailMessage

from .config import (
    APP_BASE_URL,
    EMAIL_FROM,
    SMTP_HOST,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_USERNAME,
    SMTP_USE_TLS,
)


def send_email(recipient: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = EMAIL_FROM
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(body)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
        if SMTP_USE_TLS:
            smtp.starttls(context=ssl.create_default_context())
        if SMTP_USERNAME:
            smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
        smtp.send_message(message)


def send_verification(recipient: str, display_name: str, token: str) -> None:
    link = f"{APP_BASE_URL}/auth#verify-email={token}"
    send_email(
        recipient,
        "Verify your ValuX recovery email",
        f"Hello {display_name},\n\n"
        "Verify this recovery email to finish activating your ValuX account:\n"
        f"{link}\n\n"
        "This single-use link expires in 24 hours. If you did not request it, "
        "contact the account operator.",
    )


def send_password_reset(recipient: str, display_name: str, token: str) -> None:
    link = f"{APP_BASE_URL}/auth#reset-password={token}"
    send_email(
        recipient,
        "Reset your ValuX password",
        f"Hello {display_name},\n\n"
        "A password reset was requested for your ValuX account:\n"
        f"{link}\n\n"
        "This single-use link expires in 30 minutes. Your authenticator is still "
        "required at the next login. If you did not request this, ignore this message.",
    )


def send_password_changed(recipient: str, display_name: str) -> None:
    send_email(
        recipient, "Your ValuX password was changed",
        f"Hello {display_name},\n\nYour ValuX password was changed. Other signed-in sessions "
        "have been signed out. If you did not make this change, contact your account operator immediately.",
    )
