import { Fragment, h, render } from "vue";

// Existing controllers keep their API, state and event delegation. This commits
// the Vue view synchronously so those controllers can still address its controls.
export function paint(host, children) {
  render(Array.isArray(children) ? h(Fragment, null, children) : children, host);
}

export function text(value) {
  return String(value ?? "");
}

export function emptyView(message) {
  return h("div", { class: "empty-state compact-empty" }, [
    h("strong", "No tasks to show"), h("p", message),
  ]);
}

export function taskUrl(id) {
  return `/tasks/detail?id=${encodeURIComponent(id)}`;
}

// Use a detached Vue view for panels with controller-owned native fields.
export function viewElement(view) {
  const host = document.createElement("div");
  paint(host, view);
  return host.firstElementChild;
}
