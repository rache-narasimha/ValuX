/** Commit basic arithmetic through the existing numeric input handlers. */
(function (global) {
  "use strict";

  const edits = new WeakMap();
  const decimal = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i;
  const formatted = /^(?:₹\s*|Rs\.?\s*)?[+-]?(?:\d[\d,]*(?:\.\d*)?|\.\d+)(?:\s*\/-)?$/i;
  const allowed = /^(?:[\d.eE+\-*/×÷−()\s])+$/;
  const errorSelector = "input[data-arithmetic-error]:not(:disabled):not([readonly])";

  function literal(input, edit) {
    const value = input.value;
    return !value || decimal.test(value) || (!edit.number && formatted.test(value.trim()))
      || (input.hasAttribute("data-arithmetic-optional") && (!/\d/.test(value) || !allowed.test(value)));
  }

  function read(input) {
    const edit = edits.get(input);
    return edit?.pending ? edit.value : input.value;
  }

  function pending(input) { return Boolean(edits.get(input)?.pending); }

  function clearError(input) {
    if (!input.hasAttribute("data-arithmetic-error")) return;
    input.removeAttribute("data-arithmetic-error");
    input.removeAttribute("aria-invalid");
    input.removeAttribute("aria-description");
    input.setCustomValidity("");
  }

  function finish(input, edit) {
    if (!edit.pending) {
      if (edit.number) input.type = "number";
      edits.delete(input);
      return "plain";
    }

    let value;
    try {
      if (!allowed.test(input.value) || /[\d.eE]\s+[\d.eE]/.test(input.value)) throw new Error("Use numbers, +, −, ×, ÷, or parentheses.");
      value = String(global.ReportCalculator.evaluate(input.value));
      if (edit.number) {
        const numeric = input.cloneNode();
        numeric.type = "number";
        numeric.value = value;
        if (!numeric.validity.valid) throw new Error(numeric.validationMessage);
      }
    } catch (error) {
      input.setCustomValidity(error.message);
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-description", error.message);
      input.dataset.arithmeticError = error.message;
      return "invalid";
    }

    clearError(input);
    if (edit.number) input.type = "number";
    input.value = value;
    edits.delete(input);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return "calculated";
  }

  document.addEventListener("focus", ({ target: input }) => {
    if (!input.matches?.('input[type="number"], input[inputmode="decimal"], input[data-arithmetic-optional]') || input.disabled || input.readOnly || edits.has(input)) return;
    const number = input.type === "number";
    edits.set(input, { number, value: input.value, pending: false });
    // Native number inputs strip operators. Restore the number type after editing
    // so existing handlers and native constraints still see the committed result.
    if (number) {
      input.type = "text";
      input.select();
    }
  }, true);

  document.addEventListener("input", (event) => {
    const input = event.target;
    const edit = edits.get(input);
    if (!edit) return;
    if (literal(input, edit)) {
      clearError(input);
      edit.pending = false;
      edit.value = input.value;
      return;
    }
    edit.pending = true;
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("change", (event) => {
    const edit = edits.get(event.target);
    if (edit?.pending && finish(event.target, edit) === "invalid") event.stopImmediatePropagation();
  }, true);

  document.addEventListener("blur", ({ target: input }) => {
    const edit = edits.get(input);
    if (edit && finish(input, edit) === "calculated") {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && pending(event.target)) {
      event.preventDefault();
      event.target.blur();
    }
  }, true);

  document.addEventListener("wheel", ({ target: input }) => {
    if (input === document.activeElement && edits.get(input)?.number && !pending(input)) input.blur();
  }, { capture: true, passive: true });

  function error(scope) {
    const input = [...(scope?.querySelectorAll(errorSelector) || [])].find((field) => !field.closest("[hidden]"));
    if (!input) return "";
    const label = input.getAttribute("aria-label") || input.labels?.[0]?.textContent.trim();
    return label ? `${label}: ${input.dataset.arithmeticError}` : input.dataset.arithmeticError;
  }

  function reset(input) {
    const edit = edits.get(input);
    clearError(input);
    if (edit?.number) input.type = "number";
    edits.delete(input);
  }

  global.NumericEntry = { read, pending, error, reset };
})(window);
