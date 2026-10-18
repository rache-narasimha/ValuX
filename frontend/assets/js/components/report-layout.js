/** Persists collapse/expand state for long report-form navigation. */
(function () {
  "use strict";

  const STORAGE_KEY = "sln.report-navigation-collapsed.v1";

  function install() {
    const aside = document.querySelector("body:not(.workflow-page) main > aside");
    if (!aside) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "report-nav-toggle";
    button.setAttribute("aria-label", "Collapse report sections");
    button.innerHTML = "‹<span>Sections</span>";
    aside.prepend(button);

    const apply = (collapsed) => {
      document.body.classList.toggle("report-nav-collapsed", collapsed);
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} report sections`);
    };
    apply(localStorage.getItem(STORAGE_KEY) === "true");
    button.addEventListener("click", () => {
      const collapsed = !document.body.classList.contains("report-nav-collapsed");
      localStorage.setItem(STORAGE_KEY, String(collapsed));
      apply(collapsed);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
