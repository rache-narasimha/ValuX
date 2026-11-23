"""Settings for the optional, server-side WhatsApp integration."""

import os
import re
from urllib.parse import urlsplit

from ..auth.config import APP_BASE_URL

MODE = os.getenv("WHATSAPP_MODE", "disabled").lower()
REQUIRE_VERIFICATION = os.getenv("WHATSAPP_REQUIRE_VERIFICATION", "false").lower() == "true"
GRAPH_VERSION = os.getenv("WHATSAPP_GRAPH_VERSION", "")
SENDER_ID = os.getenv("WHATSAPP_SENDER_ID", "")
ACCESS_TOKEN = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
APP_SECRET = os.getenv("WHATSAPP_APP_SECRET", "")
VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "")
OTP_TEMPLATE = os.getenv("WHATSAPP_OTP_TEMPLATE", "")
ASSIGNMENT_TEMPLATE = os.getenv("WHATSAPP_ASSIGNMENT_TEMPLATE", "")
LANGUAGE = os.getenv("WHATSAPP_TEMPLATE_LANGUAGE", "en")
CONSENT_VERSION = "assignment-alerts-v1"


def enabled() -> bool:
    return MODE in {"mock", "live"}


def validate(*, worker=False) -> None:
    if MODE not in {"disabled", "mock", "live"}:
        raise RuntimeError("Unsupported WHATSAPP_MODE")
    if REQUIRE_VERIFICATION and not enabled():
        raise RuntimeError("WhatsApp verification requires an enabled provider")
    base = urlsplit(APP_BASE_URL)
    if MODE == "mock" and (
        os.getenv("K_SERVICE") or base.hostname not in {"localhost", "127.0.0.1", "::1"}
    ):
        raise RuntimeError("Mock WhatsApp delivery is local only")
    if MODE != "live":
        return
    if (
        base.scheme != "https" or not base.hostname or base.username or base.path not in {"", "/"}
        or base.query or base.fragment
        or not re.fullmatch(r"v[0-9]+\.[0-9]+", GRAPH_VERSION)
        or not re.fullmatch(r"[0-9]{4,32}", SENDER_ID)
        or not ACCESS_TOKEN or not re.fullmatch(r"[a-z0-9_]{1,128}", ASSIGNMENT_TEMPLATE)
        or not re.fullmatch(r"[a-z]{2}(?:_[A-Z]{2})?", LANGUAGE)
    ):
        raise RuntimeError("Live WhatsApp requires an HTTPS app URL, sender, credentials and templates")
    if not worker and (
        len(APP_SECRET) < 16 or len(VERIFY_TOKEN) < 32 or not re.fullmatch(r"[a-z0-9_]{1,128}", OTP_TEMPLATE)
    ):
        raise RuntimeError("The web service requires the WhatsApp webhook secrets and OTP template")
