(function () {
  "use strict";

  let activeTaskId = "";

  function template() {
    return `<div class="workflow-modal" id="shared-payment-modal" hidden>
      <section class="workflow-dialog" role="dialog" aria-modal="true" aria-labelledby="shared-payment-title">
        <div class="dialog-heading"><div><h2 id="shared-payment-title">Payment update</h2><p id="shared-payment-task"></p></div><button type="button" class="modal-x" data-close-shared-payment aria-label="Close">×</button></div>
        <form id="shared-payment-form" class="stack-form">
          <div class="form-grid"><div class="field"><label for="shared-payment-estimated">Estimated fee</label><input id="shared-payment-estimated" inputmode="decimal" /></div><div class="field"><label for="shared-payment-agreed">Agreed fee</label><input id="shared-payment-agreed" inputmode="decimal" /></div><div class="field full"><label for="shared-payment-received">Amount received</label><input id="shared-payment-received" inputmode="decimal" /></div></div>
          <div class="payment-summary"><span>Outstanding</span><strong id="shared-payment-outstanding">₹0</strong><small id="shared-payment-state">Pending</small></div>
          <div class="field"><label for="shared-payment-note">Work note</label><textarea id="shared-payment-note" placeholder="Optional note appended to the task activity"></textarea></div>
          <p class="form-error" id="shared-payment-error" role="alert" hidden></p>
          <div class="dialog-actions"><button class="secondary" type="button" data-close-shared-payment>Cancel</button><button class="secondary" type="submit">Save update</button><button class="primary" id="shared-close-request" type="button" disabled>Close request</button></div>
        </form>
      </section>
    </div>`;
  }

  function modal() {
    let element = document.getElementById("shared-payment-modal");
    if (!element) {
      document.body.insertAdjacentHTML("beforeend", template());
      element = document.getElementById("shared-payment-modal");
      bindModal(element);
    }
    return element;
  }

  function values() {
    return {
      estimated: document.getElementById("shared-payment-estimated").value,
      agreed: document.getElementById("shared-payment-agreed").value,
      received: document.getElementById("shared-payment-received").value,
      note: document.getElementById("shared-payment-note").value,
    };
  }

  function refreshSummary() {
    const task = TaskStore.get(activeTaskId);
    const agreed = Math.max(0, Number(document.getElementById("shared-payment-agreed").value) || 0);
    const received = Math.max(0, Number(document.getElementById("shared-payment-received").value) || 0);
    const outstanding = Math.max(0, agreed - received);
    const state = received <= 0 ? "Pending" : received < agreed ? "Partially Received" : "Received";
    document.getElementById("shared-payment-outstanding").textContent = WorkflowUI.currency(outstanding);
    document.getElementById("shared-payment-state").textContent = state;
    document.getElementById("shared-close-request").disabled = !task || task.status !== "Completed" || state !== "Received" || outstanding !== 0;
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
    element.querySelectorAll("[data-close-shared-payment]").forEach((button) => button.addEventListener("click", close));
    element.addEventListener("click", (event) => { if (event.target === element) close(); });
    ["shared-payment-agreed", "shared-payment-received"].forEach((id) => document.getElementById(id).addEventListener("input", refreshSummary));
    document.getElementById("shared-payment-form").addEventListener("submit", (event) => {
      event.preventDefault();
      try {
        TaskStore.updatePayment(activeTaskId, values());
        close();
        notify();
      } catch (error) { showError(error); }
    });
    document.getElementById("shared-close-request").addEventListener("click", () => {
      try {
        TaskStore.updatePayment(activeTaskId, values());
        TaskStore.close(activeTaskId, "Payment settled and request closed.");
        close();
        notify();
      } catch (error) { showError(error); }
    });
  }

  function open(taskId) {
    const task = TaskStore.get(taskId);
    if (!task || !WorkflowAccess.can("updatePayment", task)) return;
    activeTaskId = task.id;
    const element = modal();
    document.getElementById("shared-payment-task").textContent = `${task.id} · ${task.reportName}`;
    document.getElementById("shared-payment-estimated").value = task.payment.estimated || "";
    document.getElementById("shared-payment-agreed").value = task.payment.agreed || "";
    document.getElementById("shared-payment-received").value = task.payment.received || "";
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
