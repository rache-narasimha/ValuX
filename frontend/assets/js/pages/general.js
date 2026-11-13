/** General-property valuation form controller: fields, floors, calculations, drafts, media, preview, and generation. */
if (window.InstitutionValuationOffline?.activate()) {
  // KVB and Karnataka Bank deliberately use their approved external workflows.
} else {
const state = {
  schema: null,
  sections: [],
  current: 0,
  format: "docx",
  photos: [],
  map: null,
  floorCount: 1,
  documentCount: 1,
  matchedSiteFields: {},
  previewReady: false,
  previewId: null,
  preparationMethod: "",
  generatedChangeAcknowledged: false,
  processing: false,
};
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const DRAFT_SCOPE = PAGE_PARAMS.get("practice") === "1"
  ? "practice"
  : PAGE_PARAMS.get("task")
    ? `task-${PAGE_PARAMS.get("task")}`
    : "standalone";
const STORAGE_KEY = `valuation-report-draft-v3-${DRAFT_SCOPE}`;
const HAS_PREPARATION_CHOICE = window.RetrospectiveValuation?.supportsChoice("valuation-general") === true;
const groupId = (s) => s.toLowerCase().replaceAll(" ", "_");
const {
  applyInstitutionOptions,
  areaFactors,
  byId,
  fieldControl,
  fileData,
  institutionTypeFor,
  isoDate,
  money,
  numeric,
  title,
} = window.ValuationUI;

function reportErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message.trim() : "";
  return message && !/^(failed to fetch|networkerror|load failed)$/i.test(message)
    ? message
    : fallback;
}

// Assignment context and report-section configuration.
function linkedTaskValues() {
  const taskId = PAGE_PARAMS.get("task");
  const task = taskId && window.TaskStore ? TaskStore.get(taskId) : null;
  return task ? {
    "institution.type": task.institutionType,
    "bank.name": task.institutionName,
    "bank.branch": task.branch,
    "property.description": task.propertyBrief,
    "owner.details": task.customerName,
  } : {};
}
const sectionPlan = [
  { id: "setup", label: "Report Setup", groups: ["report"] },
  ...(HAS_PREPARATION_CHOICE ? [{ id: "preparation", label: "Preparation Method", groups: [] }] : []),
  {
    id: "property",
    label: "Documents & Property",
    groups: ["documents", "parties", "property"],
  },
  {
    id: "site_land",
    label: "Site & Land",
    groups: ["boundaries", "dimensions", "site", "land"],
  },
  {
    id: "building_floors",
    label: "Building Details",
    groups: ["building", "construction", "floors"],
  },
  {
    id: "extras",
    label: "Extra Items & Services",
    groups: ["extra_items", "amenities", "miscellaneous", "services"],
  },
  {
    id: "valuation",
    label: "Valuation",
    groups: ["valuation_abstract", "valuation"],
  },
  { id: "media", label: "Photos & Map", groups: [] },
  ...(HAS_PREPARATION_CHOICE ? [{ id: "offline", label: "Complete & Upload Report", groups: [] }] : []),
];
const excluded = new Set([
  "report.valuation_date_detail",
  "property.valuation_extent",
  "land.adopted_rate",
  "land.estimated_value",
  "building.floor_summary",
  "building.plinth_summary",
  "valuation.present_market_value",
  "valuation.realizable_value",
  "valuation.distress_value",
  "abstract.land",
  "abstract.building",
  "abstract.total",
  "abstract.present_market_value",
  "documents.deed_type",
  "documents.deed_details",
  "documents.approved_plan",
  "documents.legal_scrutiny",
  "documents.tax_receipt",
]);

// Dynamic document, land, floor, and media controls.
function customField(id, label, type = "text", value = "") {
  const control = fieldControl({ id, label, type });
  control.querySelector("input, select, textarea").value = value;
  return control;
}
function calculatedField(id, label) {
  const f = customField(id, label);
  f.classList.add("calculated");
  return f;
}
function renderDocuments(saved = {}) {
  const host = byId("general-document-list");
  if (!host) return;
  const existing = { ...collectValues(), ...saved };
  host.innerHTML = "";
  for (let index = 1; index <= state.documentCount; index++) {
    const card = document.createElement("div");
    card.className = "document-card";
    const isLast = index === state.documentCount;
    const addIcon = window.AppShell?.icons?.add || "+";
    const trashIcon = window.AppShell?.icons?.trash || "×";
    card.innerHTML = `<div class="document-head"><h4>Document ${index}</h4><div class="document-actions">${isLast ? `<button type="button" class="document-icon-button add-document" data-add-document title="Add another document" aria-label="Add another document">${addIcon}</button>` : ""}${index > 1 ? `<button type="button" class="document-icon-button remove-document" data-remove-document="${index}" title="Remove document ${index}" aria-label="Remove document ${index}">${trashIcon}</button>` : ""}</div></div><div class="grid"></div>`;
    const grid = card.querySelector(".grid");
    const typeId = `documents.${index}.type`,
      customId = `documents.${index}.custom_type`,
      detailsId = `documents.${index}.details`;
    grid.append(
      fieldControl({
        id: typeId,
        label: "Document type",
        type: "select",
        required: true,
        options: [
          "Sale Deed",
          "Rectification Deed",
          "Partition Deed",
          "Relinquishment Deed",
          "Approved Plan",
          "Legal Scrutiny Report",
          "Tax Paid Receipt",
          "Custom",
        ],
      }),
    );
    const custom = fieldControl({
      id: customId,
      label: "Custom document name",
      type: "text",
    });
    grid.append(custom);
    grid.append(
      fieldControl({
        id: detailsId,
        label: "Document details",
        type: "textarea",
        required: true,
      }),
    );
    host.append(card);
    byId(typeId).value = existing[typeId] || "";
    byId(customId).value = existing[customId] || "";
    byId(detailsId).value = existing[detailsId] || "";
    ValuationWriting.restoreField(byId(detailsId), existing);
    custom.hidden = byId(typeId).value !== "Custom";
    byId(typeId).addEventListener("change", () => {
      custom.hidden = byId(typeId).value !== "Custom";
      if (!custom.hidden) byId(customId).focus();
    });
  }
  host
    .querySelectorAll("[data-add-document]")
    .forEach((button) => (button.onclick = addDocument));
  host
    .querySelectorAll("[data-remove-document]")
    .forEach(
      (button) =>
        (button.onclick = () =>
          removeDocument(Number(button.dataset.removeDocument))),
    );
}
function addDocument() {
  if (!confirmReportInvalidation()) return;
  state.documentCount++;
  renderDocuments();
  wireInputs();
  markDirty();
  saveDraft();
}
function removeDocument(index) {
  if (index === 1) return;
  if (!confirmReportInvalidation()) return;
  const existing = collectValues(),
    shifted = {};
  Object.entries(existing).forEach(([key, value]) => {
    const match = key.match(/^documents\.(\d+)\.(.+)$/);
    if (!match || Number(match[1]) < index) shifted[key] = value;
    else if (Number(match[1]) > index)
      shifted[`documents.${Number(match[1]) - 1}.${match[2]}`] = value;
  });
  state.documentCount--;
  exampleAssistance?.shift("documents.", index);
  renderDocuments(shifted);
  setValues(shifted);
  wireInputs();
  markDirty();
  saveDraft();
}
function addDocumentSection(panel) {
  const block = document.createElement("section");
  block.className = "subgroup";
  block.innerHTML =
    '<h3>Documents</h3><p class="hint">Use Add in the latest document header to include another document.</p><div id="general-document-list"></div><section class="subgroup"><h4>Sale agreement</h4><div class="grid" id="general-sale-agreement"></div></section>';
  panel.append(block);
  const sale = block.querySelector("#general-sale-agreement");
  sale.append(
    fieldControl({
      id: "sale_agreement.used",
      label: "Sale agreement available",
      type: "boolean",
    }),
  );
  sale.append(
    fieldControl({
      id: "sale_agreement.details",
      label: "Sale agreement number and date",
      type: "textarea",
    }),
  );
  sale.append(
    fieldControl({
      id: "sale_agreement.value",
      label: "Sale agreement value",
      type: "currency",
    }),
  );
}
function addSubgroup(panel, label, fields, group) {
  if (!fields.length) return;
  const block = document.createElement("section");
  block.className = "subgroup";
  const fillablePrefix = ["extra.", "amenity.", "misc.", "service."].find((prefix) =>
    fields.some((field) => field.id.startsWith(prefix)),
  );
  block.innerHTML = `<div class="subgroup-heading"><h3>${label}</h3>${fillablePrefix ? '<button type="button" class="secondary fill-included">Fill blank items as Included</button>' : ""}</div><div class="grid"></div>`;
  fields.forEach((f) => {
    const control = f.calculated && f.id !== "abstract.machinery"
      ? calculatedField(f.id, f.label)
      : fieldControl(f, state.schema.defaults);
    if (fillablePrefix && f.id.startsWith(fillablePrefix)) control.querySelector("input")?.setAttribute("data-arithmetic-optional", "");
    block.querySelector(".grid").append(control);
  });
  block.querySelector(".fill-included")?.addEventListener("click", () => {
    if (!confirmReportInvalidation()) return;
    fields.filter((field) => field.id.startsWith(fillablePrefix)).forEach((field) => {
      const input = byId(field.id);
      if (input && !input.value.trim()) {
        input.value = "Included";
        calculateAll(input.id);
      }
    });
    calculateAll();
    markDirty();
    saveDraft();
  });
  if (group === "boundaries" || group === "dimensions") {
    block.dataset.siteMatchGroup = group;
  }
  panel.append(block);
}
function addSiteMatchControl(block, saved) {
  if (ReportData.readOnly) return;
  const group = block.dataset.siteMatchGroup;
  const fieldType = group === "boundaries" ? "boundary" : "dimension";
  const pairs = ["north", "south", "east", "west"].map((direction) =>
    ["deed", "actual"].map((side) => block.querySelector(`[name="property.${fieldType}.${direction}.${side}"]`)),
  );
  if (pairs.some((pair) => pair.some((input) => !input))) return;

  const label = document.createElement("label");
  label.className = "site-match-control";
  label.innerHTML = '<input type="checkbox" data-site-match> Deed and actual match';
  const toggle = label.querySelector("input");
  const message = document.createElement("p");
  message.className = "hint site-match-message";
  message.setAttribute("role", "status");
  block.querySelector(".subgroup-heading").append(label);
  block.querySelector(".grid").before(message);

  function updateMessage(text) {
    message.textContent = text;
    message.hidden = !text;
  }

  toggle.checked = saved === true && pairs.every(([deed, actual]) => deed.value === actual.value);
  if (toggle.checked) {
    state.matchedSiteFields[group] = true;
    pairs.forEach(([, actual]) => FormTabOrder.mark(actual));
  }
  updateMessage(toggle.checked ? "Edit either column to update both." : "");

  toggle.addEventListener("change", () => {
    if (!toggle.checked) {
      delete state.matchedSiteFields[group];
      pairs.flat().forEach((input) => FormTabOrder.mark(input, false));
      updateMessage("");
      exampleAssistance?.refresh();
      saveDraft();
      return;
    }
    if (pairs.some(([deed, actual]) => deed.value.trim() && actual.value.trim() && deed.value !== actual.value)) {
      toggle.checked = false;
      updateMessage("Some deed and actual values differ. Make those pairs match before linking the columns.");
      return;
    }
    const needsCopy = pairs.some(([deed, actual]) => deed.value !== actual.value);
    if (needsCopy && !confirmReportInvalidation()) {
      toggle.checked = false;
      return;
    }
    for (const [deed, actual] of pairs) {
      const [source, target] = deed.value.trim() ? [deed, actual] : [actual, deed];
      target.value = source.value;
      FormTabOrder.mark(source, false);
      FormTabOrder.mark(target);
    }
    state.matchedSiteFields[group] = true;
    pairs.flat().forEach((field) => exampleAssistance?.forget(field));
    updateMessage("Edit either column to update both.");
    exampleAssistance?.refresh();
    if (needsCopy) markDirty();
    saveDraft();
  });

  function mirror(source, target) {
    if (!toggle.checked) return;
    target.value = source.value;
    exampleAssistance?.forget(target);
    FormTabOrder.mark(source, false);
    FormTabOrder.mark(target);
  }

  for (const [deed, actual] of pairs) {
    deed.addEventListener("input", () => mirror(deed, actual));
    actual.addEventListener("input", () => mirror(actual, deed));
  }
}
function addLandCalculator(panel) {
  const block = document.createElement("section");
  block.className = "subgroup";
  block.innerHTML =
    '<h3>Land calculation</h3><p class="hint">The extent is converted into the selected rate unit before multiplication.</p><div class="grid"></div>';
  const grid = block.querySelector(".grid");
  grid.append(
    customField("land.extent_value", "Extent considered for valuation", "number"),
  );
  grid.append(
    fieldControl({
      id: "land.extent_unit",
      label: "Extent unit",
      type: "select",
      options: ["cent", "sq_yd", "sq_ft", "sq_m", "acre"],
    }),
  );
  grid.append(
    customField("land.adopted_rate_value", "Adopted land rate", "currency"),
  );
  grid.append(
    fieldControl({
      id: "land.rate_unit",
      label: "Rate per unit",
      type: "select",
      options: ["cent", "sq_yd", "sq_ft", "sq_m", "acre"],
    }),
  );
  grid.append(
    calculatedField("land.converted_extent", "Converted extent in rate unit"),
  );
  grid.append(
    calculatedField("land.estimated_value_display", "Estimated Land Value"),
  );
  panel.append(block);
}
function floorName(index) {
  return ["GF", "FF", "SF", "TF"][index - 1] || `Floor ${index}`;
}
function collectValues() {
  const values = {};
  document
    .querySelectorAll(
      "#valuation-form input,#valuation-form select,#valuation-form textarea",
    )
    .forEach((i) => {
      if (!i.name || i.type === "file" || i.dataset.preparationMethod) return;
      values[i.name] =
        i.type === "checkbox" ? (i.checked ? "Yes" : "No") : NumericEntry.read(i);
    });
  values[window.ValuationCalculations.overridesKey] = calculations?.serialize() || "{}";
  ValuationWriting.collectFormatting(byId("valuation-form"), values);
  return values;
}
function addFloor() {
  if (!confirmReportInvalidation()) return;
  state.floorCount++;
  calculations?.floorsChanged();
  renderFloors();
  wireInputs();
  calculateAll();
  saveDraft();
}
function removeFloor(index) {
  if (index === 1) return;
  if (!confirmReportInvalidation()) return;
  const existing = collectValues();
  state.floorCount--;
  exampleAssistance?.shift("building.floors.", index);
  calculations?.shiftFloor(index);
  const shifted = {};
  Object.entries(existing).forEach(([key, value]) => {
    const m = key.match(/^building\.floors\.(\d+)\.(.+)$/);
    if (!m || Number(m[1]) < index) shifted[key] = value;
    else if (Number(m[1]) > index)
      shifted[`building.floors.${Number(m[1]) - 1}.${m[2]}`] = value;
  });
  renderFloors(shifted);
  setValues(shifted);
  wireInputs();
  calculateAll();
  saveDraft();
}
function renderFloors(saved = {}) {
  const host = byId("floor-list");
  if (!host) return;
  const existing = { ...collectValues(), ...saved };
  host.innerHTML = "";
  for (let i = 1; i <= state.floorCount; i++) {
    const card = document.createElement("div");
    card.className = "floor-card";
    card.innerHTML = `<div class="floor-head"><h4>${i === 1 ? "Ground floor" : `Additional floor ${i - 1}`}</h4>${i > 1 ? `<button type="button" class="remove-floor" data-remove-floor="${i}">Remove</button>` : ""}</div><div class="grid"></div>`;
    const grid = card.querySelector(".grid");
    [
      { key: "name", label: "Floor name" },
      { key: "plinth_area", label: "Plinth area (sq.ft)" },
      { key: "roof_height", label: "Roof height (ft)" },
      { key: "age", label: "Building age (years)" },
      { key: "replacement_rate", label: "Replacement rate per sq.ft" },
    ].forEach((f) => {
      const id = `building.floors.${i}.${f.key}`;
      const control = customField(id, f.label, "text", existing[id] ?? "");
      if (f.key !== "name") control.querySelector("input").setAttribute("data-arithmetic-optional", "");
      grid.append(control);
    });
    const structureId = `building.floors.${i}.structure_type`;
    grid.append(
      fieldControl(
        {
          id: structureId,
          label: "Structure / roof type",
          type: "select",
          options: ["rcc", "industrial", "temporary"],
        },
        { [structureId]: existing[structureId] || "" },
      ),
    );
    ["total_life", "replacement_cost", "depreciation", "net_value"].forEach(
      (key) =>
        grid.append(calculatedField(`building.floors.${i}.${key}`, title(key))),
    );
    host.append(card);
  }
  host
    .querySelectorAll("[data-remove-floor]")
    .forEach(
      (b) => (b.onclick = () => removeFloor(Number(b.dataset.removeFloor))),
    );
}
function addFloorSection(panel) {
  const block = document.createElement("section");
  block.className = "subgroup";
  block.innerHTML =
    '<h3>Floor-wise valuation</h3><p class="hint">Use GF only for ground-floor properties. Add as many additional floors as required.</p><div id="floor-list"></div><button type="button" class="secondary" id="add-floor">Add additional floor</button>';
  panel.append(block);
  block.querySelector("#add-floor").onclick = addFloor;
}
function addMedia(panel) {
  panel.innerHTML +=
    '<section class="subgroup"><h3>Property photographs</h3><p class="hint">Reports use a 3 × 4 media grid with up to 12 items per page. The map follows the photographs in the next available cell; after an exact batch of 12 photographs it starts the next page. Images retain their full aspect ratio and are never cropped.</p><input id="photo-upload" type="file" accept="image/*" multiple><div id="photo-preview" class="preview-grid three-columns"></div></section><section class="subgroup"><h3>Location map</h3><p class="hint">Upload one map screenshot. It follows the photographs in the 12-item media sequence.</p><input id="map-upload" type="file" accept="image/*"><div id="map-preview" class="map-preview"></div></section>';
  panel.querySelector("#photo-upload").onchange = async (e) => {
    if (!confirmReportInvalidation()) {
      e.target.value = "";
      return;
    }
    const added = await Promise.all([...e.target.files].map(fileData)),
      known = new Set(state.photos.map((photo) => photo.key));
    state.photos.push(...added.filter((photo) => !known.has(photo.key)));
    e.target.value = "";
    renderPreviews();
    markDirty();
    saveDraft();
  };
  panel.querySelector("#map-upload").onchange = async (e) => {
    if (!confirmReportInvalidation()) {
      e.target.value = "";
      return;
    }
    state.map = e.target.files[0] ? await fileData(e.target.files[0]) : null;
    e.target.value = "";
    renderPreviews();
    markDirty();
  };
}
function renderPreviews() {
  const p = byId("photo-preview");
  if (p) {
    p.classList.remove("one-column");
    p.classList.add("three-columns");
    p.replaceChildren(...state.photos.map((photo, index) => {
      const tile = document.createElement("div");
      tile.className = "photo-tile";
      const image = document.createElement("img");
      image.src = photo.data;
      image.alt = photo.name || `Property photograph ${index + 1}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.removePhoto = String(index);
      remove.setAttribute("aria-label", `Remove ${photo.name || `photograph ${index + 1}`}`);
      remove.textContent = "Remove";
      tile.append(image, remove);
      return tile;
    }));
    p.querySelectorAll("[data-remove-photo]").forEach(
      (button) =>
        (button.onclick = () => {
          if (!confirmReportInvalidation()) return;
          state.photos.splice(Number(button.dataset.removePhoto), 1);
          renderPreviews();
          markDirty();
          saveDraft();
        }),
    );
  }
  const m = byId("map-preview");
  if (m)
    m.innerHTML = state.map
      ? `<div class="media-preview-item"><img src="${state.map.data}" alt="Map preview"><button type="button" class="secondary remove-map">Remove map</button></div>`
      : "";
  m?.querySelector(".remove-map")?.addEventListener("click", () => {
    if (!confirmReportInvalidation()) return;
    state.map = null;
    const upload = byId("map-upload");
    if (upload) upload.value = "";
    renderPreviews();
    markDirty();
    saveDraft();
  });
}

// Preview state, navigation, persistence, and calculated values.
function currentTask() {
  return ReportData.taskCode && window.TaskStore ? TaskStore.get(ReportData.taskCode) : null;
}
async function setPreparationMethod(method) {
  if (!HAS_PREPARATION_CHOICE || !["online", "offline"].includes(method)) return false;
  if (state.preparationMethod === method) return true;
  const previous = state.preparationMethod;
  const task = currentTask();
  if (!RetrospectiveValuation.confirmPreparationChange("preparation method", previous, method, task)) return false;
  if (previous && task?.reportGeneratedAt) {
    try {
      await BusinessApi.delete(`/api/tasks/${encodeURIComponent(task.id)}/artifacts/latest`);
      await TaskStore.refresh(task.id);
    } catch (error) {
      window.alert(error.message || "The retained report could not be removed. Try again before changing the preparation method.");
      return false;
    }
  }
  state.preparationMethod = method;
  markDirty();
  applyRules();
  await persistDraftNow();
  show(sectionPlan.findIndex((section) => section.id === (method === "online" ? "property" : "offline")));
  return true;
}
function confirmReportInvalidation() {
  const task = currentTask();
  if (!task?.reportGeneratedAt || task.reportFresh === false || state.generatedChangeAcknowledged) return true;
  const accepted = RetrospectiveValuation.confirmReportEdit(state.preparationMethod);
  if (accepted) state.generatedChangeAcknowledged = true;
  return accepted;
}
function markDirty() {
  state.previewReady = false;
  state.previewId = null;
  ReportData.setPreview(null);
  byId("generate-docx").disabled = true;
  byId("generate-pdf").disabled = true;
  window.dispatchEvent(new CustomEvent("sln:report-dirty"));
}
function reportPayload(format = "pdf") {
  calculateAll();
  return {
    values: collectValues(),
    format,
    photos: state.photos,
    map: state.map,
    preview_id: state.previewId,
  };
}
function setProcessing(active, title = "", stage = "") {
  state.processing = active;
  byId("processing").hidden = !active;
  byId("processing-title").textContent = title || "Processing report";
  byId("processing-stage").textContent = stage || "Please wait…";
  byId("preview-report").disabled = active;
  byId("generate-docx").disabled = active || !state.previewReady;
  byId("generate-pdf").disabled = active || !state.previewReady;
  byId("valuation-form").setAttribute("aria-busy", String(active));
}
function visibleSectionIndexes() {
  return state.sections
    .map((panel, index) => (panel.hidden ? null : index))
    .filter((index) => index !== null);
}
function updateSectionNavigation() {
  const visible = visibleSectionIndexes(),
    position = visible.indexOf(state.current);
  document
    .querySelectorAll("nav button")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        Number(button.dataset.sectionIndex) === state.current,
      ),
    );
  byId("progress").textContent = `Section ${position + 1} of ${visible.length}`;
  byId("previous").disabled = position <= 0;
  byId("next").disabled = position < 0 || position === visible.length - 1;
}
function show(index) {
  const visible = visibleSectionIndexes();
  if (!visible.length) return;
  if (!visible.includes(index))
    index = visible.find((item) => item > index) ?? visible[visible.length - 1];
  state.current = index;
  document
    .querySelectorAll(".panel")
    .forEach((panel, panelIndex) =>
      panel.classList.toggle("active", panelIndex === state.current),
    );
  updateSectionNavigation();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function moveSection(offset) {
  const visible = visibleSectionIndexes(),
    position = visible.indexOf(state.current),
    next = visible[position + offset];
  if (next !== undefined) show(next);
}
function validateRequiredFields(form) {
  if (form.checkValidity()) return true;
  const invalid = [...form.elements].find((control) => typeof control.checkValidity === "function" && !control.checkValidity());
  const message = NumericEntry.error(form) || "Complete the highlighted required field before previewing the report.";
  byId("status").textContent = message;
  if (invalid) {
    const panel = invalid.closest(".panel");
    const index = state.sections.indexOf(panel);
    if (index >= 0) show(index);
    const visibleInput = ValuationWriting.narrativeFor(invalid) || invalid;
    visibleInput.classList.add("validation-target");
    invalid.addEventListener("input", () => visibleInput.classList.remove("validation-target"), { once: true });
    window.setTimeout(() => {
      visibleInput.focus({ preventScroll: true });
      visibleInput.scrollIntoView({ behavior: "smooth", block: "center" });
      if (visibleInput === invalid) invalid.reportValidity();
    }, 250);
  }
  window.alert(message);
  return false;
}
function setValues(values) {
  Object.entries(values || {}).forEach(([id, value]) => {
    const input = byId(id);
    if (!input) return;
    if (input.type === "checkbox")
      input.checked = value === "Yes" || value === true;
    else {
      const previous = input.value;
      input.value = input.type === "date" ? isoDate(value) : value;
      if (input.value !== previous) FormTabOrder.mark(input, false);
    }
  });
  ValuationWriting.restoreFormatting(byId("valuation-form"), values);
}
let calculations;
let addressAutofill;
let exampleAssistance;
function calculateAll(changedId) {
  if (ReportData.readOnly) return;
  calculations?.refresh(changedId);
}

let saveTimer;
async function persistDraftNow() {
  if (ReportData.readOnly) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const saved = await ReportData.save(STORAGE_KEY, "valuation-general", {
    values: collectValues(),
    postalAddressMode: addressAutofill?.mode || undefined,
    exampleFill: exampleAssistance?.serialize(),
    preparationMethod: state.preparationMethod,
    uploadType: byId("valuation-upload-type")?.value || "",
    floorCount: state.floorCount,
    documentCount: state.documentCount,
    matchedSiteFields: state.matchedSiteFields,
    photos: state.photos,
    map: state.map,
  }, String(state.schema.version || "3"));
  state.photos = Array.isArray(saved.photos) ? saved.photos : [];
  state.map = saved.map || null;
  renderPreviews();
  byId("status").textContent = ReportData.localOnly ? "Saved locally" : "Saved";
  byId("status").classList.remove("is-saving");
  byId("status").removeAttribute("aria-label");
  if (state.generatedChangeAcknowledged && ReportData.taskCode) await ReportData.refreshTask();
}
function saveDraft() {
  if (ReportData.readOnly) return;
  clearTimeout(saveTimer);
  byId("status").classList.add("is-saving");
  byId("status").setAttribute("aria-label", ReportData.localOnly ? "Saving draft locally" : "Saving draft");
  saveTimer = setTimeout(() => persistDraftNow().catch((error) => {
    byId("status").textContent = error.message || "Draft save failed";
    byId("status").classList.remove("is-saving");
  }), 700);
}
async function restoreDraft() {
  try { return await ReportData.load(STORAGE_KEY); }
  catch (error) {
    byId("status").textContent = error.message || "Draft could not be restored";
    return null;
  }
}
function applyRules() {
  const category = byId("property.category")?.value || "",
    hasBuilding = category.includes("land_building"),
    index = sectionPlan.findIndex((x) => x.id === "building_floors");
  const online = !HAS_PREPARATION_CHOICE || state.preparationMethod === "online";
  if (HAS_PREPARATION_CHOICE) {
    document.body.dataset.valuationPreparation = state.preparationMethod;
    window.dispatchEvent(new CustomEvent("sln:valuation-preparation-changed"));
  }
  sectionPlan.forEach((section, sectionIndex) => {
    const alwaysVisible = section.id === "setup" || section.id === "preparation";
    const visible = alwaysVisible || (section.id === "offline" ? state.preparationMethod === "offline" : online);
    const finalVisible = section.id === "building_floors" ? visible && hasBuilding : visible;
    state.sections[sectionIndex].toggleAttribute("hidden", !finalVisible);
    document.querySelectorAll(`[data-section-index="${sectionIndex}"]`).forEach((button) => button.toggleAttribute("hidden", !finalVisible));
    state.sections[sectionIndex].querySelectorAll("input,select,textarea,button").forEach((control) => {
      if (!control.dataset.preparationMethod) control.disabled = !finalVisible;
    });
  });
  ["preview-report", "generate-docx", "generate-pdf"].forEach((id) => byId(id).toggleAttribute("hidden", !online));
  const showSale = byId("sale_agreement.used")?.checked === true;
  document
    .querySelector('[data-field="sale_agreement.details"]')
    ?.toggleAttribute("hidden", !showSale);
  document
    .querySelector('[data-field="sale_agreement.value"]')
    ?.toggleAttribute("hidden", !showSale);
  if (state.current === index && !hasBuilding) show(index + 1);
  else if (state.sections[state.current]?.hidden) show(sectionPlan.findIndex((section) => section.id === "preparation"));
  else updateSectionNavigation();
  exampleAssistance?.refresh();
}
function wireInputs() {
  document
    .querySelectorAll(
      "#valuation-form input,#valuation-form select,#valuation-form textarea",
    )
    .forEach((i) => {
      if (i.type === "file" || i.dataset.preparationMethod || i.hasAttribute("data-site-match") || i.dataset.wired) return;
      i.dataset.wired = "1";
      i.addEventListener("focus", () => {
        i.dataset.previousValue = i.value;
        i.dataset.previousChecked = String(i.checked);
      });
      if (i.type === "checkbox" || i.type === "radio") {
        i.addEventListener("click", (event) => {
          if (!confirmReportInvalidation()) event.preventDefault();
        });
      } else if (i.tagName !== "SELECT" && i.type !== "file") {
        i.addEventListener("beforeinput", (event) => {
          if (!confirmReportInvalidation()) event.preventDefault();
        });
      }
      i.addEventListener("input", () => {
        if (i.id === "institution.type") applyInstitutionOptions();
        addressAutofill?.changed(i.id);
        calculateAll(i.id);
        markDirty();
        saveDraft();
      });
      i.addEventListener("change", () => {
        if (!confirmReportInvalidation()) {
          i.value = i.dataset.previousValue ?? i.value;
          if (i.type === "checkbox" || i.type === "radio") i.checked = i.dataset.previousChecked === "true";
          return;
        }
        i.dataset.previousValue = i.value;
        i.dataset.previousChecked = String(i.checked);
        if (i.id === "institution.type") applyInstitutionOptions();
        addressAutofill?.changed(i.id);
        calculateAll(i.id);
        applyRules();
        markDirty();
        saveDraft();
      });
    });
  ValuationWriting.wireNarratives(byId("valuation-form"), confirmReportInvalidation);
  exampleAssistance?.refresh();
}



// Page assembly and report-generation event wiring.
async function init() {
  state.schema = await fetch("/api/schema").then((r) => r.json());
  const labels = Object.fromEntries(
      state.schema.groups.map((g) => [g.id, g.label]),
    ),
    host = byId("groups"),
    draft = await restoreDraft(),
    initialValues = { ...(draft?.values || {}), ...(ReportData.readOnly ? {} : linkedTaskValues()) };
  const revaluation = currentTask()?.reportGroup === "revaluation";
  if (revaluation) {
    Object.assign(initialValues, draft?.values || {});
    document.title = currentTask().reportLabel;
    const title = document.querySelector(".report-shell-title strong, header h1");
    if (title) title.textContent = currentTask().reportLabel;
    for (const field of [...(state.schema.setup_fields || []), ...state.schema.fields]) {
      field.label = RetrospectiveValuation.revaluationLabel(field.label);
    }
  }
  state.preparationMethod = HAS_PREPARATION_CHOICE
    ? (draft?.preparationMethod || (currentTask()?.retrospectiveReady ? "offline" : (currentTask()?.reportGeneratedAt || ReportData.preview()?.id ? "online" : "")))
    : "online";
  state.floorCount = Math.max(1, draft?.floorCount || 1);
  state.documentCount = Math.max(1, draft?.documentCount || 1);
  state.photos = Array.isArray(draft?.photos) ? draft.photos : [];
  state.map = draft?.map || null;
  sectionPlan.forEach((section, index) => {
    let panel;
    if (section.id === "preparation") {
      panel = window.RetrospectiveValuation.preparationPanel("valuation-general", state.preparationMethod, setPreparationMethod);
    } else if (section.id === "offline") {
      panel = window.RetrospectiveValuation.offlinePanel("valuation-general", draft?.uploadType, { uploadTypeChanged: async () => { await persistDraftNow(); markDirty(); } });
    } else {
      panel = document.createElement("div");
      panel.className = "panel";
      panel.dataset.group = section.id;
      panel.innerHTML = `<h2>${section.label}</h2>`;
    }
    if (section.id === "setup") {
      if (revaluation) RetrospectiveValuation.displayRevaluationSource(panel, currentTask());
      addSubgroup(panel, "Property Classification", state.schema.setup_fields.filter((field) => field.id.startsWith("property.")));
      addSubgroup(panel, "Institution Details", state.schema.setup_fields.filter((field) => !field.id.startsWith("property.")));
      addSubgroup(
        panel,
        "Report Details",
        state.schema.fields.filter(
          (f) => groupId(f.group) === "report" && !excluded.has(f.id),
        ),
      );
    } else if (section.id === "media") {
      addMedia(panel);
    } else if (!["preparation", "offline"].includes(section.id))
      section.groups.forEach((g) => {
        if (g === "documents") {
          addDocumentSection(panel);
          return;
        }
        const fields = state.schema.fields.filter(
          (f) =>
            groupId(f.group) === g &&
            !excluded.has(f.id) &&
            !f.id.startsWith("building.floors."),
        );
        addSubgroup(panel, g === "valuation" ? "Value Conclusions" : (labels[g] || title(g)), fields, g);
        if (g === "land") addLandCalculator(panel);
        if (g === "floors") addFloorSection(panel);
      });
    host.append(panel);
    if (section.id === "property") renderDocuments(initialValues);
    if (section.id === "building_floors") renderFloors(initialValues);
    state.sections.push(panel);
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = section.label;
    b.dataset.sectionIndex = index;
    b.onclick = () => show(index);
    byId("nav").append(b);
  });
  const valuationPanel = state.sections[sectionPlan.findIndex((section) => section.id === "valuation")],
    abstractBlock = valuationPanel.querySelector(".subgroup");
  if (abstractBlock) {
    [
      "abstract.land",
      "abstract.building",
      "abstract.total",
      "abstract.present_market_value",
    ].forEach((id) =>
      abstractBlock
        .querySelector(".grid")
        .append(calculatedField(id, title(id.split(".").pop()))),
    );
  }
  const blocks = valuationPanel.querySelectorAll(".subgroup"),
    valBlock = blocks[blocks.length - 1];
  if (valBlock) {
    [
      "valuation.present_market_value",
      "valuation.realizable_value",
      "valuation.distress_value",
    ].forEach((id) =>
      valBlock
        .querySelector(".grid")
        .append(calculatedField(id, title(id.split(".").pop()))),
    );
  }
  calculations = window.ValuationCalculations.create("general", byId("valuation-form"), {
    floorCount: () => state.floorCount || 1,
    beforeReset: confirmReportInvalidation,
    onReset: () => { markDirty(); saveDraft(); },
  });
  if (Object.keys(initialValues).length) {
    const type =
      initialValues["institution.type"] ||
      institutionTypeFor(initialValues["bank.name"]);
    setValues({ ...initialValues, "institution.type": type });
    applyInstitutionOptions();
    setValues(initialValues);
    if (!ReportData.readOnly) {
      Object.entries(linkedTaskValues()).forEach(([id, value]) => {
        if (initialValues[id] === value) FormTabOrder.mark(byId(id));
      });
    }
    renderDocuments(initialValues);
    renderFloors(initialValues);
    if (draft?.values && Object.values(draft.values).some((value) => String(value ?? "").trim()))
      byId("status").textContent = "Draft restored";
  } else applyInstitutionOptions();
  document.querySelectorAll("[data-site-match-group]").forEach((block) => {
    addSiteMatchControl(block, draft?.matchedSiteFields?.[block.dataset.siteMatchGroup]);
  });
  calculations.restore(initialValues);
  addressAutofill = ValuationWriting.installAddress(byId("valuation-form"), "general", draft?.postalAddressMode, {
    beforeEdit: confirmReportInvalidation,
    onEdit: (changesReport) => { if (changesReport) markDirty(); saveDraft(); },
    hasRetainedReport: Boolean(currentTask()?.reportGeneratedAt || ReportData.preview()?.id),
  });
  wireInputs();
  calculateAll();
  applyRules();
  show(0);
  exampleAssistance = ValuationExamples.install(byId("valuation-form"), "general", {
    saved: draft?.exampleFill,
    savedValues: initialValues,
    assignmentFields: new Set(Object.keys(linkedTaskValues())),
    available: () => state.preparationMethod === "online",
    beforeEdit: confirmReportInvalidation,
    updateSections: applyRules,
    afterBulk: (changed) => {
      if (changed.length) {
        if (changed.includes("institution.type")) applyInstitutionOptions();
        changed.forEach((id) => addressAutofill?.changed(id));
        calculateAll();
        applyRules();
        markDirty();
      }
      saveDraft();
    },
  });
  const restoredPreview = ReportData.preview();
  if (restoredPreview?.id) {
    state.previewId = restoredPreview.id;
    state.previewReady = true;
    byId("generate-docx").disabled = false;
    byId("generate-pdf").disabled = false;
    byId("status").textContent = "Latest preview restored";
  }
}
byId("previous").onclick = () => moveSection(-1);
byId("next").onclick = () => moveSection(1);
byId("valuation-form").addEventListener("click", (e) => {
  if (e.target.dataset.format) state.format = e.target.dataset.format;
});
byId("preview-report").onclick = async () => {
  const form = byId("valuation-form");
  if (!validateRequiredFields(form) || state.processing) return;
  const status = byId("status");
  status.textContent = "Building preview…";
  setProcessing(
    true,
    "Creating report preview",
    "Generating the exact Word file, then rendering that file as a PDF preview…",
  );
  const cancel = ReportProcessing.cancellation(byId("processing"));
  try {
    await persistDraftNow();
    const response = await fetch("/api/preview", {
      signal: cancel.signal,
      method: "POST",
      headers: await ReportData.requestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(ReportData.requestPayload(reportPayload())),
    }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Preview failed");
      return data;
    });
    if (cancel.signal.aborted) return;
    byId("preview-frame").src = response.preview;
    byId("preview-modal").hidden = false;
    state.previewId = response.preview_id;
    state.previewReady = true;
    ReportData.setPreview({ id: response.preview_id, url: response.preview });
    status.textContent = "Preview ready";
  } catch (error) {
    if (cancel.signal.aborted) { status.textContent = "Preview cancelled"; return; }
    status.textContent = "Preview failed";
    alert(reportErrorMessage(error, "The preview could not be created. Check your connection and try again."));
  } finally {
    if (cancel.signal.aborted) status.textContent = "Preview cancelled";
    cancel.dispose();
    setProcessing(false);
  }
};
byId("close-preview").onclick = () => {
  byId("preview-modal").hidden = true;
};
byId("preview-modal").onclick = (e) => {
  if (e.target === byId("preview-modal")) byId("preview-modal").hidden = true;
};
byId("valuation-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.previewReady) {
    alert("Please preview the latest report before downloading.");
    return;
  }
  if (state.processing) return;
  const status = byId("status");
  status.textContent = `Generating ${state.format.toUpperCase()}…`;
  setProcessing(
    true,
    `Generating ${state.format.toUpperCase()} report`,
    state.format === "pdf"
      ? "Creating the Word report and converting it to PDF…"
      : "Creating the editable Word report…",
  );
  try {
    await persistDraftNow();
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: await ReportData.requestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(ReportData.requestPayload(reportPayload(state.format))),
    }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Generation failed");
      return data;
    });
    status.textContent = "Generated";
    state.generatedChangeAcknowledged = false;
    window.dispatchEvent(new CustomEvent("sln:report-generated", {
      detail: {
        format: state.format,
        download: response.download,
        filename: response.filename || response.download.split("/").pop(),
        registered: response.registered === true,
        task: response.task || null,
      },
    }));
    location.href = response.download;
  } catch (error) {
    status.textContent = "Generation failed";
    alert(reportErrorMessage(error, "The report could not be generated. Check your connection and try again."));
  } finally {
    setProcessing(false);
  }
});
init();
}
