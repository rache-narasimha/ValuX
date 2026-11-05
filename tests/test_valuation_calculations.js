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
