"""Create, verify, and remove a durable Phase 4 development record.

The three modes are intentionally separate so the Docker services can be
restarted between ``create`` and ``verify``.
"""

from __future__ import annotations

import hashlib
import json
import sys
import uuid
from datetime import date, timedelta

from backend.app.auth.database import connection
from backend.app.reports import service as report_service
from backend.app.valuation.config import OUTPUT_DIR
from backend.app.workflow import service as workflow_service


STATE_FILE = OUTPUT_DIR / ".phase4-persistence-state.json"


def create() -> None:
    if STATE_FILE.exists():
        raise RuntimeError("A Phase 4 persistence test record already exists; run cleanup first.")
    suffix = uuid.uuid4().hex[:10]
    user_id = uuid.uuid4()
    display_name = f"Phase 4 Father {suffix}"
    login_id = f"phase4-{suffix}"
    session = {"user_id": user_id, "display_name": display_name, "role": "father", "login_id": login_id}
    with connection() as database:
        database.execute(
            """
            INSERT INTO auth.users
                (id, user_id, display_name, role, status, password_hash, must_change_password)
            VALUES (%s, %s, %s, 'father', 'active', 'phase4-test-only', FALSE)
            """,
            (user_id, login_id, display_name),
        )
    task = workflow_service.create_task(
        {
            "institutionCode": "CANARA", "branch": "Adoni",
            "customerName": f"Phase 4 Persistence {suffix}", "propertyBrief": "Restart durability check",
            "reportKey": "valuation-general", "assignee": display_name, "priority": "Urgent",
            "assignedDate": date.today().isoformat(), "dueDate": (date.today() + timedelta(days=1)).isoformat(),
            "initialNote": "Phase 4 persistence verification.",
        },
        session,
    )
    draft = report_service.save_draft(
        task["id"],
        {"reportKey": "valuation-general", "schemaVersion": "phase4", "revision": 0, "payload": {"marker": suffix}},
        session,
    )
    content = f"phase4-local-file-{suffix}".encode()
    registered = report_service.register_artifact(
        task["id"], session, content=content, filename=f"phase4-{suffix}.docx",
        artifact_type="valuation_docx", source="generated", payload={"marker": suffix},
    )["task"]
    with connection() as database:
        row = database.execute(
            """
            SELECT sf.storage_key, sf.sha256
            FROM app.tasks t
            JOIN app.task_artifacts a ON a.id = t.latest_artifact_id
            JOIN app.stored_files sf ON sf.id = a.stored_file_id
            WHERE t.task_code = %s
            """,
            (task["id"],),
        ).fetchone()
    state = {
        "taskCode": task["id"], "userId": str(user_id), "marker": suffix,
        "storageKey": row["storage_key"], "sha256": hashlib.sha256(content).hexdigest(),
        "filename": registered["latestDocx"]["filename"], "draftRevision": draft["revision"],
    }
    STATE_FILE.write_text(json.dumps(state), encoding="utf-8")
    print("PASS: Phase 4 persistence fixture created")


def verify() -> None:
    state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    task = workflow_service.get_task(state["taskCode"])
    assert task["latestDocx"]["filename"] == state["filename"]
    with connection() as database:
        row = database.execute(
            "SELECT payload, revision FROM app.report_drafts d JOIN app.tasks t ON t.id = d.task_id WHERE t.task_code = %s",
            (state["taskCode"],),
        ).fetchone()
        stored = database.execute(
            "SELECT sha256 FROM app.stored_files WHERE storage_key = %s",
            (state["storageKey"],),
        ).fetchone()
    assert row["payload"]["marker"] == state["marker"]
    assert row["revision"] == state["draftRevision"]
    assert stored["sha256"] == state["sha256"]
    path = report_service._storage_path(state["storageKey"])
    assert path.is_file()
    assert hashlib.sha256(path.read_bytes()).hexdigest() == state["sha256"]
    print("PASS: PostgreSQL task/draft metadata and local artifact survived service restart")


def identify() -> None:
    if not STATE_FILE.exists():
        return
    state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    print(state["taskCode"], state["userId"], state["storageKey"])


def cleanup_files() -> None:
    if not STATE_FILE.exists():
        return
    state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    report_service._delete_physical([state["storageKey"]])


def finish_cleanup() -> None:
    STATE_FILE.unlink(missing_ok=True)
    print("PASS: Phase 4 persistence fixture removed")


if __name__ == "__main__":
    modes = {
        "create": create, "verify": verify, "identify": identify,
        "cleanup-files": cleanup_files, "finish-cleanup": finish_cleanup,
    }
    try:
        modes[sys.argv[1]]()
    except (IndexError, KeyError):
        raise SystemExit("Use create, verify, identify, cleanup-files, or finish-cleanup")
