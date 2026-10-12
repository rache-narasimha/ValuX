# SLN Property Report Application

Local web application for preparing property valuation forms and generating matching DOCX and PDF reports.

## Start the application

From the workspace root:

```sh
docker compose -f valuation_app/compose.yaml up --build -d
```

Open <http://127.0.0.1:4180>.

Stop the application with:

```sh
docker compose -f valuation_app/compose.yaml down
```

## Where to look

| Location                        | Purpose                                                                |
| ------------------------------- | ---------------------------------------------------------------------- |
| `backend/server.py`             | Small application entry point                                          |
| `backend/app/config.py`         | Paths and immutable application settings                               |
| `backend/app/schemas.py`        | General and agricultural form-schema assembly                          |
| `backend/app/formatting.py`     | Numbers, currency, dates, area conversion and repeatable-field helpers |
| `backend/app/calculations.py`   | Valuation and depreciation business calculations                       |
| `backend/app/ooxml.py`          | Low-level Word XML row and placeholder operations                      |
| `backend/app/media.py`          | Photograph normalization and document image layout                     |
| `backend/app/reports.py`        | High-level DOCX generators for both valuation types                    |
| `backend/app/web.py`            | HTTP routes, previews, static files and downloads                      |
| `frontend/pages/`               | Home page and form page HTML                                           |
| `frontend/assets/js/shared.js`  | Shared controls, parsing, dates, institutions and file-reading helpers  |
| `frontend/assets/js/`           | Report-specific browser controllers and home-page behavior              |
| `frontend/assets/css/`          | Shared application styling                                             |
| `resources/general/`            | General-property Word template, form schema and template mapping       |
| `resources/agricultural/`       | Agricultural Word template, form schema and template mapping           |
| `tests/`                        | Repeatable generation and document-layout checks                       |
| `outputs/generated_reports/`    | Reports produced by the running application                            |
| `outputs/test_artifacts/`       | DOCX files produced by automated tests                                 |
| `archive/template_development/` | Historical template builders, audits, renders and earlier prototypes   |
| `docs/ARCHITECTURE.md`          | Detailed component map and request flow                                |
| `docs/DEVELOPMENT.md`           | Common development and verification commands                           |

The archive is retained for reference but is not copied into the Docker image and is not used at runtime.

## Runtime behavior

- Form text is saved in the current browser's local storage.
- Uploaded photographs remain in the current browser session and must be selected again after a refresh.
- Preview creates a DOCX first, renders that exact DOCX to PDF, and reuses the same files for download.
- All generated files are written beneath `outputs/generated_reports/`.

For a deeper explanation, continue with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
