/** Institution-specific valuation workflows that are completed outside the online form. */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);

  function workflowForTask() {
    const taskId = params.get("task");
    const task = taskId && window.TaskStore ? TaskStore.get(taskId) : null;
    if (!task || task.reportKey !== "valuation-general") return null;
    if (task.institutionCode === "KVB") {
      return {
        task,
        key: "kvb",
        title: "KVB valuation workbook",
        label: "Karur Vysya Bank",
        uploadUrl: "/api/valuation/kvb/upload",
        removeUrl: "/api/valuation/kvb/upload",
        accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        format: "xlsx",
        templateUrl: "/templates/kvb-valuation.xlsx",
        templateLabel: "Download clean KVB Excel template",
        instructions: "Download the clean bank workbook, complete it in Excel, then attach the completed .xlsx file here.",
        source: "Uploaded KVB Excel",
      };
    }
    if (task.institutionCode === "KB") {
      return {
        task,
        key: "karnataka",
        title: "Karnataka Bank Valocity report",
        label: "Karnataka Bank",
        uploadUrl: "/api/valuation/karnataka/upload",
        removeUrl: "/api/valuation/karnataka/upload",
        accept: ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf,application/pdf",
        format: "",
        instructions: "Complete the valuation in Valocity, generate its DOCX or PDF there, then attach that completed report here.",
        source: "Attached Valocity report",
      };
    }
    return null;
  }

  function escape(value) {
    return window.WorkflowUI.escape(value);
  }

  function formatSize(bytes) {
    if (!Number.isFinite(Number(bytes))) return "";
    const value = Number(bytes);
    if (value < 1024) return `${value} bytes`;
    return `${(value / 1024).toFixed(1)} KB`;
  }

  function activeArtifact(task) {
    return window.TaskStore.latestArtifact(task);
  }

  function activate() {
    const workflow = workflowForTask();
    if (!workflow) return false;

    if (workflow.task.reportGroup === "revaluation") workflow.title = workflow.task.reportLabel;
    document.title = workflow.title;
    document.querySelector("header h1").textContent = workflow.title;
    document.querySelector("header p").textContent = "Prepare the bank-specific report outside the online valuation form, then retain the completed file with this assignment.";
    document.getElementById("status").textContent = "Offline workflow";
    document.getElementById("nav").innerHTML = '<span class="offline-nav-label">Offline report</span>';

    const workspace = document.querySelector("main .workspace");
    const artifact = activeArtifact(workflow.task);
    const canManageAttachment = !window.ReportData?.readOnly && window.WorkflowAccess?.can("openReport", workflow.task);
    const artifactMarkup = artifact?.url
      ? `<div class="offline-artifact"><span aria-hidden="true">✓</span><div class="offline-artifact-details"><strong>${escape(artifact.filename)}</strong><small>${escape(artifact.source || "Completed report attached")}</small></div><div class="offline-artifact-actions"><a class="button-link secondary offline-artifact-download" href="${escape(artifact.url)}" title="Download completed report" aria-label="Download completed report"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg></a>${canManageAttachment ? '<button class="secondary offline-remove-attachment" id="remove-institution-report" type="button">Remove</button>' : ""}</div></div>`
      : '<p class="offline-artifact-pending">No completed report has been attached yet.</p>';
    const templateMarkup = workflow.templateUrl
      ? `<a class="button-link primary offline-template-download" href="${workflow.templateUrl}">${workflow.templateLabel}</a>`
      : "";
    const attachLabel = artifact?.url ? "Replace completed report" : "Attach completed report";
    workspace.innerHTML = `<form id="valuation-form" class="institution-offline-valuation" novalidate>
      <section class="offline-valuation-card">
        <div class="offline-valuation-heading"><div><p class="eyebrow">${escape(workflow.label)}</p><h2>${escape(workflow.title)}</h2><p>${escape(workflow.instructions)}</p></div><span class="offline-mode-badge">Offline workflow</span></div>
        <ol class="offline-steps">${workflow.templateUrl ? "<li>Download the bank's clean Excel template.</li>" : "<li>Complete the report in Valocity.</li>"}<li>Complete the report in the required external system.</li><li>Attach the final completed file to enable task completion.</li></ol>
        <div class="offline-actions">${templateMarkup}${canManageAttachment ? `<button type="button" class="secondary attachment-button" id="attach-institution-report"><span class="attachment-button-icon" aria-hidden="true">⇧</span><span>${attachLabel}</span></button><input id="institution-report-upload" class="file-input" type="file" accept="${workflow.accept}">` : ""}</div>
        <p class="offline-upload-status" id="offline-upload-status" role="status" aria-live="polite"></p>
      </section>
      <section class="offline-artifact-card"><h3>Completed report</h3>${artifactMarkup}</section>
    </form>`;

    window.RetrospectiveValuation?.displayRevaluationSource(workspace.querySelector(".offline-valuation-heading > div"), workflow.task);
    const upload = document.getElementById("institution-report-upload");
    const attach = document.getElementById("attach-institution-report");
    const status = document.getElementById("offline-upload-status");
    attach?.addEventListener("click", () => upload.click());
    upload?.addEventListener("change", async () => {
      const file = upload.files?.[0];
      if (!file) return;
      const extension = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
      const accepted = workflow.key === "kvb" ? extension === ".xlsx" : [".docx", ".pdf"].includes(extension);
      if (!accepted) {
        status.textContent = workflow.key === "kvb" ? "Select a completed KVB Excel workbook (.xlsx)." : "Select the DOCX or PDF generated by Valocity.";
        upload.value = "";
        return;
      }
      attach.disabled = true;
      status.textContent = "Saving the completed report…";
      try {
        const response = await fetch(workflow.uploadUrl, {
          method: "POST",
          headers: await ReportData.requestHeaders({ "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name) }),
          body: file,
        });
        const record = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(record.error || "The completed report could not be attached.");
        window.dispatchEvent(new CustomEvent("sln:report-generated", {
          detail: {
            format: workflow.format || extension.slice(1),
            download: record.download,
            filename: record.fileName,
            source: workflow.source,
            institutionOffline: true,
            storageId: record.savedName || "",
            registered: record.registered === true,
            task: record.task || null,
          },
        }));
        status.textContent = `Attached ${record.fileName}${record.size ? ` (${formatSize(record.size)})` : ""}.`;
        window.setTimeout(() => window.location.reload(), 450);
      } catch (error) {
        status.textContent = error instanceof Error && error.message ? error.message : "The completed report could not be attached. Please try again.";
        attach.disabled = false;
        upload.value = "";
      }
    });
    document.getElementById("remove-institution-report")?.addEventListener("click", async () => {
      if (!artifact?.url || !window.confirm("Remove this completed report attachment? You will need to attach another valid completed file before the task can be completed.")) return;
      const remove = document.getElementById("remove-institution-report");
      remove.disabled = true;
      status.textContent = "Removing the completed report attachment…";
      try {
        const response = await fetch(workflow.removeUrl, { method: "DELETE", headers: await ReportData.requestHeaders() });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "The completed report attachment could not be removed.");
        if (result.task) window.TaskStore.acceptServerTask(result.task);
        else await window.TaskStore.refresh(workflow.task.id);
        status.textContent = "Completed report attachment removed.";
        window.setTimeout(() => window.location.reload(), 300);
      } catch (error) {
        status.textContent = error instanceof Error && error.message ? error.message : "The completed report attachment could not be removed. Please try again.";
        remove.disabled = false;
      }
    });
    return true;
  }

  window.InstitutionValuationOffline = { activate };
})();
