/** Retained reports are navigable, with report inputs and write actions locked. */
(function () {
  "use strict";
  if (!window.ReportData?.readOnly) return;
  document.body.classList.add("report-readonly");
  const navigation = new Set(["previous", "next"]);
  function protect() {
    const form = document.querySelector("main form");
    if (!form) return;
    form.querySelectorAll("input, textarea, select, button").forEach((control) => {
      if (navigation.has(control.id)) return;
      if (control.matches('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="file"])')) {
        if (!control.readOnly) control.readOnly = true;
      } else if (!control.disabled) control.disabled = true;
    });
    form.querySelectorAll(".offline-template-download, [data-template-download]").forEach((link) => { link.hidden = true; });
    const status = document.getElementById("status");
    if (status && status.textContent !== "Read-only") status.textContent = "Read-only";
    status?.classList.remove("is-saving");
  }
  document.addEventListener("click", (event) => {
    const button = event.target.closest("main form button");
    if (button && !navigation.has(button.id)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  for (const type of ["input", "change", "dblclick", "submit"]) document.addEventListener(type, (event) => {
    if (event.target.closest("main form")) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  new MutationObserver(protect).observe(document.querySelector("main"), {childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "readonly"]});
  protect();
})();
