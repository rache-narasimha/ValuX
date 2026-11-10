/** Editable measurement defaults and reference-workbook geometry for standard sheets. */
(function (root) {
  "use strict";

  const storageKey = "storage_shed";
  const hallKeys = new Set([storageKey, "heavy_machinery_hall", "normal_machinery_hall", "commercial_shed_hall"]);

  const geometryFields = new Set([
    "long", "short", "longCount", "shortCount", "columns", "measuredPerimeter",
    "slabLength", "slabWidth",
    "ceilingLength", "ceilingWidth", "coatLength", "coatWidth", "plasterRun", "floorLength", "floorWidth",
  ]);

  const wallLayers = [
    ["excavation", "Wall excavation"], ["pcc", "Wall PCC"],
    ["masonry-foundation", "Foundation masonry"], ["masonry-basement", "Basement masonry"],
    ["concrete-plinth", "Plinth beams"], ["concrete-lintel", "Lintels"],
    ["concrete-roof", "Roof beams"], ["brick", "Masonry"],
  ];
  const starterRooms = ["Hall", "Reception", "Kitchen", "Lift and Staircase Room", "Room", "Office Room", "Toilet", "Passage"];

  function profile(key, schema) {
    const ids = new Set(schema.items().flatMap((item) => item.rows.map((row) => row.id)));
    const shed = hallKeys.has(key);
    const storage = key === storageKey;
    const centre = ids.has("brick-centre-1");
    const layers = centre ? wallLayers.filter(([id]) => ids.has(`${id}-centre-1`)) : [];
    const groups = [];
    const lowest = ids.has("concrete-footings");
    const centreSteel = centre ? {
      "steel-columns": lowest ? 100 : 150,
      "steel-roof-slab": lowest ? 70 : 100,
    } : {};
    function group(label, definitions) {
      if (!definitions.length) return;
      groups.push({ label, fields: definitions.map(([id, label, value, kind]) => ({ id, label, value, kind, geometry: geometryFields.has(id) || id.startsWith("perimeter-") })) });
    }
    const dims = (prefix, label, values) => values.map((value, index) => [
      prefix + ["Length", "Width", "Depth"][index], label + [" length (m)", " width (m)", " depth / height (m)"][index], value,
    ]);
    group("Building dimensions", [
      ["long", centre ? "Outside length (m)" : "Long wall, outside to outside (m)", "", centre ? "" : "required"],
      ["short", centre ? "Outside width (m)" : "Short wall, outside to outside (m)", "", centre ? "" : "required"],
      ...(!centre && !storage ? [["longCount", "Number of long walls", 2, "count"], ["shortCount", "Number of short walls", 2, "count"]] : []),
      ["columns", "Number of columns", "", "required-count"], ["wall", "Wall thickness (m)", 0.23],
      ...(shed ? [["brickHeight", "Measured average brickwork height (m)", "", "required"]] : []),
      ...(ids.has("concrete-roof-slab") ? [
        ["slabLength", "Roof slab length (m)", ""], ["slabWidth", "Roof slab width (m)", ""],
      ] : []),
    ]);
    group("Exterior perimeter overrides by layer", layers.map(([id, label]) =>
      [`perimeter-${id}`, `${label} perimeter override (m)`, ""]));
    group("Excavation, foundation and filling", ids.has("excavation-total") ? [
      ["excWidth", "Wall excavation width (m)", 0.90], ["excDepth", "Wall excavation depth (m)", shed ? 2.10 : 1.15],
      ...dims("pit", "Column pit", [1.20, 1.20, shed ? 2.10 : 2.12]),
      ["pccDepth", "Wall PCC thickness (m)", shed ? 0.30 : 0.15],
      ["pitPccDepth", "Column-pit PCC thickness override (m)", centre ? 0.30 : ""],
      ["foundationWidth", "Foundation masonry width (m)", 0.60], ["foundationDepth", "Foundation masonry depth (m)", shed ? 1.80 : 1],
      ["basementWidth", "Basement masonry width (m)", 0.45], ["basementDepth", "Basement masonry height (m)", shed ? 0.91 : 1],
      ...(shed ? [["fillDepth", "Filling depth (m)", 0.76]] : []),
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
        ...(!storage ? [["roofShortCount", "Number of short roof beams", 0, "count"]] : [])] : []),
    ]);
    group("Steel reinforcement", [
      ...(ids.has("steel-roof-slab") ? [["slabDepth", "Roof slab thickness for steel (m)", 0.125]] : []),
      ...schema.items().flatMap((item) => item.rows).filter((row) => row.id.startsWith("steel-") && row.sourceId)
        .map((row) => [row.id, `${row.label} steel (kg/m³)`, centreSteel[row.id] ?? row.multiplier ?? 80]),
    ]);
    group("Masonry, plaster and flooring", [
      ["brickWidth", "Brickwork thickness override (m)", ""],
      ...(!shed ? [["brickHeight", "Brickwork height (m)", 3.50]] : []),
      ...(storage ? [["brickRun", "Storage Shed brickwork run override (m)", ""], ["lintelRun", "Storage Shed lintel run override (m)", ""]] : []),
      ...(!shed ? [["brickDeduction", "Brickwork opening deduction (%)", 10, "percent"]] : []),
      ...(ids.has("ceiling-beams") ? [
        ["ceilingLength", "Ceiling length override (m)", ""], ["ceilingWidth", "Ceiling width override (m)", ""],
        ["ceilingAllowance", "Ceiling beam allowance (%)", 25, "percent"],
        ...(ids.has("ceiling-net") ? [["ceilingDeduction", "Ceiling opening deduction (%)", centre ? 0 : 10, "percent"]] : []),
        ["coatLength", "Roof coating length override (m)", ""], ["coatWidth", "Roof coating width override (m)", ""],
      ] : []),
      ...(centre && ids.has("ceiling-inside") ? [["roomHeight", "Default room plaster height (m)", 3]] : []),
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
    return { ids, groups, shed, storage, centre, layers };
  }

  function derive(definition, values, additions = {}, reviewSources = {}) {
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
    const slabLength = v.slabLength ?? long;
    const slabWidth = v.slabWidth ?? short;
    const lc = long == null ? null : long - wall;
    const sc = short == null ? null : short - wall;
    const measuredPerimeter = centre ? optionalNumber(values.measuredPerimeter, "the saved exterior perimeter") : null;
    if (measuredPerimeter === 0) throw new Error("Enter a positive exterior perimeter override.");
    if (measuredPerimeter == null && (wall <= 0 || long == null || short <= 2 * wall || long <= 2 * wall || (!centre && long < short))) {
      throw new Error(centre ? "Enter outside length, outside width and wall thickness to calculate the centre-line perimeter." : "Enter positive wall dimensions with the long side at least as long as the short side and the short side greater than twice the wall thickness.");
    }
    const perimeter = measuredPerimeter ?? 2 * (lc + sc);
    const rows = {};
    function set(id, fields) { if (ids.has(id)) rows[id] = fields; }
    function measure(id, no, length, breadth, depth, source) {
      if (!ids.has(id)) return;
      if ([length, breadth, depth].some((value) => value != null && value < 0)) throw new Error("The selected dimensions produce a negative measurement. Check the wall runs and widths.");
      set(id, { no, length, breadth, depth });
      if (source) reviewSources[id] = source;
    }
    const foundationRun = perimeter - (v.excWidth - v.foundationWidth);
    const basementRun = foundationRun - (v.foundationWidth - v.basementWidth);
    const plinthWidth = v.plinthWidth ?? v.basementWidth;
    const lintelRun = v.lintelRun ?? basementRun - (plinthWidth - v.lintelWidth) - long;
    const brickRun = v.brickRun ?? perimeter - long;
    const brickWidth = v.brickWidth ?? wall;
    const crosswalls = centre ? (values.wallRuns || legacyWallRuns(values)) : [];
    const layerWidths = {
      excavation: v.excWidth, pcc: v.excWidth, "masonry-foundation": v.foundationWidth,
      "masonry-basement": v.basementWidth, "concrete-plinth": plinthWidth,
      "concrete-lintel": v.lintelWidth, "concrete-roof": v.roofBeamWidth ?? v.lintelWidth, brick: brickWidth,
    };
    const wallSchedules = crosswalls.map((run) => wallSchedule(run, definition.layers, layerWidths));
    function scheduledRow(prototype, index, id, label, fields, instanceBase = id) {
      if (ids.has(prototype) && index <= 6) {
        rows[prototype] = { ...fields, setupLabel: label };
      } else if (ids.has(id)) {
        const rowId = `setup-${instanceBase}-${index}`;
        (additions[id] ||= []).push({ id: rowId, label });
        rows[rowId] = fields;
      }
    }

    function runs(id, width, depth, allRound, longCount = v.longCount, shortCount = v.shortCount) {
      const inheritedWidth = {
        pcc: "Width from wall excavation",
        "concrete-plinth": v.plinthWidth == null ? "Width from basement masonry" : "Manual width override",
        "concrete-roof": v.roofBeamWidth == null ? "Width from lintel" : "Manual width override",
        brick: v.brickWidth == null ? "Width from wall thickness" : "Manual width override",
      }[id];
      const source = (basis) => [basis, inheritedWidth].filter(Boolean).join(" · ");
      if (storage) {
        measure(`${id}-long`, longCount ?? 1, allRound, width, depth, source("Storage Shed run"));
        measure(`${id}-short`, 0, 0, 0, 0);
      } else if (centre) {
        if (!ids.has(`${id}-centre-1`)) return;
        measure(`${id}-centre-1`, 1, v[`perimeter-${id}`] ?? perimeter, width, depth,
          source(v[`perimeter-${id}`] != null || measuredPerimeter != null ? "Manual perimeter override" : "Exterior centre-line perimeter"));
        for (const run of wallSchedules) {
          if (!run.lengths.has(id)) continue;
          const length = run.lengths.get(id);
          const rowId = ids.has(`${id}-centre-${run.slot + 1}`) && run.slot <= 6
            ? `${id}-centre-${run.slot + 1}` : `setup-${id}-centre-2-${run.slot}`;
          reviewSources[rowId] = source(run.overrides?.[id] != null && run.overrides[id] !== "" ? "Manual wall-run override" : "Wall Runs schedule");
          scheduledRow(`${id}-centre-${run.slot + 1}`, run.slot, `${id}-centre-2`, run.label,
            { no: run.count, length, breadth: width, depth });
        }
      } else {
        measure(`${id}-long`, longCount, lc + width, width, depth, source("Long centre line + stage width"));
        measure(`${id}-short`, shortCount, sc - width, width, depth, source("Short centre line − stage width"));
      }
    }
    if (ids.has("excavation-total")) {
      runs("excavation", v.excWidth, v.excDepth, perimeter);
      runs("pcc", v.excWidth, v.pccDepth, perimeter);
      measure(centre ? "excavation-centre-8" : "excavation-columns", columns, v.pitLength, v.pitWidth, v.pitDepth);
      measure(centre ? "pcc-centre-8" : "pcc-columns", columns, v.pitLength, v.pitWidth, v.pitPccDepth ?? v.pccDepth,
        v.pitPccDepth == null ? "Pit dimensions · Thickness from wall PCC" : "Pit dimensions · Column-pit PCC thickness");
      runs("masonry-foundation", v.foundationWidth, v.foundationDepth, foundationRun);
      runs("masonry-basement", v.basementWidth, v.basementDepth, basementRun);
      const fillLength = storage ? lc : shed ? long + v.excWidth - v.fillOffset : slabLength;
      const fillWidth = storage ? sc : shed ? short - v.excWidth + v.fillOffset : slabWidth;
      const fillDepth = v.fillDepth ?? v.basementDepth;
      measure("filling-basement", 1, fillLength, fillWidth, fillDepth,
        shed ? "Shed filling dimensions" : "Shared roof slab · Depth from basement masonry");
    }
    measure("concrete-footings", columns, v.footingLength ?? v.pitLength, v.footingWidth ?? v.pitWidth, v.footingDepth,
      v.footingLength == null && v.footingWidth == null ? "Length and width from column pit" : "Footing dimensions with manual override");
    measure("concrete-pedestals", columns, v.pedestalLength, v.pedestalWidth, v.pedestalDepth);
    runs("concrete-plinth", plinthWidth, v.plinthDepth, basementRun + plinthWidth - v.basementWidth);
    measure("concrete-columns", columns, v.columnLength, v.columnWidth, v.columnDepth);
    runs("concrete-lintel", v.lintelWidth, v.lintelDepth, lintelRun);
    const roofBeamWidth = v.roofBeamWidth ?? v.lintelWidth;
    runs("concrete-roof", roofBeamWidth, v.roofBeamDepth, lintelRun,
      shed ? v.roofLongCount : v.longCount, shed ? v.roofShortCount : v.shortCount);

    measure("concrete-roof-slab", 1, slabLength, slabWidth,
      v.slabLength == null || v.slabWidth == null ? "Shared slab · Blank axes use outside dimensions" : "Shared roof slab dimensions");
    for (const { fields } of definition.groups) for (const { id } of fields) {
      if (id === "steel-roof-slab") {
        set(id, { factor: v[id] * v.slabDepth, steelRate: v[id], slabDepth: v.slabDepth });
      } else if (id.startsWith("steel-")) set(id, { factor: v[id] });
    }
    runs("brick", brickWidth, v.brickHeight, brickRun);
    set("brick-net", { factor: shed ? 1 : 1 - v.brickDeduction / 100 });
    const legacyBasis = values.ceilingBasis;
    const rooms = ids.has("ceiling-inside")
      ? (values.rooms || []).map((room) => roomQuantity(room, v.roomHeight ?? values.roomHeight ?? 3, values.roomCeiling !== false, legacyBasis, centre))
      : [];
    function addRoom(anchor, room, fields) {
      const id = `setup-${anchor}-${room.slot}`;
      (additions[anchor] ||= []).push({ id, label: room.label });
      rows[id] = fields;
    }

    if (rooms.some((room) => room.ceiling)) {
      set("ceiling-inside", { setupOmitted: true });
      for (const room of rooms) if (room.ceiling) addRoom("ceiling-inside", room, room.ceiling);
    } else {
      measure("ceiling-inside", 1, v.ceilingLength ?? slabLength, v.ceilingWidth ?? slabWidth, undefined,
        v.ceilingLength != null || v.ceilingWidth != null ? "Shared slab with manual override" : "Shared roof slab dimensions");
    }
    set("ceiling-beams", { factor: v.ceilingAllowance / 100 });
    set("ceiling-net", { factor: 1 - v.ceilingDeduction / 100 });
    measure("waterproofing-roof", 1, v.coatLength ?? slabLength, v.coatWidth ?? slabWidth, undefined,
        v.coatLength != null || v.coatWidth != null ? "Shared slab with manual override" : "Shared roof slab dimensions");

    const plasterRooms = rooms.filter((room) => room.plaster);
    if (centre) {
      if (plasterRooms.length && legacyBasis === undefined) {
        for (let slot = 1; slot <= 6; slot += 1) set(`plaster-space-${slot}`, { setupOmitted: true });
      }
      for (const room of plasterRooms) {
        const anchor = legacyBasis === undefined ? "plaster-space-6" : "plaster-space-1";
        scheduledRow(`plaster-space-${room.slot}`, room.slot, anchor, room.label, room.plaster, "plaster-space-1");
      }
    } else if (plasterRooms.length) {
      set("plaster-gross", { setupOmitted: true });
      for (const room of plasterRooms) addRoom("plaster-gross", room, room.plaster);
    } else {
      const wallRun = lc * v.longCount + sc * v.shortCount;
      measure("plaster-gross", v.plasterFaces, v.plasterRun ?? (storage ? brickRun : shed ? wallRun / 2 : wallRun), null, v.plasterHeight ?? v.brickHeight);
    }
    set("plaster-net", { factor: 1 - v.plasterDeduction / 100 });
    measure("flooring", 1, v.floorLength ?? (shed ? long - 2 * wall : slabLength), v.floorWidth ?? (shed ? short - 2 * wall : slabWidth), v.floorDepth,
      v.floorLength != null || v.floorWidth != null ? "Flooring with manual override" : shed ? "Inside building footprint" : "Shared roof slab dimensions");

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

  function optionalNumber(value, label, { count = false } = {}) {
    if (value == null || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || (count && !Number.isInteger(number))) throw new Error(`Check ${label}.`);
    return number;
  }

  function legacyWallRuns(values) {
    return Array.from({ length: 6 }, (_, index) => ({
      slot: index + 1, label: `CW${index + 1}`, count: values[`centre${index + 1}`] ? 1 : "",
      length: values[`centre${index + 1}`] ?? "",
    }));
  }

  function wallSchedule(run, layers, widths) {
    const label = String(run.label || `CW${run.slot}`).trim() || `CW${run.slot}`;
    const count = optionalNumber(run.count, `${label} count`, { count: true });
    let length = optionalNumber(run.length, `${label} length`);
    const lengths = new Map();
    if (count == null && length == null && !Object.values(run.overrides || {}).some((value) => value !== "")) return { ...run, label, lengths };
    if (!(count > 0) || !(length > 0)) throw new Error(`Enter a positive count and length for ${label}.`);
    const linkedLayers = {
      "masonry-foundation": ["pcc", "excavation"],
      "masonry-basement": ["masonry-foundation"],
      "concrete-lintel": ["concrete-plinth"],
    };
    let prior = "";
    for (const [id, name] of layers) {
      if (run.layers && !run.layers.includes(id)) continue;
      const override = optionalNumber(run.overrides?.[id], `${label} ${name.toLowerCase()} length`);
      if (override != null) length = override;
      else if (run.adjust !== false && linkedLayers[id]?.includes(prior)) length += widths[prior] - widths[id];
      if (length < 0) throw new Error(`Check the adjusted ${name.toLowerCase()} length for ${label}.`);
      lengths.set(id, length);
      prior = id;
    }
    return { ...run, label, count, lengths };
  }

  function roomQuantity(room, defaultHeight, roomCeiling, legacyBasis, centre) {
    const label = String(room.label || `Space ${room.slot}`).trim() || `Space ${room.slot}`;
    const count = optionalNumber(room.count, `${label} count`, { count: true });
    const length = optionalNumber(room.length, `${label} length`);
    const width = optionalNumber(room.width, `${label} width`);
    const ceilingArea = optionalNumber(room.ceilingArea, `${label} ceiling area`);
    const wallArea = optionalNumber(room.wallArea, `${label} wall area`);
    const height = optionalNumber(room.height, `${label} plaster height`) ?? optionalNumber(defaultHeight, "the default room plaster height") ?? 3;
    if ([count, length, width, ceilingArea, wallArea].every((value) => value == null)) return { ...room, label, ceiling: null, plaster: null };
    if (!(count > 0)) throw new Error(`Enter the number of matching spaces for ${label}.`);
    const rectangle = length != null && width != null;
    const ceilingEnabled = roomCeiling && (legacyBasis === undefined || (legacyBasis === "rooms" && room.ceiling !== false));
    const plasterEnabled = legacyBasis === undefined || (centre && room.plaster !== false);
    if (ceilingEnabled && ceilingArea == null && !rectangle) throw new Error(`Enter dimensions or a ceiling area for ${label}.`);
    if (plasterEnabled && wallArea == null && (!rectangle || height == null)) throw new Error(`Enter dimensions and plaster height, or a wall area for ${label}.`);
    return {
      ...room, label,
      ceiling: !ceilingEnabled ? null : ceilingArea != null
        ? { no: count, length: null, breadth: null, setupQuantity: count * ceilingArea }
        : { no: count, length, breadth: width },
      plaster: !plasterEnabled ? null : wallArea != null
        ? { setupQuantity: count * wallArea }
        : { no: count, length: 2 * (length + width), depth: height },
    };
  }

  function rowChanges(row, input, storage) {
    if (storage && (row.id === "truss-a" || row.id.endsWith("-short"))) return { hidden: true };
    const changes = storage && row.id.endsWith("-long")
      ? { label: row.id === "brick-long" ? "Measured brickwork run" : row.id === "concrete-lintel-long" ? "Measured lintel run" : "All-round building" }
      : {};
    if (input?.setupLabel) changes.label = input.setupLabel;
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

  root.EstimationDimensions = { profile, derive, rowChanges, legacyWallRuns, starterRooms };
})(globalThis);
