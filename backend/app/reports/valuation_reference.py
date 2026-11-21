"""Read issued estimation snapshots as optional valuation references.

This does not create a Progress/Completion link or acquire its lifecycle lock.
"""

import uuid

from ..estimation.presentation import component_labels
from . import service


def estimation_references(session, *, search="", offset=0):
    limit = 20
    offset = max(0, min(int(offset or 0), 100000))
    search = str(search or "").strip()[:160]
    with service.connection() as database:
        rows = database.execute(
            """SELECT t.task_code, t.customer_name, t.property_brief,
                      t.institution_name_snapshot, t.branch, s.id AS snapshot_id
               FROM app.tasks t
               JOIN app.task_artifacts a ON a.id=CASE WHEN t.status='Closed' THEN t.final_artifact_id ELSE t.latest_artifact_id END
               JOIN app.stored_files sf ON sf.id=a.stored_file_id AND sf.removed_at IS NULL
               JOIN app.estimation_snapshots s ON s.estimation_task_id=t.id AND s.source_revision_id=a.report_revision_id
               WHERE t.report_group='estimation' AND t.status IN ('Completed','Closed')
                 AND a.stale_at IS NULL
                 AND (%s='' OR CONCAT_WS(' ',t.task_code,t.customer_name,t.property_brief,t.institution_name_snapshot,t.branch) ILIKE %s)
               ORDER BY t.assigned_date DESC,t.task_code DESC LIMIT %s OFFSET %s""",
            (search, f"%{search}%", limit + 1, offset),
        ).fetchall()
    return {"items": [{"taskCode": r["task_code"], "customerName": r["customer_name"],
                       "propertyBrief": r["property_brief"], "institutionName": r["institution_name_snapshot"],
                       "branch": r["branch"], "snapshotId": str(r["snapshot_id"])} for r in rows[:limit]],
            "hasMore": len(rows) > limit, "nextOffset": offset + limit}


def estimation_reference(task_code, snapshot_id, session):
    try:
        snapshot_id = uuid.UUID(str(snapshot_id))
    except ValueError:
        raise service.ReportDataError("Select an issued estimation snapshot.") from None
    with service.connection() as database:
        record = database.execute(
            """SELECT s.*,t.task_code,t.customer_name,t.institution_name_snapshot,t.branch,
                      r.payload AS revision_payload
               FROM app.estimation_snapshots s
               JOIN app.tasks t ON t.id=s.estimation_task_id
               JOIN app.report_revisions r ON r.id=s.source_revision_id
               WHERE t.task_code=%s AND s.id=%s AND t.report_group='estimation'""",
            (task_code, snapshot_id),
        ).fetchone()
        if not record:
            raise service.ReportDataError("Estimation snapshot not found.", 404, "not_found")
        # Pinned snapshots remain readable after an estimate is reopened. Only
        # issued revisions can be adopted, including from the retained history.
        issued = database.execute(
            """SELECT 1 FROM app.task_artifacts a
               WHERE a.task_id=%s AND a.report_revision_id=%s
                 AND a.artifact_type IN ('estimation_xlsx','estimation_docx','estimation_pdf')""",
            (record["estimation_task_id"], record["source_revision_id"]),
        ).fetchone()
        if not issued:
            raise service.ReportDataError("This estimation revision has no issued report.")
        items = database.execute(
            "SELECT * FROM app.estimation_snapshot_items WHERE snapshot_id=%s ORDER BY display_order,item_key",
            (snapshot_id,),
        ).fetchall()
    revision = record["revision_payload"] or {}
    source = revision.get("draft") or revision.get("form") or {}
    source = source.get("state") or source
    configurations = {r["id"]: r for r in component_labels(source)}
    components = []
    for item in items:
        source_id = (item["details"] or {}).get("sourceId") or item["item_key"]
        config = configurations.get(source_id) or {}
        sheet = config.get("sheet") or {}
        components.append({"id": source_id, "label": item["label"],
                           "estimatedCost": float(item["estimated_cost"]), "source": item["source_type"],
                           "floorCount": max(1, len(sheet.get("typicalFloorKeys") or [])),
                           "hasBuildingConfiguration": bool(config.get("sheet")),
                           "componentName": (config.get("component") or {}).get("name") or item["label"]})
    return {"taskCode": record["task_code"], "snapshotId": str(snapshot_id),
            "revisionId": str(record["source_revision_id"]), "snapshotNumber": record["snapshot_number"],
            "customerName": record["customer_name"], "components": components}
