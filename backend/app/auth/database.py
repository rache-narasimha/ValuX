"""PostgreSQL runtime connections and readiness checks."""

import time
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from .config import DATABASE_URL


@contextmanager
def connection(database_url: str = DATABASE_URL):
    """Yield a transactional connection for the requested database URL."""
    with psycopg.connect(database_url, row_factory=dict_row) as database:
        yield database


def wait_for_database(
    database_url: str = DATABASE_URL,
    attempts: int = 30,
    delay_seconds: float = 2.0,
) -> None:
    last_error = None
    for _ in range(attempts):
        try:
            with connection(database_url) as database:
                database.execute("SELECT 1")
            return
        except psycopg.OperationalError as error:
            last_error = error
            time.sleep(delay_seconds)
    raise RuntimeError("PostgreSQL did not become ready") from last_error


def healthcheck() -> bool:
    try:
        with connection() as database:
            database.execute("SELECT 1")
        return True
    except psycopg.Error:
        return False
