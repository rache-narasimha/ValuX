/** My Account: immutable identity, optional cropped photo, authenticated password change. */
(function () {
  "use strict";
  const get = (id) => document.getElementById(id);
  const user = window.__VALUX_AUTH_CONTEXT__.user;
  const file = get("profile-photo-file"), editor = get("photo-editor"), canvas = get("photo-crop");
  const photoMessage = get("photo-message"), passwordMessage = get("password-message");
  let image = null, sourceUrl = null;
  get("account-name").value = user.name;
  get("account-user-id").value = user.userId;
  get("account-role").value = user.roleLabel;
  get("account-email").value = user.email || "";
  function identity(updated) {
    window.AppShell.updateUser(updated);
    get("remove-photo").hidden = !updated.photoUrl;
  }
  identity(user);
  function message(element, text, error = false) {
    element.textContent = text;
    element.classList.toggle("error", error);
  }
  function cancel() {
    editor.hidden = true;
    image = null;
    file.value = "";
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    sourceUrl = null;
  }
  function draw() {
    if (!image) return;
    const scale = Math.max(384 / image.naturalWidth, 384 / image.naturalHeight) * Number(get("photo-zoom").value);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 384, 384);
    context.drawImage(image, -(width - 384) * Number(get("photo-x").value) / 100, -(height - 384) * Number(get("photo-y").value) / 100, width, height);
  }
  file.addEventListener("change", async () => {
    const selected = file.files[0];
    if (!selected) return;
    cancel();
    message(photoMessage, "");
    if (!["image/jpeg", "image/png", "image/webp"].includes(selected.type) || selected.size > 2 * 1024 * 1024) {
      message(photoMessage, "Choose a JPEG, PNG or WebP photo up to 2 MB.", true); return;
    }
    sourceUrl = URL.createObjectURL(selected);
    const pendingUrl = sourceUrl;
    const preview = new Image();
    try {
      preview.src = pendingUrl;
      await preview.decode();
      if (pendingUrl !== sourceUrl) return;
      if (preview.naturalWidth * preview.naturalHeight > 20000000) throw new Error("Photo too large");
      image = preview;
      get("photo-zoom").value = "1";
      get("photo-x").value = get("photo-y").value = "50";
      editor.hidden = false;
      draw();
    } catch (_error) { cancel(); message(photoMessage, "This photo could not be opened. Choose another image.", true); }
  });
  ["photo-zoom", "photo-x", "photo-y"].forEach((id) => get(id).addEventListener("input", draw));
  get("cancel-photo").addEventListener("click", cancel);
  async function savePhoto(photo) {
    const controls = [get("save-photo"), get("cancel-photo"), get("remove-photo"), file];
    controls.forEach((control) => { control.disabled = true; });
    message(photoMessage, "Saving…");
    try {
      const payload = await BusinessApi.post("/api/auth/profile/photo", { photo });
      identity(payload.user);
      cancel();
      message(photoMessage, photo ? "Profile photo saved." : "Profile photo removed.");
    } catch (error) { message(photoMessage, error.message, true); }
    finally { controls.forEach((control) => { control.disabled = false; }); }
  }
  get("save-photo").addEventListener("click", () => { if (image) savePhoto(canvas.toDataURL("image/jpeg", 0.9).split(",")[1]); });
  get("remove-photo").addEventListener("click", () => savePhoto(null));
  get("password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('[type="submit"]');
    if (get("new-password").value !== get("confirm-password").value) { message(passwordMessage, "The new passwords do not match.", true); return; }
    button.disabled = true;
    message(passwordMessage, "Changing password…");
    try {
      const result = await BusinessApi.post("/api/auth/account/password", {
        currentPassword: get("current-password").value, newPassword: get("new-password").value,
        confirmPassword: get("confirm-password").value, code: get("account-totp").value,
      });
      get("password-form").reset();
      message(passwordMessage, result.confirmationSent ? "Password changed. Other sessions were signed out and a confirmation email was sent." : "Password changed. Other sessions were signed out, but the confirmation email could not be delivered.");
    } catch (error) { message(passwordMessage, error.message, true); }
    finally { button.disabled = false; }
  });
})();
