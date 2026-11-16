// Run the browser calculation functions against the same fixtures as Python.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const browser = { location: { search: "" } };
const context = vm.createContext({
  window: browser,
  URLSearchParams,
  ValuxTime: { today: () => "2026-11-13" },
  ReportData: { readOnly: false },
});
function run(file, transform = (source) => source) {
  vm.runInContext(transform(fs.readFileSync(`frontend/assets/js/pages/${file}.js`, "utf8")), context);
}
run("estimation-schema");
run("estimation-dimensions");
run("estimation-naming");
browser.EstimationOffline = { create: () => ({}) };
for (const name of ["EstimationSchema", "EstimationDimensions", "EstimationNaming"]) {
  context[name] = browser[name] || context[name];
}
for (const key of ["residential_ground", "residential_ground_centre_line"]) {
  const profile = context.EstimationDimensions.profile(key, context.EstimationSchema.ESTIMATION_WORKSHEETS[key]);
  for (const axes of [{}, { slabLength: 11, slabWidth: 8 }]) {
    const sources = {};
    const rows = context.EstimationDimensions.derive(profile, { long: 12, short: 9, columns: 4, ...axes }, {}, sources);
    const slab = rows["concrete-roof-slab"];
    assert.equal(slab.depth, undefined);
    assert.equal(slab.length, axes.slabLength ?? 12);
    assert.equal(slab.breadth, axes.slabWidth ?? 9);
    assert.match(sources["concrete-roof-slab"], /^Shared/);
  }
}
run("estimation", (source) => source.slice(0, source.indexOf('  $("previous").addEventListener'))
  + '  globalThis.estimateFixture = (fixture) => { Object.assign(state, fixture); return browserEstimateTotals(); };\n})();');
const fixtures = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(fixtures.map(context.estimateFixture)));
