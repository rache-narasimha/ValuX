/** Persists and applies the light/dark appearance preference before page rendering. */
(function () {
  "use strict";

  const STORAGE_KEY = "sln.appearance.v1";

  function current() {
    return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
  }

  function apply(mode) {
    const next = mode === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    document.querySelectorAll("[data-appearance-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", String(next === "dark"));
      button.setAttribute("aria-label", `Switch to ${next === "dark" ? "light" : "dark"} mode`);
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
