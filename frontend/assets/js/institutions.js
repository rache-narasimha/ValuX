(function () {
  "use strict";

  const STORAGE_KEY = "sln.institutions.v2";
  const DEFAULTS = [
    { type: "Bank", code: "APGB", name: "Andhra Pradesh Grameena Bank", color: "#007a3d", active: true },
    { type: "Bank", code: "BOB", name: "Bank of Baroda", color: "#f58220", active: true },
    { type: "Bank", code: "BOI", name: "Bank of India", color: "#0072bc", active: true },
    { type: "Bank", code: "BOM", name: "Bank of Maharashtra", color: "#0b5ca8", active: true },
    { type: "Bank", code: "CBOI", name: "Central Bank of India", color: "#005baa", active: true },
    { type: "Bank", code: "CUB", name: "City Union Bank", color: "#7b1b2b", active: true },
    { type: "Bank", code: "KB", name: "Karnataka Bank", color: "#7a263a", active: true },
    { type: "Bank", code: "KVB", name: "Karur Vysya Bank", color: "#7a1f5c", active: true },
    { type: "Bank", code: "PNB", name: "Punjab National Bank", color: "#a20f2d", active: true },
    { type: "Bank", code: "UBI", name: "Union Bank of India", color: "#d71920", active: true },
    { type: "Bank", code: "PUB", name: "Priyadarshini Urban Co-operative Bank Ltd., Adoni", color: "#6b4f2a", active: true },
    { type: "Bank", code: "AMF", name: "Adoni Mutual Funds", color: "#476b58", active: true },
    { type: "NBFC", code: "HDBFS", name: "HDB Financial Services Limited", color: "#ed1c24", active: true },
    { type: "NBFC", code: "TYGER", name: "Tyger Capital", color: "#e57a18", active: true },
    { type: "NBFC", code: "UGRO", name: "UGRO Capital Limited", color: "#652d90", active: true },
  ];

  function normalize(item) {
    return {
      type: item.type === "NBFC" ? "NBFC" : "Bank",
      code: String(item.code || "").trim().toUpperCase(),
      name: String(item.name || "").trim(),
      color: /^#[0-9a-f]{6}$/i.test(item.color || "") ? item.color : "#087ea4",
      active: item.active !== false,
    };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return Array.isArray(saved) ? saved.map(normalize) : DEFAULTS.map(normalize);
    } catch (_error) {
      return DEFAULTS.map(normalize);
    }
  }

  function active() { return load().filter((item) => item.active); }
  function grouped(includeInactive = false) {
    const items = includeInactive ? load() : active();
    return {
      Bank: items.filter((item) => item.type === "Bank"),
      NBFC: items.filter((item) => item.type === "NBFC"),
    };
  }
  function refreshCompatibilityView() { window.INSTITUTIONS = grouped(false); }
  function save(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.map(normalize)));
    refreshCompatibilityView();
    window.dispatchEvent(new CustomEvent("sln:institutions-changed"));
  }
  function upsert(value, originalCode = "") {
    const item = normalize(value);
    if (!item.code || !item.name) throw new Error("Institution code and name are required.");
    const items = load();
    if (items.some((candidate) => candidate.code === item.code && candidate.code !== originalCode)) {
      throw new Error("That institution code is already in use.");
    }
    const index = items.findIndex((candidate) => candidate.code === originalCode || candidate.code === item.code);
    if (index >= 0) items[index] = item;
    else items.push(item);
    save(items);
    return item;
  }
  function setActive(code, enabled) {
    const items = load();
    const item = items.find((candidate) => candidate.code === code);
    if (!item) throw new Error("Institution not found.");
    item.active = Boolean(enabled);
    save(items);
    return item;
  }
  function reset() {
    localStorage.removeItem(STORAGE_KEY);
    refreshCompatibilityView();
    window.dispatchEvent(new CustomEvent("sln:institutions-changed"));
  }

  window.InstitutionStore = { DEFAULTS, all: load, active, grouped, upsert, setActive, reset };
  refreshCompatibilityView();
})();
