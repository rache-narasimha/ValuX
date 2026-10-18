#!/usr/bin/env python3
"""Configure ValSphere Gmail delivery without printing or committing secrets."""

from email.message import EmailMessage
from getpass import getpass
from pathlib import Path
import smtplib
import subprocess
import sys


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = PROJECT_ROOT / ".env"


def update_env(values: dict[str, str]) -> None:
    existing = ENV_FILE.read_text().splitlines() if ENV_FILE.exists() else []
    output: list[str] = []
    remaining = dict(values)
    for line in existing:
        if "=" in line and not line.lstrip().startswith("#"):
            key = line.split("=", 1)[0].strip()
            if key in remaining:
                output.append(f"{key}={remaining.pop(key)}")
                continue
        output.append(line)
    if output and output[-1] != "":
        output.append("")
    output.extend(f"{key}={value}" for key, value in remaining.items())
    ENV_FILE.write_text("\n".join(output) + "\n")
    ENV_FILE.chmod(0o600)


def main() -> int:
    print("ValSphere — Gmail sender setup")
    print("The App Password is hidden and saved only in the ignored .env file.")
    sender = input("Gmail or Google Workspace sender address: ").strip().lower()
    if "@" not in sender or any(character.isspace() for character in sender):
        print("Enter a valid sender email address.", file=sys.stderr)
        return 1
    app_password = getpass("16-character Google App Password: ").replace(" ", "")
    if len(app_password) != 16:
        print("Google App Passwords normally contain 16 characters.", file=sys.stderr)
        return 1
    message = EmailMessage()
    message["From"] = f"ValSphere <{sender}>"
    message["To"] = sender
    message["Subject"] = "ValSphere email delivery test"
    message.set_content("Gmail SMTP delivery is configured for ValSphere development testing.")
    try:
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=20) as smtp:
            smtp.starttls()
            smtp.login(sender, app_password)
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as error:
        print(f"Gmail rejected the configuration: {error}", file=sys.stderr)
        print("Nothing was written to .env.", file=sys.stderr)
        return 1
    update_env(
        {
            "EMAIL_MODE": "smtp",
            "SMTP_HOST": "smtp.gmail.com",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": sender,
            "SMTP_PASSWORD": app_password,
            "SMTP_USE_TLS": "true",
            "EMAIL_FROM": f"ValSphere <{sender}>",
        }
    )
    subprocess.run(
        ["docker", "compose", "up", "-d", "--force-recreate", "valuation-report"],
        cwd=PROJECT_ROOT,
        check=True,
    )
    print("Gmail delivery is active. Check the sender inbox for the test message.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
