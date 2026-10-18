"""Password reuse policy and password-history persistence."""

from . import security
from .config import PASSWORD_HISTORY_LENGTH
from .models import AuthError


def recent_password_hashes(database, user_id) -> list[str]:
    """Return only the password hashes within the configured reuse window."""
    return [
        row["password_hash"]
        for row in database.execute(
            """
            SELECT password_hash
            FROM auth.password_history
            WHERE user_id = %s
            ORDER BY created_at DESC, password_hash DESC
            LIMIT %s
            """,
            (user_id, PASSWORD_HISTORY_LENGTH),
        )
    ]


def assert_password_is_new(database, user, candidate: str) -> None:
    """Reject a candidate that matches the current or recent passwords."""
    security.validate_password(candidate)
    current_hash = user["password_hash"]
    password_hashes = [
        current_hash,
        *(
            stored_hash
            for stored_hash in recent_password_hashes(database, user["id"])
            if stored_hash != current_hash
        ),
    ]
    if any(
        security.verify_password(candidate, stored_hash)
        for stored_hash in password_hashes
    ):
        raise AuthError(
            f"Choose a password that was not used in your last {PASSWORD_HISTORY_LENGTH} passwords.",
            400,
            "password_reused",
        )


def record_password_hash(database, user_id, password_hash: str) -> None:
    """Store a password hash and retain only the configured reuse window."""
    database.execute(
        """
        INSERT INTO auth.password_history (user_id, password_hash)
        VALUES (%s, %s)
        ON CONFLICT (user_id, password_hash) DO NOTHING
        """,
        (user_id, password_hash),
    )
    database.execute(
        """
        DELETE FROM auth.password_history
        WHERE ctid IN (
            SELECT ctid
            FROM auth.password_history
            WHERE user_id = %s
            ORDER BY created_at DESC, password_hash DESC
            OFFSET %s
        )
        """,
        (user_id, PASSWORD_HISTORY_LENGTH),
    )


def new_password_hash(database, user, candidate: str) -> str:
    """Validate a candidate before deriving an expensive replacement hash."""
    assert_password_is_new(database, user, candidate)
    return security.hash_password(candidate)
