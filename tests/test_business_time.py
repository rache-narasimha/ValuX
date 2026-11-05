"""Tenant calendar regression checks independent of the host time zone."""

from datetime import UTC, date, datetime

from backend.app.business_time import TENANT_TIME_ZONE_NAME, tenant_date, tenant_today


assert TENANT_TIME_ZONE_NAME == "Asia/Kolkata"
assert tenant_today(datetime(2026, 10, 30, 18, 29, tzinfo=UTC)) == date(2026, 10, 30)
assert tenant_today(datetime(2026, 10, 30, 18, 31, tzinfo=UTC)) == date(2026, 10, 31)
assert tenant_date(datetime(2026, 10, 30, 18, 31, tzinfo=UTC)) == date(2026, 10, 31)
assert tenant_date(date(2026, 10, 30)) == date(2026, 10, 30)

print("PASS: UTC instants use the configured tenant calendar without converting date-only values")
