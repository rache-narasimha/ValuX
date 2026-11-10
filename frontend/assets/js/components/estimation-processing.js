/** Processing status and cancellation for report requests. */
(function () {
  "use strict";
  let busy = false;
  function cancellation(overlay, label = "Cancel preview") {
    const controller = new AbortController();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = label;
    button.addEventListener("click", () => {
      button.disabled = true;
      controller.abort();
    }, { once: true });
    overlay.querySelector(".processing-card").append(button);
    return { signal: controller.signal, dispose: () => button.remove() };
  }
  async function run(title, stage, operation, cancelLabel = "") {
    if (busy) return;
    const overlay = document.getElementById("estimation-processing");
    const main = document.querySelector("body > main");
    const review = document.getElementById("review-modal");
    const focused = document.activeElement;
    const wasInert = main.inert;
    const reviewWasInert = review.inert;
    busy = true;
    main.inert = review.inert = true;
    main.setAttribute("aria-busy", "true");
    overlay.querySelector("strong").textContent = title;
    overlay.querySelector("[data-processing-stage]").textContent = stage;
    overlay.hidden = false;
    overlay.focus();
    const cancel = cancelLabel ? cancellation(overlay, cancelLabel) : null;
    try {
      return await operation((text) => { overlay.querySelector("[data-processing-stage]").textContent = text; }, cancel?.signal);
    } finally {
      cancel?.dispose();
      busy = false;
      overlay.hidden = true;
      main.inert = wasInert;
      review.inert = reviewWasInert;
      main.removeAttribute("aria-busy");
      if (focused?.isConnected && !focused.disabled) focused.focus({preventScroll: true});
    }
  }
  window.ReportProcessing = { cancellation };
  window.EstimationProcessing = {run, isBusy: () => busy};
})();
