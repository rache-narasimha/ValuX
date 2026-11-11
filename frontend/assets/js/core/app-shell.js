/** Shared application chrome: header, sidebar, navigation counts, and responsive shell behavior. */
(function () {
  "use strict";

  const COLLAPSE_KEY = "sln.application.sidebar-collapsed.v1";
  let durableSummary = window.__VALUX_BUSINESS_CONTEXT__?.summary || null;
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  const brandWordmark = '<span class="sln-wordmark">Consultancy &amp; <span class="sln-wordmark-accent">Engineering Services</span></span>';
  function logo(placement) {
    // Clip the paper surrounding the original monogram while preserving its lettering and colours.
    const clip = `sln-monogram-${placement}`;
    return `<span class="brand-mark sln-brand-mark" aria-hidden="true">
      <svg viewBox="660 290 730 880" width="38" height="46">
        <defs><clipPath id="${clip}"><path d="M679 1149V564L847 473V400L1024 307L1201 400V575L1267 506L1228 480L1369 422L1346 572L1312 541L1263 614L1369 671V1149Z"/></clipPath></defs>
        <image href="/assets/images/sln-logo-source.png" width="2048" height="2048" clip-path="url(#${clip})" />
      </svg>
    </span>`;
  }
  const poweredBy = '<div class="powered-by"><span>Powered by</span><button type="button" class="valux-brand" title="Website coming soon" aria-label="ValuX — website coming soon"><span class="valux-wordmark">Valu<span>X</span></span><img class="valux-footer-logo" src="/assets/images/valux-monogram.png" alt="" /></button></div>';

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
    add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v5h14v-5"/></svg>',
    activity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 1 2.6 6.4M3 6v6h6m3-5v5l3 2"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 4v4m8-4v4M4 10h16"/></svg>',
    income: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>',
    received: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m-4-4 4 4 4-4M5 15v5h14v-5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3 2"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3"/></svg>',
    filter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16l-6 7v5l-4 2v-7z"/></svg>',
    land: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19h18M12 19v-7m0 1c-5 0-8-3-8-7 5 0 8 2 8 7Zm0-1c0-4 3-6 8-6 0 4-3 7-8 7"/></svg>',
    calculator: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 11h1m3 0h1m3 0h.1M8 15h1m3 0h1m3 0h.1M8 19h1m3 0h1m3 0h.1"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>',
  };
  icons.institutions = icons.institution;
  icons.payments = icons.payment;

  function tasks() {
    if (window.TaskStore) return TaskStore.all();
    return [window.__VALUX_BUSINESS_CONTEXT__?.task].filter(Boolean);
  }

  function count(status) {
    if (durableSummary) {
      const keys = {
        "Unassigned": "unassigned", "In Progress": "inProgress", "On Hold": "onHold",
        "Completed": "completed", "Closed": "closed", "Cancelled": "cancelled",
      };
      return Number(durableSummary[status ? keys[status] : "total"] || 0);
    }
    return tasks().filter((task) => (!window.WorkflowAccess || WorkflowAccess.visible(task)) && (!status || task.status === status)).length;
  }

  async function refreshSummary() {
    if (!window.BusinessApi || !window.__VALUX_AUTH_CONTEXT__?.user) {
      installSidebar();
      return;
    }
    try {
      const payload = await BusinessApi.get("/api/tasks/summary");
      durableSummary = payload.summary;
    } catch (_error) {
      // Keep the last server-provided summary; page-level errors handle failed mutations.
    }
    installSidebar();
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
    return `<div class="assignment-subnav"><a href="/tasks"><span>All tasks</span><strong>${count()}</strong></a>${statuses.map((status) => `<a href="/tasks?status=${encodeURIComponent(status)}"><span>${status}</span><strong>${count(status)}</strong></a>`).join("")}</div>`;
  }

  function headerShortcuts() {
    const path = location.pathname.replace(/\/$/, "") || "/";
    const dashboard = path === "/" ? "" : "/";
    const shortcut = (icon, label, title, target) => `<a class="header-section-link" href="${dashboard}#${target}" aria-label="${label}" title="${title}"><span class="app-inline-icon">${icons[icon]}</span><span class="header-section-label">${label}</span></a>`;
    let context = "";
    if (path === "/tasks") {
      context = `<a class="header-context-link header-dashboard-link" href="/">Dashboard</a><a class="header-context-link header-primary-link" href="/tasks/new"><span class="app-inline-icon">${icons.add}</span>New assignment</a>`;
    } else if (path === "/tasks/new") {
      context = '<a class="header-context-link" href="/tasks">Cancel and return</a>';
    } else if (path === "/practice" || path.startsWith("/settings/")) {
      context = '<a class="header-context-link" href="/">← Dashboard</a>';
    }
    const ceo = window.__VALUX_AUTH_CONTEXT__?.user?.role === "father";
    const payments = shortcut("payment", "Payments", ceo ? "Income &amp; Payments" : "Payment tracking", ceo ? "dashboard-finance" : "payment-dashboard-card");
    return `${context}${payments}${shortcut("activity", "Activity", "Recent activity", "recent-activity-card")}`;
  }

  function sidebarNavigation() {
    const assignmentActive = activeFor(location.pathname, location.search, "assignments");
    return `<nav class="application-navigation" aria-label="Application navigation">
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
    </nav>`;
  }

  function headerMarkup(report = null) {
    const identity = window.__VALUX_AUTH_CONTEXT__?.user || {};
    return `<button class="mobile-menu-button" type="button" aria-label="Open application navigation">${icons.menu}</button>
      <a class="brand" href="/" aria-label="SLN Consultancy &amp; Engineering Services dashboard">${logo("header")}${brandWordmark}</a>
      ${report ? `<div class="report-shell-title"><strong>${report.title}</strong><small>${report.description}</small></div>` : ""}
      <nav class="header-shortcuts" aria-label="Quick navigation">${headerShortcuts()}</nav>
      <div class="top-actions"><button class="appearance-toggle" type="button" data-appearance-toggle data-appearance-icon-only></button>
      <div class="notification-menu"><button class="notification-bell" type="button" aria-label="Notifications" aria-expanded="false" aria-controls="notification-panel">${icons.bell}<span class="notification-count" hidden></span></button>
        <section class="notification-panel" id="notification-panel" aria-label="Notifications" hidden><div class="notification-heading"><h2>Notifications</h2><button type="button" data-notifications-read-all>Mark all as read</button></div><div class="notification-list"></div><button type="button" class="notification-more" hidden>Load more</button><p class="notification-feedback" role="status"></p></section></div>
      ${report ? `<span id="status" class="report-status" aria-live="polite">${escape(report.status)}</span>` : ""}<details class="account-menu"><summary class="user-chip"><span class="avatar" data-current-user-initials>${avatar(identity)}</span><span><strong data-current-user-name>${escape(identity.name || "ValuX user")}</strong><small data-current-user-role>${escape(identity.roleLabel || "Authenticated user")}</small></span></summary><div class="account-menu-panel"><span>${escape(identity.userId)}</span>${identity.email ? `<small>${escape(identity.email)}</small>` : ""}<a class="account-link" href="/account">My Account</a><button type="button" data-sign-out>Sign out</button></div></details></div>`;
  }

  function avatar(identity) {
    return identity.photoUrl ? `<img src="${escape(identity.photoUrl)}" alt="Your profile photo" />` : escape(identity.initials || "VX");
  }

  function updateUser(user) {
    window.__VALUX_AUTH_CONTEXT__.user = user;
    document.querySelectorAll("[data-current-user-initials]").forEach((element) => { element.innerHTML = avatar(user); });
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
    const navigation = sidebar?.querySelector(".application-navigation");
    if (navigation) {
      navigation.outerHTML = sidebarNavigation();
      window.WorkflowAccess?.installIdentity();
      return;
    }
    if (!sidebar) {
      sidebar = document.createElement("aside");
      sidebar.className = "app-sidebar";
      shell.prepend(sidebar);
    }
    sidebar.innerHTML = `<div class="sidebar-brand-mobile">${logo("sidebar")}${brandWordmark}</div>
      ${sidebarNavigation()}<button class="sidebar-collapse" id="sidebar-toggle" type="button" aria-label="Collapse application navigation" title="Collapse menu" aria-expanded="true"><span>${icons.chevron}</span></button>${poweredBy}`;
    const toggle = sidebar.querySelector("#sidebar-toggle");
    const mobileButton = document.querySelector(".mobile-menu-button");
    const scope = location.pathname.replace(/\/$/, "") === "/tasks/detail"
      ? new URLSearchParams(location.search).get("id")
      : null;
    window.ReportCalculator?.install(sidebar, {
      before: toggle,
      scope: scope || "workspace",
      onOpen: closeMobile,
      focusAfterClose: () => mobileButton?.getClientRects().length ? mobileButton : null,
    });
    const dashboard = location.pathname === "/" && shell.querySelector(":scope > main");
    if (dashboard && !dashboard.querySelector(".dashboard-powered-by")) {
      dashboard.insertAdjacentHTML("beforeend", poweredBy.replace('class="powered-by"', 'class="powered-by dashboard-powered-by"'));
    }

    const collapsed = localStorage.getItem(COLLAPSE_KEY) === "true";
    shell.classList.toggle("sidebar-collapsed", collapsed);
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

    mobileButton?.addEventListener("click", () => document.body.classList.toggle("sidebar-mobile-open"));
    sidebar.addEventListener("click", (event) => { if (event.target.closest("a")) closeMobile(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMobile(); });
  }

  function closeMobile() {
    document.body.classList.remove("sidebar-mobile-open");
  }

  function install() {
    installHeader();
    installSidebar();
    installAccountMenu();
    document.querySelectorAll("[data-app-icon]").forEach((placeholder) => {
      placeholder.innerHTML = icons[placeholder.dataset.appIcon] || "";
    });
    const reportSidebar = document.querySelector("body:not(.workflow-page) main > aside");
    if (reportSidebar && !reportSidebar.querySelector(".powered-by")) reportSidebar.insertAdjacentHTML("beforeend", poweredBy);
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

  window.AppShell = { install, icons, updateUser };
  window.addEventListener("sln:tasks-changed", refreshSummary);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
})();
