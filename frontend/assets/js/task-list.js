(function () {
  "use strict";

  const PAGE_SIZE = 10;
  const list = document.getElementById("task-list");
  const loadMore = document.getElementById("load-more");
  const search = document.getElementById("task-search");
  const group = document.getElementById("group-filter");
  const status = document.getElementById("status-filter");
  const assignee = document.getElementById("assignee-filter");
  let visible = PAGE_SIZE;

  TaskStore.STATUSES.forEach((item) => status.add(new Option(item, item)));
  const initial = new URLSearchParams(window.location.search);
  group.value = initial.get("group") || "all";
  status.value = initial.get("status") || "";
  assignee.value = initial.get("assignee") || "";
  search.value = initial.get("search") || "";

  function render() {
    const result = TaskStore.query({ group: group.value, status: status.value, assignee: assignee.value, search: search.value, limit: visible });
    list.innerHTML = result.items.length ? result.items.map(WorkflowUI.taskRow).join("") : WorkflowUI.empty("No assignments match the selected search and filters.");
    document.getElementById("result-count").textContent = `${result.total} ${result.total === 1 ? "task" : "tasks"}`;
    loadMore.hidden = !result.hasMore;
    const params = new URLSearchParams();
    if (group.value !== "all") params.set("group", group.value);
    if (status.value) params.set("status", status.value);
    if (assignee.value) params.set("assignee", assignee.value);
    if (search.value.trim()) params.set("search", search.value.trim());
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  }

  function reset() { visible = PAGE_SIZE; render(); }
  [group, status, assignee].forEach((field) => field.addEventListener("change", reset));
  search.addEventListener("input", reset);
  loadMore.addEventListener("click", () => { visible += PAGE_SIZE; render(); });
  window.addEventListener("sln:tasks-changed", render);
  render();
})();
