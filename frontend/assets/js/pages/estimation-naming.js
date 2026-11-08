/** Estimation display labels mirrored by estimation/presentation.py. */
(function (global) {
  "use strict";
  const floorKeys = ["cellar", "stilt", "ground", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
  const abbreviations = {cellar: "Cellar", stilt: "Stilt", ground: "GF", first: "FF", second: "SF", third: "TF", fourth: "4F", fifth: "5F", sixth: "6F", seventh: "7F", eighth: "8F", ninth: "9F", tenth: "10F"};
  const modern = (state) => state.details?.identityVersion === 2 || Object.hasOwn(state.details || {}, "workAddress");
  function name(component) {
    return String(component.name || "Building").replace(/\s+/g, " ").trim()
      .replace(/^Residential Building\s*\/?\s*Block\s*(\d+)$/i, "Building $1")
      .replace(/^RCC (?:Commercial )?Building\s*(\d+)$/i, "Building $1")
      .replace(/Office\s*\/\s*Amenity Building/i, "Office Building");
  }
  function label(state, component, sheet) {
    if (!sheet) return modern(state) ? name(component) : component.name;
    if (!modern(state)) return `${component.name} - ${sheet.label}`;
    const buildings = state.components.filter((item) => item.sheets?.length).length;
    return buildings > 1 ? `${name(component)} ${sheet.typicalFloorKeys?.length > 1 ? sheet.label : abbreviations[sheet.key] || sheet.label}` : sheet.label;
  }
  function compact(state) {
    if (state.propertyType !== "residential" || state.components.length !== 1) return false;
    const sheets = state.components[0].sheets || [];
    return sheets.length > 0 && sheets.every((sheet) => Math.max(Number(sheet.level || 0), ...(sheet.typicalFloorKeys || []).map((key) => floorKeys.includes(key) ? floorKeys.indexOf(key) - 1 : 99)) <= 3);
  }
  global.EstimationNaming = {label, compact};
})(window);
