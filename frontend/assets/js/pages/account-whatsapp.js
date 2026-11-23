/** Contact verification and consent for the signed-in user's own WhatsApp number. */
(function () {
  "use strict";
  const get = id => document.getElementById(id);
  const panel = get("whatsapp-settings");
  const numberForm = get("whatsapp-number-form");
  const verifyForm = get("whatsapp-verify-form");
  const change = get("whatsapp-change");
  const stop = get("whatsapp-stop");
  const message = get("whatsapp-message");
  const endpoint = "/api/auth/whatsapp";
  let busy = false;

  function describe(state) {
    panel.hidden = !state.enabled;
    if (!state.enabled) return;
    const verified = state.verified
      ? `Verified number ending ${state.ending}. Alerts are ${state.alerts ? "on" : "off"}.`
      : "No WhatsApp number verified.";
    get("whatsapp-status").textContent = state.pendingEnding
      ? `${verified} Enter the code sent to the number ending ${state.pendingEnding}.` : verified;
    change.textContent = state.pendingEnding ? "Request another code" : state.verified ? "Change number or alerts" : "Verify number";
    stop.hidden = !state.alerts && !state.pendingEnding;
    verifyForm.hidden = !state.pendingEnding;
    numberForm.hidden = true;
  }

  function showMessage(text, error = false) {
    message.textContent = text;
    message.classList.toggle("error", error);
  }

  async function action(callback) {
    if (busy) return;
    busy = true;
    const buttons = [...panel.querySelectorAll("button")];
    buttons.forEach(button => { button.disabled = true; });
    showMessage("");
    try { await callback(); }
    catch (error) { showMessage(error.message, true); }
    finally {
      busy = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  change.addEventListener("click", () => {
    verifyForm.hidden = true;
    numberForm.hidden = false;
    numberForm.elements.number.focus();
  });

  numberForm.addEventListener("submit", event => {
    event.preventDefault();
    const values = new FormData(numberForm);
    action(async () => {
      const result = await BusinessApi.post(endpoint + "/start", {
        number: values.get("number"), authenticator: values.get("authenticator"),
        alerts: values.has("alerts"), requestCode: true,
      });
      numberForm.reset();
      describe(await BusinessApi.get(endpoint));
      showMessage(result.uncertain ? "If the code arrives, enter it below." : "Verification code sent.");
      verifyForm.elements.code.focus();
    });
  });

  verifyForm.addEventListener("submit", event => {
    event.preventDefault();
    action(async () => {
      await BusinessApi.post(endpoint + "/confirm", { code: new FormData(verifyForm).get("code") });
      verifyForm.reset();
      describe(await BusinessApi.get(endpoint));
      showMessage("WhatsApp number verified.");
    });
  });

  stop.addEventListener("click", () => action(async () => {
    await BusinessApi.post(endpoint + "/opt-out", {});
    describe(await BusinessApi.get(endpoint));
    showMessage("WhatsApp assignment alerts are off.");
  }));

  BusinessApi.get(endpoint).then(describe).catch(() => {
    // Keep the existing profile usable if this optional service is unavailable.
  });
})();
