/** Shared preparation-method and offline-upload controls for valuation and linked progress/completion tasks. */
(function exposeRetrospectiveValuation(global) {
  "use strict";

  const MODE_NAME = "valuation-preparation-method";
  const practiceMode = () => new URLSearchParams(global.location.search).get("practice") === "1";

  function taskFor(reportKey) {
    if (practiceMode()) return null;
    const taskCode = global.ReportData?.taskCode;
    const task = taskCode && global.TaskStore?.get(taskCode);
    return task?.reportKey === reportKey ? task : null;
  }

  function supportsChoice(reportKey) {
    const task = taskFor(reportKey);
    if (!task && !practiceMode()) return false;
    if (reportKey === "valuation-general" && ["KVB", "KB"].includes(task?.institutionCode)) return false;
    return ["father", "employee"].includes(global.__VALUX_AUTH_CONTEXT__?.user?.role);
  }

  function confirmPreparationChange(kind, previous, next, task) {
    if (!previous && !task?.reportGeneratedAt) return true;
    const labels = { online: "Fill online", offline: "Complete offline and upload", template: "Filled template", retrospective: "Retrospective report" };
    return global.confirm(`Change ${kind} to ${labels[next] || "no upload type"}? Your entered details will be kept. Any existing report or preview will no longer qualify. Generate or submit a fresh report before completing the task, even if you switch back.`);
  }

  function confirmReportEdit(mode) {
    const instruction = mode === "offline" ? "submit a fresh completed report" : "preview and generate a fresh report";
    return global.confirm(`Changing report details will make the retained report outdated. Continue and ${instruction} before completing this task?`);
  }

  function preparationPanel(reportKey, selectedMode, onSelect) {
    const progress = reportKey === "progress" || reportKey === "completion";
    const reportLabel = progress ? reportKey : taskFor(reportKey)?.reportGroup === "revaluation" ? "revaluation" : "valuation";
    const onlineHint = progress
      ? "Review the work assessment, add site photographs, preview the report, then generate the DOCX."
      : `Complete the ${reportLabel} form, add photographs and map, preview the report, then generate the DOCX.`;
    const offlineHint = progress
      ? "Review the work assessment, then attach a filled template or an existing completed report with a work note."
      : "Download the clean template or use an existing completed report, then attach the finished DOCX or PDF with a work note.";
    const panel = ValuxUI.reportPreparationPanel({
      reportLabel, name: MODE_NAME, selected: selectedMode,
      options: [
        { value: "online", label: "Fill online", help: onlineHint },
        { value: "offline", label: "Complete offline and upload", help: offlineHint },
      ],
    });

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

  function offlinePanel(reportKey, savedUploadType, { prepareUpload, downloadTemplate, uploadTypeChanged, practiceSaved, practiceChanged, practiceReportType } = {}) {
    const progress = reportKey === "progress" || reportKey === "completion";
    const practice = practiceMode();
    const taskCode = practice ? "" : global.ReportData?.taskCode;
    const task = taskFor(reportKey);
    if (!task && !practice) return null;
    let localState = { ...(practiceSaved || {}) };
    const selectedReportType = () => practiceReportType?.() || reportKey;
    async function savePractice() { if (practice) await practiceChanged?.({ ...localState }); }

    const templateUrl = reportKey === "valuation-agricultural" ? "/templates/agricultural-master.docx" : "/templates/general-master.docx";
    const panel = document.createElement("div");
    panel.className = "panel offline-report-panel";
    panel.dataset.group = "offline";
    panel.innerHTML = `<h2>Complete &amp; Upload Report</h2>
      <section class="subgroup">
        <div class="subgroup-heading"><h3 id="offline-upload-type-label">Upload Type</h3>
          <button type="button" class="secondary" data-template-download>Download DOCX template</button>
        </div>
        <div class="field"><select id="valuation-upload-type" aria-labelledby="offline-upload-type-label"><option value="">Select upload type</option><option value="template">Filled template</option><option value="retrospective">Retrospective report</option></select></div>
        <p class="hint">Filled template requires a template download for ${practice ? "this Practice form" : "this task"}. Existing retrospective reports can be attached directly.${practice ? " Practice submissions do not change or complete assignments." : ""}</p>
      </section>
      <section class="subgroup offline-upload-step">
        <h3 data-offline-entry-heading>Attach completed report</h3>
        <div class="grid" data-offline-entry>
          <div class="field"><label for="offline-valuation-file">Completed report (DOCX or PDF)</label><input id="offline-valuation-file" type="file" accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf"></div>
          <div class="field full"><label class="required" for="offline-valuation-note">Upload work note</label><textarea id="offline-valuation-note" placeholder="Explain the completed report and the work performed"></textarea></div>
        </div>
        <div class="offline-artifact" data-offline-artifact hidden><span aria-hidden="true">✓</span><div class="offline-artifact-details"><strong data-offline-filename></strong><small>Completed report submitted</small></div><div class="offline-artifact-actions"><a class="button-link secondary offline-artifact-download" data-offline-download title="Download submitted report" aria-label="Download submitted report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg></a><button type="button" class="secondary offline-artifact-download" data-offline-remove title="Remove submitted report" aria-label="Remove submitted report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/></svg></button></div></div>
      </section>
        <div class="offline-upload-actions"><button type="button" class="primary" data-offline-upload>Submit</button><span data-offline-status role="status" aria-live="polite"></span></div>`;

    const file = panel.querySelector("#offline-valuation-file");
    const note = panel.querySelector("#offline-valuation-note");
    const upload = panel.querySelector("[data-offline-upload]");
    const download = panel.querySelector("[data-offline-download]");
    const remove = panel.querySelector("[data-offline-remove]");
    const status = panel.querySelector("[data-offline-status]");
    const entry = panel.querySelector("[data-offline-entry]");
    const attachment = panel.querySelector("[data-offline-artifact]");

    const uploadType = panel.querySelector("#valuation-upload-type");
    const ownSource = (current) => progress ? current?.ownPreparationSource : current?.preparationSource;
    const taskSource = ownSource(task);
    uploadType.value = savedUploadType ?? (["template", "retrospective"].includes(taskSource) ? taskSource : "");
    let previousUploadType = uploadType.value;
    uploadType.addEventListener("change", async () => {
      const next = uploadType.value;
      if (!confirmPreparationChange("upload type", previousUploadType, next, taskCode ? global.TaskStore.get(taskCode) : null)) {
        uploadType.value = previousUploadType;
        return;
      }
      uploadType.disabled = upload.disabled = true;
      try {
        await uploadTypeChanged?.(next);
        previousUploadType = next;
        if (practice) { localState.artifact = null; await savePractice(); }
        // Changing the selection immediately makes the prior attachment
        // ineligible, even while the updated task record is being fetched.
        render(null);
        if (taskCode) await global.TaskStore.refresh(taskCode);
      } catch (error) {
        uploadType.value = previousUploadType;
        status.textContent = error.message;
      } finally {
        uploadType.disabled = upload.disabled = false;
      }
    });
    const templateButton = panel.querySelector("[data-template-download]");
    templateButton.addEventListener("click", async () => {
      templateButton.disabled = true;
      status.textContent = "Preparing DOCX template…";
      try {
        const response = downloadTemplate ? await downloadTemplate()
          : await fetch(practice ? templateUrl : `${templateUrl}?task=${encodeURIComponent(taskCode)}`);
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}));
          throw new Error(failure.error || "The template could not be downloaded.");
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = progress
          ? `${selectedReportType() === "progress" ? "Progress" : "Completion"}_Offline_Template.docx`
          : `${reportKey === "valuation-general" ? "General" : "Agricultural"}_${task?.reportGroup === "revaluation" ? "Revaluation" : "Valuation"}_Offline_Template.docx`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (practice) { localState.templateDownloadedAt = new Date().toISOString(); localState.templateReportType = selectedReportType(); await savePractice(); }
        else await global.TaskStore.refresh(taskCode);
        status.textContent = "Template downloaded.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        templateButton.disabled = false;
      }
    });

    function render(current = taskCode ? global.TaskStore.get(taskCode) : null) {
      const artifact = practice ? localState.artifact : global.ReportData.readOnly
        ? current?.status === "Closed" ? global.TaskStore.finalArtifact(current) : global.TaskStore.latestArtifact(current)
        : current?.retrospectiveReady && current.reportFresh !== false && ownSource(current) === uploadType.value ? global.TaskStore.latestArtifact(current) : null;
      const ready = Boolean(artifact?.url);
      entry.hidden = ready;
      panel.querySelector("[data-offline-entry-heading]").hidden = ready;
      templateButton.hidden = global.ReportData.readOnly;
      attachment.hidden = !ready;
      upload.textContent = ready ? practice ? "Report submitted" : "Mark Completed" : "Submit";
      upload.disabled = practice && ready;
      upload.dataset.practiceSubmitted = String(practice && ready);
      panel.querySelector("[data-offline-filename]").textContent = artifact?.filename || "Completed report";
      panel.querySelector("[data-offline-filename]").title = artifact?.filename || "Completed report";
      remove.hidden = !ready || global.ReportData.readOnly;
      upload.hidden = Boolean(global.ReportData.readOnly);
      download.hidden = !artifact?.url;
      if (artifact?.url) {
        download.href = artifact.url;
        download.download = artifact.filename || "completed-valuation-report";
      }
      status.textContent = global.ReportData.readOnly && ready ? "Retained report — read-only."
        : ready
        ? practice ? "Practice report submitted. No assignment was changed or completed." : "Report submitted. Mark Completed to finish using the recorded upload work note."
        : "No completed report attached.";
    }

    upload.addEventListener("click", async () => {
      if (practice && localState.artifact) return;
      const current = taskCode ? global.TaskStore.get(taskCode) : null;
      if (current?.retrospectiveReady && current.reportFresh !== false && ownSource(current) === uploadType.value && global.TaskStore.latestArtifact(current)?.url) {
        global.dispatchEvent(new CustomEvent("sln:complete-offline-valuation"));
        return;
      }
      if (!uploadType.value) { status.textContent = "Select the upload type."; uploadType.focus(); return; }
      if (uploadType.value === "template" && !(practice ? localState.templateDownloadedAt && localState.templateReportType === selectedReportType() : current?.templateDownloadedAt)) { status.textContent = "Download the template before uploading a filled template."; return; }
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
      upload.disabled = uploadType.disabled = templateButton.disabled = true;
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
            ...(practice ? { "X-Practice-Mode": "1", "X-Report-Type": selectedReportType() } : {}),
            "Content-Type": selected.type || "application/octet-stream",
          },
          body: selected,
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "The completed report could not be attached.");
        if (practice) { localState.artifact = { url: payload.download, filename: payload.fileName }; await savePractice(); }
        else await global.TaskStore.refresh(taskCode);
        file.value = "";
        note.value = "";
        render();
        global.dispatchEvent(new CustomEvent("sln:report-generated", { detail: {
          format: selected.name.toLowerCase().endsWith(".pdf") ? "pdf" : "docx",
          download: payload.download,
          filename: payload.fileName,
          registered: payload.registered === true,
          task: payload.task,
        }}));
      } catch (error) {
        status.textContent = error.message || "The completed report could not be attached.";
      } finally {
        upload.disabled = uploadType.disabled = templateButton.disabled = false;
        if (practice) upload.disabled = Boolean(localState.artifact);
      }
    });
    global.addEventListener("sln:tasks-changed", () => render());
    if (practice) global.addEventListener("sln:report-dirty", () => {
      if (!localState.artifact) return;
      localState.artifact = null; render();
      savePractice().catch((error) => { status.textContent = error.message; });
    });

    remove.addEventListener("click", async () => {
      if (!global.confirm("Remove the attached report? The task will no longer qualify for completion.")) return;
      remove.disabled = true;
      try {
        if (practice) { localState.artifact = null; await savePractice(); }
        else {
          await global.BusinessApi.delete(`/api/tasks/${encodeURIComponent(taskCode)}/artifacts/latest`);
          await global.TaskStore.refresh(taskCode);
        }
        render();
        global.dispatchEvent(new CustomEvent("sln:report-dirty"));
      } catch (error) {
        status.textContent = error.message || "The completed report could not be removed.";
      } finally {
        remove.disabled = false;
      }
    });
    render(task);
    if (practice && localState.artifact?.url) {
      const restoredUrl = localState.artifact.url;
      fetch(restoredUrl, { method: "HEAD", cache: "no-store" }).then(async (response) => {
        if (response.status !== 404 || localState.artifact?.url !== restoredUrl) return;
        localState.artifact = null; await savePractice(); render();
        status.textContent = "The temporary Practice file expired. Attach the file again to continue.";
      }).catch(() => { status.textContent = "The Practice file could not be checked. Try its download or attach it again."; });
    }
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

  global.RetrospectiveValuation = { supportsChoice, preparationPanel, offlinePanel, confirmPreparationChange, confirmReportEdit, revaluationLabel, displayRevaluationSource };
})(window);
