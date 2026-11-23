import { createApp, h, shallowRef } from "vue";

function option(value, label, selected) {
  return h("option", { key: value, value, selected }, label);
}

function filterButton(value, label, active, attribute, choose) {
  return h("button", {
    key: value,
    type: "button",
    class: { active },
    "aria-pressed": String(active),
    [attribute]: value,
    onClick: () => choose(value),
  }, label);
}

function mountControl(target, render) {
  createApp({ setup: () => render }).mount(target);
}

export function populateStatuses(select, statuses) {
  mountControl(select, () => [
    option("", "All statuses", true),
    ...statuses.map((status) => option(status, status, false)),
  ]);
}

export function mount(controls, actions) {
  const period = shallowRef({ active: "", options: [], picker: null });
  const dateBasis = shallowRef(null);

  mountControl(controls.switcher, () => period.value.options.map(([value, label]) =>
    filterButton(value, label, value === period.value.active, "data-task-period", actions.choosePeriod)
  ));
  mountControl(controls.picker, () => {
    const { active, picker } = period.value;
    if (!picker) return null;
    const change = (event) => actions.chooseDate(active, event.currentTarget.value);
    const attributes = { id: "task-period-picker-value", key: active, onChange: change };
    const field = picker.options
      ? h("select", attributes, picker.options.map(({ value, label }) => option(value, label, value === picker.value)))
      : h("input", { ...attributes, type: picker.type, value: picker.value });
    return h("label", [picker.label, field]);
  });
  mountControl(controls.dateBasis, () => {
    const selection = dateBasis.value;
    if (!selection) return null;
    return [
      filterButton("assigned", "Assigned during", selection.active === "assigned", "data-date-basis", actions.chooseDateBasis),
      filterButton("status", selection.label, selection.active === "status", "data-date-basis", actions.chooseDateBasis),
    ];
  });

  return {
    showPeriod(selection) {
      period.value = selection;
      controls.picker.hidden = !selection.picker;
    },
    showDateBasis(selection) {
      dateBasis.value = selection;
      controls.dateBasis.hidden = !selection;
    },
  };
}
