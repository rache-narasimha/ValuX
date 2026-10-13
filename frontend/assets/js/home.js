(function () {
  "use strict";

  const descriptions = {
    all: "Review assignments, continue reports and follow up on pending work.",
    valuation: "General and agricultural property valuation assignments.",
    estimation: "Detailed building estimate assignments.",
    progress: "Construction progress assessment assignments.",
    completion: "Completion certificate assignments.",
  };
  let selectedGroup = "all";

  function setCount(id, value) {
    document.getElementById(id).textContent = value;
  }

  function render() {
    const allTasks = TaskStore.all();
    const summary = TaskStore.summary(selectedGroup);
    const groupTasks = allTasks.filter((task) => selectedGroup === "all" || task.reportGroup === selectedGroup);
    const completed = groupTasks
      .filter((task) => ["Completed", "Closed"].includes(task.status))
      .sort((a, b) => new Date(b.completedAt || b.updatedAt) - new Date(a.completedAt || a.updatedAt))
      .slice(0, 5);
    const recent = groupTasks
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);

    document.getElementById("dashboard-title").textContent = selectedGroup === "all" ? "All work" : `${selectedGroup[0].toUpperCase()}${selectedGroup.slice(1)} work`;
    document.getElementById("dashboard-description").textContent = descriptions[selectedGroup];
    setCount("metric-assigned", summary.assigned);
    setCount("metric-progress", summary.inProgress);
    setCount("metric-hold", summary.onHold);
    setCount("metric-review", summary.awaitingReview);
    setCount("count-all", allTasks.length);
    ["valuation", "estimation", "progress", "completion"].forEach((group) => {
      setCount(`count-${group}`, allTasks.filter((task) => task.reportGroup === group).length);
    });

    document.getElementById("recent-assigned").innerHTML = recent.length
      ? recent.map(WorkflowUI.taskRow).join("")
      : WorkflowUI.empty("Create the first assignment to begin the workflow.");
    document.getElementById("recent-completed").innerHTML = completed.length
      ? completed.map(WorkflowUI.taskRow).join("")
      : WorkflowUI.empty("Completed and closed tasks will appear here.");

    const groupQuery = selectedGroup === "all" ? "" : `?group=${selectedGroup}`;
    document.getElementById("view-all-assigned").href = `/tasks${groupQuery}`;
    document.getElementById("view-all-completed").href = `/tasks?${selectedGroup === "all" ? "" : `group=${selectedGroup}&`}status=Completed`;
  }

  document.querySelectorAll("#report-navigation button").forEach((button) => {
    button.addEventListener("click", () => {
      selectedGroup = button.dataset.group;
      document.querySelectorAll("#report-navigation button").forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });

  document.querySelectorAll(".metric-card").forEach((card) => {
    card.addEventListener("click", () => {
      const params = new URLSearchParams({ status: card.dataset.status });
      if (selectedGroup !== "all") params.set("group", selectedGroup);
      window.location.href = `/tasks?${params}`;
    });
  });

  window.addEventListener("sln:tasks-changed", render);
  render();
})();
