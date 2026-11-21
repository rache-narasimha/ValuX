/** Optional issued-estimate reference and construction summary for General reports. */
(function exposeValuationConstruction(global) {
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const decode = (value, fallback) => { try { const result = JSON.parse(value || "null"); return result && typeof result === typeof fallback ? result : fallback; } catch { return fallback; } };
  const KEY = "construction.estimates", REF = "construction.estimate_reference";

  function install(block, options) {
    const form = block.closest("form");
    let rows = decode(options.values[KEY], []), reference = decode(options.values[REF], {});
    let searchAbort, searchTimer, items = [], offset = 0, selected = null;
    const before = document.createElement("div");
    before.className = "construction-configuration";
    before.innerHTML = `<button type="button" class="secondary" data-building-config>Building configuration ▾</button>
      <div data-config-panel hidden class="construction-config-panel"><div class="grid">
      <label class="field">Base levels<select data-base-levels><option value="gf">Ground Floor</option><option value="cellar,gf">Cellar + Ground Floor</option><option value="stilt,gf">Stilt + Ground Floor</option><option value="cellar,stilt,gf">Cellar + Stilt + Ground Floor</option></select></label>
      <label class="field">Upper floors above Ground Floor<input data-upper-count type="number" min="0" step="1" value="0"></label></div>
      <button type="button" class="secondary" data-apply-config>Apply configuration</button></div>`;
    block.prepend(before);
    before.querySelectorAll("input,select").forEach((control) => { control.dataset.wired = "1"; });
    const summary = document.createElement("section");
    summary.className = "subgroup construction-summary";
    summary.innerHTML = `<h3>Estimated construction costs</h3><p class="hint">Use an issued estimate or enter costs manually. These costs are separate from the assessed floor-wise building value.</p>
      <label class="field">Estimation reference<select data-reference-choice><option value="manual">N/A — Enter estimated costs manually</option><option value="search">Select an issued estimation…</option></select></label>
      <div data-estimate-search hidden><label class="field">Find estimation<input data-estimate-query type="search" placeholder="Task ID, applicant, institution or property"></label>
        <div data-search-status role="status"></div><div data-estimate-results></div><button type="button" class="secondary" data-load-more hidden>Load more</button><button type="button" class="secondary" data-cancel-search>Cancel search</button></div>
      <p data-reference-caption class="hint"></p><div data-source-components hidden></div>
      <div class="construction-cost-scroll"><table class="construction-cost-table"><thead><tr><th>Floor / component</th><th>Adopted estimated cost (Rs.)</th><th></th></tr></thead><tbody data-estimate-rows></tbody></table></div>
      <button type="button" class="secondary" data-add-cost>Add estimated cost</button>
      <dl class="construction-totals"><div><dt>Total estimated construction cost</dt><dd data-cost-total>—</dd></div><div data-as-on-date><dt>Construction as on date · Building value</dt><dd data-assessed>—</dd></div><div data-balance-row><dt>Balance construction work</dt><dd data-balance>—</dd></div></dl>
      <p data-cost-warning class="hint" role="status"></p>`;
    block.after(summary);
    const hidden = {};
    [KEY, REF, "construction.summary_version"].forEach((key) => {
      const input = document.createElement("input"); input.type = "hidden"; input.name = key; input.id = key; input.dataset.wired = "1";
      hidden[key] = input; summary.append(input);
    });
    hidden["construction.summary_version"].value = "1";
    const find = (selector) => summary.querySelector(selector);
    function store() { hidden[KEY].value = JSON.stringify(rows); hidden[REF].value = JSON.stringify(reference); }
    function changed() { store(); options.changed(); refresh(); }
    function own(control, callback, event = "change") {
      control.dataset.wired = "1";
      control.addEventListener(event, callback);
    }
    function floorRows() {
      const values = options.getValues();
      return Array.from({ length: options.floorCount() }, (_, i) => ({ id: `manual-${i + 1}`, label: values[`building.floors.${i + 1}.name`] || (i ? `Floor ${i + 1}` : "GF"), amount: "" }));
    }
    function renderRows() {
      find("[data-estimate-rows]").innerHTML = rows.map((row, index) => `<tr><td><input data-cost-label="${index}" aria-label="Component ${index + 1} name" value="${escape(row.label)}"></td><td><input data-cost-amount="${index}" aria-label="Component ${index + 1} estimated cost" inputmode="decimal" data-arithmetic-optional value="${escape(row.amount)}"></td><td><button type="button" class="secondary" data-remove-cost="${index}" aria-label="Remove ${escape(row.label)}">Remove</button></td></tr>`).join("");
      summary.querySelectorAll("[data-cost-label],[data-cost-amount]").forEach((input) => {
        input.addEventListener("beforeinput", (event) => { if (!options.beforeEdit()) event.preventDefault(); });
        own(input, () => {
          const index = Number(input.dataset.costLabel ?? input.dataset.costAmount);
          rows[index][input.hasAttribute("data-cost-label") ? "label" : "amount"] = global.NumericEntry?.read(input) ?? input.value;
          changed();
        }, "input");
        input.addEventListener("change", () => { rows[Number(input.dataset.costLabel ?? input.dataset.costAmount)][input.hasAttribute("data-cost-label") ? "label" : "amount"] = global.NumericEntry?.read(input) ?? input.value; changed(); });
      });
      summary.querySelectorAll("[data-remove-cost]").forEach((button) => button.onclick = () => {
        if (!options.beforeEdit() || !confirm("Remove this adopted estimated-cost row?")) return;
        rows.splice(Number(button.dataset.removeCost), 1); renderRows(); changed();
      });
      store();
    }
    function refresh() {
      const values = options.getValues(), applicable = ["proposed", "under_construction"].includes(values["property.status"]) && String(values["property.category"] || "").includes("land_building");
      summary.hidden = !applicable;
      summary.querySelectorAll("input,select,button").forEach((control) => { control.disabled = !applicable || global.ReportData.readOnly; });
      const underway = values["property.status"] === "under_construction";
      find("[data-as-on-date]").hidden = find("[data-balance-row]").hidden = !underway;
      const activeRows = rows.filter((row) => String(row.label || "").trim() || String(row.amount ?? "").trim());
      const amounts = activeRows.map((row) => /-?\d[\d,]*(?:\.\d+)?/.test(String(row.amount ?? "")) ? global.ValuationUI.numeric(row.amount) : null);
      const total = activeRows.length && amounts.every((amount) => amount !== null && Number.isFinite(amount) && amount >= 0) ? amounts.reduce((a, b) => a + b, 0) : null;
      const assessed = global.ValuationUI.numeric(values["abstract.building"]);
      find("[data-cost-total]").textContent = total === null ? "—" : global.ValuationUI.money(total);
      find("[data-assessed]").textContent = global.ValuationUI.money(assessed);
      find("[data-balance]").textContent = total === null ? "—" : global.ValuationUI.money(total - assessed);
      find("[data-cost-warning]").textContent = underway && total !== null && assessed > total ? "The assessed construction exceeds the adopted estimate. Review the values; neither amount has been changed." : "";
      find("[data-reference-caption]").textContent = reference.taskCode ? `Adopted from ${reference.taskCode} · snapshot ${reference.snapshotNumber}. Values remain editable; source changes are not imported automatically.` : "Manual estimated costs. An empty amount means unknown, not zero.";
    }
    async function search(append = false) {
      searchAbort?.abort(); searchAbort = new AbortController();
      const request = searchAbort;
      find("[data-search-status]").textContent = "Finding issued estimates…";
      try {
        const response = await fetch(`/api/valuation/estimations?search=${encodeURIComponent(find("[data-estimate-query]").value)}&offset=${append ? offset : 0}`, { signal: request.signal });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "Search failed");
        if (request.signal.aborted) return;
        items = append ? [...items, ...data.items] : data.items; offset = data.nextOffset;
        find("[data-estimate-results]").innerHTML = items.map((item, index) => `<button type="button" class="secondary construction-search-result" data-estimate-index="${index}"><strong>${escape(item.taskCode)}</strong><span>${escape(item.customerName)} · ${escape(item.institutionName)} · ${escape(item.branch)}</span><span>${escape(item.propertyBrief)}</span></button>`).join("");
        find("[data-search-status]").textContent = items.length ? "Select an estimate to review its components." : "No issued estimates found. You can enter costs manually.";
        find("[data-load-more]").hidden = !data.hasMore;
        summary.querySelectorAll("[data-estimate-index]").forEach((button) => button.onclick = () => load(items[Number(button.dataset.estimateIndex)]));
      } catch (error) { if (!request.signal.aborted) find("[data-search-status]").textContent = error.message; }
    }
    async function load(item) {
      searchAbort?.abort(); searchAbort = new AbortController(); const request = searchAbort;
      find("[data-search-status]").textContent = "Loading estimation components…";
      try {
        const response = await fetch(`/api/valuation/estimations/${encodeURIComponent(item.taskCode)}?snapshotId=${encodeURIComponent(item.snapshotId)}`, { signal: request.signal });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load estimate");
        if (request.signal.aborted) return;
        selected = data;
        const host = find("[data-source-components]"); host.hidden = false;
        host.innerHTML = `<p class="hint">Choose the components for this valuation. Final estimated totals are already combined; they will not be multiplied again.</p>${data.components.map((item, index) => `<label class="construction-source-option"><input type="checkbox" data-source-index="${index}" ${item.source === "common" ? "" : "checked"}>${escape(item.label)} · ${escape(global.ValuationUI.money(item.estimatedCost))}</label>`).join("")}<button type="button" class="secondary" data-adopt-estimate>Use selected components</button>`;
        host.querySelector("[data-adopt-estimate]").onclick = adopt;
        host.querySelectorAll("[data-source-index]").forEach((control) => { control.dataset.wired = "1"; });
        find("[data-search-status]").textContent = "Review the selection, then use selected components.";
      } catch (error) { if (!request.signal.aborted) find("[data-search-status]").textContent = error.message; }
    }
    function adopt() {
      const chosen = [...summary.querySelectorAll("[data-source-index]:checked")].map((control) => selected.components[Number(control.dataset.sourceIndex)]);
      if (!chosen.length) { alert("Select at least one component."); return; }
      if (!options.beforeEdit()) return;
      if (rows.some((row) => String(row.amount).trim()) && !confirm("Replace the adopted estimated-cost entries with this selection? The source estimate stays unchanged.")) return;
      const floors = chosen.filter((item) => item.hasBuildingConfiguration || item.source !== "common").map((item) => ({ name: item.label, count: item.floorCount || 1, basis: (item.floorCount || 1) > 1 ? "per_floor" : "combined", source_id: item.id }));
      if (floors.length && !options.configure(floors)) return;
      reference = { taskCode: selected.taskCode, snapshotId: selected.snapshotId, snapshotNumber: selected.snapshotNumber, revisionId: selected.revisionId };
      rows = chosen.map((item) => ({ id: item.id, label: item.label, amount: String(item.estimatedCost) }));
      renderRows(); find("[data-estimate-search]").hidden = true; find("[data-source-components]").hidden = true;
      changed();
    }
    own(find("[data-reference-choice]"), () => {
      const searching = find("[data-reference-choice]").value === "search";
      if (!searching && reference.taskCode) {
        if (!options.beforeEdit()) { find("[data-reference-choice]").value = "search"; return; }
        reference = {}; changed(); // Preserve adopted amounts as editable manual values.
      }
      find("[data-estimate-search]").hidden = !searching;
      if (searching) search(); else { searchAbort?.abort(); find("[data-source-components]").hidden = true; }
    });
    own(find("[data-estimate-query]"), () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => search(), 250); }, "input");
    find("[data-load-more]").onclick = () => search(true);
    find("[data-cancel-search]").onclick = () => { searchAbort?.abort(); clearTimeout(searchTimer); find("[data-estimate-search]").hidden = true; find("[data-source-components]").hidden = true; };
    find("[data-add-cost]").onclick = () => { if (!options.beforeEdit()) return; rows.push({ id: `manual-${Date.now()}`, label: "", amount: "" }); renderRows(); changed(); };
    before.querySelector("[data-building-config]").onclick = () => { const panel = before.querySelector("[data-config-panel]"); panel.hidden = !panel.hidden; };
    before.querySelector("[data-apply-config]").onclick = () => {
      const count = Number(before.querySelector("[data-upper-count]").value);
      if (!Number.isInteger(count) || count < 0 || count > 100) { alert("Enter a whole number of upper floors from 0 to 100."); return; }
      if (!options.beforeEdit()) return;
      const names = { cellar: "Cellar", stilt: "Stilt", gf: "GF" };
      const floors = before.querySelector("[data-base-levels]").value.split(",").map((key) => ({ name: names[key], count: 1, basis: "combined" }));
      for (let i = 1; i <= count; i++) floors.push({ name: ["FF", "SF", "TF"][i - 1] || `${i}F`, count: 1, basis: "combined" });
      if (!options.configure(floors)) return;
      if (!rows.length || rows.every((row) => !String(row.amount).trim())) { rows = floorRows(); renderRows(); }
      before.querySelector("[data-config-panel]").hidden = true; changed();
    };
    if (!rows.length) rows = floorRows();
    find("[data-reference-choice]").value = reference.taskCode ? "search" : "manual";
    renderRows(); store();
    return { refresh };
  }
  global.ValuationConstruction = { install };
})(window);
