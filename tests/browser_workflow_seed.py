"""Create and remove the exact temporary assignment used by the role UI smoke test."""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta

from backend.app.auth.database import connection
from backend.app.workflow import service


def seed(marker: str) -> None:
    with connection() as database:
        father = database.execute(
            "SELECT id, user_id AS login_id, display_name, role FROM auth.users WHERE user_id = %s AND status = 'active'",
            (os.environ.get("VALUX_QA_CEO_ID", "racheshiva01"),),
        ).fetchone()
        employee = database.execute(
            "SELECT id, display_name FROM auth.users WHERE user_id = %s AND status = 'active'",
            (os.environ.get("VALUX_QA_EMPLOYEE_ID", "lavk0401"),),
        ).fetchone()
    assert father and employee, "The browser smoke-test users are not available."
    session = {
        "user_id": father["id"],
        "login_id": father["login_id"],
        "display_name": father["display_name"],
        "role": father["role"],
    }
    today = date.today()
    task = service.create_task(
        {
            "institutionCode": "CANARA",
            "branch": "Browser QA",
            "customerName": marker,
            "propertyBrief": "Temporary role-interface regression record",
            "reportKey": "valuation-general",
            "assignee": employee["display_name"],
            "priority": "Normal",
            "assignedDate": today.isoformat(),
            "dueDate": (today + timedelta(days=2)).isoformat(),
            "initialNote": "Temporary browser regression assignment.",
        },
        session,
    )
    print(task["id"])


if __name__ == "__main__":
    action = sys.argv[1]
    marker_value = os.environ["VALUX_QA_TASK_MARKER"]
    if action == "seed":
        seed(marker_value)
    else:
        raise SystemExit(f"Unsupported action: {action}")
