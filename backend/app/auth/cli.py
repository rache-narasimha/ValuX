"""Host-side account provisioning and recovery commands.

Run inside Docker, for example:
    docker compose exec app python -m backend.app.auth.cli provision
"""

import argparse
import os
import secrets
import string
import sys
from getpass import getpass

from .config import validate_secrets
from .database import wait_for_database
from .service import AuthError, assisted_recovery, provision_user, set_disabled


def generated_password() -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%*-_"
    while True:
        value = "".join(secrets.choice(alphabet) for _ in range(18))
        if any(c.islower() for c in value) and any(c.isupper() for c in value) and any(c.isdigit() for c in value) and any(not c.isalnum() for c in value):
            return value


def password_from_operator(generate: bool) -> str:
    if generate:
        return generated_password()
    first = getpass("One-time activation password: ")
    second = getpass("Confirm activation password: ")
    if first != second:
        raise AuthError("The passwords do not match.")
    return first


def provision(args) -> None:
    password = password_from_operator(args.generate_password)
    user = provision_user(args.user_id, args.name, args.role, password)
    print(f"Provisioned {user['userId']} ({user['role']}).")
    if args.generate_password:
        print(f"One-time activation password: {password}")
    print("Share the User ID and one-time password privately. The password expires in seven days.")


def recover(args) -> None:
    password = password_from_operator(args.generate_password)
    assisted_recovery(args.user_id, password)
    print(f"Recovery reset completed for {args.user_id}.")
    if args.generate_password:
        print(f"One-time recovery password: {password}")
    print("All sessions, MFA credentials, recovery codes, and email recovery links were revoked.")


def seed_dev(_args) -> None:
    accounts = [
        (
            os.environ.get("VALUX_TEST_FATHER_ID", "racheshiva01"),
            os.environ.get("VALUX_TEST_FATHER_NAME", "K. Sivaprasad"),
            "father",
            os.environ.get("VALUX_TEST_FATHER_PASSWORD", ""),
        ),
        (
            os.environ.get("VALUX_TEST_EMPLOYEE_ID", "lavk0401"),
            os.environ.get("VALUX_TEST_EMPLOYEE_NAME", "Lavakumar"),
            "employee",
            os.environ.get("VALUX_TEST_EMPLOYEE_PASSWORD", ""),
        ),
    ]
    if any(not account[3] for account in accounts):
        raise AuthError("Set both VALUX_TEST_*_PASSWORD values in the ignored .env file.")
    for user_id, name, role, password in accounts:
        try:
            provision_user(user_id, name, role, password, actor="seed-dev")
            print(f"Provisioned development account {user_id} ({role}).")
        except AuthError as error:
            if error.code != "duplicate_user":
                raise
            print(f"Development account {user_id} already exists; unchanged.")


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description="ValuX authentication account operator")
    commands = root.add_subparsers(dest="command", required=True)

    create = commands.add_parser("provision", help="Provision a father or employee account")
    create.add_argument("--user-id", required=True)
    create.add_argument("--name", required=True)
    create.add_argument("--role", choices=("father", "employee"), required=True)
    create.add_argument("--generate-password", action="store_true")
    create.set_defaults(action=provision)

    recovery = commands.add_parser("recover", help="Reset an account to assisted activation")
    recovery.add_argument("--user-id", required=True)
    recovery.add_argument("--generate-password", action="store_true")
    recovery.set_defaults(action=recover)

    for command, disabled in (("disable", True), ("enable", False)):
        operation = commands.add_parser(command, help=f"{command.title()} an account")
        operation.add_argument("--user-id", required=True)
        operation.set_defaults(action=lambda args, value=disabled: set_disabled(args.user_id, value))

    seed = commands.add_parser("seed-dev", help="Provision configured development test accounts")
    seed.set_defaults(action=seed_dev)
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        validate_secrets()
        wait_for_database()
        args.action(args)
        return 0
    except AuthError as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
