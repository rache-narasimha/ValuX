/** Estimation report form controller and task-scoped draft workflow. */
(async function () {
  "use strict";

  const { PROPERTY_TYPES, FLOOR_OPTIONS, BUILDING_CONFIGURATIONS, ESTIMATION_WORKSHEETS } = window.EstimationSchema;
  const params = new URLSearchParams(window.location.search);
  const draftScope = params.get("practice") === "1" ? "practice" : params.get("task") ? `task-${params.get("task")}` : "standalone";
  const DRAFT_KEY = `sln.estimation.form.draft.v3-${draftScope}`;
  const TODAY = localToday();
  const state = { propertyType: "", construction: "", subtype: "", current: 0, details: {}, components: [], editingComponentId: null };
  const offlineEntry = window.EstimationOffline.create({ state, currentTask, setupComplete: reportSetupComplete, persist: persistDraftNow, save: () => scheduleSave({ reportDirty: false }), render: () => renderAll({sectionKey: "offline"}), dirty: markReportDirty, downloadTemplate: async () => {
    if (!propertyConfigurationComplete() || !state.components.length) { state.details.templateSetup = true; renderAll({sectionKey: "configuration"}); return; }
    await downloadWorkbook("offline");
    if (ReportData.taskCode) await TaskStore.refresh(ReportData.taskCode);
  }});
  let saveTimer = null;
  let generatedChangeAcknowledged = false;

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function currentTask() { return ReportData.taskCode && window.TaskStore ? TaskStore.get(ReportData.taskCode) : null; }

  function confirmReportInvalidation(message = "Changing estimation details will make the retained estimation report outdated. Continue and prepare a new report before completing this task?") {
    const task = currentTask();
    const hasCurrentReport = Boolean(task?.reportGeneratedAt || state.details.finalReport);
    if (!hasCurrentReport || task?.reportFresh === false || generatedChangeAcknowledged) return true;
    const accepted = window.confirm(message);
    if (accepted) generatedChangeAcknowledged = true;
    return accepted;
  }

  function markReportDirty() {
    const hadCurrentReport = Boolean(currentTask()?.reportGeneratedAt || state.details.finalReport);
    state.details.finalReport = null;
    state.details.offlineWorkbook = null;
    ReportData.setPreview(null);
    if (hadCurrentReport) window.dispatchEvent(new CustomEvent("sln:report-dirty"));
  }

  function localToday() {
    return ValuxTime.today();
  }

  function propertyProfile() { return PROPERTY_TYPES[state.propertyType] || null; }
  function componentDefinition(kind) { return propertyProfile()?.components.find((component) => component.kind === kind) || null; }
  function floorDefinition(key) { return FLOOR_OPTIONS.find((floor) => floor.key === key) || null; }
  function buildingConfiguration(key) { return BUILDING_CONFIGURATIONS.find((configuration) => configuration.key === key) || BUILDING_CONFIGURATIONS[0]; }
  function newFloor(key) { const floor = floorDefinition(key); return floor ? { key: floor.key, label: floor.label, level: floor.level } : null; }

  function upperFloor(index) {
    const known = FLOOR_OPTIONS.find((floor) => floor.level === index + 1);
    return known ? newFloor(known.key) : { key: `upper_${index}`, label: `Floor ${index + 1}`, level: index + 1 };
  }

  function configuredFloors(configuration) {
    const base = buildingConfiguration(configuration.baseKey);
    const upperCount = Math.max(0, Number(configuration.upperFloorCount) || 0);
    return [...base.floorKeys.map(newFloor).filter(Boolean), ...Array.from({ length: upperCount }, (_, index) => upperFloor(index + 1))];
  }

  function typicalFloorShortLabel(floor) {
    const labels = { ground: "GF", first: "FF", second: "SF", third: "3F", fourth: "4F", fifth: "5F", sixth: "6F", seventh: "7F", eighth: "8F", ninth: "9F", tenth: "10F" };
    return labels[floor.key] || floor.label;
  }

  function validTypicalFloorKeys(configuration, available = configuredFloors(configuration)) {
    const availableKeys = new Set(available.filter((floor) => floor.level >= 1).map((floor) => floor.key));
    const requested = Array.isArray(configuration.typicalFloorKeys) ? configuration.typicalFloorKeys : [];
    return [...new Set(requested.filter((key) => availableKeys.has(key)))];
  }

  function typicalFloorLabel(floors) {
    const labels = floors.map(typicalFloorShortLabel);
    return `Typical ${labels.length > 2 ? `${labels.slice(0, -1).join(", ")} & ${labels.at(-1)}` : labels.join(" & ")}`;
  }

  function sheetPlan(configuration) {
    const floors = configuredFloors(configuration);
    const typicalKeys = validTypicalFloorKeys(configuration, floors);
    if (typicalKeys.length < 2) return floors;
    const typicalFloors = floors.filter((floor) => typicalKeys.includes(floor.key));
    const primary = typicalFloors[0];
    return floors.flatMap((floor) => {
      if (!typicalKeys.includes(floor.key)) return [floor];
      if (floor.key !== primary.key) return [];
      return [{ ...floor, label: typicalFloorLabel(typicalFloors), typicalFloorKeys: typicalFloors.map((entry) => entry.key) }];
    });
  }

  function makeSheetState(floor, existing = null) {
    return {
      ...(existing || {}),
      id: existing?.id || uid(),
      key: floor.key,
      label: floor.label,
      level: floor.level,
      typicalFloorKeys: floor.typicalFloorKeys || [],
      formData: existing?.formData || {},
    };
  }

  function configurationLabel(configuration) {
    const base = buildingConfiguration(configuration.baseKey).label;
    const count = Number(configuration.upperFloorCount) || 0;
    const floors = configuredFloors(configuration);
    const typicalKeys = validTypicalFloorKeys(configuration, floors);
    const typical = typicalKeys.length >= 2 ? ` · ${typicalFloorLabel(floors.filter((floor) => typicalKeys.includes(floor.key)))}` : "";
    return `${count ? `${base} + ${count} upper floor${count === 1 ? "" : "s"}` : base}${typical}`;
  }

  function componentSheets(component) {
    if (!component.sheets?.length) return [component.name];
    return component.sheets.slice().sort((left, right) => left.level - right.level).map((sheet) => `${component.name} - ${sheet.label}`);
  }

  function allWorksheetNames() { return state.components.flatMap(componentSheets); }

  function residentialUsesCompactAbstract() {
    if (state.propertyType !== "residential") return false;
    const sheets = state.components.flatMap((component) => component.sheets || []);
    return sheets.length > 0 && sheets.every((sheet) => sheet.level <= 3);
  }

  function requiresSeparateAbstract() { return state.propertyType !== "residential" || !residentialUsesCompactAbstract(); }

  function normaliseComponent(component) {
    const definition = componentDefinition(component.kind);
    if (!definition || definition.floorMode !== "building") {
      return { ...component, sheets: Array.isArray(component.sheets) ? component.sheets : [], formData: component.formData || {} };
    }
    const oldFloors = Array.isArray(component.floors) ? component.floors : [];
    const oldKeys = new Set(oldFloors.map((floor) => floor.key));
    const inferredBase = oldKeys.has("cellar") && oldKeys.has("stilt") ? "cellar_stilt_ground"
      : oldKeys.has("cellar") ? "cellar_ground"
        : oldKeys.has("stilt") ? "stilt_ground"
          : "ground";
    const inferredUpperFloors = oldFloors.filter((floor) => Number(floor.level) > 1).length;
    const buildingConfig = {
      baseKey: buildingConfiguration(component.buildingConfig?.baseKey || inferredBase).key,
      upperFloorCount: Math.max(0, Number(component.buildingConfig?.upperFloorCount ?? inferredUpperFloors) || 0),
      typicalFloorKeys: Array.isArray(component.buildingConfig?.typicalFloorKeys) ? component.buildingConfig.typicalFloorKeys : [],
    };
    const existing = new Map((component.sheets || []).map((sheet) => [sheet.key, sheet]));
    const sheets = sheetPlan(buildingConfig).map((floor) => makeSheetState(floor, existing.get(floor.key)));
    return { ...component, buildingConfig, sheets };
  }

  function inputField(id, label, value = "", options = {}) {
    const attributes = [options.required ? "required" : "", options.max ? `max="${escapeHtml(options.max)}"` : "", options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ""].filter(Boolean).join(" ");
    const control = options.textarea
      ? `<textarea id="${id}" data-detail="${escapeHtml(options.key || id)}" ${attributes}>${escapeHtml(value)}</textarea>`
      : `<input id="${id}" data-detail="${escapeHtml(options.key || id)}" type="${options.type || "text"}" value="${escapeHtml(value)}" ${attributes}>`;
    return `<div class="field ${options.full ? "full" : ""}"><label class="${options.required ? "required" : ""}" for="${id}">${escapeHtml(label)}</label>${control}${options.help ? `<small class="field-help">${escapeHtml(options.help)}</small>` : ""}<small class="field-error" id="${id}-error" hidden></small></div>`;
  }

  function setupPanel() {
    return `<div class="panel" data-key="setup"><h2>Report Setup</h2><section class="subgroup"><h3>Report details</h3><div class="grid">
      ${inputField("estimate-date", "Date of Estimation", state.details.estimateDate, { type: "date", required: true, key: "estimateDate" })}
      ${inputField("place", "Place", state.details.place, { required: true, key: "place" })}
      ${currentTask() ? `<div class="field"><label>Applicant</label><p>${escapeHtml(currentTask().customerName)}</p></div>` : inputField("applicant-name", "Applicant name", state.details.applicantName, { required: true, key: "applicantName" })}
      ${inputField("project-location", "Project / property location", state.details.projectLocation, { full: true, required: true, key: "projectLocation" })}
      ${inputField("work-description", "Name of the work", state.details.workDescription, { textarea: true, full: true, required: true, key: "workDescription" })}
    </div></section><section class="notice"><strong>Next:</strong> choose Preparation Method. Online entry and an optional workbook template use Property Configuration and Component Selection; retrospective uploads need only the report and reviewed component totals.</section></div>`;
  }

  function choiceCard(name, value, label, help, checked, disabled = false) {
    return `<label class="choice-card ${disabled ? "is-disabled" : ""}"><input type="radio" name="${name}" value="${value}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""}><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(help)}</small></span></label>`;
  }

  function configurationPanel() {
    const profile = propertyProfile();
    const constructionChoices = [["rcc", "RCC roof", "RCC buildings and approved floor sheets."], ["shed", "Shed roof", "Shed halls and shed-roof buildings."], ["hybrid", "Hybrid", "RCC and shed components in one estimate."]];
    return `<div class="panel" data-key="configuration"><h2>Property Configuration</h2>
      <section class="subgroup"><h3>Property type</h3><div class="setup-choice-grid">${[["industrial", "Industrial"], ["commercial", "Commercial"], ["residential", "Residential"]].map(([value, label]) => choiceCard("property-type", value, label, PROPERTY_TYPES[value].description, state.propertyType === value)).join("")}</div></section>
      ${profile ? `<section class="subgroup construction-section"><h3>Construction configuration</h3><div class="setup-choice-grid construction-choice-grid">${constructionChoices.map(([value, label, help]) => choiceCard("construction", value, label, help, state.construction === value, !profile.construction.includes(value))).join("")}</div>${state.propertyType === "residential" ? `<p class="residential-construction-note">Residential templates currently use the approved RCC format only. Shed roof and Hybrid are unavailable for this property type.</p>` : ""}</section>` : ""}
      ${profile ? `<section class="subgroup"><h3>Property subtype</h3><div class="field"><label class="required" for="property-subtype">Subtype</label><select id="property-subtype" required><option value="">Select subtype</option>${profile.subtypes.map((type) => `<option value="${type.value}" ${state.subtype === type.value ? "selected" : ""}>${escapeHtml(type.label)}</option>`).join("")}</select></div></section>` : ""}
      ${supportsCentreLineMethod() ? `<section class="subgroup"><h3>Measurement method for RCC components</h3><p class="hint">This changes only detailed measurement rows. Main estimate items and final report sections remain the same.</p><div class="setup-choice-grid measurement-method-grid">${choiceCard("measurement-method", "long_wall_short_wall", "Long Wall / Short Wall", "Enter separate long-wall and short-wall measurements.", selectedMeasurementMethod() === "long_wall_short_wall")}${choiceCard("measurement-method", "centre_line", "Centre Line", "Enter all-round and centre-wall measurement segments.", selectedMeasurementMethod() === "centre_line")}</div></section>` : ""}
      <div class="configuration-summary"><p>${profile && state.construction && state.subtype ? `<strong>Selected:</strong> ${escapeHtml(profile.label)} · ${escapeHtml(state.construction.toUpperCase())} · ${escapeHtml(profile.subtypes.find((type) => type.value === state.subtype)?.label || "")}` : "Select property type, construction configuration, and subtype before adding components."}</p></div>
    </div>`;
  }

  function compatibleComponent(definition) { return definition.roofType === "custom" || state.construction === "hybrid" || definition.roofType === state.construction; }
  function customRoofOptions() { return (propertyProfile()?.construction || []).filter((type) => type !== "hybrid").map((type) => `<option value="${type}">${type.toUpperCase()}</option>`).join(""); }

  function componentSelectionPanel() {
    const profile = propertyProfile();
    const ready = Boolean(profile && state.construction && state.subtype);
    const options = ready ? profile.components.filter(compatibleComponent) : [];
    return `<div class="panel" data-key="components"><h2>Component Selection</h2><p class="hint">Add only the structures present at the property. The order below becomes the workbook order after the Abstract.</p>
      ${ready ? `<div class="component-toolbar"><div class="field"><label for="component-type">Component</label><select id="component-type"><option value="">Select component</option>${options.map((component) => `<option value="${component.kind}">${escapeHtml(component.label)}</option>`).join("")}</select></div><div class="field"><label for="component-name">Component name <span class="optional-label">Optional</span></label><input id="component-name" placeholder="For example, Production Hall 2"></div><div class="field" id="custom-roof-wrap" hidden><label for="custom-roof-type">Custom component construction</label><select id="custom-roof-type">${customRoofOptions()}</select></div><button type="button" class="primary" id="add-component">Add component</button></div>` : `<div class="empty-state">Complete Property Configuration before adding components.</div>`}
      <div class="component-list">${state.components.length ? state.components.map(componentCard).join("") : `<div class="empty-state">No components selected yet.</div>`}</div></div>`;
  }

  function reportModePanel() {
    const mode = state.details.workMode || "";
    return `<section class="subgroup report-mode-panel"><h3>Choose preparation method</h3><p class="hint">Choose how the report will be prepared. Your entered component data is retained when changing methods.</p><div class="setup-choice-grid"><label class="choice-card"><input type="radio" name="work-mode" value="online" ${mode === "online" ? "checked" : ""}><span><strong>Fill online</strong><small>Enter measurements here, preview the rendered workbook, then generate the completed Excel report.</small></span></label><label class="choice-card"><input type="radio" name="work-mode" value="offline" ${mode === "offline" ? "checked" : ""}><span><strong>Complete offline and upload</strong><small>Attach a completed template or an existing report, review component totals, then submit it.</small></span></label></div></section>`;
  }

  function setWorkMode(mode) {
    if (!['online', 'offline'].includes(mode)) return;
    if (state.details.workMode === mode) return;
    const label = mode === "online" ? "Fill online" : "Complete offline and upload";
    if (!confirmReportInvalidation(`Change the preparation method to ${label}? Component configuration and measurements will be retained, but any existing completed report will no longer qualify and a new report will be required.`)) {
      renderAll({ sectionKey: "components" });
      return;
    }
    state.details.workMode = mode;
    markReportDirty();
    renderAll({ sectionKey: mode === "online" ? "configuration" : "offline" });
    persistDraftNow().then(() => {
      $("status").textContent = `Preparation method changed to ${label}. Existing component data was retained.`;
      updateOutputControls();
    }).catch((error) => { $("status").textContent = error.message || "Preparation method could not be saved"; });
  }

  function selectedWorkModeControl() {
    const mode = document.querySelector('input[name="work-mode"]:checked')?.value;
    return ['online', 'offline'].includes(mode) ? mode : "";
  }

  function synchroniseWorkMode() {
    // The rendered radio control is the user's most recent explicit choice.
    // Reconcile it before preview/download actions so a browser-restored form
    // value can never disagree with the in-memory draft state.
    const selected = selectedWorkModeControl();
    if (selected && state.details.workMode !== selected) {
      state.details.workMode = selected;
      markReportDirty();
      persistDraftNow();
    }
    return state.details.workMode || "";
  }

  function supportsTypicalFloors(component) {
    return ["commercial", "residential"].includes(state.propertyType) && ["rcc_building", "residential_building"].includes(component.kind);
  }

  function typicalFloorOptions(component, configuration) {
    if (!supportsTypicalFloors(component)) return "";
    const floors = configuredFloors(configuration).filter((floor) => floor.level >= 1);
    const selected = new Set(validTypicalFloorKeys(configuration, floors));
    if (floors.length < 2) return `<p class="typical-floor-help">Add at least one upper floor to group two or more matching floors into one Typical Floors worksheet.</p>`;
    return `<fieldset class="typical-floor-picker" data-typical-floor-picker="${component.id}"><legend>Typical Floors <span class="optional-label">Optional</span></legend><p>Tick matching Ground/upper floors to prepare them together on one worksheet. Enter their combined quantities in that worksheet; no automatic multiplier is applied.</p><div class="typical-floor-options">${floors.map((floor) => `<label><input type="checkbox" data-building-typical="${component.id}" value="${floor.key}" ${selected.has(floor.key) ? "checked" : ""}><span>${escapeHtml(floor.label)}</span></label>`).join("")}</div></fieldset>`;
  }

  function buildingConfigurationEditor(component) {
    const config = component.buildingConfig;
    return `<section class="building-config-editor"><h5>Change building configuration</h5><div class="component-meta">
      <div class="field"><label for="building-base-${component.id}">Base levels</label><select id="building-base-${component.id}" data-building-base="${component.id}">${BUILDING_CONFIGURATIONS.map((option) => `<option value="${option.key}" ${option.key === config.baseKey ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></div>
      <div class="field"><label for="building-upper-${component.id}">Upper floors above Ground Floor</label><input id="building-upper-${component.id}" data-building-upper="${component.id}" type="number" min="0" step="1" value="${config.upperFloorCount}"></div>
    </div><div data-typical-floor-options="${component.id}">${typicalFloorOptions(component, config)}</div><p class="building-impact" data-building-impact="${component.id}"></p><div class="item-actions"><button type="button" class="secondary" data-action="cancel-building-config" data-component="${component.id}">Cancel</button><button type="button" class="primary" data-action="save-building-config" data-component="${component.id}">Apply configuration</button></div></section>`;
  }

  function componentCard(component, index) {
    const definition = componentDefinition(component.kind);
    const sheets = (component.sheets || []).slice().sort((left, right) => left.level - right.level);
    const building = definition?.floorMode === "building";
    const sheetSummary = sheets.length ? sheets.map((sheet) => sheet.label).join(" · ") : "Single worksheet";
    const buildingControls = building ? (state.editingComponentId === component.id ? buildingConfigurationEditor(component) : `<button type="button" class="small-button" data-action="change-building-config" data-component="${component.id}">Change building configuration</button>`) : "";
    return `<article class="component-row"><div><h4>${index + 1}. ${escapeHtml(component.name)}</h4><p>${escapeHtml(component.roofType.toUpperCase())} · ${building ? escapeHtml(configurationLabel(component.buildingConfig)) : "Single sheet"}</p>${sheets.length ? `<ol class="floor-chip-list">${sheets.map((sheet) => `<li>${escapeHtml(sheet.label)}</li>`).join("")}</ol>` : ""}${state.editingComponentId === component.id ? buildingControls : ""}</div><div class="row-actions">${state.editingComponentId === component.id ? "" : buildingControls}<button type="button" class="small-button" data-action="move-component-up" data-component="${component.id}" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" class="small-button" data-action="move-component-down" data-component="${component.id}" ${index === state.components.length - 1 ? "disabled" : ""}>↓</button><button type="button" class="danger-button" data-action="remove-component" data-component="${component.id}">Remove</button></div></article>`;
  }

  function defaultBuildingConfiguration() { return { baseKey: "ground", upperFloorCount: 0, typicalFloorKeys: [] }; }

  function createComponent(definition) {
    const matches = state.components.filter((component) => component.kind === definition.kind).length + 1;
    const roofType = definition.roofType === "custom" ? $("custom-roof-type")?.value : definition.roofType;
    const defaultName = `${definition.label}${["rcc_building", "office_amenity", "utility_structure", "residential_building", "custom"].includes(definition.kind) ? ` ${matches}` : ""}`;
    const component = { id: uid(), kind: definition.kind, name: $("component-name")?.value.trim() || defaultName, roofType, sheets: [], formData: {} };
    if (definition.floorMode === "building") {
      component.buildingConfig = defaultBuildingConfiguration();
      component.sheets = sheetPlan(component.buildingConfig).map((floor) => makeSheetState(floor));
    }
    return component;
  }

  function addComponent() {
    const definition = componentDefinition($("component-type")?.value);
    if (!definition) return;
    state.components.push(createComponent(definition));
    renderAll({ sectionKey: "components" });
    scheduleSave();
  }

  function setPropertyType(value) {
    if (value === state.propertyType) return;
    if (state.components.length && !window.confirm("Changing the property type removes the selected components and their data. Continue?")) return;
    state.propertyType = value;
    state.construction = value === "residential" ? "rcc" : "";
    state.details.measurementMethod = "long_wall_short_wall";
    state.subtype = "";
    state.components = [];
    state.editingComponentId = null;
    renderAll({ sectionKey: "configuration" });
    scheduleSave();
  }

  function setConstruction(value) {
    if (value === state.construction) return;
    const incompatible = state.components.filter((component) => value !== "hybrid" && component.roofType !== value);
    if (incompatible.length && !window.confirm(`Changing construction removes ${incompatible.length} incompatible component${incompatible.length === 1 ? "" : "s"} and their data. Continue?`)) return;
    state.construction = value;
    if (value !== "hybrid") state.components = state.components.filter((component) => component.roofType === value);
    renderAll({ sectionKey: "configuration" });
    scheduleSave();
  }

  function supportsCentreLineMethod() {
    return ["commercial", "residential"].includes(state.propertyType) && ["rcc", "hybrid"].includes(state.construction);
  }

  function selectedMeasurementMethod() {
    return state.details.measurementMethod === "centre_line" ? "centre_line" : "long_wall_short_wall";
  }

  function componentUsesRccMeasurements(component) {
    return ["commercial", "residential"].includes(state.propertyType) && ["rcc_building", "residential_building"].includes(component.kind);
  }

  function componentHasMeasurementData(component) {
    const values = [component.formData, ...(component.sheets || []).map((sheet) => sheet.formData)];
    return values.some((value) => value && Object.keys(value).length > 0);
  }

  function setMeasurementMethod(method) {
    if (!["long_wall_short_wall", "centre_line"].includes(method) || method === selectedMeasurementMethod()) return;
    const affected = state.components.filter(componentUsesRccMeasurements);
    const entered = affected.filter(componentHasMeasurementData);
    if (entered.length && !window.confirm(`Changing the measurement method removes entered measurement data for ${entered.length} RCC component${entered.length === 1 ? "" : "s"}. Continue?`)) {
      renderAll({ sectionKey: "configuration" });
      return;
    }
    entered.forEach((component) => {
      component.formData = {};
      (component.sheets || []).forEach((sheet) => { sheet.formData = {}; });
    });
    state.details.measurementMethod = method;
    state.details.finalReport = null;
    state.details.prototypeCompletion = false;
    renderAll({ sectionKey: "configuration" });
    scheduleSave();
  }

  function removeComponent(id) {
    const component = state.components.find((entry) => entry.id === id);
    if (!component || !window.confirm(`Remove ${component.name}? All its sheets and entered data will be removed.`)) return;
    state.components = state.components.filter((entry) => entry.id !== id);
    state.editingComponentId = null;
    renderAll({ sectionKey: "components" });
    scheduleSave();
  }

  function moveComponent(id, offset) {
    const index = state.components.findIndex((component) => component.id === id);
    const destination = index + offset;
    if (index < 0 || destination < 0 || destination >= state.components.length) return;
    [state.components[index], state.components[destination]] = [state.components[destination], state.components[index]];
    renderAll({ sectionKey: "components" });
    scheduleSave();
  }

  function proposedBuildingConfiguration(componentId) {
    const baseKey = document.querySelector(`[data-building-base="${CSS.escape(componentId)}"]`)?.value;
    const rawCount = document.querySelector(`[data-building-upper="${CSS.escape(componentId)}"]`)?.value;
    const upperFloorCount = Number(rawCount);
    if (!baseKey || !Number.isInteger(upperFloorCount) || upperFloorCount < 0) return null;
    const requested = [...document.querySelectorAll(`[data-building-typical="${CSS.escape(componentId)}"]:checked`)].map((input) => input.value);
    const available = configuredFloors({ baseKey, upperFloorCount });
    return { baseKey, upperFloorCount, typicalFloorKeys: validTypicalFloorKeys({ baseKey, upperFloorCount, typicalFloorKeys: requested }, available) };
  }

  function configurationImpact(component, proposal) {
    const currentKeys = new Set((component.sheets || []).map((sheet) => sheet.key));
    const future = sheetPlan(proposal);
    const futureKeys = new Set(future.map((sheet) => sheet.key));
    const retained = future.filter((sheet) => currentKeys.has(sheet.key));
    const added = future.filter((sheet) => !currentKeys.has(sheet.key));
    const removed = (component.sheets || []).filter((sheet) => !futureKeys.has(sheet.key));
    return { retained, added, removed };
  }

  function impactText(impact) {
    const parts = [];
    if (impact.retained.length) parts.push(`Retained: ${impact.retained.map((sheet) => sheet.label).join(", ")}.`);
    if (impact.added.length) parts.push(`New blank sheet${impact.added.length === 1 ? "" : "s"}: ${impact.added.map((sheet) => sheet.label).join(", ")}.`);
    if (impact.removed.length) parts.push(`Removed with their data: ${impact.removed.map((sheet) => sheet.label).join(", ")}.`);
    return parts.join(" ") || "No worksheet changes.";
  }

  function updateBuildingImpact(componentId) {
    const component = state.components.find((entry) => entry.id === componentId);
    const target = document.querySelector(`[data-building-impact="${CSS.escape(componentId)}"]`);
    const proposal = proposedBuildingConfiguration(componentId);
    if (!target || !component) return;
    target.textContent = proposal ? impactText(configurationImpact(component, proposal)) : "Enter a whole number of upper floors, zero or more.";
  }

  function refreshTypicalFloorOptions(componentId) {
    const component = state.components.find((entry) => entry.id === componentId);
    const target = document.querySelector(`[data-typical-floor-options="${CSS.escape(componentId)}"]`);
    if (!component || !target) return;
    const proposal = proposedBuildingConfiguration(componentId);
    if (!proposal) return;
    target.innerHTML = typicalFloorOptions(component, proposal);
    document.querySelectorAll(`[data-building-typical="${CSS.escape(componentId)}"]`).forEach((input) => input.addEventListener("change", () => updateBuildingImpact(componentId)));
  }

  function saveBuildingConfiguration(componentId) {
    const component = state.components.find((entry) => entry.id === componentId);
    const proposal = proposedBuildingConfiguration(componentId);
    if (!component || !proposal) return window.alert("Enter a whole number of upper floors, zero or more.");
    const impact = configurationImpact(component, proposal);
    if (impact.removed.length && !window.confirm(`This change removes ${impact.removed.map((sheet) => sheet.label).join(", ")} and all data entered on those sheet${impact.removed.length === 1 ? "" : "s"}. Continue?`)) return;
    const existing = new Map((component.sheets || []).map((sheet) => [sheet.key, sheet]));
    component.buildingConfig = proposal;
    component.sheets = sheetPlan(proposal).map((floor) => makeSheetState(floor, existing.get(floor.key)));
    state.editingComponentId = null;
    renderAll({ sectionKey: "components" });
    scheduleSave();
  }

  function reviewPanel() {
    const sheets = allWorksheetNames();
    const worksheetOrder = sheets.length && requiresSeparateAbstract() ? ["Abstract", ...sheets] : sheets;
    return `<div class="panel" data-key="review"><h2>Configuration Review</h2><p class="hint">Review the planned worksheets and report totals before creating a generated Excel report or a configured offline workbook.</p><div class="review-grid"><div class="review-stat"><small>Property</small><strong>${escapeHtml(propertyProfile()?.label || "Not selected")}</strong></div><div class="review-stat"><small>Components</small><strong>${state.components.length}</strong></div><div class="review-stat"><small>Worksheets</small><strong>${worksheetOrder.length}</strong></div><div class="review-stat"><small>Abstract</small><strong>${sheets.length ? (requiresSeparateAbstract() ? "Separate first sheet" : "Compact on last sheet") : "Not determined"}</strong></div></div>${worksheetOrder.length ? `<section class="subgroup"><h3>Planned workbook order</h3><ol class="worksheet-order">${worksheetOrder.map((sheet) => `<li>${escapeHtml(sheet)}${sheet === "Abstract" ? "" : " <span class=\"soft-badge\">detail sheet</span>"}</li>`).join("")}</ol>${!requiresSeparateAbstract() ? `<p class="hint">The compact Abstract will be placed above Place, Date and Signature on the final selected residential sheet.</p>` : ""}</section>${reportOutputPanel()}` : `<div class="empty-state">Select components to see the planned workbook order.</div>`}</div>`;
  }

  function finalReportRecord() { return state.details.finalReport && typeof state.details.finalReport === "object" ? state.details.finalReport : null; }

  function reportOutputPanel() {
    const finalReport = finalReportRecord();
    const previewReady = Boolean(ReportData.preview()?.id);
    const retainedDownload = finalReport?.url
      ? `<a class="secondary" href="${escapeHtml(finalReport.url)}?download=1" download>Download completed Excel</a>` : "";
    return `<section class="output-grid"><div class="output-card"><h3>Report output</h3><p>Preview the current workbook, then generate the completed Excel report.</p><div class="output-actions"><button type="button" class="primary" id="generate-from-review" ${previewReady ? "" : "disabled"}>Generate completed Excel</button>${retainedDownload}</div><p class="completion-note">No photo or map attachment is required.</p></div><div class="output-status ${finalReport ? "is-complete" : "is-pending"}"><strong>${finalReport ? "Final Excel report recorded" : "A final Excel report is required"}</strong><span>${escapeHtml(finalReport ? `${finalReport.source}: ${finalReport.fileName}` : "Generate the completed Excel report from the online form.")}</span></div></section>`;
  }

  function measurementTemplateKey(component, sheet) {
    if (component.kind === "heavy_machinery_hall") return "heavy_machinery_hall";
    if (component.kind === "normal_machinery_hall") return "normal_machinery_hall";
    if (state.propertyType === "industrial" && ["rcc_building", "office_amenity", "utility_structure"].includes(component.kind)) {
      if (sheet?.key === "cellar") return "industrial_cellar";
      if (sheet?.key === "stilt") return "industrial_stilt";
      if (sheet?.key === "ground") return "rcc_ground";
      if (sheet && sheet.level > 1) return "rcc_upper";
    }
    if (component.kind === "shed_hall") return "commercial_shed_hall";
    if (component.kind === "rcc_building" && state.propertyType === "commercial") {
      const suffix = selectedMeasurementMethod() === "centre_line" ? "_centre_line" : "";
      if (sheet?.key === "cellar") return `commercial_rcc_cellar${suffix}`;
      if (sheet?.key === "stilt") return `commercial_rcc_stilt${suffix}`;
      if (sheet?.key === "ground") return `commercial_rcc_ground${suffix}`;
      if (sheet && sheet.level > 1) return `commercial_rcc_upper${suffix}`;
    }
    if (component.kind === "residential_building") {
      const suffix = selectedMeasurementMethod() === "centre_line" ? "_centre_line" : "";
      if (sheet?.key === "cellar") return `residential_cellar${suffix}`;
      if (sheet?.key === "stilt") return `residential_stilt${suffix}`;
      if (sheet?.key === "ground") return `residential_ground${suffix}`;
      if (sheet && sheet.level > 1) return `residential_upper${suffix}`;
    }
    return null;
  }

  function componentMeasurementEntries() {
    return state.components.flatMap((component) => {
      const definition = componentDefinition(component.kind);
      if (!definition) return [];
      if (definition.floorMode === "building") return (component.sheets || []).map((sheet) => ({ component, sheet, key: `measure-${component.id}-${sheet.id}`, label: `${component.name} — ${sheet.label}` }));
      return [{ component, sheet: null, key: `measure-${component.id}`, label: component.name }];
    });
  }

  function measurementData(component, sheet) {
    const holder = sheet || component;
    holder.formData = holder.formData || {};
    holder.formData.rows = holder.formData.rows || {};
    holder.formData.customRows = holder.formData.customRows || {};
    holder.formData.customItems = holder.formData.customItems || {};
    holder.formData.itemOverrides = holder.formData.itemOverrides || {};
    return holder.formData;
  }

  function templateItems(schema, data) {
    const items = [];
    let nextSno = 1;
    schema.items().forEach((base, index) => {
      const itemKey = `standard-${index}`;
      items.push({ ...base, itemKey, displaySno: base.sno == null ? null : nextSno++ });
      (data.customItems[itemKey] || []).forEach((custom) => {
        items.push({
          ...base,
          itemKey: custom.id,
          parentItemKey: itemKey,
          instanceKey: custom.id,
          isCustomItem: true,
          label: custom.shortDescription || `Custom: ${base.label}`,
          detailedDescription: custom.detailedDescription || "",
          displaySno: nextSno++,
        });
      });
    });
    return items;
  }

  function templateRows(item, data) {
    const rows = [];
    const scopedId = (id) => item.instanceKey ? `${item.instanceKey}:${id}` : id;
    item.rows.forEach((base) => {
      const baseId = scopedId(base.id);
      rows.push({ ...base, instanceId: baseId, baseId, sourceId: base.sourceId ? scopedId(base.sourceId) : undefined, isCustom: false });
      (data.customRows[baseId] || []).forEach((custom) => rows.push({ ...base, id: custom.id, instanceId: custom.id, baseId, sourceId: base.sourceId ? scopedId(base.sourceId) : undefined, isCustom: true, label: custom.label || `Custom: ${base.label}` }));
    });
    return rows;
  }

  function numberOrBlank(value) {
    if (value === "" || value == null) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function completeProduct(values) { return values.every((value) => value != null) ? values.reduce((total, value) => total * value, 1) : null; }
  function cleanNumber(value) { return Number.isFinite(value) ? value : null; }
  function formatNumber(value) { return value == null ? "" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }

  function sheetCalculations(schema, data) {
    const items = templateItems(schema, data);
    // A source such as concrete-footings lives in a different numbered item
    // from steel-footings. Keep one value map for the whole floor worksheet,
    // not a separate map for each numbered item.
    const prepared = items.map((item) => ({
      item,
      rows: templateRows(item, data).map((row) => ({ ...row, itemKey: item.itemKey })),
    }));
    const rows = prepared.flatMap((entry) => entry.rows);
    const values = Object.fromEntries(rows.map((entry) => [entry.instanceId, { quantity: null, amount: null }]));
    const directInputs = (entry) => data.rows[entry.instanceId] || {};
    const rowsForGroup = (entry, group) => rows.filter((candidate) => candidate.itemKey === entry.itemKey && candidate.group === group);
    const groupQuantity = (entry, group) => rowsForGroup(entry, group).reduce((total, candidate) => total + (values[candidate.instanceId]?.quantity || 0), 0);
    const groupHasValue = (entry, group) => rowsForGroup(entry, group).some((candidate) => values[candidate.instanceId]?.quantity != null);

    rows.forEach((entry) => {
      const input = directInputs(entry);
      const factors = {
        standard_4_factor: [numberOrBlank(input.no), numberOrBlank(input.length), numberOrBlank(input.breadth), numberOrBlank(input.depth)],
        three_factor_fgh: [numberOrBlank(input.no), numberOrBlank(input.length), numberOrBlank(input.breadth)],
        three_factor_fgi: [numberOrBlank(input.no), numberOrBlank(input.length), numberOrBlank(input.depth)],
      };
      if (factors[entry.calculation]) values[entry.instanceId].quantity = completeProduct(factors[entry.calculation]);
      if (entry.calculation === "count_rate") values[entry.instanceId].quantity = numberOrBlank(input.no);
      if (entry.calculation === "manual_quantity_rate") values[entry.instanceId].quantity = numberOrBlank(input.quantity);
      if (entry.calculation === "lump_sum") values[entry.instanceId].amount = numberOrBlank(input.amount);
    });

    // Resolve derived rows after their RCC source rows. An entered quantity on
    // a derived row is a deliberate valuer adjustment and takes precedence.
    for (let pass = 0; pass < 8; pass += 1) {
      rows.forEach((entry) => {
        const input = directInputs(entry);
        let quantity = values[entry.instanceId].quantity;
        if (entry.calculation === "derived") {
          const source = values[entry.sourceId]?.quantity;
          quantity = numberOrBlank(input.quantity) ?? (source == null ? null : source * entry.multiplier);
        }
        if (entry.calculation === "derived_expression") {
          const source = values[entry.sourceId]?.quantity;
          quantity = numberOrBlank(input.quantity) ?? (source == null ? null : source * 0.125 * 80);
        }
        if (entry.calculation === "subtotal") quantity = groupHasValue(entry, entry.sourceGroup) ? groupQuantity(entry, entry.sourceGroup) : null;
        if (entry.calculation === "percentage") {
          const sourceGroups = entry.includeSourceGroups || [entry.sourceGroup];
          const hasValue = sourceGroups.some((group) => groupHasValue(entry, group));
          quantity = hasValue ? sourceGroups.reduce((total, group) => total + groupQuantity(entry, group), 0) * entry.percentage : null;
        }
        values[entry.instanceId].quantity = cleanNumber(quantity);
        if (entry.rate) {
          const rate = numberOrBlank(input.rate);
          values[entry.instanceId].amount = quantity != null && rate != null ? quantity * rate : null;
        }
      });
    }

    const calculations = prepared.map(({ item, rows: itemRows }) => {
      const calculatedAmount = itemRows.reduce((total, entry) => total + (values[entry.instanceId].amount || 0), 0);
      const overrideAmount = numberOrBlank(data.itemOverrides[item.itemKey]);
      return { item, calculation: { rows: itemRows, values, calculatedAmount, overrideAmount, amount: overrideAmount ?? calculatedAmount } };
    });
    const calculatedAmount = calculations.reduce((sum, entry) => sum + entry.calculation.amount, 0);
    const overrideAmount = numberOrBlank(data.sheetTotalOverride);
    return { items, calculations, calculatedAmount, overrideAmount, amount: overrideAmount ?? calculatedAmount };
  }

  function inputControl(entry, field, data, component, sheet) {
    const value = data.rows[entry.instanceId]?.[field] ?? "";
    const labels = { no: "No.", length: "L", breadth: "B", depth: "D", quantity: "Qty", rate: "Rate", amount: "Amount" };
    return `<input aria-label="${escapeHtml(`${entry.label} ${labels[field]}`)}" type="number" step="any" inputmode="decimal" value="${escapeHtml(value)}" data-measurement-input="1" data-component="${component.id}" data-sheet="${sheet?.id || "component"}" data-row="${entry.instanceId}" data-field="${field}">`;
  }

  function rowInputFields(calculation) {
    if (calculation === "standard_4_factor") return ["no", "length", "breadth", "depth"];
    if (calculation === "three_factor_fgh") return ["no", "length", "breadth"];
    if (calculation === "three_factor_fgi") return ["no", "length", "depth"];
    if (calculation === "count_rate") return ["no"];
    if (calculation === "manual_quantity_rate") return ["quantity"];
    return [];
  }

  function derivedQuantityControl(entry, value, data, component, sheet) {
    const entered = data.rows[entry.instanceId]?.quantity;
    const displayValue = numberOrBlank(entered) ?? value.quantity;
    return `<input class="derived-quantity-input" aria-label="${escapeHtml(`${entry.label} calculated quantity; edit to adjust`)}" type="number" step="any" inputmode="decimal" value="${escapeHtml(displayValue ?? "")}" data-measurement-input="1" data-derived-quantity="1" data-component="${component.id}" data-sheet="${sheet?.id || "component"}" data-row="${entry.instanceId}" data-field="quantity">`;
  }

  function calculationInfo(entry) {
    const message = entry.calculation === "derived"
      ? `Calculated from the matching RCC concrete quantity × ${entry.multiplier} kg/cum.`
      : "Calculated from Roof Slab area × 0.125 m × 80 kg/cum.";
    return `<span class="calculation-info"><button type="button" class="info-button" aria-label="How ${escapeHtml(entry.label)} is calculated" aria-expanded="false" data-action="toggle-calculation-info">i</button><span class="calculation-info-popover" hidden>${escapeHtml(message)}</span></span>`;
  }

  function measurementRowHtml(entry, calculation, data, component, sheet) {
    const value = calculation.values[entry.instanceId] || {};
    if (entry.calculation === "heading") return `<tr class="worksheet-heading-row"><td></td><td colspan="8">${escapeHtml(entry.label)}</td><td></td></tr>`;
    const inputs = rowInputFields(entry.calculation);
    const label = entry.isCustom
      ? `<input class="custom-row-label" aria-label="Custom row description" value="${escapeHtml(entry.label)}" data-row-label="1" data-component="${component.id}" data-sheet="${sheet?.id || "component"}" data-row="${entry.instanceId}">`
      : escapeHtml(entry.label);
    const cells = ["no", "length", "breadth", "depth"].map((field) => `<td>${inputs.includes(field) ? inputControl(entry, field, data, component, sheet) : ""}</td>`).join("");
    const quantityInput = inputs.includes("quantity") ? inputControl(entry, "quantity", data, component, sheet) : "";
    const amountInput = entry.calculation === "lump_sum" ? inputControl(entry, "amount", data, component, sheet) : "";
    const quantity = ["derived", "derived_expression"].includes(entry.calculation)
      ? `<span class="derived-quantity-wrap">${derivedQuantityControl(entry, value, data, component, sheet)}${calculationInfo(entry)}</span>`
      : quantityInput || `<span class="calculated-value" data-calculated-value="quantity" data-component="${component.id}" data-sheet="${sheet?.id || "component"}" data-row="${entry.instanceId}">${formatNumber(value.quantity)}</span>`;
    const rate = entry.rate ? inputControl(entry, "rate", data, component, sheet) : (entry.calculation === "lump_sum" ? "LS" : "");
    const amount = amountInput || `<span class="calculated-value" data-calculated-value="amount" data-component="${component.id}" data-sheet="${sheet?.id || "component"}" data-row="${entry.instanceId}">${formatNumber(value.amount)}</span>`;
    const action = entry.isCustom
      ? `<button type="button" class="row-icon-button" title="Remove custom row" data-action="remove-custom-row" data-component="${component.id}" data-sheet="${sheet?.id || "component"}" data-row="${entry.instanceId}" data-parent-row="${entry.baseId}">×</button>`
      : entry.customizable
        ? `<button type="button" class="row-icon-button" title="Add a matching custom row" data-action="add-custom-row" data-component="${component.id}" data-sheet="${sheet?.id || "component"}" data-parent-row="${entry.baseId}">+</button>`
        : "";
    return `<tr class="worksheet-row ${entry.calculation === "subtotal" ? "worksheet-subtotal-row" : ""} ${entry.isCustom ? "worksheet-custom-row" : ""}"><td></td><td class="description-cell">${label}</td>${cells}<td>${quantity}</td><td>${rate}</td><td>${amount}</td><td class="custom-row-action">${action}</td></tr>`;
  }


  function editableFinalAmount(value, calculatedValue, attributes, resetAttributes, label, calculatedAttributes) {
    const finalValue = value ?? calculatedValue;
    return `<label class="final-amount-control"><span>${escapeHtml(label)}</span><input type="number" step="any" inputmode="decimal" value="${finalValue ?? ""}" ${attributes}><small>Calculated: ₹ <span ${calculatedAttributes}>${formatNumber(calculatedValue)}</span></small>${value != null ? `<button type="button" class="text-button" ${resetAttributes}>Use calculated</button>` : ""}</label>`;
  }

  function customItemDetails(item, component, sheet) {
    if (!item.isCustomItem) return "";
    return `<div class="custom-item-details"><div class="field"><label>Short description (form)</label><input value="${escapeHtml(item.label)}" data-custom-item-short="1" data-component="${component.id}" data-sheet="${sheet?.id || "component"}" data-item="${item.itemKey}"></div><div class="field full"><label>Detailed description (generated report)</label><textarea data-custom-item-detail="1" data-component="${component.id}" data-sheet="${sheet?.id || "component"}" data-item="${item.itemKey}" placeholder="Enter the full technical description for the report">${escapeHtml(item.detailedDescription)}</textarea></div></div>`;
  }

  function measurementPanel(entry) {
    const templateKey = measurementTemplateKey(entry.component, entry.sheet);
    if (!templateKey) return `<div class="panel" data-key="${entry.key}"><h2>${escapeHtml(entry.label)}</h2><div class="notice"><strong>Online measurements are not available for this component yet.</strong> Select a finalized Industrial component or use the future offline workbook route for a custom component.</div></div>`;
    const schema = ESTIMATION_WORKSHEETS[templateKey];
    const data = measurementData(entry.component, entry.sheet);
    const totals = sheetCalculations(schema, data);
    return `<div class="panel" data-key="${entry.key}"><h2>${escapeHtml(entry.label)}</h2><p class="hint">Enter the white measurement cells. Derived quantities fill automatically and can be adjusted when needed. Quantity and Amount follow the finalized worksheet formulas. Use + for a matching custom subfield or Add custom field for a full numbered item.</p><div class="worksheet-summary"><span>Approved template: <strong>${escapeHtml(schema.label)}</strong></span>${editableFinalAmount(totals.overrideAmount, totals.calculatedAmount, `data-sheet-final-input="1" data-component="${entry.component.id}" data-sheet="${entry.sheet?.id || "component"}"`, `data-action="reset-sheet-total" data-component="${entry.component.id}" data-sheet="${entry.sheet?.id || "component"}"`, "Final sheet total", `data-sheet-calculated data-component="${entry.component.id}" data-sheet="${entry.sheet?.id || "component"}"`)}</div><div class="worksheet-item-list">${totals.calculations.map(({ item, calculation }) => {
      const heading = `${item.displaySno == null ? "" : `${item.displaySno}. `}${item.label}`;
      const actions = item.isCustomItem
        ? `<button type="button" class="text-button danger-text" data-action="remove-custom-item" data-component="${entry.component.id}" data-sheet="${entry.sheet?.id || "component"}" data-item="${item.itemKey}">Remove custom field</button>`
        : item.displaySno != null
          ? `<button type="button" class="text-button" data-action="add-custom-item" data-component="${entry.component.id}" data-sheet="${entry.sheet?.id || "component"}" data-parent-item="${item.itemKey}">Add custom field</button>`
          : "";
      const itemFinalAmount = item.displaySno != null
        ? editableFinalAmount(calculation.overrideAmount, calculation.calculatedAmount, `data-item-final-input="1" data-component="${entry.component.id}" data-sheet="${entry.sheet?.id || "component"}" data-item="${item.itemKey}"`, `data-action="reset-item-total" data-component="${entry.component.id}" data-sheet="${entry.sheet?.id || "component"}" data-item="${item.itemKey}"`, "Final amount", `data-item-calculated="${item.itemKey}" data-component="${entry.component.id}" data-sheet="${entry.sheet?.id || "component"}"`)
        : "";
      return `<section class="worksheet-item"><div class="worksheet-item-title"><span>${escapeHtml(heading)}</span><div class="item-title-actions">${itemFinalAmount}${actions}</div></div>${customItemDetails(item, entry.component, entry.sheet)}<div class="worksheet-table-wrap"><table class="worksheet-table"><thead><tr><th>S.No.</th><th>Description of Item</th><th>No.</th><th>L (m)</th><th>B (m)</th><th>D (m)</th><th>Qty<br>(cum/sqm)</th><th>Unit Rate<br>(Rs.)</th><th>Amount<br>(Rs.)</th><th aria-label="Custom row"></th></tr></thead><tbody>${calculation.rows.map((rowEntry) => measurementRowHtml(rowEntry, calculation, data, entry.component, entry.sheet)).join("")}</tbody></table></div></section>`;
    }).join("")}</div></div>`;
  }

  const COMMON_EXTERNAL_WORKS = [
    "Water Supply and Sanitary Works",
    "Electrical Works",
    "Site Clearance and Land Development",
    "External Pavements and Internal Roads",
    "Fire-Fighting System",
    "Rainwater Harvesting",
    "Boundary Wall and Gates",
    "Plan Approval and Permission Charges",
    "Tools and Plant Charges",
    "Supervision Charges",
    "Contingencies and Miscellaneous Works",
  ];

  function componentSheetTotals(entry) {
    const templateKey = measurementTemplateKey(entry.component, entry.sheet);
    if (!templateKey) return null;
    const data = measurementData(entry.component, entry.sheet);
    return sheetCalculations(ESTIMATION_WORKSHEETS[templateKey], data);
  }

  function abstractIncludesCommonWorks() { return state.propertyType !== "residential" || requiresSeparateAbstract(); }

  function customAbstractEntries(key) {
    state.details[key] = Array.isArray(state.details[key]) ? state.details[key] : [];
    return state.details[key];
  }

  function customAbstractTotal(key) {
    return customAbstractEntries(key).reduce((sum, item) => sum + (numberOrBlank(item.amount) || 0), 0);
  }

  function customAbstractRows(entries, offset, type) {
    return entries.map((entry, index) => `<tr class="abstract-custom-row"><td>${offset + index + 1}</td><td><input class="abstract-description-input" value="${escapeHtml(entry.description || "")}" placeholder="Custom description" data-abstract-custom-description="1" data-abstract-custom-type="${type}" data-abstract-custom-id="${entry.id}"></td><td><input type="number" step="any" inputmode="decimal" value="${escapeHtml(entry.amount ?? "")}" data-abstract-custom-amount="1" data-abstract-custom-type="${type}" data-abstract-custom-id="${entry.id}"></td><td><button type="button" class="row-icon-button" title="Remove custom row" data-action="remove-abstract-custom" data-abstract-custom-type="${type}" data-abstract-custom-id="${entry.id}">×</button></td></tr>`).join("");
  }

  function abstractPanel() {
    const entries = componentMeasurementEntries();
    const commonWorks = state.details.commonExternalWorks || {};
    const componentRows = entries.map((entry) => ({ entry, totals: componentSheetTotals(entry) }));
    const customComponents = customAbstractEntries("customComponentEstimates");
    const customCommonWorks = customAbstractEntries("customCommonExternalWorks");
    const calculatedComponentTotal = componentRows.reduce((sum, row) => sum + (row.totals?.amount || 0), 0);
    const componentTotal = calculatedComponentTotal + customAbstractTotal("customComponentEstimates");
    const commonTotal = COMMON_EXTERNAL_WORKS.reduce((sum, label) => sum + (numberOrBlank(commonWorks[label]) || 0), 0) + customAbstractTotal("customCommonExternalWorks");
    const compact = !requiresSeparateAbstract();
    const commonWorksSection = abstractIncludesCommonWorks() ? `<section class="abstract-section"><div class="abstract-section-heading"><div><h3>Common External Works and Project Charges</h3><p class="hint">These values are entered directly by the valuer.</p></div><button type="button" class="text-button" data-action="add-abstract-custom" data-abstract-custom-type="common">Add custom field</button></div><div class="abstract-table-wrap"><table class="abstract-table abstract-edit-table"><thead><tr><th>S.No.</th><th>Description</th><th>Amount (Rs.)</th><th aria-label="Remove custom field"></th></tr></thead><tbody>${COMMON_EXTERNAL_WORKS.map((label, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(label)}</td><td><input type="number" step="any" inputmode="decimal" value="${escapeHtml(commonWorks[label] ?? "")}" data-common-work="${escapeHtml(label)}"></td><td></td></tr>`).join("")}${customAbstractRows(customCommonWorks, COMMON_EXTERNAL_WORKS.length, "common")}</tbody><tfoot><tr><th colspan="2">Total common works and charges</th><th colspan="2">₹ <span data-common-works-total>${formatNumber(commonTotal)}</span></th></tr><tr class="abstract-grand-total"><th colspan="2">Total estimated project cost</th><th colspan="2">₹ <span data-abstract-total>${formatNumber(componentTotal + commonTotal)}</span></th></tr></tfoot></table></div></section>` : `<section class="abstract-section"><div class="abstract-table-wrap"><table class="abstract-table"><tfoot><tr class="abstract-grand-total"><th colspan="2">Total estimated project cost</th><th colspan="2">₹ <span data-abstract-total>${formatNumber(componentTotal)}</span></th></tr></tfoot></table></div></section>`;
    return `<div class="panel" data-key="abstract"><h2>${compact ? "Compact Abstract" : "Abstract"}</h2><p class="hint">This is the final online-form section. Component values remain linked to their source sheets. Editing a component amount here changes the same final sheet total after confirmation.</p><section class="abstract-section"><div class="abstract-section-heading"><h3>Component estimates</h3><button type="button" class="text-button" data-action="add-abstract-custom" data-abstract-custom-type="component">Add custom field</button></div><div class="abstract-table-wrap"><table class="abstract-table abstract-edit-table"><thead><tr><th>S.No.</th><th>Component / Work</th><th>Calculated amount (Rs.)</th><th>Final amount (Rs.)</th><th aria-label="Remove custom field"></th></tr></thead><tbody>${componentRows.length ? componentRows.map(({ entry, totals }, index) => {
      if (!totals) return `<tr><td>${index + 1}</td><td>${escapeHtml(entry.label)}</td><td>—</td><td>Online template not available</td></tr>`;
      const value = totals.amount;
      return `<tr><td>${index + 1}</td><td>${escapeHtml(entry.label)}</td><td>${formatNumber(totals.calculatedAmount)}</td><td><input type="number" step="any" inputmode="decimal" value="${value}" data-abstract-component-final="1" data-component="${entry.component.id}" data-sheet="${entry.sheet?.id || "component"}"></td><td></td></tr>`;
    }).join("") : `<tr><td colspan="5">Add property components before completing the Abstract.</td></tr>`}${customAbstractRows(customComponents, componentRows.length, "component")}</tbody><tfoot><tr><th colspan="2">Total component estimates</th><th colspan="3">₹ ${formatNumber(componentTotal)}</th></tr></tfoot></table></div></section>${commonWorksSection}</div>`;
  }

  function reportSetupComplete() {
    return ["estimateDate", "place", "applicantName", "projectLocation", "workDescription"].every((key) => String(state.details[key] || "").trim());
  }

  function propertyConfigurationComplete() { return Boolean(state.propertyType && state.construction && state.subtype); }

  function sectionGate(key) {
    if (key === "setup" || key === "preparation" || key === "configuration") return { allowed: true };
    if (key === "components") {
      if (!reportSetupComplete()) return { allowed: false, message: "Complete Report Setup first.", target: "setup", targetLabel: "Go to Report Setup" };
      if (!propertyConfigurationComplete()) return { allowed: false, message: "Complete Property Configuration before choosing report components.", target: "configuration", targetLabel: "Go to Property Configuration" };
      return { allowed: true };
    }
    if (key.startsWith("measure-")) {
      if (!state.components.length) return { allowed: false, message: "Choose and configure at least one property component before entering measurements.", target: "components", targetLabel: "Go to Component Selection" };
      if (state.details.workMode !== "online") return { allowed: false, message: "Choose Fill online in Preparation Method to enter measurements in this form.", target: "preparation", targetLabel: "Go to Preparation Method" };
      return { allowed: true };
    }
    if (key === "abstract") {
      if (!state.components.length || state.details.workMode !== "online") return { allowed: false, message: "Complete Component Selection and choose Fill online before reviewing the Abstract.", target: "components", targetLabel: "Go to Component Selection" };
      return { allowed: true };
    }
    if (key === "review") {
      if (!reportSetupComplete() || !propertyConfigurationComplete() || !state.components.length || !state.details.workMode) return { allowed: false, message: "Complete Report Setup, Property Configuration, Component Selection, and choose a preparation method first.", target: !reportSetupComplete() ? "setup" : !propertyConfigurationComplete() ? "configuration" : "components", targetLabel: !reportSetupComplete() ? "Go to Report Setup" : !propertyConfigurationComplete() ? "Go to Property Configuration" : "Go to Component Selection" };
    }
    return { allowed: true };
  }

  function lockedPanel(key, label, gate) {
    return `<div class="panel locked-panel" data-key="${escapeHtml(key)}"><div class="locked-panel-icon" aria-hidden="true">!</div><h2>${escapeHtml(label)}</h2><div class="locked-panel-card"><strong>Complete previous sections first</strong><p>${escapeHtml(gate.message)}</p><button type="button" class="primary" data-action="go-to-section" data-section-key="${escapeHtml(gate.target)}">${escapeHtml(gate.targetLabel)}</button></div></div>`;
  }

  function sectionDefinitions() {
    const setup = [{key: "setup", label: "Report Setup", html: setupPanel()},
      {key: "preparation", label: "Preparation Method", html: `<div class="panel" data-key="preparation"><h2>Preparation Method</h2>${reportModePanel()}</div>`}];
    const configuration = [{key: "configuration", label: "Property Configuration", html: configurationPanel()}, {key: "components", label: "Component Selection", html: componentSelectionPanel()}];
    if (state.details.workMode === "offline") return [...setup, ...(state.details.templateSetup ? configuration : []), {key: "offline", label: "Complete & Upload Report", html: offlineEntry.panel()}];
    if (state.details.workMode !== "online") return setup;
    const measurements = state.propertyType ? componentMeasurementEntries().map((entry) => ({key: entry.key, label: entry.label, html: measurementPanel(entry)})) : [];
    const abstract = state.propertyType && state.components.length ? [{key: "abstract", label: requiresSeparateAbstract() ? "Abstract" : "Compact Abstract", html: abstractPanel()}] : [];
    return [...setup, ...configuration, ...measurements, ...abstract, {key: "review", label: "Configuration Review", html: reviewPanel()}].map((section) => {
      const gate = sectionGate(section.key);
      return gate.allowed ? {...section, locked: false} : {...section, locked: true, html: lockedPanel(section.key, section.label, gate)};
    });
  }

  function currentKey() { return document.querySelector(".panel.active")?.dataset.key || "setup"; }

  function renderAll(options = {}) {
    const desiredKey = options.sectionKey || currentKey();
    const scrollPosition = window.scrollY;
    const sections = sectionDefinitions();
    $("sections").innerHTML = sections.map((section) => section.html).join("");
    $("nav").innerHTML = sections.map((section, index) => `<button type="button" data-section-index="${index}" data-section-key="${escapeHtml(section.key)}" class="${section.locked ? "nav-locked" : ""}">${escapeHtml(section.label)}${section.locked ? `<span class="nav-lock" aria-label="Requires earlier sections">!</span>` : ""}</button>`).join("");
    const nextIndex = sections.findIndex((section) => section.key === desiredKey);
    state.current = nextIndex < 0 ? 0 : nextIndex;
    wireEvents();
    offlineEntry.wire();
    document.body.dataset.valuationPreparation = state.details.workMode || "";
    window.dispatchEvent(new CustomEvent("sln:valuation-preparation-changed"));
    showSection(state.current, { skipAbstractRefresh: options.skipAbstractRefresh });
    updateOutputControls();
    window.scrollTo({ top: scrollPosition, behavior: "auto" });
    if (state.editingComponentId) updateBuildingImpact(state.editingComponentId);
  }

  function showSection(index, options = {}) {
    const panels = [...document.querySelectorAll(".panel")];
    state.current = Math.max(0, Math.min(index, panels.length - 1));
    if (panels[state.current]?.dataset.key === "abstract" && !options.skipAbstractRefresh) {
      // The Abstract is derived from every component panel. Rebuild it when it
      // is opened so it cannot display an earlier, hidden snapshot of a total.
      renderAll({ sectionKey: "abstract", skipAbstractRefresh: true });
      return;
    }
    panels.forEach((panel, panelIndex) => panel.classList.toggle("active", panelIndex === state.current));
    document.querySelectorAll("#nav button").forEach((button, buttonIndex) => button.classList.toggle("active", buttonIndex === state.current));
    $("progress").textContent = `Section ${state.current + 1} of ${panels.length}`;
    $("previous").disabled = state.current === 0;
    $("next").disabled = state.current === panels.length - 1;
    if (options.scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function dateError(input) {
    const error = $(`${input.id}-error`);
    input.setCustomValidity("");
    if (error) { error.textContent = ""; error.hidden = true; }
  }

  function validationIssues() {
    const issues = [];
    ["estimateDate", "place", "applicantName", "projectLocation", "workDescription"].forEach((key) => { if (!String(state.details[key] || "").trim()) issues.push(`Report detail missing: ${key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}`); });
    if (!state.propertyType) issues.push("Select the property type.");
    if (!state.construction) issues.push("Select the construction configuration.");
    if (!state.subtype) issues.push("Select the property subtype.");
    if (!state.components.length) issues.push("Add at least one property component.");
    if (!state.details.workMode) issues.push("Choose whether to fill the estimate online or complete it in Excel.");
    return issues;
  }

  function workbookIssues() {
    const issues = validationIssues();
    componentMeasurementEntries().forEach((entry) => {
      if (!measurementTemplateKey(entry.component, entry.sheet)) issues.push(`${entry.label} does not yet have an approved workbook template.`);
    });
    return issues;
  }

  function updateOutputControls() {
    const enabled = workbookIssues().length === 0;
    const currentPreview = Boolean(ReportData.preview()?.id);
    $("generate-xlsx").disabled = !enabled || state.details.workMode !== "online" || !currentPreview;
    $("download-offline").disabled = !enabled || state.details.workMode !== "offline";
    $("generate-xlsx").hidden = state.details.workMode !== "online";
    $("download-offline").hidden = true;
    $("review-report").hidden = state.details.workMode !== "online";
  }

  function workbookErrorMessage(error) {
    const message = error instanceof Error ? error.message.trim() : "";
    return message && !/^(failed to fetch|networkerror|load failed)$/i.test(message)
      ? message
      : "The workbook could not be prepared. Check your connection and try again.";
  }

  function workbookState(mode) {
    const snapshot = JSON.parse(JSON.stringify(state));
    if (mode !== "completed") return snapshot;
    snapshot.components.forEach((component) => {
      const liveComponent = state.components.find((entry) => entry.id === component.id);
      if (!liveComponent) return;
      if (Array.isArray(component.sheets)) {
        component.sheets.forEach((sheet) => {
          const liveSheet = (liveComponent.sheets || []).find((entry) => entry.id === sheet.id);
          if (!liveSheet) return;
          sheet.formData = sheet.formData || {};
          const totals = componentSheetTotals({ component: liveComponent, sheet: liveSheet });
          if (totals) sheet.formData.finalAmount = totals.amount;
        });
      } else {
        component.formData = component.formData || {};
        const totals = componentSheetTotals({ component: liveComponent, sheet: null });
        if (totals) component.formData.finalAmount = totals.amount;
      }
    });
    return snapshot;
  }

  function estimationLinkSummary(extracted = null) {
    const worksheetComponents = componentMeasurementEntries().map((entry, index) => ({
      id: `worksheet-${index + 1}`,
      label: entry.label,
      estimatedCost: componentSheetTotals(entry)?.amount || 0,
      source: "component",
    }));
    const customComponents = customAbstractEntries("customComponentEstimates")
      .filter((entry) => String(entry.description || "").trim() || numberOrBlank(entry.amount) !== null)
      .map((entry) => ({ id: entry.id, label: String(entry.description || "Custom component").trim(), estimatedCost: numberOrBlank(entry.amount) || 0, source: "component" }));
    const commonWorks = abstractIncludesCommonWorks()
      ? COMMON_EXTERNAL_WORKS.map((label, index) => ({ id: `common-${index + 1}`, label, estimatedCost: numberOrBlank(state.details.commonExternalWorks?.[label]) || 0, source: "common" }))
        .filter((entry) => entry.estimatedCost !== 0)
      : [];
    const customCommon = abstractIncludesCommonWorks()
      ? customAbstractEntries("customCommonExternalWorks")
        .filter((entry) => String(entry.description || "").trim() || numberOrBlank(entry.amount) !== null)
        .map((entry) => ({ id: entry.id, label: String(entry.description || "Custom external work").trim(), estimatedCost: numberOrBlank(entry.amount) || 0, source: "common" }))
      : [];
    const components = Array.isArray(extracted?.components) && extracted.components.length
      ? extracted.components.map((entry, index) => ({ id: entry.id || `workbook-${index + 1}`, label: entry.label, estimatedCost: Number(entry.estimatedCost) || 0, source: entry.source || "workbook" }))
      : [...worksheetComponents, ...customComponents, ...commonWorks, ...customCommon];
    return {
      version: 1,
      propertyType: state.propertyType,
      propertyTypeLabel: propertyProfile()?.label || state.propertyType,
      construction: state.construction,
      subtype: state.subtype,
      estimateDate: state.details.estimateDate || "",
      applicantName: state.details.applicantName || "",
      applicantAddress: state.details.applicantAddress || "",
      projectLocation: state.details.projectLocation || "",
      workDescription: state.details.workDescription || "",
      components,
      totalEstimatedCost: extracted?.totalEstimatedCost ?? components.reduce((sum, entry) => sum + (Number(entry.estimatedCost) || 0), 0),
    };
  }

  async function downloadWorkbook(mode) {
    const selectedMode = synchroniseWorkMode();
    const requiredWorkMode = mode === "completed" ? "online" : "offline";
    if (selectedMode !== requiredWorkMode) {
      const selected = selectedMode === "online" ? "Fill online" : selectedMode === "offline" ? "Complete offline and upload" : "no preparation method";
      window.alert(requiredWorkMode === "offline"
        ? `Choose Complete offline and upload before downloading the workbook template. Current selection: ${selected}.`
        : `Choose Fill online before generating a completed report. Current selection: ${selected}.`);
      return;
    }
    const issues = workbookIssues();
    if (issues.length) {
      window.alert(`Complete these items before preparing a workbook:\n\n${issues.map((issue) => `• ${issue}`).join("\n")}`);
      return;
    }
    if (mode === "completed" && !ReportData.preview()?.id) {
      window.alert("Preview the current workbook before generating the completed Excel report.");
      return;
    }
    const buttons = [$("generate-xlsx"), $("download-offline"), $("generate-from-review"), $("download-offline-from-review")].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; });
    $("status").textContent = mode === "offline" ? "Preparing offline workbook…" : "Generating Excel…";
    try {
      await persistDraftNow();
      const response = await fetch("/api/estimation/workbook", {
        method: "POST",
        headers: await ReportData.requestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(ReportData.requestPayload({ state: workbookState(mode), mode, summary: estimationLinkSummary() })),
      });
      if (!response.ok) {
        const message = await response.json().catch(() => ({}));
        throw new Error(message.error || "Workbook preparation failed.");
      }
      const fileName = (response.headers.get("content-disposition")?.match(/filename="?([^";]+)"?/i)?.[1]) || "Estimation_Report.xlsx";
      const reportUrl = response.headers.get("x-report-url") || "";
      const registered = response.headers.get("x-task-registered") === "true";
      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      const generatedAt = new Date().toISOString();
      if (mode === "offline") state.details.offlineWorkbook = { fileName, generatedAt, configurationSignature: configurationSignature() };
      else {
        state.details.finalReport = { source: "Generated Excel", fileName, generatedAt, url: reportUrl };
        generatedChangeAcknowledged = false;
        window.dispatchEvent(new CustomEvent("sln:report-generated", { detail: { format: "xlsx", download: reportUrl, filename: fileName, source: "Generated Excel", estimationSummary: estimationLinkSummary(), registered } }));
      }
      scheduleSave({ reportDirty: false });
      $("status").textContent = mode === "offline" ? "Offline workbook downloaded" : "Completed Excel downloaded";
      renderAll({ sectionKey: mode === "offline" ? "offline" : "review" });
    } catch (error) {
      window.alert(workbookErrorMessage(error));
      $("status").textContent = "Workbook preparation failed";
    } finally {
      updateOutputControls();
    }
  }


  function configurationSignature() {
    return JSON.stringify({
      propertyType: state.propertyType,
      construction: state.construction,
      subtype: state.subtype,
      components: state.components.map((component) => ({ kind: component.kind, name: component.name, roofType: component.roofType, buildingConfig: component.buildingConfig, sheets: (component.sheets || []).map((sheet) => ({ key: sheet.key, label: sheet.label, level: sheet.level })) })),
      customComponentEstimates: customAbstractEntries("customComponentEstimates").map((entry) => String(entry.description || "").trim()),
    });
  }

  async function showReview() {
    const issues = workbookIssues();
    const previewMode = state.details.workMode === "offline" ? "offline" : "completed";
    const sheets = allWorksheetNames();
    const worksheets = sheets.length && requiresSeparateAbstract() ? ["Abstract", ...sheets] : sheets;
    const componentTotals = componentMeasurementEntries().map((entry) => ({ label: entry.label, total: componentSheetTotals(entry)?.amount || 0 }));
    const previewDescription = previewMode === "offline"
      ? "Previewing the configured blank workbook that will be downloaded for completion in Excel."
      : "Previewing the completed workbook generated from the current online entries.";
    $("review-content").innerHTML = `${issues.length ? `<div class="notice"><strong>${issues.length} item${issues.length === 1 ? "" : "s"} need attention</strong><ul>${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul></div>` : `<div class="notice"><strong>${escapeHtml(previewDescription)}</strong></div>`}<div class="review-grid"><div class="review-stat"><small>Draft scope</small><strong>${escapeHtml(draftScope)}</strong></div><div class="review-stat"><small>Property</small><strong>${escapeHtml(propertyProfile()?.label || "—")}</strong></div><div class="review-stat"><small>Worksheets</small><strong>${worksheets.length}</strong></div><div class="review-stat"><small>Abstract</small><strong>${worksheets.length ? (requiresSeparateAbstract() ? "Separate" : "Compact") : "—"}</strong></div></div>${worksheets.length ? `<p><strong>Workbook order:</strong> ${worksheets.map(escapeHtml).join(" → ")}</p><table class="review-table"><thead><tr><th>Component sheet</th><th>Final amount (Rs.)</th></tr></thead><tbody>${componentTotals.map((entry) => `<tr><td>${escapeHtml(entry.label)}</td><td>₹ ${formatNumber(entry.total)}</td></tr>`).join("")}</tbody></table>` : ""}<div id="workbook-preview" class="workbook-preview"><p class="hint">${issues.length ? "Resolve the listed items to render the workbook preview." : "Rendering the workbook…"}</p></div>`;
    $("review-modal").hidden = false;
    if (issues.length) return;
    const restoredPreview = ReportData.preview();
    if (restoredPreview?.url) {
      $("workbook-preview").innerHTML = `<iframe class="workbook-preview-frame" src="${escapeHtml(restoredPreview.url)}" title="Rendered estimation workbook preview"></iframe>`;
      $("status").textContent = "Latest workbook preview restored";
      updateOutputControls();
      if ($("generate-from-review")) $("generate-from-review").disabled = false;
      return;
    }
    $("status").textContent = "Rendering workbook preview…";
    try {
      await persistDraftNow();
      const response = await fetch("/api/estimation/preview", { method: "POST", headers: await ReportData.requestHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(ReportData.requestPayload({ state: workbookState(previewMode), mode: previewMode })) });
      const preview = await response.json();
      if (!response.ok) throw new Error(preview.error || "Workbook preview failed.");
      $("workbook-preview").innerHTML = `<iframe class="workbook-preview-frame" src="${escapeHtml(preview.preview)}" title="Rendered estimation workbook preview"></iframe>`;
      ReportData.setPreview({ id: preview.preview_id, url: preview.preview });
      $("status").textContent = "Workbook preview ready";
      updateOutputControls();
      if ($("generate-from-review")) $("generate-from-review").disabled = false;
    } catch (error) {
      $("workbook-preview").innerHTML = `<div class="notice"><strong>Workbook preview could not be rendered.</strong><br>${escapeHtml(workbookErrorMessage(error))}</div>`;
      $("status").textContent = "Workbook preview failed";
    }
  }

  function scheduleSave(options = {}) {
    if (options.reportDirty !== false) {
      markReportDirty();
      updateOutputControls();
    }
    $("status").classList.add("is-saving");
    $("status").setAttribute("aria-label", ReportData.localOnly ? "Saving draft locally" : "Saving draft");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => persistDraftNow().catch((error) => {
      $("status").textContent = error.message || "Draft save failed";
      $("status").classList.remove("is-saving");
    }), 700);
  }

  async function persistDraftNow() {
    window.clearTimeout(saveTimer);
    saveTimer = null;
    // A save response may arrive after the next input/upload. Estimation has no
    // server-normalized media, so keep the current browser state rather than
    // replacing newer edits with the earlier request's payload.
    await ReportData.save(DRAFT_KEY, "estimation", state, "3");
    $("status").textContent = ReportData.localOnly ? "Saved locally" : "Saved";
    $("status").classList.remove("is-saving");
    $("status").removeAttribute("aria-label");
    if (generatedChangeAcknowledged && ReportData.taskCode) await ReportData.refreshTask();
  }

  async function restoreDraft() {
    try {
      const draft = await ReportData.load(DRAFT_KEY);
      if (!draft || typeof draft !== "object") return;
      Object.assign(state, draft);
      state.components = (Array.isArray(draft.components) ? draft.components : []).map(normaliseComponent);
      state.editingComponentId = null;
      if (state.propertyType === "residential" && !state.construction) state.construction = "rcc";
      const retained = currentTask()?.latestXlsx;
      if (retained?.url && currentTask()?.reportFresh !== false && !state.details.finalReport) {
        state.details.finalReport = {
          source: retained.source || "Completed Excel",
          fileName: retained.filename,
          size: retained.size,
          storageId: retained.storageId,
          url: retained.url,
          generatedAt: retained.generatedAt,
        };
      }
      $("status").textContent = ReportData.preview()?.id ? "Draft and latest preview restored" : "Draft restored";
    } catch (_error) { $("status").textContent = "Draft could not be restored"; }
  }

  async function discardDraft() {
    if (!window.confirm("Discard this estimation draft and start with a blank configuration?")) return;
    window.clearTimeout(saveTimer);
    await ReportData.discard(DRAFT_KEY);
    Object.assign(state, { propertyType: "", construction: "", subtype: "", current: 0, details: {}, components: [], editingComponentId: null });
    $("status").textContent = "Draft discarded";
    renderAll({ sectionKey: "setup" });
  }

  function locateMeasurement(componentId, sheetId) {
    const component = state.components.find((entry) => entry.id === componentId);
    if (!component) return null;
    const sheet = sheetId === "component" ? null : (component.sheets || []).find((entry) => entry.id === sheetId);
    if (sheetId !== "component" && !sheet) return null;
    return { component, sheet, data: measurementData(component, sheet) };
  }

  function updateMeasurementInput(input) {
    const found = locateMeasurement(input.dataset.component, input.dataset.sheet);
    if (!found) return;
    const row = found.data.rows[input.dataset.row] || {};
    row[input.dataset.field] = input.value;
    found.data.rows[input.dataset.row] = row;
    refreshMeasurementCalculations(found.component, found.sheet);
    scheduleSave();
  }

  function updateCustomRowLabel(input) {
    const found = locateMeasurement(input.dataset.component, input.dataset.sheet);
    if (!found) return;
    for (const rows of Object.values(found.data.customRows)) {
      const custom = rows.find((entry) => entry.id === input.dataset.row);
      if (custom) custom.label = input.value;
    }
    scheduleSave();
  }

  function measurementSchema(component, sheet) {
    const key = measurementTemplateKey(component, sheet);
    return key ? ESTIMATION_WORKSHEETS[key] : null;
  }

  function refreshMeasurementCalculations(component, sheet) {
    const schema = measurementSchema(component, sheet);
    if (!schema) return;
    const data = measurementData(component, sheet);
    const totals = sheetCalculations(schema, data);
    const values = Object.assign({}, ...totals.calculations.map(({ calculation }) => calculation.values));
    const scope = `[data-component="${CSS.escape(component.id)}"][data-sheet="${CSS.escape(sheet?.id || "component")}"]`;
    document.querySelectorAll(`[data-calculated-value]${scope}`).forEach((target) => {
      const result = values[target.dataset.row];
      if (result) target.textContent = formatNumber(result[target.dataset.calculatedValue]);
    });
    document.querySelectorAll(`[data-derived-quantity]${scope}`).forEach((target) => {
      const result = values[target.dataset.row];
      const entered = numberOrBlank(data.rows[target.dataset.row]?.quantity);
      if (result && entered == null) target.value = result.quantity ?? "";
    });
    document.querySelectorAll(`[data-item-calculated]${scope}`).forEach((target) => {
      const current = totals.calculations.find(({ item }) => item.itemKey === target.dataset.itemCalculated);
      if (current) target.textContent = formatNumber(current.calculation.calculatedAmount);
    });
    document.querySelectorAll(`[data-item-final-input]${scope}`).forEach((target) => {
      const current = totals.calculations.find(({ item }) => item.itemKey === target.dataset.item);
      if (current && current.calculation.overrideAmount == null) target.value = current.calculation.calculatedAmount || "";
    });
    document.querySelectorAll(`[data-sheet-calculated]${scope}`).forEach((target) => { target.textContent = formatNumber(totals.calculatedAmount); });
    document.querySelectorAll(`[data-sheet-final-input]${scope}`).forEach((target) => { if (totals.overrideAmount == null) target.value = totals.calculatedAmount || ""; });
  }

  function updateItemFinalAmount(input) {
    const found = locateMeasurement(input.dataset.component, input.dataset.sheet);
    if (!found) return;
    const value = numberOrBlank(input.value);
    if (value == null) delete found.data.itemOverrides[input.dataset.item];
    else found.data.itemOverrides[input.dataset.item] = value;
    refreshMeasurementCalculations(found.component, found.sheet);
    scheduleSave();
  }

  function updateSheetFinalAmount(input) {
    const found = locateMeasurement(input.dataset.component, input.dataset.sheet);
    if (!found) return;
    const value = numberOrBlank(input.value);
    if (value == null) delete found.data.sheetTotalOverride;
    else found.data.sheetTotalOverride = value;
    refreshMeasurementCalculations(found.component, found.sheet);
    scheduleSave();
  }

  function customItemSource(parentItemKey, schema) {
    if (!schema) return null;
    const match = /^standard-(\d+)$/.exec(parentItemKey || "");
    return match ? schema.items()[Number(match[1])] : null;
  }

  function addCustomItem(componentId, sheetId, parentItemKey) {
    const found = locateMeasurement(componentId, sheetId);
    const schema = found && measurementSchema(found.component, found.sheet);
    const parent = customItemSource(parentItemKey, schema);
    if (!found || !parent) return;
    found.data.customItems[parentItemKey] = found.data.customItems[parentItemKey] || [];
    found.data.customItems[parentItemKey].push({ id: `custom-item-${uid()}`, shortDescription: `Custom: ${parent.label}`, detailedDescription: "" });
    renderAll({ sectionKey: `measure-${componentId}${sheetId === "component" ? "" : `-${sheetId}`}` });
    scheduleSave();
  }

  function removeCustomItem(componentId, sheetId, itemKey) {
    const found = locateMeasurement(componentId, sheetId);
    if (!found) return;
    for (const [parent, items] of Object.entries(found.data.customItems)) {
      found.data.customItems[parent] = items.filter((item) => item.id !== itemKey);
    }
    delete found.data.itemOverrides[itemKey];
    Object.keys(found.data.rows).filter((key) => key.startsWith(`${itemKey}:`)).forEach((key) => delete found.data.rows[key]);
    Object.keys(found.data.customRows).filter((key) => key.startsWith(`${itemKey}:`)).forEach((key) => delete found.data.customRows[key]);
    renderAll({ sectionKey: `measure-${componentId}${sheetId === "component" ? "" : `-${sheetId}`}` });
    scheduleSave();
  }

  function updateCustomItemText(input, field) {
    const found = locateMeasurement(input.dataset.component, input.dataset.sheet);
    if (!found) return;
    for (const items of Object.values(found.data.customItems)) {
      const item = items.find((entry) => entry.id === input.dataset.item);
      if (item) item[field] = input.value;
    }
    scheduleSave();
  }

  function updateCommonWork(input) {
    state.details.commonExternalWorks = state.details.commonExternalWorks || {};
    state.details.commonExternalWorks[input.dataset.commonWork] = input.value;
    refreshAbstractTotals();
    scheduleSave();
  }

  function refreshAbstractTotals() {
    const commonTotal = abstractIncludesCommonWorks() ? COMMON_EXTERNAL_WORKS.reduce((sum, label) => sum + (numberOrBlank(state.details.commonExternalWorks?.[label]) || 0), 0) + customAbstractTotal("customCommonExternalWorks") : 0;
    const componentTotal = componentMeasurementEntries().reduce((sum, entry) => sum + (componentSheetTotals(entry)?.amount || 0), 0) + customAbstractTotal("customComponentEstimates");
    document.querySelectorAll("[data-common-works-total]").forEach((target) => { target.textContent = formatNumber(commonTotal); });
    document.querySelectorAll("[data-abstract-total]").forEach((target) => { target.textContent = formatNumber(componentTotal + commonTotal); });
  }

  function addAbstractCustom(type) {
    const key = type === "common" ? "customCommonExternalWorks" : "customComponentEstimates";
    customAbstractEntries(key).push({ id: `abstract-custom-${uid()}`, description: "", amount: "" });
    renderAll({ sectionKey: "abstract" });
    scheduleSave();
  }

  function updateAbstractCustom(input, field) {
    const key = input.dataset.abstractCustomType === "common" ? "customCommonExternalWorks" : "customComponentEstimates";
    const entry = customAbstractEntries(key).find((item) => item.id === input.dataset.abstractCustomId);
    if (!entry) return;
    entry[field] = input.value;
    refreshAbstractTotals();
    scheduleSave();
  }

  function removeAbstractCustom(type, id) {
    const key = type === "common" ? "customCommonExternalWorks" : "customComponentEstimates";
    state.details[key] = customAbstractEntries(key).filter((item) => item.id !== id);
    renderAll({ sectionKey: "abstract" });
    scheduleSave();
  }

  function updateAbstractComponentTotal(input) {
    const found = locateMeasurement(input.dataset.component, input.dataset.sheet);
    const schema = found && measurementSchema(found.component, found.sheet);
    if (!found || !schema) return;
    const before = sheetCalculations(schema, found.data).amount;
    const next = numberOrBlank(input.value);
    const description = next == null ? "restore the calculated sheet total" : `set the final sheet total to ₹ ${formatNumber(next)}`;
    if (before !== (next ?? sheetCalculations(schema, found.data).calculatedAmount) && !window.confirm(`This will ${description} on both the Abstract and the source component sheet. Continue?`)) {
      renderAll({ sectionKey: "abstract" });
      return;
    }
    if (next == null) delete found.data.sheetTotalOverride;
    else found.data.sheetTotalOverride = next;
    renderAll({ sectionKey: "abstract" });
    scheduleSave();
  }

  function addCustomMeasurementRow(componentId, sheetId, parentRowId) {
    const found = locateMeasurement(componentId, sheetId);
    if (!found) return;
    const schema = measurementSchema(found.component, found.sheet);
    const baseRowId = parentRowId.includes(":") ? parentRowId.slice(parentRowId.lastIndexOf(":") + 1) : parentRowId;
    const parent = schema?.items().flatMap((item) => item.rows).find((row) => row.id === baseRowId);
    if (!parent?.customizable) return;
    found.data.customRows[parentRowId] = found.data.customRows[parentRowId] || [];
    found.data.customRows[parentRowId].push({ id: `custom-${uid()}`, label: `Custom: ${parent.label}` });
    renderAll({ sectionKey: `measure-${componentId}${sheetId === "component" ? "" : `-${sheetId}`}` });
    scheduleSave();
  }

  function removeCustomMeasurementRow(componentId, sheetId, parentRowId, rowId) {
    const found = locateMeasurement(componentId, sheetId);
    if (!found) return;
    found.data.customRows[parentRowId] = (found.data.customRows[parentRowId] || []).filter((entry) => entry.id !== rowId);
    delete found.data.rows[rowId];
    renderAll({ sectionKey: `measure-${componentId}${sheetId === "component" ? "" : `-${sheetId}`}` });
    scheduleSave();
  }

  function wireEvents() {
    document.querySelectorAll("#estimation-form input:not([type=file]), #estimation-form select, #estimation-form textarea").forEach((input) => {
      input.addEventListener("focus", () => {
        input.dataset.previousValue = input.value;
        input.dataset.previousChecked = String(input.checked);
      });
      if (input.name === "work-mode") return;
      if (input.type === "checkbox" || input.type === "radio") {
        input.addEventListener("click", (event) => {
          if (!confirmReportInvalidation()) event.preventDefault();
        });
      } else if (input.tagName !== "SELECT") {
        input.addEventListener("beforeinput", (event) => {
          if (!confirmReportInvalidation()) event.preventDefault();
        });
      }
      input.addEventListener("change", (event) => {
        if (!confirmReportInvalidation()) {
          input.value = input.dataset.previousValue ?? input.value;
          if (input.type === "checkbox" || input.type === "radio") input.checked = input.dataset.previousChecked === "true";
          event.stopImmediatePropagation();
          renderAll({ sectionKey: document.querySelector("#sections .panel.active")?.dataset.key || "components" });
          return;
        }
        input.dataset.previousValue = input.value;
        input.dataset.previousChecked = String(input.checked);
      }, true);
    });
    document.querySelectorAll("#nav button").forEach((button) => button.addEventListener("click", () => showSection(Number(button.dataset.sectionIndex), { scroll: true })));
    document.querySelectorAll('[name="property-type"]').forEach((input) => input.addEventListener("change", () => setPropertyType(input.value)));
    document.querySelectorAll('[name="construction"]').forEach((input) => input.addEventListener("change", () => setConstruction(input.value)));
    document.querySelectorAll('[name="measurement-method"]').forEach((input) => input.addEventListener("change", () => setMeasurementMethod(input.value)));
    document.querySelectorAll('[name="work-mode"]').forEach((input) => input.addEventListener("change", () => setWorkMode(input.value)));
    $("property-subtype")?.addEventListener("change", (event) => { state.subtype = event.target.value; renderAll({ sectionKey: "configuration" }); scheduleSave(); });
    document.querySelectorAll("[data-detail]").forEach((input) => input.addEventListener("input", () => { state.details[input.dataset.detail] = input.value; if (input.type === "date") dateError(input); scheduleSave(); }));
    document.querySelectorAll("[data-measurement-input]").forEach((input) => input.addEventListener("input", () => updateMeasurementInput(input)));
    document.querySelectorAll("[data-row-label]").forEach((input) => input.addEventListener("input", () => updateCustomRowLabel(input)));
    document.querySelectorAll("[data-item-final-input]").forEach((input) => input.addEventListener("change", () => updateItemFinalAmount(input)));
    document.querySelectorAll("[data-sheet-final-input]").forEach((input) => input.addEventListener("change", () => updateSheetFinalAmount(input)));
    document.querySelectorAll("[data-custom-item-short]").forEach((input) => input.addEventListener("input", () => updateCustomItemText(input, "shortDescription")));
    document.querySelectorAll("[data-custom-item-detail]").forEach((input) => input.addEventListener("input", () => updateCustomItemText(input, "detailedDescription")));
    document.querySelectorAll("[data-common-work]").forEach((input) => input.addEventListener("input", () => updateCommonWork(input)));
    document.querySelectorAll("[data-abstract-custom-description]").forEach((input) => input.addEventListener("input", () => updateAbstractCustom(input, "description")));
    document.querySelectorAll("[data-abstract-custom-amount]").forEach((input) => input.addEventListener("input", () => updateAbstractCustom(input, "amount")));
    document.querySelectorAll("[data-abstract-component-final]").forEach((input) => input.addEventListener("change", () => updateAbstractComponentTotal(input)));
    $("component-type")?.addEventListener("change", (event) => { const wrap = $("custom-roof-wrap"); if (wrap) wrap.hidden = componentDefinition(event.target.value)?.roofType !== "custom"; });
    $("add-component")?.addEventListener("click", () => { if (confirmReportInvalidation()) addComponent(); });
    $("generate-from-review")?.addEventListener("click", () => downloadWorkbook("completed"));
    $("download-offline-from-review")?.addEventListener("click", () => downloadWorkbook("offline"));
    document.querySelectorAll("[data-building-base], [data-building-upper]").forEach((input) => input.addEventListener("input", () => {
      const componentId = input.dataset.buildingBase || input.dataset.buildingUpper;
      refreshTypicalFloorOptions(componentId);
      updateBuildingImpact(componentId);
    }));
    document.querySelectorAll("[data-building-typical]").forEach((input) => input.addEventListener("change", () => updateBuildingImpact(input.dataset.buildingTypical)));
    document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
      const { action, component } = button.dataset;
      const mutatingActions = new Set(["remove-component", "add-abstract-custom", "remove-abstract-custom", "move-component-up", "move-component-down", "save-building-config", "add-custom-row", "remove-custom-row", "add-custom-item", "remove-custom-item", "reset-item-total", "reset-sheet-total"]);
      if (mutatingActions.has(action) && !confirmReportInvalidation()) return;
      if (action === "remove-component") removeComponent(component);
      if (action === "add-abstract-custom") addAbstractCustom(button.dataset.abstractCustomType);
      if (action === "remove-abstract-custom") removeAbstractCustom(button.dataset.abstractCustomType, button.dataset.abstractCustomId);
      if (action === "go-to-section") {
        const target = document.querySelector(`#nav button[data-section-key="${CSS.escape(button.dataset.sectionKey)}"]`);
        target?.click();
      }
      if (action === "move-component-up") moveComponent(component, -1);
      if (action === "move-component-down") moveComponent(component, 1);
      if (action === "change-building-config") { state.editingComponentId = component; renderAll({ sectionKey: "components" }); }
      if (action === "cancel-building-config") { state.editingComponentId = null; renderAll({ sectionKey: "components" }); }
      if (action === "save-building-config") saveBuildingConfiguration(component);
      if (action === "add-custom-row") addCustomMeasurementRow(component, button.dataset.sheet, button.dataset.parentRow);
      if (action === "remove-custom-row") removeCustomMeasurementRow(component, button.dataset.sheet, button.dataset.parentRow, button.dataset.row);
      if (action === "add-custom-item") addCustomItem(component, button.dataset.sheet, button.dataset.parentItem);
      if (action === "remove-custom-item") removeCustomItem(component, button.dataset.sheet, button.dataset.item);
      if (action === "reset-item-total") {
        const found = locateMeasurement(component, button.dataset.sheet);
        if (found) { delete found.data.itemOverrides[button.dataset.item]; renderAll({ sectionKey: `measure-${component}${button.dataset.sheet === "component" ? "" : `-${button.dataset.sheet}`}` }); scheduleSave(); }
      }
      if (action === "reset-sheet-total") {
        const found = locateMeasurement(component, button.dataset.sheet);
        if (found) { delete found.data.sheetTotalOverride; renderAll({ sectionKey: `measure-${component}${button.dataset.sheet === "component" ? "" : `-${button.dataset.sheet}`}` }); scheduleSave(); }
      }
      if (action === "toggle-calculation-info") {
        const popover = button.parentElement?.querySelector(".calculation-info-popover");
        if (popover) {
          popover.hidden = !popover.hidden;
          button.setAttribute("aria-expanded", String(!popover.hidden));
        }
      }
    }));
  }

  $("previous").addEventListener("click", () => showSection(state.current - 1, { scroll: true }));
  $("next").addEventListener("click", () => showSection(state.current + 1, { scroll: true }));
  $("review-report").addEventListener("click", showReview);
  $("generate-xlsx").addEventListener("click", () => downloadWorkbook("completed"));
  $("download-offline").addEventListener("click", () => downloadWorkbook("offline"));
  $("discard-draft").addEventListener("click", () => discardDraft().catch((error) => { $("status").textContent = error.message || "Draft could not be discarded"; }));
  $("close-review").addEventListener("click", () => { $("review-modal").hidden = true; });
  $("review-modal").addEventListener("click", (event) => { if (event.target === $("review-modal")) $("review-modal").hidden = true; });
  await restoreDraft();
  if (currentTask()) state.details.applicantName = currentTask().customerName;
  renderAll({ sectionKey: "setup" });
})();
