import { h } from "vue";
import { paint, text, viewElement } from "./dom.js";

function estimatePanel(key, label, children) {
  return h("div", { class: "panel", "data-key": key }, [h("h2", label), ...children]);
}

function inputField({ id, label, value, type = "text", detail, help, autofilled }) {
  const attributes = {
    id, value, "data-detail": detail, required: true, "data-tab-autofilled": autofilled && value ? "" : undefined,
  };
  return h("div", { class: ["field", { full: type === "textarea" }] }, [
    h("label", { for: id, class: "required" }, label),
    type === "textarea" ? h("textarea", attributes) : h("input", { ...attributes, type }),
    help ? h("small", { class: "field-help" }, help) : null,
    h("small", { class: "field-error", id: `${id}-error`, hidden: true }),
  ]);
}

export function estimationSetupPanel(fields) {
  return viewElement(estimatePanel("setup", "Report Setup", [
    h("section", { class: "subgroup" }, [h("h3", "Report details"), h("div", { class: "grid" }, fields.map(inputField))]),
    h("section", { class: "notice" }, [
      h("strong", "Next:"),
      " choose Preparation Method. Online entry and an optional workbook template use Property Configuration and Component Selection; retrospective uploads need only the report and reviewed component totals.",
    ]),
  ]));
}

function choices(name, rows, selected, className) {
  return h("div", { class: ["setup-choice-grid", className] }, rows.map(({ value, label, help, disabled }) => h("label", {
    class: ["choice-card", { "is-disabled": disabled }],
  }, [
    h("input", { type: "radio", name, value, disabled, checked: selected === value }),
    h("span", [h("strong", label), h("small", help)]),
  ])));
}

export function estimationPreparationPanel(rows, selected) {
  return viewElement(estimatePanel("preparation", "Preparation Method", [
    h("section", { class: "subgroup report-mode-panel" }, [
      h("h3", "Choose preparation method"),
      h("p", { class: "hint" }, "Choose how the report will be prepared. Your entered component data is retained when changing methods."),
      choices("work-mode", rows, selected),
    ]),
  ]));
}

export function estimationConfigurationPanel(model) {
  const { types, propertyType, constructionChoices, construction, profile, subtype, methods, measurementMethod } = model;
  return viewElement(estimatePanel("configuration", "Property Configuration", [
    h("section", { class: "subgroup" }, [h("h3", "Property type"), choices("property-type", types, propertyType)]),
    profile ? h("section", { class: "subgroup construction-section" }, [
      h("h3", "Construction configuration"),
      choices("construction", constructionChoices, construction, "construction-choice-grid"),
      propertyType === "residential" ? h("p", { class: "residential-construction-note" },
        "Residential templates currently use the approved RCC format only. Shed roof and Hybrid are unavailable for this property type.") : null,
    ]) : null,
    profile ? h("section", { class: "subgroup" }, [
      h("h3", "Property subtype"),
      h("div", { class: "field" }, [
        h("label", { class: "required", for: "property-subtype" }, "Subtype"),
        h("select", { id: "property-subtype", value: subtype, required: true }, [
          h("option", { value: "" }, "Select subtype"),
          ...profile.subtypes.map(({ value, label }) => h("option", { value }, label)),
        ]),
      ]),
    ]) : null,
    methods.length ? h("section", { class: "subgroup" }, [
      h("h3", "Measurement method for RCC components"),
      h("p", { class: "hint" }, "This changes only detailed measurement rows. Main estimate items and final report sections remain the same."),
      choices("measurement-method", methods, measurementMethod, "measurement-method-grid"),
    ]) : null,
    h("div", { class: "configuration-summary" }, [
      h("p", profile && construction && subtype ? [
        h("strong", "Selected:"),
        ` ${profile.label} · ${construction.toUpperCase()} · ${profile.subtypes.find(type => type.value === subtype)?.label || ""}`,
      ] : "Select property type, construction configuration, and subtype before adding components."),
    ]),
  ]));
}

export function estimationLockedPanel(key, label, { message, target, targetLabel }) {
  return viewElement(h("div", { class: "panel locked-panel", "data-key": key }, [
    h("div", { class: "locked-panel-icon", "aria-hidden": "true" }, "!"),
    h("h2", label),
    h("div", { class: "locked-panel-card" }, [
      h("strong", "Complete previous sections first"), h("p", message),
      h("button", {
        type: "button", class: "primary", "data-action": "go-to-section", "data-section-key": target,
      }, targetLabel),
    ]),
  ]));
}

export function paintDimensionReview(host, rows, message) {
  const headings = ["Item", "Count", "Length (m)", "Width (m)", "Depth / Height (m)", "Source"];
  paint(host, message ? h("p", { class: "hint" }, message) : h("table", { class: "worksheet-table dimension-review-table" }, [
    h("thead", [h("tr", headings.map(label => h("th", label)))]),
    h("tbody", rows.map(([label, ...cells]) => h("tr", [h("th", { scope: "row" }, label), ...cells.map(value => h("td", text(value)))]))),
  ]));
}

function statsView(pairs) {
  return h("div", { class: "review-grid" }, pairs.map(([label, value]) =>
    h("div", { class: "review-stat" }, [h("small", label), h("strong", text(value))])));
}

export function paintEstimatePreview(host, { issues, description, stats, worksheets }) {
  paint(host, [
    h("div", { class: "notice" }, issues.length ? [
      h("strong", `${issues.length} item${issues.length === 1 ? "" : "s"} need attention`),
      h("ul", issues.map(issue => h("li", issue))),
    ] : [h("strong", description)]),
    statsView(stats),
    worksheets.length ? h("p", [h("strong", "Workbook order:"), ` ${worksheets.join(" → ")}`]) : null,
    worksheets.length ? h("div", { id: "estimation-server-totals" }) : null,
    h("div", { id: "workbook-preview", class: "workbook-preview" }),
  ]);
  const totals = host.querySelector("#estimation-server-totals");
  if (totals) paint(totals, null);
  paintWorkbookFrame(host.querySelector("#workbook-preview"), {
    message: issues.length ? "Resolve the listed items to render the workbook preview." : "Rendering the workbook…",
  });
}

export function paintWorkbookFrame(host, { url, error, message }) {
  paint(host, url
    ? h("iframe", { class: "workbook-preview-frame", src: url, title: "Rendered estimation workbook preview" })
    : error
      ? h("div", { class: "notice" }, [h("strong", "Workbook preview could not be rendered."), h("br"), error])
      : h("p", { class: "hint" }, message));
}

export function paintServerTotals(host, components, total, corrected) {
  paint(host, [
    corrected ? h("p", { class: "notice" },
      "The server calculation differs from the form. Review the corrected amounts below before generating Excel.") : null,
    h("table", { class: "review-table" }, [
      h("thead", [h("tr", [h("th", "Component or work"), h("th", "Server amount (Rs.)")])]),
      h("tbody", components.map(({ label, amount }) => h("tr", [h("td", label), h("td", amount)]))),
      h("tfoot", [h("tr", [h("th", "Total estimated project cost"), h("th", total)])]),
    ]),
  ]);
}

const measurementColumns = [
  ["S.No."], ["Description of Item"], ["No."], ["L (m)"], ["B (m)"], ["D (m)"],
  ["Qty", "(cum/sqm)"], ["Unit Rate", "(Rs.)"],
];

function worksheetButton(label, className, attributes) {
  return h("button", { type: "button", class: className, ...attributes }, label);
}

function worksheetNumber(attributes) {
  return h("input", { type: "number", step: "any", inputmode: "decimal", ...attributes });
}

function measurementInfo({ id, label, message }) {
  return h("span", { class: "calculation-info" }, [
    worksheetButton("i", "info-button", {
      "aria-label": `How ${label} is calculated`, "aria-describedby": id,
      "aria-pressed": "false", "data-action": "toggle-calculation-info",
    }),
    h("span", { class: "calculation-info-popover", id, role: "tooltip" }, message),
  ]);
}

function measurementRow(row) {
  const label = row.labelInput ? h("input", { class: "custom-row-label", ...row.labelInput })
    : row.usesItemLabel ? h("span", { "data-custom-item-display": "" }, row.label) : row.label;
  if (row.heading) return h("tr", { class: "worksheet-heading-row" }, [
    h("td"), h("td", { colspan: 8 }, [label]), h("td"),
  ]);
  const quantity = row.quantity ? worksheetNumber(row.quantity) : null;
  const amount = row.showAmount ? h("span", { class: "calculated-value", ...row.amountDisplay }, row.amountLabel) : null;
  return h("tr", {
    class: ["worksheet-row", { "worksheet-subtotal-row": row.subtotal, "worksheet-custom-row": row.custom }],
  }, [
    h("td"), h("td", { class: "description-cell" }, [label]),
    ...row.dimensions.map(field => h("td", field ? [worksheetNumber(field)] : [])),
    h("td", [row.info ? h("span", { class: "derived-quantity-wrap" }, [quantity, measurementInfo(row.info)]) : quantity]),
    h("td", [row.rate ? worksheetNumber(row.rate) : row.rateLabel]),
    h("td", [row.amount ? worksheetNumber(row.amount) : null, amount]),
    h("td", { class: "custom-row-action" }, [
      row.action ? worksheetButton(row.action.label, "row-icon-button", row.action.attributes) : null,
    ]),
  ]);
}

function finalAmount({ value, calculated, input, reset, display, label }) {
  return h("label", { class: "final-amount-control" }, [
    h("span", label), worksheetNumber({ ...input, value, "data-tab-autofilled": reset ? undefined : "" }),
    h("small", ["Calculated: ₹ ", h("span", display, calculated)]),
    reset ? worksheetButton("Use calculated", "text-button", reset) : null,
  ]);
}

function worksheetHeading([label, unit]) {
  return h("th", unit ? [label, h("br"), unit] : label);
}

function worksheetItem(item, grouped, identity) {
  const label = item.custom ? h("span", { "data-custom-item-display": "" }, item.label) : item.label;
  const customAttributes = { ...identity, "data-item": item.key };
  return h("section", { class: "worksheet-item" }, [
    h("div", { class: "worksheet-item-title" }, [
      h("span", [item.serial, label]),
      h("div", { class: "item-title-actions" }, [
        item.final ? finalAmount(item.final) : null,
        ...item.actions.map(({ label: caption, className, attributes }) => worksheetButton(caption, className, attributes)),
      ]),
    ]),
    item.custom ? h("div", { class: "custom-item-details" }, [
      h("div", { class: "field" }, [
        h("label", "Short description (form)"), h("input", { value: item.label, "data-custom-item-short": "1", ...customAttributes }),
      ]),
      h("div", { class: "field full" }, [
        h("label", "Detailed description (generated report)"),
        h("textarea", {
          value: item.description, "data-custom-item-detail": "1", ...customAttributes,
          placeholder: "Enter the full technical description for the report",
        }),
      ]),
    ]) : null,
    h("div", { class: "worksheet-table-wrap" }, [
      h("table", { class: "worksheet-table" }, [
        h("thead", [h("tr", [
          ...measurementColumns.map(worksheetHeading), worksheetHeading([grouped ? "Group amount" : "Amount", "(Rs.)"]),
          h("th", { "aria-label": "Custom row" }),
        ])]),
        h("tbody", item.rows.map(measurementRow)),
      ]),
    ]),
  ]);
}

export function estimationWorksheet(model) {
  const { key, label, template, identity, multiplier, rounded, total, final, plinthArea, removed, items } = model;
  const plinthId = `plinth-${key}`;
  return viewElement(estimatePanel(key, label, [
    h("p", { class: "hint" },
      "Qty calculates from the dimensions. Edit Qty to enter or adjust it directly, or clear it to restore the calculation. For grouped measurements within an item, use its total quantity row to price the entire item."
      + (multiplier > 1 ? ` Enter quantities, rates and lump sums for one floor. Line amounts shown include all ${multiplier} floors.` : "")),
    h("div", { class: "worksheet-summary" }, [
      worksheetButton("Edit dimensions & defaults", "text-button", { "data-action": "edit-dimensions", "data-section-key": key }),
      h("span", ["Approved template: ", h("strong", template)]),
      h("span", [
        `Report amount${rounded ? " (rounded to ₹1,000)" : ""}: `,
        h("strong", { "data-sheet-adopted": "", ...identity }, total),
      ]),
      finalAmount(final),
    ]),
    h("div", { class: "field worksheet-plinth-area" }, [
      h("label", { for: plinthId }, "Plinth Area (sft.)"),
      h("input", { type: "text", id: plinthId, value: plinthArea, "data-plinth-area": "", ...identity }),
      h("small", { class: "hint" }, "Enter the area for all floors represented on this sheet. Optional. Text or notes may be included."),
    ]),
    removed.length ? h("details", { class: "dimension-group" }, [
      h("summary", `Removed items (${removed.length})`),
      h("ul", removed.map(({ key: itemKey, label: itemLabel }) => h("li", [
        `${itemLabel} `, worksheetButton("Restore", "text-button", {
          "data-action": "restore-standard-item", ...identity, "data-item": itemKey,
        }),
      ]))),
    ]) : null,
    h("div", { class: "worksheet-item-list" }, items.map(item => worksheetItem(item, multiplier > 1, identity))),
  ]));
}

export function unsupportedEstimationWorksheet(key, label) {
  return viewElement(estimatePanel(key, label, [
    h("div", { class: "notice" }, [
      h("strong", "Online measurements are not available for this component yet."),
      " Select a finalized Industrial component or use the future offline workbook route for a custom component.",
    ]),
  ]));
}
