/** Authenticated XLSX download helper for approved business table views. */
(function () {
  "use strict";

  function fileNameFrom(response, fallback) {
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    return match?.[1] || fallback || "ValuX_Export.xlsx";
  }

  function userMessage(error, fallback) {
    const message = error instanceof Error ? error.message.trim() : "";
    return message && !/^(failed to fetch|networkerror|load failed)$/i.test(message) ? message : fallback;
  }

  async function download(options) {
    if (!options?.columns?.length) throw new Error("The export columns are missing.");
    const response = await fetch("/api/exports/workbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
    if (!response.ok) {
      let message = "The Excel export could not be created.";
      try { message = (await response.json()).error || message; } catch (_error) { /* keep fallback */ }
      throw new Error(message);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileNameFrom(response, options.fileName);
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function fromButton(button, options) {
    if (!button) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("title", "Preparing Excel…");
    try {
      await download(options);
    } catch (error) {
      window.alert(userMessage(error, "The Excel export could not be created. Check your connection and try again."));
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.setAttribute("title", "Export to Excel");
    }
  }

  window.WorkbookExport = { download, fromButton, userMessage };
})();
