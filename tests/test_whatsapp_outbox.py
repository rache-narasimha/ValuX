"""Transactional assignment alerts, privacy, retries and signed opt-out."""

import hmac
import json
import uuid
from contextlib import contextmanager
from unittest.mock import patch
from urllib.parse import quote

from fastapi import Request

from backend.app.auth import security
from backend.app.auth.database import connection
from backend.app.business_time import tenant_today
from backend.app.web import handler
from backend.app.whatsapp import config, contacts, outbox, provider, webhook
from backend.app.workflow import service


def run(database):
    @contextmanager
    def transactional_connection(*_args, **_kwargs):
        yield database

    suffix = uuid.uuid4().hex[:8]
    users = []
    for index, role in enumerate(("father", "employee", "employee")):
        user = {"user_id": uuid.uuid4(), "display_name": f"WhatsApp fixture {index}", "role": role, "login_id": f"wa{suffix}{index}"}
        database.execute(
            "INSERT INTO auth.users (id,user_id,display_name,role,status,password_hash) "
            "VALUES (%s,%s,%s,%s,'active','fixture-only')",
            (user["user_id"], user["login_id"], user["display_name"], role),
        )
        users.append(user)
    ceo, employee, other = users
    numbers = {employee["user_id"]: "+12025550142", other["user_id"]: "+12025550143"}
    for user, number in numbers.items():
        database.execute(
            "INSERT INTO app.whatsapp_contacts(user_id,phone_key,phone_encrypted,revision,opted_in_at,consent_version) "
            "VALUES(%s,%s,%s,%s,NOW(),%s)",
            (user, contacts._digest("number", number), security.encrypt_secret(number), uuid.uuid4(), config.CONSENT_VERSION),
        )

    def queue():
        return database.execute(
            "SELECT id, recipient_id, status, attempt_count FROM app.whatsapp_outbox WHERE task_id=%s ORDER BY id",
            (task_id,),
        ).fetchall()

    calls = []

    def capture(number, values, reference):
        calls.append((number, values, reference))
        return "mock-test-" + uuid.uuid4().hex

    assert outbox._message({
        "report_key": "valuation-general", "report_group": "valuation",
        "customer_name": "A", "institution_name_snapshot": "Bank", "branch": "Branch",
        "assigned_date": tenant_today(), "due_date": tenant_today(),
    })[-1] == "•••"

    with patch.object(config, "MODE", "mock"), patch.object(service, "connection", transactional_connection), \
            patch.object(outbox, "connection", transactional_connection), patch.object(webhook, "connection", transactional_connection), \
            patch.object(provider, "send_assignment", side_effect=capture) as send:
        task = service.create_task({
            "institutionCode": "CANARA", "branch": "Fixture Branch", "customerName": "Synthetic Applicant " + suffix,
            "propertyBrief": "Private fixture address " + suffix, "reportKey": "valuation-general",
            "assignee": employee["login_id"], "initialNote": "Test assignment",
            "priority": "Normal", "assignedDate": tenant_today().isoformat(), "dueDate": tenant_today().isoformat(),
        }, ceo)
        task_id = uuid.UUID(task["internalId"])
        assert len(queue()) == 1 and queue()[0]["status"] == "queued" and not calls
        previous = queue()[0]["id"]
        task = service.assign(task["id"], {"version": task["version"], "assignee": other["login_id"], "note": "Transferred"}, ceo)
        assert any(item["id"] == previous and item["status"] == "cancelled" for item in queue())
        current = next(item for item in queue() if item["status"] == "queued")
        send.side_effect = provider.DeliveryError("retry")
        assert outbox.dispatch() == 1 and outbox.dispatch() == 0
        database.execute("UPDATE app.whatsapp_outbox SET next_attempt_at=NOW() WHERE id=%s", (current["id"],))
        send.side_effect = capture
        assert outbox.dispatch() == 1
        number, body, reference = calls[0]
        assert number == numbers[other["user_id"]] and reference == str(current["id"])
        assert body[-1] == "S•••" and "Fixture Branch" in body[1] and len(body) == 5
        assert not any("Applicant" in value or "Private fixture address" in value or suffix in value for value in body)
        assert outbox.task_reference(reference, employee["user_id"]) is None
        assert outbox.task_reference(reference, other["user_id"]) == task["id"]
        alert_path = f"/alerts/assignment/{reference}"
        request = Request({"type": "http", "method": "GET", "path": alert_path, "query_string": b"", "headers": []})
        with patch.object(handler.auth_routes, "require_full_session", return_value=other):
            response = handler.Handler(request).dispatch()
            assert response.headers["location"] == f"/tasks/detail?id={quote(task['id'], safe='')}"
        with patch.object(handler.auth_routes, "require_full_session", return_value=employee):
            assert handler.Handler(request).dispatch().status_code == 404

        task = service.assign(task["id"], {"version": task["version"], "assignee": employee["login_id"], "note": "Transferred back"}, ceo)
        pending = next(item for item in queue() if item["status"] == "queued")

        event = {"object": "whatsapp_business_account", "entry": [{"changes": [{"field": "messages", "value": {
            "metadata": {"phone_number_id": "123456"},
            "messages": [{"from": numbers[employee["user_id"]][1:], "type": "text", "text": {"body": "STOP"}}],
        }}]}]}
        raw = json.dumps(event).encode()

        class Callback:
            def __init__(self, signature):
                self.headers = {"Content-Length": str(len(raw)), "X-Hub-Signature-256": signature}
                self.status = None

            def read_body(self, _length):
                return raw

            def send_error(self, status):
                self.status = status

            def send_json(self, _body):
                self.status = 200

        with patch.multiple(config, MODE="live", APP_SECRET="local-test-secret", SENDER_ID="123456"):
            bad = Callback("sha256=incorrect")
            webhook.receive_callback(bad)
            assert bad.status == 403 and any(item["status"] == "queued" for item in queue())
            valid = Callback("sha256=" + hmac.digest(b"local-test-secret", raw, "sha256").hex())
            webhook.receive_callback(valid)
            webhook.receive_callback(valid)
            assert valid.status == 200
            message = event["entry"][0]["changes"][0]["value"]["messages"][0]
            for reply in ("Hi", "Subscribe"):
                message["text"]["body"] = reply
                raw = json.dumps(event).encode()
                callback = Callback("sha256=" + hmac.digest(b"local-test-secret", raw, "sha256").hex())
                webhook.receive_callback(callback)
                assert callback.status == 200
                contact = database.execute(
                    "SELECT opted_in_at FROM app.whatsapp_contacts WHERE user_id=%s",
                    (employee["user_id"],),
                ).fetchone()
                assert contact["opted_in_at"] is None
        assert next(item for item in queue() if item["id"] == pending["id"])["status"] == "cancelled"
        assert outbox.dispatch() == 0


if __name__ == "__main__":
    with connection() as database:
        try:
            run(database)
            print("PASS: WhatsApp assignment queue, non-blocking provider retry, masked payload, opaque link, reassignment, signed STOP, and explicit re-subscription")
        finally:
            database.rollback()
