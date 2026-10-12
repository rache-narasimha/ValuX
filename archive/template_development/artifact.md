# Valuation Report Phase 1 Template Contract

## Reference

- Source: `/Users/narasimharache/Desktop/SLN_poc/Valuation_report_res:com:indus.docx`
- SHA-256: `928bb139fac37bd9706dcec00436ced963e21102f258768175db4387a3ae2af0`
- Rendered pages: 10, including one trailing blank page
- Sections: 1
- Reference render: `/private/tmp/valuation_render`
- Structural evidence: `/private/tmp/valuation_phase1/style-evidence.json`

The source remains unchanged and is the design authority.

## Page system

- Letter portrait, 8.5 x 11 inches
- Margins: left 0.51 in, right 0.32 in, top 0.80 in, bottom 0.72 in
- Header and footer distance: 0.50 in
- One column and one section
- No distinct first, odd, or even page headers
- Required output order: bank cover letter, detailed valuation, photographs, map
- The cover letter and detailed report must start on new pages. Photo pages must start on a new page. The map must remain last. Remove the trailing blank page.

## Typography and components

- Preserve the source's direct formatting, Calibri typography, blue valuer identity block, cyan title bands, orange rules, table geometry, cell margins, borders, paragraph spacing, tabs, and alignment.
- Preserve both decorative anchored rules and all 10 embedded images unless a later form submission replaces the photographs or map.
- Preserve the existing report tables and their merged-cell structure.
- Do not introduce a generic document theme or rebuild the document from blank.

## Content flow

1. Bank cover letter and valuation summary.
2. Detailed land, site, building, and valuation report.
3. Conclusion, declaration, and signature sections.
4. Property photographs in a maximum three-column by three-row layout.
5. Map image as the last content page.

## Slot map

The isolated master uses Word plain-text content controls with hidden semantic tags. Their visible text remains realistic reference data so token length cannot distort pagination or artwork. The generator will replace control contents by tag while preserving the surrounding paragraph and run formatting.

- Bank: name, uppercase name, branch name.
- Report dates: inspection date and valuation date.
- Documents: deed type, deed details, plan details, and tax receipt details.
- Parties: owner name, owner details, and applicant fields in later phases.
- Property: description, address, coordinates, site extent, construction type/status, floor information, and locality data.
- Valuation: land rate, land value, replacement rate/cost, depreciation, building value, government value, present market value, realizable value, distress value, and amount in words.
- Media: repeatable photographs and final map image are preserved as phase 1 fixtures and become replaceable slots in the dynamic implementation.
- Branch-manager acknowledgement: preserve the blank underline fields for manual completion. Start the valuer signature block and acknowledgement together on a new page, matching the user-supplied layout reference and preventing the acknowledgement sentence from splitting between pages.

Optional and conditional behavior will be implemented in later test phases. Phase 1 validates that a populated submission can reproduce the reference values and layout.

## Fixed formatting rules

- Only the complete Present Market Value row is highlighted in yellow in the detailed report.
- Remove all other text highlighting from the output.
- In the cover letter, Fair Market Value in figures and words uses blue text.
- Realizable value is fixed at 90 percent of Present Market Value.
- Distress value is fixed at 80 percent of Present Market Value.

## Package preservation

- Preserve styles, numbering, theme, fonts, footnotes, endnotes, images, drawings, relationships, settings, and web settings.
- Reviewer comment parts are intentionally removed from the isolated template and generated report.
- `word/document.xml` is editable only for body-order changes, explicit page breaks, slot token replacement, highlight cleanup, blue Fair Market Value formatting, and removal of trailing empty paragraphs.
- Media relationships remain preserve-only in Phase 1.

## Fidelity gates

- Verify the source SHA-256 before generation.
- Render the template and populated report with the bundled renderer.
- Inspect every populated-report page at 100 percent zoom.
- Confirm no clipping, overlap, broken tables, missing images, or unintended blank pages.
- Confirm all placeholder tokens are resolved in the populated report.
- Confirm the cover letter is first, photographs follow the detailed report, and the map is last.
- Confirm the source file remains byte-for-byte unchanged.
