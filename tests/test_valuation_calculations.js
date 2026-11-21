/** Browser calculation parity and dependency resets. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const context = vm.createContext({ window: {}, document: {} });
for (const script of ["shared.js", "valuation-calculations.js"])
  vm.runInContext(fs.readFileSync(path.join(root, "frontend/assets/js/core", script), "utf8"), context);
const engine = context.window.ValuationCalculations;
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/editable_valuation_cases.json"), "utf8"));
for (const item of cases) {
  const results = Object.fromEntries(engine.evaluate(item.kind, item.values, item.overrides).map((node) => [node.id, node.value]));
  for (const [key, expected] of Object.entries(item.expected)) assert.equal(results[key], expected, key);
}
for (const [input, expected] of [[0, 0], [499, 0], [500, 500], [501, 1000], [4542500, 4542500]])
  assert.equal(engine.roundFinal(input), expected);
const values = cases[0].values;
for (const [basis, expected] of [["per_floor", 2400000], ["combined", 1200000]]) {
  const groups = Object.fromEntries(engine.evaluate("general", {
    "construction.summary_version": "1", "property.category": "residential_land_building",
    "building.floors.1.structure_type": "rcc", "building.floors.1.plinth_area": "1000",
    "building.floors.1.replacement_rate": "1200", "building.floors.1.age": "0",
    "building.floors.1.count": "2", "building.floors.1.basis": basis,
  }, { "abstract.building": "9999999", "building.floors.1.group_value": "9999999" }).map(node => [node.id, node.value]));
  assert.equal(groups["abstract.building"], expected);
  assert.equal(groups["building.floors.1.group_value"], expected);
}
const plot = Object.fromEntries(engine.evaluate("general", {
  ...cases[3].values, "property.category": "residential_plot",
}, { "abstract.building": "750000" }).map(node => [node.id, node.value]));
assert.equal(plot["abstract.building"], 0);
assert.equal(plot["abstract.total"], 1300, "Hidden building entries must not affect a plot valuation");
const overrides = { "land.estimated_value": "2000000", "abstract.extra": "1000",
  "valuation.present_market_value": "2500000", "valuation.distress_value": "1800000" };
let nodes = engine.evaluate("general", values, overrides);
engine.invalidate(overrides, nodes, "owner.details");
assert.equal(Object.keys(overrides).length, 4, "Unrelated edits preserve all adjustments");
engine.invalidate(overrides, nodes, "land.adopted_rate_value");
assert.deepEqual(overrides, { "abstract.extra": "1000" }, "Rate changes reset only affected descendants");
nodes = engine.evaluate("general", values, overrides);
engine.invalidate(overrides, nodes, "extra.item_1");
// The source list reflects the real dynamic row controls, not just populated fields.
nodes = engine.evaluate("general", { ...values, "extra.item_1": "" }, overrides);
engine.invalidate(overrides, nodes, "extra.item_1");
assert.equal(Object.keys(overrides).length, 0);
console.log("Browser valuation arithmetic and dependency checks passed");
