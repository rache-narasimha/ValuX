/** Task-linked durable drafts and authenticated report-request helpers. */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const practice = params.get("practice") === "1";
  const taskCode = practice ? "" : params.get("task") || "";
  const localOnly = params.get("practice") === "1" || !taskCode || !window.BusinessApi;
  let revision = 0;
  let previewState = null;
  let saveChain = Promise.resolve();
  let retainedReadOnly = false;
  let initialDraft = window.__VALUX_BUSINESS_CONTEXT__?.reportDraft;
  const readOnly = () => retainedReadOnly || Boolean(taskCode && ["Completed", "Closed"].includes(window.TaskStore?.get(taskCode)?.status));

  function localLoad(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (_error) { return null; }
  }

  async function load(localKey) {
    if (localOnly) {
      previewState = null;
      return localLoad(localKey);
    }
    const pageDraft = initialDraft;
    initialDraft = null;
    const response = pageDraft?.taskCode === taskCode
      ? pageDraft : await BusinessApi.get(`/api/tasks/${encodeURIComponent(taskCode)}/draft`);
    retainedReadOnly = response.draft?.readOnly === true;
    revision = Number(response.draft?.revision || 0);
    previewState = response.draft?.preview || null;
    return response.draft?.payload || null;
  }

  async function save(localKey, reportKey, payload, schemaVersion = "1") {
    if (readOnly()) throw new Error("This retained report is read-only. Reopen the task to edit it.");
    if (localOnly) {
      localStorage.setItem(localKey, JSON.stringify(payload));
      return payload;
    }
    const operation = async () => {
      const response = await BusinessApi.post(`/api/tasks/${encodeURIComponent(taskCode)}/draft`, {
        reportKey,
        schemaVersion,
        payload,
        revision,
      });
      revision = Number(response.draft.revision);
      if (response.draft.preparationChanged) await refreshTask();
      return response.draft.payload;
    };
    saveChain = saveChain.catch(() => {}).then(operation);
    return saveChain;
  }

  async function discard(localKey) {
    if (readOnly()) throw new Error("This retained report is read-only.");
    if (localOnly) {
      localStorage.removeItem(localKey);
      return;
    }
    await saveChain.catch(() => {});
    await BusinessApi.delete(`/api/tasks/${encodeURIComponent(taskCode)}/draft`);
    revision = 0;
    previewState = null;
  }

  async function requestHeaders(headers = {}) {
    if (readOnly()) throw new Error("This retained report is read-only.");
    if (localOnly) return { ...headers,
      ...(window.BusinessApi ? { "X-CSRF-Token": await BusinessApi.csrf() } : {}),
      ...(practice ? { "X-Practice-Mode": "1" } : {}),
    };
    return {
      ...headers,
      "X-CSRF-Token": await BusinessApi.csrf(),
      "X-Task-Code": taskCode,
    };
  }

  function requestPayload(payload = {}) {
    return localOnly ? payload : { ...payload, taskCode };
  }

  async function refreshTask() {
    if (localOnly || !window.TaskStore?.refresh) return null;
    return TaskStore.refresh(taskCode);
  }

  window.ReportData = {
    get readOnly() { return readOnly(); },
    taskCode,
    localOnly,
    load,
    save,
    discard,
    requestHeaders,
    requestPayload,
    refreshTask,
    preview: () => previewState ? { ...previewState } : null,
    setPreview: (value) => { previewState = value ? { ...value } : null; },
  };
})();
