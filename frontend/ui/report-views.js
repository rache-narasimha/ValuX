import { createTextVNode, h } from "vue";
import { paint, text, viewElement } from "./dom.js";

function optionsView(options) {
  return options.map(({ value, label }) => h("option", { key: value, value }, label));
}

export function reportField({ id, label, type, required, value, options }) {
  const props = { id, name: id, required };
  let input;
  if (type === "select") {
    input = h("select", { ...props, value }, optionsView(options));
  } else if (type === "textarea") {
    input = h("textarea", { ...props, value });
  } else if (type === "boolean") {
    input = h("input", { ...props, type: "checkbox", checked: value });
  } else {
    input = h("input", {
      ...props, value, type: type === "date" ? "date" : "text",
      inputmode: ["currency", "currency_rate", "number"].includes(type) ? "decimal" : undefined,
    });
  }
  return viewElement(h("div", {
    class: ["field", { full: type === "textarea", check: type === "boolean" }], "data-field": id,
  }, [h("label", { for: id, class: required ? "required" : undefined }, label), input]));
}

export function valuationPanel(label, attributes) {
  return viewElement(h("div", { class: "panel", ...attributes }, [h("h2", label)]));
}

export function valuationGroup(label, fillable = false, labelledHeading = false) {
  const heading = h("h3", label);
  return viewElement(h("section", { class: "subgroup" }, [
    labelledHeading ? h("div", { class: "subgroup-heading" }, [
      heading,
      fillable ? h("button", { type: "button", class: "secondary fill-included" }, "Fill blank items as Included") : null,
    ]) : heading,
    h("div", { class: "grid" }),
  ]));
}

export function valuationDocumentCard(index, last) {
  const add = {
    type: "button", class: "document-icon-button add-document", "data-add-document": "",
    title: "Add another document", "aria-label": "Add another document",
  };
  const remove = {
    type: "button", class: "document-icon-button remove-document", "data-remove-document": index,
    title: `Remove document ${index}`, "aria-label": `Remove document ${index}`,
  };
  const icons = window.AppShell?.icons;
  // The shell owns these static SVG assets.
  return viewElement(h("div", { class: "document-card" }, [
    h("div", { class: "document-head" }, [
      h("h4", `Document ${index}`),
      h("div", { class: "document-actions" }, [
        last ? h("button", { ...add, innerHTML: icons?.add || "+" }) : null,
        index > 1 ? h("button", { ...remove, innerHTML: icons?.trash || "×" }) : null,
      ]),
    ]),
    h("div", { class: "grid" }),
  ]));
}

export function valuationFloorCard(index, label) {
  return viewElement(h("div", { class: "floor-card" }, [
    h("div", { class: "floor-head" }, [
      h("h4", label),
      index > 1 ? h("button", { type: "button", class: "remove-floor", "data-remove-floor": index }, "Remove") : null,
    ]),
    h("div", { class: "grid" }),
  ]));
}

export function paintReportNav(host, entries, { active, onSelect } = {}) {
  paint(host, entries.map(({ label, key, locked }, index) => h("button", {
    key: key ?? label, type: "button", "data-section-index": index, "data-section-key": key,
    class: { "nav-locked": locked, active: index === active },
    onClick: onSelect ? () => onSelect(index) : undefined,
  }, [
    label,
    locked ? h("span", { class: "nav-lock", "aria-label": "Requires earlier sections" }, "!") : null,
  ])));
}

export function reportPreparationPanel({ reportLabel, options, name, selected }) {
  return viewElement(h("div", { class: "panel preparation-method-panel", "data-group": "preparation" }, [
    h("h2", "Preparation Method"),
    h("p", { class: "section-intro" },
      `Choose how this ${reportLabel} report will be prepared. The remaining steps will adapt to this selection.`),
    h("div", { class: "preparation-choice-grid", role: "radiogroup", "aria-label": "Report preparation method" },
      options.map(({ value, label, help }) => h("label", { class: "preparation-choice-card" }, [
        h("input", { type: "radio", name, value, checked: value === selected, "data-preparation-method": "" }),
        h("span", [h("strong", label), h("small", help)]),
      ]))),
    h("p", { class: "preparation-selection-status", "data-preparation-status": "", "aria-live": "polite" },
      selected ? "Preparation method selected." : "Select a preparation method to continue."),
  ]));
}

export function paintReportPhotos(host, photos, onRemove, { progress = false } = {}) {
  if (!host) return;
  if (!progress) {
    host.classList.remove("one-column");
    host.classList.add("three-columns");
  }
  paint(host, photos.map((photo, index) => {
    const alt = progress ? `Site photograph ${index + 1}` : photo.name || `Property photograph ${index + 1}`;
    const remove = progress ? `photograph ${index + 1}` : photo.name || `photograph ${index + 1}`;
    return h(progress ? "figure" : "div", { class: progress ? undefined : "photo-tile" }, [
      h("img", { src: photo.data, alt }),
      h("button", {
        type: "button", "data-remove-photo": index, "aria-label": `Remove ${remove}`,
        onClick: () => onRemove(index),
      }, progress ? "×" : "Remove"),
    ]);
  }));
}

export function paintReportMap(host, map, alt, onRemove, { progress = false } = {}) {
  if (!host) return;
  const children = map ? [
    h("img", { src: map.data, alt }),
    h("button", {
      type: "button", class: progress ? "secondary" : "secondary remove-map",
      "data-remove-map": progress ? "" : undefined, onClick: onRemove,
    }, "Remove map"),
  ] : null;
  paint(host, !progress && children ? h("div", { class: "media-preview-item" }, children) : children);
}

export function paintProgressComponents(host, components) {
  // These rows are rebuilt on explicit controller refreshes. Recreate the
  // native fields so NumericEntry starts with the committed draft values.
  paint(host, null);
  paint(host, components.length ? components.map(({ label, percent, inherited, estimate, completed, manual, balance }, index) => h("tr", [
    h("td", text(index + 1)), h("td", label), h("td", text(estimate.toFixed(2))),
    h("td", [h("input", {
      type: "number", min: 0, max: 100, step: "any", value: percent,
      "data-progress-percent": index, "data-tab-autofilled": inherited ? "" : undefined,
      "aria-label": `Completion percentage for ${label}`,
    })]),
    h("td", [h("input", {
      type: "number", min: 0, max: estimate, step: "any", value: completed,
      "data-progress-completed": index, "data-tab-autofilled": manual ? undefined : "",
      "aria-label": `Completed cost for ${label}`,
    })]),
    h("td", { "data-progress-balance": "" }, balance.toFixed(2)),
    h("td", [h("button", {
      type: "button", class: "reset-calculation", "data-reset-completed": index, hidden: !manual,
    }, "Use calculated")]),
  ])) : h("tr", [h("td", { colspan: 7 }, "No linked estimation components are available.")]));
}

export function paintBankReleases(host, releases) {
  paint(host, null);
  paint(host, releases.length ? releases.map((release, index) => h("div", { class: "release-row" }, [
    bankReleaseField("date", "Release date", index, release.date || "", { type: "date" }),
    bankReleaseField("amount", "Amount (Rs.)", index, release.amount ?? "", { type: "number", min: 0, step: "any" }),
    h("button", { type: "button", class: "secondary", "data-remove-release": index }, "Remove"),
  ])) : h("p", { class: "hint" }, "No previous loan releases entered."));
}

function bankReleaseField(key, label, index, value, attributes) {
  const id = `release-${key}-${index}`;
  return h("div", { class: "field" }, [
    h("label", { for: id }, label), h("input", { id, value, [`data-release-${key}`]: index, ...attributes }),
  ]);
}

export function paintBankCalculations(host, cards) {
  paint(host, cards.map(([label, value]) => h("article", { key: label }, [h("span", label), h("strong", value)])));
}

export function paintReportIssues(host, issues, heading) {
  paint(host, issues.length ? [
    h("strong", heading),
    h("ul", issues.map(issue => h("li", issue))),
  ] : null);
}

export function paintReportOptions(host, options, value) {
  paint(host, optionsView(options));
  host.value = value;
}

export function paintEstimateCorrection(host, { pending, notes, removed, reviewed, onReview }) {
  paint(host, pending ? createTextVNode("The linked estimation is being revised. Finalize it first, then reload this report to review updated component totals.") : [
    h("strong", "Review the revised estimation"),
    h("p", "Completion percentages were retained. Completed amounts now use the revised estimates. Review manual amounts and changed components."),
    notes.length ? h("p", notes.join("; ")) : null,
    removed.length ? h("p", `Removed components: ${removed.join(", ")}`) : null,
    h("label", [
      h("input", { type: "checkbox", id: "estimation-revision-reviewed", checked: reviewed, onChange: onReview }),
      " I reviewed the revised component totals and completion amounts.",
    ]),
  ]);
}
