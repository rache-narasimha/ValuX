"""Durable per-recipient notifications, written with their task activity."""

import uuid

from ..auth.database import connection
from ..auth.models import AuthError


def record(database, task_id, activity_id, actor_id, event):
    task = database.execute("SELECT assignee_user_id FROM app.tasks WHERE id = %s", (task_id,)).fetchone()
    assignee = task["assignee_user_id"]
    recipients = database.execute(
        "SELECT id FROM auth.users WHERE status = 'active' AND id <> %s AND "
        "(%s = 'unassigned' OR (%s = 'assigned' AND id = %s) OR "
        "(%s = 'hold' AND role = 'father') OR "
        "(%s IN ('payment', 'completed', 'closed') AND (role = 'father' OR id = %s)))",
        (actor_id, event, event, assignee, event, event, assignee),
    ).fetchall()
    for recipient in recipients:
        database.execute(
            "INSERT INTO app.notifications (id, recipient_user_id, task_id, activity_id, event_type) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (recipient_user_id, activity_id) DO NOTHING",
            (uuid.uuid4(), recipient["id"], task_id, activity_id, event),
        )


def list_for(session, options):
    try:
        offset = max(0, min(10000, int(options.get("offset", 0))))
    except (ValueError, TypeError) as error:
        raise AuthError("Invalid notification page.") from error
    with connection() as database:
        unread = database.execute(
            "SELECT COUNT(*) AS count FROM app.notifications WHERE recipient_user_id = %s AND read_at IS NULL",
            (session["user_id"],),
        ).fetchone()["count"]
        rows = database.execute(
            "SELECT n.id, n.read_at, n.created_at, n.event_type, t.task_code, t.customer_name, t.report_key, "
            "a.message, a.actor_name_snapshot FROM app.notifications n "
            "JOIN app.tasks t ON t.id = n.task_id JOIN app.task_activities a ON a.id = n.activity_id "
            "WHERE n.recipient_user_id = %s ORDER BY n.created_at DESC, n.id DESC LIMIT 21 OFFSET %s",
            (session["user_id"], offset),
        ).fetchall()
    return {"unread": unread, "hasMore": len(rows) > 20, "items": [
        {"id": str(row["id"]), "read": bool(row["read_at"]), "createdAt": row["created_at"].isoformat(),
         "taskCode": row["task_code"], "customer": row["customer_name"], "reportKey": row["report_key"],
         "message": row["message"], "actor": row["actor_name_snapshot"], "event": row["event_type"]}
        for row in rows[:20]
    ]}


def mark_read(session, payload):
    identifiers = payload.get("ids")
    if identifiers is not None:
        if not isinstance(identifiers, list) or not 1 <= len(identifiers) <= 100:
            raise AuthError("Select between 1 and 100 notifications to mark as read.")
        try:
            identifiers = [uuid.UUID(str(value)) for value in identifiers]
        except (ValueError, TypeError) as error:
            raise AuthError("Invalid notification.") from error
        with connection() as database:
            database.execute(
                "UPDATE app.notifications SET read_at = NOW() "
                "WHERE recipient_user_id = %s AND read_at IS NULL AND id = ANY(%s::uuid[])",
                (session["user_id"], identifiers),
            )
        return

    identifier = payload.get("id")
    if identifier is not None:
        try:
            identifier = uuid.UUID(str(identifier))
        except (ValueError, TypeError) as error:
            raise AuthError("Invalid notification.") from error
    elif payload.get("all") is not True:
        raise AuthError("Select a notification to mark as read.")
    with connection() as database:
        database.execute(
            "UPDATE app.notifications SET read_at = NOW() WHERE recipient_user_id = %s AND read_at IS NULL "
            "AND (%s::uuid IS NULL OR id = %s)", (session["user_id"], identifier, identifier),
        )
