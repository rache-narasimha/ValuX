import { h } from "vue";
import { paint, taskUrl, text } from "./dom.js";

export function paintNotifications(host, items, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone, timeZoneName: "short",
  });
  paint(host, items.length ? items.map(item => h("article", {
    class: ["notification-item", { unread: !item.read }], key: item.id,
  }, [
    h("a", { href: taskUrl(item.taskCode), "data-notification-id": item.id }, [
      h("strong", `${text(item.taskCode)} · ${text(item.customer)}`), h("span", text(item.message)),
      h("small", `${text(item.actor)} · ${formatter.format(new Date(item.createdAt))}`),
    ]),
    h("button", {
      type: "button", class: "notification-read", "data-read-id": item.id,
      hidden: item.read, title: "Mark as read", "aria-label": "Mark notification as read",
    }, "✓"),
  ])) : h("p", { class: "notification-empty" }, "You’re all caught up. New task updates will appear here."));
}

export function paintEmployeePicker(host, { listId, choices, label, required }) {
  paint(host, [
    h("span", { class: "employee-search-icon", "aria-hidden": "true" }, [
      h("svg", { viewBox: "0 0 24 24", focusable: "false" }, [
        h("circle", { cx: 10.5, cy: 10.5, r: 6.5 }), h("path", { d: "m15.5 15.5 5 5" }),
      ]),
    ]),
    h("input", {
      type: "search", list: listId, autocomplete: "off", placeholder: "Search employee ID or name",
      "aria-label": label, required,
    }),
    h("datalist", { id: listId }, choices.map(({ value, label }) => h("option", { key: value, value }, label))),
    h("small", { class: "employee-reference-help" }, "Search by employee ID or name"),
  ]);
}

export function paintPaymentDialog(host) {
  const close = { type: "button", "data-close-shared-payment": "" };
  const field = (id, label, input, help) => h("div", { class: "field" }, [
    h("label", { for: id }, label), input, help ? h("small", help) : null,
  ]);
  const amount = (name, label) => {
    const id = `shared-payment-${name}`;
    return field(id, label, h("input", { id, inputmode: "decimal" }));
  };
  paint(host, h("div", { class: "workflow-modal", id: "shared-payment-modal", hidden: true }, [
    h("section", { class: "workflow-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "shared-payment-title" }, [
      h("div", { class: "dialog-heading" }, [
        h("div", [h("h2", { id: "shared-payment-title" }, "Payment update"), h("p", { id: "shared-payment-task" })]),
        h("button", { ...close, class: "modal-x", "aria-label": "Close" }, "×"),
      ]),
      h("form", { id: "shared-payment-form", class: "stack-form" }, [
        h("div", { class: "form-grid" }, [
          amount("estimated", "Estimated fee"), amount("agreed", "Agreed fee"), amount("received", "Amount received"),
          field("shared-payment-due", "Payment due date", h("input", { id: "shared-payment-due", type: "date" }),
            "Standard period: seven calendar days after completion."),
        ]),
        h("div", { class: "payment-summary" }, [
          h("span", "Outstanding"), h("strong", { id: "shared-payment-outstanding" }, "N/A"),
          h("small", { id: "shared-payment-state" }, "Not Set"),
        ]),
        h("p", { id: "shared-payment-warning", class: "payment-warning", hidden: true }),
        field("shared-payment-note", "Work note", h("textarea", {
          id: "shared-payment-note", placeholder: "Optional note appended to the task activity",
        })),
        h("p", { class: "form-error", id: "shared-payment-error", role: "alert", hidden: true }),
        h("div", { class: "dialog-actions" }, [
          h("button", { ...close, class: "secondary" }, "Cancel"),
          h("button", { class: "secondary", type: "submit" }, "Save update"),
          h("span", { class: "disabled-action" }, [
            h("button", { class: "primary", id: "shared-close-request", type: "button", disabled: true }, "Close request"),
            h("small", { id: "shared-close-reason" }, "Complete the report and settle payment before closing."),
          ]),
        ]),
      ]),
    ]),
  ]));
}
