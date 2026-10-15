(function () {
  "use strict";

  function employees() {
    return (window.TaskStore?.EMPLOYEES || []).map((employee) =>
      typeof employee === "string" ? { id: employee, name: employee } : employee,
    );
  }

  function display(employee) {
    return employee ? `${employee.id} — ${employee.name}` : "";
  }

  function resolve(value) {
    const query = String(value || "").trim().toLowerCase();
    return employees().find((employee) =>
      [employee.id, employee.name, display(employee)].some((item) => item.toLowerCase() === query),
    ) || null;
  }

  function mount(host, options = {}) {
    const listId = `${host.id || "employee"}-options`;
    host.classList.add("employee-reference");
    host.innerHTML = `<span class="employee-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="m15.5 15.5 5 5"></path></svg></span>
      <input type="search" list="${listId}" autocomplete="off" placeholder="Search employee ID or name" aria-label="${options.label || "Assign to"}">
      <datalist id="${listId}"></datalist>
      <small class="employee-reference-help">Search by employee ID or name</small>`;
    const input = host.querySelector("input");
    const list = host.querySelector("datalist");
    const allowed = options.allowed || employees();
    if (options.includeUnassigned) list.append(new Option("Leave unassigned", "Unassigned"));
    allowed.forEach((employee) => list.append(new Option(employee.name, display(employee))));
    if (options.value) {
      const selected = employees().find((employee) => employee.name === options.value || employee.id === options.value);
      input.value = display(selected);
    }
    input.required = Boolean(options.required);

    return {
      input,
      value() {
        if (options.includeUnassigned && ["", "unassigned", "leave unassigned"].includes(input.value.trim().toLowerCase())) return "";
        const selected = resolve(input.value);
        if (!selected || !allowed.some((employee) => employee.id === selected.id)) {
          throw new Error("Select a valid employee from the search results.");
        }
        return selected.name;
      },
      setValue(value) {
        const selected = employees().find((employee) => employee.name === value || employee.id === value);
        input.value = display(selected);
      },
    };
  }

  window.EmployeePicker = { employees, display, resolve, mount };
})();
