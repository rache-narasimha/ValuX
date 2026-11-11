"""Notification recipients, transactional delivery and per-user read isolation."""

import uuid
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

from backend.app.auth.config import DATABASE_URL
from backend.app.business_time import tenant_today
from backend.app.workflow import notifications, service


database = psycopg.connect(DATABASE_URL, row_factory=dict_row)
original = service.connection
original_notifications = notifications.connection


@contextmanager
def shared_connection(*_args, **_kwargs):
    yield database


service.connection = notifications.connection = shared_connection
suffix = uuid.uuid4().hex[:10]
users = []
try:
    for index, role in enumerate(("father", "father", "employee", "employee")):
        user = {"user_id": uuid.uuid4(), "display_name": f"Notification QA {suffix} {index}", "role": role, "login_id": f"nq{suffix}{index}"}
        database.execute("INSERT INTO auth.users (id,user_id,display_name,role,status,password_hash) VALUES (%s,%s,%s,%s,'active','test-only')", (user["user_id"], user["login_id"], user["display_name"], role))
        users.append(user)
    ceo, other_ceo, employee, other_employee = users
    payload = {"institutionCode": "CANARA", "branch": "Notification QA", "customerName": "Notification " + suffix,
               "propertyBrief": "Unique notification test " + suffix, "reportKey": "valuation-general", "assignee": "",
               "priority": "Normal", "assignedDate": tenant_today().isoformat(), "dueDate": tenant_today().isoformat()}
    task = service.create_task(payload, ceo)
    internal = uuid.UUID(task["internalId"])
    def recipients(event):
        return {row["recipient_user_id"] for row in database.execute("SELECT recipient_user_id FROM app.notifications WHERE task_id=%s AND event_type=%s", (internal, event))}
    active = {row["id"] for row in database.execute("SELECT id FROM auth.users WHERE status='active' AND id<>%s", (ceo["user_id"],))}
    assert recipients("unassigned") == active
    task = service.assign(task["id"], {"version": task["version"], "assignee": employee["login_id"], "note": "Assigned"}, ceo)
    assert recipients("assigned") == {employee["user_id"]}
    task = service.put_on_hold(task["id"], {"version": task["version"], "reason": "Awaiting Documents", "note": "Pending"}, employee)
    assert {ceo["user_id"], other_ceo["user_id"]} <= recipients("hold")
    count = database.execute("SELECT COUNT(*) AS n FROM app.notifications WHERE task_id=%s", (internal,)).fetchone()["n"]
    task = service.put_on_hold(task["id"], {"version": task["version"], "reason": "Awaiting Review", "note": "Reason changed"}, employee)
    assert database.execute("SELECT COUNT(*) AS n FROM app.notifications WHERE task_id=%s", (internal,)).fetchone()["n"] == count
    payment = {"version": task["version"], "estimated": 1000, "received": 0}
    task = service.update_payment(task["id"], payment, other_employee)
    assert {ceo["user_id"], other_ceo["user_id"], employee["user_id"]} <= recipients("payment")
    count = database.execute("SELECT COUNT(*) AS n FROM app.notifications WHERE task_id=%s", (internal,)).fetchone()["n"]
    task = service.update_payment(task["id"], {**payment, "version": task["version"]}, other_employee)
    assert database.execute("SELECT COUNT(*) AS n FROM app.notifications WHERE task_id=%s", (internal,)).fetchone()["n"] == count
    for event in ("completed", "closed"):
        service._activity(database, internal, service._actor(employee), "status", "QA " + event, notification=event)
        assert employee["user_id"] not in recipients(event) and ceo["user_id"] in recipients(event)
    response = notifications.list_for(employee, {})
    assert response["unread"] > 0 and len(response["items"]) <= 20
    target = response["items"][0]["id"]
    before = response["unread"]
    notifications.mark_read(other_employee, {"id": target})
    assert notifications.list_for(employee, {})["unread"] == before
    notifications.mark_read(employee, {"id": target})
    assert notifications.list_for(employee, {})["unread"] == before - 1
    shown = [item["id"] for item in response["items"][1:3]]
    assert len(shown) == 2
    notifications.mark_read(other_employee, {"ids": shown})
    assert notifications.list_for(employee, {})["unread"] == before - 1
    notifications.mark_read(employee, {"ids": shown})
    notifications.mark_read(employee, {"ids": shown})
    remaining = notifications.list_for(employee, {})
    assert remaining["unread"] == before - 1 - len(shown)
    assert all(item["read"] == (item["id"] in {target, *shown}) for item in remaining["items"])
    notifications.mark_read(employee, {"all": True})
    assert notifications.list_for(employee, {})["unread"] == 0
    # A failed transaction must roll back notification and task history together.
    database.execute("SAVEPOINT notification_rollback")
    service._activity(database, internal, service._actor(employee), "status", "Rolled back", notification="completed")
    database.execute("ROLLBACK TO SAVEPOINT notification_rollback")
    assert not database.execute("SELECT 1 FROM app.task_activities WHERE task_id=%s AND message='Rolled back'", (internal,)).fetchone()
    print("PASS: notification recipients, self exclusion, no-op suppression, read isolation and transactional rollback")
finally:
    database.rollback()
    database.close()
    service.connection = original
    notifications.connection = original_notifications
