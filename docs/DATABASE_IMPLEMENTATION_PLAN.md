# Durable business-data implementation plan

This plan records the approved development-stage database work. Production
hosting and cloud object storage will be planned only after the development
application is fully functional.

## Development data locations

- PostgreSQL `auth` schema: identity, sessions, MFA and authentication audit.
- PostgreSQL `app` schema: institutions, assignments, activity, payments,
  task-linked drafts, report revisions, file metadata and estimation snapshots.
- Local filesystem: actual generated and uploaded DOCX, XLSX, PDF and image
  files. PostgreSQL stores their storage keys, not their bytes or absolute paths.
- Browser storage: appearance preferences and practice-form drafts only after
  the final frontend cutover.

## Phase 1 — database foundation

**Status: implemented and verified.**

Create the separate `app` schema, versioned migrations, least-privilege grants,
business tables, uniqueness protection, estimation linkage, immutable snapshot
structure and the permanent Completion lock fields. Existing browser workflow
remains active during this phase.

## Phase 2 — backend workflow and frontend connection

**Status: implemented and verified.**

Move task creation, assignment, transfer, hold/resume, completion, closure,
reopening, cancellation, payments, lists, dashboards and institution settings
behind authenticated backend APIs. The backend becomes the authority for role,
transition, duplicate and concurrency validation.

Replace the growing linked-estimation dropdown with a searchable, filterable,
paginated single-selection window whose eligible records come from the backend.
When a Completion task first reaches `Completed`, permanently block its linked
estimation from any new Progress or Completion assignment.

## Phase 3 — reports, drafts and local files

**Status: implemented and verified.**

Persist task-linked form drafts, register every generated/uploaded artifact,
serve local files through authenticated routes, create immutable estimation
component snapshots and pin each Progress/Completion task to the selected
snapshot. Report formats and approved generator behavior remain unchanged.

## Phase 4 — development cutover and verification

**Status: implemented and verified.**

Remove real business-data dependence on browser repositories; retain only
appearance preferences and practice drafts locally. Verify both roles, every
workflow transition, payments, reopening, duplicate and concurrency protection,
all report paths, artifact replacement/removal/download, restart persistence,
database recovery and local-file persistence.

The development verification includes a real task, task-linked draft and
artifact surviving PostgreSQL/application restart, plus a PostgreSQL backup
restored into an isolated temporary database. Production backup scheduling,
retention and off-site storage remain part of the later deployment plan.

After Phase 4, plan production hosting, HTTPS, Cloudflare R2, secrets, backups,
monitoring, deployment and recovery as a separate approved project phase.
