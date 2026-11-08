/** Editable measurement defaults and reference-workbook geometry for standard sheets. */
(function (root) {
  "use strict";

  const storageKey = "storage_shed";
  const hallKeys = new Set([storageKey, "heavy_machinery_hall", "normal_machinery_hall", "commercial_shed_hall"]);

  function profile(key, schema) {
    const ids = new Set(schema.items().flatMap((item) => item.rows.map((row) => row.id)));
    const shed = hallKeys.has(key);
    const storage = key === storageKey;
    const centre = ids.has("brick-centre-1");
    const groups = [];
    function group(label, definitions) {
      if (!definitions.length) return;
      groups.push({ label, fields: definitions.map(([id, label, value, kind]) => ({ id, label, value, kind })) });
    }
    const dims = (prefix, label, values) => values.map((value, index) => [
      prefix + ["Length", "Width", "Depth"][index], label + [" length (m)", " width (m)", " depth / height (m)"][index], value,
    ]);
    group("Building dimensions", [
      ["long", "Long wall, outside to outside (m)", "", "required"],
      ["short", "Short wall, outside to outside (m)", "", "required"],
      ...(!centre && !storage ? [["longCount", "Number of long walls", 2, "count"], ["shortCount", "Number of short walls", 2, "count"]] : []),
      ["columns", "Number of columns", "", "required-count"], ["wall", "Wall thickness (m)", 0.23],
      ...(shed ? [["brickHeight", "Measured average brickwork height (m)", "", "required"]] : []),
      ...(centre ? Array.from({ length: 6 }, (_, index) => [`centre${index + 1}`, `Measured centre-wall run ${index + 1} (m)`, ""]) : []),
    ]);
    group("Excavation, foundation and filling", ids.has("excavation-total") ? [
      ["excWidth", "Wall excavation width (m)", 0.90], ["excDepth", "Wall excavation depth (m)", shed ? 2.10 : 1.15],
      ...dims("pit", "Column pit", [1.20, 1.20, shed ? 2.10 : 2.12]),
      ["pccDepth", "PCC thickness (m)", shed ? 0.30 : 0.15],
      ["foundationWidth", "Foundation masonry width (m)", 0.60], ["foundationDepth", "Foundation masonry depth (m)", shed ? 1.80 : 1],
      ["basementWidth", "Basement masonry width (m)", 0.45], ["basementDepth", "Basement masonry height (m)", shed ? 0.91 : 1],
      ["fillLength", "Filling length override (m)", ""], ["fillWidth", "Filling width override (m)", ""],
      ["fillDepth", shed ? "Filling depth (m)" : "Filling depth override (m)", shed ? 0.76 : ""],
      ...(shed && !storage ? [["fillOffset", "Gravel filling plan adjustment (m)", 0.76]] : []),
    ] : []);
    group("RCC concrete and reinforcement", [
      ...(ids.has("concrete-footings") ? [
        ["footingLength", "Footing length override (m)", ""], ["footingWidth", "Footing width override (m)", ""],
        ["footingDepth", "Footing thickness (m)", shed ? 0.30 : 0.15],
        ...dims("pedestal", "Pedestal", shed ? [0.90, 0.90, 0.90] : [0.45, 0.60, 0.60]),
        ["plinthWidth", "Plinth beam width override (m)", ""], ["plinthDepth", "Plinth beam depth (m)", shed ? 0.30 : 0.23],
      ] : []),
      ...dims("column", "RCC column", shed ? [0.45, 0.45, 2.25] : [0.30, 0.23, 4.35]),
      ["lintelWidth", "Lintel width (m)", 0.23], ["lintelDepth", "Lintel depth (m)", shed ? 0.30 : 0.23],
      ["roofBeamWidth", "Roof beam width override (m)", ""], ["roofBeamDepth", "Roof beam depth (m)", 0.30],
      ...(shed ? [["roofLongCount", storage ? "Roof beam perimeter runs" : "Number of long roof beams", 0, "count"],
        ...(!storage ? [["roofShortCount", "Number of short roof beams", 0, "count"]] : [])] : [
        ["slabLength", "Roof slab length override (m)", ""], ["slabWidth", "Roof slab width override (m)", ""],
        ["slabDepth", "Roof slab thickness for steel (m)", 0.125],
      ]),
      ...schema.items().flatMap((item) => item.rows).filter((row) => row.id.startsWith("steel-") && row.sourceId)
        .map((row) => [row.id, `${row.label} steel (kg/m³)`, row.multiplier ?? 80]),
    ]);
    group("Masonry, plaster and flooring", [
      ["brickWidth", "Brickwork thickness override (m)", ""],
      ...(!shed ? [["brickHeight", "Brickwork height (m)", 3.50]] : []),
      ...(storage ? [["brickRun", "Storage Shed brickwork run override (m)", ""], ["lintelRun", "Storage Shed lintel run override (m)", ""]] : []),
      ...(!shed ? [["brickDeduction", "Brickwork opening deduction (%)", 10, "percent"]] : []),
      ...(ids.has("ceiling-beams") ? [
        ["ceilingLength", "Ceiling length override (m)", ""], ["ceilingWidth", "Ceiling width override (m)", ""],
        ["ceilingAllowance", "Ceiling beam allowance (%)", 25, "percent"],
        ...(ids.has("ceiling-net") ? [["ceilingDeduction", "Ceiling opening deduction (%)", 10, "percent"]] : []),
        ["coatLength", "Roof coating length override (m)", ""], ["coatWidth", "Roof coating width override (m)", ""],
      ] : []),
      ...(!centre ? [
        ["plasterRun", "Wall plaster run override (m)", ""], ["plasterFaces", "Wall plaster faces", 2, "count"],
        ["plasterHeight", shed ? "Wall plaster height override (m)" : "Wall plaster height (m)", shed ? "" : 3],
      ] : []),
      ["plasterDeduction", "Wall plaster opening deduction (%)", 10, "percent"],
      ["floorLength", "Flooring length override (m)", ""], ["floorWidth", "Flooring width override (m)", ""],
      ...(shed || key.includes("cellar") ? [["floorDepth", "Flooring thickness (m)", storage ? 0.15 : shed ? 0.30 : ""]] : []),
    ]);
    if (shed) group("Shed roof and structural steel", [
      ...(!storage ? [["trussACount", "A-type truss count", "", "count"], ["trussASpan", "A-type truss span (m)", ""],
        ["trussAFactor", "A-type truss weight (kg/m²)", 5.22]] : []),
      ["trussLeanCount", "Lean-to truss count", "", "count"], ["trussLeanSpan", "Lean-to truss span (m)", ""],
      ["trussLeanFactor", "Lean-to truss weight (kg/m²)", 7.58], ["trussBay", "Truss bay length (m)", 4.50],
      ["trussMultiplier", "Truss weight multiplier", 1.50], ["rsjCount", "RSJ member count override", "", "count"],
      ["rsjLength", "RSJ member length (m)", ""], ["rsjFactor", "RSJ weight (kg/m)", storage ? 19.8 : 31.1],
      ...(storage ? [["roofExtra", "Roof allowance added to each plan dimension (m)", 0.50]] : [["roofSurfaces", "Number of matching roof surfaces", 1, "count"]]),
      ["roofLength", storage ? "Roof length override (m)" : "Roof surface length (m)", ""],
      ["roofWidth", storage ? "Roof width override (m)" : "Sloping width of each surface (m)", ""],
      ["roofAdditional", "Additional roof area (m²)", ""],
      ...(ids.has("heavy-foundation") ? [["machineArea", "Measured heavy machinery foundation area (m²)", ""]] : []),
    ]);
    return { ids, groups, shed, storage, centre };
  }

  function derive(definition, values) {
    const { ids, shed, storage, centre } = definition;
    const v = {};
    for (const { fields } of definition.groups) for (const { id, label, value, kind } of fields) {
      const entered = values[id] === "" && value !== "" ? value : values[id] ?? value;
      const number = entered === "" ? null : Number(entered);
      if (number === null && (kind === "required" || kind === "required-count")) throw new Error(`Enter ${label.toLowerCase()}.`);
      if (number !== null && (!Number.isFinite(number) || number < 0 || (kind === "percent" && number > 100)
        || (kind?.endsWith("count") && !Number.isInteger(number)))) throw new Error(`Check the value for ${label.toLowerCase()}.`);
      v[id] = number;
    }

    const { long, short, wall, columns } = v;
    const lc = long - wall;
    const sc = short - wall;
    const perimeter = 2 * (lc + sc);
    if (wall <= 0 || short <= 2 * wall || long < short) throw new Error("Enter positive wall dimensions with the long side at least as long as the short side and the short side greater than twice the wall thickness.");
    const rows = {};
    function set(id, fields) { if (ids.has(id)) rows[id] = fields; }
    function measure(id, no, length, breadth, depth) {
      if (!ids.has(id)) return;
      if ([length, breadth, depth].some((value) => value != null && value < 0)) throw new Error("The selected dimensions produce a negative measurement. Check the wall runs and widths.");
      set(id, { no, length, breadth, depth });
    }
    const foundationRun = perimeter - (v.excWidth - v.foundationWidth);
    const basementRun = foundationRun - (v.foundationWidth - v.basementWidth);
    const plinthWidth = v.plinthWidth ?? v.basementWidth;
    const lintelRun = v.lintelRun ?? basementRun - (plinthWidth - v.lintelWidth) - long;
    const brickRun = v.brickRun ?? perimeter - long;
    const brickWidth = v.brickWidth ?? wall;

    function runs(id, width, depth, allRound, longCount = v.longCount, shortCount = v.shortCount) {
      if (storage) {
        measure(`${id}-long`, longCount ?? 1, allRound, width, depth);
        measure(`${id}-short`, 0, 0, 0, 0);
      } else if (centre) {
        measure(`${id}-centre-1`, 1, perimeter, width, depth);
        for (let index = 1; index <= 6; index++) {
          const length = v[`centre${index}`];
          if (length !== null) measure(`${id}-centre-${index + 1}`, 1, length, width, depth);
        }
      } else {
        measure(`${id}-long`, longCount, lc + width, width, depth);
        measure(`${id}-short`, shortCount, sc - width, width, depth);
      }
    }
    if (ids.has("excavation-total")) {
      runs("excavation", v.excWidth, v.excDepth, perimeter);
      runs("pcc", v.excWidth, v.pccDepth, perimeter);
      measure(centre ? "excavation-centre-8" : "excavation-columns", columns, v.pitLength, v.pitWidth, v.pitDepth);
      measure(centre ? "pcc-centre-8" : "pcc-columns", columns, v.pitLength, v.pitWidth, v.pccDepth);
      runs("masonry-foundation", v.foundationWidth, v.foundationDepth, foundationRun);
      runs("masonry-basement", v.basementWidth, v.basementDepth, basementRun);
      const fillLength = storage ? lc : shed ? long + v.excWidth - v.fillOffset : long - 2 * wall;
      const fillWidth = storage ? sc : shed ? short - v.excWidth + v.fillOffset : short - 2 * wall;
      measure("filling-basement", 1, v.fillLength ?? fillLength, v.fillWidth ?? fillWidth, v.fillDepth ?? v.basementDepth);
    }
    measure("concrete-footings", columns, v.footingLength ?? v.pitLength, v.footingWidth ?? v.pitWidth, v.footingDepth);
    measure("concrete-pedestals", columns, v.pedestalLength, v.pedestalWidth, v.pedestalDepth);
    runs("concrete-plinth", plinthWidth, v.plinthDepth, basementRun + plinthWidth - v.basementWidth);
    measure("concrete-columns", columns, v.columnLength, v.columnWidth, v.columnDepth);
    runs("concrete-lintel", v.lintelWidth, v.lintelDepth, lintelRun);
    const roofBeamWidth = v.roofBeamWidth ?? v.lintelWidth;
    runs("concrete-roof", roofBeamWidth, v.roofBeamDepth, lintelRun,
      shed ? v.roofLongCount : v.longCount, shed ? v.roofShortCount : v.shortCount);

    const slabLength = v.slabLength ?? long;
    const slabWidth = v.slabWidth ?? short;
    measure("concrete-roof-slab", 1, slabLength, slabWidth);
    for (const { fields } of definition.groups) for (const { id } of fields) {
      if (id.startsWith("steel-")) set(id, { factor: id === "steel-roof-slab" ? v[id] * v.slabDepth : v[id] });
    }
    runs("brick", brickWidth, v.brickHeight, brickRun);
    set("brick-net", { factor: shed ? 1 : 1 - v.brickDeduction / 100 });
    measure("ceiling-inside", 1, v.ceilingLength ?? slabLength, v.ceilingWidth ?? slabWidth);
    set("ceiling-beams", { factor: v.ceilingAllowance / 100 });
    set("ceiling-net", { factor: 1 - v.ceilingDeduction / 100 });
    measure("waterproofing-roof", 1, v.coatLength ?? slabLength, v.coatWidth ?? slabWidth);
    const wallRun = lc * v.longCount + sc * v.shortCount;
    measure("plaster-gross", v.plasterFaces, v.plasterRun ?? (storage ? brickRun : shed ? wallRun / 2 : wallRun), null, v.plasterHeight ?? v.brickHeight);
    set("plaster-net", { factor: 1 - v.plasterDeduction / 100 });
    measure("flooring", 1, v.floorLength ?? (shed ? long - 2 * wall : slabLength), v.floorWidth ?? (shed ? short - 2 * wall : slabWidth), v.floorDepth);

    if (shed) {
      function truss(id, count, span, weight) {
        if (count > 0 && !(span > 0)) throw new Error("Enter the span for each truss type with a count.");
        if (count != null) measure(id, count, v.trussBay, span ?? 0, weight * v.trussMultiplier);
      }
      if (!storage) truss("truss-a", v.trussACount, v.trussASpan, v.trussAFactor);
      truss("truss-lean", v.trussLeanCount, v.trussLeanSpan, v.trussLeanFactor);
      if (v.rsjLength != null) measure("rsj-columns", v.rsjCount ?? columns, v.rsjLength, v.rsjFactor, 1);
      const roofLength = v.roofLength ?? (storage ? long + v.roofExtra : null);
      const roofWidth = v.roofWidth ?? (storage ? short + v.roofExtra : null);
      if ((roofLength == null) !== (roofWidth == null)) throw new Error("Enter both roof surface dimensions.");
      const roofCount = storage ? 1 : v.roofSurfaces;
      if (v.roofAdditional > 0) {
        set("galvalume-roofing", { quantity: roofCount * (roofLength ?? 0) * (roofWidth ?? 0) + v.roofAdditional });
      } else if (roofLength != null) {
        measure("galvalume-roofing", roofCount, roofLength, roofWidth, 1);
      }
      if (v.machineArea != null) set("heavy-foundation", { quantity: v.machineArea });
    }
    return rows;
  }

  function rowChanges(row, input, storage) {
    if (storage && (row.id === "truss-a" || row.id.endsWith("-short"))) return { hidden: true };
    const changes = storage && row.id.endsWith("-long")
      ? { label: row.id === "brick-long" ? "Measured brickwork run" : row.id === "concrete-lintel-long" ? "Measured lintel run" : "All-round building" }
      : {};
    const factor = input?.factor ?? (storage && row.id === "brick-net" ? 1 : null);
    if (row.calculation === "percentage" && factor != null) {
      if (row.id === "ceiling-beams") changes.label = `Add ${percent(factor)}% for beams`;
      else changes.label = factor === 1 ? "Total measured quantity" : `Net with ${percent(1 - factor)}% deduction for openings`;
      changes.percentage = factor;
    }
    if (["galvalume-roofing", "heavy-foundation"].includes(row.id) && input?.quantity != null) {
      Object.assign(changes, { calculation: "manual_quantity_rate", rate: true, customizable: false });
    }
    return changes;
  }

  function percent(fraction) { return Number((fraction * 100).toFixed(4)); }

  root.EstimationDimensions = { profile, derive, rowChanges };
})(globalThis);
