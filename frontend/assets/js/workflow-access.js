(function () {
  "use strict";

  const STORAGE_KEY = "sln.workflow.prototype-role.v1";
  const USERS = {
    father: {
      role: "father",
      name: "K. Sivaprasad",
      initials: "KS",
      label: "Father / reviewer",
      reportGroups: ["valuation", "estimation", "progress", "completion"],
    },
    employee: {
      role: "employee",
      name: "Lavakumar",
      initials: "LK",
      label: "Employee",
      reportGroups: ["valuation", "estimation", "progress", "completion"],
    },
  };

  function currentRole() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return USERS[saved] ? saved : "father";
  }

  function currentUser() {
    return USERS[currentRole()];
  }

  function setRole(role) {
    if (!USERS[role]) return;
    localStorage.setItem(STORAGE_KEY, role);
    window.location.reload();
  }

  function can(action, task) {
    const user = currentUser();
    const ownsTask = task && task.assignee === user.name;
    const reportAllowed = !task || user.reportGroups.includes(task.reportGroup);
    if (!reportAllowed) return false;

    const rules = {
      viewTask: true,
      createTask: true,
      addNote: !task || task.status !== "Cancelled",
      updatePayment: Boolean(task && !["Closed", "Cancelled"].includes(task.status)),
      closeTask: Boolean(task && task.status === "Completed"),
      reopenTask: user.role === "father" && Boolean(task && window.TaskStore?.canReopen(task)),
      downloadFinalReport: Boolean(task && task.status === "Closed" && task.finalDocx?.url),
      cancelTask: user.role === "father" && Boolean(task && !["Closed", "Cancelled"].includes(task.status)),
      openReport: Boolean(task && task.assignee && ["In Progress", "On Hold"].includes(task.status) && (user.role === "father" || ownsTask)),
      assignUnassigned: Boolean(task && task.status === "Unassigned"),
      transferTask: Boolean(task && ["In Progress", "On Hold"].includes(task.status)),
      changeWorkflow: Boolean(task && ["In Progress", "On Hold"].includes(task.status) && (user.role === "father" || ownsTask)),
      completeTask: Boolean(task && task.status === "In Progress" && task.reportGeneratedAt && (user.role === "father" || ownsTask)),
    };
    return Boolean(rules[action]);
  }

  function visible(task) {
    return currentUser().reportGroups.includes(task.reportGroup);
  }

  function installSwitcher() {
    const host = document.querySelector("[data-role-switcher]");
    if (!host) return;
    const activeRole = currentRole();
    host.innerHTML = `<span class="prototype-label">Prototype view</span><div class="role-switch" role="group" aria-label="Prototype user view"><button type="button" data-role="father">Father</button><button type="button" data-role="employee">Employee</button></div>`;
    host.querySelectorAll("button").forEach((button) => {
      const active = button.dataset.role === activeRole;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      button.addEventListener("click", () => setRole(button.dataset.role));
    });
    const user = currentUser();
    document.querySelectorAll("[data-current-user-name]").forEach((node) => { node.textContent = user.name; });
    document.querySelectorAll("[data-current-user-role]").forEach((node) => { node.textContent = user.label; });
    document.querySelectorAll("[data-current-user-initials]").forEach((node) => { node.textContent = user.initials; });
    document.body.dataset.role = user.role;
    document.querySelectorAll("[data-father-only]").forEach((node) => { node.hidden = user.role !== "father"; });
  }

  window.WorkflowAccess = { USERS, currentRole, currentUser, setRole, can, visible, installSwitcher };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installSwitcher);
  } else {
    installSwitcher();
  }
})();
