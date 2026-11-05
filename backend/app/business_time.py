"""Tenant calendar helpers while ValuX keeps durable timestamps in UTC."""

from __future__ import annotations

import os
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


TENANT_TIME_ZONE_NAME = os.environ.get("TENANT_TIME_ZONE", "Asia/Kolkata").strip() or "UTC"
try:
    TENANT_TIME_ZONE = ZoneInfo(TENANT_TIME_ZONE_NAME)
except ZoneInfoNotFoundError as error:
    raise RuntimeError(f"TENANT_TIME_ZONE is not a valid IANA time zone: {TENANT_TIME_ZONE_NAME}") from error


def tenant_now(value: datetime | None = None) -> datetime:
    """Return an instant in the tenant's configured display/calendar zone."""
    current = value or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    return current.astimezone(TENANT_TIME_ZONE)


def tenant_today(value: datetime | None = None) -> date:
    """Return the tenant calendar date for an instant."""
    return tenant_now(value).date()


def tenant_date(value: date | datetime) -> date:
    """Preserve date-only values and localize timestamp values to the tenant."""
    if isinstance(value, datetime):
        return tenant_now(value).date()
    return value
