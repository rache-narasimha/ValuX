/** Authenticated identity adapter and centralized father/employee permission policy. */
(function () {
  "use strict";

  const authenticated = window.__VALUX_AUTH_CONTEXT__?.user;
  const user = authenticated ? {
    role: authenticated.role,
    name: authenticated.name,
    userId: authenticated.userId,
    initials: authenticated.initials,
    label: authenticated.roleLabel,
    email: authenticated.email,
    reportGroups: ["valuation", "revaluation", "estimation", "progress", "completion"],
  } : null;

  function currentRole() {
    return currentUser().role;
  }

  function currentUser() {
    if (!user) throw new Error("Your ValuX session is not available.");
    return user;
  }

  function can(action, task) {
    const user = currentUser();
    const ownsTask = task && task.assignee === user.name;
    const reportAllowed = !task || user.reportGroups.includes(task.reportGroup);
    if (!reportAllowed) return false;

    const rules = {
      viewTask: true,
      viewFinance: true,
      createTask: true,
      addNote: !task || task.status !== "Cancelled",
      updatePayment: Boolean(task && !["Closed", "Cancelled"].includes(task.status)),
      closeTask: Boolean(task && task.status === "Completed"),
      reopenTask: user.role === "father" && Boolean(task && window.TaskStore?.canReopen(task)),
      downloadFinalReport: Boolean(task && task.status === "Closed" && window.TaskStore?.finalArtifact(task)?.url),
      cancelTask: user.role === "father" && Boolean(task && !["Closed", "Cancelled"].includes(task.status)),
      openReport: Boolean(task && (["Completed", "Closed"].includes(task.status) || task.assignee && ["In Progress", "On Hold"].includes(task.status) && (user.role === "father" || ownsTask))),
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

  function installIdentity() {
    if (!user) return;
    document.querySelectorAll("[data-current-user-name]").forEach((node) => { node.textContent = user.name; });
    document.querySelectorAll("[data-current-user-role]").forEach((node) => { node.textContent = user.label; });
    document.querySelectorAll("[data-current-user-initials]").forEach((node) => { node.textContent = user.initials; });
    if (window.__VALUX_AUTH_CONTEXT__?.user) window.AppShell?.updateUser?.(window.__VALUX_AUTH_CONTEXT__.user);
    document.body.dataset.role = user.role;
    document.querySelectorAll("[data-father-only]").forEach((node) => { node.hidden = user.role !== "father"; });
  }

  window.WorkflowAccess = { currentRole, currentUser, can, visible, installIdentity, installSwitcher: installIdentity };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installIdentity);
  } else {
    installIdentity();
  }
})();
