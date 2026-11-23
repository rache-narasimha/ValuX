import { h } from "vue";
import { paint, text } from "./dom.js";

export function paintPaymentBars(host, bars, selectedFilter) {
  const scale = Math.max(...bars.map(bar => bar.amount)) || 1;
  paint(host, bars.map(({ label, amount, color, filter }) => h("li", { key: filter }, [
    h("button", {
      type: "button", class: "payment-summary-bar", "data-payment-bar-filter": filter,
      "aria-pressed": String(filter === selectedFilter),
    }, [
      h("span", label),
      h("span", { class: "horizontal-track", "aria-hidden": "true" }, [
        h("i", { style: { "--width": `${amount / scale * 100}%`, "--chart-color": color } }),
      ]),
      h("strong", WorkflowUI.currency(amount)),
    ]),
  ])));
}

export function paintWorkflowMix(host, mix, onSelect) {
  const maximum = Math.max(1, ...mix.map(item => item.count));
  paint(host, mix.map(item => {
    const width = item.count ? Math.max(5, Math.round(item.count / maximum * 100)) : 0;
    return h("button", {
      type: "button", key: item.key, "data-workflow-state": item.key, disabled: !item.count,
      onClick: () => onSelect(item.key),
    }, [
      h("span", item.label),
      h("i", [h("b", { style: { "--width": `${width}%`, "--state-color": item.color } })]),
      h("strong", text(item.count)),
    ]);
  }));
}

export function paintInstitutionDirectory(host, entries) {
  const metric = (label, value) => h("span", [h("small", label), h("strong", text(value))]);
  paint(host, entries.map(({ code, name, color, type, total, inProgress, onHold, outstanding }) => h("a", {
    key: code, class: "institution-directory-row", href: `/tasks?institution=${encodeURIComponent(code)}&period=monthly`,
  }, [
    h("span", { class: "institution-monogram", style: { "--institution-color": color } }, code.slice(0, 4)),
    h("span", [h("strong", `${code} · ${name}`), h("small", type)]),
    metric("Total", total), metric("In progress", inProgress), metric("On hold", onHold),
    metric("Outstanding", WorkflowUI.currency(outstanding)),
    h("b", { "aria-hidden": "true" }, "›"),
  ])));
}
