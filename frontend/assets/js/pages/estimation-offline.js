/** Attachment-first estimation entry, with reviewed component costs for linked reports. */
(function exposeOfflineEstimation(global) {
  "use strict";
  function create({ state, currentTask, persist, save, render, dirty, downloadTemplate, setupComplete, confirmUploadType, preparationChanged, externalReportOnly }) {
    let selectedFile = null, content = "", analyzing = false, analysisVersion = 0;
    const isBusy = () => global.EstimationProcessing?.isBusy() || false;
    const process = (title, stage, operation, cancelLabel) => global.EstimationProcessing.run(title, stage, operation, cancelLabel);
    const escape = (value) => global.WorkflowUI.escape(value);
    const rows = () => state.details.offlineComponents ||= [];
    const extractedFields = (row) => state.details.extractedComponentFields?.[row.id] || [];
    const autofilled = (row, field) => extractedFields(row).includes(field) && row[field] !== "" ? " data-tab-autofilled" : "";
    const uid = () => global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const retained = () => {
      if (selectedFile) return null;
      if (global.ReportData.localOnly && state.details.finalReport?.url) {
        return {filename: state.details.finalReport.fileName, url: state.details.finalReport.url};
      }
      const task = currentTask();
      if (global.ReportData.readOnly) return task?.status === "Closed" ? global.TaskStore.finalArtifact(task) : task && global.TaskStore.latestArtifact(task);
      const artifact = task && global.TaskStore.latestArtifact(task);
      // Older uploads keep their existing completion path without guessing a
      // preparation source. Their original completion-note rule still applies.
      const legacyUpload = !task?.preparationSource && !state.details.uploadType && artifact?.artifactSource === "uploaded";
      return task?.reportFresh !== false && (legacyUpload || task?.retrospectiveReady && task.preparationSource === state.details.uploadType) ? artifact : null;
    };
    function panel() {
      const artifact = retained(), type = state.details.uploadType || "";
      const externalOnly = !global.ReportData.readOnly && externalReportOnly();
      return `<div class="panel offline-report-panel" data-key="offline"><h2>Complete &amp; Upload Report</h2>
        <section class="subgroup"><div class="subgroup-heading"><h3 id="estimation-upload-type-label">Upload Type</h3>${externalOnly ? "" : '<button type="button" class="secondary" id="estimation-template-download">Download workbook template</button>'}</div>
        <div class="field"><select id="estimation-upload-type" aria-labelledby="estimation-upload-type-label"><option value="">Select upload type</option>${externalOnly ? "" : `<option value="template" ${type === "template" ? "selected" : ""}>Filled template</option>`}<option value="retrospective" ${type === "retrospective" ? "selected" : ""}>Retrospective report</option></select></div>
        <p class="hint">${externalOnly ? "Upload the completed industrial Centre Line estimate as a retrospective report." : "Filled template requires a template download for this task. Existing retrospective reports can be attached directly."}</p></section>
        ${artifact ? `<section class="subgroup"><div class="offline-artifact"><span aria-hidden="true">✓</span><div class="offline-artifact-details"><strong>${escape(artifact.filename)}</strong><small>Report submitted</small></div><div class="offline-artifact-actions"><a class="button-link secondary offline-artifact-download" href="${escape(artifact.url)}" download title="Download submitted report" aria-label="Download submitted report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg></a><button type="button" id="estimation-remove-report" class="secondary offline-artifact-download" title="Remove submitted report" aria-label="Remove submitted report">${global.AppShell?.icons?.trash || "×"}</button></div></div></section>` : `<section class="subgroup"><h3>Attach completed report</h3><div class="field"><label for="estimation-offline-file">Report (XLSX, DOCX or PDF)</label><input id="estimation-offline-file" type="file" accept=".xlsx,.docx,.pdf"></div><p class="hint">${analyzing ? "Reading component totals…" : selectedFile ? escape(selectedFile.name) : "Attach the report to review its component totals."}</p></section>`}
        ${artifact && global.ReportData.readOnly && rows().length ? `<section class="subgroup"><h3>Retained component totals</h3><div class="offline-component-table">${rows().map((row) => `<div class="grid offline-component-row"><div class="field"><label>Component / Floor</label><input readonly value="${escape(row.label)}"></div><div class="field"><label>Estimated Amount (Rs.)</label><input readonly value="${escape(row.estimatedCost ?? "")}"></div><div class="field"><label>Plinth Area (sft.)</label><input readonly value="${escape(row.plinthArea ?? "")}"></div></div>`).join("")}</div><p>Total: <strong>${sum().toLocaleString("en-IN")}/-</strong></p></section>` : ""}
        ${!artifact && (selectedFile || rows().length) ? `<section class="subgroup"><div class="subgroup-heading"><h3>Review component totals</h3><button type="button" id="estimation-add-summary" class="secondary document-icon-button">${global.AppShell?.icons?.add || "+"} Add component</button></div><p class="hint">Use the complete final amount for each component or floor, including lump sums and adjustments.</p><div class="offline-component-table">${rows().map((row, index) => `<div class="grid offline-component-row"><div class="field"><label for="offline-label-${index}">Component / Floor</label><input id="offline-label-${index}" value="${escape(row.label)}"${autofilled(row, "label")} data-offline-component-label="${index}"></div><div class="field"><label for="offline-amount-${index}">Estimated Amount (Rs.)</label><input id="offline-amount-${index}" type="number" min="0" step="any" value="${escape(row.estimatedCost ?? "")}"${autofilled(row, "estimatedCost")} data-offline-component-amount="${index}"></div><div class="field"><label for="offline-area-${index}">Plinth Area (sft.)</label><input id="offline-area-${index}" type="text" value="${escape(row.plinthArea ?? "")}"${autofilled(row, "plinthArea")} data-offline-component-area="${index}"></div><button type="button" class="secondary document-icon-button" data-remove-summary="${index}" title="Remove component" aria-label="Remove component">${global.AppShell?.icons?.trash || "×"}</button></div>`).join("")}</div><p>Total: <strong id="offline-component-total">${sum().toLocaleString("en-IN")}/-</strong></p><div class="field"><label for="estimation-upload-note" class="required">Upload work note</label><textarea id="estimation-upload-note">${escape(state.details.offlineWorkNote || "")}</textarea></div></section>` : ""}
        <div class="offline-upload-actions"><button type="button" class="primary" data-offline-upload ${analyzing || artifact && global.ReportData.localOnly ? "disabled" : ""}>${artifact ? global.ReportData.localOnly ? "Report submitted" : "Mark Completed" : "Submit"}</button><span id="estimation-offline-status" data-offline-status role="status"></span></div></div>`;
    }
    async function encodeFile(file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
      return btoa(binary);
    }

    function sum() { return rows().reduce((total, item) => total + (Number(item.estimatedCost) || 0), 0); }
    function wire() {
      const byId = (id) => document.getElementById(id);
      if (selectedFile && byId("estimation-offline-file")) {
        const selection = new DataTransfer();
        selection.items.add(selectedFile);
        byId("estimation-offline-file").files = selection.files;
      }
      byId("estimation-template-download")?.addEventListener("click", downloadTemplate);
      byId("estimation-upload-type")?.addEventListener("change", async (event) => {
        const previous = state.details.uploadType || "", next = event.target.value;
        if (previous === next) return;
        if (isBusy() || confirmUploadType && !confirmUploadType(previous, next)) { event.target.value = previous; return; }
        state.details.uploadType = next;
        if (preparationChanged) preparationChanged(previous); else dirty();
        render();
        try { await persist(); if (retained()) render(); }
        catch (error) { byId("estimation-offline-status").textContent = error.message; }
      });
      byId("estimation-offline-file")?.addEventListener("change", async (event) => {
        if (isBusy()) return;
        selectedFile = event.target.files[0] || null;
        if (!selectedFile) return;
        const file = selectedFile, requestVersion = ++analysisVersion, mode = state.details.workMode;
        let errorMessage = "";
        content = "";
        dirty(); analyzing = true; render();
        try {
          await process("Reading component totals", "Reading the attached report and looking for component totals…", async (_stage, signal) => {
            const encoded = await encodeFile(file);
            const response = await fetch("/api/estimation/upload/analyze", {method: "POST", signal, headers: await global.ReportData.requestHeaders({"Content-Type": "application/json"}), body: JSON.stringify({fileName: file.name, content: encoded})});
            const data = await response.json();
            signal.throwIfAborted();
            if (!response.ok) throw new Error(data.error || "The report could not be read.");
            if (requestVersion !== analysisVersion || selectedFile !== file || state.details.workMode !== mode) return;
            content = encoded;
            errorMessage = data.extractionNotice || "";
            state.details.offlineComponents = data.components?.length ? data.components.map((item, index) => ({id: `offline-${index + 1}`, label: item.label || "", estimatedCost: item.estimatedCost ?? "", plinthArea: item.plinthArea ?? ""})) : [{id: uid(), label: "", estimatedCost: ""}];
            state.details.extractedComponentFields = Object.fromEntries(rows().map((row) => [
              row.id, ["label", "estimatedCost", "plinthArea"].filter((key) => row[key] != null && row[key] !== ""),
            ]));
            save();
          }, "Cancel and enter manually");
        } catch (error) {
          if (error.name === "AbortError") {
            errorMessage = "Extraction cancelled. The attachment is kept. Enter the component totals manually.";
          } else {
            errorMessage = error.message;
          }
        } finally {
          analyzing = false;
          render();
          if (errorMessage && byId("estimation-offline-status")) byId("estimation-offline-status").textContent = errorMessage;
        }
      });
      document.querySelectorAll("[data-offline-component-label],[data-offline-component-amount],[data-offline-component-area]").forEach((input) => input.addEventListener("input", () => {
        const key = input.hasAttribute("data-offline-component-label") ? "label" : input.hasAttribute("data-offline-component-area") ? "plinthArea" : "estimatedCost";
        const index = Number(input.dataset.offlineComponentLabel ?? input.dataset.offlineComponentAmount ?? input.dataset.offlineComponentArea);
        const row = rows()[index];
        row[key] = input.value;
        if (state.details.extractedComponentFields) {
          state.details.extractedComponentFields[row.id] = extractedFields(row).filter((field) => field !== key);
        }
        dirty(); byId("offline-component-total").textContent = sum().toLocaleString("en-IN") + "/-";
        save();
      }));
      byId("estimation-add-summary")?.addEventListener("click", () => { rows().push({id: uid(), label: "", estimatedCost: ""}); dirty(); save(); render(); });
      document.querySelectorAll("[data-remove-summary]").forEach((button) => button.addEventListener("click", () => { const [removed] = rows().splice(Number(button.dataset.removeSummary), 1); if (removed && state.details.extractedComponentFields) delete state.details.extractedComponentFields[removed.id]; dirty(); save(); render(); }));
      byId("estimation-upload-note")?.addEventListener("input", (event) => { state.details.offlineWorkNote = event.target.value; save(); });
      byId("estimation-remove-report")?.addEventListener("click", async () => {
        if (isBusy()) return;
        if (!global.confirm("Remove the retained report and its completion qualification?")) return;
        try {
          await process("Removing submitted report", "Removing the attachment and resetting completion qualification…", async () => {
            if (!global.ReportData.localOnly) {
              await global.BusinessApi.delete(`/api/tasks/${encodeURIComponent(global.ReportData.taskCode)}/artifacts/latest`);
              await global.TaskStore.refresh(global.ReportData.taskCode);
            }
            dirty(); await persist(); render();
          });
        }
        catch (error) { global.alert(error.message); }
      });
      document.querySelector("[data-offline-upload]")?.addEventListener("click", async (event) => {
        if (isBusy()) return;
        if (retained()) { global.dispatchEvent(new CustomEvent("sln:complete-offline-valuation")); return; }
        const status = byId("estimation-offline-status"), type = state.details.uploadType;
        const arithmeticError = global.NumericEntry?.error(document.getElementById("estimation-form"));
        if (arithmeticError) { status.textContent = arithmeticError; return; }
        if (!setupComplete()) { status.textContent = "Complete Report Setup before submitting."; return; }
        if (!["template", "retrospective"].includes(type)) { status.textContent = "Select Upload Type."; return; }
        if (type === "template" && externalReportOnly()) { status.textContent = "Choose Retrospective report for an industrial Centre Line estimate."; return; }
        if (type === "template" && !currentTask()?.templateDownloadedAt && !global.ReportData.localOnly) { status.textContent = "Download the template for this task first."; return; }
        if (!selectedFile) { status.textContent = "Attach the completed report."; return; }
        if (!rows().length || rows().some((row) => !row.label.trim() || String(row.estimatedCost).trim() === "" || !Number.isFinite(Number(row.estimatedCost)) || Number(row.estimatedCost) < 0)) { status.textContent = "Enter a name and a valid amount for every component. Zero is valid."; return; }
        if (!state.details.offlineWorkNote?.trim()) { status.textContent = "Add the upload work note."; return; }
        const button = event.currentTarget; button.disabled = true;
        try {
          await process("Submitting estimation report", "Saving the report, reviewed component totals and work note…", async () => {
            content ||= await encodeFile(selectedFile);
            await persist();
            const response = await fetch("/api/estimation/upload", {method: "POST", headers: await global.ReportData.requestHeaders({"Content-Type": "application/json"}), body: JSON.stringify({fileName: selectedFile.name, content, uploadType: type, workNote: state.details.offlineWorkNote, summary: {components: rows(), totalEstimatedCost: sum()}})});
            const data = await response.json(); if (!response.ok) throw new Error(data.error || "Upload failed.");
            if (global.ReportData.taskCode) await global.TaskStore.refresh(global.ReportData.taskCode);
            else {
              state.details.finalReport = {fileName: data.fileName, url: data.download, source: "Attached estimation report"};
              await persist();
            }
            selectedFile = null; content = "";
            global.dispatchEvent(new CustomEvent("sln:report-generated", {detail: {format: "uploaded", registered: data.registered, task: data.task, download: data.download, filename: data.fileName}}));
            render();
          });
        } catch (error) { status.textContent = error.message; button.disabled = false; }
      });
    }
    return {panel, wire};
  }
  global.EstimationOffline = {create};
})(window);
