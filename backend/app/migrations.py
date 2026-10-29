"""Run authentication and business migrations in their required order."""

from .auth.config import MIGRATION_DATABASE_URL
from .auth.database import wait_for_database
from .auth.migrations import run_migrations as run_auth_migrations
from .persistence.migrations import run_migrations as run_business_migrations


def main() -> int:
    wait_for_database(MIGRATION_DATABASE_URL)
    run_auth_migrations()
    run_business_migrations()
    print("ValuX authentication and business migrations completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
