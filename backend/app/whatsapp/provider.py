"""Send the two approved template shapes without logging request or response data."""

import json
import smtplib
import uuid
from email.message import EmailMessage
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from . import config


class DeliveryError(Exception):
    def __init__(self, outcome: str):
        self.outcome = outcome
        super().__init__("WhatsApp delivery could not be confirmed")


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _text(value):
    return {"type": "text", "text": value}


def _template(number, name, values, button_value):
    if config.MODE != "live":
        raise DeliveryError("failed")
    payload = {
        "messaging_product": "whatsapp", "recipient_type": "individual",
        "to": number.removeprefix("+"), "type": "template",
        "template": {
            "name": name, "language": {"code": config.LANGUAGE},
            "components": [
                {"type": "body", "parameters": [_text(value) for value in values]},
                {"type": "button", "sub_type": "url", "index": "0", "parameters": [_text(button_value)]},
            ],
        },
    }
    request = Request(
        f"https://graph.facebook.com/{config.GRAPH_VERSION}/{config.SENDER_ID}/messages",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {config.ACCESS_TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with build_opener(_RejectRedirects()).open(request, timeout=10) as response:
            identifier = json.loads(response.read(65536))["messages"][0]["id"]
        if not isinstance(identifier, str) or not 1 <= len(identifier) <= 256:
            raise DeliveryError("uncertain")
        return identifier
    except HTTPError as error:
        # Retry only an explicit rate-limit rejection. A lost response may follow acceptance.
        outcome = "retry" if error.code == 429 else "uncertain" if error.code >= 500 else "failed"
        error.close()
        raise DeliveryError(outcome) from None
    except (OSError, URLError, ValueError, TypeError, KeyError, IndexError):
        raise DeliveryError("uncertain") from None


def send_code(number, code):
    if config.MODE == "mock":
        message = EmailMessage()
        message["From"] = "valux-whatsapp-mock@valux.test"
        message["To"] = "whatsapp-verification@valux.test"
        message["Subject"] = f"Local WhatsApp test code for number ending {number[-4:]}"
        message.set_content(code)
        try:
            with smtplib.SMTP("mailpit", 1025, timeout=5) as smtp:
                smtp.send_message(message)
        except (OSError, smtplib.SMTPException):
            raise DeliveryError("failed") from None
        return
    _template(number, config.OTP_TEMPLATE, [code], code)


def send_assignment(number, values, reference):
    if config.MODE == "mock":
        return f"mock-{uuid.uuid4()}"
    return _template(number, config.ASSIGNMENT_TEMPLATE, values, reference)
