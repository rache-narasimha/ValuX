"""Meta callback verification, delivery updates and recipient opt-out."""

import hmac
import json
import re
from urllib.parse import parse_qs, urlsplit

from ..auth.database import connection
from . import config, contacts, outbox

PATH = "/api/integrations/whatsapp/webhook"
BODY_LIMIT = 512 * 1024


def verify_callback(handler):
    if config.MODE != "live":
        handler.send_error(404)
        return
    values = parse_qs(urlsplit(handler.path).query)
    mode, token, challenge = (values.get(field, [""])[0] for field in ("hub.mode", "hub.verify_token", "hub.challenge"))
    if mode != "subscribe" or not hmac.compare_digest(token.encode(), config.VERIFY_TOKEN.encode()) or not re.fullmatch(r"[0-9]{1,32}", challenge):
        handler.send_error(403)
        return
    handler._send(200, challenge.encode("ascii"), [("Content-Type", "text/plain"), ("Cache-Control", "no-store")])


def apply_event(event):
    if not isinstance(event, dict) or event.get("object") != "whatsapp_business_account":
        return
    with connection() as database:
        for entry in _objects(event.get("entry")):
            for change in _objects(entry.get("changes")):
                value = change.get("value")
                if change.get("field") != "messages" or not isinstance(value, dict):
                    continue
                metadata = value.get("metadata")
                if not isinstance(metadata, dict) or str(metadata.get("phone_number_id", "")) != config.SENDER_ID:
                    continue
                for status in _objects(value.get("statuses")):
                    if isinstance(status.get("status"), str):
                        outbox.delivery_status(database, status.get("id"), status["status"])
                for message in _objects(value.get("messages")):
                    sender = message.get("from")
                    body = message.get("text")
                    if (
                        message.get("type") == "text" and isinstance(body, dict) and isinstance(body.get("body"), str)
                        and body["body"].strip().casefold() in {"stop", "unsubscribe", "opt out", "opt-out"}
                        and isinstance(sender, str) and re.fullmatch(r"[1-9][0-9]{7,14}", sender)
                    ):
                        contacts.stop_from_number(database, f"+{sender}")


def _objects(value):
    return (entry for entry in value if isinstance(entry, dict)) if isinstance(value, list) else ()


def receive_callback(handler):
    if config.MODE != "live":
        handler.send_error(404)
        return
    try:
        size = int(handler.headers.get("Content-Length", "0"))
        if not 0 < size <= BODY_LIMIT:
            raise ValueError
        raw = handler.read_body(size)
    except ValueError:
        handler.send_error(400)
        return
    expected = "sha256=" + hmac.digest(config.APP_SECRET.encode(), raw, "sha256").hex()
    signature = handler.headers.get("X-Hub-Signature-256", "")
    if not hmac.compare_digest(expected.encode(), signature.encode()):
        handler.send_error(403)
        return
    try:
        event = json.loads(raw)
    except (ValueError, RecursionError):
        handler.send_error(400)
        return
    apply_event(event)
    handler.send_json({"ok": True})
