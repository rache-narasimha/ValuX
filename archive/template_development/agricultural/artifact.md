# Agricultural Valuation Template Contract

## Reference

- Source: `/Users/narasimharache/Downloads/Valuation Format for Agricultural Properties .docx`
- SHA-256: `c5487ea939bba0bab086385d1a17e12a6f45ec66e4a5d25d154f29eafe8fab8b`
- Rendered pages: 8
- Sections: 1
- Tables: 4
- Evidence: `reference_render/`, `section_audit.txt`, `style_evidence.json`, `heading_audit.txt`, `images_audit.txt`, `fields_audit.txt`, `content_controls.json`, `comments.json`, `reference_inventory.txt`

## Page system

- A4 portrait, 8.27 x 11.69 inches.
- Margins: left 1.00 in, right 1.00 in, top 0.67 in, bottom 1.43 in.
- One Word section; no different first page and no odd/even header treatment.
- No functional headers or footers and no page-number fields.
- Existing intentional page patterns: two-page main data table, valuation/conclusion page, valuer declaration pages, and model code pages.

## Typography and components

- Primary typeface is Trebuchet MS; a small amount of inherited Calibri remains in source metadata/runs.
- Main report title and table section labels are centered, bold, uppercase black text.
- Body content is table-led, with thin black borders and vertically centered cells.
- Declaration and code-of-conduct content uses ordinary paragraphs and numbered lists.
- The legal/declaration wording and complete model code are preserve-only except for documented dynamic slots.
- Source contains one floating line/drawing object near the title block; preserve it unless rendering proves it defective.

## Content flow

1. Format B addressee and valuer identification.
2. General agricultural property details.
3. Site characteristics.
4. Agricultural land valuation.
5. Market/book/distress conclusion and signatures.
6. Property photographs page.
7. Route map page.
8. Valuer declaration and disclosure table.
9. Model code of conduct.

The isolated template intentionally adds dedicated photo and route-map pages. This is an approved deviation from the source's combined placeholder.

## Slot map

All editable slots are in `word/document.xml`. Stable locations use table index/row semantics plus unique placeholder tokens documented in `agricultural_template_mapping.json`.

- Front matter: valuer name/address, bank name, branch.
- Table 0 rows 1-35: purpose, dates, document list, owner/property/location, boundaries, dimensions, extent, coordinates, occupation, and income.
- Table 0 rows 37-56: agricultural characteristics, irrigation, flooding, topology, shape, access, improvements, soil, crops, services, advantages, disadvantages, and remarks.
- Table 1 rows 1-8: land dimensions, extent, prevailing/guideline/adopted rates, and estimated value.
- Table 2: present market value, book value, report date, distress value, figures and words. The bank-manager acknowledgement remains blank and preserve-only.
- Media headings: `PROPERTY PHOTOGRAPHS` and `ROUTE MAP`; generation replaces their placeholder paragraphs with uploaded images.
- Declaration: report date, inspection date, document summary, assignment date, valuation date, report date, bank/branch, valuer identity, place and signature dates.

## Calculation contract

- Estimated land value = adopted rate x total extent after unit conversion.
- Book value = estimated/present market value.
- Distress value = estimated land value x 0.80.
- All three values are rendered in figures and words where the source conclusion requires them.

## Package preservation

- Preserve: theme, numbering, styles, font table, settings, web settings, floating drawing relationship, core/app properties, and all legal/model-code text.
- Remove intentionally: comments parts, comment relationships, comment anchors, reviewer metadata and sample property values.
- Editable: `word/document.xml` only, plus comment-related package plumbing removed by the approved comments-strip utility.
- The retained reference must remain byte-for-byte unchanged at the recorded SHA-256.

## Fidelity gates

- Render every master-template page at 100% zoom.
- No overflow in declaration disclosure table row 8.
- No sample owner, survey, date, bank/branch, extent, rate or value may remain.
- Bank-manager acknowledgement remains blank.
- Photo and route-map placeholders occupy separate pages.
- Main tables, declaration and full model code remain recognizable and readable.
- Re-run section, style, image, field, content-control and comments audits before approval.

## Phase 1 verification

- Final master render: 9 A4 pages in `qa/master_render_3/`.
- Placeholder contract: 82 unique tokens; every token is present in `agricultural_template_mapping.json` and no mapped token is missing from the DOCX.
- Comments audit: 0 comments.
- Sample-value checks: reviewed owner, date, bank and valuation samples are absent.
- Section audit: one A4 portrait section with the reference margins preserved.
- Visual checks completed for all pages; no blank trailing page, clipped declaration row, split dimension token or orphaned Model Code heading remains.
- Field 12 begins as a complete block on page 2; the agricultural valuation heading begins with its table on page 3.
- The valuer date/place and signature block is aligned as two balanced columns with controlled line wrapping.
