/** Authenticated JSON client for durable workflow and reference-data APIs. */
(function () {
  "use strict";

  let csrfToken = "";

  async function csrf() {
    if (csrfToken) return csrfToken;
    const response = await fetch("/api/auth/context", { credentials: "same-origin", cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.authenticated || !payload.csrf) {
      throw new Error(payload.error || "Your session has expired. Sign in again.");
    }
    csrfToken = payload.csrf;
    return csrfToken;
  }

  async function request(path, options = {}) {
    const method = options.method || "GET";
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    const requestOptions = { method, headers, credentials: "same-origin", cache: "no-store" };
    if (method !== "GET" && method !== "HEAD") {
      headers["X-CSRF-Token"] = await csrf();
      headers["Content-Type"] = "application/json";
      requestOptions.body = JSON.stringify(options.body || {});
    }
    const response = await fetch(path, requestOptions);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      if (payload.code === "csrf") csrfToken = "";
      const error = new Error(payload.error || "The request could not be completed. Please try again.");
      error.code = payload.code || "request_failed";
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function query(path, values = {}) {
    const params = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.set(key, value);
    });
    return request(`${path}${params.size ? `?${params}` : ""}`);
  }

  window.BusinessApi = {
    get(path, values) { return query(path, values); },
    post(path, body) { return request(path, { method: "POST", body }); },
    delete(path, body) { return request(path, { method: "DELETE", body }); },
    csrf,
  };
})();
