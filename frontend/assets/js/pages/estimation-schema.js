/** Estimation component, worksheet, and calculation schema. */
(function () {
  "use strict";

  /*
   * This is the shared source for estimation-form behavior and workbook
   * generation. It holds the approved work-item rows for each finalized
   * Industrial, Commercial and Residential worksheet variant.
   */
  const CALCULATION_TYPES = {
    standard_4_factor: {
      label: "Four-factor measurement",
      inputs: ["no", "length", "breadth", "depth"],
      quantity: "F × G × H × I",
      amount: "J × K",
    },
    three_factor_fgh: {
      label: "Three-factor measurement (F × G × H)",
      inputs: ["no", "length", "breadth"],
      quantity: "F × G × H",
      amount: "J × K",
    },
    three_factor_fgi: {
      label: "Three-factor measurement (F × G × I)",
      inputs: ["no", "length", "depth"],
      quantity: "F × G × I",
      amount: "J × K",
    },
    count_rate: {
      label: "Count and rate",
      inputs: ["no"],
      quantity: "Manual count in F",
      amount: "F × K",
    },
    manual_quantity_rate: {
      label: "Manual quantity and rate",
      inputs: ["quantity"],
      quantity: "Manual quantity in J",
      amount: "J × K",
    },
    lump_sum: {
      label: "Lump sum",
      inputs: ["amount"],
      quantity: "Not applicable",
      amount: "Direct amount in L",
    },
    derived: {
      label: "Derived from an approved parent row",
      inputs: [],
      quantity: "Defined by parent formula",
      amount: "J × K where applicable",
    },
    heading: {
      label: "Heading",
      inputs: [],
      quantity: "Not applicable",
      amount: "Not applicable",
    },
    subtotal: {
      label: "Subtotal",
      inputs: [],
      quantity: "Sum of approved child rows",
      amount: "J × K",
    },
  };

  const PROPERTY_TYPES = {
    industrial: {
      label: "Industrial",
      description: "Factories, machinery halls, RCC buildings and utility structures.",
      construction: ["rcc", "shed", "hybrid"],
      subtypes: [{ value: "industrial_unit", label: "Industrial unit / factory" }],
      components: [
        { kind: "heavy_machinery_hall", label: "Heavy Machinery Hall", roofType: "shed", floorMode: "none" },
        { kind: "normal_machinery_hall", label: "Normal Machinery Hall", roofType: "shed", floorMode: "none" },
        { kind: "rcc_building", label: "RCC Building", roofType: "rcc", floorMode: "building" },
        { kind: "office_amenity", label: "Office / Amenity Building", roofType: "rcc", floorMode: "building" },
        { kind: "utility_structure", label: "Utility Structure", roofType: "rcc", floorMode: "building" },
        { kind: "custom", label: "Custom Industrial Component", roofType: "custom", floorMode: "custom" },
      ],
    },
    commercial: {
      label: "Commercial",
      description: "Commercial RCC buildings and shed-roof halls or warehouses.",
      construction: ["rcc", "shed", "hybrid"],
      subtypes: [
        { value: "commercial_building", label: "Commercial building" },
        { value: "lodging", label: "Lodging / hotel" },
        { value: "hospital", label: "Hospital / nursing home" },
        { value: "shop", label: "Shop / showroom" },
        { value: "warehouse", label: "Warehouse / godown" },
        { value: "other", label: "Other commercial property" },
      ],
      components: [
        { kind: "rcc_building", label: "RCC Commercial Building", roofType: "rcc", floorMode: "building" },
        { kind: "shed_hall", label: "Shed Roof Building / Hall", roofType: "shed", floorMode: "none" },
        { kind: "custom", label: "Custom Commercial Component", roofType: "custom", floorMode: "custom" },
      ],
    },
    residential: {
      label: "Residential",
      description: "Individual or apartment buildings using the approved RCC residential worksheets.",
      construction: ["rcc"],
      subtypes: [
        { value: "individual", label: "Individual building" },
        { value: "apartment", label: "Apartment building" },
      ],
      components: [
        { kind: "residential_building", label: "Residential Building / Block", roofType: "rcc", floorMode: "building" },
        { kind: "custom", label: "Custom Residential Component", roofType: "custom", floorMode: "custom" },
      ],
    },
  };

  const FLOOR_OPTIONS = [
    { level: -1, key: "cellar", label: "Cellar" },
    { level: 0, key: "stilt", label: "Stilt Floor" },
    { level: 1, key: "ground", label: "Ground Floor" },
    { level: 2, key: "first", label: "First Floor" },
    { level: 3, key: "second", label: "Second Floor" },
    { level: 4, key: "third", label: "Third Floor" },
    { level: 5, key: "fourth", label: "Fourth Floor" },
    { level: 6, key: "fifth", label: "Fifth Floor" },
    { level: 7, key: "sixth", label: "Sixth Floor" },
    { level: 8, key: "seventh", label: "Seventh Floor" },
    { level: 9, key: "eighth", label: "Eighth Floor" },
    { level: 10, key: "ninth", label: "Ninth Floor" },
    { level: 11, key: "tenth", label: "Tenth Floor" },
  ];

  const BUILDING_CONFIGURATIONS = [
    { key: "ground", label: "Ground Floor", floorKeys: ["ground"] },
    { key: "cellar_ground", label: "Cellar + Ground Floor", floorKeys: ["cellar", "ground"] },
    { key: "stilt_ground", label: "Stilt + Ground Floor", floorKeys: ["stilt", "ground"] },
    { key: "cellar_stilt_ground", label: "Cellar + Stilt + Ground Floor", floorKeys: ["cellar", "stilt", "ground"] },
  ];

  /*
   * The online form intentionally stores short, readable labels.  The final
   * workbook generator owns the approved full technical descriptions.  Every
   * row below maps to a final-template row and its approved calculation type.
   */
  const row = (id, label, calculation, options = {}) => ({ id, label, calculation, customizable: true, ...options });
  const heading = (id, label) => ({ id, label, calculation: "heading", customizable: false });
  const subtotal = (id, label, sourceGroup, options = {}) => ({ id, label, calculation: "subtotal", sourceGroup, rate: true, customizable: false, ...options });
  const derived = (id, label, sourceId, multiplier) => ({ id, label, calculation: "derived", sourceId, multiplier, group: "steel", customizable: false });
  const percentOf = (id, label, sourceGroup, percentage, options = {}) => ({ id, label, calculation: "percentage", sourceGroup, percentage, customizable: false, ...options });
  const lumpSum = (id, label) => ({ id, label, calculation: "lump_sum", customizable: true });

  const centreLineLabels = (includeColumns = false, includeCellar = false) => [
    "All-round Building",
    "Centre Wall 1",
    "Centre Wall 2",
    "Centre Wall 3",
    "Centre Wall 4",
    "Centre Wall 5",
    "Centre Wall 6",
    ...(includeColumns ? ["Columns"] : []),
    ...(includeCellar ? ["Cellar"] : []),
  ];

  const centreLineRows = (prefix, group, options = {}) => centreLineLabels(options.includeColumns, options.includeCellar)
    .map((label, index) => row(`${prefix}-centre-${index + 1}`, label, "standard_4_factor", { group, ...options }));

  const foundationItems = () => [
    { sno: 1, label: "Earth work excavation", rows: [
      row("excavation-long", "Long Walls", "standard_4_factor", { group: "excavation" }),
      row("excavation-short", "Short Walls", "standard_4_factor", { group: "excavation" }),
      row("excavation-columns", "Columns", "standard_4_factor", { group: "excavation" }),
      subtotal("excavation-total", "Total excavation quantity", "excavation"),
    ] },
    { sno: 2, label: "Plain cement concrete", rows: [
      row("pcc-long", "Long Walls", "standard_4_factor", { group: "pcc" }),
      row("pcc-short", "Short Walls", "standard_4_factor", { group: "pcc" }),
      row("pcc-columns", "Columns", "standard_4_factor", { group: "pcc" }),
      subtotal("pcc-total", "Total PCC quantity", "pcc"),
    ] },
    { sno: 3, label: "Foundation and basement masonry", rows: [
      heading("masonry-foundation-heading", "Foundation"),
      row("masonry-foundation-long", "Long Walls", "standard_4_factor", { group: "masonry" }),
      row("masonry-foundation-short", "Short Walls", "standard_4_factor", { group: "masonry" }),
      heading("masonry-basement-heading", "Basement"),
      row("masonry-basement-long", "Long Walls", "standard_4_factor", { group: "masonry" }),
      row("masonry-basement-short", "Short Walls", "standard_4_factor", { group: "masonry" }),
      subtotal("masonry-total", "Total Masonry Quantity", "masonry"),
    ] },
    { sno: 4, label: "Sand / gravel filling", rows: [
      row("filling-basement", "Basement Filling", "standard_4_factor", { group: "filling" }),
      subtotal("filling-total", "Total filling quantity", "filling"),
    ] },
  ];

  function centreLineFoundationItems(includeCellar = false) {
    return [
      { sno: 1, label: "Earth work excavation", rows: [...centreLineRows("excavation", "excavation", { includeColumns: true, includeCellar }), subtotal("excavation-total", "Total excavation quantity", "excavation")] },
      { sno: 2, label: "Plain cement concrete", rows: [...centreLineRows("pcc", "pcc", { includeColumns: true, includeCellar }), subtotal("pcc-total", "Total PCC quantity", "pcc")] },
      { sno: 3, label: "Foundation and basement masonry", rows: [
        heading("masonry-foundation-heading", "Foundation"),
        ...centreLineRows("masonry-foundation", "masonry"),
        heading("masonry-basement-heading", "Basement"),
        ...centreLineRows("masonry-basement", "masonry"),
        subtotal("masonry-total", "Total Masonry Quantity", "masonry"),
      ] },
      { sno: 4, label: "Sand / gravel filling", rows: [row("filling-basement", "Basement Filling", "standard_4_factor", { group: "filling" }), subtotal("filling-total", "Total filling quantity", "filling")] },
    ];
  }

  function hallConcreteItem() {
    return { sno: 5, label: "RCC concrete", rows: [
      row("concrete-footings", "Column Footings", "standard_4_factor", { rate: true }),
      row("concrete-pedestals", "Pedestals", "standard_4_factor", { rate: true }),
      heading("concrete-plinth-heading", "Plinth Beams"),
      row("concrete-plinth-long", "Long Walls", "standard_4_factor", { group: "concrete-plinth" }),
      row("concrete-plinth-short", "Short Walls", "standard_4_factor", { group: "concrete-plinth" }),
      subtotal("concrete-plinth", "Plinth Beams total", "concrete-plinth"),
      row("concrete-columns", "Columns", "standard_4_factor", { rate: true }),
      heading("concrete-lintel-heading", "Lintels"),
      row("concrete-lintel-long", "Long Walls", "standard_4_factor", { group: "concrete-lintel" }),
      row("concrete-lintel-short", "Short Walls", "standard_4_factor", { group: "concrete-lintel" }),
      subtotal("concrete-lintels", "Lintels total", "concrete-lintel"),
      heading("concrete-roof-heading", "Roof Beams"),
      row("concrete-roof-long", "Long Walls", "standard_4_factor", { group: "concrete-roof" }),
      row("concrete-roof-short", "Short Walls", "standard_4_factor", { group: "concrete-roof" }),
      subtotal("concrete-roof-beams", "Roof Beams total", "concrete-roof"),
    ] };
  }

  function hallItems(heavy) {
    return [
      ...foundationItems(),
      hallConcreteItem(),
      { sno: 6, label: "Steel reinforcement", rows: [
        derived("steel-footings", "Footings", "concrete-footings", 75),
        derived("steel-pedestals", "Pedestals", "concrete-pedestals", 125),
        derived("steel-columns", "Columns", "concrete-columns", 150),
        derived("steel-plinth", "Plinth Beams", "concrete-plinth", 100),
        derived("steel-lintels", "Lintels", "concrete-lintels", 75),
        derived("steel-roof-beams", "Roof Beams", "concrete-roof-beams", 100),
        subtotal("steel-total", "Total steel quantity", "steel"),
      ] },
      { sno: 7, label: "Brick masonry", rows: [
        row("brick-long", "Long Walls", "standard_4_factor", { group: "brick" }),
        row("brick-short", "Short Walls", "standard_4_factor", { group: "brick" }),
        percentOf("brick-net", "Net with 10% deduction for openings", "brick", 0.9, { rate: true }),
      ] },
      { sno: 8, label: "Wall plastering", rows: [
        row("plaster-gross", "Gross plastering area", "three_factor_fgi", { group: "plaster" }),
        percentOf("plaster-net", "Net with 10% deduction for openings", "plaster", 0.9, { rate: true }),
      ] },
      { sno: 9, label: "Flooring", rows: [row("flooring", "Flooring", "standard_4_factor", { rate: true })] },
      { sno: 10, label: "Rolling shutter / doors", rows: [row("doors", "Rolling shutters / doors", "count_rate", { rate: true })] },
      { sno: 11, label: "Windows", rows: [row("windows", "Windows", "count_rate", { rate: true })] },
      { sno: 12, label: "Structural steel work", rows: [lumpSum("structural-steel", "Structural steel work")] },
      { sno: 13, label: "Roof sheeting", rows: [lumpSum("roof-sheeting", "Roof sheeting")] },
      { sno: 14, label: "Angular trusses – A type", rows: [row("truss-a", "Angular trusses – A type", "standard_4_factor", { rate: true })] },
      { sno: null, label: "Angular trusses – lean-to type", rows: [row("truss-lean", "Angular trusses – lean-to type", "standard_4_factor", { rate: true })] },
      { sno: 15, label: "RSJ columns", rows: [row("rsj-columns", "RSJ columns", "standard_4_factor", { rate: true })] },
      { sno: 16, label: "Galvalume roofing", rows: [row("galvalume-roofing", "Galvalume roofing", "standard_4_factor", { rate: true })] },
      ...(heavy ? [{ sno: 17, label: "Heavy machinery foundation", rows: [lumpSum("heavy-foundation", "Additional Foundation Strengthening for Heavy Machinery Areas")] }] : []),
    ];
  }

  function rccConcreteItem(upperFloor) {
    const rows = [];
    if (!upperFloor) rows.push(
      row("concrete-footings", "Column Footings", "standard_4_factor", { rate: true }),
      row("concrete-pedestals", "Pedestals", "standard_4_factor", { rate: true }),
      heading("concrete-plinth-heading", "Plinth Beams"),
      row("concrete-plinth-long", "Long Walls", "standard_4_factor", { group: "concrete-plinth" }),
      row("concrete-plinth-short", "Short Walls", "standard_4_factor", { group: "concrete-plinth" }),
      subtotal("concrete-plinth", "Plinth Beams total", "concrete-plinth"),
    );
    rows.push(
      row("concrete-columns", "Columns", "standard_4_factor", { rate: true }),
      heading("concrete-lintel-heading", "Lintels"),
      row("concrete-lintel-long", "Long Walls", "standard_4_factor", { group: "concrete-lintel" }),
      row("concrete-lintel-short", "Short Walls", "standard_4_factor", { group: "concrete-lintel" }),
      subtotal("concrete-lintels", "Lintels total", "concrete-lintel"),
      heading("concrete-roof-heading", "Roof Beams"),
      row("concrete-roof-long", "Long Walls", "standard_4_factor", { group: "concrete-roof" }),
      row("concrete-roof-short", "Short Walls", "standard_4_factor", { group: "concrete-roof" }),
      subtotal("concrete-roof-beams", "Roof Beams total", "concrete-roof"),
      row("concrete-roof-slab", "Roof Slab", "three_factor_fgh", { rate: true }),
    );
    return { sno: upperFloor ? 1 : 5, label: "RCC concrete", rows };
  }

  const INDUSTRIAL_RCC_EXTRAS = [
    "Water Supply and Sanitary Arrangements",
    "Electrification Charges",
    "Interiors and Wardrobes",
    "Compound Wall with Gates",
    "Parking Tiles in the Compound",
    "Design of Front Elevation and Portico",
    "Miscellaneous Expenses and Tools and Plant Charges",
  ];

  const STILT_EXTRAS = [
    "Water Supply and Sanitary Arrangements",
    "Electrification Charges",
    "Compound Wall with Gates",
    "Parking Tiles in the Compound",
    "Design of Front Elevation and Portico",
    "False Ceiling with Plaster of Paris",
    "Miscellaneous Expenses and Tools and Plant Charges",
  ];

  const RESIDENTIAL_GROUND_EXTRAS = [
    "Water Supply and Sanitary Arrangements",
    "Electrification Charges",
    "Compound Wall with Gates",
    "Parking Tiles in the Compound",
    "Kitchen Cabinet",
    "Interiors and Wardrobes",
    "Design of Front Elevation and Portico",
    "False Ceiling with Plaster of Paris",
    "Miscellaneous Expenses and Tools and Plant Charges",
  ];

  const RESIDENTIAL_UPPER_EXTRAS = RESIDENTIAL_GROUND_EXTRAS.filter((item) => item !== "Compound Wall with Gates");
  const RESIDENTIAL_STILT_EXTRAS = RESIDENTIAL_GROUND_EXTRAS.filter((item) => item !== "Kitchen Cabinet" && item !== "Interiors and Wardrobes");
  const CELLAR_ONLY_MISC = ["Miscellaneous Expenses and Tools and Plant Charges"];
  const COMMERCIAL_STILT_EXTRAS = INDUSTRIAL_RCC_EXTRAS.filter((item) => item !== "Interiors and Wardrobes");

  function rccItems(upperFloor, extras = INDUSTRIAL_RCC_EXTRAS) {
    const rows = [
      ...(upperFloor ? [] : foundationItems()),
      rccConcreteItem(upperFloor),
      { sno: upperFloor ? 2 : 6, label: "Steel reinforcement", rows: [
        ...(!upperFloor ? [derived("steel-footings", "Footings", "concrete-footings", 75), derived("steel-pedestals", "Pedestals", "concrete-pedestals", 100)] : []),
        derived("steel-columns", "Columns", "concrete-columns", 125),
        ...(!upperFloor ? [derived("steel-plinth", "Plinth Beams", "concrete-plinth", 100)] : []),
        derived("steel-lintels", "Lintels", "concrete-lintels", 75),
        derived("steel-roof-beams", "Roof Beams", "concrete-roof-beams", 100),
        { id: "steel-roof-slab", label: "Roof Slab", calculation: "derived_expression", sourceId: "concrete-roof-slab", group: "steel", customizable: false },
        row("steel-staircase", "Staircase Slab", "manual_quantity_rate", { group: "steel" }),
        row("steel-sunshades", "Sun Shades", "manual_quantity_rate", { group: "steel" }),
        subtotal("steel-total", "Total steel quantity", "steel"),
      ] },
      { sno: upperFloor ? 3 : 7, label: "Brick masonry", rows: [
        row("brick-long", "Long Walls", "standard_4_factor", { group: "brick" }),
        row("brick-short", "Short Walls", "standard_4_factor", { group: "brick" }),
        percentOf("brick-net", "Net with 10% deduction for openings", "brick", 0.9, { rate: true }),
      ] },
      { sno: upperFloor ? 4 : 8, label: "Ceiling plastering", rows: [
        row("ceiling-inside", "Inside of Roof Area", "three_factor_fgh", { group: "ceiling" }),
        percentOf("ceiling-beams", "Add 25% for Beams", "ceiling", 0.25, { group: "ceiling-beams" }),
        percentOf("ceiling-net", "Net with 10% Deduction for Openings", "ceiling-with-beams", 0.9, { rate: true, includeSourceGroups: ["ceiling", "ceiling-beams"] }),
      ] },
      { sno: upperFloor ? 5 : 9, label: "Roof waterproofing", rows: [
        row("waterproofing-roof", "Over Roof Slab", "three_factor_fgh", { group: "waterproofing" }),
        subtotal("waterproofing-total", "Total waterproofing quantity", "waterproofing"),
      ] },
      { sno: upperFloor ? 6 : 10, label: "Wall plastering", rows: [
        row("plaster-gross", "Gross plastering area", "three_factor_fgi", { group: "plaster" }),
        percentOf("plaster-net", "Net with 10% deduction for openings", "plaster", 0.9, { rate: true }),
      ] },
      { sno: upperFloor ? 7 : 11, label: "Flooring", rows: [row("flooring", "Flooring", "three_factor_fgh", { rate: true })] },
      { sno: upperFloor ? 8 : 12, label: "Doors", rows: [row("doors", "Doors", "three_factor_fgi", { rate: true })] },
      { sno: upperFloor ? 9 : 13, label: "Windows", rows: [row("windows", "Windows", "three_factor_fgi", { rate: true })] },
      { sno: upperFloor ? 10 : 14, label: "White washing", rows: [lumpSum("whitewashing", "White washing")] },
      { sno: upperFloor ? 11 : 15, label: "Colour washing", rows: [lumpSum("colourwashing", "Colour washing")] },
      { sno: upperFloor ? 12 : 16, label: "Grill work", rows: [lumpSum("grill-work", "Grill work")] },
      { sno: upperFloor ? 13 : 17, label: "Staircase", rows: [lumpSum("staircase", "Staircase")] },
    ];
    const selectedExtras = upperFloor ? extras.filter((item) => item !== "Compound Wall with Gates") : extras;
    let sno = upperFloor ? 14 : 18;
    selectedExtras.forEach((label) => {
      const itemSno = sno++;
      rows.push({ sno: itemSno, label, rows: [lumpSum(`extra-${itemSno}`, label)] });
    });
    return rows;
  }

  function centreLineRccConcreteItem(upperFloor) {
    const rows = [];
    if (!upperFloor) rows.push(
      row("concrete-footings", "Column Footings", "standard_4_factor", { rate: true }),
      row("concrete-pedestals", "Pedestals", "standard_4_factor", { rate: true }),
      heading("concrete-plinth-heading", "Plinth Beams"),
      ...centreLineRows("concrete-plinth", "concrete-plinth"),
      subtotal("concrete-plinth", "Plinth Beams total", "concrete-plinth"),
    );
    rows.push(
      row("concrete-columns", "Columns", "standard_4_factor", { rate: true }),
      heading("concrete-lintel-heading", "Lintels"),
      ...centreLineRows("concrete-lintel", "concrete-lintel"),
      subtotal("concrete-lintels", "Lintels total", "concrete-lintel"),
      heading("concrete-roof-heading", "Roof Beams"),
      ...centreLineRows("concrete-roof", "concrete-roof"),
      subtotal("concrete-roof-beams", "Roof Beams total", "concrete-roof"),
      row("concrete-roof-slab", "Roof Slab", "three_factor_fgh", { rate: true }),
    );
    return { sno: upperFloor ? 1 : 5, label: "RCC concrete", rows };
  }

  function centreLineSteelRows(upperFloor) {
    return [
      ...(!upperFloor ? [derived("steel-footings", "Footings", "concrete-footings", 75), derived("steel-pedestals", "Pedestals", "concrete-pedestals", 100)] : []),
      derived("steel-columns", "Columns", "concrete-columns", 125),
      ...(!upperFloor ? [derived("steel-plinth", "Plinth Beams", "concrete-plinth", 100)] : []),
      derived("steel-lintels", "Lintels", "concrete-lintels", 75),
      derived("steel-roof-beams", "Roof Beams", "concrete-roof-beams", 100),
      { id: "steel-roof-slab", label: "Roof Slab", calculation: "derived_expression", sourceId: "concrete-roof-slab", group: "steel", customizable: false },
      row("steel-staircase", "Staircase Slab", "manual_quantity_rate", { group: "steel" }),
      row("steel-sunshades", "Sun Shades", "manual_quantity_rate", { group: "steel" }),
      subtotal("steel-total", "Total steel quantity", "steel"),
    ];
  }

  function centreLineRccItems(upperFloor, extras = INDUSTRIAL_RCC_EXTRAS) {
    const rows = [
      ...(upperFloor ? [] : centreLineFoundationItems()),
      centreLineRccConcreteItem(upperFloor),
      { sno: upperFloor ? 2 : 6, label: "Steel reinforcement", rows: centreLineSteelRows(upperFloor) },
      { sno: upperFloor ? 3 : 7, label: "Brick masonry", rows: [
        ...centreLineRows("brick", "brick"),
        percentOf("brick-net", "Net with 10% deduction for openings", "brick", 0.9, { rate: true }),
      ] },
      { sno: upperFloor ? 4 : 8, label: "Ceiling plastering", rows: [
        row("ceiling-inside", "Inside of Roof Area", "three_factor_fgh", { group: "ceiling" }),
        percentOf("ceiling-beams", "Add 25% for Beams", "ceiling", 0.25, { group: "ceiling-beams" }),
        percentOf("ceiling-net", "Net with 10% Deduction for Openings", "ceiling-with-beams", 0.9, { rate: true, includeSourceGroups: ["ceiling", "ceiling-beams"] }),
      ] },
      { sno: upperFloor ? 5 : 9, label: "Roof waterproofing", rows: [row("waterproofing-roof", "Over Roof Slab", "three_factor_fgh", { group: "waterproofing" }), subtotal("waterproofing-total", "Total waterproofing quantity", "waterproofing")] },
      { sno: upperFloor ? 6 : 10, label: "Wall plastering", rows: [
        ...Array.from({ length: 6 }, (_, index) => row(`plaster-space-${index + 1}`, `Room / Space ${index + 1}`, "three_factor_fgi", { group: "plaster" })),
        percentOf("plaster-net", "Net with 10% deduction for openings", "plaster", 0.9, { rate: true }),
      ] },
      { sno: upperFloor ? 7 : 11, label: "Flooring", rows: [row("flooring", "Flooring", "three_factor_fgh", { rate: true })] },
      { sno: upperFloor ? 8 : 12, label: "Doors", rows: [row("doors", "Doors", "three_factor_fgi", { rate: true })] },
      { sno: upperFloor ? 9 : 13, label: "Windows", rows: [row("windows", "Windows", "three_factor_fgi", { rate: true })] },
      { sno: upperFloor ? 10 : 14, label: "White washing", rows: [lumpSum("whitewashing", "White washing")] },
      { sno: upperFloor ? 11 : 15, label: "Colour washing", rows: [lumpSum("colourwashing", "Colour washing")] },
      { sno: upperFloor ? 12 : 16, label: "Grill work", rows: [lumpSum("grill-work", "Grill work")] },
      { sno: upperFloor ? 13 : 17, label: "Staircase", rows: [lumpSum("staircase", "Staircase")] },
    ];
    const selectedExtras = upperFloor ? extras.filter((item) => item !== "Compound Wall with Gates") : extras;
    let sno = upperFloor ? 14 : 18;
    selectedExtras.forEach((label) => rows.push({ sno: sno++, label, rows: [lumpSum(`extra-${sno - 1}`, label)] }));
    return rows;
  }

  function centreLineCellarItems(extras = CELLAR_ONLY_MISC) {
    // Cellar retains its extra cellar measurement line while Centre Line
    // replaces the wall-run subfields used by the shared RCC items.
    return [...centreLineFoundationItems(true), ...centreLineRccItems(false, extras).slice(4)];
  }

  function cellarItems(extras = INDUSTRIAL_RCC_EXTRAS) {
    const rows = [
      { sno: 1, label: "Earth work excavation", rows: [
        row("excavation-long", "Long Walls", "standard_4_factor", { group: "excavation" }),
        row("excavation-short", "Short Walls", "standard_4_factor", { group: "excavation" }),
        row("excavation-columns", "Columns", "standard_4_factor", { group: "excavation" }),
        row("excavation-cellar", "Cellar", "standard_4_factor", { group: "excavation" }),
        subtotal("excavation-total", "Total excavation quantity", "excavation"),
      ] },
      { sno: 2, label: "Plain cement concrete", rows: [
        row("pcc-long", "Long Walls", "standard_4_factor", { group: "pcc" }),
        row("pcc-short", "Short Walls", "standard_4_factor", { group: "pcc" }),
        row("pcc-columns", "Columns", "standard_4_factor", { group: "pcc" }),
        row("pcc-cellar", "Cellar", "standard_4_factor", { group: "pcc" }),
        subtotal("pcc-total", "Total PCC quantity", "pcc"),
      ] },
      foundationItems()[2],
      { sno: 4, label: "Basement filling", rows: [
        row("filling-basement", "Basement Filling", "standard_4_factor", { group: "filling" }),
        subtotal("filling-total", "Total filling quantity", "filling"),
      ] },
      rccConcreteItem(false),
      { sno: 6, label: "Steel reinforcement", rows: [
        derived("steel-footings", "Footings", "concrete-footings", 75),
        derived("steel-pedestals", "Pedestals", "concrete-pedestals", 100),
        derived("steel-columns", "Columns", "concrete-columns", 125),
        derived("steel-plinth", "Plinth Beams", "concrete-plinth", 100),
        derived("steel-lintels", "Lintels", "concrete-lintels", 75),
        derived("steel-roof-beams", "Roof Beams", "concrete-roof-beams", 100),
        { id: "steel-roof-slab", label: "Roof Slab", calculation: "derived_expression", sourceId: "concrete-roof-slab", group: "steel", customizable: false },
        row("steel-staircase", "Staircase Slab", "manual_quantity_rate", { group: "steel" }),
        row("steel-sunshades", "Sun Shades", "manual_quantity_rate", { group: "steel" }),
        subtotal("steel-total", "Total steel quantity", "steel"),
      ] },
      { sno: 7, label: "Retaining-wall brick masonry", rows: [
        row("brick-long", "Retaining Wall – Long Walls", "standard_4_factor", { group: "brick" }),
        row("brick-short", "Retaining Wall – Short Walls", "standard_4_factor", { group: "brick" }),
        percentOf("brick-net", "Net with 10% deduction for openings", "brick", 0.9, { rate: true }),
      ] },
      { sno: 8, label: "Ceiling plastering", rows: [
        row("ceiling-inside", "Inside of Roof Area", "three_factor_fgh", { group: "ceiling" }),
        percentOf("ceiling-beams", "Add 25% for Beams", "ceiling", 0.25, { group: "ceiling-beams" }),
        percentOf("ceiling-total", "Total", "ceiling-total-source", 1, { rate: true, includeSourceGroups: ["ceiling", "ceiling-beams"] }),
      ] },
      { sno: 9, label: "Roof waterproofing", rows: [
        row("waterproofing-roof", "Over Roof Slab", "three_factor_fgh", { group: "waterproofing" }),
        subtotal("waterproofing-total", "Total waterproofing quantity", "waterproofing"),
      ] },
      { sno: 10, label: "Wall plastering", rows: [
        row("plaster-gross", "Gross plastering area", "three_factor_fgi", { group: "plaster" }),
        percentOf("plaster-net", "Net with 10% deduction for openings", "plaster", 0.9, { rate: true }),
      ] },
      { sno: 11, label: "Flooring", rows: [row("flooring", "Flooring", "standard_4_factor", { rate: true })] },
      { sno: 12, label: "Doors", rows: [row("doors", "Doors", "three_factor_fgi", { rate: true })] },
      { sno: 13, label: "Windows", rows: [row("windows", "Windows", "three_factor_fgi", { rate: true })] },
      { sno: 14, label: "White washing", rows: [lumpSum("whitewashing", "White washing")] },
      { sno: 15, label: "Colour washing", rows: [lumpSum("colourwashing", "Colour washing")] },
      { sno: 16, label: "Grill work", rows: [lumpSum("grill-work", "Grill work")] },
      { sno: 17, label: "Staircase", rows: [lumpSum("staircase", "Staircase")] },
      { sno: 18, label: "Pedestrian ramp", rows: [lumpSum("pedestrian-ramp", "Pedestrian Ramp")] },
    ];
    extras.forEach((label) => rows.push({ sno: rows.length + 1, label, rows: [lumpSum(`cellar-extra-${rows.length + 1}`, label)] }));
    return rows;
  }

  const ESTIMATION_WORKSHEETS = {
    heavy_machinery_hall: { label: "Heavy Machinery Hall", items: () => hallItems(true) },
    normal_machinery_hall: { label: "Normal Machinery Hall", items: () => hallItems(false) },
    rcc_ground: { label: "RCC Building – Ground Floor", items: () => rccItems(false) },
    rcc_upper: { label: "RCC Building – Upper Floor", items: () => rccItems(true) },
    industrial_cellar: { label: "Cellar (approved cellar format)", items: () => cellarItems() },
    industrial_stilt: { label: "Stilt Floor (approved stilt format)", items: () => rccItems(false, STILT_EXTRAS) },
    commercial_shed_hall: { label: "Commercial Shed Roof Hall", items: () => hallItems(false) },
    commercial_rcc_cellar: { label: "Commercial RCC Building – Cellar Floor", items: () => cellarItems(CELLAR_ONLY_MISC) },
    commercial_rcc_stilt: { label: "Commercial RCC Building – Stilt Floor", items: () => rccItems(false, COMMERCIAL_STILT_EXTRAS) },
    commercial_rcc_ground: { label: "Commercial RCC Building – Ground Floor", items: () => rccItems(false) },
    commercial_rcc_upper: { label: "Commercial RCC Building – Upper Floor", items: () => rccItems(true) },
    residential_cellar: { label: "Residential Building – Cellar Floor", items: () => cellarItems(CELLAR_ONLY_MISC) },
    residential_stilt: { label: "Residential Building – Stilt Floor", items: () => rccItems(false, RESIDENTIAL_STILT_EXTRAS) },
    residential_ground: { label: "Residential Building – Ground Floor", items: () => rccItems(false, RESIDENTIAL_GROUND_EXTRAS) },
    residential_upper: { label: "Residential Building – Upper Floor", items: () => rccItems(true, RESIDENTIAL_UPPER_EXTRAS) },
    commercial_rcc_cellar_centre_line: { label: "Commercial RCC Building – Cellar Floor (Centre Line)", items: () => centreLineCellarItems(CELLAR_ONLY_MISC) },
    commercial_rcc_stilt_centre_line: { label: "Commercial RCC Building – Stilt Floor (Centre Line)", items: () => centreLineRccItems(false, COMMERCIAL_STILT_EXTRAS) },
    commercial_rcc_ground_centre_line: { label: "Commercial RCC Building – Ground Floor (Centre Line)", items: () => centreLineRccItems(false, INDUSTRIAL_RCC_EXTRAS) },
    commercial_rcc_upper_centre_line: { label: "Commercial RCC Building – Upper Floor (Centre Line)", items: () => centreLineRccItems(true, INDUSTRIAL_RCC_EXTRAS) },
    residential_cellar_centre_line: { label: "Residential Building – Cellar Floor (Centre Line)", items: () => centreLineCellarItems(CELLAR_ONLY_MISC) },
    residential_stilt_centre_line: { label: "Residential Building – Stilt Floor (Centre Line)", items: () => centreLineRccItems(false, RESIDENTIAL_STILT_EXTRAS) },
    residential_ground_centre_line: { label: "Residential Building – Ground Floor (Centre Line)", items: () => centreLineRccItems(false, RESIDENTIAL_GROUND_EXTRAS) },
    residential_upper_centre_line: { label: "Residential Building – Upper Floor (Centre Line)", items: () => centreLineRccItems(true, RESIDENTIAL_UPPER_EXTRAS) },
  };

  window.EstimationSchema = { CALCULATION_TYPES, PROPERTY_TYPES, FLOOR_OPTIONS, BUILDING_CONFIGURATIONS, ESTIMATION_WORKSHEETS };
})();
