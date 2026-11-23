import { h } from "vue";
import { paint, text } from "./dom.js";

const institutionTypes = { Bank: "Banks", NBFC: "NBFCs" };
const chartPaths = {
  institutions: "m3 8 9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5",
  valuation: "M6 3h9l4 4v14H6zM15 3v5h4M9 12h7M9 16h7",
  estimation: "M8 7h8M8 11h1m3 0h1m3 0h.1M8 15h1m3 0h1m3 0h.1M8 18h1m3 0h1m3 0h.1",
  progress: "M4 20V4M4 20h17M7 15l4-5 4 3 5-7M16 6h4v4",
  completion: "M6 3h9l4 4v14H6zM15 3v5h4m-9 6 2 2 4-4",
};
function chartIcon(name) {
  let shapes = [h("path", { d: chartPaths[name] || chartPaths.valuation })];
  if (name === "bank") {
    shapes = [
      h("path", { d: "M2.5 8 12 3l9.5 5v1h-19z", fill: "currentColor", "fill-opacity": ".18" }),
      h("path", { d: "M5.5 12v5m6.5-5v5m6.5-5v5M4 18.5h16M2.5 21h19" }),
    ];
  } else if (name === "nbfc") {
    shapes = [
      h("path", { d: "M4 21V4h10v17z", fill: "currentColor", "fill-opacity": ".12" }),
      h("path", { d: "M14 10h6v11M2.5 21h19M7.5 8h3m-3 4h3m-3 4h3m6.5-2h.1m-.1 3h.1" }),
    ];
  } else if (name === "estimation") {
    shapes.unshift(h("rect", { x: 5, y: 3, width: 14, height: 18, rx: 2 }));
  }
  return h("svg", { class: "dashboard-chart-icon", viewBox: "0 0 24 24", "aria-hidden": "true" }, shapes);
}

function ring(segments, total, label, caption) {
  const radius = 42;
  let offset = 0;
  const arcs = segments.filter(entry => entry.value > 0).map(entry => {
    const fraction = entry.value / total;
    const stroke = { fill: "none", stroke: entry.color, "stroke-width": 12 };
    let shape;
    if (fraction >= 1) {
      shape = h("circle", { cx: 50, cy: 50, r: radius, ...stroke });
    } else {
      const start = offset * 2 * Math.PI - Math.PI / 2;
      offset += fraction;
      const end = offset * 2 * Math.PI - Math.PI / 2;
      const point = angle => `${50 + radius * Math.cos(angle)} ${50 + radius * Math.sin(angle)}`;
      const d = `M ${point(start)} A ${radius} ${radius} 0 ${fraction > .5 ? 1 : 0} 1 ${point(end)}`;
      shape = h("path", { d, ...stroke, "stroke-linecap": "butt" });
    }
    const name = `${entry.label}: ${entry.amount ?? entry.value}`;
    return h("a", { class: "dashboard-ring-slice", key: entry.label, href: entry.href, "aria-label": name }, [
      h("title", name), shape,
    ]);
  });
  const finish = arcs.length ? h("g", { class: "dashboard-ring-finish", fill: "none", "aria-hidden": "true" }, [
    h("circle", { cx: 50, cy: 50, r: radius, stroke: "url(#dashboard-satin-tone)", "stroke-width": 12 }),
    h("path", { d: "M 11.15 30.20 A 43.6 43.6 0 0 1 63.47 8.53", stroke: "url(#dashboard-satin-reflection)", "stroke-width": 1.05 }),
    h("path", { d: "M 57.57 92.94 A 43.6 43.6 0 0 0 87.76 71.8", stroke: "url(#dashboard-satin-reflection)", "stroke-width": .8, opacity: .52 }),
  ]) : null;
  return h("div", { class: "dashboard-ring" }, [
    h("svg", { viewBox: "0 0 100 100", role: arcs.length ? "group" : "img", "aria-label": `${label} ${caption}` }, [
      h("circle", { "aria-hidden": "true", cx: 50, cy: 50, r: radius, fill: "none", stroke: "var(--line)", "stroke-width": 12 }),
      ...arcs, finish,
    ]),
    h("div", { "aria-hidden": "true" }, [h("strong", text(label)), h("span", caption)]),
  ]);
}

function distribution(segments, total) {
  return [
    ring(segments, total, total, total ? "Assignments" : "No assignments"),
    h("div", { class: "distribution-legend" }, [
      h("div", { class: "distribution-legend-heading", "aria-hidden": "true" },
        ["", "", "Count", "%"].map(label => h("span", label))),
      ...segments.map(entry => h("a", {
        key: entry.label, href: entry.href, "data-institution-type": entry.type,
      }, [
        h("i", { style: { "--state-color": entry.color } }), h("span", entry.label), h("strong", text(entry.count)),
        h("small", `${total > 0 ? Math.round(entry.count / total * 100) : 0}%`),
      ])),
    ]),
  ];
}
export function paintStatusChart(host, segments, total) {
  paint(host, distribution(segments, total));
}

export function paintPaymentChart(host, segments, total, label, caption) {
  paint(host, ring(segments, total, label, caption));
}

export function paintWorkload(host, entries, groups, segments) {
  const maximum = Math.max(1, ...entries.map(entry => entry.count));
  const total = segments.reduce((sum, entry) => sum + entry.count, 0);
  paint(host, groups.map(({ type, rows, href, count }) => h("section", { class: "data-chart-card", key: type }, [
    h("h3", [chartIcon(type.toLowerCase()), `${institutionTypes[type]} `, h("small", `(${rows.length})`)]),
    h("div", { class: "horizontal-chart workload-chart" }, rows.map(entry => {
      const width = entry.count ? Math.max(8, Math.round(entry.count / maximum * 100)) : 0;
      return h("a", {
        key: entry.code, class: "horizontal-chart-row", href: entry.href, title: `${entry.name}: ${entry.count} reports`,
        "aria-label": `View ${entry.name} tasks`,
      }, [
        h("strong", entry.code),
        h("span", { class: "horizontal-track" }, [h("i", { style: { "--width": `${width}%`, "--chart-color": entry.color } })]),
        h("span", { class: "chart-value" }, text(entry.count)),
      ]);
    })),
    h("a", { class: "chart-total", href, "aria-label": `View all ${type === "Bank" ? "bank" : "NBFC"} tasks` },
      ["Total: ", h("strong", `${count} reports`)]),
    type === "NBFC" ? h("section", {
      class: "institution-type-section", id: "institution-type-section", "aria-labelledby": "institution-type-heading",
    }, [
      h("div", { class: "analysis-heading" }, [
        h("h4", { id: "institution-type-heading" }, [chartIcon("institutions"), "Workload by Institution Type"]),
      ]),
      h("div", { id: "institution-workload-chart", class: "distribution-content" }, distribution(segments, total)),
    ]) : null,
  ])));
}

export function paintFinanceOptions(host, entries) {
  paint(host, [
    h("option", { value: "" }, "All institutions"),
    h("option", { value: "type:Bank" }, "All Banks"),
    h("option", { value: "type:NBFC" }, "All NBFCs"),
    ...Object.entries(institutionTypes).map(([type, label]) => h("optgroup", { label, key: type },
      entries.filter(entry => entry.type === type).map(entry => h("option", {
        key: entry.code, value: entry.code,
      }, `${entry.code} · ${entry.name}`)))),
  ]);
}

export function paintFinanceDetail(host, selection, period) {
  paint(host, [h("strong", selection), h("span", period)]);
}

export function paintReportMix(host, entries) {
  const maximum = Math.max(1, ...entries.map(entry => entry.count));
  paint(host, entries.map(entry => h("a", { key: entry.key, href: entry.href, class: "report-type-row" }, [
    h("span", { class: "report-type-label" }, [chartIcon(entry.key), h("span", entry.label)]),
    h("i", [h("b", { style: { width: `${entry.count / maximum * 100}%` } })]),
    h("strong", text(entry.count)),
  ])));
}

export function paintPreparation(host, note, methods, unrecorded, preparationLink) {
  const maximum = Math.max(1, ...methods.map(({ count }) => count));
  paint(host, methods.map(({ key, label, color, count }) => {
    const column = [
      h("strong", text(count)),
      h("span", { class: "preparation-track", "aria-hidden": "true" }, [
        h("i", { style: { "--height": `${count / maximum * 100}%`, "--chart-color": color } }),
      ]),
      h("span", { class: "preparation-label" }, label),
    ];
    const className = "preparation-column";
    return h("li", { key, "data-preparation-source": key }, [count
      ? h("a", { class: className, href: preparationLink(key), "aria-label": `${label}: ${count} assignments` }, column)
      : h("div", { class: className }, column)]);
  }));
  note.hidden = !unrecorded;
  paint(note, unrecorded ? h("a", { href: preparationLink("unknown") }, `Not recorded: ${unrecorded}`) : null);
}

export function paintPeriodPicker(host, field) {
  host.hidden = !field;
  if (!field) return paint(host, null);
  const { id, label, inputType, options, value, className, onChange } = field;
  const selected = options && !options.some(option => option.value === value) ? options[0]?.value : value;
  const props = { id, "aria-label": `Assigned during ${label.toLowerCase()}`, value: selected, onChange };
  const control = options
    ? h("select", { ...props, class: className }, options.map(option =>
      h("option", { key: option.value, value: option.value, title: option.fullLabel }, text(option.label))))
    : h("input", { ...props, type: inputType });
  paint(host, h("label", [h("span", label), control]));
}
