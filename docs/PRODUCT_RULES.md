# ValuX / SLN product rules

This document records the product behavior approved for the current
development version. It is a guardrail for future work, not a request to build
features that do not yet exist. Where this document marks something as
deferred, a separate explicit user request is required before implementation.

## 1. Product boundary and terminology

- ValuX is the authentication and platform identity currently shown at login.
- After authentication, users enter the SLN Property Reports work-management
  application.
- The persisted backend role values are `father` and `employee`. The current
  user-facing labels are `CEO` and `Employee`.
- PostgreSQL serves authentication/authorization identity plus durable
  institutions, tasks, activity history, payments, duplicate protection and
  Completion locks. The backend workflow service is authoritative for roles,
  transitions and concurrency. Task-linked report drafts, report revisions,
  local-file metadata and estimation snapshots are durable in PostgreSQL.
  Browser storage remains appropriate for appearance, practice drafts and the
  approved daily scratch-calculator history; it is not task/report persistence.
- ValuX stores timestamps and performs audit/session/internal processing in
  UTC. Calendar rules and user-facing timestamp display use the tenant's
  configured IANA time zone. SLN is configured as `Asia/Kolkata`, so SLN users
  see IST throughout the application. Date-only values such as assigned date,
  report date and due date remain calendar dates and are not converted through
  UTC.
- Existing routes, URL parameters, browser-storage formats, calculations,
  report mappings, preview behavior, and DOCX output must remain compatible
  unless the user explicitly changes them.

## 2. Role and visibility rules

### Shared father/CEO and employee capabilities

- Both roles can view all tasks for report types allowed to their account.
- Both roles can create assignments.
- Both roles can view per-task payment status and update payment information on
  tasks that are not Closed or Cancelled.
- Both roles can add general work notes except to a Cancelled task.
- Both roles can close a Completed task after its payment is fully settled.
- Both roles see the task-status cards and task-related dashboard information.
- Both roles can use the practice forms without modifying a live assignment.

### Employee rules

- Employees may inspect another employee's task, but may not edit its report or
  change its workflow until they reassign it to themselves with a mandatory
  work note.
- An employee can claim an Unassigned task by assigning it to themselves with a
  mandatory work note.
- An employee may transfer their own active task to another configured employee
  with a mandatory work note.
- An employee-created assignment must be assigned when it is created; it cannot
  be created as an unassigned task under the current implementation.
- Employees do not see aggregate institution income, received, or outstanding
  business analytics.
- Employees cannot cancel tasks, reopen Completed or Closed tasks, or maintain institution
  settings.

### Father/CEO rules

- The father/CEO can create an Unassigned task, assign work to himself, or route
  it to an employee.
- The father/CEO can work on any assigned report, transfer active tasks, and
  manage workflow actions.
- The father/CEO alone can cancel a task.
- The father/CEO alone can reopen an eligible Completed or Closed task.
- The father/CEO sees aggregate institution workload and financial analytics
  and can maintain the configured bank/NBFC list.

Changing login screens, account activation, identity labels, or authentication
internals must not change any permission in this section.

## 3. Assignment and task lifecycle

The task states are:

```text
Unassigned -> In Progress -> On Hold -> In Progress -> Completed -> Closed
```

- There is no separate Assigned state. Assigning an Unassigned task moves it
  directly to In Progress.
- A task that has entered In Progress cannot return to Unassigned.
- Active report editing requires an assigned task. Employees must be the
  assignee; the father/CEO may edit assigned work for review or completion.
  Completed and Closed report forms are viewable read-only by users who can
  view the task, using the inputs associated with the retained artifact (the
  final artifact for Closed). They allow section navigation and retained-file
  download, but no editing, autosave, draft removal, upload or regeneration.
  Existing note/payment/reopening permissions remain separate. Removed draft
  media remains visible in the retained document. Offline reports expose only
  captured setup/component information and their retained file.
- Reassignment and transfer use the same assignment action. A work note is
  mandatory and the activity history records the previous and new assignee.
- An active task may be placed On Hold with one of: Awaiting Documents,
  Scheduled Site Visit, Awaiting Review, Returned for Correction, or Custom.
- A hold action requires a work note. Selecting Custom means its explanation is
  written in the work note rather than added as another workflow state.
- Resume Work moves an On Hold task directly to In Progress. A work note is
  optional when resuming.
- A task can become Completed only after successful report generation while it
  is In Progress. A completion work note is mandatory except for the approved
  offline valuation, revaluation, estimation, Progress and Completion upload
  flows, which reuse their upload work note.
- Editable calendar fields currently accept past, present and future dates.
  Assignment priority may suggest a due date, but does not impose a maximum;
  a due date still cannot be earlier than its assigned date.
- Completing a report returns the user to the dashboard.
- Cancellation reasons are Created by Mistake, Wrong Details, and Custom.
  Custom requires a work-note explanation. Cancellation is recorded in
  activity history.
- Only the father/CEO may reopen a task, with a mandatory work note. Completed
  tasks have no reopening deadline. Closed tasks can be reopened through the
  fifteenth tenant calendar day after closure. A newly
  generated DOCX is required before completing an ordinary valuation again.
  Karur Vysya Bank requires a newly attached completed KVB XLSX; Karnataka
  Bank requires a newly attached Valocity DOCX or PDF. An estimation requires
  a newly generated XLSX or attached completed XLSX, DOCX or PDF.
- Task lists remain searchable and filterable. Search includes task ID,
  applicant/customer, report, institution, assignee, property details, state,
  hold reason, and payment state where supported.
- New Assignment offers **Show examples** in the left sidebar. The hints use
  Adoni for the branch location, the signed-in user's display name in a sample
  applicant relationship, and a property description suited to the selected
  valuation type. Double-click inserts an editable example in an empty field.
  Linked read-only fields are excluded. The toggle only changes hint visibility.
- The task-list period defaults to “Assigned during.” With status set to
  Completed or Closed, the Assignments header offers “Completed during” or
  “Closed during,” using that event's date in the tenant time zone. The period
  supports an arbitrary day, month, or year. Its weekly picker exposes the
  current tenant-calendar week and the preceding 51 weeks, with no future week
  ranges. Older work remains accessible through All time, Monthly, Yearly and search.
- Valuation and Re-Valuation offer All, General, or Agricultural from their
  dashboard category buttons and the Assignments header. The task list,
  drill-downs and assignment exports carry the selected type.
- Lists load bounded pages of records and fetch/show more rather than rendering
  an unbounded task collection at once.
- A non-Cancelled valuation or estimation assignment blocks creation of another
  assignment with the same report type, institution, assigned date, branch,
  applicant/customer, and property description. Cancelling the earlier task
  releases that duplicate restriction.
- If another valuation or estimation with the same report type, institution
  and assigned date was created within the preceding 30 minutes and its branch,
  applicant/customer and property details are all closely similar, creation
  pauses with a warning and a link to that task. The user may explicitly create
  it anyway when it is genuinely separate work. Applicant/customer name alone
  never defines a duplicate.
- A linked estimation can have multiple Progress assignments only when their
  assigned dates differ. It can have only one non-Cancelled Completion
  assignment. Cancelling either task releases its applicable duplicate
  restriction.
- Once a linked Completion assignment has ever reached Completed, that estimation
  is permanently unavailable for any new Progress or Completion assignment.
  Reopening the existing Completion assignment permits corrections to that
  task only; it does not release the linked estimation for another task.

## 4. Work notes and activity history

- Work notes are general task history entries. Do not create duplicate note
  fields beneath every individual action.
- A work note is mandatory for assignment, transfer, hold, completion, reopen,
  and Custom cancellation.
- A work note is optional for resume, payment update, close, and non-Custom
  cancellation unless a later approved rule changes that action.
- Activity history records creation, assignment, transfer, hold/resume, report
  generation, completion, payment, cancellation, closure, reopening, and work
  notes.
- History is not expanded by default. “View history” expands the chronological
  activity below the current task content rather than navigating away.

## 5. Payments and closure

- Payment data is assignment/workflow data and must remain separate from report
  form fields and generated report content.
- Payment fields include estimated fee, agreed fee, received amount, due date,
  derived outstanding amount, and derived payment status.
- Income earned uses agreed fee when present; otherwise it uses estimated fee.
  It is earned when work enters the firm's queue, not only on completion.
- Outstanding is always `agreed or estimated fee - received amount`; it is not
  tied to the end date of a selected dashboard period.
- Received cannot exceed the agreed or estimated fee.
- Payment status includes Not Set, Pending, Partially Received, Received, and
  Overdue as derived by the current payment rules.
- Overdue warnings apply to both roles and use calendar days.
- Completed tasks remain in payment tracking. Their payment popup exposes
  payment updates and an optional work note without opening the full task.
- A Save action remains available when payment is still outstanding.
- Close Request is enabled only when the task is Completed, payment status is
  Received, and outstanding is exactly zero.
- Payment editing is disabled after a task is Closed or Cancelled.
- The final downloadable artifact retained on closure is the latest generated
  DOCX for ordinary valuation work. Karur Vysya Bank retains the completed
  uploaded XLSX; Karnataka Bank retains the completed Valocity DOCX or PDF.
  For estimation work it is the latest completed XLSX from the online
  form or the retained offline XLSX, DOCX or PDF. Artifact and report-revision
  metadata remain registered; superseded development file bytes may be removed
  when they are no longer the immutable final artifact.

## 6. Dashboards and navigation

- Both roles see numbered cards for Unassigned, In Progress, On Hold,
  Completed, and Closed tasks, limited to their allowed report types.
- “Assignments” exposes the respective task states and leads to filterable task
  lists.
- “Payments” opens Completed reports requiring payment tracking.
- “Reports” opens Closed reports.
- Recent Activity can be filtered by state. The signed-in header uses compact
  Payments and Activity shortcuts, with SVG icons and accessible names at narrow
  widths. Payments opens Income & Payments for the CEO and Completed reports
  payment tracking for employees. Activity opens Recent Activity. Assignments
  remain in sidebar navigation.
- Completed and Closed task rows with a retained report expose a direct
  download icon without requiring the task to be opened. The task detail view
  also exposes the retained report download. Completed uses the latest valid
  artifact; Closed uses the immutable final artifact.
- Dashboard task cards show the assigned date alongside the due, completion,
  or closure date in their date area. Payment Tracking and Recent Activity use
  aligned columns, with the applicant and report type on separate lines.
  The Assignments table shows the assigned
  date below the Task ID and the completion or closure date below the status
  badge. The Due date cell is blank for Completed and Closed tasks.
- The layout should use available horizontal space efficiently, show useful
  task details before opening a record, and become compact on smaller screens.
- Normal action buttons share a 14px-equivalent font, with 13px-equivalent
  compact table actions and matching primary/secondary control sizing. Long
  labels wrap inside their controls and action groups reflow without overflow;
  icons remain centred. Payment-dialog explanations do not stretch adjacent
  buttons. The workload label is "Selected Period Total". The estimation picker may widen
  within the viewport and presents one compact task row with explicitly
  labelled Assigned and Completed dates, completion time in tenant time zone,
  and a distinct status.
- Father/CEO institution charts include every configured bank and NBFC, showing
  zero for institutions with no work in the selected period.
- Dashboard category counts, status cards, institution workload/finance,
  assignment-status distribution and report-type totals share one Assigned
  during period (All time, daily, weekly, monthly or yearly). All time hides
  only the supplementary picker. Returning to the dashboard from a task list
  using status dates applies completion and closure dates to the Completed and
  Closed cards and their assignment-status chart entries. Their drill-downs
  carry that date basis. Workload and finance use assignment dates, and finance
  shows the current payment position of assignments in that period. Recent activity
  and the actionable Completed payment-tracking list retain their existing
  scopes. Status-card and workload drill-downs carry the selected period.
- Report-category and Assigned during controls share one compact filter panel,
  keeping report selection and Assigned during on one row on roomy desktops at
  100% zoom, with a compact week picker; they wrap into aligned rows on smaller
  screens. The dashboard title for all report types is “Property Reports”, with
  “All reports” as its category control and “Re-Valuation” as the linked
  valuation category label. The heading shares its desktop row with the period
  summary and New assignment. Its supporting line describes valuation and
  construction reporting, assignment progress, fees and payments. A decorative
  construction scene sits behind the dashboard heading on wider layouts. Doughnut
  legends separate Count and % columns, with clean flush
  segment boundaries. Institution section headings and report-type rows use
  decorative SVG icons; report labels use a compact shared column so the bars
  use the remaining width. Existing chart drill-downs remain unchanged.
  Institution Workload shows assignment counts with existing task-list links.
  Its NBFC column includes the compact Workload by Institution Type doughnut,
  based on filtered Bank and NBFC assignment counts and percentages. An empty
  selection shows an empty ring and No assignments.
- Income & Payments is consolidated into the lower summary, with no duplicate
  institution payment bars, analysis toggle or payment-view control. It defaults
  to all institutions within the shared period; its institution selector narrows
  the three amounts and collection doughnut to All Banks, All NBFCs or an
  individual institution. All institutions resets it.
  Financial views remain CEO-only. The collection doughnut uses its compact
  118px diameter and shares the satin finish of the two analysis doughnuts.
- The dashboard places institution analysis beside assignment status, and
  payment summary beside report types on roomy desktop screens. The right
  panel stacks a compact Assignment Status doughnut above the CEO-only Report
  Preparation vertical chart. The bars are labelled Online Preparation,
  Offline Template and Retrospective Submission. They follow the same period
  and report filters, and Progress and Completion use their linked estimate’s
  method, as in the task-list filter. Unrecorded methods are counted separately.
  Panels stack before their content becomes cramped, with content-led chart
  heights and consistent heading/section spacing. Task-status colours match their
  distribution legend. Cancelled work appears in that distribution when present
  so its assigned-date total agrees with category counts; finance still excludes Cancelled
  assignments. Empty fee totals do not show a fabricated collection percentage.
- Workload totals link to the existing task-summary page for Banks, NBFCs or
  both together, preserving the selected report group and assigned-date
  period. Aggregate summaries, task tables and exports use the same filters.
- Assignment Status and Institution Type doughnut slices and Report Preparation
  bars open the matching task filters with the dashboard’s period and report
  group. Institution Type uses the active institution directory. Legend links
  and existing workload and report-type drill-downs remain available.
- CEO payment amounts and collection slices carry the institution, period and
  report group into the task list. Payment received combines Partially Received
  and Received. Outstanding combines Partially Received and Pending. These
  links exclude Cancelled tasks and institutions outside the active directory.
  Collection slices also open a payment summary with the selected amount first,
  all three payment amounts, and separate assignment counts by payment status.
  The summary covers the full institution, period and report selection. The
  bars apply their payment filters to the table and export. Total Earned
  shows assignments with an agreed or estimated fee recorded.
- Institution drill-down retains report-type and task filters and includes a
  route back to the all-institutions view.
- Father/CEO financial views show earned, received, and outstanding totals for
  all institutions and for an individual selected institution.
- Employee dashboards contain task and per-task payment information but no
  aggregate business-income analytics.
- Assignment lists export the complete currently filtered result set to a
  typed Excel workbook. Its filename identifies the assignment or payment
  view and applicable report, institution, period, and status filters.
  The father/CEO institution directory exports its workload and financial
  overview as ValuX_Institution_Overview.xlsx. Employees do not receive that
  aggregate institution export.

## 7. Report-form boundary

- Sequential keyboard navigation skips locked fields and values the form can
  identify as supplied by the app. Editable prefilled fields remain clickable.
  Manual entries and overrides stay in the normal Tab sequence.

- Report-generation forms contain only the valuation/report fields approved
  for the generated document. Workflow fields, assignee data, application
  management, and payments remain outside the generated report data.
- Assignment context controls may surround a task-linked report form for user
  convenience, but they must not become report fields or generated content.
- Task-linked report pages show one report/assignment heading; shared shell
  changes must not create duplicate headers or banners.
- A task-linked general or agricultural valuation preview remains approved
  across page reloads while the saved report inputs, media references, schema,
  and template version are unchanged. Report-input freshness is enforced by
  the backend; changing a report input makes the retained report outdated and
  requires a new preview and DOCX before completion. Workflow-only changes do
  not invalidate a report.
- Draft status indicators remain visually quiet: the existing status text is
  retained while a small saving activity cue appears, then resolves to the
  saved state without moving the form layout.
- Task-linked report drafts are stored by the backend and shared across
  authenticated sessions. Their draft photographs and route maps use
  task-scoped local files served only through authenticated routes. Practice
  forms remain browser-local and do not create durable task data.
- General, agricultural, Progress and Completion draft photographs (and route
  maps where applicable) are retained only while the task is In Progress or On
  Hold. They are removed from standalone draft storage when the task reaches
  Completed; the final DOCX retains its embedded images. A reopened task
  requires media to be uploaded again before regeneration.
- General-property and agricultural-property forms are separate products.
  Never apply a field, label, document option, template, calculation, or layout
  change to both unless the user explicitly requests both.
- Preserve each report type's existing document options. “Custom” is an
  additional option, not a replacement for existing options. Sale Agreement is
  available to both general and agricultural valuations.
- Owner details and purchaser details are distinct entries under the relevant
  report field. Use “Purchaser,” not “Applicant,” in that report context.
- Assignment “Property description” is the canonical description used to
  prefill the matching report field and both the cover and detailed report.
  Assignment applicant/customer name prefills owner details and remains
  editable in the report.
- General-property status describes physical construction only: Existing,
  Under Construction or Proposed. “Purchase loan” belongs in Purpose of
  valuation. The red “(Proposed)” suffix is shown beside Specifications of
  construction only when Proposed is selected.
- General-property Extra Items, Amenities, Miscellaneous and Services offer a
  one-shot action that changes only blank item rows to “Included.” Numeric item
  entries are totaled into their editable calculated abstract fields; non-numeric text is
  zero for arithmetic and the present market value includes those totals.
- General and agricultural report-entry fields, including calculated results,
  remain editable within the existing report-access and section-visibility rules.
  Explicit manual calculation overrides persist with the draft and are honoured
  by preview, DOCX, PDF and amount-in-words. Changing an affecting input refreshes
  its dependent results and clears their overrides; unrelated edits preserve
  them. The app shows the calculated baseline and a Use calculated value action
  for an override. Report labels remain unchanged and no override notes are
  added to generated documents. Duplicate controls for one amount stay in sync.
- Automatically calculated final Market, Realizable and Distress Values round
  to the nearest thousand: a remainder below 500 rounds down, above 500 rounds
  up, and exactly 500 remains unchanged for manual adjustment. Realizable and
  Distress Values use the final Market Value and the existing percentages.
  Intermediate calculations and component totals are not rounded to thousands;
  manually entered results are not automatically rounded. Calculated zero
  section/consolidated amounts appear as 0/- rather than blanks or dashes.
- Online general and agricultural forms show fictional examples through
  **Show examples** in the report-section sidebar. Double-click inserts an
  editable example in an eligible empty text field. Selects and checkboxes
  expose **Use example** beside their hint. Dates, extracted assignment
  details, generated addresses, mirrored controls, and calculated fields
  are excluded. Personal and property identifiers use bracketed prompts.
  **Fill empty fields** is a separate toggle in practice and live drafts.
  It fills eligible blanks once, excluding dimensions, areas, rates, and
  checkboxes with an existing Yes/No state. Turning it off clears only
  untouched values inserted by bulk fill, even after reopening a draft.
  Turning off **Show examples** only hides the hints and bulk control.
- General and agricultural Postal address fields can autofill from the door
  number, plot or survey number, locality, ward or taluka, and mandal or
  district. Automatic addresses follow their source fields. Manual and
  previously saved addresses are preserved until the user chooses
  “Use address from fields.” Preview and reports use the final address text.
- Document details and Special remarks in both valuation forms support bold,
  bulleted and numbered lists from compact controls on the field label row.
  Typing a list marker starts a list, Enter continues it, Enter on a blank
  item ends it, and Shift+Enter inserts a line break. Formatting is retained
  with the draft and rendered in previews and generated reports.
- Agricultural rate unit labels use “per unit” without repeating “rate per
  unit” in the selected unit label. This agricultural wording must not be
  copied into general valuation unless explicitly requested.
- Preview and DOCX generation must remain consistent, with intentional page
  breaks, standardized fonts, and no static-template line breaks substituted
  for dynamic logic.
- Valuation DOCX body typography uses Calibri with only 11, 12 and 13 point
  sizes. Declaration/signature blocks stay together where physically possible;
  table column labels may repeat after a page break. General-property section
  names appear once and do not repeat on continued table pages.
- General-property reports use uniform left/right margins and professional
  sentence case, spacing and punctuation. Method of valuation, conclusion,
  justification, declaration and the valuer's signature occupy one page. The
  bank manager's undersigned acknowledgment is a separate section on the next
  page, not part of the valuer's declaration. General and agricultural reports
  align Place/Date fields left and centre signatures near the 14 cm text-ruler
  mark, using paragraph alignment/tab stops rather than runs of spaces. The
  bank manager page retains blank space instead of an acknowledgment heading.
  The default Valuer name is K. Siva Prasad. The general cover has a blue
  selected-institution banner with centred bold white text, followed by a black,
  bold, underlined “Valuation Report”. Its detailed report has a matching blue
  banner with white “Valuation Report” and black “(Land and Building)”. The
  agricultural report uses the same banner at its existing heading, with
  “(Agricultural Land)”, without an additional cover page. Amount-in-words
  begins on a separate line below the corresponding numeric statement and
  stays with it. Important value phrases use initial capitals, including
  Fair Market Value, Present Market Value, Realizable Value and Distress Value.
  Static wording capitalizes Value, Valuer and Valuation, including Date of
  Valuation and Method of Valuation. Identifier
  cells (serial, alphabetical/roman subserial and Part codes) are centred;
  descriptions and merged section headings remain left aligned. General
  building reports use “Land and Building”, and the land/building category
  labels include “and” without changing their stored identifiers.
  Task-generated valuation downloads include task ID, applicant name, report
  type and extension; internal storage identifiers remain independent.
  The general offline template
  and app-generated DOCX share the same Word compatibility finalization.
- General cover letters address “Bank Manager”. General and agricultural
  amount wording capitalizes each word, including “Only”, and hyphenates
  compound numbers (for example, “Forty-Five”). Correct definite spelling errors while retaining valid
  spelling variants such as “Saleability”.
- General and agricultural photographs use three columns with up to 12 photos
  per page. Their location map is one image in a merged three-column, two-row
  area: on the same media page for up to nine photos, on a separate page after
  all photos for ten or more. Images retain aspect ratio and are not cropped.
  Progress and Completion retain their existing three-column, up-to-12-photo
  layout.
- DOCX is the completion-qualifying artifact for ordinary valuation work. A
  generated PDF is an optional direct-download copy and does not independently
  qualify the task for completion or closure.
- General valuation Site & Land offers separate matching controls for Boundaries
  and Dimensions. Users can edit either column while its matching control is on.
  Existing conflicting pairs must be resolved before linking. Unlinking keeps the
  copied values, and saved drafts retain the matching controls.
- For an eligible standard general or agricultural valuation, both the CEO and
  the assigned employee choose a preparation method immediately after Report
  Setup: Fill online, or Complete offline and upload. Online preparation exposes
  the valuation form, photographs/map, preview and generation steps. Offline
  preparation exposes the clean DOCX template and accepts either that completed
  template or an existing completed DOCX/PDF report. Upload requires one
  substantive work note; completion references that recorded note instead of
  requiring a duplicate. The task remains In Progress until upload and explicit
  completion. Removing/replacing the attachment resets completion qualification.
  Changing preparation method retains entered form details but invalidates and
  removes the previous completion-qualifying artifact.
- The standard offline valuation route uses Submit to retain its DOCX/PDF
  and required upload work note. A retained attachment displays its filename
  with a green tick and download/remove icons; the same primary button then
  becomes Mark Completed. Removal restores Submit. Upload and completion
  remain separate actions. This route has one primary completion action and
  compact optional Add note/View history controls instead of a second
  permanently visible work-note composer.
- Estimation uses Date of Estimation and an editable Name of the Applicant,
  initially filled from the assignment only when the saved applicant is empty.
  The edited Name, Place passes directly to estimation and Progress/Completion
  borrower fields, without another location suffix or assignment-name change.
- Estimation Report Setup has two shared fields: Name of the Work (the overall
  description without its address) and Address of the Work. The overall report
  joins them with one "at" connector. Component descriptions are derived from
  component names and floor configurations using that same address, without
  per-component work-description inputs. The worksheet's Name of the Work
  omits numbering from default component names and keeps distinct named
  blocks. Progress/Completion construction-site
  fields use Name of the Work, Address of the Work. Karnataka Bank's site
  certificate uses Address of the Work alone. Older
  saved descriptions/identities remain intact until reviewed; no automatic
  address extraction or rewrite is performed.
- Estimation worksheet labels, Abstract rows, navigation and linked component
  summaries use one naming rule. A single building uses floor names; multiple
  buildings use a meaningful building prefix and floor abbreviation. Tabs stay
  unique and within Excel's length limit, while summaries retain full labels.
  Stable component/floor IDs and legacy labels preserve linkage during approved
  correction flows; completed historical reports are not silently renamed.
- Independent estimation components retain their own work/applicant header.
  For buildings, only the first floor sheet retains it; later sheets begin with
  their floor heading and plinth area. Generated/template worksheets have no
  frozen or split panes. A single residential building through G+2 uses a compact
  Abstract on the final detail sheet. Multiple independent components/buildings,
  or G+3 and above, use a separate Abstract; typical groups use their actual floors.
  Place, Date and signature occur only after that applicable Abstract, with
  Place and Date on consecutive rows and no detail-sheet signature blocks.
- Optional plinth areas in sft. are entered per component/floor worksheet,
  including the total area of all floors represented on a typical sheet. Report
  Setup and both Abstract layouts have no Overall Plinth Area field or aggregate
  area wording. Legacy overall-area values are ignored in newly generated output;
  individual areas accept text and populate worksheet headings. They do not
  drive measurements.
- Every task-linked report form starts with its work-note composer collapsed.
  Add note/Hide note toggles it; Save note submits it. A required completion note
  reveals/focuses the composer, preserving all existing note and offline-note rules.
- All signed-in pages offer the compact draggable calculator in their left
  sidebar. Report forms hide numeric spinner arrows while preserving number validation.
  Mouse-wheel and trackpad scrolling leave numeric input values intact.
- Editable numeric fields throughout the app accept basic arithmetic with
  decimals, parentheses, addition, subtraction, multiplication and division.
  Leaving the field commits the result through its existing validation and
  calculations. Invalid expressions stay visible for correction and are
  excluded from report and payment updates. Codes and identifiers use literal
  entry.
  Calculator history is local to the signed-in user and tenant calendar day.
  Task detail and task reports share that task’s history, each practice report
  has its own, and other workspace pages share a daily scratch history.
  History survives reload/dismissal in that browser only. It
  supports Basic and Scientific modes, arithmetic, decimals, percentages, powers,
  roots, logarithms, factorial, trigonometric/hyperbolic and inverse functions,
  constants, scientific notation, random numbers and memory controls. Degrees
  is the initial angle mode, with a visible DEG/RAD switch. Mode, memory and
  history remain local within the same daily scope. It never changes report
  fields, report freshness or workflow state.
- Estimation preparation is selected immediately after Report Setup. Fill online
  exposes configuration, components, measurements, Abstract, preview and XLSX
  generation. Complete offline and upload exposes attachment first, followed by
  extracted or manually entered component totals and one substantive upload note.
  Optional workbook-template configuration remains available without making it
  mandatory for retrospective uploads. Industrial Centre Line estimates use
  Complete offline and upload with a completed retrospective report. The app
  provides online entry and workbook templates for industrial Long Wall / Short
  Wall estimates. No photographs or map are required.
- New supported online estimation worksheets have a Dimensions & Defaults step
  between component selection and measurements. Each floor or independent component
  uses its own outside wall dimensions, applicable run and column counts, and editable
  measurement defaults. Applying them updates the linked quantities and preserves
  rates, independent measurements, lump sums and custom entries. Older worksheets
  can use this step explicitly or continue with their saved manual measurements.
  Inputs share a baseline within each row when their labels wrap. The selected
  worksheet shows a live review of derived counts, lengths, widths and depths,
  with the sources of inherited values and overrides, before applying.
  The lowest RCC floor's outside dimensions are entered manually. On an upper
  worksheet, each outside dimension can default to the edge-to-edge roof slab
  dimension of the physical floor immediately below in the same building.
  Typical Floors use the slab below the first floor in the group as their
  starting point. Users can override either axis and clear it to restore the
  link. A revised slab updates linked dimensions only. Previously saved manual
  dimensions and the upper worksheet's own wall runs and room schedule are
  retained. Each RCC worksheet’s Building dimensions also provides shared roof
  slab length and width. Applying them fills the slab, flooring, waterproofing,
  slab-based ceiling plastering, and applicable sand filling. Individual
  measurement overrides take precedence.
- RCC uses long-wall and short-wall layer adjustments, or the perimeter and user-entered
  centre-wall runs on Centre Line worksheets. New commercial and residential
  RCC Centre Line worksheets calculate the exterior perimeter from outside
  dimensions and wall thickness, with optional overrides by layer. Existing
  whole-perimeter overrides remain editable under Exterior perimeter overrides.
  Counted crosswalls have layer selection and overrides. Matching-junction
  width adjustments default on for new wall runs. Saved choices and manual
  overrides take precedence. The foundation layout belongs to the lowest
  worksheet in new RCC building setups. Walls and column
  pits can use separate PCC thicknesses. Centre Line ceiling defaults to a
  25% beam allowance and 0% opening deduction, with separate editable masonry
  and wall-plaster opening deductions. Rooms & Finishes and Wall Runs are
  available only in Centre Line setup. Existing Long Wall / Short Wall room
  measurements remain in their saved worksheets. Centre Line uses one
  per-worksheet room schedule for both plastering items. A measured room uses count × length × width for the
  ceiling and count × perimeter × height for walls, with measured area overrides.
  The worksheet-level ceiling checkbox defaults on. Clearing it uses the shared
  slab dimensions for ceiling plastering while wall plastering still uses the
  rooms. The ceiling also uses the slab when there are no measured rooms. The
  worksheet and generated Excel show measured rooms before the applicable
  allowance and final quantity. The Steel reinforcement settings expose each linked steel
  factor and slab thickness. Both Centre Line types use 100 kg/m³ for columns
  and 70 kg/m³ for slab steel on foundation worksheets, and 150 and 100 kg/m³
  respectively on upper worksheets. Saved values take precedence.
- For either measurement method, the worksheet copy options are Defaults only,
  Dimensions only, and Dimensions and defaults. Dimensions only uses the
  compatible destination worksheet's own defaults. Each measured row has one
  editable Qty field showing the calculated quantity when available. A value
  entered there takes precedence in the form, dependent calculations and
  workbook. Clearing it restores the calculated quantity. Applying a setup
  preserves entered quantities and rates. Measurements may also be entered
  without first applying a dimensions setup. A standard item can be removed
  or restored per worksheet. Removal excludes its rows and amount from the
  completed workbook and renumbers subsequent standard items. RCC sand filling
  defaults to roof slab length × width with the existing filling depth.
  Users adjust filling measurements or quantity on the worksheet itself.
  Previously applied dimensions remain in saved worksheets until reapplied.
- A new Typical Floors group uses per-floor dimensions, rates and lump sums.
  Each line amount multiplies by the number of floors once, and the Abstract
  names every grouped floor and includes the group total once. The lowest
  floor, with its foundation work, stays separate in a new group. Existing
  combined-entry groups retain their saved basis. Calculated values and Excel
  display at most two decimal places. Online estimates and their generated
  workbooks price each line using its displayed quantity and unit rate, then
  round the line amount to two decimal places. Measurement subtotals retain
  their calculation precision before pricing. Previously retained reports
  keep their original calculation basis.
- Shed configurations offer Storage Shed
  separately from Machinery Hall and use the respective geometry, structural steel and
  roofing measurements. Shed brickwork uses gross quantity and wall plaster retains
  its editable opening deduction. Workbook quantities use the same applied measurements
  and factors as the online form.
- Standard valuation, revaluation, estimation, Progress and Completion offline
  uploads use the Estimation form's attachment-first layout and ask for Filled
  template or Retrospective report. Filled template requires only a prior
  template download recorded against the task, valid across reloads, devices and
  handovers; configuration, template version and uploaded contents are not matched.
  Retrospective uploads require no template download. CEO and assigned employees
  may use either route under existing report-access rules.
- Estimation offline uploads accept XLSX, DOCX and PDF. Recognizable XLSX totals
  may be extracted; every component/floor name and total can be reviewed or entered
  manually, including numeric zero. Totals include measured work, lump sums and
  final adjustments; a subtotal must not also duplicate its constituent floors.
  Submission retains the file, reviewed costs and work note together. Its filename,
  green tick and download/remove controls replace attachment entry; Submit becomes
  Mark Completed. Completion reuses the upload note. Removal/replacement or changed
  report inputs reset completion qualification.
- An online estimation preview remains approved across reloads while saved workbook
  inputs, component configuration, schema and template version remain unchanged.
  The server calculates final component amounts from the saved measurements and
  explicit overrides. Review shows the server amounts and flags a difference
  from the browser calculation. Final generation checks the recalculated Excel
  totals against the server amounts before storing the workbook and the linked
  estimation snapshot. A mismatch leaves the draft available for correction.
  Changed report inputs invalidate the preview and retained report; workflow-only
  changes do not. Switching preparation methods retains entered data but requires
  a newly generated or attached report.
- Standard report forms give action-specific confirmation for every actual preparation or
  previously selected upload-type change, including repeated switches. First
  selection without a retained report needs no warning. Cancellation restores
  the previous selection and section. Existing configuration/measurements remain;
  a server-managed preparation revision prevents an earlier report/preview from
  qualifying again when the user switches back.
- Estimation extraction, preview, template preparation, generation, submission and
  retained-file removal display one processing indicator with meaningful stage
  text and no fabricated percentages. Conflicting actions are blocked until it
  finishes and controls recover after failure. Users can cancel extraction and
  retain the file for manual entry, or cancel waiting for a preview in any online
  report form. Superseded results cannot overwrite a newer approved preview.
  Submission and removal can commit server-side once sent. The report-output card uses a contained
  filename, compact download icon and distinct ready/outdated states; report
  readiness does not mark the task Completed.
- Preparation Method is recorded explicitly as Online, Filled template or
  Retrospective. Older records without sufficient metadata remain Not recorded;
  no source is guessed. Previous choices remain in activity/revision history.
  Only the CEO sees and may apply the Preparation Method task filter, with All as
  default. It combines with Report section and all other task filters, pagination,
  counts and filtered exports. Progress/Completion use their linked estimation's
  current preparation method, including subsequent changes.
- Karur Vysya Bank general valuations use its supplied Excel format only: the
  application supplies a cleaned bank-template XLSX and the valuer attaches the
  completed XLSX. Karnataka Bank general valuations are completed in Valocity;
  the application supplies no online form or template and retains the Valocity
  DOCX or PDF attached by the valuer. Other valuation institutions retain the
  standard online/offline preparation choice.
- Every Progress or Completion report is linked to one finalized Estimation
  task. Final online or offline estimates create immutable component-cost snapshots.
  New linked reports use the latest snapshot and assess each component's full final
  amount, including lump sums and adjustments, without measurement-line duplication.
  The backend verifies every submitted component ID and estimated cost against
  the pinned snapshot for preview, document generation, and offline submission.
- When the CEO reopens an eligible estimation under the normal reopening rules,
  the confirmation lists affected non-Cancelled linked reports. Completed or Closed
  dependants reopen as In Progress regardless of their own reopening deadline.
  Active dependants
  become outdated. Payments, history and prior documents remain retained. Preparing
  or completing dependants is blocked until the revised estimation is finalized.
- Finalizing the revised estimation advances affected existing dependants to its
  new snapshot. Matching components retain completion percentages and recalculate
  completed amounts; manually entered completion amounts remain for explicit review.
  Added/removed components also require review. The user must confirm review and
  obtain a fresh preview/report before completing a dependant. This correction flow
  does not release the permanent Completion lock for new assignments.
- A linked report is classified as Completion only when every component is at
  100 percent and every balance-work amount is nil/zero. Otherwise it is a
  Progress report. Balance work remains calculated internally and in the form;
  it is not a column or total in generated DOCX reports for any institution.
- All institutions' Progress/Completion assessment tables use the same five
  reference headings: Sl. No.; Construction details (Construction of house/
  Flat/ Addl. Construction/ Renovation/ Repairs); Total estimated cost (As
  submitted in the proposal) (Rs); Details of works completed/ stage of
  construction/ % of work completed; Cost of works completed/ incurred (Rs).
  Name of the Work is repeated in the description cell spanning the floor rows.
  The third heading spans separate component/floor and amount cells, aligned
  with each floor's percentage and completed cost. Existing combined groups
  remain combined. Totals, materials and amount-in-words remain. Point 7 has
  paragraph spacing before it and stays with the following table header.
  The form retains separate Name of the Accompanying Bank Official and
  Designation inputs; the report displays Name, Designation, while Karnataka
  Bank's signature uses the official name separately.
- Karnataka Bank reports include the bank-specific Format/Reference content
  and Branch Sanction page. Reports for other institutions omit those items.
- Progress and Completion default to Fill online for a linked finalized estimate
  with retained component costs. The CEO and assigned employee can choose
  Fill online or Complete offline and upload in Preparation Method, directly
  after Report Setup. Offline preparation keeps the assessment and replaces
  the online generation steps with a DOCX or PDF upload and one work note.
  The task-specific DOCX template includes the linked project and component costs
  with assessment fields ready to fill.
  Mark the task Completed separately. The same
  linked-estimate and assessment rules apply. A changed assessment or revised
  linked estimation requires review and a fresh attachment. The task records its
  own preparation method while the CEO filter still uses the linked estimate's.
- Online Progress/Completion retain their existing site-photograph and document
  rules, including at least one authenticated site photograph and a generated
  DOCX. Offline upload qualifies with the retained DOCX or PDF and requires
  no separate photo upload or preview. Only Filled template requires a prior
  template download.
- Revaluation is a separate assignment linked to an original Completed or Closed
  General or Agricultural Valuation. It pins the original retained report version
  and starts with an editable copy of its saved fields, excluding photos and maps.
  It uses the original preparation method by default and offers the applicable
  valuation methods, including existing bank-specific routes. When only an
  uploaded file is available, the original remains selectable and users can refer
  to the retained file to enter missing details. Revaluation has its own task ID,
  workflow and payment. The original task shows the Re-Valuation count and
  a newest-first table of linked Task IDs, assignment dates, and statuses.
  It receives audit events for creation, completion, reopening,
  cancellation and closure.
- A task-linked Progress/Completion preview remains approved across reloads
  while its saved details, component completion values, Karnataka Bank inputs,
  photographs, schema and template version remain unchanged. Changing a report
  input invalidates the preview and retained DOCX; workflow-only changes do
  not. Completion is blocked by the backend until the latest inputs have been
  previewed and a fresh DOCX generated.

## 8. Authentication lifecycle

- Accounts are provisioned by an operator; there is no public registration.
- Initial access uses an assigned User ID and one-time activation password.
- Activation requires a permanent password, authenticator-app enrollment,
  recovery-code acknowledgement, and verified recovery email.
- An account is not fully activated without a verified recovery email.
- Once active, users may sign in with User ID or verified email.
- Every fresh login requires TOTP. There is no trusted-device bypass under the
  current policy.
- Passwords must satisfy the configured strength policy and none of the last 5
  passwords may be reused.
- Self-service password recovery requires the verified recovery email.
- If the user loses all recovery factors, the operator performs assisted
  recovery; existing passwords, TOTP secrets, and recovery codes are never
  disclosed.
- Session expiry, lockout, CSRF, secure-cookie behavior, single-use tokens, and
  authentication audit rules documented in `docs/AUTHENTICATION.md` remain in
  force.
- Authentication data belongs in PostgreSQL's dedicated `auth` schema. Do not
  move it to `public`, and do not add business tables to `auth`.
- My Account is available to both roles. Display name, User ID, role and email
  are read-only. Users may preview, square-crop, save or remove a JPEG/PNG/WebP
  profile photo (up to 2 MB); initials remain the fallback.
- Signed-in password changes require the current password, matching new password
  and a fresh authenticator code. Strength and the five-password history apply
  to activation, recovery and voluntary changes. A successful voluntary change
  renews the current session, revokes other sessions, records a security event
  and sends a confirmation email. No periodic password expiry is imposed.
- Sessions expire after 60 minutes of inactivity or 24 hours from sign-in.
  Human activity extends only the inactivity timer. Notification polling and
  profile-image requests do not keep a session active.

## 8a. Shared branding and notifications

- Signed-in pages use SLN's supplied building monogram directly on the header
  background, with “Consultancy & Engineering Services” as the visible
  wordmark and the full firm name in the header link’s accessible label. The
  application and report-section sidebars show Powered by ValuX; ValuX is clickable with a
  Website coming soon tooltip and no destination until a URL is approved.
- Powered by ValuX uses the login wordmark's typography and original navy/orange
  colours. Collapsed sidebars display the original-colour ValuX logo instead;
  the dashboard also displays the full branding at its content footer while
  its application sidebar is collapsed.
- The shared top header uses a pale blue-grey background in light mode and
  muted slate in dark mode. It has My Account and a notification bell beside
  the icon-only appearance control, which is labelled for assistive technology.
  Notifications show task/customer, event, actor and tenant-local time, with
  links to assignment details, individual read controls and Mark all as read.
  Read state is durable per user; lists are bounded and load more on request.
  Closing an open panel marks the notifications it showed as read, including
  additional pages loaded during that opening.
- Only new events create notifications, in the same transaction as task history.
  Active recipients exclude the actor: assignment/transfer to the new assignee;
  On Hold transitions to CEOs; payment changes, Completed and Closed to CEOs
  and the current assignee; newly created Unassigned tasks to all active users.
  Repeated/no-op updates and ordinary work notes do not create notifications.
- Notification polling runs only on visible pages, approximately every 30 seconds.
  These are in-app notifications, without browser push, sound or notification emails.

## 9. Current deferred scope

The following plans are not authorized merely because they are documented:

- Migration of historical browser sample tasks into the durable database.
- Production deployment, backup, replication, or disaster recovery.
- A full administrator web interface and admin-account lifecycle.
- New frameworks, frontend build systems, or replacement of the current
  dependency-light architecture.

Each item requires its own approved design and implementation request.
