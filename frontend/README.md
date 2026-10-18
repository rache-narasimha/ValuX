# Frontend Ownership Map

The frontend intentionally uses plain browser JavaScript and stable global APIs.
There is no bundler, so `<script>` order in each page is part of the runtime
contract.

## JavaScript

- `assets/js/core/`: cross-page state and infrastructure. This is where shared
  repositories, permissions, appearance, the application shell, and base form
  utilities belong.
- `assets/js/components/`: reusable UI behavior consumed by more than one page,
  such as payment dialogs, employee selection, metrics, and report context.
- `assets/js/pages/`: one controller per HTML page. Page controllers coordinate
  core APIs and components; they should not duplicate lifecycle or permission
  rules.

Shared scripts publish the documented `window.*` contracts in
`docs/CODEBASE_GUIDE.md`. Preserve those names and load shared dependencies
before the page controller.

## CSS

HTML pages link only the stable entry points:

- `assets/css/auth.css`
- `assets/css/styles.css`
- `assets/css/workflow.css`

Each entry point imports responsibility-specific files from its matching
subfolder. Import order preserves the cascade and must not be changed casually.

## Pages

`pages/` contains route-level HTML shells. Shared application navigation is
created by `core/app-shell.js`; authentication presentation remains isolated in
`auth.html`.

When adding a feature, put its rule in the narrowest existing owner rather than
creating a second implementation in a page controller.
