/** Shared escaping, formatting, and status styling helpers. */
(function () {
  "use strict";

  function escape(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  }

  function date(value) {
    return ValuxTime.formatDate(value);
  }

  function currency(value) {
    if (value === null || value === undefined || value === "") return "N/A";
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  function statusClass(status) {
    return `status-${String(status || "").toLowerCase().replaceAll(" ", "-")}`;
  }

  function paymentClass(status) {
    return `payment-${String(status || "pending").toLowerCase().replaceAll(" ", "-")}`;
  }

  function chartColor(indexOrInstitution) {
    if (typeof indexOrInstitution === "object" && indexOrInstitution?.color) return indexOrInstitution.color;
    return "#087ea4";
  }

  function fatal(message) {
    const alert = document.createElement("div");
    alert.className = "global-error";
    alert.setAttribute("role", "alert");
    alert.innerHTML = `<strong>Local data could not be loaded</strong><p>${escape(message)}</p>`;
    const target = document.querySelector("main") || document.body;
    target.prepend(alert);
  }

  window.WorkflowUI = { escape, date, currency, statusClass, paymentClass, chartColor, fatal };
})();
