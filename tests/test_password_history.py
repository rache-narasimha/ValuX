"""Regression check for the enforced 5-password reuse window."""

import secrets
import string
import uuid

from backend.app.auth import security, service
from backend.app.auth.database import connection


def password(index: int) -> str:
    suffix = "".join(secrets.choice(string.ascii_letters) for _ in range(10))
    return f"ValuX!{index:02d}aA{suffix}9"


user_id = f"history{uuid.uuid4().hex[:12]}"
passwords = [password(index) for index in range(6)]

try:
    service.provision_user(user_id, "Password History QA", "employee", passwords[0])
    with connection() as database:
        user = database.execute(
            "SELECT * FROM auth.users WHERE user_id = %s FOR UPDATE",
            (user_id,),
        ).fetchone()
        for candidate in passwords[1:]:
            replacement_hash = security.hash_password(candidate)
            database.execute(
                "UPDATE auth.users SET password_hash = %s WHERE id = %s",
                (replacement_hash, user["id"]),
            )
            service._record_password_hash(database, user["id"], replacement_hash)
            user["password_hash"] = replacement_hash

        retained = database.execute(
            "SELECT COUNT(*) AS count FROM auth.password_history WHERE user_id = %s",
            (user["id"],),
        ).fetchone()["count"]
        assert retained == 5

        try:
            service._assert_password_is_new(database, user, passwords[1])
        except service.AuthError as error:
            assert error.code == "password_reused"
        else:
            raise AssertionError("A password inside the 5-password window was accepted")

        service._assert_password_is_new(database, user, passwords[0])
finally:
    with connection() as database:
        database.execute("DELETE FROM auth.users WHERE user_id = %s", (user_id,))

print("PASS: 5-password reuse window")
