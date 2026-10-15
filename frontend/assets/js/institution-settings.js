(function () {
  "use strict";

  const list = document.getElementById("institution-settings-list");
  const form = document.getElementById("institution-settings-form");
  const error = document.getElementById("institution-settings-error");
  let editingCode = "";

  if (WorkflowAccess.currentRole() !== "father") {
    document.getElementById("institution-settings-content").hidden = true;
    document.getElementById("institution-settings-denied").hidden = false;
    return;
  }

  function render() {
    const groups = InstitutionStore.grouped(true);
    list.innerHTML = ["Bank", "NBFC"].map((type) => `<section class="settings-group"><h2>${type === "Bank" ? "Banks" : "NBFCs"}</h2><div class="settings-list">${groups[type].map((item) => `<article class="institution-setting-row${item.active ? "" : " is-inactive"}">
      <span class="institution-swatch" style="--institution-color:${item.color}"></span>
      <div><strong>${WorkflowUI.escape(item.code)} · ${WorkflowUI.escape(item.name)}</strong><small>${item.active ? "Available in forms and dashboards" : "Inactive — retained for historical tasks"}</small></div>
      <button type="button" class="quiet-button" data-edit-institution="${WorkflowUI.escape(item.code)}">Edit</button>
      <button type="button" class="quiet-button" data-toggle-institution="${WorkflowUI.escape(item.code)}">${item.active ? "Deactivate" : "Reactivate"}</button>
    </article>`).join("")}</div></section>`).join("");
  }

  function clearForm() {
    editingCode = "";
    form.reset();
    document.getElementById("institution-active").checked = true;
    document.getElementById("institution-color").value = "#087ea4";
    document.getElementById("institution-form-title").textContent = "Add institution";
    error.hidden = true;
  }

  list.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-institution]");
    const toggle = event.target.closest("[data-toggle-institution]");
    if (edit) {
      const item = InstitutionStore.all().find((candidate) => candidate.code === edit.dataset.editInstitution);
      editingCode = item.code;
      document.getElementById("institution-kind").value = item.type;
      document.getElementById("institution-code").value = item.code;
      document.getElementById("institution-name").value = item.name;
      document.getElementById("institution-color").value = item.color;
      document.getElementById("institution-active").checked = item.active;
      document.getElementById("institution-form-title").textContent = `Edit ${item.code}`;
      form.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (toggle) {
      const item = InstitutionStore.all().find((candidate) => candidate.code === toggle.dataset.toggleInstitution);
      InstitutionStore.setActive(item.code, !item.active);
      render();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      InstitutionStore.upsert({
        type: document.getElementById("institution-kind").value,
        code: document.getElementById("institution-code").value,
        name: document.getElementById("institution-name").value,
        color: document.getElementById("institution-color").value,
        active: document.getElementById("institution-active").checked,
      }, editingCode);
      clearForm();
      render();
    } catch (exception) {
      error.textContent = exception.message;
      error.hidden = false;
    }
  });
  document.getElementById("cancel-institution-edit").addEventListener("click", clearForm);
  document.getElementById("reset-institutions").addEventListener("click", () => {
    if (!confirm("Restore the original working institution list and colours?")) return;
    InstitutionStore.reset();
    clearForm();
    render();
  });

  clearForm();
  render();
})();
