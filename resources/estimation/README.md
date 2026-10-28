# Estimation workbook resources

These files are the canonical, deployable inputs for estimation workbook
generation:

- `estimation_detail_masters.xlsx` contains the approved Abstract and all 23
  detail-sheet variants.
- `estimation_compact_abstract_master.xlsx` retains the approved compact
  residential layout as a reference master.
- `estimation_manifest.json` contains the evaluated form schema and maps each
  property/method/floor variant to its master sheet.

Production code reads these checked-in resources with `openpyxl`. It does not
invoke Codex, Node.js, the browser prototype, Microsoft Excel, or LibreOffice.
The application therefore remains a single Python container.

`scripts/build_estimation_resources.mjs` is a development-only authoring tool
for intentionally rebuilding these resources from the independent prototype.
It is not copied into the production image and is not part of request-time
generation.
