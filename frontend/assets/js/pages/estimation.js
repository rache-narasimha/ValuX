/** Estimation report form controller and task-scoped draft workflow. */
(async function () {
  "use strict";

  const { PROPERTY_TYPES, FLOOR_OPTIONS, BUILDING_CONFIGURATIONS, ESTIMATION_WORKSHEETS } = window.EstimationSchema;
  const params = new URLSearchParams(window.location.search);
  const draftScope = params.get("practice") === "1" ? "practice" : params.get("task") ? `task-${params.get("task")}` : "standalone";
  const DRAFT_KEY = `sln.estimation.form.draft.v3-${draftScope}`;
  const TODAY = localToday();
  const state = { propertyType: "", construction: "", subtype: "", current: 0, details: {}, components: [], editingComponentId: null };
  const offlineEntry = window.EstimationOffline.create({ state, currentTask, externalReportOnly: industrialCentreLine, setupComplete: reportSetupComplete, persist: persistDraftNow, save: () => scheduleSave({ reportDirty: false }), render: () => renderAll({sectionKey: "offline"}), dirty: markReportDirty, confirmUploadType: (previous, next) => confirmPreparationChange("upload type", previous, next), preparationChanged, downloadTemplate: async () => {
    if (industrialCentreLine()) return;
    if (!propertyConfigurationComplete() || !state.components.length) { state.details.templateSetup = true; renderAll({sectionKey: "configuration"}); return; }
    await downloadWorkbook("offline");
    if (ReportData.taskCode) await TaskStore.refresh(ReportData.taskCode);
  }});
  const dimensionEdits = new Map();
  let dimensionSelection = "";
  let measurementLayoutDirty = false;
  const outsideAxes = ["long", "short"];
  let saveTimer = null;
  let editVersion = 0;
  let generatedChangeAcknowledged = false;

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  const autofilled = (value, system = true) => system && value != null && value !== "" ? " data-tab-autofilled" : "";
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

  function confirmPreparationChange(kind, previous, next) {
    if (EstimationProcessing.isBusy()) return false;
    if (!previous && !currentTask()?.reportGeneratedAt && !state.details.finalReport) return true;
    const labels = {online: "Fill online", offline: "Complete offline and upload", template: "Filled template", retrospective: "Retrospective report"};
    return window.confirm(`Change ${kind} to ${labels[next] || "no upload type"}? Your entered details, component configuration and measurements will be retained. Any existing report or preview will no longer qualify; generate or submit a fresh report before completing the task. Switching back will also require a fresh report.`);
  }

  function preparationChanged(previous) {
    // A return to an earlier method must not revive an earlier report/preview.
    if (previous || currentTask()?.reportGeneratedAt || state.details.finalReport) state.details.preparationRevision = (Number(state.details.preparationRevision) || 0) + 1;
    editVersion++;
    generatedChangeAcknowledged = false;
    markReportDirty();
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

  function newMeasurementSheet(floor, existing) {
    const sheet = makeSheetState(floor, existing);
    if (!existing) {
      sheet.formData.dimensionsRequired = true;
      sheet.layoutVersion = 2;
    }
    if (sheet.typicalFloorKeys.length > 1 && !(existing?.typicalFloorKeys?.length > 1)) {
      sheet.typicalBasis = "per-floor";
      sheet.layoutVersion = 2;
    }
    if (sheet.typicalFloorKeys.length < 2) delete sheet.typicalBasis;
    return sheet;
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
    return component.sheets.slice().sort((left, right) => left.level - right.level).map((sheet) => EstimationNaming.label(state, component, sheet));
  }

  function allWorksheetNames() { return state.components.flatMap(componentSheets); }

  function residentialUsesCompactAbstract() { return EstimationNaming.compact(state); }

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

  function setupPanel() {
    const details = state.details;
    return ValuxUI.estimationSetupPanel([
      { id: "estimate-date", label: "Date of Estimation", detail: "estimateDate", value: details.estimateDate, type: "date" },
      { id: "place", label: "Place", detail: "place", value: details.place },
      { id: "applicant-name", label: "Name of the Applicant", detail: "applicantName", value: details.applicantName,
        autofilled: details.applicantName === currentTask()?.customerName,
        help: "Enter the applicant name and place, for example: Customer Name, Adoni." },
      { id: "work-description", label: "Name of the Work", detail: "workDescription", value: details.workDescription, type: "textarea",
        help: "Enter the overall proposed work without its address. Put the site address in Address of the Work; the report combines them once." },
      { id: "work-address", label: "Address of the Work", detail: "workAddress", value: details.workAddress, type: "textarea" },
    ]);
  }

  function configurationPanel() {
    const profile = propertyProfile();
    const types = [["industrial", "Industrial"], ["commercial", "Commercial"], ["residential", "Residential"]]
      .map(([value, label]) => ({ value, label, help: PROPERTY_TYPES[value].description }));
    const constructionChoices = [
      ["rcc", "RCC roof", "RCC buildings and approved floor sheets."],
      ["shed", "Shed roof", "Shed halls and shed-roof buildings."],
      ["hybrid", "Hybrid", "RCC and shed components in one estimate."],
    ].map(([value, label, help]) => ({ value, label, help, disabled: !profile?.construction.includes(value) }));
    const methods = supportsCentreLineMethod() ? [
      { value: "long_wall_short_wall", label: "Long Wall / Short Wall",
        help: "Enter separate long-wall and short-wall measurements." },
      { value: "centre_line", label: "Centre Line", help: state.propertyType === "industrial"
        ? "Prepare the estimate offline and upload the completed report."
        : "Enter all-round and centre-wall measurement segments." },
    ] : [];
    return ValuxUI.estimationConfigurationPanel({
      types, constructionChoices, profile, methods, propertyType: state.propertyType,
      construction: state.construction, subtype: state.subtype, measurementMethod: selectedMeasurementMethod(),
    });
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
    const offlineOnly = industrialCentreLine();
    return ValuxUI.estimationPreparationPanel([
      { value: "online", label: "Fill online", disabled: offlineOnly, help: offlineOnly
        ? "Industrial Centre Line estimates must be prepared offline."
        : "Enter measurements here, preview the rendered workbook, then generate the completed Excel report." },
      { value: "offline", label: "Complete offline and upload", help: offlineOnly
        ? "Attach your completed industrial Centre Line report and review its component totals."
        : "Attach a completed template or an existing report, review component totals, then submit it." },
    ], offlineOnly && state.details.workMode === "online" ? "" : state.details.workMode);
  }

  async function setWorkMode(mode, measurementMethod = selectedMeasurementMethod()) {
    const offlineOnly = industrialCentreLine(measurementMethod);
    if (!["online", "offline"].includes(mode) || (mode === "online" && offlineOnly)) return;
    if (state.details.workMode === mode) return;
    const label = mode === "online" ? "Fill online" : "Complete offline and upload";
    if (!confirmPreparationChange("preparation method", state.details.workMode, mode)) {
      renderAll({ sectionKey: currentKey() });
      return;
    }
    const previous = state.details.workMode;
    state.details.workMode = mode;
    if (offlineOnly) {
      state.details.measurementMethod = measurementMethod;
      if (state.details.uploadType === "template") delete state.details.uploadType;
    }
    preparationChanged(previous);
    renderAll({ sectionKey: mode === "online" ? "configuration" : "offline" });
    try {
      await persistDraftNow();
      if (ReportData.taskCode) await ReportData.refreshTask();
      $("status").textContent = `Preparation method changed to ${label}. Existing component data was retained.`;
      updateOutputControls();
    } catch (error) { $("status").textContent = error.message || "Preparation method could not be saved"; }
  }

  function selectedWorkModeControl() {
    const mode = document.querySelector('input[name="work-mode"]:checked')?.value;
    return ['online', 'offline'].includes(mode) ? mode : "";
  }

  async function synchroniseWorkMode() {
    // The rendered radio control is the user's most recent explicit choice.
    // Reconcile it before preview/download actions so a browser-restored form
    // value can never disagree with the in-memory draft state.
    const selected = selectedWorkModeControl();
    if (selected && state.details.workMode !== selected) {
      await setWorkMode(selected);
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
    return `<fieldset class="typical-floor-picker" data-typical-floor-picker="${component.id}"><legend>Typical Floors <span class="optional-label">Optional</span></legend><p>Select floors with matching layouts to use one worksheet. New groups use one-floor inputs and multiply each amount by the number of floors. Existing combined groups keep their original entry basis.</p><div class="typical-floor-options">${floors.map((floor) => `<label><input type="checkbox" data-building-typical="${component.id}" value="${floor.key}" ${selected.has(floor.key) ? "checked" : ""}><span>${escapeHtml(floor.label)}</span></label>`).join("")}</div></fieldset>`;
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
    const component = { id: uid(), kind: definition.kind, name: $("component-name")?.value.trim() || defaultName, roofType, sheets: [], formData: { dimensionsRequired: definition.floorMode === "none" } };
    if (definition.floorMode === "building") {
      component.buildingConfig = defaultBuildingConfiguration();
      component.sheets = sheetPlan(component.buildingConfig).map((floor) => newMeasurementSheet(floor));
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
    return state.propertyType === "industrial" ? Boolean(state.construction)
      : ["commercial", "residential"].includes(state.propertyType) && ["rcc", "hybrid"].includes(state.construction);
  }

  function industrialCentreLine(method = selectedMeasurementMethod()) {
    return state.propertyType === "industrial" && method === "centre_line";
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
    if (industrialCentreLine(method) && state.details.workMode !== "offline") {
      void setWorkMode("offline", method);
      return;
    }
    const returningToOnlineChoice = industrialCentreLine() && method === "long_wall_short_wall" && state.details.workMode === "offline";
    if (industrialCentreLine(method) && state.details.uploadType === "template") delete state.details.uploadType;
    const affected = state.components.filter(componentUsesRccMeasurements);
    const entered = affected.filter(componentHasMeasurementData);
    if (entered.length && !window.confirm(`Changing the measurement method removes entered measurement data for ${entered.length} RCC component${entered.length === 1 ? "" : "s"}. Continue?`)) {
      renderAll({ sectionKey: "configuration" });
      return;
    }
    entered.forEach((component) => {
      component.formData = {};
      (component.sheets || []).forEach((sheet) => {
        dimensionEdits.delete(`measure-${component.id}-${sheet.id}`);
        sheet.formData = { dimensionsRequired: Boolean(sheet.formData?.dimensionsRequired || sheet.formData?.dimensionSetup) };
      });
    });
    state.details.measurementMethod = method;
    state.details.finalReport = null;
    state.details.prototypeCompletion = false;
    const nextSection = industrialCentreLine() ? "offline" : returningToOnlineChoice ? "preparation" : "configuration";
    renderAll({ sectionKey: nextSection });
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
    const foundation = configuredFloors(proposal)[0];
    const originalGroup = component.sheets.find((sheet) => sheet.typicalFloorKeys?.length > 1);
    const futureGroup = sheetPlan(proposal).find((sheet) => sheet.typicalFloorKeys?.length > 1);
    const sameGroup = JSON.stringify(originalGroup?.typicalFloorKeys || []) === JSON.stringify(futureGroup?.typicalFloorKeys || []);
    if (futureGroup?.typicalFloorKeys.includes(foundation?.key) && !sameGroup) {
      return window.alert("Keep the lowest floor separate so its foundation work is counted once.");
    }
    if (!sameGroup && originalGroup && originalGroup.typicalBasis !== "per-floor"
      && !window.confirm("This changes a saved combined-quantity group. Review the retained worksheet quantities and amounts before preparing a new report. Continue?")) return;
    if (impact.removed.length && !window.confirm(`This change removes ${impact.removed.map((sheet) => sheet.label).join(", ")} and all data entered on those sheet${impact.removed.length === 1 ? "" : "s"}. Continue?`)) return;
    const existing = new Map((component.sheets || []).map((sheet) => [sheet.key, sheet]));
    component.buildingConfig = proposal;
    component.sheets = sheetPlan(proposal).map((floor) => newMeasurementSheet(floor, existing.get(floor.key)));
    refreshInheritedMeasurements(component);
    state.editingComponentId = null;
    renderAll({ sectionKey: "components" });
    scheduleSave();
  }

  function reviewPanel() {
    const sheets = allWorksheetNames();
    const worksheetOrder = sheets.length && requiresSeparateAbstract() ? ["Abstract", ...sheets] : sheets;
    return `<div class="panel" data-key="review"><h2>Configuration Review</h2><p class="hint">Review the planned worksheets and report totals before creating a generated Excel report or a configured offline workbook.</p><div class="review-grid"><div class="review-stat"><small>Property</small><strong>${escapeHtml(propertyProfile()?.label || "Not selected")}</strong></div><div class="review-stat"><small>Components</small><strong>${state.components.length}</strong></div><div class="review-stat"><small>Worksheets</small><strong>${worksheetOrder.length}</strong></div><div class="review-stat"><small>Abstract</small><strong>${sheets.length ? (EstimationNaming.groundOnly(state) ? "Not needed for Ground Floor only" : requiresSeparateAbstract() ? "Separate first sheet" : "Compact on last sheet") : "Not determined"}</strong></div></div>${worksheetOrder.length ? `<section class="subgroup"><h3>Planned workbook order</h3><ol class="worksheet-order">${worksheetOrder.map((sheet) => `<li>${escapeHtml(sheet)}${sheet === "Abstract" ? "" : " <span class=\"soft-badge\">detail sheet</span>"}</li>`).join("")}</ol>${!requiresSeparateAbstract() && !EstimationNaming.groundOnly(state) ? `<p class="hint">The compact Abstract will be placed above Place, Date and Signature on the final selected residential sheet.</p>` : ""}</section>${reportOutputPanel()}` : `<div class="empty-state">Select components to see the planned workbook order.</div>`}</div>`;
  }

  function finalReportRecord() { return state.details.finalReport && typeof state.details.finalReport === "object" ? state.details.finalReport : null; }

  function reportOutputPanel() {
    const finalReport = finalReportRecord();
    const task = currentTask();
    const retained = task && TaskStore.latestArtifact(task);
    const outdated = Boolean(task?.reportFresh === false || retained && !finalReport);
    const ready = Boolean(finalReport && !outdated);
    const fileName = finalReport?.fileName || retained?.filename || "";
    const previewReady = Boolean(ReportData.preview()?.totalsReviewed);
    const retainedDownload = ready && finalReport.url
      ? `<a class="button-link secondary report-file-download" href="${escapeHtml(finalReport.url)}${finalReport.url.includes("?") ? "&" : "?"}download=1" download title="Download Excel report" aria-label="Download Excel report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4h14v-4"/></svg></a>` : "";
    return `<section class="output-grid"><div class="output-card ${ready ? "is-complete" : "is-pending"}"><div class="report-output-record"><span class="report-output-icon" aria-hidden="true">${ready ? "✓" : outdated ? "!" : "↓"}</span><div class="report-output-copy"><h3>${ready ? "Excel report ready" : outdated ? "Report outdated—generate again" : "Prepare Excel report"}</h3>${fileName ? `<p class="report-output-filename" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</p>` : ""}<p>${ready ? task?.status === "In Progress" ? "Saved to this report. Mark the task Completed when your review is finished." : "Generated from the current workbook inputs." : "Preview the current workbook, then generate a fresh Excel report."}</p></div><div class="output-actions"><button type="button" class="primary" id="generate-from-review" ${previewReady ? "" : "disabled"}>${ready ? "Generate again" : "Generate Excel"}</button>${retainedDownload}</div></div></div></section>`;
  }

  function typicalMultiplier(sheet) {
    return sheet?.typicalBasis === "per-floor" ? Math.max(1, sheet.typicalFloorKeys?.length || 0) : 1;
  }

  function measurementTemplateKey(component, sheet) {
    const aboveFoundation = sheet?.layoutVersion === 2
      && (component.sheets || []).some((floor) => floor.level < sheet.level);
    if (component.kind === "storage_shed") return "storage_shed";
    if (component.kind === "heavy_machinery_hall") return "heavy_machinery_hall";
    if (component.kind === "normal_machinery_hall") return "normal_machinery_hall";
    if (state.propertyType === "industrial" && ["rcc_building", "office_amenity", "utility_structure"].includes(component.kind)) {
      if (aboveFoundation) return "rcc_upper";
      if (sheet?.key === "cellar") return "industrial_cellar";
      if (sheet?.key === "stilt") return "industrial_stilt";
      if (sheet?.key === "ground") return "rcc_ground";
      if (sheet && sheet.level > 1) return "rcc_upper";
    }
    if (component.kind === "shed_hall") return "commercial_shed_hall";
    if (component.kind === "rcc_building" && state.propertyType === "commercial") {
      const suffix = selectedMeasurementMethod() === "centre_line" ? "_centre_line" : "";
      if (aboveFoundation) return `commercial_rcc_upper${suffix}`;
      if (sheet?.key === "cellar") return `commercial_rcc_cellar${suffix}`;
      if (sheet?.key === "stilt") return `commercial_rcc_stilt${suffix}`;
      if (sheet?.key === "ground") return `commercial_rcc_ground${suffix}`;
      if (sheet && sheet.level > 1) return `commercial_rcc_upper${suffix}`;
    }
    if (component.kind === "residential_building") {
      const suffix = selectedMeasurementMethod() === "centre_line" ? "_centre_line" : "";
      if (aboveFoundation) return `residential_upper${suffix}`;
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
      if (definition.floorMode === "building") return (component.sheets || []).map((sheet) => ({ component, sheet, key: `measure-${component.id}-${sheet.id}`, label: EstimationNaming.label(state, component, sheet) }));
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
      if (schema === ESTIMATION_WORKSHEETS.storage_shed && base.rows.every((row) => row.id === "truss-a")) return;
      const itemKey = `standard-${index}`;
      const storage = schema === ESTIMATION_WORKSHEETS.storage_shed;
      if (!data.omittedItems?.[itemKey]) {
        items.push({ ...base, storage, itemKey, displaySno: base.sno == null ? null : nextSno++ });
      }
      (data.customItems[itemKey] || []).forEach((custom) => {
        items.push({
          ...base,
          storage,
          itemKey: custom.id,
          parentItemKey: itemKey,
          instanceKey: custom.id,
          isCustomItem: true,
          label: custom.shortDescription?.trim() || "Custom item",
          originalLabel: base.label,
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
    const singleMeasurement = item.rows.filter((row) => row.calculation !== "heading").length === 1;
    item.rows.forEach((base) => {
      const usesItemLabel = item.isCustomItem && (base.label === item.originalLabel || (singleMeasurement && base.calculation !== "heading"));
      const baseId = scopedId(base.id);
      const inputs = data.rows[baseId];
      const changes = EstimationDimensions.rowChanges(base, inputs, item.storage);
      if (changes.hidden) return;
      if (!inputs?.setupOmitted) rows.push({
        ...base, ...changes, instanceId: baseId, baseId,
        label: usesItemLabel ? item.label : changes.label ?? base.label, usesItemLabel,
        sourceId: base.sourceId ? scopedId(base.sourceId) : undefined, isCustom: false,
      });
      const customRows = data.customRows[baseId] || [];
      const setupRows = data.dimensionSetup?.additions?.[baseId] || [];
      [...customRows, ...setupRows].forEach((custom) => rows.push({
        ...base, id: custom.id, instanceId: custom.id, baseId,
        sourceId: base.sourceId ? scopedId(base.sourceId) : undefined,
        isCustom: true, setupRow: setupRows.includes(custom), label: custom.label || `Custom: ${base.label}`,
      }));
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

  function sheetCalculations(schema, data, multiplier = 1) {
    const items = templateItems(schema, data);
    const roundPricing = !ReportData.readOnly || state.details.pricingBasis === "displayed";
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
      if (entry.calculation === "lump_sum") {
        const entered = numberOrBlank(input.amount);
        values[entry.instanceId].amount = entered == null || !roundPricing ? entered : displayedNumber(entered);
      }
    });

    // Resolve derived rows after their RCC source rows. An entered quantity on
    // a derived row is a deliberate valuer adjustment and takes precedence.
    for (let pass = 0; pass < 8; pass += 1) {
      rows.forEach((entry) => {
        const input = directInputs(entry);
        let quantity = values[entry.instanceId].quantity;
        if (entry.calculation === "derived") {
          const source = values[entry.sourceId]?.quantity;
          quantity = numberOrBlank(input.quantity) ?? (source == null ? null : source * (numberOrBlank(input.factor) ?? entry.multiplier));
        }
        if (entry.calculation === "derived_expression") {
          const source = values[entry.sourceId]?.quantity;
          quantity = numberOrBlank(input.quantity) ?? (source == null ? null : source * (numberOrBlank(input.factor) ?? 10));
        }
        if (entry.calculation === "subtotal") quantity = groupHasValue(entry, entry.sourceGroup) ? groupQuantity(entry, entry.sourceGroup) : null;
        if (entry.calculation === "percentage") {
          const sourceGroups = entry.includeSourceGroups || [entry.sourceGroup];
          const hasValue = sourceGroups.some((group) => groupHasValue(entry, group));
          quantity = hasValue ? sourceGroups.reduce((total, group) => total + groupQuantity(entry, group), 0) * entry.percentage : null;
        }
        if (!["heading", "lump_sum"].includes(entry.calculation)) {
          quantity = numberOrBlank(input.directQuantity) ?? numberOrBlank(input.setupQuantity) ?? quantity;
        }
        values[entry.instanceId].quantity = cleanNumber(quantity);
      });
    }

    rows.forEach((entry) => {
      const value = values[entry.instanceId];
      if (entry.rate) {
        const rate = numberOrBlank(directInputs(entry).rate);
        const quantity = value.quantity;
        if (quantity != null && rate != null) {
          value.amount = roundPricing
            ? displayedPrice(quantity, rate)
            : quantity * rate;
        }
      }
      if (value.amount != null) value.amount *= multiplier;
    });
    const calculations = prepared.map(({ item, rows: itemRows }) => {
      const calculatedAmount = itemRows.reduce((total, entry) => total + (values[entry.instanceId].amount || 0), 0);
      const perFloorOverride = numberOrBlank(data.itemOverrides[item.itemKey]);
      const overrideAmount = perFloorOverride == null ? null : (roundPricing ? displayedNumber(perFloorOverride) : perFloorOverride) * multiplier;
      return { item, calculation: { rows: itemRows, values, calculatedAmount, overrideAmount, perFloorOverride, amount: overrideAmount ?? calculatedAmount } };
    });
    const calculatedAmount = calculations.reduce((sum, entry) => sum + entry.calculation.amount, 0);
    const entered = numberOrBlank(data.sheetTotalOverride);
    const overrideAmount = entered == null || !roundPricing ? entered : displayedNumber(entered);
    const adopted = overrideAmount ?? (roundPricing ? displayedNumber(calculatedAmount) : calculatedAmount);
    const amount = ReportData.readOnly && state.details.roundingBasis !== "thousands" ? adopted : roundedEstimate(adopted);
    return { items, calculations, calculatedAmount, overrideAmount, amount };
  }

  function measurementField(label, field, value, linked, identity, attributes) {
    return {
      "aria-label": label, value: decimalInput(value), ...identity, "data-field": field,
      "data-measurement-input": "1",
      "data-tab-autofilled": linked && value != null && value !== "" ? "" : undefined,
      ...attributes,
    };
  }

  function rowInputFields(calculation) {
    if (calculation === "standard_4_factor") return ["no", "length", "breadth", "depth"];
    if (calculation === "three_factor_fgh") return ["no", "length", "breadth"];
    if (calculation === "three_factor_fgi") return ["no", "length", "depth"];
    if (calculation === "count_rate") return ["no"];
    return [];
  }

  const decimalFormatter = new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 2 });

  function decimalInput(value) {
    const number = numberOrBlank(value);
    return number == null ? "" : decimalFormatter.format(number);
  }

  function displayedNumber(value) {
    return Number(decimalInput(value));
  }

  function displayedPrice(quantity, rate) {
    const displayQuantity = displayedNumber(quantity);
    const displayRate = displayedNumber(rate);
    const product = Math.round(displayQuantity * 100) * Math.round(displayRate * 100);
    if (Number.isSafeInteger(product)) {
      return Math.sign(product) * Math.round(Math.abs(product) / 100) / 100;
    }
    const amount = cleanNumber(displayQuantity * displayRate);
    return amount == null ? null : displayedNumber(amount);
  }

  function measurementInfo(entry, data, componentId, sheetId) {
    const factor = numberOrBlank(data.rows[entry.instanceId]?.factor);
    const { slabDepth, steelRate } = data.rows[entry.instanceId] || {};
    const message = entry.calculation === "derived"
      ? `Matching RCC concrete volume × ${factor ?? entry.multiplier} kg/m³. Edit the factor in Dimensions & Defaults.`
      : slabDepth != null && steelRate != null
        ? `Roof slab area × ${slabDepth} m thickness × ${steelRate} kg/m³. Edit the thickness or factor in Dimensions & Defaults.`
        : `Roof slab area × ${factor ?? 10} kg/m². Edit the thickness or factor in Dimensions & Defaults.`;
    return { id: `calc-info-${componentId}-${sheetId}-${entry.instanceId}`, label: entry.label, message };
  }

  function measurementRow(entry, calculation, data, identity, multiplier) {
    const rowIdentity = { ...identity, "data-row": entry.instanceId };
    const row = {
      label: entry.label, usesItemLabel: entry.usesItemLabel,
      labelInput: entry.isCustom && !entry.setupRow
        ? { "aria-label": "Custom row description", value: entry.label, "data-row-label": "1", ...rowIdentity }
        : null,
      heading: entry.calculation === "heading", subtotal: entry.calculation === "subtotal", custom: entry.isCustom,
    };
    if (row.heading) return row;

    const stored = data.rows[entry.instanceId] || {};
    const linked = data.dimensionSetup?.rows?.[entry.instanceId];
    const value = calculation.values[entry.instanceId] || {};
    const inputNames = rowInputFields(entry.calculation);
    const labels = { no: "No.", length: "L", breadth: "B", depth: "D", rate: "Rate", amount: "Amount" };
    const input = field => measurementField(`${entry.label} ${labels[field]}`, field, stored[field], stored[field] === linked?.[field], rowIdentity);
    const derived = ["derived", "derived_expression"].includes(entry.calculation);
    const manual = entry.calculation === "manual_quantity_rate" && !["galvalume-roofing", "heavy-foundation"].includes(entry.baseId);
    const quantityKey = derived || manual ? "quantity" : "directQuantity";
    const lumpSum = entry.calculation === "lump_sum";
    const quantity = lumpSum ? null : measurementField(`${entry.label} Qty`, quantityKey, value.quantity,
      numberOrBlank(stored[quantityKey]) == null, rowIdentity, {
        "data-quantity-input": "", min: quantityKey === "directQuantity" ? 0 : undefined,
      });

    let action;
    if (!entry.setupRow && (entry.isCustom || entry.customizable)) {
      action = {
        label: entry.isCustom ? "×" : "+",
        attributes: {
          title: entry.isCustom ? "Remove custom row" : "Add a matching custom row",
          "data-action": entry.isCustom ? "remove-custom-row" : "add-custom-row",
          ...identity, "data-parent-row": entry.baseId, "data-row": entry.isCustom ? entry.instanceId : undefined,
        },
      };
    }
    return {
      ...row, dimensions: ["no", "length", "breadth", "depth"].map(field => inputNames.includes(field) ? input(field) : null),
      quantity, info: derived ? measurementInfo(entry, data, identity["data-component"], identity["data-sheet"]) : null,
      rate: entry.rate ? input("rate") : null, rateLabel: lumpSum ? "LS" : "",
      amount: lumpSum ? input("amount") : null, showAmount: !lumpSum || multiplier > 1,
      amountLabel: formatNumber(value.amount), amountDisplay: { "data-calculated-value": "amount", ...rowIdentity }, action,
    };
  }

  function finalAmountView(override, calculated, input, reset, label, display) {
    return {
      value: decimalInput(override ?? calculated), calculated: formatNumber(calculated),
      input, reset: override != null ? reset : null, label, display,
    };
  }

  function dimensionEntries() {
    return componentMeasurementEntries().filter((entry) => measurementTemplateKey(entry.component, entry.sheet));
  }

  function floorSlabBelow(entry) {
    const { component, sheet } = entry;
    if (!sheet || !component.buildingConfig) return null;
    const floors = configuredFloors(component.buildingConfig);
    const lowerFloor = floors[floors.findIndex((floor) => floor.key === sheet.key) - 1];
    if (!lowerFloor) return null;
    const lowerSheet = component.sheets.find((floor) => floor.key === lowerFloor.key || floor.typicalFloorKeys?.includes(lowerFloor.key));
    const slab = lowerSheet?.formData?.rows?.["concrete-roof-slab"];
    const positive = (value) => Number(value) > 0 ? numberOrBlank(value) : null;
    return { label: lowerFloor.label, long: positive(slab?.length), short: positive(slab?.breadth) };
  }

  function slabDimensions(entry, values, below = floorSlabBelow(entry)) {
    return Object.fromEntries(outsideAxes.filter((axis) => values.slabLinked?.[axis])
      .map((axis) => [axis, below?.[axis] ?? null]));
  }

  function inheritedDimensionsChanged(entry, setup) {
    if (!setup?.values?.slabLinked) return false;
    return Object.entries(slabDimensions(entry, setup.values))
      .some(([axis, value]) => setup.slabDimensions?.[axis] !== value);
  }

  function needsDimensions(entry) {
    const data = measurementData(entry.component, entry.sheet);
    return !data.manualMeasurements && (data.dimensionSetup
      ? inheritedDimensionsChanged(entry, data.dimensionSetup)
      : data.dimensionsRequired);
  }

  function dimensionProfile(entry) {
    const key = measurementTemplateKey(entry.component, entry.sheet);
    return EstimationDimensions.profile(key, ESTIMATION_WORKSHEETS[key]);
  }

  function pendingDimensions(entry, profile) {
    const data = measurementData(entry.component, entry.sheet);
    const values = { ...data.dimensionSetup?.values, ...data.dimensionInputs, ...dimensionEdits.get(entry.key) };
    if (!values.slabLinked && !data.dimensionSetup && !data.manualMeasurements && floorSlabBelow(entry)) {
      values.slabLinked = Object.fromEntries(outsideAxes.map((axis) => [axis, numberOrBlank(values[axis]) == null]));
    }
    if (profile.centre) {
      values.wallRuns ??= EstimationDimensions.legacyWallRuns(values);
    }
    if (profile.centre && profile.ids.has("ceiling-inside")) {
      values.roomCeiling ??= values.ceilingBasis !== "slab";
      values.rooms ??= EstimationDimensions.starterRooms.map((label, index) => ({ slot: index + 1, label }));
    }
    return values;
  }

  function scheduleField(key, label, value, type = "number", step = "any") {
    return `<label class="field"><span>${escapeHtml(label)}</span><input type="${type}" data-schedule-field="${key}" value="${escapeHtml(type === "number" ? decimalInput(value) : value ?? "")}"${type === "number" ? ` min="0" step="${step}" data-precise-value="${escapeHtml(value ?? "")}"` : ""}></label>`;
  }

  function wallRunFields(run, layers) {
    const included = run.layers || layers.map(([key]) => key);
    return `<fieldset class="dimension-schedule-entry" data-dimension-schedule="wallRuns" data-slot="${run.slot}">
      <legend>${escapeHtml(run.label || `CW${run.slot}`)}</legend>
      <div class="dimension-fields">
        ${scheduleField("label", "Wall run name", run.label, "text")}
        ${scheduleField("count", "Count", run.count, "number", "1")}
        ${scheduleField("length", "Length per run (m)", run.length)}
      </div>
      <details class="schedule-layer-options"><summary>Applicable layers and length overrides</summary>
        <label class="schedule-check"><input type="checkbox" data-schedule-field="adjust"${run.adjust !== false ? " checked" : ""}> Adjust for width changes at matching junctions</label>
        <div class="schedule-layer-grid">${layers.map(([key, label]) => `<div>
          <label class="schedule-check"><input type="checkbox" data-schedule-layer="${key}"${included.includes(key) ? " checked" : ""}> ${escapeHtml(label)}</label>
          ${scheduleField(`layer-${key}`, "Length override (m)", run.overrides?.[key])}
        </div>`).join("")}</div>
      </details>
      <button type="button" class="text-button" data-action="remove-dimension-row">Remove wall run</button>
    </fieldset>`;
  }

  function roomFields(room) {
    return `<fieldset class="dimension-schedule-entry" data-dimension-schedule="rooms" data-slot="${room.slot}">
      <legend>${escapeHtml(room.label || `Space ${room.slot}`)}</legend>
      <div class="dimension-fields">
        ${scheduleField("label", "Room or space name", room.label, "text")}
        ${scheduleField("count", "Count", room.count, "number", "1")}
        ${scheduleField("length", "Internal length (m)", room.length)}
        ${scheduleField("width", "Internal width (m)", room.width)}
        ${scheduleField("height", "Wall plaster height override (m)", room.height)}
      </div>
      <details class="schedule-layer-options"><summary>Measured area overrides</summary>
        <div class="schedule-layer-grid">
          ${scheduleField("ceilingArea", "Ceiling area per room override (m²)", room.ceilingArea)}
          ${scheduleField("wallArea", "Wall plaster area per room override (m²)", room.wallArea)}
        </div>
      </details>
      <button type="button" class="text-button" data-action="remove-dimension-row">Remove space</button>
    </fieldset>`;
  }

  function copyTargets(entry) {
    const profile = dimensionProfile(entry);
    return dimensionEntries().filter((other) => {
      if (other.key === entry.key || !other.sheet) return false;
      const target = dimensionProfile(other);
      return Boolean(entry.sheet) && profile.centre === target.centre && !target.shed;
    });
  }

  function matchingFoundation(source, target) {
    return source.ids.has("excavation-total") === target.ids.has("excavation-total")
      && source.ids.has("excavation-centre-9") === target.ids.has("excavation-centre-9")
      && source.ids.has("excavation-cellar") === target.ids.has("excavation-cellar");
  }

  function dimensionCopyControls(entry) {
    const targets = copyTargets(entry);
    if (!targets.length) return "";
    const sourceProfile = dimensionProfile(entry);
    return `<details class="dimension-group"><summary>Copy to worksheets</summary>
      <div class="dimension-fields"><div class="field"><label for="dimension-copy-mode">What to copy</label><select id="dimension-copy-mode" data-dimension-option>
        <option value="defaults">Defaults only</option><option value="dimensions">Dimensions only</option><option value="all">Dimensions and defaults</option>
      </select></div></div>
      <label class="schedule-check"><input type="checkbox" id="dimension-copy-all" data-dimension-option> Select all compatible worksheets</label>
      <div class="schedule-layer-grid">${targets.map((target) => `<label class="schedule-check"><input type="checkbox" data-dimension-copy-target="${escapeHtml(target.key)}" data-copy-full-compatible="${matchingFoundation(sourceProfile, dimensionProfile(target))}" data-dimension-option> ${escapeHtml(target.label)}</label>`).join("")}</div>
      <button type="button" class="secondary" data-action="copy-dimensions">Copy to selected worksheets</button>
      <p class="hint" id="dimension-copy-status" role="status"></p>
    </details>`;
  }

  function dimensionsPanel(entries) {
    const entry = entries.find((item) => item.key === dimensionSelection) || entries.find(needsDimensions) || entries[0];
    dimensionSelection = entry.key;
    const profile = dimensionProfile(entry);
    const values = pendingDimensions(entry, profile);
    const below = floorSlabBelow(entry);
    const inherited = ReportData.readOnly
      ? measurementData(entry.component, entry.sheet).dimensionSetup?.slabDimensions || {}
      : slabDimensions(entry, values, below);
    const options = entries.map((item) => `<option value="${escapeHtml(item.key)}"${entry.key === item.key ? " selected" : ""}>${escapeHtml(item.label)}${!ReportData.readOnly && needsDimensions(item) ? " · Setup needed" : ""}</option>`).join("");
    const groups = profile.groups.map((group) => {
      // Keep the old whole-perimeter override editable only on drafts that used it.
      if (group.label === "Exterior perimeter overrides by layer" && numberOrBlank(values.measuredPerimeter) != null) {
        return { ...group, fields: [{ id: "measuredPerimeter", label: "Saved exterior perimeter override (m)", value: "" }, ...group.fields] };
      }
      return group;
    }).map(({ label, fields }, index) => `<details class="dimension-group"${index === 0 ? " open" : ""}><summary>${escapeHtml(label)}</summary><div class="dimension-fields">${fields.map(({ id, label, value, kind }) => {
      const stored = values[id] ?? value;
      const fromSlab = Object.hasOwn(inherited, id);
      const displayed = fromSlab ? inherited[id] : stored;
      const isDefault = !Object.hasOwn(dimensionEdits.get(entry.key) || {}, id)
        && (values[id] == null || numberOrBlank(values[id]) === numberOrBlank(value));
      const fallback = below && outsideAxes.includes(id) ? ` data-slab-default="${escapeHtml(below[id] ?? "")}"${values.slabLinked?.[id] ? " data-slab-linked" : ""}` : "";
      return `<div class="field"><label for="dimension-${id}">${escapeHtml(label)}${kind?.startsWith("required") ? ' <span aria-hidden="true">*</span>' : ""}</label><input id="dimension-${id}" data-dimension-field="${id}" type="number" min="0" ${kind === "percent" ? 'max="100"' : ""} step="${kind?.endsWith("count") ? "1" : "any"}" value="${escapeHtml(id === "slabDepth" ? displayed : decimalInput(displayed))}" data-precise-value="${escapeHtml(stored)}"${autofilled(displayed, fromSlab || isDefault)}${fallback}${kind?.startsWith("required") ? ' aria-required="true"' : ""}></div>`;
    }).join("")}</div></details>`).join("");
    const slabNote = below && !ReportData.readOnly
      ? `<p class="hint">Outside dimensions default to the ${escapeHtml(below.label)} roof slab. Edit either dimension to override it, or clear it to use the slab again. Apply the lower floor’s slab dimensions first if they are missing.</p>`
      : "";
    const wallRuns = !profile.centre ? "" : `
      <details class="dimension-group" data-schedule-group="wallRuns"><summary>Wall Runs</summary>
        <p class="hint">Enter each group of matching crosswalls. Length is per run at the first applicable layer. Enable adjustments only where the same junction applies.</p>
        ${values.wallRuns.map((run) => wallRunFields(run, profile.layers)).join("")}
        <button type="button" class="secondary" data-action="add-dimension-row" data-schedule="wallRuns">Add wall run</button>
      </details>`;
    const rooms = !profile.centre || !profile.ids.has("ceiling-inside") ? "" : `
      <details class="dimension-group" data-schedule-group="rooms"><summary>Rooms &amp; Finishes</summary>
        <label class="schedule-check"><input type="checkbox" data-dimension-field="roomCeiling"${values.roomCeiling ? " checked" : ""}> Use room dimensions for ceiling plastering</label>
        <p class="hint">Wall plastering always uses the measured rooms. Clear the checkbox to use the shared slab dimensions for ornamental ceiling plastering. The ceiling also uses the slab when there are no measured rooms.</p>
        ${values.rooms.map(roomFields).join("")}
        <button type="button" class="secondary" data-action="add-dimension-row" data-schedule="rooms">Add room or space</button>
      </details>`;
    const sharedSlab = profile.ids.has("concrete-roof-slab")
      ? '<p class="hint">Roof slab length and width are shared by flooring, waterproofing, slab-based ceiling plastering and, where applicable, sand filling. Leave either dimension blank to use its outside building dimension. Set individual overrides only when those measurements differ.</p>'
      : "";
    const note = profile.centre ? "Outside dimensions and wall thickness calculate the centre-line perimeter. Use Exterior perimeter overrides by layer for exceptions." : profile.storage ? "The perimeter supplies the foundation runs. The brickwork and lintel defaults exclude one long side. Enter an override if the measured runs differ." : "";
    return `<div class="panel" data-key="dimensions"><h2>Dimensions &amp; Defaults</h2><p class="hint">Review the dimensions for each worksheet. Applying them fills the linked rows and preserves direct quantities and rates.</p><div class="field dimension-worksheet"><label for="dimension-worksheet">Worksheet</label><select id="dimension-worksheet">${options}</select></div>${note ? `<p class="hint">${escapeHtml(note)}</p>` : ""}${slabNote}${sharedSlab}${groups}${wallRuns}${rooms}${dimensionCopyControls(entry)}
      <details class="dimension-group" open><summary>Review worksheet dimensions</summary>
      <div class="worksheet-table-wrap" id="dimension-review"></div></details><p class="dimension-error" role="alert" hidden></p><button type="button" class="primary" data-action="apply-dimensions">Apply dimensions and continue</button> <button type="button" class="secondary" data-action="manual-measurements">Enter measurements manually</button></div>`;
  }

  function dimensionError(message) {
    const target = document.querySelector(".dimension-error");
    target.textContent = message;
    target.hidden = false;
  }

  function selectedDimensionEntry() {
    return dimensionEntries().find((item) => item.key === dimensionSelection);
  }

  function readDimensionValues(entry, profile) {
    const fields = Object.fromEntries([...document.querySelectorAll("[data-dimension-field]")].map((input) => [
      input.dataset.dimensionField, input.type === "checkbox" ? input.checked : input.dataset.preciseValue ?? input.value,
    ]));
    const values = { ...pendingDimensions(entry, profile), ...fields };
    if (profile.centre) delete values.ceilingBasis;
    return values;
  }

  function readSchedule() {
    const result = { wallRuns: [], rooms: [] };
    document.querySelectorAll("[data-dimension-schedule]").forEach((row) => {
      const fields = { slot: Number(row.dataset.slot) };
      for (const control of row.querySelectorAll("[data-schedule-field]")) {
        const key = control.dataset.scheduleField;
        const value = control.dataset.preciseValue ?? control.value;
        if (key.startsWith("layer-")) {
          (fields.overrides ||= {})[key.slice(6)] = value;
        } else {
          fields[key] = control.type === "checkbox" ? control.checked : value;
        }
      }
      if (row.dataset.dimensionSchedule === "wallRuns") {
        fields.layers = [...row.querySelectorAll("[data-schedule-layer]:checked")].map((input) => input.dataset.scheduleLayer);
      }
      result[row.dataset.dimensionSchedule].push(fields);
    });
    return result;
  }

  function editDimensionSchedule(button, add) {
    const entry = selectedDimensionEntry();
    const group = add ? button.dataset.schedule : button.closest("[data-dimension-schedule]").dataset.dimensionSchedule;
    const values = readDimensionValues(entry, dimensionProfile(entry));
    Object.assign(values, readSchedule());
    if (add) {
      const counter = `${group}NextSlot`;
      const slot = Math.max(values[counter] || 1, ...values[group].map((item) => item.slot + 1));
      values[group].push({ slot, label: group === "wallRuns" ? `CW${slot}` : `Space ${slot}` });
      values[counter] = slot + 1;
    } else {
      const slot = Number(button.closest("[data-dimension-schedule]").dataset.slot);
      values[`${group}NextSlot`] = Math.max(values[`${group}NextSlot`] || 1, slot + 1);
      values[group] = values[group].filter((item) => item.slot !== slot);
    }
    dimensionEdits.set(entry.key, values);
    renderAll({ sectionKey: "dimensions" });
    document.querySelector(`[data-schedule-group="${group}"]`).open = true;
  }

  function makeDimensionUpdate(entry, values, reviewSources) {
    const additions = {};
    const inherited = slabDimensions(entry, values);
    const profile = dimensionProfile(entry);
    const setupValues = { ...values };
    for (const field of ["plinthArea", "fillArea", "fillAreaPercent", "fillLength", "fillWidth"]) delete setupValues[field];
    if (!profile.shed) delete setupValues.fillDepth;
    const rows = EstimationDimensions.derive(profile, { ...setupValues, ...inherited }, additions, reviewSources);
    return { values: setupValues, rows, additions, ...(Object.keys(inherited).length ? { slabDimensions: inherited } : {}) };
  }

  function manualFillingDimension(data, id, field) {
    if (id !== "filling-basement" || !["no", "length", "breadth", "depth"].includes(field)) return null;
    const previous = data.dimensionSetup?.rows?.[id];
    const current = numberOrBlank(data.rows[id]?.[field]);
    return previous && current != null && current !== numberOrBlank(previous[field]) ? current : null;
  }

  function applyDimensionUpdate(entry, update, inheritedRefresh = false) {
    const data = measurementData(entry.component, entry.sheet);
    for (const [id, fields] of Object.entries(data.dimensionSetup?.rows || {})) {
      if (fields.setupLabel && !update.rows[id] && data.rows[id]) data.rows[id].setupOmitted = true;
      for (const [field, applied] of Object.entries(fields)) {
        if (!(field in (update.rows[id] || {})) && data.rows[id]?.[field] === applied) delete data.rows[id][field];
      }
    }
    for (const [id, fields] of Object.entries(update.rows)) {
      const previous = data.dimensionSetup?.rows?.[id];
      data.rows[id] ||= {};
      if (fields.setupOmitted) data.rows[id].setupOmitted = true;
      else delete data.rows[id].setupOmitted;
      for (const [field, value] of Object.entries(fields)) {
        if (manualFillingDimension(data, id, field) != null) continue;
        if (inheritedRefresh && previous && data.rows[id][field] !== previous[field]) continue;
        if (!previous || previous[field] !== value) data.rows[id][field] = value;
      }
    }
    data.dimensionSetup = update;
    if (inheritedRefresh) return;
    delete data.dimensionInputs;
    delete data.manualMeasurements;
    dimensionEdits.delete(entry.key);
  }

  function refreshInheritedMeasurements(component) {
    for (const entry of dimensionEntries().filter((candidate) => candidate.component === component)) {
      const data = measurementData(entry.component, entry.sheet);
      const setup = data.dimensionSetup;
      if (data.manualMeasurements || !inheritedDimensionsChanged(entry, setup)) continue;
      const inherited = slabDimensions(entry, setup.values);
      if (Object.values(inherited).includes(null)) continue;
      let update;
      try {
        update = makeDimensionUpdate(entry, setup.values);
        if (["fillArea", "fillAreaPercent", "fillLength", "fillWidth", "fillDepth"].some((key) =>
          setup.values[key] != null && setup.values[key] !== "" && (key !== "fillDepth" || !dimensionProfile(entry).shed))) {
          if (setup.rows["filling-basement"]) update.rows["filling-basement"] = setup.rows["filling-basement"];
          update.values = setup.values;
        }
      } catch (_error) {
        // Retain the previous measurements and require this worksheet to be reviewed.
        continue;
      }
      applyDimensionUpdate(entry, update, true);
    }
  }

  function applyDimensions() {
    const entry = selectedDimensionEntry();
    if (!entry || ReportData.readOnly) return;
    const arithmeticError = NumericEntry.error(document.querySelector('[data-key="dimensions"]'));
    if (arithmeticError) return dimensionError(arithmeticError);
    const data = measurementData(entry.component, entry.sheet);
    let update;
    try {
      update = makeDimensionUpdate(entry, readDimensionValues(entry, dimensionProfile(entry)));
    } catch (error) {
      dimensionError(error.message);
      return;
    }
    if (!data.dimensionSetup && Object.entries(update.rows).some(([id, fields]) => Object.keys(fields).some((field) => numberOrBlank(data.rows[id]?.[field]) != null))
      && !window.confirm("Apply these dimensions to the existing linked measurements? Rates and direct quantities will be kept.")) return;
    if (!confirmReportInvalidation()) return;
    applyDimensionUpdate(entry, update);
    refreshInheritedMeasurements(entry.component);
    scheduleSave();
    renderAll({ sectionKey: entry.key });
    window.scrollTo(0, 0);
  }

  function copyDimensions() {
    const source = selectedDimensionEntry();
    if (!source || ReportData.readOnly) return;
    const arithmeticError = NumericEntry.error(document.querySelector('[data-key="dimensions"]'));
    if (arithmeticError) return dimensionError(arithmeticError);
    const sourceProfile = dimensionProfile(source);
    const sourceValues = readDimensionValues(source, sourceProfile);
    const values = { ...sourceValues, ...slabDimensions(source, sourceValues) };
    const mode = $("dimension-copy-mode").value;
    const copyGeometry = mode !== "defaults";
    const sourceFields = new Map(sourceProfile.groups.flatMap(({ fields }) => fields).map((field) => [field.id, field]));
    const selected = new Set([...document.querySelectorAll("[data-dimension-copy-target]:checked")].map((input) => input.dataset.dimensionCopyTarget));
    const targets = copyTargets(source).filter((entry) => selected.has(entry.key));
    if (!targets.length) return dimensionError("Select at least one worksheet to copy to.");
    let updates;
    try {
      updates = targets.map((entry) => {
        const profile = dimensionProfile(entry);
        const next = pendingDimensions(entry, profile);
        for (const { id } of profile.groups.flatMap(({ fields }) => fields)) {
          const field = sourceFields.get(id);
          if (!field || !Object.hasOwn(values, id)) continue;
          if (mode === "all" || (copyGeometry ? field.geometry : field.value !== "" && !field.geometry)) {
            next[id] = values[id];
            if (outsideAxes.includes(id) && next.slabLinked) {
              next.slabLinked = { ...next.slabLinked, [id]: false };
            }
          }
        }
        if (!copyGeometry) return { entry, inputs: next };
        if (!matchingFoundation(sourceProfile, profile)) {
          throw new Error(`Use Defaults only for ${entry.label}. Its foundation work differs from the source worksheet.`);
        }
        const scheduleKeys = [
          ...(profile.centre ? ["wallRuns", "wallRunsNextSlot"] : []),
          ...(profile.centre && profile.ids.has("ceiling-inside") ? ["rooms", "roomsNextSlot", "roomCeiling"] : []),
        ];
        for (const key of scheduleKeys) {
          if (Object.hasOwn(values, key)) next[key] = structuredClone(values[key]);
        }
        if (profile.centre) delete next.ceilingBasis;
        return { entry, update: makeDimensionUpdate(entry, next) };
      });
    } catch (error) {
      return dimensionError(error.message);
    }
    if (targets.some((entry) => {
      const data = measurementData(entry.component, entry.sheet);
      return data.dimensionSetup || data.dimensionInputs || Object.keys(data.rows).length;
    }) && !window.confirm("Some selected worksheets already have measurements. Copy these settings and keep their rates and direct quantities?")) return;
    if (!confirmReportInvalidation()) return;
    for (const { entry, update, inputs } of updates) {
      if (update) applyDimensionUpdate(entry, update);
      else {
        measurementData(entry.component, entry.sheet).dimensionInputs = structuredClone(inputs);
        dimensionEdits.delete(entry.key);
      }
    }
    if (copyGeometry) new Set(targets.map((entry) => entry.component)).forEach(refreshInheritedMeasurements);
    $("dimension-copy-status").textContent = copyGeometry
      ? mode === "dimensions" ? "Dimensions applied using the selected worksheets’ own defaults." : "Dimensions and defaults applied to selected worksheets."
      : "Defaults copied. Review and apply them on each selected worksheet.";
    scheduleSave();
  }

  function reviewWorksheetDimensions() {
    const target = $("dimension-review");
    if (!target) return;
    const entry = selectedDimensionEntry();
    const data = measurementData(entry.component, entry.sheet);
    const profile = dimensionProfile(entry);
    const values = readDimensionValues(entry, profile);
    const sources = {};
    try {
      const arithmeticError = NumericEntry.error(target.closest("[data-key='dimensions']"));
      if (arithmeticError) throw new Error(arithmeticError);
      const savedSetup = data.dimensionSetup;
      if (ReportData.readOnly && !savedSetup) {
        ValuxUI.paintDimensionReview(target, [], "See the worksheet for the retained measurements.");
        return;
      }
      const derived = ReportData.readOnly ? savedSetup : makeDimensionUpdate(entry, values, sources);
      const { rows, additions = {} } = derived;
      const columns = ["no", "length", "breadth", "depth"];
      const items = ESTIMATION_WORKSHEETS[measurementTemplateKey(entry.component, entry.sheet)].items();
      const body = items.flatMap((item, index) => {
        if (data.omittedItems?.[`standard-${index}`]) return [];
        return item.rows.flatMap((row) => [row, ...(additions[row.id] || [])]).flatMap((row) => {
          const applied = rows[row.id];
          if (!applied || applied.setupOmitted || (!columns.some((column) => applied[column] != null) && applied.slabDepth == null)) return [];
          const presentation = EstimationDimensions.rowChanges(row, applied, profile.storage);
          if (presentation.hidden) return [];
          const label = presentation.label || row.label;
          const description = label === item.label ? label : `${item.label} · ${label}`;
          const manual = columns.map((column) => manualFillingDimension(data, row.id, column));
          const source = manual.some((value) => value != null) ? "Includes worksheet overrides"
            : ReportData.readOnly ? "Retained setup"
            : applied.slabDepth != null ? "Slab thickness for the steel calculation"
            : sources[row.id] || (applied.setupLabel || row.id.startsWith("setup-") ? "Worksheet schedule" : "Dimensions & Defaults");
          const measurements = columns.map((column, index) => {
            const value = manual[index] ?? applied[column];
            return column === "depth" && applied.slabDepth != null ? applied.slabDepth : value == null ? "—" : decimalInput(value);
          });
          return [[description, ...measurements, source]];
        });
      });
      ValuxUI.paintDimensionReview(target, body);
    } catch (error) {
      ValuxUI.paintDimensionReview(target, [], `${error.message} The review will appear when the worksheet dimensions are ready.`);
    }
  }

  function worksheetItemView(item, calculation, data, identity, multiplier) {
    const actions = [];
    if (item.isCustomItem) {
      actions.push({ label: "Remove custom field", className: "text-button danger-text",
        attributes: { "data-action": "remove-custom-item", ...identity, "data-item": item.itemKey } });
    } else {
      if (item.displaySno != null) actions.push({
        label: "Add custom field", className: "text-button",
        attributes: { "data-action": "add-custom-item", ...identity, "data-parent-item": item.itemKey },
      });
      if (!ReportData.readOnly) actions.push({ label: "Remove item", className: "text-button danger-text",
        attributes: { "data-action": "remove-standard-item", ...identity, "data-item": item.itemKey } });
    }
    const itemIdentity = { ...identity, "data-item": item.itemKey };
    return {
      key: item.itemKey, label: item.label, custom: item.isCustomItem, description: item.detailedDescription,
      serial: item.displaySno == null ? "" : `${item.displaySno}. `, actions,
      final: item.displaySno == null ? null : finalAmountView(calculation.perFloorOverride, calculation.calculatedAmount / multiplier,
        { "data-item-final-input": "1", ...itemIdentity }, { "data-action": "reset-item-total", ...itemIdentity },
        multiplier > 1 ? "Final amount per floor" : "Final amount", { "data-item-calculated": item.itemKey, ...identity }),
      rows: calculation.rows.map(row => measurementRow(row, calculation, data, identity, multiplier)),
    };
  }

  function measurementPanel(entry) {
    const templateKey = measurementTemplateKey(entry.component, entry.sheet);
    if (!templateKey) return ValuxUI.unsupportedEstimationWorksheet(entry.key, entry.label);
    const schema = ESTIMATION_WORKSHEETS[templateKey];
    const data = measurementData(entry.component, entry.sheet);
    const multiplier = typicalMultiplier(entry.sheet);
    const totals = sheetCalculations(schema, data, multiplier);
    const identity = { "data-component": entry.component.id, "data-sheet": entry.sheet?.id || "component" };
    const removed = ReportData.readOnly ? [] : schema.items().flatMap((item, index) => {
      const key = `standard-${index}`;
      return data.omittedItems?.[key] ? [{ key, label: item.label }] : [];
    });
    return ValuxUI.estimationWorksheet({
      key: entry.key, label: entry.label, template: schema.label, identity, multiplier,
      rounded: !ReportData.readOnly || state.details.roundingBasis === "thousands",
      total: formatNumber(totals.amount), plinthArea: data.plinthArea ?? "", removed,
      final: finalAmountView(totals.overrideAmount, totals.calculatedAmount,
        { "data-sheet-final-input": "1", ...identity }, { "data-action": "reset-sheet-total", ...identity },
        "Final sheet total", { "data-sheet-calculated": "", ...identity }),
      items: totals.calculations.map(({ item, calculation }) => worksheetItemView(item, calculation, data, identity, multiplier)),
    });
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
    return sheetCalculations(ESTIMATION_WORKSHEETS[templateKey], data, typicalMultiplier(entry.sheet));
  }

  function abstractIncludesCommonWorks() { return state.propertyType !== "residential" || requiresSeparateAbstract(); }

  function customAbstractEntries(key) {
    state.details[key] = Array.isArray(state.details[key]) ? state.details[key] : [];
    return state.details[key];
  }

  function customAbstractTotal(key) {
    return customAbstractEntries(key).reduce((sum, item) => sum + abstractAmount(item.amount), 0);
  }

  function roundedEstimate(value) { return Math.floor((displayedNumber(value) + 500) / 1000) * 1000; }

  function abstractAmount(value) {
    const number = numberOrBlank(value) ?? 0;
    return ReportData.readOnly && state.details.roundingBasis !== "thousands" ? number : roundedEstimate(number);
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
    const commonTotal = COMMON_EXTERNAL_WORKS.reduce((sum, label) => sum + abstractAmount(commonWorks[label]), 0) + customAbstractTotal("customCommonExternalWorks");
    const compact = !requiresSeparateAbstract();
    const commonWorksSection = abstractIncludesCommonWorks() ? `<section class="abstract-section"><div class="abstract-section-heading"><div><h3>Common External Works and Project Charges</h3><p class="hint">These values are entered directly by the valuer.</p></div><button type="button" class="text-button" data-action="add-abstract-custom" data-abstract-custom-type="common">Add custom field</button></div><div class="abstract-table-wrap"><table class="abstract-table abstract-edit-table"><thead><tr><th>S.No.</th><th>Description</th><th>Amount (Rs.)</th><th aria-label="Remove custom field"></th></tr></thead><tbody>${COMMON_EXTERNAL_WORKS.map((label, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(label)}</td><td><input type="number" step="any" inputmode="decimal" value="${escapeHtml(commonWorks[label] ?? "")}" data-common-work="${escapeHtml(label)}"></td><td></td></tr>`).join("")}${customAbstractRows(customCommonWorks, COMMON_EXTERNAL_WORKS.length, "common")}</tbody><tfoot><tr><th colspan="2">Total common works and charges</th><th colspan="2">₹ <span data-common-works-total>${formatNumber(commonTotal)}</span></th></tr><tr class="abstract-grand-total"><th colspan="2">Total estimated project cost</th><th colspan="2">₹ <span data-abstract-total>${formatNumber(componentTotal + commonTotal)}</span></th></tr></tfoot></table></div></section>` : `<section class="abstract-section"><div class="abstract-table-wrap"><table class="abstract-table"><tfoot><tr class="abstract-grand-total"><th colspan="2">Total estimated project cost</th><th colspan="2">₹ <span data-abstract-total>${formatNumber(componentTotal)}</span></th></tr></tfoot></table></div></section>`;
    return `<div class="panel" data-key="abstract"><h2>${EstimationNaming.groundOnly(state) ? "Estimate summary" : compact ? "Compact Abstract" : "Abstract"}</h2><p class="hint">This is the final online-form section. Component values remain linked to their source sheets. Editing a component amount here changes the same final sheet total after confirmation.</p><section class="abstract-section"><div class="abstract-section-heading"><h3>Component estimates</h3><button type="button" class="text-button" data-action="add-abstract-custom" data-abstract-custom-type="component">Add custom field</button></div><div class="abstract-table-wrap"><table class="abstract-table abstract-edit-table"><thead><tr><th>S.No.</th><th>Component / Work</th><th>Calculated amount (Rs.)</th><th>Final amount (Rs.)</th><th aria-label="Remove custom field"></th></tr></thead><tbody>${componentRows.length ? componentRows.map(({ entry, totals }, index) => {
      if (!totals) return `<tr><td>${index + 1}</td><td>${escapeHtml(entry.label)}</td><td>—</td><td>Online template not available</td></tr>`;
      const value = totals.amount;
      return `<tr><td>${index + 1}</td><td>${escapeHtml(EstimationNaming.abstractLabel(state, entry.component, entry.sheet))}</td><td>${formatNumber(totals.calculatedAmount)}</td><td><input type="number" step="any" inputmode="decimal" value="${decimalInput(value)}" data-abstract-component-final="1" data-component="${entry.component.id}" data-sheet="${entry.sheet?.id || "component"}"></td><td></td></tr>`;
    }).join("") : `<tr><td colspan="5">Add property components before completing the Abstract.</td></tr>`}${customAbstractRows(customComponents, componentRows.length, "component")}</tbody><tfoot><tr><th colspan="2">Total component estimates</th><th colspan="3">₹ ${formatNumber(componentTotal)}</th></tr></tfoot></table></div></section>${commonWorksSection}</div>`;
  }

  function reportSetupComplete() {
    return ["estimateDate", "place", "applicantName", "workAddress", "workDescription"].every((key) => String(state.details[key] || "").trim());
  }

  function propertyConfigurationComplete() { return Boolean(state.propertyType && state.construction && state.subtype); }

  function sectionGate(key) {
    if (ReportData.readOnly) return {allowed: true};
    if (key === "setup" || key === "preparation" || key === "configuration") return { allowed: true };
    if (key === "components") {
      if (!reportSetupComplete()) return { allowed: false, message: "Complete Report Setup first.", target: "setup", targetLabel: "Go to Report Setup" };
      if (!propertyConfigurationComplete()) return { allowed: false, message: "Complete Property Configuration before choosing report components.", target: "configuration", targetLabel: "Go to Property Configuration" };
      return { allowed: true };
    }
    if (key === "dimensions") return sectionGate("components");
    if (key.startsWith("measure-")) {
      const entry = dimensionEntries().find((item) => item.key === key);
      if (entry && needsDimensions(entry)) return { allowed: false, message: "Apply dimensions and defaults for this worksheet before entering its measurements.", target: "dimensions", targetLabel: "Go to Dimensions & Defaults" };
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

  function sectionDefinitions() {
    const setup = [{key: "setup", label: "Report Setup", view: setupPanel()},
      {key: "preparation", label: "Preparation Method", view: reportModePanel()}];
    const configuration = [{key: "configuration", label: "Property Configuration", view: configurationPanel()}, {key: "components", label: "Component Selection", html: componentSelectionPanel()}];
    const offlineOnly = industrialCentreLine() && !ReportData.readOnly;
    if (state.details.workMode === "offline") {
      const offlineConfiguration = offlineOnly ? configuration.slice(0, 1) : state.details.templateSetup ? configuration : [];
      return [...setup, ...offlineConfiguration, {key: "offline", label: "Complete & Upload Report", html: offlineEntry.panel()}];
    }
    if (offlineOnly) return [...setup, configuration[0]];
    if (state.details.workMode !== "online") return setup;
    const dimensionSheets = dimensionEntries();
    const dimensions = dimensionSheets.length ? [{ key: "dimensions", label: "Dimensions & Defaults", html: dimensionsPanel(dimensionSheets) }] : [];
    const measurements = state.propertyType ? componentMeasurementEntries().map((entry) => ({key: entry.key, label: entry.label, view: measurementPanel(entry)})) : [];
    const abstract = state.propertyType && state.components.length ? [{key: "abstract", label: EstimationNaming.groundOnly(state) ? "Estimate summary" : requiresSeparateAbstract() ? "Abstract" : "Compact Abstract", html: abstractPanel()}] : [];
    return [...setup, ...configuration, ...dimensions, ...measurements, ...abstract, {key: "review", label: "Configuration Review", html: reviewPanel()}].map((section) => {
      const gate = sectionGate(section.key);
      return gate.allowed ? {...section, locked: false} : {...section, locked: true, view: ValuxUI.estimationLockedPanel(section.key, section.label, gate)};
    });
  }

  function currentKey() { return document.querySelector(".panel.active")?.dataset.key || "setup"; }

  function renderAll(options = {}) {
    measurementLayoutDirty = false;
    const desiredKey = options.sectionKey || currentKey();
    const scrollPosition = window.scrollY;
    const sections = sectionDefinitions();
    const template = document.createElement("template");
    $("sections").replaceChildren(...sections.map(section => {
      if (section.view) return section.view;
      // Measurement and offline widgets still use controller-owned markup.
      template.innerHTML = section.html;
      return template.content.firstElementChild;
    }));
    ValuxUI.paintReportNav($("nav"), sections, {
      onSelect: index => showSection(index, { scroll: true }),
    });
    const nextIndex = sections.findIndex((section) => section.key === desiredKey);
    state.current = nextIndex < 0 ? 0 : nextIndex;
    wireEvents();
    offlineEntry.wire();
    reviewWorksheetDimensions();
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
    const targetKey = panels[state.current]?.dataset.key;
    if (measurementLayoutDirty) {
      renderAll({ sectionKey: targetKey });
      if (options.scroll) window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (panels[state.current]?.classList.contains("locked-panel") && sectionGate(targetKey).allowed) {
      renderAll({sectionKey: targetKey});
      return;
    }
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
    ["estimateDate", "place", "applicantName", "workAddress", "workDescription"].forEach((key) => { if (!String(state.details[key] || "").trim()) issues.push(`Report detail missing: ${key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}`); });
    if (!state.propertyType) issues.push("Select the property type.");
    if (!state.construction) issues.push("Select the construction configuration.");
    if (!state.subtype) issues.push("Select the property subtype.");
    if (!state.components.length) issues.push("Add at least one property component.");
    if (!state.details.workMode) issues.push("Choose whether to fill the estimate online or complete it in Excel.");
    return issues;
  }

  function workbookIssues() {
    if (industrialCentreLine()) return ["Prepare the industrial Centre Line estimate offline and upload the completed report."];
    const issues = validationIssues();
    const arithmeticError = NumericEntry.error($("estimation-form"));
    if (arithmeticError) issues.push(arithmeticError);
    componentMeasurementEntries().forEach((entry) => {
      if (!measurementTemplateKey(entry.component, entry.sheet)) issues.push(`${entry.label} does not yet have an approved workbook template.`);
      else if (state.details.workMode === "online" && needsDimensions(entry)) issues.push(`Apply dimensions and defaults for ${entry.label}.`);
    });
    return issues;
  }

  function updateOutputControls() {
    const enabled = workbookIssues().length === 0;
    const currentPreview = Boolean(ReportData.preview()?.totalsReviewed);
    $("generate-xlsx").disabled = !enabled || state.details.workMode !== "online" || !currentPreview;
    $("download-offline").disabled = !enabled || state.details.workMode !== "offline";
    const online = state.details.workMode === "online" && !industrialCentreLine();
    $("generate-xlsx").hidden = !online;
    $("download-offline").hidden = true;
    $("review-report").hidden = !online;
  }

  function workbookErrorMessage(error) {
    const message = error instanceof Error ? error.message.trim() : "";
    return message && !/^(failed to fetch|networkerror|load failed)$/i.test(message)
      ? message
      : "The workbook could not be prepared. Check your connection and try again.";
  }

  function browserEstimateTotals() {
    const worksheetComponents = componentMeasurementEntries().map((entry) => ({
      id: entry.key,
      label: entry.label,
      estimatedCost: componentSheetTotals(entry)?.amount || 0,
    }));
    const customComponents = customAbstractEntries("customComponentEstimates")
      .filter((entry) => String(entry.description || "").trim() || numberOrBlank(entry.amount) !== null)
      .map((entry) => ({ id: entry.id, estimatedCost: abstractAmount(entry.amount) }));
    const commonWorks = abstractIncludesCommonWorks()
      ? COMMON_EXTERNAL_WORKS.flatMap((label, index) => !displayedNumber(state.details.commonExternalWorks?.[label]) ? []
        : [{ id: `common-${index + 1}`, estimatedCost: abstractAmount(state.details.commonExternalWorks[label]) }])
      : [];
    const customCommon = abstractIncludesCommonWorks()
      ? customAbstractEntries("customCommonExternalWorks")
        .filter((entry) => String(entry.description || "").trim() || numberOrBlank(entry.amount) !== null)
        .map((entry) => ({ id: entry.id, estimatedCost: abstractAmount(entry.amount) }))
      : [];
    return [...worksheetComponents, ...customComponents, ...commonWorks, ...customCommon];
  }

  async function downloadWorkbook(mode) {
    if (EstimationProcessing.isBusy()) return;
    const selectedMode = await synchroniseWorkMode();
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
    if (mode === "completed" && !ReportData.preview()?.totalsReviewed) {
      window.alert("Preview the current workbook before generating the completed Excel report.");
      return;
    }
    const buttons = [$("generate-xlsx"), $("download-offline"), $("generate-from-review"), $("download-offline-from-review")].filter(Boolean);
    buttons.forEach((button) => { button.disabled = true; });
    $("status").textContent = mode === "offline" ? "Preparing offline workbook…" : "Generating Excel…";
    try {
      await EstimationProcessing.run(mode === "offline" ? "Preparing workbook template" : "Generating Excel report", "Saving the current report details…", async (stage) => {
        await persistDraftNow();
        stage(mode === "offline" ? "Building the configured workbook template…" : "Building the completed Excel report…");
        const response = await fetch("/api/estimation/workbook", {
          method: "POST",
          headers: await ReportData.requestHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(ReportData.requestPayload({ state, mode, preview_id: ReportData.preview()?.id })),
        });
        if (!response.ok) {
          const message = await response.json().catch(() => ({}));
          if (message.code === "preview_required" || message.code === "estimation_workbook_mismatch") ReportData.setPreview(null);
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
          if (registered && ReportData.taskCode) await TaskStore.refresh(ReportData.taskCode);
          state.details.finalReport = { source: "Generated Excel", fileName, generatedAt, url: reportUrl };
          generatedChangeAcknowledged = false;
          window.dispatchEvent(new CustomEvent("sln:report-generated", { detail: { format: "xlsx", download: reportUrl, filename: fileName, source: "Generated Excel", registered } }));
        }
        scheduleSave({ reportDirty: false });
        $("status").textContent = mode === "offline" ? "Offline workbook downloaded" : "Completed Excel downloaded";
        renderAll({ sectionKey: mode === "offline" ? "offline" : "review" });
      });
    } catch (error) {
      window.alert(workbookErrorMessage(error));
      $("status").textContent = "Workbook preparation failed";
    } finally {
      updateOutputControls();
      if ($("generate-from-review")) $("generate-from-review").disabled = !ReportData.preview()?.totalsReviewed;
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

  function showServerTotals(summary, browserTotals) {
    const local = new Map(browserTotals.map((item) => [item.id, item.estimatedCost]));
    const changed = local.size !== summary.components.length
      || summary.components.some((item) => local.get(item.id) !== item.estimatedCost);
    ValuxUI.paintServerTotals($("estimation-server-totals"), summary.components.map(item => ({
      label: item.label, amount: `₹ ${formatNumber(item.estimatedCost)}`,
    })), `₹ ${formatNumber(summary.totalEstimatedCost)}`, changed);
  }

  async function showReview() {
    if (EstimationProcessing.isBusy()) return;
    const issues = workbookIssues();
    const previewMode = state.details.workMode === "offline" ? "offline" : "completed";
    const sheets = allWorksheetNames();
    const worksheets = sheets.length && requiresSeparateAbstract() ? ["Abstract", ...sheets] : sheets;
    const previewDescription = previewMode === "offline"
      ? "Previewing the configured blank workbook that will be downloaded for completion in Excel."
      : "Previewing the completed workbook generated from the current online entries.";
    const abstract = worksheets.length
      ? (EstimationNaming.groundOnly(state) ? "Not needed for Ground Floor only" : requiresSeparateAbstract() ? "Separate" : "Compact")
      : "—";
    const stats = [
      ["Draft scope", draftScope], ["Property", propertyProfile()?.label || "—"],
      ["Worksheets", worksheets.length], ["Abstract", abstract],
    ];
    ValuxUI.paintEstimatePreview($("review-content"), { issues, description: previewDescription, stats, worksheets });
    $("review-modal").hidden = false;
    if (issues.length) return;
    const restoredPreview = ReportData.preview();
    $("status").textContent = "Rendering workbook preview…";
    try {
      await EstimationProcessing.run("Preparing workbook preview", "Saving report details and rendering the workbook…", async (_stage, signal) => {
        const browserTotals = previewMode === "completed" ? browserEstimateTotals() : [];
        await persistDraftNow();
        const restore = previewMode === "completed" && restoredPreview?.url;
        const response = await fetch(restore ? "/api/estimation/totals" : "/api/estimation/preview", {
          method: "POST",
          signal,
          headers: await ReportData.requestHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(ReportData.requestPayload({ state, mode: previewMode, preview_id: restoredPreview?.id })),
        });
        const preview = await response.json();
        signal.throwIfAborted();
        if (!response.ok) {
          if (preview.code === "preview_required") ReportData.setPreview(null);
          throw new Error(preview.error || "Workbook preview failed.");
        }
        if (preview.summary) showServerTotals(preview.summary, browserTotals);
        const url = restore ? restoredPreview.url : preview.preview;
        ValuxUI.paintWorkbookFrame($("workbook-preview"), { url });
        ReportData.setPreview({ id: restore ? restoredPreview.id : preview.preview_id, url, totalsReviewed: true });
        $("status").textContent = restore ? "Latest workbook preview restored" : "Workbook preview ready";
        updateOutputControls();
        if ($("generate-from-review")) $("generate-from-review").disabled = false;
      }, "Cancel preview");
    } catch (error) {
      if (error.name === "AbortError") {
        ValuxUI.paintWorkbookFrame($("workbook-preview"), { message: "Preview cancelled." });
        $("status").textContent = "Preview cancelled";
        return;
      }
      ValuxUI.paintWorkbookFrame($("workbook-preview"), { error: workbookErrorMessage(error) });
      $("status").textContent = "Workbook preview failed";
    }
  }

  function scheduleSave(options = {}) {
    if (ReportData.readOnly) return;
    editVersion++;
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
    if (ReportData.readOnly) return;
    window.clearTimeout(saveTimer);
    saveTimer = null;
    const savedVersion = editVersion;
    // A save response may arrive after the next input/upload. Estimation has no
    // server-normalized media, so keep the current browser state rather than
    // replacing newer edits with the earlier request's payload.
    state.details.identityVersion = 2;
    state.details.roundingBasis = "thousands";
    if (state.details.workMode === "online") state.details.pricingBasis = "displayed";
    const saved = await ReportData.save(DRAFT_KEY, "estimation", state, "3");
    if (savedVersion !== editVersion || saveTimer !== null) return;
    if (saved?.details?.preparationRevision != null) state.details.preparationRevision = saved.details.preparationRevision;
    else delete state.details.preparationRevision;
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
      if (!ReportData.readOnly && state.details.workMode === "online" && state.details.pricingBasis !== "displayed") {
        ReportData.setPreview(null);
      }
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
    if (input.dataset.field === "directQuantity" && Number(input.value) < 0) {
      refreshMeasurementCalculations(found.component, found.sheet);
      return;
    }
    row[input.dataset.field] = input.value;
    found.data.rows[input.dataset.row] = row;
    if (found.sheet && input.dataset.row === "concrete-roof-slab" && ["length", "breadth"].includes(input.dataset.field)) {
      refreshInheritedMeasurements(found.component);
      measurementLayoutDirty = true;
    }
    refreshMeasurementCalculations(found.component, found.sheet, input);
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

  function refreshMeasurementCalculations(component, sheet, editingInput) {
    const schema = measurementSchema(component, sheet);
    if (!schema) return;
    const data = measurementData(component, sheet);
    const totals = sheetCalculations(schema, data, typicalMultiplier(sheet));
    const values = Object.assign({}, ...totals.calculations.map(({ calculation }) => calculation.values));
    const scope = `[data-component="${CSS.escape(component.id)}"][data-sheet="${CSS.escape(sheet?.id || "component")}"]`;
    document.querySelectorAll(`[data-calculated-value]${scope}`).forEach((target) => {
      const result = values[target.dataset.row];
      if (result) target.textContent = formatNumber(result[target.dataset.calculatedValue]);
    });
    document.querySelectorAll(`[data-quantity-input]${scope}`).forEach((target) => {
      const result = values[target.dataset.row];
      if (!result || NumericEntry.pending(target)) return;
      if (target !== editingInput) target.value = decimalInput(result.quantity);
      const entered = data.rows[target.dataset.row]?.[target.dataset.field];
      FormTabOrder.mark(target, numberOrBlank(entered) == null);
    });
    document.querySelectorAll(`[data-item-calculated]${scope}`).forEach((target) => {
      const current = totals.calculations.find(({ item }) => item.itemKey === target.dataset.itemCalculated);
      if (current) target.textContent = formatNumber(current.calculation.calculatedAmount / typicalMultiplier(sheet));
    });
    document.querySelectorAll(`[data-item-final-input]${scope}`).forEach((target) => {
      const current = totals.calculations.find(({ item }) => item.itemKey === target.dataset.item);
      if (!current) return;
      const calculated = current.calculation.overrideAmount == null;
      if (calculated) target.value = decimalInput(current.calculation.calculatedAmount / typicalMultiplier(sheet));
      FormTabOrder.mark(target, calculated);
    });
    document.querySelectorAll(`[data-sheet-adopted]${scope}`).forEach((target) => { target.textContent = formatNumber(totals.amount); });
    document.querySelectorAll(`[data-sheet-calculated]${scope}`).forEach((target) => { target.textContent = formatNumber(totals.calculatedAmount); });
    document.querySelectorAll(`[data-sheet-final-input]${scope}`).forEach((target) => {
      const calculated = totals.overrideAmount == null;
      if (calculated) target.value = decimalInput(totals.calculatedAmount);
      FormTabOrder.mark(target, calculated);
    });
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

  function setStandardItemOmitted(componentId, sheetId, itemKey, omitted) {
    const found = locateMeasurement(componentId, sheetId);
    if (!found || ReportData.readOnly || !customItemSource(itemKey, measurementSchema(found.component, found.sheet))) return;
    if (omitted) {
      found.data.omittedItems ||= {};
      found.data.omittedItems[itemKey] = true;
    } else if (found.data.omittedItems) {
      delete found.data.omittedItems[itemKey];
      if (!Object.keys(found.data.omittedItems).length) delete found.data.omittedItems;
    }
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
    const item = Object.values(found.data.customItems).flat().find((entry) => entry.id === input.dataset.item);
    if (!item) return;
    item[field] = input.value;
    if (field === "shortDescription") {
      const label = item.shortDescription.trim() || "Custom item";
      input.closest(".worksheet-item").querySelectorAll("[data-custom-item-display]").forEach((target) => {
        target.textContent = label;
      });
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
    const commonTotal = abstractIncludesCommonWorks() ? COMMON_EXTERNAL_WORKS.reduce((sum, label) => sum + abstractAmount(state.details.commonExternalWorks?.[label]), 0) + customAbstractTotal("customCommonExternalWorks") : 0;
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
    const current = sheetCalculations(schema, found.data, typicalMultiplier(found.sheet));
    const before = current.amount;
    const next = numberOrBlank(input.value);
    const description = next == null ? "restore the calculated sheet total" : `set the final sheet total to ₹ ${formatNumber(next)}`;
    if (before !== (next ?? current.calculatedAmount) && !window.confirm(`This will ${description} on both the Abstract and the source component sheet. Continue?`)) {
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
      const switchesToOffline = input.name === "measurement-method" && industrialCentreLine(input.value) && state.details.workMode === "online";
      if (switchesToOffline || input.name === "work-mode" || input.id === "estimation-upload-type" || input.id === "dimension-worksheet" || input.closest("[data-dimension-schedule]") || input.hasAttribute("data-dimension-option") || input.dataset.dimensionField) return;
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
    $("dimension-worksheet")?.addEventListener("change", (event) => {
      dimensionSelection = event.target.value;
      renderAll({ sectionKey: "dimensions" });
    });
    document.querySelectorAll("[data-dimension-field]").forEach((input) => input.addEventListener("input", () => {
      const values = dimensionEdits.get(dimensionSelection) || {};
      if (input.hasAttribute("data-precise-value")) input.dataset.preciseValue = input.value;
      const field = input.dataset.dimensionField;
      values[field] = input.type === "checkbox" ? input.checked : input.value;
      if (input.hasAttribute("data-slab-default")) {
        const entry = selectedDimensionEntry();
        const links = pendingDimensions(entry, dimensionProfile(entry)).slabLinked;
        values.slabLinked = { ...links, [field]: input.value === "" };
        input.toggleAttribute("data-slab-linked", values.slabLinked[field]);
      }
      dimensionEdits.set(dimensionSelection, values);
      reviewWorksheetDimensions();
    }));
    document.querySelectorAll("[data-dimension-schedule] input").forEach((input) => {
      input.addEventListener("input", () => {
        if (input.hasAttribute("data-precise-value")) input.dataset.preciseValue = input.value;
        const values = dimensionEdits.get(dimensionSelection) || {};
        Object.assign(values, readSchedule());
        dimensionEdits.set(dimensionSelection, values);
        reviewWorksheetDimensions();
      });
    });
    document.querySelectorAll("input[data-precise-value]").forEach((input) => {
      input.addEventListener("blur", () => {
        if (NumericEntry.pending(input)) return;
        const value = input.hasAttribute("data-slab-linked") ? input.dataset.slabDefault : input.dataset.preciseValue;
        input.value = input.dataset.dimensionField === "slabDepth" ? value : decimalInput(value);
        if (input.hasAttribute("data-slab-linked")) FormTabOrder.mark(input);
      });
    });
    $("dimension-copy-mode")?.addEventListener("change", (event) => {
      $("dimension-copy-all").checked = false;
      for (const target of document.querySelectorAll("[data-dimension-copy-target]")) {
        target.disabled = event.target.value !== "defaults" && target.dataset.copyFullCompatible !== "true";
        if (target.disabled) target.checked = false;
      }
    });
    $("dimension-copy-all")?.addEventListener("change", (event) => {
      document.querySelectorAll("[data-dimension-copy-target]:not(:disabled)").forEach((target) => { target.checked = event.target.checked; });
    });
    document.querySelectorAll('[name="property-type"]').forEach((input) => input.addEventListener("change", () => setPropertyType(input.value)));
    document.querySelectorAll('[name="construction"]').forEach((input) => input.addEventListener("change", () => setConstruction(input.value)));
    document.querySelectorAll('[name="measurement-method"]').forEach((input) => input.addEventListener("change", () => setMeasurementMethod(input.value)));
    document.querySelectorAll('[name="work-mode"]').forEach((input) => input.addEventListener("change", () => setWorkMode(input.value)));
    $("property-subtype")?.addEventListener("change", (event) => { state.subtype = event.target.value; renderAll({ sectionKey: "configuration" }); scheduleSave(); });
    document.querySelectorAll("[data-detail]").forEach((input) => input.addEventListener("input", () => { state.details[input.dataset.detail] = input.value; if (input.type === "date") dateError(input); scheduleSave(); }));
    document.querySelectorAll("[data-plinth-area]").forEach((input) => input.addEventListener("input", () => {
      const found = locateMeasurement(input.dataset.component, input.dataset.sheet);
      if (!found) return;
      found.data.plinthArea = input.value;
      scheduleSave();
    }));
    document.querySelectorAll("[data-measurement-input]").forEach((input) => {
      input.addEventListener("input", () => updateMeasurementInput(input));
      input.addEventListener("blur", () => {
        if (NumericEntry.pending(input)) return;
        if (!input.hasAttribute("data-quantity-input")) {
          input.value = decimalInput(input.value);
          return;
        }
        const found = locateMeasurement(input.dataset.component, input.dataset.sheet);
        if (found) refreshMeasurementCalculations(found.component, found.sheet);
      });
    });
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
      const mutatingActions = new Set(["remove-component", "add-abstract-custom", "remove-abstract-custom", "move-component-up", "move-component-down", "save-building-config", "add-custom-row", "remove-custom-row", "add-custom-item", "remove-custom-item", "remove-standard-item", "restore-standard-item", "reset-item-total", "reset-sheet-total"]);
      if (mutatingActions.has(action) && !confirmReportInvalidation()) return;
      if (action === "remove-component") removeComponent(component);
      if (action === "add-abstract-custom") addAbstractCustom(button.dataset.abstractCustomType);
      if (action === "remove-abstract-custom") removeAbstractCustom(button.dataset.abstractCustomType, button.dataset.abstractCustomId);
      if (action === "apply-dimensions") applyDimensions();
      if (action === "add-dimension-row" || action === "remove-dimension-row") editDimensionSchedule(button, action === "add-dimension-row");
      if (action === "copy-dimensions") copyDimensions();
      if (action === "manual-measurements") {
        const entry = dimensionEntries().find((item) => item.key === dimensionSelection);
        if (!entry || ReportData.readOnly || !confirmReportInvalidation()) return;
        measurementData(entry.component, entry.sheet).manualMeasurements = true;
        scheduleSave();
        renderAll({ sectionKey: entry.key });
      }
      if (action === "edit-dimensions") {
        dimensionSelection = button.dataset.sectionKey;
        renderAll({ sectionKey: "dimensions" });
        window.scrollTo(0, 0);
      }
      if (action === "go-to-section") {
        if (button.dataset.sectionKey === "dimensions" && currentKey().startsWith("measure-")) {
          dimensionSelection = currentKey();
          renderAll({ sectionKey: "dimensions" });
          window.scrollTo(0, 0);
          return;
        }
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
      if (action === "remove-standard-item" || action === "restore-standard-item") {
        setStandardItemOmitted(component, button.dataset.sheet, button.dataset.item, action === "remove-standard-item");
      }
      if (action === "reset-item-total") {
        const found = locateMeasurement(component, button.dataset.sheet);
        if (found) { delete found.data.itemOverrides[button.dataset.item]; renderAll({ sectionKey: `measure-${component}${button.dataset.sheet === "component" ? "" : `-${button.dataset.sheet}`}` }); scheduleSave(); }
      }
      if (action === "reset-sheet-total") {
        const found = locateMeasurement(component, button.dataset.sheet);
        if (found) { delete found.data.sheetTotalOverride; renderAll({ sectionKey: `measure-${component}${button.dataset.sheet === "component" ? "" : `-${button.dataset.sheet}`}` }); scheduleSave(); }
      }
      if (action === "toggle-calculation-info") {
        button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
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
  if (currentTask() && !String(state.details.applicantName || "").trim()) state.details.applicantName = currentTask().customerName;
  if (currentTask() && !String(state.details.workDescription || "").trim()) state.details.workDescription = currentTask().propertyBrief;
  renderAll({ sectionKey: "setup" });
})();
