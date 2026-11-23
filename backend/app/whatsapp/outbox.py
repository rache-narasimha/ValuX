"""Durable assignment deliveries, sent independently of task changes."""

import uuid
from datetime import timedelta

from ..auth import security
from ..auth.database import connection
from ..auth.models import now
from . import config, provider


def enqueue(database, task_id, activity_id, recipient_id):
    if not config.enabled():
        return
    database.execute(
        "UPDATE app.whatsapp_outbox SET status='cancelled' WHERE task_id=%s AND status='queued' AND activity_id<>%s",
        (task_id, activity_id),
    )
    if recipient_id is None:
        return
    database.execute(
        """
        INSERT INTO app.whatsapp_outbox (id, activity_id, task_id, recipient_id, contact_revision)
        SELECT %s, %s, %s, c.user_id, c.revision FROM app.whatsapp_contacts c
        JOIN auth.users u ON u.id=c.user_id
        WHERE c.user_id=%s AND c.opted_in_at IS NOT NULL AND u.status='active'
        ON CONFLICT (activity_id, recipient_id) DO NOTHING
        """,
        (uuid.uuid4(), activity_id, task_id, recipient_id),
    )


def _message(row):
    from ..workflow.service import REPORTS

    report = REPORTS[row["report_key"]][2]
    if row["report_group"] == "revaluation":
        report = report.replace("Valuation", "Re-Valuation")
    applicant = row["customer_name"].strip()
    initial = applicant[0].upper()[:1] if len(applicant) > 1 and applicant[0].isalpha() else ""
    institution = " ".join(row["institution_name_snapshot"].split())[:96]
    branch = " ".join(row["branch"].split())[:64]
    return [
        report,
        f"{institution} · {branch}" if branch else institution,
        row["assigned_date"].strftime("%d %b %Y"),
        row["due_date"].strftime("%d %b %Y"),
        f"{initial}•••" if initial else "•••",
    ]


def _claim():
    with connection() as database:
        item = database.execute(
            "SELECT id, task_id, recipient_id, contact_revision, attempt_count "
            "FROM app.whatsapp_outbox WHERE status='queued' AND next_attempt_at<=NOW() "
            "ORDER BY next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED"
        ).fetchone()
        if not item:
            return None
        row = database.execute(
            """
            SELECT c.phone_encrypted, t.report_key, t.report_group, t.institution_name_snapshot,
                   t.branch, t.assigned_date, t.due_date, t.customer_name
            FROM app.whatsapp_contacts c JOIN auth.users u ON u.id=c.user_id JOIN app.tasks t ON t.id=%s
            WHERE c.user_id=%s AND c.revision=%s AND c.opted_in_at IS NOT NULL AND u.status='active'
              AND t.assignee_user_id=c.user_id AND t.status IN ('In Progress','On Hold')
            """,
            (item["task_id"], item["recipient_id"], item["contact_revision"]),
        ).fetchone()
        if not row:
            database.execute("UPDATE app.whatsapp_outbox SET status='cancelled' WHERE id=%s", (item["id"],))
            return item, None
        database.execute(
            "UPDATE app.whatsapp_outbox SET status='sending', attempt_count=attempt_count+1, sending_at=NOW() WHERE id=%s",
            (item["id"],),
        )
        return item, row


def _deliver(item, row):
    number = security.decrypt_secret(row["phone_encrypted"])
    identifier = None
    next_attempt = now()
    try:
        identifier = provider.send_assignment(number, _message(row), str(item["id"]))
        status = "sent"
    except provider.DeliveryError as error:
        if error.outcome == "retry" and item["attempt_count"] < 3:
            status = "queued"
            next_attempt += timedelta(minutes=2 ** item["attempt_count"])
        else:
            status = "uncertain" if error.outcome == "uncertain" else "failed"
    with connection() as database:
        database.execute(
            "UPDATE app.whatsapp_outbox SET status=%s, provider_id=%s, next_attempt_at=%s, sending_at=NULL "
            "WHERE id=%s AND status='sending'",
            (status, identifier, next_attempt, item["id"]),
        )


def dispatch(limit=10):
    if not config.enabled():
        return 0
    with connection() as database:
        database.execute(
            "UPDATE app.whatsapp_outbox SET status='uncertain' "
            "WHERE status='sending' AND sending_at < NOW() - INTERVAL '5 minutes'"
        )
        database.execute(
            "UPDATE app.whatsapp_outbox SET status='cancelled' "
            "WHERE status='queued' AND created_at < NOW() - INTERVAL '1 day'"
        )
        database.execute(
            "UPDATE app.whatsapp_challenges SET phone_key=NULL, phone_encrypted=NULL, code_hash=NULL, consent=FALSE "
            "WHERE code_hash IS NOT NULL AND (expires_at <= NOW() OR session_id IS NULL)"
        )
    attempted = 0
    for _ in range(limit):
        claimed = _claim()
        if claimed is None:
            break
        item, row = claimed
        if row:
            _deliver(item, row)
            attempted += 1
    return attempted


def task_reference(reference, recipient_id):
    if not config.enabled():
        return None
    try:
        identifier = uuid.UUID(reference)
    except ValueError:
        return None
    with connection() as database:
        row = database.execute(
            "SELECT t.task_code FROM app.whatsapp_outbox o JOIN app.tasks t ON t.id=o.task_id "
            "WHERE o.id=%s AND o.recipient_id=%s AND o.status IN ('sending','sent','delivered','read','uncertain') "
            "AND o.created_at > NOW() - INTERVAL '7 days'",
            (identifier, recipient_id),
        ).fetchone()
    return row["task_code"] if row else None


def delivery_status(database, provider_id, status):
    previous = {
        "delivered": ["sent"], "read": ["sent", "delivered"],
        "failed": ["sent"],
    }.get(status)
    if previous and isinstance(provider_id, str) and 1 <= len(provider_id) <= 256:
        database.execute(
            "UPDATE app.whatsapp_outbox SET status=%s WHERE provider_id=%s AND status=ANY(%s)",
            (status, provider_id, previous),
        )
