/** Task-linked durable drafts and authenticated report-request helpers. */
(function () {
  "use strict";

  const params = new URLSearchParams(window.location.search);
  const taskCode = params.get("task") || "";
  const localOnly = params.get("practice") === "1" || !taskCode || !window.BusinessApi;
  let revision = 0;
  let previewState = null;
  let saveChain = Promise.resolve();

  function localLoad(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (_error) { return null; }
  }

  async function load(localKey) {
    if (localOnly) {
      previewState = null;
      return localLoad(localKey);
    }
    const response = await BusinessApi.get(`/api/tasks/${encodeURIComponent(taskCode)}/draft`);
    revision = Number(response.draft?.revision || 0);
    previewState = response.draft?.preview || null;
    return response.draft?.payload || null;
  }

  async function save(localKey, reportKey, payload, schemaVersion = "1") {
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
      return response.draft.payload;
    };
    saveChain = saveChain.catch(() => {}).then(operation);
    return saveChain;
  }

  async function discard(localKey) {
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
    if (localOnly) return { ...headers };
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
