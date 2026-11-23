/** Searchable employee selector shared by assignment and transfer workflows. */
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
    const allowed = options.allowed || employees();
    const choices = allowed.map(employee => ({ label: employee.name, value: display(employee) }));
    if (options.includeUnassigned) choices.unshift({ label: "Leave unassigned", value: "Unassigned" });
    ValuxUI.paintEmployeePicker(host, {
      listId, choices, label: options.label || "Assign to", required: Boolean(options.required),
    });
    const input = host.querySelector("input");
    const selected = employees().find(employee => employee.name === options.value || employee.id === options.value);
    input.value = display(selected);

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
      id() {
        if (options.includeUnassigned && ["", "unassigned", "leave unassigned"].includes(input.value.trim().toLowerCase())) return "";
        const selected = resolve(input.value);
        if (!selected || !allowed.some((employee) => employee.id === selected.id)) {
          throw new Error("Select a valid employee from the search results.");
        }
        return selected.id;
      },
      setValue(value) {
        const selected = employees().find((employee) => employee.name === value || employee.id === value);
        input.value = display(selected);
      },
    };
  }

  window.EmployeePicker = { employees, display, resolve, mount };
})();
