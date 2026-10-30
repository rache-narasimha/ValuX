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
  previewReady: false,
  previewId: null,
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
  } : {};
}
const sectionPlan = [
  { id: "setup", label: "Report Setup", groups: ["report"] },
  {
    id: "property",
    label: "Documents, Applicant & Property",
    groups: ["documents", "parties", "property"],
  },
  {
    id: "site_land",
    label: "Site & Land",
    groups: ["boundaries", "dimensions", "site", "land"],
  },
  {
    id: "building_floors",
    label: "Building, Construction & Floors",
    groups: ["building", "construction", "floors"],
  },
  {
    id: "extras",
    label: "Extra Items & Services",
    groups: ["extra_items", "amenities", "miscellaneous", "services"],
  },
  {
    id: "valuation",
    label: "Valuation Abstract & Valuation",
    groups: ["valuation_abstract", "valuation"],
  },
  { id: "media", label: "Photos, Map & Generate", groups: [] },
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
  return fieldControl({ id, label, type }, { [id]: value });
}
function readonlyField(id, label) {
  const f = customField(id, label);
  f.classList.add("calculated");
  f.querySelector("input").readOnly = true;
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
    card.innerHTML = `<div class="document-head"><h4>Document ${index}</h4>${index > 1 ? `<button type="button" class="remove-document" data-remove-document="${index}">Remove</button>` : ""}</div><div class="grid"></div>`;
    const grid = card.querySelector(".grid");
    const typeId = `documents.${index}.type`,
      customId = `documents.${index}.custom_type`,
      detailsId = `documents.${index}.details`;
    grid.append(
      fieldControl({
        id: typeId,
        label: "Document type",
        type: "select",
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
      }),
    );
    host.append(card);
    byId(typeId).value = existing[typeId] || "";
    byId(customId).value = existing[customId] || "";
    byId(detailsId).value = existing[detailsId] || "";
    custom.hidden = byId(typeId).value !== "Custom";
    byId(typeId).addEventListener("change", () => {
      custom.hidden = byId(typeId).value !== "Custom";
      if (!custom.hidden) byId(customId).focus();
    });
  }
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
    '<h3>Documents</h3><p class="hint">One document is shown by default. Add as many document rows as required.</p><div id="general-document-list"></div><button type="button" class="secondary" id="add-general-document">Add another document</button><section class="subgroup"><h4>Sale agreement</h4><div class="grid" id="general-sale-agreement"></div></section>';
  panel.append(block);
  block.querySelector("#add-general-document").onclick = addDocument;
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
function addSubgroup(panel, label, fields) {
  if (!fields.length) return;
  const block = document.createElement("section");
  block.className = "subgroup";
  block.innerHTML = `<h3>${label}</h3><div class="grid"></div>`;
  fields.forEach((f) =>
    block.querySelector(".grid").append(fieldControl(f, state.schema.defaults)),
  );
  panel.append(block);
}
function addLandCalculator(panel) {
  const block = document.createElement("section");
  block.className = "subgroup";
  block.innerHTML =
    '<h3>Land calculation</h3><p class="hint">The extent is converted into the selected rate unit before multiplication.</p><div class="grid"></div>';
  const grid = block.querySelector(".grid");
  grid.append(
    customField("land.extent_value", "Extent considered for valuation"),
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
    readonlyField("land.converted_extent", "Converted extent in rate unit"),
  );
  grid.append(
    readonlyField("land.estimated_value_display", "Estimated land value"),
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
      if (!i.name || i.type === "file") return;
      values[i.name] =
        i.type === "checkbox" ? (i.checked ? "Yes" : "No") : i.value;
    });
  return values;
}
function addFloor() {
  if (!confirmReportInvalidation()) return;
  state.floorCount++;
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
      grid.append(customField(id, f.label, "text", existing[id] ?? ""));
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
        grid.append(readonlyField(`building.floors.${i}.${key}`, title(key))),
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
    '<section class="subgroup"><h3>Property photographs</h3><p class="hint">Each page uses one photo per row for 1–4 photos, two per row for 5–6, and three per row for 7–9. Additional photos continue on a new page. Photos are scaled proportionally and never cropped.</p><input id="photo-upload" type="file" accept="image/*" multiple><div id="photo-preview" class="preview-grid"></div></section><section class="subgroup"><h3>Location map</h3><p class="hint">Upload one map screenshot. It will be placed after the photograph pages.</p><input id="map-upload" type="file" accept="image/*"><div id="map-preview" class="map-preview"></div></section>';
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
    const pageCount = Math.min(state.photos.length, 9);
    p.classList.toggle("one-column", pageCount <= 4);
    p.classList.toggle("three-columns", pageCount >= 7);
    p.innerHTML = state.photos
      .map(
        (photo, index) =>
          `<div class="photo-tile"><img src="${photo.data}" alt="${photo.name}"><button type="button" data-remove-photo="${index}" aria-label="Remove ${photo.name}">Remove</button></div>`,
      )
      .join("");
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
function confirmReportInvalidation() {
  const task = currentTask();
  if (!task?.reportGeneratedAt || task.reportFresh === false || state.generatedChangeAcknowledged) return true;
  const accepted = window.confirm("Changing report details will make the retained report outdated. Continue and regenerate the report before completing this task?");
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
  const message = "Complete the highlighted required field before previewing the report.";
  byId("status").textContent = message;
  if (invalid) {
    const panel = invalid.closest(".panel");
    const index = state.sections.indexOf(panel);
    if (index >= 0) show(index);
    invalid.classList.add("validation-target");
    invalid.addEventListener("input", () => invalid.classList.remove("validation-target"), { once: true });
    window.setTimeout(() => {
      invalid.focus({ preventScroll: true });
      invalid.scrollIntoView({ behavior: "smooth", block: "center" });
      invalid.reportValidity();
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
    else input.value = input.type === "date" ? isoDate(value) : value;
  });
}
function calculateAll() {
  const extent = numeric(byId("land.extent_value")?.value),
    from = byId("land.extent_unit")?.value,
    to = byId("land.rate_unit")?.value,
    rate = numeric(byId("land.adopted_rate_value")?.value),
    converted = from && to ? (extent * areaFactors[from]) / areaFactors[to] : 0,
    land = converted * rate;
  if (byId("land.converted_extent"))
    byId("land.converted_extent").value = converted
      ? converted.toFixed(4).replace(/\.?0+$/, "")
      : "";
  if (byId("land.estimated_value_display"))
    byId("land.estimated_value_display").value = land ? money(land) : "";
  let building = 0;
  for (let i = 1; i <= state.floorCount; i++) {
    const p = `building.floors.${i}.`,
      area = numeric(byId(p + "plinth_area")?.value),
      rr = numeric(byId(p + "replacement_rate")?.value),
      age = Math.max(0, numeric(byId(p + "age")?.value)),
      type = byId(p + "structure_type")?.value || "",
      life = { rcc: 60, industrial: 35, temporary: 20 }[type] || 0,
      ready = area > 0 && rr > 0 && life > 0,
      replacement = ready ? area * rr : 0,
      depreciation = ready
        ? ((replacement * Math.min(age, life)) / life) * 0.9
        : 0,
      net = ready ? Math.max(0, replacement - depreciation) : 0;
    byId(p + "total_life").value = life || "";
    byId(p + "replacement_cost").value = ready ? money(replacement) : "";
    byId(p + "depreciation").value = ready ? money(depreciation) : "";
    byId(p + "net_value").value = ready ? money(net) : "";
    building += net;
  }
  const component = (id) => numeric(byId(id)?.value),
    total =
      land +
      building +
      component("abstract.extra") +
      component("abstract.amenities") +
      component("abstract.miscellaneous") +
      component("abstract.services") +
      component("abstract.machinery");
  const assignments = {
    "abstract.land": land,
    "abstract.building": building,
    "abstract.total": total,
    "abstract.present_market_value": total,
    "valuation.present_market_value": total,
    "valuation.realizable_value": total * 0.9,
    "valuation.distress_value": total * 0.8,
  };
  Object.entries(assignments).forEach(([id, v]) => {
    if (byId(id)) byId(id).value = v > 0 ? money(v) : "";
  });
}
let saveTimer;
async function persistDraftNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const saved = await ReportData.save(STORAGE_KEY, "valuation-general", {
    values: collectValues(),
    floorCount: state.floorCount,
    documentCount: state.documentCount,
    photos: state.photos,
    map: state.map,
  }, "3");
  state.photos = Array.isArray(saved.photos) ? saved.photos : [];
  state.map = saved.map || null;
  renderPreviews();
  byId("status").textContent = ReportData.localOnly ? "Saved locally" : "Saved";
  byId("status").classList.remove("is-saving");
  byId("status").removeAttribute("aria-label");
  if (state.generatedChangeAcknowledged && ReportData.taskCode) await ReportData.refreshTask();
}
function saveDraft() {
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
  state.sections[index].toggleAttribute("hidden", !hasBuilding);
  document
    .querySelectorAll(`[data-section-index="${index}"]`)
    .forEach((x) => x.toggleAttribute("hidden", !hasBuilding));
  const showSale = byId("sale_agreement.used")?.checked === true;
  document
    .querySelector('[data-field="sale_agreement.details"]')
    ?.toggleAttribute("hidden", !showSale);
  document
    .querySelector('[data-field="sale_agreement.value"]')
    ?.toggleAttribute("hidden", !showSale);
  if (state.current === index && !hasBuilding) show(index + 1);
  else updateSectionNavigation();
}
function wireInputs() {
  document
    .querySelectorAll(
      "#valuation-form input,#valuation-form select,#valuation-form textarea",
    )
    .forEach((i) => {
      if (i.type === "file" || i.dataset.wired) return;
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
        calculateAll();
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
        calculateAll();
        applyRules();
        markDirty();
        saveDraft();
      });
    });
}

// Page assembly and report-generation event wiring.
async function init() {
  state.schema = await fetch("/api/schema").then((r) => r.json());
  const labels = Object.fromEntries(
      state.schema.groups.map((g) => [g.id, g.label]),
    ),
    host = byId("groups"),
    draft = await restoreDraft(),
    initialValues = { ...(draft?.values || {}), ...linkedTaskValues() };
  state.floorCount = Math.max(1, draft?.floorCount || 1);
  state.documentCount = Math.max(1, draft?.documentCount || 1);
  state.photos = Array.isArray(draft?.photos) ? draft.photos : [];
  state.map = draft?.map || null;
  sectionPlan.forEach((section, index) => {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.dataset.group = section.id;
    panel.innerHTML = `<h2>${section.label}</h2>`;
    if (section.id === "setup") {
      addSubgroup(panel, "Report setup", state.schema.setup_fields);
      addSubgroup(
        panel,
        "Report details",
        state.schema.fields.filter(
          (f) => groupId(f.group) === "report" && !excluded.has(f.id),
        ),
      );
    } else if (section.id === "media") addMedia(panel);
    else
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
        addSubgroup(panel, labels[g] || title(g), fields);
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
  const valuationPanel = state.sections[5],
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
        .append(readonlyField(id, title(id.split(".").pop()))),
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
        .append(readonlyField(id, title(id.split(".").pop()))),
    );
  }
  if (Object.keys(initialValues).length) {
    const type =
      initialValues["institution.type"] ||
      institutionTypeFor(initialValues["bank.name"]);
    setValues({ ...initialValues, "institution.type": type });
    applyInstitutionOptions();
    setValues(initialValues);
    renderDocuments(initialValues);
    renderFloors(initialValues);
    if (draft?.values && Object.values(draft.values).some((value) => String(value ?? "").trim()))
      byId("status").textContent = "Draft restored";
  } else applyInstitutionOptions();
  wireInputs();
  calculateAll();
  applyRules();
  show(0);
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
  try {
    await persistDraftNow();
    const response = await fetch("/api/preview", {
      method: "POST",
      headers: await ReportData.requestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(ReportData.requestPayload(reportPayload())),
    }).then(async (r) => {
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Preview failed");
      return data;
    });
    byId("preview-frame").src = response.preview;
    byId("preview-modal").hidden = false;
    state.previewId = response.preview_id;
    state.previewReady = true;
    ReportData.setPreview({ id: response.preview_id, url: response.preview });
    status.textContent = "Preview ready";
  } catch (error) {
    status.textContent = "Preview failed";
    alert(reportErrorMessage(error, "The preview could not be created. Check your connection and try again."));
  } finally {
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
