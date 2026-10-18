/** Shared application chrome: header, sidebar, navigation counts, and responsive shell behavior. */
(function () {
  "use strict";

  const COLLAPSE_KEY = "sln.application.sidebar-collapsed.v1";
  const TASK_KEY = "sln.workflow.tasks.v1";

  const icons = {
    dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10M9 20v-6h6v6"/></svg>',
    assignments: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h6"/></svg>',
    practice: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10v18H7zM10 7h4M10 11h5M10 15h3"/></svg>',
    institution: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-5 9 5M5 10h14M6 10v8m4-8v8m4-8v8m4-8v8M3 20h18"/></svg>',
    payment: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/></svg>',
    reports: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10m5 10V5m5 15v-7m5 7V8"/></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  };
  icons.institutions = icons.institution;
  icons.payments = icons.payment;

  function tasks() {
    if (window.TaskStore) return TaskStore.all();
    try {
      const value = JSON.parse(localStorage.getItem(TASK_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_error) {
      return [];
    }
  }

  function count(status) {
    return tasks().filter((task) => !status || task.status === status).length;
  }

  function activeFor(path, search, target) {
    if (target === "dashboard") return path === "/";
    if (target === "practice") return path === "/practice" || search.includes("practice=1");
    if (target === "institutions") return path === "/tasks" && search.includes("view=institutions");
    if (target === "payments") return path === "/tasks" && search.includes("status=Completed");
    if (target === "reports") return path === "/tasks" && search.includes("status=Closed");
    if (target === "settings") return path === "/settings/institutions";
    if (target === "assignments") return path.startsWith("/tasks") && !activeFor(path, search, "institutions") && !activeFor(path, search, "payments") && !activeFor(path, search, "reports");
    return false;
  }

  function navLink({ key, label, href, badge = "", fatherOnly = false }) {
    const active = activeFor(location.pathname, location.search, key);
    return `<a class="app-nav-link${active ? " active" : ""}" href="${href}" data-nav-key="${key}"${fatherOnly ? " data-father-only" : ""} title="${label}"><span class="app-nav-icon">${icons[key]}</span><span class="app-nav-label">${label}</span>${badge !== "" ? `<strong class="app-nav-count">${badge}</strong>` : ""}</a>`;
  }

  function assignmentSubmenu() {
    const statuses = ["Unassigned", "In Progress", "On Hold", "Completed", "Closed", "Cancelled"];
    return `<div class="assignment-subnav">${statuses.map((status) => `<a href="/tasks?status=${encodeURIComponent(status)}"><span>${status}</span><strong>${count(status)}</strong></a>`).join("")}</div>`;
  }

  function sidebarMarkup() {
    const assignmentActive = activeFor(location.pathname, location.search, "assignments");
    return `<div class="sidebar-brand-mobile"><span class="brand-mark">SLN</span><strong>Property Reports</strong></div>
      <nav class="application-navigation" aria-label="Application navigation">
        ${navLink({ key: "dashboard", label: "Dashboard", href: "/" })}
        <details class="assignment-navigation"${assignmentActive ? " open" : ""}>
          <summary class="app-nav-link${assignmentActive ? " active" : ""}"><span class="app-nav-icon">${icons.assignments}</span><span class="app-nav-label">Assignments</span><span class="nav-chevron">${icons.chevron}</span></summary>
          ${assignmentSubmenu()}
        </details>
        ${navLink({ key: "practice", label: "Practice forms", href: "/practice" })}
        ${navLink({ key: "institutions", label: "Institutions", href: "/tasks?view=institutions" })}
        ${navLink({ key: "payments", label: "Payments", href: "/tasks?status=Completed", badge: count("Completed") })}
        ${navLink({ key: "reports", label: "Reports", href: "/tasks?status=Closed" })}
        ${navLink({ key: "settings", label: "Settings", href: "/settings/institutions", fatherOnly: true })}
      </nav>
      <button class="sidebar-collapse" id="sidebar-toggle" type="button" aria-label="Collapse application navigation" title="Collapse menu" aria-expanded="true"><span>${icons.chevron}</span></button>`;
  }

  function headerMarkup(report = null) {
    const allTasksActive = location.pathname.startsWith("/tasks");
    const identity = window.__VALSPHERE_AUTH_CONTEXT__?.user || {};
    return `<button class="mobile-menu-button" type="button" aria-label="Open application navigation">${icons.menu}</button>
      <a class="brand" href="/" aria-label="SLN work dashboard"><span class="brand-mark">SLN</span><span><strong>Property Reports</strong><small>Work management</small></span></a>
      ${report ? `<div class="report-shell-title"><strong>${report.title}</strong><small>${report.description}</small></div>` : ""}
      <nav class="header-shortcuts" aria-label="Quick navigation"><a${allTasksActive ? ' class="active"' : ""} href="/tasks">All tasks</a></nav>
      <div class="top-actions"><button class="appearance-toggle" type="button" data-appearance-toggle></button>${report ? `<span id="status" class="report-status" aria-live="polite">${report.status}</span>` : ""}<details class="account-menu"><summary class="user-chip"><span class="avatar" data-current-user-initials>${identity.initials || "VS"}</span><span><strong data-current-user-name>${identity.name || "ValSphere user"}</strong><small data-current-user-role>${identity.roleLabel || "Authenticated user"}</small></span></summary><div class="account-menu-panel"><span>${identity.userId || ""}</span>${identity.email ? `<small>${identity.email}</small>` : ""}<button type="button" data-sign-out>Sign out</button></div></details></div>`;
  }

  function installHeader() {
    const header = document.querySelector("header");
    if (!header) return;
    const report = document.body.classList.contains("workflow-page") ? null : {
      title: header.querySelector("h1")?.textContent?.trim() || document.title,
      description: header.querySelector("p")?.textContent?.trim() || "Report workspace",
      status: header.querySelector("#status")?.textContent?.trim() || "Draft",
    };
    header.classList.add("app-header", "shared-app-header");
    header.innerHTML = headerMarkup(report);
  }

  function installSidebar() {
    if (!document.body.classList.contains("workflow-page")) return;
    let shell = document.querySelector(".app-shell");
    const main = document.querySelector("body > main");
    if (!shell && main) {
      shell = document.createElement("div");
      shell.className = "app-shell";
      main.before(shell);
      shell.append(main);
    }
    if (!shell) return;
    let sidebar = shell.querySelector(":scope > .app-sidebar");
    if (!sidebar) {
      sidebar = document.createElement("aside");
      sidebar.className = "app-sidebar";
      shell.prepend(sidebar);
    }
    sidebar.innerHTML = sidebarMarkup();

    const collapsed = localStorage.getItem(COLLAPSE_KEY) === "true";
    shell.classList.toggle("sidebar-collapsed", collapsed);
    const toggle = document.getElementById("sidebar-toggle");
    const describeToggle = (isCollapsed) => {
      toggle.setAttribute("aria-label", isCollapsed ? "Expand application navigation" : "Collapse application navigation");
      toggle.title = isCollapsed ? "Expand menu" : "Collapse menu";
    };
    toggle.setAttribute("aria-expanded", String(!collapsed));
    describeToggle(collapsed);
    toggle.addEventListener("click", () => {
      const next = shell.classList.toggle("sidebar-collapsed");
      localStorage.setItem(COLLAPSE_KEY, String(next));
      toggle.setAttribute("aria-expanded", String(!next));
      describeToggle(next);
    });

    const mobileButton = document.querySelector(".mobile-menu-button");
    const closeMobile = () => document.body.classList.remove("sidebar-mobile-open");
    mobileButton?.addEventListener("click", () => document.body.classList.toggle("sidebar-mobile-open"));
    sidebar.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMobile));
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMobile(); });
  }

  function install() {
    installHeader();
    installSidebar();
    installAccountMenu();
    window.Appearance?.install();
  }

  async function signOut(button) {
    button.disabled = true;
    try {
      const context = await fetch("/api/auth/context", { credentials: "same-origin" }).then((response) => response.json());
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": context.csrf },
        body: "{}",
      });
    } finally {
      window.location.assign("/auth");
    }
  }

  function installAccountMenu() {
    document.querySelectorAll("[data-sign-out]").forEach((button) => {
      button.addEventListener("click", () => signOut(button));
    });
  }

  window.AppShell = { install, icons };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
