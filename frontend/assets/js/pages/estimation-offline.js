/** Attachment-first estimation entry, with reviewed component costs for linked reports. */
(function exposeOfflineEstimation(global) {
  "use strict";
  function create({ state, currentTask, persist, save, render, dirty, downloadTemplate, setupComplete }) {
    let selectedFile = null, content = "", analyzing = false;
    const escape = (value) => global.WorkflowUI.escape(value);
    const rows = () => state.details.offlineComponents || [];
    const retained = () => {
      if (selectedFile) return null;
      if (global.ReportData.localOnly && state.details.finalReport?.url) {
        return {filename: state.details.finalReport.fileName, url: state.details.finalReport.url};
      }
      const task = currentTask();
      const artifact = task && global.TaskStore.latestArtifact(task);
      // Older uploads keep their existing completion path without guessing a
      // preparation source. Their original completion-note rule still applies.
      const legacyUpload = !task?.preparationSource && !state.details.uploadType && artifact?.artifactSource === "uploaded";
      return task?.reportFresh !== false && (legacyUpload || task?.retrospectiveReady && task.preparationSource === state.details.uploadType) ? artifact : null;
    };
    function panel() {
      const artifact = retained(), type = state.details.uploadType || "";
      return `<div class="panel offline-report-panel" data-key="offline"><h2>Complete &amp; Upload Report</h2>
        <section class="subgroup"><div class="subgroup-heading"><h3 id="estimation-upload-type-label">Upload Type</h3><button type="button" class="secondary" id="estimation-template-download">Download workbook template</button></div>
        <div class="field"><select id="estimation-upload-type" aria-labelledby="estimation-upload-type-label"><option value="">Select upload type</option><option value="template" ${type === "template" ? "selected" : ""}>Filled template</option><option value="retrospective" ${type === "retrospective" ? "selected" : ""}>Retrospective report</option></select></div>
        <p class="hint">Filled template requires a template download for this task. Existing retrospective reports can be attached directly.</p></section>
        ${artifact ? `<section class="subgroup"><div class="offline-artifact"><span aria-hidden="true">✓</span><div class="offline-artifact-details"><strong>${escape(artifact.filename)}</strong><small>Report submitted</small></div><div class="offline-artifact-actions"><a class="button-link secondary offline-artifact-download" href="${escape(artifact.url)}" download title="Download submitted report" aria-label="Download submitted report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg></a><button type="button" id="estimation-remove-report" class="secondary offline-artifact-download" title="Remove submitted report" aria-label="Remove submitted report">${global.AppShell?.icons?.trash || "×"}</button></div></div></section>` : `<section class="subgroup"><h3>Attach completed report</h3><div class="field"><label for="estimation-offline-file">Report (XLSX, DOCX or PDF)</label><input id="estimation-offline-file" type="file" accept=".xlsx,.docx,.pdf"></div><p class="hint">${analyzing ? "Reading component totals…" : selectedFile ? escape(selectedFile.name) : "Attach the report to review its component totals."}</p></section>`}
        ${!artifact && (selectedFile || rows().length) ? `<section class="subgroup"><div class="subgroup-heading"><h3>Review component totals</h3><button type="button" id="estimation-add-summary" class="secondary document-icon-button">${global.AppShell?.icons?.add || "+"} Add component</button></div><p class="hint">Use the complete final amount for each component or floor, including lump sums and adjustments.</p><div class="offline-component-table">${rows().map((row, index) => `<div class="grid offline-component-row"><div class="field"><label for="offline-label-${index}">Component / Floor</label><input id="offline-label-${index}" value="${escape(row.label)}" data-offline-component-label="${index}"></div><div class="field"><label for="offline-amount-${index}">Estimated Amount (Rs.)</label><input id="offline-amount-${index}" type="number" min="0" step="any" value="${escape(row.estimatedCost ?? "")}" data-offline-component-amount="${index}"></div><button type="button" class="secondary document-icon-button" data-remove-summary="${index}" title="Remove component" aria-label="Remove component">${global.AppShell?.icons?.trash || "×"}</button></div>`).join("")}</div><p>Total: <strong id="offline-component-total">${sum().toLocaleString("en-IN")}/-</strong></p><div class="field"><label for="estimation-upload-note" class="required">Upload work note</label><textarea id="estimation-upload-note">${escape(state.details.offlineWorkNote || "")}</textarea></div></section>` : ""}
        <div class="offline-upload-actions"><button type="button" class="primary" data-offline-upload ${analyzing || artifact && global.ReportData.localOnly ? "disabled" : ""}>${artifact ? global.ReportData.localOnly ? "Report submitted" : "Mark Completed" : "Submit"}</button><span id="estimation-offline-status" data-offline-status role="status"></span></div></div>`;
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
        state.details.uploadType = event.target.value; dirty(); render();
        try { await persist(); if (retained()) render(); }
        catch (error) { byId("estimation-offline-status").textContent = error.message; }
      });
      byId("estimation-offline-file")?.addEventListener("change", async (event) => {
        selectedFile = event.target.files[0] || null;
        if (!selectedFile) return;
        dirty(); analyzing = true; render();
        try {
          const bytes = new Uint8Array(await selectedFile.arrayBuffer());
          let binary = "";
          for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
          content = btoa(binary);
          const response = await fetch("/api/estimation/upload/analyze", {method: "POST", headers: await global.ReportData.requestHeaders({"Content-Type": "application/json"}), body: JSON.stringify({fileName: selectedFile.name, content})});
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "The report could not be read.");
          state.details.offlineComponents = data.components?.length ? data.components.map((item, index) => ({id: `offline-${index + 1}`, label: item.label || "", estimatedCost: item.estimatedCost ?? ""})) : [{id: crypto.randomUUID(), label: "", estimatedCost: ""}];
          await persist();
        } catch (error) { global.alert(error.message); selectedFile = null; content = ""; }
        finally { analyzing = false; render(); }
      });
      document.querySelectorAll("[data-offline-component-label],[data-offline-component-amount]").forEach((input) => input.addEventListener("input", () => {
        const isLabel = input.hasAttribute("data-offline-component-label"), index = Number(isLabel ? input.dataset.offlineComponentLabel : input.dataset.offlineComponentAmount);
        rows()[index][isLabel ? "label" : "estimatedCost"] = input.value;
        dirty(); byId("offline-component-total").textContent = sum().toLocaleString("en-IN") + "/-";
        save();
      }));
      byId("estimation-add-summary")?.addEventListener("click", () => { rows().push({id: crypto.randomUUID(), label: "", estimatedCost: ""}); dirty(); save(); render(); });
      document.querySelectorAll("[data-remove-summary]").forEach((button) => button.addEventListener("click", () => { rows().splice(Number(button.dataset.removeSummary), 1); dirty(); save(); render(); }));
      byId("estimation-upload-note")?.addEventListener("input", (event) => { state.details.offlineWorkNote = event.target.value; save(); });
      byId("estimation-remove-report")?.addEventListener("click", async () => {
        if (!global.confirm("Remove the retained report and its completion qualification?")) return;
        try {
          if (!global.ReportData.localOnly) {
            await global.BusinessApi.delete(`/api/tasks/${encodeURIComponent(global.ReportData.taskCode)}/artifacts/latest`);
            await global.TaskStore.refresh(global.ReportData.taskCode);
          }
          dirty(); await persist(); render();
        }
        catch (error) { global.alert(error.message); }
      });
      document.querySelector("[data-offline-upload]")?.addEventListener("click", async (event) => {
        if (retained()) { global.dispatchEvent(new CustomEvent("sln:complete-offline-valuation")); return; }
        const status = byId("estimation-offline-status"), type = state.details.uploadType;
        if (!setupComplete()) { status.textContent = "Complete Report Setup before submitting."; return; }
        if (!["template", "retrospective"].includes(type)) { status.textContent = "Select Upload Type."; return; }
        if (type === "template" && !currentTask()?.templateDownloadedAt && !global.ReportData.localOnly) { status.textContent = "Download the template for this task first."; return; }
        if (!selectedFile || !content) { status.textContent = "Attach the completed report."; return; }
        if (!rows().length || rows().some((row) => !row.label.trim() || String(row.estimatedCost).trim() === "" || !Number.isFinite(Number(row.estimatedCost)) || Number(row.estimatedCost) < 0)) { status.textContent = "Enter a name and a valid amount for every component. Zero is valid."; return; }
        if (!state.details.offlineWorkNote?.trim()) { status.textContent = "Add the upload work note."; return; }
        const button = event.currentTarget; button.disabled = true;
        try {
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
        } catch (error) { status.textContent = error.message; button.disabled = false; }
      });
    }
    return {panel, wire};
  }
  global.EstimationOffline = {create};
})(window);
