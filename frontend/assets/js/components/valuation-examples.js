/** Display examples and track the draft values inserted by bulk fill. */
(function (global) {
  "use strict";

  const measurementOrRate = /(?:^|[._])(?:rate|dimension|extent|size|width|height|length)(?:[._]|$)/;
  const additionalMeasurements = new Set(["property.road_affected_area", "plinth_area"]);
  const propertyDescriptions = {
    residential_plot: "Vacant residential plot in an approved layout",
    commercial_plot: "Vacant commercial plot with road frontage",
    industrial_plot: "Vacant industrial plot in a designated estate",
    residential_land_building: "Residential plot with a single-storey building",
    commercial_land_building: "Commercial plot with a single-storey shop building",
    industrial_land_building: "Industrial plot with a steel-framed workshop",
  };
  const documentDetails = {
    "Sale Deed": "Sale Deed No. [registration number]/[year], registered on [date] at [Sub-Registrar Office].",
    "Approved Plan": "Approved Plan No. [approval number], dated [date], issued by [authority].",
    "Tax Paid Receipt": "Tax receipt No. [reference], issued on [date] by [authority].",
    LSR: "Legal scrutiny report dated [date], issued by [name or office].",
    "Legal Scrutiny Report": "Legal scrutiny report dated [date], issued by [name or office].",
  };
  const floorExamples = {
    plinth_area: "900",
    roof_height: "10",
    age: "8",
    replacement_rate: "2000",
    structure_type: "rcc",
  };

  function install(form, reportType, options) {
    if (global.ReportData.readOnly) return;
    const examples = global.ValuationExampleValues[reportType];
    const storageKey = `sln.report-examples.${reportType}.visible.v1`;
    const owned = new Map();
    const hints = new WeakMap();
    const shownFields = new Set();
    const saved = options.saved;
    let active = saved?.active === true;
    let visible = localStorage.getItem(storageKey) !== "false";

    const fields = () => [...form.querySelectorAll(".field input[name], .field select[name], .field textarea[name]")];
    const byName = (name) => form.elements.namedItem(name);
    const editorFor = (field) => global.ValuationWriting.narrativeFor(field);
    const valueOf = (field) => field.type === "checkbox" ? (field.checked ? "Yes" : "No") : field.value;
    const namedOption = (field, value) => [...field.options].find((option) => option.value === value);

    if (active) {
      for (const [name, entry] of Object.entries(saved.values || {})) {
        if (entry && typeof entry.before === "string" && !entry.before.trim() && typeof entry.inserted === "string") {
          owned.set(name, entry);
        }
      }
    }

    const controls = document.createElement("div");
    controls.className = "example-controls";
    function toggle(label, className) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `secondary examples-toggle ${className}`;
      const indicator = document.createElement("span");
      indicator.className = "example-toggle-indicator";
      indicator.setAttribute("aria-hidden", "true");
      button.append(label, indicator);
      return button;
    }
    const show = toggle("Show examples", "example-show-toggle");
    const bulk = toggle("Fill empty fields", "example-bulk-toggle");
    const message = document.createElement("small");
    message.className = "example-fill-message";
    message.setAttribute("role", "status");
    const instruction = document.createElement("small");
    instruction.textContent = "Double-click an empty text field to use its example.";
    controls.append(show, bulk, message, instruction);
    form.closest("main").querySelector("aside").append(controls);

    function appOwned(field) {
      return options.assignmentFields.has(field.name) || field.hasAttribute("data-calculation")
        || field.hasAttribute("data-tab-autofilled") || field.name === "property.postal_address";
    }

    function linkedGroup(field) {
      return field.closest("[data-site-match-group]")?.querySelector("[data-site-match]")?.checked === true;
    }

    function exampleFor(field) {
      const category = byName("property.category")?.value || "residential_land_building";
      const industrial = category.startsWith("industrial");
      const buildingUse = industrial ? "Industrial" : category.startsWith("commercial") ? "Commercial" : "Residential";
      const floor = field.name.match(/^building\.floors\.(\d+)\.(\w+)$/);
      if (floor) {
        const index = Number(floor[1]);
        const key = floor[2];
        if (key === "name") return ["GF", "FF", "SF", "TF"][index - 1] || `Floor ${index}`;
        if (key === "structure_type" && industrial) return "industrial";
        return floorExamples[key];
      }
      const documentField = field.name.match(/^(documents\.\d+)\.(type|custom_type|details)$/);
      if (documentField) {
        const [, prefix, key] = documentField;
        const type = byName(prefix + ".type")?.value || "Sale Deed";
        if (key === "type") return "Sale Deed";
        if (key === "custom_type") return reportType === "general" ? "Encumbrance Certificate" : "Adangal / Pahani";
        const label = type === "Custom" ? (byName(prefix + ".custom_type")?.value || "Document") : type;
        return documentDetails[type] || `${label} No. [reference], dated [date], issued by [authority].`;
      }
      if (reportType === "general") {
        if (field.name === "property.description") {
          const description = propertyDescriptions[category];
          const status = byName("property.status")?.value;
          return status && status !== "existing" && category.endsWith("land_building")
            ? `${buildingUse} plot with ${status === "proposed" ? "a proposed building" : "a building under construction"}`
            : description;
        }
        if (field.name.startsWith("property.area.") && field.type === "checkbox") {
          return field.name.endsWith(buildingUse.toLowerCase()) ? "Yes" : "No";
        }
        if (field.name === "building.type") return buildingUse;
        if (field.name === "building.construction_type" && industrial) return "Steel Framed";
      }
      return examples[field.name];
    }

    const answeredChecks = new Set(fields().filter((field) => field.type === "checkbox"
      && (field.checked || Object.hasOwn(options.savedValues, field.name))).map((field) => field.name));

    function eligible(field) {
      const wrapper = field.closest(".field");
      if (!wrapper || field.disabled || field.readOnly || wrapper.closest("[hidden]")
          || !["text", "number", "textarea", "select-one", "checkbox"].includes(field.type)
          || appOwned(field)) return false;
      if (linkedGroup(field) && field.name.endsWith(".actual")) return false;
      if (field.type === "checkbox") return !answeredChecks.has(field.name);
      return !field.value.trim();
    }

    function bulkEligible(field) {
      const floorKey = field.name.split(".").at(-1);
      return field.type !== "checkbox" && !linkedGroup(field)
        && !measurementOrRate.test(field.name) && !additionalMeasurements.has(field.name)
        && !additionalMeasurements.has(floorKey);
    }

    function write(field, value) {
      if (field.type === "checkbox") field.checked = value === "Yes";
      else field.value = value;
      if (editorFor(field)) global.ValuationWriting.restoreField(field, {});
    }

    function use(field) {
      if (!visible || !options.available() || form.getAttribute("aria-busy") === "true" || !eligible(field)) return;
      const example = exampleFor(field);
      if (!example || (field.type === "select-one" && !namedOption(field, example))) return;
      if (!options.beforeEdit()) return;
      write(field, example);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function inlineHint(field, text) {
      let hint = hints.get(field);
      if (!hint && text) {
        hint = document.createElement("div");
        hint.className = "valuation-example-hint";
        const label = document.createElement("span");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Use example";
        button.setAttribute("aria-label", `Use example for ${field.labels?.[0]?.textContent || field.name}`);
        button.addEventListener("click", () => use(field));
        hint.append(label, button);
        field.closest(".field").append(hint);
        hints.set(field, hint);
      }
      if (!hint) return;
      hint.hidden = !text;
      if (text) hint.firstElementChild.textContent = text;
    }

    function refresh() {
      const available = options.available();
      controls.hidden = !available;
      bulk.hidden = !visible;
      message.hidden = !visible;
      instruction.hidden = !visible;
      show.setAttribute("aria-pressed", String(visible));
      bulk.setAttribute("aria-pressed", String(active));

      for (const field of fields()) {
        const example = available && visible && eligible(field) ? exampleFor(field) : "";
        const text = field.type === "select-one" && example ? namedOption(field, example)?.textContent : example;
        if (["select-one", "checkbox"].includes(field.type)) {
          inlineHint(field, text ? `Example · ${text}` : "");
          continue;
        }
        if (!text && !shownFields.has(field)) continue;
        if (text) shownFields.add(field);
        else shownFields.delete(field);
        field.placeholder = text ? `Example · ${text}` : "";
        const editor = editorFor(field);
        if (editor) editor.dataset.placeholder = field.placeholder;
      }
      for (const field of shownFields) if (!field.isConnected) shownFields.delete(field);
    }

    function forget(field) {
      owned.delete(field.name);
    }

    function edited(event) {
      const field = event.target;
      if (!field.name) return;
      if (field.type === "checkbox") answeredChecks.add(field.name);
      forget(field);
      refresh();
    }
    form.addEventListener("input", edited);
    form.addEventListener("change", edited);
    form.addEventListener("dblclick", (event) => {
      const editor = event.target.closest(".valuation-narrative");
      const field = editor?.previousElementSibling || event.target.closest("input[name], textarea[name]");
      if (field && field.type !== "checkbox") use(field);
    });

    function bulkValue(field) {
      if (!eligible(field) || !bulkEligible(field)) return;
      const example = exampleFor(field);
      if (!example || (field.type === "select-one" && !namedOption(field, example))) return;
      return example;
    }

    function insertBulk(field, changed) {
      const example = bulkValue(field);
      if (example === undefined) return;
      owned.set(field.name, { before: field.value, inserted: example });
      write(field, example);
      changed.push(field.name);
    }

    show.addEventListener("click", () => {
      visible = !visible;
      localStorage.setItem(storageKey, String(visible));
      refresh();
    });
    bulk.addEventListener("click", () => {
      if (!visible || !options.available() || form.getAttribute("aria-busy") === "true") return;
      const changed = [];
      if (active) {
        const removable = [...owned].filter(([name, entry]) => {
          const field = byName(name);
          return field && !field.readOnly && !appOwned(field) && valueOf(field) === entry.inserted;
        });
        if (removable.length && !options.beforeEdit()) return;
        for (const [name, entry] of removable) {
          write(byName(name), entry.before);
          changed.push(name);
        }
        owned.clear();
      } else {
        if (fields().some(bulkValue) && !options.beforeEdit()) return;
        const category = byName("property.category");
        if (category) {
          insertBulk(category, changed);
          if (changed.length) options.updateSections();
        }
        for (const field of fields()) insertBulk(field, changed);
      }
      active = !active;
      if (changed.length) {
        const action = active ? "filled" : "cleared";
        message.textContent = `${changed.length} ${changed.length === 1 ? "field" : "fields"} ${action}.`;
      } else message.textContent = active ? "No eligible empty fields." : "No untouched examples to clear.";
      options.afterBulk(changed);
      refresh();
    });

    function shift(prefix, removedIndex) {
      const entries = [...owned].filter(([name]) => name.startsWith(prefix));
      for (const [name] of entries) owned.delete(name);
      for (const [name, entry] of entries) {
        const suffix = name.slice(prefix.length);
        const dot = suffix.indexOf(".");
        const index = Number(suffix.slice(0, dot));
        if (index === removedIndex) continue;
        owned.set(index < removedIndex ? name : prefix + (index - 1) + suffix.slice(dot), entry);
      }
    }

    refresh();
    return {
      refresh,
      forget,
      shift,
      serialize: () => active ? { active, values: Object.fromEntries(owned) } : undefined,
    };
  }

  global.ValuationExamples = { install };
})(window);
