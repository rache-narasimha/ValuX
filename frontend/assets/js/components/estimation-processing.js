/** One visible processing state for estimation requests; no simulated percentages. */
(function () {
  "use strict";
  let busy = false;
  async function run(title, stage, operation) {
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
    try {
      return await operation((text) => { overlay.querySelector("[data-processing-stage]").textContent = text; });
    } finally {
      busy = false;
      overlay.hidden = true;
      main.inert = wasInert;
      review.inert = reviewWasInert;
      main.removeAttribute("aria-busy");
      if (focused?.isConnected && !focused.disabled) focused.focus({preventScroll: true});
    }
  }
  window.EstimationProcessing = {run, isBusy: () => busy};
})();
