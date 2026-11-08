import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile } from "@oai/artifact-tool";

import {
  createTemplate,
  industrialExtraItems,
  residentialGroundExtras,
  residentialStiltExtras,
  residentialUpperExtras,
} from "../../estimation_template_development/build_estimation_templates.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const outputDirectory = path.join(appRoot, "resources", "estimation");

const previousWindow = globalThis.window;
globalThis.window = {};
await import("../frontend/assets/js/pages/estimation-schema.js");
const schema = globalThis.window.EstimationSchema;
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;

const cellarMiscellaneous = ["Miscellaneous Expenses and Tools and Plant Charges"];
const commercialStiltExtras = industrialExtraItems.filter((item) => item !== "Interiors and Wardrobes");
const industrialUpperExtras = residentialUpperExtras.filter(
  (item) => item !== "Kitchen Cabinet" && item !== "False Ceiling with Plaster of Paris",
);

const templates = [
  ["heavy_machinery_hall", "T01 Heavy Hall", { type: "hall", heavy: true, tabColor: "#548235" }],
  ["normal_machinery_hall", "T02 Normal Hall", { type: "hall", heavy: false, tabColor: "#70AD47" }],
  ["commercial_shed_hall", "T03 Commercial Shed", { type: "hall", heavy: false, tabColor: "#70AD47" }],
  ["industrial_cellar", "T04 Ind Cellar", { type: "cellar", extras: industrialExtraItems, tabColor: "#8064A2" }],
  ["industrial_stilt", "T05 Ind Stilt", { type: "ground", extras: residentialStiltExtras, tabColor: "#A5A5A5" }],
  ["rcc_ground", "T06 Ind Ground", { type: "ground", extras: industrialExtraItems, tabColor: "#4472C4" }],
  ["rcc_upper", "T07 Ind Upper", { type: "upper", extras: industrialUpperExtras, tabColor: "#5B9BD5" }],
  ["commercial_rcc_cellar", "T08 Com Cellar", { type: "cellar", extras: cellarMiscellaneous, tabColor: "#8064A2" }],
  ["commercial_rcc_stilt", "T09 Com Stilt", { type: "ground", extras: commercialStiltExtras, tabColor: "#A5A5A5" }],
  ["commercial_rcc_ground", "T10 Com Ground", { type: "ground", extras: industrialExtraItems, tabColor: "#4472C4" }],
  ["commercial_rcc_upper", "T11 Com Upper", { type: "upper", extras: industrialUpperExtras, tabColor: "#5B9BD5" }],
  ["residential_cellar", "T12 Res Cellar", { type: "cellar", extras: cellarMiscellaneous, tabColor: "#8064A2" }],
  ["residential_stilt", "T13 Res Stilt", { type: "ground", extras: residentialStiltExtras, tabColor: "#A5A5A5" }],
  ["residential_ground", "T14 Res Ground", { type: "ground", extras: residentialGroundExtras, tabColor: "#4472C4" }],
  ["residential_upper", "T15 Res Upper", { type: "upper", extras: residentialUpperExtras, tabColor: "#5B9BD5" }],
  ["commercial_rcc_cellar_centre_line", "T16 Com CL Cellar", { type: "cellar", extras: cellarMiscellaneous, measurementMethod: "centre_line", tabColor: "#8064A2" }],
  ["commercial_rcc_stilt_centre_line", "T17 Com CL Stilt", { type: "ground", extras: commercialStiltExtras, measurementMethod: "centre_line", tabColor: "#A5A5A5" }],
  ["commercial_rcc_ground_centre_line", "T18 Com CL Ground", { type: "ground", extras: industrialExtraItems, measurementMethod: "centre_line", tabColor: "#4472C4" }],
  ["commercial_rcc_upper_centre_line", "T19 Com CL Upper", { type: "upper", extras: industrialUpperExtras, measurementMethod: "centre_line", tabColor: "#5B9BD5" }],
  ["residential_cellar_centre_line", "T20 Res CL Cellar", { type: "cellar", extras: cellarMiscellaneous, measurementMethod: "centre_line", tabColor: "#8064A2" }],
  ["residential_stilt_centre_line", "T21 Res CL Stilt", { type: "ground", extras: residentialStiltExtras, measurementMethod: "centre_line", tabColor: "#A5A5A5" }],
  ["residential_ground_centre_line", "T22 Res CL Ground", { type: "ground", extras: residentialGroundExtras, measurementMethod: "centre_line", tabColor: "#4472C4" }],
  ["residential_upper_centre_line", "T23 Res CL Upper", { type: "upper", extras: residentialUpperExtras, measurementMethod: "centre_line", tabColor: "#5B9BD5" }],
];

const specs = templates.map(([key, name, settings]) => ({
  name,
  componentName: schema.ESTIMATION_WORKSHEETS[key].label,
  templateKey: key,
  ...settings,
}));

await fs.mkdir(outputDirectory, { recursive: true });

const master = await createTemplate({
  fileName: "estimation_detail_masters.xlsx",
  separateAbstract: true,
  compactAbstract: false,
  specs,
  renderPreviews: false,
  writeOutput: false,
  quiet: true,
});
const masterOutput = await SpreadsheetFile.exportXlsx(master.workbook);
await masterOutput.save(path.join(outputDirectory, "estimation_detail_masters.xlsx"));

const compact = await createTemplate({
  fileName: "estimation_compact_abstract_master.xlsx",
  separateAbstract: false,
  compactAbstract: true,
  specs: [{
    name: "Compact Detail",
    componentName: "Residential Building - Ground Floor",
    type: "ground",
    extras: residentialGroundExtras,
    tabColor: "#4472C4",
  }],
  renderPreviews: false,
  writeOutput: false,
  quiet: true,
});
const compactOutput = await SpreadsheetFile.exportXlsx(compact.workbook);
await compactOutput.save(path.join(outputDirectory, "estimation_compact_abstract_master.xlsx"));

const manifest = {
  version: 1,
  calculationTypes: schema.CALCULATION_TYPES,
  propertyTypes: schema.PROPERTY_TYPES,
  floorOptions: schema.FLOOR_OPTIONS,
  buildingConfigurations: schema.BUILDING_CONFIGURATIONS,
  worksheets: Object.fromEntries(
    Object.entries(schema.ESTIMATION_WORKSHEETS).map(([key, value]) => [key, {
      label: value.label,
      items: value.items(),
    }]),
  ),
  templates: { ...Object.fromEntries(templates.map(([key, name]) => [key, name])), storage_shed: "T02 Normal Hall" },
  commonExternalWorks: [
    "Water Supply and Sanitary Works",
    "Electrical Works",
    "Site Clearance and Land Development",
    "External Pavements and Internal Roads",
    "Fire-Fighting System",
    "Rainwater Harvesting",
    "Boundary Wall and Gates",
    "Plan Approval and Permission Charges",
    "Tools and Plant Charges",
    "Supervision Charges",
    "Contingencies and Miscellaneous Works",
  ],
};
await fs.writeFile(
  path.join(outputDirectory, "estimation_manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  status: "PASS",
  templates: templates.length,
  outputDirectory,
}, null, 2));
