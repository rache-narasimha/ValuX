"""PostgreSQL runtime connections and readiness checks."""

import time
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import DATABASE_URL


_runtime_pool: ConnectionPool | None = None


@contextmanager
def database_pool():
    """Reuse PostgreSQL connections for the lifetime of the HTTP server."""
    global _runtime_pool
    with ConnectionPool(
        DATABASE_URL,
        kwargs={"row_factory": dict_row},
        min_size=0,
        max_size=8,
        max_idle=60,
        check=ConnectionPool.check_connection,
        open=False,
    ) as pool:
        _runtime_pool = pool
        try:
            yield
        finally:
            _runtime_pool = None


@contextmanager
def connection(database_url: str = DATABASE_URL, *, autocommit: bool = False):
    """Yield a connection, using a transaction unless the caller opts out."""
    pool = _runtime_pool
    if pool is not None and database_url == DATABASE_URL:
        with pool.connection() as database:
            if autocommit:
                database.autocommit = True
            try:
                yield database
            finally:
                if autocommit and not database.closed:
                    database.autocommit = False
        return
    with psycopg.connect(database_url, row_factory=dict_row, autocommit=autocommit) as database:
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
