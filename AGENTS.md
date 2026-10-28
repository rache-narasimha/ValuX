# ValuX / SLN repository instructions

These instructions apply to every task performed anywhere in this repository.
Read them before inspecting, editing, testing, committing, or running the
application.

## Scope and authorization

- Implement only the change the user explicitly requested. A related or
  technically convenient change is not automatically authorized.
- When a material ambiguity could affect behavior, data, permissions,
  workflows, routes, generated documents, or appearance, stop and ask the user
  before editing. Do not silently choose a product decision.
- A request to change presentation authorizes presentation changes only. It
  does not authorize changes to business logic, permissions, routes, storage,
  validation, or report output.
- Authentication work does not authorize changes to authorization. Never add,
  remove, or tighten role permissions unless the user explicitly requests the
  exact permission change.
- Refactoring or cleanup does not authorize observable changes. Preserve
  behavior, public identifiers, URL parameters, storage keys, API contracts,
  document output, styling, and responsive behavior unless specifically in
  scope.
- A requested change to one report type applies only to that report type.
  Never copy it to another report type unless the user explicitly says to
  change both.
- Do not implement ideas recorded as deferred, proposed, future, optional, or
  under discussion. They are context, not authorization.
- Read-only requests do not authorize file edits, external writes, container
  changes, commits, or pushes.
- Do not commit or push unless the user explicitly requests it. Before a
  requested commit, verify that no credentials, generated output, or unrelated
  files will be included.

## Product source of truth

- Read `docs/PRODUCT_RULES.md` before changing authentication, authorization,
  dashboards, assignments, task lifecycle, payments, institutions, report
  forms, previews, or generated documents.
- Treat the current implementation and automated tests as the source of truth
  for behavior not addressed by that document.
- If the requested change conflicts with `docs/PRODUCT_RULES.md`, describe the
  conflict and obtain explicit confirmation before changing the rule and its
  tests.
- Keep `docs/PRODUCT_RULES.md` synchronized when the user explicitly approves a
  permanent product-rule change.

## Required working method

1. Inspect `git status` and the relevant implementation before editing.
2. Identify the narrowest owning module using `docs/CODEBASE_GUIDE.md`.
3. State the intended scope. Preserve all unrelated working-tree changes.
4. Make the smallest cohesive change; do not add dependencies or introduce an
   architectural pattern unless the request requires it.
5. Inspect the final diff for scope creep and accidental behavior changes.
6. Run the checks appropriate to every affected boundary.
7. Report what changed, what was validated, and any limitation. Never claim a
   check passed unless it was actually run.

## Mandatory regression boundaries

- Permission changes: run `node tests/test_workflow_access.js` and the role UI
  smoke test when browser execution is available.
- Task lifecycle or payment changes: run `node tests/test_task_store.js` and
  `node tests/test_workflow_access.js`.
- Frontend structure or shared shell changes: run
  `node tests/test_frontend_contracts.js` and syntax-check all frontend
  JavaScript.
- Authentication changes: run the authentication security, password-history,
  and full activation/recovery tests. The full flow must use Mailpit for
  regression testing and restore the configured mail mode afterward.
- Report or template changes: run both general and agricultural generation
  tests unless the test itself cannot apply to the unaffected report type.
- Always run `git diff --check` before handoff or commit.

## Engineering expectations

- Keep code readable, maintainable, and organized by the existing domain
  boundaries. Prefer clear names and small cohesive functions over compressed
  code.
- Preserve the dependency-light architecture unless a separate architectural
  change is explicitly approved.
- Keep authorization decisions centralized in `WorkflowAccess` and lifecycle
  invariants centralized in `TaskStore`; page controllers must not invent
  different rules.
- Keep secrets in ignored environment files. Never print, commit, or expose
  passwords, SMTP credentials, tokens, recovery codes, or encryption keys.
- Preserve user data and existing changes. Do not use destructive Git or
  filesystem operations to make a task easier.
