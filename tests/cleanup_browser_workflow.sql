\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE browser_qa_tasks ON COMMIT DROP AS
SELECT id
FROM app.tasks
WHERE customer_name = :'marker'
  AND branch = 'Browser QA';

DELETE FROM app.task_activities
WHERE task_id IN (SELECT id FROM browser_qa_tasks);

DELETE FROM app.task_payments
WHERE task_id IN (SELECT id FROM browser_qa_tasks);

DELETE FROM app.tasks
WHERE id IN (SELECT id FROM browser_qa_tasks);

COMMIT;
