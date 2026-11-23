/** Shared notifications and human-activity session refresh. Polling never extends idle time. */
(function () {
  "use strict";
  function install() {
    const bell = document.querySelector(".notification-bell");
    if (!bell || !window.BusinessApi) return;
    const panel = document.getElementById("notification-panel");
    const list = panel.querySelector(".notification-list");
    const more = panel.querySelector(".notification-more");
    const badge = bell.querySelector(".notification-count");
    const feedback = panel.querySelector(".notification-feedback");
    const readAll = panel.querySelector("[data-notifications-read-all]");
    let items = [], loading = null, unread = 0;
    const shownUnread = new Set();
    function renderBadge() {
      badge.hidden = !unread;
      badge.textContent = unread > 99 ? "99+" : String(unread);
      bell.setAttribute("aria-label", unread ? `Notifications, ${unread} unread` : "Notifications");
      readAll.disabled = !unread;
    }
    function rememberShownNotifications() {
      for (const item of items) {
        if (!item.read) shownUnread.add(item.id);
      }
    }
    function render() {
      if (!panel.hidden) rememberShownNotifications();
      renderBadge();
      ValuxUI.paintNotifications(list, items, window.ValuxTime?.timeZone || "Asia/Kolkata");
    }
    function load(append = false, badgeOnly = false) {
      if (loading) return loading;
      loading = (async () => {
        try {
          const payload = await BusinessApi.get("/api/notifications", { offset: append ? items.length : 0 });
          unread = payload.unread;
          feedback.textContent = "";
          if (badgeOnly) renderBadge();
          else {
            items = append ? [...items, ...payload.items.filter((item) => !items.some((existing) => existing.id === item.id))] : payload.items;
            more.hidden = !payload.hasMore;
            render();
          }
        } catch (error) {
          if (error.status === 401) { window.location.assign("/auth"); return; }
          feedback.textContent = "Notifications are temporarily unavailable. Open this panel to retry.";
        }
      })().finally(() => { loading = null; });
      return loading;
    }
    async function mark(id, all = false) {
      const marked = all ? [...shownUnread] : [id];
      await BusinessApi.post("/api/notifications/read", all ? { all: true } : { id });
      await loading;
      marked.forEach((id) => shownUnread.delete(id));
      await load();
    }
    async function close() {
      if (panel.hidden) return;
      panel.hidden = true;
      bell.setAttribute("aria-expanded", "false");
      const ids = [...shownUnread];
      shownUnread.clear();
      if (!ids.length) return;
      try {
        for (let offset = 0; offset < ids.length; offset += 100) {
          await BusinessApi.post("/api/notifications/read", { ids: ids.slice(offset, offset + 100) });
        }
        await loading;
        const marked = new Set(ids);
        items = items.map((item) => marked.has(item.id) ? { ...item, read: true } : item);
        ids.forEach((id) => shownUnread.delete(id));
        render();
        await load(false, panel.hidden);
      } catch (error) {
        if (error.status === 401) { window.location.assign("/auth"); return; }
        feedback.textContent = "Read status could not be saved. Open and close the panel to retry.";
      }
    }
    bell.addEventListener("click", () => {
      if (!panel.hidden) { close(); return; }
      panel.hidden = false;
      bell.setAttribute("aria-expanded", "true");
      document.querySelector(".account-menu")?.removeAttribute("open");
      rememberShownNotifications();
      // An in-flight badge poll will not populate the panel.
      if (loading) loading.then(() => { if (!panel.hidden) load(); });
      else load();
    });
    document.addEventListener("click", (event) => { if (!event.target.closest(".notification-menu")) close(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !panel.hidden) { close(); bell.focus(); } });
    panel.addEventListener("click", async (event) => {
      const read = event.target.closest("[data-read-id]");
      const link = event.target.closest("[data-notification-id]");
      try {
        if (read) { read.disabled = true; await mark(read.dataset.readId); }
        if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
          event.preventDefault();
          try { await mark(link.dataset.notificationId); }
          finally { window.location.assign(link.href); }
        }
      } catch (error) { feedback.textContent = error.message; if (read) read.disabled = false; }
    });
    readAll.addEventListener("click", async () => { readAll.disabled = true; try { await mark(null, true); } catch (error) { feedback.textContent = error.message; readAll.disabled = false; } });
    more.addEventListener("click", () => load(true));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
    setInterval(() => { if (!document.hidden) load(false, !panel.hidden); }, 30000);
    load();

    let lastActivity = Date.now();
    async function active(event) {
      if (!event.isTrusted || document.hidden || Date.now() - lastActivity < 60000) return;
      lastActivity = Date.now();
      try { await BusinessApi.post("/api/auth/activity", {}); }
      catch (error) { if (error.status === 401) window.location.assign("/auth"); }
    }
    ["pointerdown", "keydown", "input", "scroll"].forEach((name) => document.addEventListener(name, active, { passive: true, capture: true }));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
