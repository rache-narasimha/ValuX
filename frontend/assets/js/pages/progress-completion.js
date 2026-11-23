/** Linked construction progress/completion report form and DOCX workflow. */
(async function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const practice = params.get("practice") === "1";
  const taskId = practice ? "" : params.get("task") || "";
  const task = taskId ? TaskStore.get(taskId) : null;
  const draftScope = practice ? "practice" : `task-${taskId || "standalone"}`;
  const DRAFT_KEY = `sln.progress-completion.form.draft.v1-${draftScope}`;
  const TODAY = localToday();
  const practiceEstimate = {
    id: "PRACTICE-EST-001",
    title: "Sample residential estimate (fictional)",
    customerName: "Sample Borrower",
    institutionName: "Sample Bank",
    branch: "Adoni",
    estimationSummary: {
      identityVersion: 2,
      applicantName: "Sample Borrower, Adoni",
      propertyTypeLabel: "Residential building",
      workDescription: "Construction of a residential building",
      workAddress: "Sample Plot, Adoni",
      totalEstimatedCost: 2000000,
      components: [
        { id: "ground-floor", label: "Ground Floor", estimatedCost: 1200000 },
        { id: "first-floor", label: "First Floor", estimatedCost: 800000 },
      ],
    },
  };
  const sectionLabels = { setup: "Report Setup", preparation: "Preparation Method", assessment: "Work Assessment", bank: "Bank Sanction", photos: "Photos & Generate", offline: "Complete & Upload Report" };
  const state = { linkedEstimationId: task?.linkedEstimationId || "", current: 0, preparationMethod: "online", details: {}, components: [], bank: { releases: [] }, photos: [], map: null };
  let saveTimer = null;
  let previousReports = [];
  let previewId = null;
  let generatedChangeAcknowledged = false;
  const reportDefaults = new Set();

  const element = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const numeric = (value) => { const result = Number(String(value ?? "").replaceAll(",", "")); return Number.isFinite(result) ? result : 0; };
  const currency = (value) => `₹${numeric(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const reportErrorMessage = (error, fallback) => {
    const message = error instanceof Error ? error.message.trim() : "";
    return message && !/^(failed to fetch|networkerror|load failed)$/i.test(message) ? message : fallback;
  };

  function localToday() {
    return ValuxTime.today();
  }

  function usesPracticeEstimate(estimationId) {
    return practice && estimationId === practiceEstimate.id;
  }

  function selectedTask() {
    if (usesPracticeEstimate(state.linkedEstimationId)) return practiceEstimate;
    return state.linkedEstimationId ? TaskStore.get(state.linkedEstimationId) : null;
  }
  function currentTask() { return taskId && window.TaskStore ? TaskStore.get(taskId) : null; }
  function linkedSummary() { return selectedTask()?.estimationSummary || null; }
  function requestedReportType() { return practice ? element("practice-report-type").value : task?.reportGroup || "progress"; }
  function isKarnataka() { const linked = selectedTask(); return linked?.institutionCode === "KB" || linked?.institutionName?.trim().toLowerCase() === "karnataka bank"; }

  function calculation(component) {
    const estimated = numeric(component.estimatedCost);
    const percent = numeric(component.completionPercent);
    const calculated = estimated * percent / 100;
    const completed = component.manualCompleted ? numeric(component.completedCost) : calculated;
    const balance = Math.max(0, estimated - completed);
    return { estimated, percent, calculated, completed, balance };
  }

  function totals() {
    const result = state.components.reduce((sum, component) => {
      const current = calculation(component);
      sum.estimated += current.estimated;
      sum.completed += current.completed;
      sum.balance += current.balance;
      return sum;
    }, { estimated: 0, completed: 0, balance: 0 });
    result.materials = numeric(state.details.materialsAtSite);
    result.totalValue = result.completed + result.materials;
    return result;
  }

  function computedReportType() {
    return state.components.length && state.components.every((component) => {
      const current = calculation(component);
      return current.percent === 100 && current.balance <= 0.005;
    }) ? "completion" : "progress";
  }

  function compatiblePreviousSummary() {
    return previousReports
      .filter((candidate) => candidate.id !== taskId && candidate.progressSummary)
      .at(-1)?.progressSummary || null;
  }

  function loadLinkedEstimate(estimationId, preserveValues = false) {
    state.linkedEstimationId = estimationId || "";
    const linked = selectedTask();
    const summary = linked?.estimationSummary;
    if (!summary) {
      state.components = [];
      render();
      scheduleSave();
      return;
    }
    const previous = compatiblePreviousSummary();
    const priorByLabel = new Map((previous?.components || []).map((component) => [component.label, component]));
    const currentByLabel = new Map((preserveValues ? state.components : []).map((component) => [component.label, component]));
    state.components = (summary.components || []).map((baseline, index) => {
      const current = currentByLabel.get(baseline.label);
      const previous = priorByLabel.get(baseline.label);
      const existing = current || previous || {};
      return {
        id: baseline.id || `component-${index + 1}`,
        label: baseline.label,
        estimatedCost: numeric(baseline.estimatedCost),
        completionPercent: existing.completionPercent ?? "",
        completedCost: existing.completedCost ?? "",
        manualCompleted: Boolean(existing.manualCompleted),
        percentFromPreviousReport: current ? Boolean(current.percentFromPreviousReport) : Boolean(previous),
      };
    });
    for (const [key, value] of Object.entries({ reportDate: TODAY, visitDate: TODAY, place: "Adoni" })) {
      if (state.details[key]) continue;
      state.details[key] = value;
      reportDefaults.add(key);
    }
    render();
    scheduleSave();
  }

  async function populatePracticeCandidates() {
    const select = element("practice-estimation");
    const candidates = [];
    let offset = 0;
    let hasMore = true;
    try {
      while (hasMore) {
        const result = await TaskStore.eligibleEstimations(requestedReportType(), TODAY, { offset, limit: 50 });
        candidates.push(...result.items);
        offset += result.items.length;
        hasMore = result.hasMore && result.items.length > 0;
      }
    } catch (error) {
      if (!usesPracticeEstimate(state.linkedEstimationId)) {
        element("status").textContent = reportErrorMessage(error, "Other estimation reports could not be loaded.");
      }
    }
    ValuxUI.paintReportOptions(select, [
      { value: "", label: "Select an estimation report" },
      { value: practiceEstimate.id, label: `${practiceEstimate.title} · ${currency(practiceEstimate.estimationSummary.totalEstimatedCost)}` },
      ...candidates.map(candidate => ({
        value: candidate.id,
        label: `${candidate.id} · ${candidate.customerName} · ${currency(candidate.estimationSummary?.totalEstimatedCost || 0)}`,
      })),
    ], state.linkedEstimationId);
  }

  function loadProgressHistory(estimationId) {
    return estimationId && !usesPracticeEstimate(estimationId)
      ? TaskStore.progressReportsFor(estimationId) : [];
  }

  async function prepareLinkedEstimate(estimationId, preserveValues = false) {
    previousReports = await loadProgressHistory(estimationId);
    loadLinkedEstimate(estimationId, preserveValues);
  }

  function renderLinkedEstimate() {
    const linked = selectedTask();
    const summary = linked?.estimationSummary;
    element("linked-estimate-name").textContent = usesPracticeEstimate(state.linkedEstimationId)
      ? practiceEstimate.title : linked ? `${linked.id} · ${linked.customerName}` : "Not selected";
    element("linked-estimate-meta").textContent = linked && summary ? `${linked.institutionName}, ${linked.branch} · ${summary.propertyTypeLabel || summary.propertyType || "Property"} · ${currency(summary.totalEstimatedCost)}` : "Select a finalized estimation report containing a retained cost summary.";
    const invalid = !linked || !summary || !(summary.components || []).length;
    element("link-error").hidden = !invalid;
    element("link-error").textContent = invalid ? "A generated or attached estimation report with component costs must be linked before this form can be completed." : "";
    element("reference-number").closest(".field").hidden = !isKarnataka();
  }

  function renderComponents() {
    const rows = state.components.map(component => {
      const current = calculation(component);
      return {
        label: component.label, percent: component.completionPercent,
        inherited: component.percentFromPreviousReport && component.completionPercent !== "",
        estimate: current.estimated,
        completed: component.manualCompleted ? component.completedCost : current.calculated,
        manual: component.manualCompleted, balance: current.balance,
      };
    });
    ValuxUI.paintProgressComponents(element("component-rows"), rows);
    renderComponentTotals();
  }

  function renderComponentTotals() {
    const currentTotals = totals();
    element("estimated-total").textContent = currency(currentTotals.estimated);
    element("completed-total").textContent = currency(currentTotals.completed);
    element("balance-total").textContent = currency(currentTotals.balance);
    element("total-value").value = currency(currentTotals.totalValue);
    const reportType = computedReportType();
    element("derived-report-type").textContent = `${reportType[0].toUpperCase()}${reportType.slice(1)} report`;
    element("derived-report-type").classList.toggle("is-complete", reportType === "completion");
  }

  function renderReleases() {
    ValuxUI.paintBankReleases(element("release-rows"), state.bank.releases || []);
    renderBankCalculations();
  }

  function renderBankCalculations() {
    const current = totals();
    const marginPercent = numeric(state.bank.marginPercent);
    const margin = current.totalValue * marginPercent / 100;
    const released = (state.bank.releases || []).reduce((sum, release) => sum + numeric(release.amount), 0);
    const eligible = marginPercent || String(state.bank.marginPercent || "").trim() ? Math.max(0, current.totalValue - margin) : null;
    const instalment = eligible === null ? null : Math.max(0, eligible - released);
    const cards = [["Cost incurred", current.totalValue], ["Margin", marginPercent || String(state.bank.marginPercent || "").trim() ? margin : null], ["Loan eligible", eligible], ["Already released", released], ["Instalment eligible now", instalment]];
    ValuxUI.paintBankCalculations(element("bank-calculations"), cards.map(([label, value]) =>
      [label, value === null ? "—" : currency(value)]));
  }

  function canChoosePreparation() {
    return practice || ["progress", "completion"].includes(task?.reportGroup)
      && !ReportData.readOnly && WorkflowAccess.can("changeWorkflow", currentTask());
  }

  function sections() {
    const keys = ["setup"];
    if (canChoosePreparation()) keys.push("preparation");
    keys.push("assessment");
    if (state.preparationMethod === "offline") keys.push("offline");
    else {
      if (isKarnataka()) keys.push("bank");
      keys.push("photos");
    }
    return keys;
  }

  function showSection(index, scroll = false) {
    const keys = sections();
    state.current = Math.max(0, Math.min(index, keys.length - 1));
    document.querySelectorAll("[data-section]").forEach((panel) => panel.classList.toggle("active", panel.dataset.section === keys[state.current]));
    ValuxUI.paintReportNav(element("nav"), keys.map(key => ({ label: sectionLabels[key] })), {
      active: state.current, onSelect: itemIndex => showSection(itemIndex, true),
    });
    element("progress").textContent = `Section ${state.current + 1} of ${keys.length}`;
    element("previous").disabled = state.current === 0;
    element("next").disabled = state.current === keys.length - 1;
    if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function syncInputsFromState() {
    const mapping = {
      "reference-number": [state.details, "referenceNumber"], "report-date": [state.details, "reportDate"], "visit-date": [state.details, "visitDate"],
      "official-name": [state.details, "officialName"], "official-designation": [state.details, "officialDesignation"], "report-place": [state.details, "place"],
      "materials-at-site": [state.details, "materialsAtSite"], "deviation-remarks": [state.details, "deviationRemarks"],
      "loan-account": [state.bank, "accountNumber"], "limit-sanctioned": [state.bank, "limitSanctioned"], "balance-as-on": [state.bank, "balanceAsOn"],
      "balance-outstanding": [state.bank, "balanceOutstanding"], "margin-percent": [state.bank, "marginPercent"], "bank-page-date": [state.bank, "date"],
    };
    Object.entries(mapping).forEach(([id, [owner, key]]) => {
      const field = element(id);
      field.value = owner[key] ?? "";
      if (owner === state.details) FormTabOrder.mark(field, reportDefaults.has(key));
    });
    document.querySelectorAll('input[name="no-deviation"]').forEach((input) => { input.checked = input.value === state.details.noDeviation; });
    element("deviation-wrap").hidden = state.details.noDeviation !== "no";
  }

  function renderEstimationCorrection() {
    let box = element("estimation-correction-review");
    if (!box) {
      box = document.createElement("section"); box.id = "estimation-correction-review"; box.className = "notice";
      element("component-rows").closest("table").before(box);
    }
    const current = currentTask();
    box.hidden = !current?.estimationCorrectionPending && !current?.estimationReviewRequired;
    if (box.hidden) return;
    ValuxUI.paintEstimateCorrection(box, {
      pending: current.estimationCorrectionPending,
      notes: state.components.filter(item => item.estimationReviewReason).map(item => `${item.label}: ${item.estimationReviewReason}`),
      removed: state.details.estimationRemovedComponents || [],
      reviewed: state.details.estimationRevisionReviewed === current.linkedEstimationSnapshotId,
      onReview(event) {
        state.details.estimationRevisionReviewed = event.target.checked ? current.linkedEstimationSnapshotId : "";
        markDirty();
        scheduleSave();
      },
    });
  }

  function render() {
    renderLinkedEstimate();
    renderComponents();
    renderEstimationCorrection();
    renderReleases();
    syncInputsFromState();
    element("bank-panel").hidden = !isKarnataka() || state.preparationMethod === "offline";
    renderPreparation();
    showSection(state.current);
  }

  function renderPreparation() {
    const offline = state.preparationMethod === "offline";
    document.body.dataset.progressPreparation = offline ? "offline" : "online";
    element("preview-report").hidden = offline;
    element("generate-docx").hidden = offline;
    window.dispatchEvent(new CustomEvent("sln:valuation-preparation-changed"));
  }

  async function prepareRetrospectiveUpload() {
    const issues = validate({ offline: true });
    if (issues.length) {
      window.alert(issues.join("\n"));
      showSection(sections().indexOf("assessment"), true);
      return false;
    }
    await persistDraftNow();
    return true;
  }

  function draftState() {
    return clone({
      linkedEstimationId: state.linkedEstimationId,
      preparationMethod: state.preparationMethod,
      uploadType: state.uploadType || "",
      details: state.details,
      components: state.components,
      bank: state.bank,
      photos: state.photos,
      map: state.map,
      autofilledReportFields: [...reportDefaults],
      practiceOffline: state.practiceOffline || null,
      practiceReportType: practice ? requestedReportType() : undefined,
    });
  }

  function confirmReportInvalidation() {
    const current = currentTask();
    if (!current?.reportGeneratedAt || current.reportFresh === false || generatedChangeAcknowledged) return true;
    const accepted = RetrospectiveValuation.confirmReportEdit(state.preparationMethod);
    if (accepted) generatedChangeAcknowledged = true;
    return accepted;
  }

  function markDirty() {
    previewId = null;
    ReportData.setPreview(null);
    element("generate-docx").disabled = true;
    window.dispatchEvent(new CustomEvent("sln:report-dirty"));
  }

  function reportInputChanged() {
    markDirty();
    scheduleSave();
  }

  function scheduleSave() {
    if (ReportData.readOnly) return;
    element("status").classList.add("is-saving");
    element("status").setAttribute("aria-label", ReportData.localOnly ? "Saving draft locally" : "Saving draft");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => persistDraftNow().catch((error) => {
      element("status").textContent = error.message || "Draft save failed";
      element("status").classList.remove("is-saving");
    }), 700);
  }

  async function persistDraftNow() {
    if (ReportData.readOnly) return;
    window.clearTimeout(saveTimer);
    saveTimer = null;
    const saved = await ReportData.save(DRAFT_KEY, task?.reportKey || requestedReportType(), draftState(), "1");
    Object.assign(state, saved);
    state.details = saved.details || {};
    state.bank = { releases: [], ...(saved.bank || {}) };
    state.photos = Array.isArray(saved.photos) ? saved.photos : [];
    state.map = saved.map || null;
    renderPhotos();
    element("status").textContent = ReportData.localOnly ? "Saved locally" : "Saved";
    element("status").classList.remove("is-saving");
    element("status").removeAttribute("aria-label");
    if (generatedChangeAcknowledged && ReportData.taskCode) await ReportData.refreshTask();
  }

  async function restoreDraft() {
    try {
      const saved = await ReportData.load(DRAFT_KEY);
      if (!saved || typeof saved !== "object") return;
      if (!practice && saved.linkedEstimationId !== task?.linkedEstimationId) return;
      Object.assign(state, saved);
      if (practice && ["progress", "completion"].includes(saved.practiceReportType)) element("practice-report-type").value = saved.practiceReportType;
      (saved.autofilledReportFields || []).forEach((key) => reportDefaults.add(key));
      state.details = saved.details || {};
      state.bank = { releases: [], ...(saved.bank || {}) };
      state.photos = Array.isArray(saved.photos) ? saved.photos : [];
      state.map = saved.map || null;
      element("status").textContent = "Draft restored";
    } catch (_error) { element("status").textContent = "Draft could not be restored"; }
  }

  function validate({ offline = false } = {}) {
    const issues = [];
    const arithmeticError = NumericEntry.error(element("progress-form"));
    if (arithmeticError) issues.push(arithmeticError);
    const current = currentTask();
    if (current?.estimationCorrectionPending) issues.push("Finalize the revised estimation first, then reload this report.");
    if (current?.estimationReviewRequired && state.details.estimationRevisionReviewed !== current.linkedEstimationSnapshotId) issues.push("Confirm that you reviewed the revised estimation and completion amounts.");
    const linked = linkedSummary();
    if (!linked || !state.components.length) issues.push("Select a finalized estimation report with component costs.");
    if (!offline && !state.photos.length) issues.push("Attach at least one authenticated site photograph.");
    if (!offline && !state.map) issues.push("Attach one location map screenshot.");
    if (!state.details.reportDate) issues.push("Enter the report date.");
    if (!state.details.visitDate) issues.push("Enter the site-visit date.");
    if (!String(state.details.place || "").trim()) issues.push("Enter the report place.");
    state.components.forEach((component) => {
      const current = calculation(component);
      if (String(component.completionPercent ?? "").trim() === "") issues.push(`Enter completion percentage for ${component.label}.`);
      else if (current.percent < 0 || current.percent > 100) issues.push(`Completion percentage for ${component.label} must be between 0 and 100.`);
      if (current.completed < 0 || current.completed > current.estimated) issues.push(`Completed cost for ${component.label} must be between zero and its estimated cost.`);
    });
    if (!state.details.noDeviation) issues.push("Confirm whether the sanctioned plan has any deviation.");
    if (state.details.noDeviation === "no" && !String(state.details.deviationRemarks || "").trim()) issues.push("Describe the observed plan deviation.");
    const derived = computedReportType();
    if (requestedReportType() === "completion" && derived !== "completion") issues.push("A Completion report requires 100% completion and zero balance work for every component.");
    if (requestedReportType() === "progress" && derived === "completion") issues.push(practice
      ? "All components are complete. Select Completion report in Report Setup."
      : "All components are complete. Create this assignment as a Completion report.");
    return issues;
  }

  function payload() {
    const linked = selectedTask();
    const summary = linkedSummary() || {};
    return {
      requestedReportType: requestedReportType(),
      institution: { code: linked?.institutionCode || "", name: linked?.institutionName || "", branch: linked?.branch || "" },
      linkedEstimation: {
        taskId: linked?.id || "", applicantName: summary.applicantName || linked?.customerName || "", applicantAddress: summary.applicantAddress || "",
        identityVersion: summary.identityVersion || 1, workAddress: summary.workAddress || "",
        projectLocation: summary.projectLocation || linked?.propertyBrief || "", workDescription: summary.workDescription || "",
      },
      details: { ...state.details, materialsAtSite: numeric(state.details.materialsAtSite) },
      components: state.components.map((component) => { const current = calculation(component); return { id: component.id, label: component.label, estimatedCost: current.estimated, completionPercent: current.percent, completedCost: current.completed }; }),
      bank: clone(state.bank),
      photos: state.photos.map(({ name, data, storedFileId }) => ({ name, data, storedFileId })),
      map: state.map,
      preview_id: previewId,
    };
  }

  async function requestReport(mode) {
    if (!element("processing").hidden) return;
    const issues = validate();
    element("validation-message").hidden = !issues.length;
    ValuxUI.paintReportIssues(element("validation-message"), issues, "Complete these items first");
    if (issues.length) { showSection(sections().indexOf("photos"), true); return; }
    if (mode === "generate" && !previewId) {
      window.alert("Please preview the latest report before downloading the DOCX.");
      return;
    }
    element("processing").hidden = false;
    element("processing-title").textContent = mode === "preview" ? "Rendering report preview" : "Generating Word report";
    element("processing-stage").textContent = "Building the certificate, calculations and photo pages…";
    const cancel = mode === "preview" ? ReportProcessing.cancellation(element("processing")) : null;
    try {
      await persistDraftNow();
      const response = await fetch(`/api/progress/${mode}`, { method: "POST", signal: cancel?.signal, headers: await ReportData.requestHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(ReportData.requestPayload(payload())) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The report could not be generated.");
      if (cancel?.signal.aborted) return;
      if (mode === "preview") {
        element("preview-frame").src = result.preview;
        element("preview-modal").hidden = false;
        previewId = result.preview_id;
        ReportData.setPreview({ id: result.preview_id, url: result.preview });
        element("generate-docx").disabled = false;
        element("status").textContent = "Preview ready";
      } else {
        const link = document.createElement("a");
        link.href = result.download;
        link.download = result.filename || "Progress_Completion_Report.docx";
        document.body.append(link);
        link.click();
        link.remove();
        window.dispatchEvent(new CustomEvent("sln:report-generated", { detail: { format: "docx", download: result.download, filename: result.filename, progressSummary: result.summary, registered: result.registered === true, task: result.task || null } }));
        generatedChangeAcknowledged = false;
        element("status").textContent = "DOCX generated";
      }
    } catch (error) {
      if (cancel?.signal.aborted) return;
      window.alert(reportErrorMessage(error, "The report could not be generated. Check your connection and try again."));
      element("status").textContent = "Report generation failed";
    } finally {
      if (cancel?.signal.aborted) element("status").textContent = "Preview cancelled";
      cancel?.dispose();
      element("processing").hidden = true;
    }
  }

  function fileToData(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, data: reader.result, key: `${file.name}-${file.size}-${file.lastModified}` }); reader.onerror = reject; reader.readAsDataURL(file); });
  }

  function renderPhotos() {
    const options = { progress: true };
    ValuxUI.paintReportPhotos(element("photo-preview"), state.photos, (index) => {
      if (!confirmReportInvalidation()) return;
      state.photos.splice(index, 1);
      renderPhotos();
      reportInputChanged();
    }, options);
    ValuxUI.paintReportMap(element("map-preview"), state.map, "Location map preview", () => {
      if (!confirmReportInvalidation()) return;
      state.map = null;
      renderPhotos();
      reportInputChanged();
    }, options);
  }

  function wire() {
    const bindings = {
      "reference-number": [state.details, "referenceNumber"], "report-date": [state.details, "reportDate"], "visit-date": [state.details, "visitDate"],
      "official-name": [state.details, "officialName"], "official-designation": [state.details, "officialDesignation"], "report-place": [state.details, "place"],
      "materials-at-site": [state.details, "materialsAtSite"], "deviation-remarks": [state.details, "deviationRemarks"],
      "loan-account": [state.bank, "accountNumber"], "limit-sanctioned": [state.bank, "limitSanctioned"], "balance-as-on": [state.bank, "balanceAsOn"],
      "balance-outstanding": [state.bank, "balanceOutstanding"], "margin-percent": [state.bank, "marginPercent"], "bank-page-date": [state.bank, "date"],
    };
    Object.entries(bindings).forEach(([id, [owner, key]]) => element(id).addEventListener("input", (event) => {
      if (!confirmReportInvalidation()) { event.target.value = owner[key] ?? ""; return; }
      owner[key] = event.target.value;
      if (owner === state.details) reportDefaults.delete(key);
      if (["materials-at-site", "margin-percent"].includes(id)) { renderComponents(); renderBankCalculations(); }
      reportInputChanged();
    }));
    document.querySelectorAll('input[name="no-deviation"]').forEach((input) => input.addEventListener("change", () => {
      if (!confirmReportInvalidation()) { syncInputsFromState(); return; }
      state.details.noDeviation = input.value;
      element("deviation-wrap").hidden = input.value !== "no";
      reportInputChanged();
    }));
    element("component-rows").addEventListener("change", (event) => {
      if (!confirmReportInvalidation()) { renderComponents(); return; }
      const percentIndex = event.target.dataset.progressPercent;
      const completedIndex = event.target.dataset.progressCompleted;
      if (percentIndex !== undefined) { const component = state.components[Number(percentIndex)]; component.completionPercent = event.target.value; component.percentFromPreviousReport = false; if (!component.manualCompleted) component.completedCost = calculation(component).calculated; }
      if (completedIndex !== undefined) { const component = state.components[Number(completedIndex)]; component.completedCost = event.target.value; component.manualCompleted = true; }
      const component = state.components[Number(percentIndex ?? completedIndex)];
      const row = event.target.closest("tr");
      const current = calculation(component);
      const completed = row.querySelector("[data-progress-completed]");
      completed.value = component.manualCompleted ? component.completedCost : current.calculated;
      FormTabOrder.mark(completed, !component.manualCompleted);
      row.querySelector("[data-progress-balance]").textContent = current.balance.toFixed(2);
      row.querySelector("[data-reset-completed]").hidden = !component.manualCompleted;
      renderComponentTotals(); renderBankCalculations(); reportInputChanged();
    });
    element("component-rows").addEventListener("click", (event) => { const index = event.target.dataset.resetCompleted; if (index === undefined) return; if (!confirmReportInvalidation()) return; const component = state.components[Number(index)]; component.manualCompleted = false; component.completedCost = calculation(component).calculated; renderComponents(); renderBankCalculations(); reportInputChanged(); });
    element("add-release").addEventListener("click", () => { if (!confirmReportInvalidation()) return; state.bank.releases.push({ date: "", amount: "" }); renderReleases(); reportInputChanged(); });
    element("release-rows").addEventListener("input", (event) => { const dateIndex = event.target.dataset.releaseDate; const amountIndex = event.target.dataset.releaseAmount; if (!confirmReportInvalidation()) { renderReleases(); return; } if (dateIndex !== undefined) state.bank.releases[Number(dateIndex)].date = event.target.value; if (amountIndex !== undefined) state.bank.releases[Number(amountIndex)].amount = event.target.value; renderBankCalculations(); reportInputChanged(); });
    element("release-rows").addEventListener("click", (event) => { const index = event.target.dataset.removeRelease; if (index === undefined) return; if (!confirmReportInvalidation()) return; state.bank.releases.splice(Number(index), 1); renderReleases(); reportInputChanged(); });
    element("photo-upload").addEventListener("change", async (event) => { if (!confirmReportInvalidation()) { event.target.value = ""; return; } const added = await Promise.all([...event.target.files].map(fileToData)); const existing = new Set(state.photos.map((photo) => photo.key)); state.photos.push(...added.filter((photo) => !existing.has(photo.key))); event.target.value = ""; renderPhotos(); reportInputChanged(); });
    element("map-upload").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      event.target.value = "";
      if (!file || !confirmReportInvalidation()) return;
      state.map = await fileToData(file);
      renderPhotos();
      reportInputChanged();
    });
    element("previous").addEventListener("click", () => showSection(state.current - 1, true));
    element("next").addEventListener("click", () => showSection(state.current + 1, true));
    element("preview-report").addEventListener("click", () => requestReport("preview"));
    element("generate-docx").addEventListener("click", () => requestReport("generate"));
    element("close-preview").addEventListener("click", () => { element("preview-modal").hidden = true; });
    element("preview-modal").addEventListener("click", (event) => { if (event.target === element("preview-modal")) element("preview-modal").hidden = true; });
    element("discard-draft").addEventListener("click", async () => { if (!window.confirm("Discard this progress/completion draft? The retained report will become outdated and must be previewed and generated again.")) return; try { markDirty(); await ReportData.discard(DRAFT_KEY); state.details = {}; reportDefaults.clear(); state.bank = { releases: [] }; state.photos = []; state.map = null; loadLinkedEstimate(state.linkedEstimationId); element("status").textContent = "Draft discarded"; renderPhotos(); } catch (error) { element("status").textContent = error.message || "Draft could not be discarded"; } });
  }

  async function setPreparationMethod(method) {
    if (!canChoosePreparation()) return false;
    const previous = state.preparationMethod;
    if (method === previous) return true;
    if (!RetrospectiveValuation.confirmPreparationChange("preparation method", previous, method, currentTask())) return false;
    const controls = element("progress-preparation").querySelectorAll("[data-preparation-method]");
    controls.forEach((control) => { control.disabled = true; });
    state.preparationMethod = method;
    try {
      await persistDraftNow();
    } catch (error) {
      state.preparationMethod = previous;
      window.alert(reportErrorMessage(error, "The preparation method could not be saved."));
      return false;
    } finally {
      controls.forEach((control) => { control.disabled = false; });
    }
    markDirty();
    renderPreparation();
    element("bank-panel").hidden = !isKarnataka() || method === "offline";
    showSection(state.current);
    return true;
  }

  async function initialize() {
    if (!practice && (!task || !["progress", "completion"].includes(task.reportGroup))) {
      element("link-error").hidden = false;
      element("link-error").textContent = "Open this form from a Progress or Completion assignment.";
      element("generate-docx").disabled = true;
      element("preview-report").disabled = true;
    }
    await restoreDraft();
    if (state.preparationMethod === "offline" && !Object.hasOwn(state, "uploadType")) {
      state.uploadType = task?.ownPreparationSource === "template" ? "template" : "retrospective";
    }
    if (canChoosePreparation()) {
      const panel = RetrospectiveValuation.preparationPanel(practice ? requestedReportType() : task.reportKey, state.preparationMethod, setPreparationMethod);
      panel.id = "progress-preparation";
      panel.dataset.section = "preparation";
      element("progress-preparation").replaceWith(panel);
    }
    if (practice || task && ["progress", "completion"].includes(task.reportGroup)) {
      const panel = RetrospectiveValuation.offlinePanel(practice ? requestedReportType() : task.reportKey, state.uploadType, {
        practiceSaved: state.practiceOffline,
        practiceChanged: async (value) => { state.practiceOffline = value; await persistDraftNow(); },
        practiceReportType: requestedReportType,
        prepareUpload: prepareRetrospectiveUpload,
        downloadTemplate: async () => {
          const { photos, map, ...templateData } = payload();
          return fetch("/api/progress/template", {
            method: "POST",
            headers: await ReportData.requestHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify(ReportData.requestPayload(templateData)),
          });
        },
        uploadTypeChanged: async (type) => {
          const previous = state.uploadType;
          state.uploadType = type;
          try {
            await persistDraftNow();
          } catch (error) {
            state.uploadType = previous;
            throw error;
          }
          markDirty();
        },
      });
      if (panel) {
        panel.classList.remove("panel");
        element("progress-offline").append(panel);
      }
    }
    const restoredPreview = ReportData.preview();
    if (restoredPreview?.id && state.photos.length && state.map) {
      previewId = restoredPreview.id;
      element("generate-docx").disabled = false;
      element("status").textContent = "Draft and latest preview restored";
    }
    element("practice-estimation-wrap").hidden = !practice;
    element("practice-type-wrap").hidden = !practice;
    if (practice) {
      if (!state.linkedEstimationId) state.linkedEstimationId = practiceEstimate.id;
      await populatePracticeCandidates();
      element("practice-estimation").addEventListener("change", async (event) => {
        try { await prepareLinkedEstimate(event.target.value); markDirty(); }
        catch (error) { element("link-error").hidden = false; element("link-error").textContent = error.message || "Linked report history could not be loaded."; }
      });
      element("practice-report-type").addEventListener("change", async () => {
        markDirty();
        const panel = RetrospectiveValuation.preparationPanel(requestedReportType(), state.preparationMethod, setPreparationMethod);
        panel.id = "progress-preparation"; panel.dataset.section = "preparation";
        element("progress-preparation").replaceWith(panel);
        await populatePracticeCandidates();
        renderComponents();
        scheduleSave();
      });
    }
    if (state.linkedEstimationId) {
      previousReports = await loadProgressHistory(state.linkedEstimationId);
      if (!state.components.length) loadLinkedEstimate(state.linkedEstimationId, true);
      else render();
    }
    else render();
    wire();
    renderPhotos();
  }

  await initialize();
})();
