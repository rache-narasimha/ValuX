const state = {
  schema: null,
  sections: [],
  current: 0,
  format: "docx",
  photos: [],
  map: null,
  documentCount: 1,
  previewReady: false,
  previewId: null,
  processing: false,
};
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const DRAFT_SCOPE = PAGE_PARAMS.get("practice") === "1"
  ? "practice"
  : PAGE_PARAMS.get("task")
    ? `task-${PAGE_PARAMS.get("task")}`
    : "standalone";
const STORAGE_KEY = `agricultural-valuation-draft-v1-${DRAFT_SCOPE}`;
const {
  applyInstitutionOptions,
  areaFactors,
  areaLabels,
  byId,
  fieldControl: createFieldControl,
  fileData,
  institutionTypeFor,
  money,
  numeric,
  title,
} = window.ValuationUI;

function linkedTaskValues() {
  const taskId = PAGE_PARAMS.get("task");
  const task = taskId && window.TaskStore ? TaskStore.get(taskId) : null;
  return task ? {
    "institution.type": task.institutionType,
    "bank.name": task.institutionName,
    "bank.branch": task.branch,
    "report.assignment_date": task.assignedDate,
  } : {};
}

function fieldControl(field) {
  return createFieldControl(field, {}, (value) => areaLabels[value] || value);
}

function readonlyField(id, label) {
  const wrap = fieldControl({ id, label, type: "text" });
  wrap.classList.add("calculated");
  wrap.querySelector("input").readOnly = true;
  return wrap;
}

function renderDocuments(saved = {}) {
  const host = byId("agricultural-document-list");
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
        options: ["Sale Deed", "LSR", "Other Documents", "Custom"],
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
  state.documentCount++;
  renderDocuments();
  wireInputs();
  markDirty();
  saveDraft();
}
function removeDocument(index) {
  if (index === 1) return;
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
    '<h3>Documents</h3><p class="hint">One document is shown by default. Add as many document rows as required.</p><div id="agricultural-document-list"></div><button type="button" class="secondary" id="add-agricultural-document">Add another document</button><section class="subgroup"><h4>Sale agreement</h4><div class="grid" id="agricultural-sale-agreement"></div></section>';
  panel.append(block);
  block.querySelector("#add-agricultural-document").onclick = addDocument;
  const sale = block.querySelector("#agricultural-sale-agreement");
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

function collectValues() {
  const values = {};
  document
    .querySelectorAll(
      "#agricultural-form input,#agricultural-form select,#agricultural-form textarea",
    )
    .forEach((input) => {
      if (input.name && input.type !== "file")
        values[input.name] =
          input.type === "checkbox"
            ? input.checked
              ? "Yes"
              : "No"
            : input.value;
    });
  return values;
}

function setValues(values) {
  Object.entries(values || {}).forEach(([id, value]) => {
    const input = byId(id);
    if (!input || input.readOnly) return;
    if (input.type === "checkbox")
      input.checked = String(value).toLowerCase() === "yes" || value === true;
    else input.value = value ?? "";
  });
}

function applySaleAgreementRule() {
  const show = byId("sale_agreement.used")?.checked === true;
  document
    .querySelector('[data-field="sale_agreement.details"]')
    ?.toggleAttribute("hidden", !show);
  document
    .querySelector('[data-field="sale_agreement.value"]')
    ?.toggleAttribute("hidden", !show);
}

function calculateAll() {
  const extent = numeric(byId("valuation.total_extent_value")?.value);
  const extentUnit = byId("valuation.extent_unit")?.value;
  const rate = numeric(byId("valuation.adopted_rate_value")?.value);
  const rateUnit = byId("valuation.adopted_rate_unit")?.value;
  const ready = extent > 0 && rate > 0 && extentUnit && rateUnit;
  const converted = ready
    ? (extent * areaFactors[extentUnit]) / areaFactors[rateUnit]
    : 0;
  const estimated = converted * rate;
  if (byId("valuation.converted_extent_display"))
    byId("valuation.converted_extent_display").value = ready
      ? `${converted.toFixed(4).replace(/\.?0+$/, "")} ${areaLabels[rateUnit]}`
      : "";
  if (byId("valuation.estimated_value_display"))
    byId("valuation.estimated_value_display").value = ready
      ? money(estimated)
      : "";
  if (byId("valuation.book_value_display"))
    byId("valuation.book_value_display").value = ready ? money(estimated) : "";
  if (byId("valuation.distress_value_display"))
    byId("valuation.distress_value_display").value = ready
      ? money(estimated * 0.8)
      : "";
}

function addCalculatedValues(panel) {
  const block = document.createElement("section");
  block.className = "subgroup";
  block.innerHTML =
    '<h3>Calculated valuation</h3><p class="hint">The total extent is converted into the adopted rate unit before multiplication. Book value equals the estimated market value; distress value is 80%.</p><div class="grid"></div>';
  const grid = block.querySelector(".grid");
  grid.append(
    readonlyField(
      "valuation.converted_extent_display",
      "Converted extent in adopted-rate unit",
    ),
  );
  grid.append(
    readonlyField(
      "valuation.estimated_value_display",
      "Estimated / present market value",
    ),
  );
  grid.append(readonlyField("valuation.book_value_display", "Book value"));
  grid.append(
    readonlyField("valuation.distress_value_display", "Distress value (80%)"),
  );
  panel.append(block);
}

function mediaSection(panel) {
  panel.innerHTML +=
    '<section class="subgroup"><h3>Property photographs</h3><p class="hint">New selections are added to the photographs already shown. The report uses one photo per row for 1–4 photos, two per row for 5–6, and three per row for 7–9. More than nine continues on the next page. Every image is rotated from its camera metadata, scaled proportionally and never cropped.</p><input id="photo-upload" type="file" accept="image/*" multiple><p class="hint media-save-note">Photographs are kept for this browser session but are not stored in the local draft after a page refresh.</p><div id="photo-preview" class="preview-grid"></div></section><section class="subgroup"><h3>Route map</h3><p class="hint">Upload one map screenshot. It is placed on its own page after the photographs.</p><input id="map-upload" type="file" accept="image/*"><div id="map-preview" class="map-preview"></div></section>';
  panel.querySelector("#photo-upload").onchange = async (event) => {
    const added = await Promise.all([...event.target.files].map(fileData));
    const known = new Set(state.photos.map((photo) => photo.key));
    state.photos.push(...added.filter((photo) => !known.has(photo.key)));
    event.target.value = "";
    renderPreviews();
    markDirty();
  };
  panel.querySelector("#map-upload").onchange = async (event) => {
    state.map = event.target.files[0]
      ? await fileData(event.target.files[0])
      : null;
    event.target.value = "";
    renderPreviews();
    markDirty();
  };
}

function renderPreviews() {
  const host = byId("photo-preview");
  if (host) {
    const currentPageCount = Math.min(state.photos.length, 9);
    host.classList.toggle("one-column", currentPageCount <= 4);
    host.classList.toggle("three-columns", currentPageCount >= 7);
    host.innerHTML = state.photos
      .map(
        (photo, index) =>
          `<div class="photo-tile"><img src="${photo.data}" alt="${photo.name}"><button type="button" data-remove-photo="${index}" aria-label="Remove ${photo.name}">Remove</button></div>`,
      )
      .join("");
    host.querySelectorAll("[data-remove-photo]").forEach(
      (button) =>
        (button.onclick = () => {
          state.photos.splice(Number(button.dataset.removePhoto), 1);
          renderPreviews();
          markDirty();
        }),
    );
  }
  const mapHost = byId("map-preview");
  if (mapHost)
    mapHost.innerHTML = state.map
      ? `<img src="${state.map.data}" alt="Route map preview">`
      : "";
}

function markDirty() {
  state.previewReady = false;
  state.previewId = null;
  byId("generate-docx").disabled = true;
  byId("generate-pdf").disabled = true;
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
function setProcessing(active, titleText = "", stage = "") {
  state.processing = active;
  byId("processing").hidden = !active;
  byId("processing-title").textContent = titleText || "Processing report";
  byId("processing-stage").textContent = stage || "Please wait…";
  byId("preview-report").disabled = active;
  byId("generate-docx").disabled = active || !state.previewReady;
  byId("generate-pdf").disabled = active || !state.previewReady;
  byId("agricultural-form").setAttribute("aria-busy", String(active));
}

function updateNavigation() {
  state.sections.forEach((panel, index) =>
    panel.classList.toggle("active", index === state.current),
  );
  document
    .querySelectorAll("#nav button")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        Number(button.dataset.sectionIndex) === state.current,
      ),
    );
  byId("progress").textContent =
    `Section ${state.current + 1} of ${state.sections.length}`;
  byId("previous").disabled = state.current === 0;
  byId("next").disabled = state.current === state.sections.length - 1;
}
function show(index) {
  state.current = Math.max(0, Math.min(index, state.sections.length - 1));
  updateNavigation();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

let saveTimer;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        values: collectValues(),
        documentCount: state.documentCount,
      }),
    );
    byId("status").textContent = "Saved locally";
  }, 250);
}
function restoreDraft() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}
function wireInputs() {
  document
    .querySelectorAll(
      "#agricultural-form input,#agricultural-form select,#agricultural-form textarea",
    )
    .forEach((input) => {
      if (input.type === "file" || input.readOnly || input.dataset.wired)
        return;
      input.dataset.wired = "1";
      const changed = () => {
        if (input.id === "institution.type") applyInstitutionOptions();
        calculateAll();
        applySaleAgreementRule();
        markDirty();
        saveDraft();
      };
      input.addEventListener("input", changed);
      input.addEventListener("change", changed);
    });
}

async function init() {
  state.schema = await fetch("/api/agricultural/schema").then((response) => {
    if (!response.ok)
      throw new Error("Unable to load agricultural form schema");
    return response.json();
  });
  const draft = restoreDraft();
  const initialValues = { ...(draft?.values || {}), ...linkedTaskValues() };
  state.documentCount = Math.max(1, draft?.documentCount || 1);
  const host = byId("sections");
  state.schema.sections.forEach((section, index) => {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.dataset.section = section.id;
    panel.innerHTML = `<h2>${section.label}</h2>`;
    if (section.id === "media") mediaSection(panel);
    else {
      if (section.id === "property") addDocumentSection(panel);
      const fields = state.schema.fields.filter(
        (field) => field.section === section.id,
      );
      const groups = [...new Set(fields.map((field) => field.group))];
      groups.forEach((group) => {
        const block = document.createElement("section");
        block.className = "subgroup";
        block.innerHTML = `<h3>${group}</h3><div class="grid"></div>`;
        fields
          .filter((field) => field.group === group)
          .forEach((field) =>
            block.querySelector(".grid").append(fieldControl(field)),
          );
        panel.append(block);
      });
      if (section.id === "valuation") addCalculatedValues(panel);
    }
    host.append(panel);
    if (section.id === "property") renderDocuments(initialValues);
    state.sections.push(panel);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = section.label;
    button.dataset.sectionIndex = index;
    button.onclick = () => show(index);
    byId("nav").append(button);
  });
  if (Object.keys(initialValues).length) {
    const type =
      initialValues["institution.type"] ||
      institutionTypeFor(initialValues["bank.name"]);
    setValues({ ...initialValues, "institution.type": type });
    applyInstitutionOptions();
    setValues(initialValues);
    renderDocuments(initialValues);
    if (draft?.values && Object.values(draft.values).some((value) => String(value ?? "").trim()))
      byId("status").textContent = "Draft restored";
  } else applyInstitutionOptions();
  wireInputs();
  calculateAll();
  applySaleAgreementRule();
  show(0);
}

byId("previous").onclick = () => show(state.current - 1);
byId("next").onclick = () => show(state.current + 1);
byId("agricultural-form").addEventListener("click", (event) => {
  if (event.target.dataset.format) state.format = event.target.dataset.format;
});
byId("preview-report").onclick = async () => {
  const form = byId("agricultural-form");
  if (!form.reportValidity() || state.processing) return;
  const status = byId("status");
  status.textContent = "Building preview…";
  setProcessing(
    true,
    "Creating agricultural report preview",
    "Preparing photographs and generating the PDF preview…",
  );
  try {
    const response = await fetch("/api/agricultural/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportPayload()),
    }).then(async (result) => {
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "Preview failed");
      return data;
    });
    byId("preview-frame").src = response.preview;
    byId("preview-modal").hidden = false;
    state.previewId = response.preview_id;
    state.previewReady = true;
    status.textContent = "Preview ready";
  } catch (error) {
    status.textContent = "Preview failed";
    alert(error.message);
  } finally {
    setProcessing(false);
  }
};
byId("close-preview").onclick = () => {
  byId("preview-modal").hidden = true;
};
byId("preview-modal").onclick = (event) => {
  if (event.target === byId("preview-modal"))
    byId("preview-modal").hidden = true;
};
byId("agricultural-form").addEventListener("submit", async (event) => {
  event.preventDefault();
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
    const response = await fetch("/api/agricultural/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reportPayload(state.format)),
    }).then(async (result) => {
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "Generation failed");
      return data;
    });
    status.textContent = "Generated";
    window.dispatchEvent(new CustomEvent("sln:report-generated", {
      detail: {
        format: state.format,
        download: response.download,
        filename: response.download.split("/").pop(),
      },
    }));
    location.href = response.download;
  } catch (error) {
    status.textContent = "Generation failed";
    alert(error.message);
  } finally {
    setProcessing(false);
  }
});

init().catch((error) => {
  byId("status").textContent = "Unable to load";
  alert(error.message);
});
