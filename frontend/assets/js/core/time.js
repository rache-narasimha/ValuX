/** Tenant calendar utilities. Durable ValuX timestamps remain UTC. */
(function () {
  "use strict";

  const timeZone = window.__VALUX_BUSINESS_CONTEXT__?.timeZone || "UTC";
  const ymdPattern = /^\d{4}-\d{2}-\d{2}$/;

  function padded(value) { return String(value).padStart(2, "0"); }

  function zonedParts(value = new Date()) {
    const source = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(source.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(source);
    const result = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return { year: Number(result.year), month: Number(result.month), day: Number(result.day) };
  }

  function dateString(value = new Date()) {
    if (typeof value === "string" && ymdPattern.test(value)) return value;
    const parts = zonedParts(value);
    return parts ? `${parts.year}-${padded(parts.month)}-${padded(parts.day)}` : "";
  }

  function parseDate(value) {
    if (value instanceof Date) return new Date(value.getTime());
    const text = dateString(value);
    if (!text) return null;
    const [year, month, day] = text.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function isoDate(value) {
    const source = parseDate(value);
    if (!source) return "";
    return `${source.getUTCFullYear()}-${padded(source.getUTCMonth() + 1)}-${padded(source.getUTCDate())}`;
  }

  function addDays(value, amount) {
    const source = parseDate(value);
    if (!source) return "";
    source.setUTCDate(source.getUTCDate() + Number(amount || 0));
    return isoDate(source);
  }

  function today() { return dateString(new Date()); }
  function todayDate() { return parseDate(today()); }

  function formatDate(value) {
    if (!value) return "—";
    const dateOnly = typeof value === "string" && ymdPattern.test(value);
    const source = dateOnly ? parseDate(value) : new Date(value);
    if (!source || Number.isNaN(source.getTime())) return "—";
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit", month: "short", year: "numeric", timeZone: dateOnly ? "UTC" : timeZone,
    }).format(source);
  }

  window.ValuxTime = { timeZone, today, todayDate, dateString, parseDate, isoDate, addDays, formatDate };
})();
