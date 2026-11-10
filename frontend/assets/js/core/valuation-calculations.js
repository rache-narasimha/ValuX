/** Editable valuation results. Overrides belong to the report draft, not workflow state. */
(function exposeValuationCalculations(global) {
  const { numeric, money, areaFactors, areaLabels } = global.ValuationUI;
  const overridesKey = "calculation.overrides";

  function roundFinal(value) {
    const amount = Math.abs(value), remainder = amount % 1000;
    if (remainder === 500) return value;
    return Math.sign(value) * (amount - remainder + (remainder > 500 ? 1000 : 0));
  }

  function evaluate(kind, inputs, overrides = {}, floorCount = 1) {
    const nodes = [], results = {};
    const source = (id) => numeric(inputs[id]);
    const value = (id) => Object.hasOwn(results, id) ? (results[id] || 0) : source(id);
    function add(id, dependencies, calculated, format = money, aliases = []) {
      const edited = Object.hasOwn(overrides, id);
      const adopted = edited ? numeric(overrides[id]) : calculated;
      results[id] = adopted;
      nodes.push({ id, dependencies, calculated, value: adopted, format, ids: [id, ...aliases], edited });
      return adopted;
    }
    const extentText = (amount) => amount.toFixed(4).replace(/\.?0+$/, "");
    if (kind === "agricultural") {
      const prefix = "valuation.", extent = source(prefix + "total_extent_value"),
        from = inputs[prefix + "extent_unit"], to = inputs[prefix + "adopted_rate_unit"],
        rate = source(prefix + "adopted_rate_value"), ready = extent > 0 && rate > 0 && from && to;
      const converted = add(prefix + "converted_extent_display",
        [prefix + "total_extent_value", prefix + "extent_unit", prefix + "adopted_rate_unit"],
        ready ? extent * areaFactors[from] / areaFactors[to] : null,
        (amount) => `${extentText(amount)} ${areaLabels[to] || ""}`.trim());
      const estimated = add(prefix + "estimated_value_display",
        [prefix + "converted_extent_display", prefix + "adopted_rate_value"],
        ready || Object.hasOwn(overrides, prefix + "converted_extent_display") ? roundFinal(converted * rate) : null);
      add(prefix + "book_value_display", [prefix + "estimated_value_display"], estimated);
      add(prefix + "distress_value_display", [prefix + "estimated_value_display"], estimated === null ? null : roundFinal(estimated * 0.8));
    } else {
      const from = inputs["land.extent_unit"], to = inputs["land.rate_unit"];
      const converted = add("land.converted_extent", ["land.extent_value", "land.extent_unit", "land.rate_unit"],
        from && to ? source("land.extent_value") * areaFactors[from] / areaFactors[to] : null, extentText);
      const land = add("land.estimated_value", ["land.converted_extent", "land.adopted_rate_value"],
        converted === null ? null : converted * source("land.adopted_rate_value"), money,
        ["land.estimated_value_display", "abstract.land"]);
      const floorKeys = [];
      for (let index = 1; index <= floorCount; index++) {
        const p = `building.floors.${index}.`, type = inputs[p + "structure_type"],
          area = source(p + "plinth_area"), rate = source(p + "replacement_rate"), age = Math.max(0, source(p + "age"));
        const life = add(p + "total_life", [p + "structure_type"],
          ({ rcc: 60, industrial: 35, temporary: 20 })[type] || null, (amount) => String(amount));
        const replacement = add(p + "replacement_cost", [p + "plinth_area", p + "replacement_rate"],
          area > 0 && rate > 0 ? area * rate : null);
        const depreciation = add(p + "depreciation", [p + "replacement_cost", p + "total_life", p + "age"],
          replacement !== null && life !== null ? (life ? replacement * Math.min(age, life) / life * 0.9 : 0) : null);
        add(p + "net_value", [p + "replacement_cost", p + "depreciation"],
          replacement !== null && depreciation !== null ? Math.max(0, replacement - depreciation) : null);
        floorKeys.push(p + "net_value");
      }
      const building = add("abstract.building", floorKeys, floorKeys.reduce((sum, id) => sum + value(id), 0));
      const sections = { "abstract.extra": "extra.item_", "abstract.amenities": "amenity.item_",
        "abstract.miscellaneous": "misc.item_", "abstract.services": "service.item_" };
      let total = (land || 0) + building + source("abstract.machinery");
      Object.entries(sections).forEach(([id, prefix]) => {
        const keys = Object.keys(inputs).filter((key) => key.startsWith(prefix));
        total += add(id, keys, keys.reduce((sum, key) => sum + source(key), 0));
      });
      const componentKeys = ["land.estimated_value", "abstract.building", ...Object.keys(sections), "abstract.machinery"];
      const sum = add("abstract.total", componentKeys, total);
      const market = add("valuation.present_market_value", ["abstract.total"], roundFinal(sum), money,
        ["abstract.present_market_value"]);
      add("valuation.realizable_value", ["valuation.present_market_value"], roundFinal(market * 0.9));
      add("valuation.distress_value", ["valuation.present_market_value"], roundFinal(market * 0.8));
    }
    return nodes;
  }

  function invalidate(overrides, nodes, changed) {
    const affected = new Set([changed]);
    nodes.forEach((node) => {
      if (node.dependencies.some((id) => affected.has(id))) {
        delete overrides[node.id];
        affected.add(node.id);
      }
    });
  }

  function create(kind, form, options = {}) {
    let overrides = {}, previous = {}, nodes = [];
    const controls = () => [...form.querySelectorAll("input[name],select[name],textarea[name]")];
    function read() {
      return Object.fromEntries(controls().map((input) => [input.name, global.NumericEntry?.read(input) ?? input.value]));
    }
    function restore(values) {
      try {
        const stored = JSON.parse(values[overridesKey] || "{}");
        overrides = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
      } catch { overrides = {}; }
      previous = read();
    }
    function refresh(changedId) {
      const inputs = read(), count = options.floorCount?.() || 1;
      nodes = evaluate(kind, inputs, overrides, count);
      const edited = nodes.find((node) => node.ids.includes(changedId));
      if (changedId && inputs[changedId] !== previous[changedId]) {
        const canonical = edited?.id || changedId;
        if (edited) {
          if (String(inputs[changedId] || "").trim()) overrides[canonical] = inputs[changedId];
          else delete overrides[canonical];
        }
        invalidate(overrides, nodes, canonical);
        nodes = evaluate(kind, inputs, overrides, count);
      }
      const validKeys = new Set(nodes.map((node) => node.id));
      Object.keys(overrides).forEach((key) => { if (!validKeys.has(key)) delete overrides[key]; });
      nodes.forEach((node) => node.ids.forEach((id) => {
        const input = document.getElementById(id);
        if (!input || !form.contains(input) || global.NumericEntry?.pending(input)) return;
        input.dataset.calculation = node.id;
        input.inputMode = "decimal";
        // Preserve the entered representation in drafts, preview payloads and aliases.
        // Formatting an active edit here would move the caret and alter its fingerprint.
        input.value = node.edited ? String(overrides[node.id]) : node.value === null ? "" : node.format(node.value);
        input.setCustomValidity(node.edited && !/-?\d[\d,]*(?:\.\d+)?/.test(String(overrides[node.id]))
          ? "Enter a numeric value." : "");
        const wrapper = input.closest(".field");
        if (!wrapper) return;
        let hint = wrapper.querySelector(".calculation-hint");
        if (!hint) {
          hint = document.createElement("div");
          hint.className = "hint calculation-hint";
          const text = document.createElement("span"), reset = document.createElement("button");
          reset.type = "button";
          reset.className = "calculation-reset";
          reset.textContent = "Use calculated value";
          reset.addEventListener("click", () => {
            if (input.disabled) return;
            if (options.beforeReset && !options.beforeReset()) return;
            delete overrides[node.id];
            invalidate(overrides, nodes, node.id);
            refresh();
            options.onReset?.();
          });
          hint.append(text, reset);
          wrapper.append(hint);
        }
        hint.hidden = !node.edited;
        hint.firstElementChild.textContent = `Calculated: ${node.calculated === null ? "—" : node.format(node.calculated)}`;
      }));
      previous = read();
    }
    function shiftFloor(removedIndex) {
      const shifted = {};
      Object.entries(overrides).forEach(([key, amount]) => {
        const match = key.match(/^building\.floors\.(\d+)\.(.+)$/);
        if (!match || Number(match[1]) < removedIndex) shifted[key] = amount;
        else if (Number(match[1]) > removedIndex) shifted[`building.floors.${Number(match[1]) - 1}.${match[2]}`] = amount;
      });
      overrides = shifted;
      ["abstract.building", "abstract.total", "valuation.present_market_value", "valuation.realizable_value", "valuation.distress_value"]
        .forEach((key) => delete overrides[key]);
    }
    function floorsChanged() {
      ["abstract.building", "abstract.total", "valuation.present_market_value", "valuation.realizable_value", "valuation.distress_value"]
        .forEach((key) => delete overrides[key]);
    }
    return { restore, refresh, shiftFloor, floorsChanged, serialize: () => JSON.stringify(overrides) };
  }

  global.ValuationCalculations = { create, evaluate, invalidate, roundFinal, overridesKey };
})(window);
