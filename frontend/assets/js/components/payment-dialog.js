/** Reusable completed-task payment editor and close-request dialog. */
(function () {
  "use strict";

  let activeTaskId = "";

  function modal() {
    let element = document.getElementById("shared-payment-modal");
    if (!element) {
      const host = document.createElement("div");
      document.body.append(host);
      ValuxUI.paintPaymentDialog(host);
      element = document.getElementById("shared-payment-modal");
      bindModal(element);
    }
    return element;
  }

  function values() {
    return {
      estimated: NumericEntry.read(document.getElementById("shared-payment-estimated")),
      agreed: NumericEntry.read(document.getElementById("shared-payment-agreed")),
      received: NumericEntry.read(document.getElementById("shared-payment-received")),
      dueDate: document.getElementById("shared-payment-due").value,
      note: document.getElementById("shared-payment-note").value,
    };
  }

  function refreshSummary() {
    const task = TaskStore.get(activeTaskId);
    if (!task) return;
    const preview = { ...task, payment: { ...task.payment, ...values() } };
    const summary = TaskStore.paymentSummary(preview);
    document.getElementById("shared-payment-outstanding").textContent = summary.outstanding === null ? "N/A" : WorkflowUI.currency(summary.outstanding);
    document.getElementById("shared-payment-state").textContent = summary.status;
    const close = document.getElementById("shared-close-request");
    close.disabled = task.status !== "Completed" || summary.status !== "Received" || summary.outstanding !== 0;
    const reason = task.status !== "Completed"
      ? "Complete the report task to enable closing."
      : summary.outstanding === null
        ? "Enter the agreed or estimated fee before closing."
        : summary.outstanding !== 0
          ? "Settle the outstanding payment before closing."
          : "Payment is settled; the request can be closed.";
    document.getElementById("shared-close-reason").textContent = reason;
    close.parentElement.title = reason;
    const warning = document.getElementById("shared-payment-warning");
    warning.hidden = !summary.outsideStandard;
    warning.textContent = summary.outsideStandard ? "This due date is beyond the standard seven-day period after completion." : "";
  }

  function close() {
    modal().hidden = true;
    document.body.classList.remove("modal-open");
    activeTaskId = "";
  }

  function notify() {
    window.dispatchEvent(new CustomEvent("sln:payment-updated"));
  }

  function showError(error) {
    const output = document.getElementById("shared-payment-error");
    output.textContent = error.message || String(error);
    output.hidden = false;
  }

  function bindModal(element) {
    const form = element.querySelector("#shared-payment-form");
    element.querySelectorAll("[data-close-shared-payment]").forEach((button) => button.addEventListener("click", close));
    element.addEventListener("click", (event) => { if (event.target === element) close(); });
    ["shared-payment-estimated", "shared-payment-agreed", "shared-payment-received", "shared-payment-due"].forEach((id) => document.getElementById(id).addEventListener("input", refreshSummary));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        if (!form.reportValidity()) return;
        await TaskStore.updatePayment(activeTaskId, values());
        close();
        notify();
      } catch (error) { showError(error); }
    });
    document.getElementById("shared-close-request").addEventListener("click", async () => {
      try {
        if (!form.reportValidity()) return;
        await TaskStore.updatePayment(activeTaskId, values());
        await TaskStore.close(activeTaskId, "Payment settled and request closed.");
        window.location.replace("/");
      } catch (error) { showError(error); }
    });
  }

  function open(taskId) {
    const task = TaskStore.get(taskId);
    if (!task || !WorkflowAccess.can("updatePayment", task)) return;
    activeTaskId = task.id;
    const element = modal();
    document.getElementById("shared-payment-task").textContent = `${task.id} · ${task.reportName}`;
    for (const key of ["estimated", "agreed", "received"]) {
      const input = document.getElementById(`shared-payment-${key}`);
      NumericEntry.reset(input);
      input.value = task.payment[key] || "";
    }
    document.getElementById("shared-payment-due").value = task.payment.dueDate || "";
    document.getElementById("shared-payment-note").value = "";
    document.getElementById("shared-payment-error").hidden = true;
    refreshSummary();
    element.hidden = false;
    document.body.classList.add("modal-open");
  }

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-payment-task]");
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    open(trigger.dataset.paymentTask);
  });

  window.PaymentDialog = { open, close };
})();
