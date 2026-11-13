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
      global.FormTabOrder?.mark(input);
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

  global.ValuationUI = {
    applyInstitutionOptions,
    areaFactors,
    areaLabels,
    byId,
    fieldControl,
    fileData,
    institutionTypeFor,
    isoDate,
    money,
    numeric,
    title,
  };
})(window);
