/** Shared preparation-method and offline-upload controls for standard valuation tasks. */
(function exposeRetrospectiveValuation(global) {
  "use strict";

  const MODE_NAME = "valuation-preparation-method";

  function taskFor(reportKey) {
    const taskCode = global.ReportData?.taskCode;
    const task = taskCode && global.TaskStore?.get(taskCode);
    return task?.reportKey === reportKey ? task : null;
  }

  function supportsChoice(reportKey) {
    const task = taskFor(reportKey);
    if (!task) return false;
    if (reportKey === "valuation-general" && ["KVB", "KB"].includes(task.institutionCode)) return false;
    return ["father", "employee"].includes(global.__VALUX_AUTH_CONTEXT__?.user?.role);
  }

  function preparationPanel(reportKey, selectedMode, onSelect) {
    const panel = document.createElement("div");
    panel.className = "panel preparation-method-panel";
    panel.dataset.group = "preparation";
    const reportLabel = taskFor(reportKey)?.reportGroup === "revaluation" ? "revaluation" : "valuation";
    panel.innerHTML = `<h2>Preparation Method</h2>
      <p class="section-intro">Choose how this ${reportLabel} report will be prepared. The remaining steps will adapt to this selection.</p>
      <div class="preparation-choice-grid" role="radiogroup" aria-label="Report preparation method">
        <label class="preparation-choice-card">
          <input type="radio" name="${MODE_NAME}" value="online" data-preparation-method ${selectedMode === "online" ? "checked" : ""}>
          <span><strong>Fill online</strong><small>Complete the ${reportLabel} form, add photographs and map, preview the report, then generate the DOCX.</small></span>
        </label>
        <label class="preparation-choice-card">
          <input type="radio" name="${MODE_NAME}" value="offline" data-preparation-method ${selectedMode === "offline" ? "checked" : ""}>
          <span><strong>Complete offline and upload</strong><small>Download the clean template or use an existing completed report, then attach the finished DOCX or PDF with a work note.</small></span>
        </label>
      </div>
      <p class="preparation-selection-status" data-preparation-status aria-live="polite">${selectedMode ? "Preparation method selected." : "Select a preparation method to continue."}</p>`;

    panel.querySelectorAll("[data-preparation-method]").forEach((input) => {
      input.addEventListener("change", async () => {
        if (!input.checked) return;
        const accepted = await onSelect(input.value);
        if (accepted === false) {
          panel.querySelectorAll("[data-preparation-method]").forEach((control) => {
            control.checked = control.value === selectedMode;
          });
          return;
        }
        selectedMode = input.value;
        panel.querySelector("[data-preparation-status]").textContent = "Preparation method selected.";
      });
    });
    return panel;
  }

  function offlinePanel(reportKey, savedUploadType = "", prepareUpload = null) {
    const progress = reportKey === "progress" || reportKey === "completion";
    const taskCode = global.ReportData?.taskCode;
    const task = taskFor(reportKey);
    if (!task) return null;

    const templateUrl = reportKey === "valuation-agricultural"
      ? "/templates/agricultural-master.docx"
      : "/templates/general-master.docx";
    const panel = document.createElement("div");
    panel.className = "panel offline-report-panel";
    panel.dataset.group = "offline";
    panel.innerHTML = `<h2>Complete &amp; Upload Report</h2>
      <p class="section-intro">Complete the downloaded template—or use an existing completed report—and attach the final DOCX or PDF. The task remains In Progress until the attachment is uploaded and the task is explicitly completed.</p>
      <section class="subgroup offline-template-step">
        <div class="subgroup-heading"><div><h3>1. Prepare the report</h3><p class="hint">Use the clean template when starting a new offline report. An existing completed report can be uploaded directly.</p></div><a class="button-link secondary" href="${templateUrl}?task=${encodeURIComponent(taskCode)}" data-template-download>Download clean DOCX template</a></div>
      </section>
      <section class="subgroup offline-upload-step">
        <h3>2. Attach the completed report</h3><div class="field"><label for="valuation-upload-type">Upload Type</label><select id="valuation-upload-type"><option value="">Select upload type</option><option value="template">Filled template</option><option value="retrospective">Retrospective report</option></select></div>
        <div class="grid" data-offline-entry>
          <div class="field"><label for="offline-valuation-file">Completed report (DOCX or PDF)</label><input id="offline-valuation-file" type="file" accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"></div>
          <div class="field full"><label class="required" for="offline-valuation-note">Upload work note</label><textarea id="offline-valuation-note" placeholder="Explain the completed report and the work performed"></textarea></div>
        </div>
        <div class="offline-artifact" data-offline-artifact hidden><span aria-hidden="true">✓</span><div class="offline-artifact-details"><strong data-offline-filename></strong><small>Completed report submitted</small></div><div class="offline-artifact-actions"><a class="button-link secondary offline-artifact-download" data-offline-download title="Download submitted report" aria-label="Download submitted report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg></a><button type="button" class="secondary offline-artifact-download" data-offline-remove title="Remove submitted report" aria-label="Remove submitted report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/></svg></button></div></div>
        <div class="offline-upload-actions"><button type="button" class="primary" data-offline-upload>Submit</button><span data-offline-status role="status" aria-live="polite"></span></div>
      </section>`;

    const file = panel.querySelector("#offline-valuation-file");
    const note = panel.querySelector("#offline-valuation-note");
    const upload = panel.querySelector("[data-offline-upload]");
    const download = panel.querySelector("[data-offline-download]");
    const remove = panel.querySelector("[data-offline-remove]");
    const status = panel.querySelector("[data-offline-status]");
    const entry = panel.querySelector("[data-offline-entry]");
    const attachment = panel.querySelector("[data-offline-artifact]");

    const uploadType = panel.querySelector("#valuation-upload-type");
    if (progress) {
      panel.querySelector(".section-intro").textContent = "Review the work assessment, then attach the completed DOCX or PDF with a work note.";
      panel.querySelector(".offline-template-step").hidden = true;
      uploadType.closest(".field").hidden = true;
      panel.querySelector(".offline-upload-step h3").textContent = "Attach the retrospective report";
    }
    uploadType.value = progress ? "retrospective" : savedUploadType || (["template", "retrospective"].includes(task.preparationSource) ? task.preparationSource : "");
    uploadType.addEventListener("change", () => global.dispatchEvent(new CustomEvent("sln:valuation-upload-type-changed")));
    panel.querySelector("[data-template-download]").addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        const response = await fetch(event.currentTarget.href);
        if (!response.ok) throw new Error("The template could not be downloaded.");
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a"); link.href = url; link.download = `${reportKey === "valuation-general" ? "General" : "Agricultural"}_${task.reportGroup === "revaluation" ? "Revaluation" : "Valuation"}_Offline_Template.docx`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        await global.TaskStore.refresh(taskCode);
      } catch (error) { status.textContent = error.message; }
    });

    function render(current = global.TaskStore.get(taskCode)) {
      const artifact = global.ReportData.readOnly
        ? current?.status === "Closed" ? global.TaskStore.finalArtifact(current) : global.TaskStore.latestArtifact(current)
        : current?.retrospectiveReady && current.reportFresh !== false ? global.TaskStore.latestArtifact(current) : null;
      const ready = Boolean(artifact?.url);
      entry.hidden = ready;
      attachment.hidden = !ready;
      upload.textContent = ready ? "Mark Completed" : "Submit";
      panel.querySelector("[data-offline-filename]").textContent = artifact?.filename || "Completed valuation report";
      panel.querySelector("[data-offline-filename]").title = artifact?.filename || "Completed valuation report";
      remove.hidden = !ready || global.ReportData.readOnly;
      upload.hidden = Boolean(global.ReportData.readOnly);
      download.hidden = !artifact?.url;
      if (artifact?.url) {
        download.href = artifact.url;
        download.download = artifact.filename || "completed-valuation-report";
      }
      status.textContent = global.ReportData.readOnly && ready ? "Retained report — read-only."
        : ready
        ? "Report submitted. Mark Completed to finish using the recorded upload work note."
        : "No completed report attached.";
    }

    upload.addEventListener("click", async () => {
      const current = global.TaskStore.get(taskCode);
      if (current?.retrospectiveReady && current.reportFresh !== false && global.TaskStore.latestArtifact(current)?.url) {
        global.dispatchEvent(new CustomEvent("sln:complete-offline-valuation"));
        return;
      }
      if (!uploadType.value) { status.textContent = "Select the upload type."; uploadType.focus(); return; }
      if (uploadType.value === "template" && !global.TaskStore.get(taskCode)?.templateDownloadedAt) { status.textContent = "Download the template for this task before uploading a filled template."; return; }
      const selected = file.files[0];
      if (!selected) {
        status.textContent = "Select a completed DOCX or PDF report.";
        file.focus();
        return;
      }
      if (!note.value.trim()) {
        status.textContent = "Add the substantive upload work note.";
        note.focus();
        return;
      }
      upload.disabled = true;
      status.textContent = "Attaching report…";
      try {
        if (prepareUpload && !(await prepareUpload())) {
          status.textContent = "Review the work assessment before submitting.";
          return;
        }
        const response = await fetch(progress ? "/api/progress/retrospective/upload" : "/api/valuation/retrospective/upload", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "X-CSRF-Token": await global.BusinessApi.csrf(),
            "X-Task-Code": taskCode,
            "X-File-Name": selected.name,
            "X-Work-Note": encodeURIComponent(note.value.trim()),
            "X-Retrospective-Mode": "offline",
            "X-Upload-Type": uploadType.value,
            "Content-Type": selected.type || "application/octet-stream",
          },
          body: selected,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "The completed report could not be attached.");
        await global.TaskStore.refresh(taskCode);
        file.value = "";
        note.value = "";
        render();
        global.dispatchEvent(new CustomEvent("sln:report-generated", { detail: {
          format: selected.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx",
          download: payload.download,
          filename: payload.fileName,
          registered: true,
          task: payload.task,
        }}));
      } catch (error) {
        status.textContent = error.message || "The completed report could not be attached.";
      } finally {
        upload.disabled = false;
      }
    });
    global.addEventListener("sln:tasks-changed", () => render());

    remove.addEventListener("click", async () => {
      if (!global.confirm("Remove the attached report? The task will no longer qualify for completion.")) return;
      remove.disabled = true;
      try {
        await global.BusinessApi.delete(`/api/tasks/${encodeURIComponent(taskCode)}/artifacts/latest`);
        await global.TaskStore.refresh(taskCode);
        render();
        global.dispatchEvent(new CustomEvent("sln:report-dirty"));
      } catch (error) {
        status.textContent = error.message || "The completed report could not be removed.";
      } finally {
        remove.disabled = false;
      }
    });
    render(task);
    return panel;
  }

  function revaluationLabel(label) {
    return String(label || "").replace(/\bvaluation\b/gi, (word) =>
      word === word.toUpperCase() ? "RE-VALUATION" : word[0] === "V" ? "Re-Valuation" : "re-valuation");
  }

  function displayRevaluationSource(host, task) {
    if (task?.reportGroup !== "revaluation" || !task.linkedValuationId) return;
    const source = task.linkedValuationId;
    const notice = document.createElement("p");
    notice.className = "hint";
    const link = document.createElement("a");
    link.href = `/tasks/detail?id=${encodeURIComponent(source)}`;
    link.textContent = source;
    notice.append("Original valuation: ", link);
    if (task.linkedValuationArtifactId) {
      const download = document.createElement("a");
      download.href = `/api/tasks/${encodeURIComponent(source)}/artifacts/${encodeURIComponent(task.linkedValuationArtifactId)}/download`;
      download.textContent = "Download source report";
      notice.append(" · ", download);
    }
    if (task.revaluationManualEntry) notice.append(" · Manual entry required for details available only in the source report.");
    host.append(notice);
  }

  global.RetrospectiveValuation = { supportsChoice, preparationPanel, offlinePanel, revaluationLabel, displayRevaluationSource };
})(window);
