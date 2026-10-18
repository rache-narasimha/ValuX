/** ValuX login, account activation, MFA, and recovery experience. */
(function () {
  "use strict";

  const card = document.getElementById("auth-card");
  const RECOVERY_STORAGE = "valux.activation.recovery-codes";
  let csrf = "";
  let context = null;
  let busy = false;

  function escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function safeDestination() {
    const value = new URLSearchParams(location.search).get("next") || "/";
    return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/auth") ? value : "/";
  }

  function head(title, description, mark = "VX") {
    const markClass = mark === "VX" ? "step-mark valux-auth-mark" : "step-mark";
    return `<div class="auth-card-head"><span class="${markClass}">${escape(mark)}</span><h2>${escape(title)}</h2><p>${escape(description)}</p></div>`;
  }

  function message(text, kind = "") {
    return text ? `<p class="auth-message ${kind}" role="status">${escape(text)}</p>` : "";
  }

  function render(html) {
    card.innerHTML = html;
    card.querySelector("input")?.focus();
  }

  async function request(path, payload = {}) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({ ok: false, error: "The server returned an invalid response." }));
    if (!response.ok || result.ok === false) throw new Error(result.error || "The request could not be completed.");
    return result;
  }

  async function submit(form, action) {
    if (busy) return;
    busy = true;
    form.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    try {
      await action();
    } catch (error) {
      const target = form.querySelector("[data-form-message]");
      if (target) target.outerHTML = message(error.message, "error").replace("<p ", '<p data-form-message ');
      else form.insertAdjacentHTML("afterbegin", message(error.message, "error").replace("<p ", '<p data-form-message '));
    } finally {
      busy = false;
      form.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    }
  }

  function loginView(note = "") {
    render(`${head("Welcome to ValuX", "Sign in to access your role-based dashboard tools.", "VX")}
      ${message(note, note ? "success" : "")}
      <form class="auth-form" id="login-form">
        <span data-form-message></span>
        <div class="auth-field"><label for="identifier">Email or User ID</label><input id="identifier" name="identifier" autocomplete="username" required placeholder="Enter your email or User ID" /></div>
        <div class="auth-field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required placeholder="Enter your password" /></div>
        <div class="auth-form-row"><button class="auth-link" id="forgot-link" type="button">Forgot password?</button></div>
        <button class="auth-primary" type="submit">Sign in securely</button>
        <p class="auth-note">Accounts are issued by your ValuX administrator. Contact the account operator if your activation password has expired.</p>
      </form>`);
    document.getElementById("forgot-link").addEventListener("click", forgotView);
    document.getElementById("login-form").addEventListener("submit", (event) => {
      event.preventDefault();
      submit(event.currentTarget, async () => {
        const form = new FormData(event.currentTarget);
        const result = await request("/api/auth/login", { identifier: form.get("identifier"), password: form.get("password") });
        context = { user: result.user, next: result.next };
        routeStep(result.next);
      });
    });
  }

  function changePasswordView() {
    render(`${head("Secure your account", "Replace the one-time activation password before continuing.", "1")}
      <form class="auth-form" id="password-form">
        <span data-form-message></span>
        <div class="auth-field"><label for="new-password">New password</label><input id="new-password" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" /><small>12–128 characters with uppercase, lowercase, a number and a symbol. Your last 24 passwords cannot be reused.</small></div>
        <div class="auth-field"><label for="confirm-password">Confirm new password</label><input id="confirm-password" name="confirm" type="password" autocomplete="new-password" required /></div>
        <button class="auth-primary" type="submit">Set password and continue</button>
      </form>`);
    document.getElementById("password-form").addEventListener("submit", (event) => {
      event.preventDefault();
      submit(event.currentTarget, async () => {
        const form = new FormData(event.currentTarget);
        if (form.get("password") !== form.get("confirm")) throw new Error("The two passwords do not match.");
        const result = await request("/api/auth/change-password", { password: form.get("password") });
        routeStep(result.next);
      });
    });
  }

  async function mfaSetupView() {
    render(`<div class="auth-loading"><span></span><strong>Preparing authenticator setup…</strong></div>`);
    try {
      const setup = await request("/api/auth/mfa/setup");
      render(`${head("Add an authenticator", "Scan this QR code with Google Authenticator, Microsoft Authenticator or another TOTP app.", "2")}
        <div class="mfa-setup"><img src="${setup.qr}" alt="Authenticator QR code" /><div><p class="auth-note">If scanning is unavailable, enter this setup key manually:</p><p class="mfa-secret">${escape(setup.secret)}</p></div></div>
        <form class="auth-form" id="mfa-enroll-form">
          <span data-form-message></span>
          <div class="auth-field"><label for="mfa-code">6-digit authenticator code</label><input id="mfa-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="000000" /></div>
          <button class="auth-primary" type="submit">Verify authenticator</button>
        </form>`);
      document.getElementById("mfa-enroll-form").addEventListener("submit", (event) => {
        event.preventDefault();
        submit(event.currentTarget, async () => {
          const result = await request("/api/auth/mfa/enroll", { code: new FormData(event.currentTarget).get("code") });
          sessionStorage.setItem(RECOVERY_STORAGE, JSON.stringify(result.recoveryCodes));
          recoveryCodesView(result.recoveryCodes);
        });
      });
    } catch (error) {
      loginView(error.message);
    }
  }

  function recoveryCodesView(codes) {
    const available = Array.isArray(codes) && codes.length;
    render(`${head("Save your recovery codes", "Each code can restore authenticator access once. They will not be shown again.", "3")}
      ${available ? `<div class="recovery-grid">${codes.map((code) => `<span>${escape(code)}</span>`).join("")}</div>` : message("Recovery codes were already generated. Return to the same browser session or contact the account operator if you did not save them.", "error")}
      <form class="auth-form" id="codes-form">
        <label class="auth-note"><input type="checkbox" name="saved" required /> I saved these codes somewhere private and safe.</label>
        <button class="auth-primary" type="submit" ${available ? "" : "disabled"}>Continue to recovery email</button>
      </form>`);
    document.getElementById("codes-form").addEventListener("submit", (event) => {
      event.preventDefault();
      submit(event.currentTarget, async () => {
        const result = await request("/api/auth/mfa/recovery-codes/confirm");
        sessionStorage.removeItem(RECOVERY_STORAGE);
        if (result.next === "complete") location.assign(safeDestination());
        else routeStep(result.next);
      });
    });
  }

  function emailSetupView() {
    render(`${head("Add a recovery email", "Verification is required before your ValuX account can be activated.", "4")}
      <form class="auth-form" id="email-form">
        <span data-form-message></span>
        <div class="auth-field"><label for="recovery-email">Recovery email</label><input id="recovery-email" name="email" type="email" autocomplete="email" required placeholder="you@example.com" /><small>You can use this verified address to sign in and recover your password.</small></div>
        <button class="auth-primary" type="submit">Send verification email</button>
      </form>`);
    document.getElementById("email-form").addEventListener("submit", (event) => {
      event.preventDefault();
      submit(event.currentTarget, async () => {
        const result = await request("/api/auth/email", { email: new FormData(event.currentTarget).get("email") });
        context.pendingEmail = result.email;
        emailVerifyView(result.email, "Verification email sent.");
      });
    });
  }

  function emailVerifyView(email, note = "") {
    render(`${head("Check your email", "Open the ValuX verification link to complete activation.", "5")}
      ${message(note, "success")}
      <p class="auth-note">We sent a single-use verification link to <strong>${escape(email || "your recovery email")}</strong>. The link expires in 24 hours.</p>
      <div class="auth-form" style="margin-top:18px"><button class="auth-secondary" id="resend-email" type="button">Resend verification email</button><button class="auth-link" id="change-email" type="button">Use a different email</button></div>`);
    document.getElementById("resend-email").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await request("/api/auth/email/resend");
        emailVerifyView(email, result.message);
      } catch (error) {
        emailVerifyView(email, error.message);
      }
    });
    document.getElementById("change-email").addEventListener("click", emailSetupView);
  }

  function mfaLoginView(recovery = false) {
    render(`${head(recovery ? "Use a recovery code" : "Verify it’s you", recovery ? "Enter one unused recovery code. You will then set up a new authenticator." : "Enter the current code from your authenticator app.", recovery ? "RC" : "MFA")}
      <form class="auth-form" id="mfa-login-form">
        <span data-form-message></span>
        <div class="auth-field"><label for="login-code">${recovery ? "Recovery code" : "6-digit authenticator code"}</label><input id="login-code" name="code" ${recovery ? "" : 'inputmode="numeric" pattern="[0-9]{6}" maxlength="6"'} autocomplete="one-time-code" required /></div>
        <button class="auth-primary" type="submit">${recovery ? "Reset authenticator" : "Continue to workspace"}</button>
        <button class="auth-link" id="switch-mfa-mode" type="button">${recovery ? "Use authenticator instead" : "I cannot access my authenticator"}</button>
      </form>`);
    document.getElementById("switch-mfa-mode").addEventListener("click", () => mfaLoginView(!recovery));
    document.getElementById("mfa-login-form").addEventListener("submit", (event) => {
      event.preventDefault();
      submit(event.currentTarget, async () => {
        const endpoint = recovery ? "/api/auth/mfa/recover" : "/api/auth/mfa/verify";
        const result = await request(endpoint, { code: new FormData(event.currentTarget).get("code") });
        if (result.next === "complete") location.assign(safeDestination());
        else routeStep(result.next);
      });
    });
  }

  function forgotView() {
    render(`${head("Reset your password", "Enter your User ID or verified recovery email.", "?")}
      <form class="auth-form" id="forgot-form">
        <span data-form-message></span>
        <div class="auth-field"><label for="recovery-identifier">Email or User ID</label><input id="recovery-identifier" name="identifier" autocomplete="username" required /></div>
        <button class="auth-primary" type="submit">Send reset link</button>
        <button class="auth-link" id="back-login" type="button">Return to sign in</button>
      </form>`);
    document.getElementById("back-login").addEventListener("click", () => loginView());
    document.getElementById("forgot-form").addEventListener("submit", (event) => {
      event.preventDefault();
      submit(event.currentTarget, async () => {
        const result = await request("/api/auth/forgot-password", { identifier: new FormData(event.currentTarget).get("identifier") });
        render(`${head("Check your email", "For privacy, the result is the same whether or not an account matches.", "✓")}${message(result.message, "success")}<button class="auth-secondary" id="return-login" type="button">Return to sign in</button>`);
        document.getElementById("return-login").addEventListener("click", () => loginView());
      });
    });
  }

  function resetPasswordView(token) {
    render(`${head("Choose a new password", "Your authenticator will still be required when you sign in.", "↻")}
      <form class="auth-form" id="reset-form">
        <span data-form-message></span>
        <div class="auth-field"><label for="reset-password">New password</label><input id="reset-password" name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" /><small>Your last 24 passwords cannot be reused.</small></div>
        <div class="auth-field"><label for="reset-confirm">Confirm password</label><input id="reset-confirm" name="confirm" type="password" autocomplete="new-password" required /></div>
        <button class="auth-primary" type="submit">Reset password</button>
      </form>`);
    document.getElementById("reset-form").addEventListener("submit", (event) => {
      event.preventDefault();
      submit(event.currentTarget, async () => {
        const form = new FormData(event.currentTarget);
        if (form.get("password") !== form.get("confirm")) throw new Error("The two passwords do not match.");
        const result = await request("/api/auth/reset-password", { token, password: form.get("password") });
        history.replaceState(null, "", "/auth");
        loginView(result.message);
      });
    });
  }

  async function verifyEmailView(token) {
    render(`<div class="auth-loading"><span></span><strong>Verifying your recovery email…</strong></div>`);
    try {
      const result = await request("/api/auth/email/verify", { token });
      history.replaceState(null, "", "/auth");
      if (result.signedIn) location.assign(safeDestination());
      else loginView("Recovery email verified. Your account is active; sign in to continue.");
    } catch (error) {
      render(`${head("Verification unsuccessful", "The link may have expired or already been used.", "!")}${message(error.message, "error")}<button class="auth-secondary" id="return-login" type="button">Return to sign in</button>`);
      document.getElementById("return-login").addEventListener("click", () => loginView());
    }
  }

  function routeStep(step) {
    if (step === "change_password") changePasswordView();
    else if (step === "mfa_setup") mfaSetupView();
    else if (step === "recovery_codes") recoveryCodesView(JSON.parse(sessionStorage.getItem(RECOVERY_STORAGE) || "null"));
    else if (step === "email_setup") emailSetupView();
    else if (step === "email_verify") emailVerifyView(context?.pendingEmail);
    else if (step === "mfa_login") mfaLoginView();
    else if (step === "complete") location.assign(safeDestination());
    else loginView();
  }

  async function initialize() {
    try {
      const response = await fetch("/api/auth/context", { credentials: "same-origin" });
      context = await response.json();
      csrf = context.csrf;
      const hash = location.hash.slice(1);
      if (hash.startsWith("verify-email=")) {
        verifyEmailView(hash.slice("verify-email=".length));
        return;
      }
      if (hash.startsWith("reset-password=")) {
        resetPasswordView(hash.slice("reset-password=".length));
        return;
      }
      if (context.authenticated) {
        location.replace(safeDestination());
        return;
      }
      routeStep(context.next);
    } catch (_error) {
      render(`${head("ValuX is unavailable", "The authentication service could not be reached.", "!")}${message("Check that Docker and PostgreSQL are running, then refresh this page.", "error")}`);
    }
  }

  initialize();
})();
