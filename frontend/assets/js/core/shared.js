/** Shared form, calculation, and institution helpers for valuation workflows. */
(function exposeValuationUi(global) {
  const areaFactors = {
    sq_ft: 1,
    sq_yd: 9,
    cent: 435.6,
    acre: 43560,
    sq_m: 10.7639104167,
  };

  const areaLabels = {
    sq_ft: "Sq.ft",
    sq_yd: "Sq.yd",
    cent: "Cent",
    acre: "Acre",
    sq_m: "Sq.m",
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function title(value) {
    const categoryLabels = {
      residential_land_building: "Residential Land and Building",
      commercial_land_building: "Commercial Land and Building",
      industrial_land_building: "Industrial Land and Building",
    };
    if (categoryLabels[value]) return categoryLabels[value];
    return String(value)
      .replaceAll("_", " ")
      .replace(/\b\w/g, (character) => character.toUpperCase());
  }

  function numeric(value) {
    const match = String(value ?? "").match(/-?\d[\d,]*(?:\.\d+)?/);
    const number = Number((match?.[0] || "").replaceAll(",", ""));
    return Number.isFinite(number) ? number : 0;
  }

  function money(value) {
    return `${Math.round(value).toLocaleString("en-IN")}/-`;
  }

  function isoDate(value) {
    const match = String(value || "").match(/(\d{2})-(\d{2})-(\d{4})/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : value || "";
  }

  function fieldControl(field, defaults = {}, optionLabel = title) {
    const wrapper = document.createElement("div");
    wrapper.className = `field${field.type === "textarea" ? " full" : ""}`;
    wrapper.dataset.field = field.id;

    const label = document.createElement("label");
    label.textContent = field.label || title(field.id);
    label.htmlFor = field.id;
    if (field.required) label.classList.add("required");

    let input;
    if (field.type === "select") {
      input = document.createElement("select");
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select";
      input.append(placeholder);
      (field.options || []).forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = optionLabel(value);
        input.append(option);
      });
    } else if (field.type === "textarea") {
      input = document.createElement("textarea");
    } else {
      input = document.createElement("input");
      input.type =
        field.type === "boolean"
          ? "checkbox"
          : field.type === "date"
            ? "date"
            : "text";
      if (field.type === "boolean") wrapper.classList.add("check");
      if (["currency", "currency_rate", "number"].includes(field.type)) {
        input.inputMode = "decimal";
      }
    }

    input.id = field.id;
    input.name = field.id;
    input.required = Boolean(field.required);
    let value = field.default ?? defaults[field.id] ?? "";
    if (input.type === "date") value = isoDate(value);
    if (input.type === "checkbox") {
      input.checked = String(value).toLowerCase() === "yes" || value === true;
    } else {
      input.value = value;
    }

    wrapper.append(label, input);
    return wrapper;
  }

  function institutionTypeFor(name) {
    return (
      Object.entries(global.INSTITUTIONS || {}).find(([, items]) =>
        items.some((item) => item.name === name),
      )?.[0] || ""
    );
  }

  function applyInstitutionOptions() {
    const type = byId("institution.type")?.value || "";
    const select = byId("bank.name");
    if (!select) return;

    const current = select.value;
    select.innerHTML = '<option value="">Select</option>';
    (global.INSTITUTIONS?.[type] || []).forEach((item) => {
      const option = document.createElement("option");
      option.value = item.name;
      option.textContent = `${item.code} — ${item.name}`;
      select.append(option);
    });
    select.value = [...select.options].some(
      (option) => option.value === current,
    )
      ? current
      : "";
  }

  function fileData(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve({
          name: file.name,
          key: `${file.name}:${file.size}:${file.lastModified}`,
          data: reader.result,
        });
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const EXAMPLES = {
    general: {
      "report.purpose": "Housing loan valuation",
      "bank.branch": "Adoni Branch",
      "owner.details": "R. Kumar, 12-3 Main Road, Adoni, 90000 00000",
      "purchaser.details": "S. Devi, 8-2 Market Road, Adoni, 90000 00001",
      "property.description": "Residential land and ground-floor building",
      "property.plot_survey_number": "Plot No. 24, Survey No. 118/B",
      "property.village": "Example Colony, Adoni",
      "property.mandal_district": "Adoni Mandal, Kurnool District",
      "documents.1.details": "Document No. 1234/2025 dated 15-06-2025",
      "sale_agreement.details": "Agreement No. 18/2025 dated 20-06-2025",
    },
    agricultural: {
      "report.purpose": "Agricultural land loan valuation",
      "bank.branch": "Adoni Branch",
      "report.place": "Adoni",
      "owner.details": "R. Kumar, Example Village, 90000 00000",
      "purchaser.details": "S. Devi, Example Village, 90000 00001",
      "property.description": "Dry agricultural land with approach road",
      "property.survey_number": "Survey No. 118/B",
      "property.village": "Example Village",
      "property.mandal_district": "Adoni Mandal, Kurnool District",
      "documents.1.details": "Document No. 1234/2025 dated 15-06-2025",
      "sale_agreement.details": "Agreement No. 18/2025 dated 20-06-2025",
    },
  };

  function installExampleAssistance(root, reportType) {
    const examples = EXAMPLES[reportType] || {};
    const key = `sln.report-examples.${reportType}.visible.v1`;
    let visible = localStorage.getItem(key) !== "false";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary examples-toggle";
    const update = () => {
      button.textContent = visible ? "Hide examples" : "Show examples";
      button.setAttribute("aria-pressed", String(visible));
      Object.entries(examples).forEach(([id, example]) => {
        const input = root.querySelector(`[name="${CSS.escape(id)}"]`);
        if (!input || input.readOnly || input.disabled || input.type === "file") return;
        input.dataset.example = example;
        input.placeholder = visible ? `Example: ${example}` : "";
      });
    };
    button.addEventListener("click", () => {
      visible = !visible;
      localStorage.setItem(key, String(visible));
      update();
    });
    root.addEventListener("dblclick", (event) => {
      const input = event.target.closest("input[data-example], textarea[data-example]");
      if (!visible || !input || input.value.trim()) return;
      input.value = input.dataset.example;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const controls = document.createElement("div");
    controls.className = "example-controls";
    controls.append(button, Object.assign(document.createElement("small"), {
      textContent: "Double-click an empty field to use its fictional example.",
    }));
    root.closest("main").querySelector("aside").append(controls);
    update();
  }

  global.ValuationUI = {
    applyInstitutionOptions,
    areaFactors,
    areaLabels,
    byId,
    fieldControl,
    fileData,
    institutionTypeFor,
    installExampleAssistance,
    isoDate,
    money,
    numeric,
    title,
  };
})(window);
