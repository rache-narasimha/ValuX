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
    let value = field.default ?? defaults[field.id] ?? "";
    if (field.type === "date") value = isoDate(value);
    if (field.type === "boolean") value = String(value).toLowerCase() === "yes" || value === true;
    const options = field.type === "select"
      ? [{ value: "", label: "Select" }, ...(field.options || []).map(value => ({ value, label: optionLabel(value) }))]
      : undefined;
    const wrapper = global.ValuxUI.reportField({
      id: field.id, label: field.label || title(field.id), type: field.type,
      required: Boolean(field.required), value, options,
    });
    if (field.type !== "boolean") global.FormTabOrder?.mark(wrapper.lastElementChild);
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
