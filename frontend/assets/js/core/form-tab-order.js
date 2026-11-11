/** Keep locked and system-filled fields out of sequential keyboard navigation. */
(function () {
  "use strict";

  const skippedFields = "input[readonly], textarea[readonly], [data-tab-autofilled]";
  const savedTabIndex = new WeakMap();

  function updateField(field) {
    if (field.matches(skippedFields)) {
      if (!savedTabIndex.has(field)) savedTabIndex.set(field, field.getAttribute("tabindex"));
      field.tabIndex = -1;
    } else if (savedTabIndex.has(field)) {
      const previous = savedTabIndex.get(field);
      if (previous === null) field.removeAttribute("tabindex");
      else field.setAttribute("tabindex", previous);
      savedTabIndex.delete(field);
    }
  }

  function scan(root) {
    if (root.matches(skippedFields) || savedTabIndex.has(root)) updateField(root);
    root.querySelectorAll(`${skippedFields}, [tabindex="-1"]`).forEach(updateField);
  }

  function mark(field, autofilled = true) {
    if (!field) return;
    field.toggleAttribute("data-tab-autofilled", autofilled && field.value !== "");
    updateField(field);
  }

  function markEdited(event) {
    if (event.isTrusted && event.target.hasAttribute?.("data-tab-autofilled")) mark(event.target, false);
  }

  document.addEventListener("input", markEdited, true);
  document.addEventListener("change", markEdited, true);
  window.FormTabOrder = { mark };

  const root = document.documentElement;
  scan(root);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") updateField(record.target);
      else for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }
  }).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["readonly", "data-tab-autofilled"] });
})();
