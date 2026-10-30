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
  Browser storage remains appropriate only for appearance and practice drafts.
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
- The report form can open only for an assigned active task. Employees must be
  the assignee; the father/CEO may open assigned work for review or completion.
- Reassignment and transfer use the same assignment action. A work note is
  mandatory and the activity history records the previous and new assignee.
- An active task may be placed On Hold with one of: Awaiting Documents,
  Scheduled Site Visit, Awaiting Review, Returned for Correction, or Custom.
- A hold action requires a work note. Selecting Custom means its explanation is
  written in the work note rather than added as another workflow state.
- Resume Work moves an On Hold task directly to In Progress. A work note is
  optional when resuming.
- A task can become Completed only after successful report generation while it
  is In Progress. A completion work note is mandatory.
- Completing a report returns the user to the dashboard.
- Cancellation reasons are Created by Mistake, Wrong Details, and Custom.
  Custom requires a work-note explanation. Cancellation is recorded in
  activity history.
- A Completed or Closed task may be reopened only by the father/CEO, within the
  configured seven-calendar-day reopening window from its completion or closure,
  with a mandatory work note. A newly
  generated DOCX is required before completing an ordinary valuation again.
  Karur Vysya Bank requires a newly attached completed KVB XLSX; Karnataka
  Bank requires a newly attached Valocity DOCX or PDF. An estimation requires
  a newly generated or attached completed XLSX.
- Task lists remain searchable and filterable. Search includes task ID,
  applicant/customer, report, institution, assignee, property details, state,
  hold reason, and payment state where supported.
- The task-list “Assigned during” filter supports an arbitrary selected day,
  week, month, or year; it is not limited to the present calendar period.
- Lists load bounded pages of records and fetch/show more rather than rendering
  an unbounded task collection at once.
- A non-Cancelled valuation or estimation assignment blocks creation of another
  assignment with the same report type, institution, assigned date, branch,
  applicant/customer, and property description. Cancelling the earlier task
  releases that duplicate restriction.
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
  For estimation work it is the latest completed XLSX, produced by the online
  form or attached after offline completion. Artifact and report-revision
  metadata remain registered; superseded development file bytes may be removed
  when they are no longer the immutable final artifact.

## 6. Dashboards and navigation

- Both roles see numbered cards for Unassigned, In Progress, On Hold,
  Completed, and Closed tasks, limited to their allowed report types.
- “Assignments” exposes the respective task states and leads to filterable task
  lists.
- “Payments” opens Completed reports requiring payment tracking.
- “Reports” opens Closed reports.
- Recent Activity can be filtered by state.
- Completed and Closed task rows with a retained report expose a direct
  download icon without requiring the task to be opened. The task detail view
  also exposes the retained report download. Completed uses the latest valid
  artifact; Closed uses the immutable final artifact.
- The layout should use available horizontal space efficiently, show useful
  task details before opening a record, and become compact on smaller screens.
- Father/CEO institution charts include every configured bank and NBFC, showing
  zero for institutions with no work in the selected period.
- Institution workload supports daily, weekly, monthly, and yearly views.
- Institution drill-down retains report-type and task filters and includes a
  route back to the all-institutions view.
- Father/CEO financial views show earned, received, and outstanding totals for
  all institutions and for an individual selected institution.
- Employee dashboards contain task and per-task payment information but no
  aggregate business-income analytics.
- Assignment lists export the complete currently filtered result set to a
  typed Excel workbook. The father/CEO institution directory also exports its
  workload and financial overview; employees do not receive that aggregate
  institution export.

## 7. Report-form boundary

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
- Agricultural rate unit labels use “per unit” without repeating “rate per
  unit” in the selected unit label. This agricultural wording must not be
  copied into general valuation unless explicitly requested.
- Preview and DOCX generation must remain consistent, with intentional page
  breaks, standardized fonts, and no static-template line breaks substituted
  for dynamic logic.
- DOCX is the completion-qualifying artifact for ordinary valuation work. A
  generated PDF is an optional direct-download copy and does not independently
  qualify the task for completion or closure.
- Estimation supports online form entry or a configured offline XLSX workflow.
  A completed estimation XLSX is required before completion and is retained at
  closure. Estimation reports do not require photo or map uploads.
- An online estimation preview remains approved across reloads while the saved
  workbook inputs, component configuration, schema and template version remain
  unchanged. Changing a workbook input invalidates the preview and retained
  completed XLSX; workflow-only changes do not. Changing between online and
  offline preparation retains entered component data but requires a newly
  generated or attached completed XLSX.
- An offline estimation upload is not required to preserve the downloaded
  workbook's formulas or formatting. Its worksheet topology and component list
  must match the configured workbook: missing, renamed, duplicated, additional
  or unrelated worksheets/components are rejected. Every configured component
  must have a numeric final value; zero is valid.
- Karur Vysya Bank general valuations use its supplied Excel format only: the
  application supplies a cleaned bank-template XLSX and the valuer attaches the
  completed XLSX. Karnataka Bank general valuations are completed in Valocity;
  the application supplies no online form or template and retains the Valocity
  DOCX or PDF attached by the valuer. Other valuation institutions retain the
  standard online DOCX workflow.
- Every Progress or Completion report is linked to one finalized Estimation
  task. The linked estimation supplies the applicant, property and immutable
  component estimated costs; users record only progress-specific details and
  completion values.
- Each completed estimation XLSX creates an immutable component-cost snapshot.
  A new Progress or Completion task is pinned to the selected estimation's
  latest snapshot at creation and does not silently change when that estimation
  is later reopened or regenerated.
- A linked report is classified as Completion only when every component is at
  100 percent and every balance-work amount is nil/zero. Otherwise it is a
  Progress report. The generated DOCX includes a Cost of Balance Work column.
- Karnataka Bank reports include the bank-specific Format/Reference content
  and Branch Sanction page. Reports for other institutions omit those items.
- Progress/Completion site photographs use the same upload and document-layout
  rules as valuation reports. At least one authenticated site photograph is
  mandatory for every Progress or Completion report. The final report artifact
  is DOCX.
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
- Passwords must satisfy the configured strength policy and none of the last 24
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

## 9. Current deferred scope

The following plans are not authorized merely because they are documented:

- Migration of historical browser sample tasks into the durable database.
- Production deployment, backup, replication, or disaster recovery.
- A full administrator web interface and admin-account lifecycle.
- New frameworks, frontend build systems, or replacement of the current
  dependency-light architecture.

Each item requires its own approved design and implementation request.
