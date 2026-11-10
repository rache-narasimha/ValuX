/** Agricultural valuation form controller: fields, calculations, drafts, media, preview, and generation. */
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
  preparationMethod: "",
  sectionPlan: [],
  generatedChangeAcknowledged: false,
  processing: false,
};
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const DRAFT_SCOPE = PAGE_PARAMS.get("practice") === "1"
  ? "practice"
  : PAGE_PARAMS.get("task")
    ? `task-${PAGE_PARAMS.get("task")}`
    : "standalone";
const STORAGE_KEY = `agricultural-valuation-draft-v1-${DRAFT_SCOPE}`;
const HAS_PREPARATION_CHOICE = window.RetrospectiveValuation?.supportsChoice("valuation-agricultural") === true;
const {
  applyInstitutionOptions,
  areaFactors,
  areaLabels,
  byId,
  fieldControl: createFieldControl,
  fileData,
  institutionTypeFor,
  installExampleAssistance,
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

// Assignment context and report-specific field helpers.
function linkedTaskValues() {
  const taskId = PAGE_PARAMS.get("task");
  const task = taskId && window.TaskStore ? TaskStore.get(taskId) : null;
  return task ? {
    "institution.type": task.institutionType,
    "bank.name": task.institutionName,
    "bank.branch": task.branch,
    "report.assignment_date": task.assignedDate,
    "property.description": task.propertyBrief,
    "owner.details": task.customerName,
  } : {};
}

function fieldControl(field) {
  return createFieldControl(field, {}, (value) => areaLabels[value] || value);
}

function calculatedField(id, label) {
  const wrap = fieldControl({ id, label, type: "text" });
  wrap.classList.add("calculated");
  return wrap;
}

// Repeatable document controls and form value handling.
function renderDocuments(saved = {}) {
  const host = byId("agricultural-document-list");
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
        required: true,
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
    '<h3>Documents</h3><p class="hint">Use Add in the latest document header to include another document.</p><div id="agricultural-document-list"></div><section class="subgroup"><h4>Sale agreement</h4><div class="grid" id="agricultural-sale-agreement"></div></section>';
  panel.append(block);
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
      if (input.name && input.type !== "file" && !input.dataset.preparationMethod)
        values[input.name] =
          input.type === "checkbox"
            ? input.checked
              ? "Yes"
              : "No"
            : NumericEntry.read(input);
    });
  values[window.ValuationCalculations.overridesKey] = calculations?.serialize() || "{}";
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

let calculations;
function calculateAll(changedId) {
  if (ReportData.readOnly) return;
  calculations?.refresh(changedId);
}

function addCalculatedValues(panel) {
  const block = document.createElement("section");
  block.className = "subgroup";
  block.innerHTML =
    '<h3>Calculated valuation</h3><p class="hint">The total extent is converted into the adopted rate unit before multiplication. Book value equals the estimated market value; distress value is 80%.</p><div class="grid"></div>';
  const grid = block.querySelector(".grid");
  grid.append(
    calculatedField(
      "valuation.converted_extent_display",
      "Converted extent in adopted-rate unit",
    ),
  );
  grid.append(
    calculatedField(
      "valuation.estimated_value_display",
      "Estimated / Present Market Value",
    ),
  );
  grid.append(calculatedField("valuation.book_value_display", "Book Value"));
  grid.append(
    calculatedField("valuation.distress_value_display", "Distress Value (80%)"),
  );
  panel.append(block);
}

// Uploaded-media previews and report request state.
function mediaSection(panel) {
  panel.innerHTML +=
    '<section class="subgroup"><h3>Property photographs</h3><p class="hint">New selections are added to those already shown. Reports use a 3 × 4 media grid with up to 12 items per page. The route map follows the photographs in the next available cell; after an exact batch of 12 photographs it starts the next page. Images retain their full aspect ratio and are never cropped.</p><input id="photo-upload" type="file" accept="image/*" multiple><p class="hint media-save-note">Task-linked photographs are retained with the draft. Practice photographs remain local to this browser.</p><div id="photo-preview" class="preview-grid three-columns"></div></section><section class="subgroup"><h3>Route map</h3><p class="hint">Upload one map screenshot. It follows the photographs in the 12-item media sequence.</p><input id="map-upload" type="file" accept="image/*"><div id="map-preview" class="map-preview"></div></section>';
  panel.querySelector("#photo-upload").onchange = async (event) => {
    if (!confirmReportInvalidation()) {
      event.target.value = "";
      return;
    }
    const added = await Promise.all([...event.target.files].map(fileData));
    const known = new Set(state.photos.map((photo) => photo.key));
    state.photos.push(...added.filter((photo) => !known.has(photo.key)));
    event.target.value = "";
    renderPreviews();
    markDirty();
    saveDraft();
  };
  panel.querySelector("#map-upload").onchange = async (event) => {
    if (!confirmReportInvalidation()) {
      event.target.value = "";
      return;
    }
    state.map = event.target.files[0]
      ? await fileData(event.target.files[0])
      : null;
    event.target.value = "";
    renderPreviews();
    markDirty();
    saveDraft();
  };
}

function renderPreviews() {
  const host = byId("photo-preview");
  if (host) {
    host.classList.remove("one-column");
    host.classList.add("three-columns");
    host.replaceChildren(...state.photos.map((photo, index) => {
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
    host.querySelectorAll("[data-remove-photo]").forEach(
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
  const mapHost = byId("map-preview");
  if (mapHost)
    mapHost.innerHTML = state.map
      ? `<div class="media-preview-item"><img src="${state.map.data}" alt="Route map preview"><button type="button" class="secondary remove-map">Remove map</button></div>`
      : "";
  mapHost?.querySelector(".remove-map")?.addEventListener("click", () => {
    if (!confirmReportInvalidation()) return;
    state.map = null;
    const upload = byId("map-upload");
    if (upload) upload.value = "";
    renderPreviews();
    markDirty();
    saveDraft();
  });
}

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
  applyPreparationMode();
  await persistDraftNow();
  show(state.sectionPlan.findIndex((section) => section.id === (method === "online" ? "property" : "offline")));
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

// Section navigation, local drafts, and input event wiring.
function visibleSectionIndexes() {
  return state.sections.map((panel, index) => panel.hidden ? null : index).filter((index) => index !== null);
}
function updateNavigation() {
  const visible = visibleSectionIndexes();
  const position = visible.indexOf(state.current);
  state.sections.forEach((panel, index) => panel.classList.toggle("active", index === state.current));
  document
    .querySelectorAll("#nav button")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        Number(button.dataset.sectionIndex) === state.current,
      ),
    );
  byId("progress").textContent =
    `Section ${position + 1} of ${visible.length}`;
  byId("previous").disabled = position <= 0;
  byId("next").disabled = position < 0 || position === visible.length - 1;
}
function show(index) {
  const visible = visibleSectionIndexes();
  if (!visible.length) return;
  if (!visible.includes(index)) index = visible.find((item) => item > index) ?? visible[visible.length - 1];
  state.current = index;
  updateNavigation();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function moveSection(offset) {
  const visible = visibleSectionIndexes();
  const position = visible.indexOf(state.current);
  const next = visible[position + offset];
  if (next !== undefined) show(next);
}
function applyPreparationMode() {
  const online = !HAS_PREPARATION_CHOICE || state.preparationMethod === "online";
  if (HAS_PREPARATION_CHOICE) {
    document.body.dataset.valuationPreparation = state.preparationMethod;
    window.dispatchEvent(new CustomEvent("sln:valuation-preparation-changed"));
  }
  state.sectionPlan.forEach((section, index) => {
    const alwaysVisible = section.id === "report" || section.id === "preparation";
    const visible = alwaysVisible || (section.id === "offline" ? state.preparationMethod === "offline" : online);
    state.sections[index].toggleAttribute("hidden", !visible);
    document.querySelectorAll(`[data-section-index="${index}"]`).forEach((button) => button.toggleAttribute("hidden", !visible));
    state.sections[index].querySelectorAll("input,select,textarea,button").forEach((control) => {
      if (!control.dataset.preparationMethod) control.disabled = !visible;
    });
  });
  ["preview-report", "generate-docx", "generate-pdf"].forEach((id) => byId(id).toggleAttribute("hidden", !online));
  if (state.sections[state.current]?.hidden) show(state.sectionPlan.findIndex((section) => section.id === "preparation"));
  else updateNavigation();
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

let saveTimer;
async function persistDraftNow() {
  if (ReportData.readOnly) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const saved = await ReportData.save(STORAGE_KEY, "valuation-agricultural", {
    values: collectValues(),
    preparationMethod: state.preparationMethod,
    uploadType: byId("valuation-upload-type")?.value || "",
    documentCount: state.documentCount,
    photos: state.photos,
    map: state.map,
  }, String(state.schema.version || "2"));
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
function wireInputs() {
  document
    .querySelectorAll(
      "#agricultural-form input,#agricultural-form select,#agricultural-form textarea",
    )
    .forEach((input) => {
      if (input.type === "file" || input.readOnly || input.dataset.preparationMethod || input.dataset.wired)
        return;
      input.dataset.wired = "1";
      input.addEventListener("focus", () => {
        input.dataset.previousValue = input.value;
        input.dataset.previousChecked = String(input.checked);
      });
      if (input.type === "checkbox" || input.type === "radio") {
        input.addEventListener("click", (event) => {
          if (!confirmReportInvalidation()) event.preventDefault();
        });
      } else if (input.tagName !== "SELECT") {
        input.addEventListener("beforeinput", (event) => {
          if (!confirmReportInvalidation()) event.preventDefault();
        });
      }
      const changed = () => {
        if (!confirmReportInvalidation()) {
          input.value = input.dataset.previousValue ?? input.value;
          if (input.type === "checkbox" || input.type === "radio") input.checked = input.dataset.previousChecked === "true";
          return;
        }
        input.dataset.previousValue = input.value;
        input.dataset.previousChecked = String(input.checked);
        if (input.id === "institution.type") applyInstitutionOptions();
        calculateAll(input.id);
        applySaleAgreementRule();
        markDirty();
        saveDraft();
      };
      input.addEventListener("input", changed);
      input.addEventListener("change", changed);
    });
}



// Page assembly and report-generation event wiring.
async function init() {
  state.schema = await fetch("/api/agricultural/schema").then((response) => {
    if (!response.ok)
      throw new Error("Unable to load agricultural form schema");
    return response.json();
  });
  const draft = await restoreDraft();
  const initialValues = { ...(draft?.values || {}), ...(ReportData.readOnly ? {} : linkedTaskValues()) };
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
  state.documentCount = Math.max(1, draft?.documentCount || 1);
  state.photos = Array.isArray(draft?.photos) ? draft.photos : [];
  state.map = draft?.map || null;
  const host = byId("sections");
  state.sectionPlan = HAS_PREPARATION_CHOICE
    ? [state.schema.sections[0], { id: "preparation", label: "Preparation Method" }, ...state.schema.sections.slice(1), { id: "offline", label: "Complete & Upload Report" }]
    : [...state.schema.sections];
  state.sectionPlan.forEach((section, index) => {
    let panel;
    if (section.id === "preparation") {
      panel = window.RetrospectiveValuation.preparationPanel("valuation-agricultural", state.preparationMethod, setPreparationMethod);
    } else if (section.id === "offline") {
      panel = window.RetrospectiveValuation.offlinePanel("valuation-agricultural", draft?.uploadType, { uploadTypeChanged: async () => { await persistDraftNow(); markDirty(); } });
    } else {
      panel = document.createElement("div");
      panel.className = "panel";
      panel.dataset.section = section.id;
      panel.innerHTML = `<h2>${section.label}</h2>`;
    }
    if (revaluation && index === 0) RetrospectiveValuation.displayRevaluationSource(panel, currentTask());
    if (section.id === "media") {
      mediaSection(panel);
    }
    else if (!["preparation", "offline"].includes(section.id)) {
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
  calculations = window.ValuationCalculations.create("agricultural", byId("agricultural-form"), {
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
    renderDocuments(initialValues);
    if (draft?.values && Object.values(draft.values).some((value) => String(value ?? "").trim()))
      byId("status").textContent = "Draft restored";
  } else applyInstitutionOptions();
  calculations.restore(initialValues);
  wireInputs();
  installExampleAssistance(byId("agricultural-form"), "agricultural");
  calculateAll();
  applySaleAgreementRule();
  applyPreparationMode();
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
byId("agricultural-form").addEventListener("click", (event) => {
  if (event.target.dataset.format) state.format = event.target.dataset.format;
});
byId("preview-report").onclick = async () => {
  const form = byId("agricultural-form");
  if (!validateRequiredFields(form) || state.processing) return;
  const status = byId("status");
  status.textContent = "Building preview…";
  setProcessing(
    true,
    "Creating agricultural report preview",
    "Preparing photographs and generating the PDF preview…",
  );
  const cancel = ReportProcessing.cancellation(byId("processing"));
  try {
    await persistDraftNow();
    const response = await fetch("/api/agricultural/preview", {
      signal: cancel.signal,
      method: "POST",
      headers: await ReportData.requestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(ReportData.requestPayload(reportPayload())),
    }).then(async (result) => {
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "Preview failed");
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
    await persistDraftNow();
    const response = await fetch("/api/agricultural/generate", {
      method: "POST",
      headers: await ReportData.requestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(ReportData.requestPayload(reportPayload(state.format))),
    }).then(async (result) => {
      const data = await result.json();
      if (!result.ok) throw new Error(data.error || "Generation failed");
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

init().catch((error) => {
  byId("status").textContent = "Unable to load";
  alert(reportErrorMessage(error, "The agricultural form could not be loaded. Refresh the page and try again."));
});
