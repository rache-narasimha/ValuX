/** Persists and applies the light/dark appearance preference before page rendering. */
(function () {
  "use strict";

  const STORAGE_KEY = "sln.appearance.v1";

  const icons = {
    light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>',
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.9 13.3A9 9 0 0 1 10.7 3.1 9 9 0 1 0 20.9 13.3Z"/></svg>',
  };

  function current() {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  }

  function apply(mode) {
    const next = mode === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    document.querySelectorAll("[data-appearance-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", String(next === "dark"));
      const target = next === "dark" ? "light" : "dark";
      const label = `Switch to ${target} mode`;
      button.setAttribute("aria-label", label);
      if (button.hasAttribute("data-appearance-icon-only")) {
        button.title = label;
        button.innerHTML = icons[target];
        return;
      }
      button.innerHTML = `<span aria-hidden="true">${next === "dark" ? "☀" : "◐"}</span><span>${next === "dark" ? "Light" : "Dark"}</span>`;
    });
  }

  function toggle() {
    const next = current() === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
  }

  function install() {
    apply(current());
    document.querySelectorAll("[data-appearance-toggle]").forEach((button) => {
      if (button.dataset.appearanceWired) return;
      button.dataset.appearanceWired = "1";
      button.addEventListener("click", toggle);
    });
  }

  apply(current());
  window.Appearance = { current, apply, toggle, install };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
