#!/bin/zsh
set -euo pipefail

app_url="${VALUX_QA_APP_URL:-http://127.0.0.1:4180}"
chrome_bin="${VALUX_QA_CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
qa_dir="$(mktemp -d /private/tmp/valux-browser-qa.XXXXXX)"
profile_dir="$qa_dir/chrome-profile"
bootstrap_port=4199
bootstrap_pid=""
ceo_token=""
employee_token=""

create_session() {
  local login_id="$1"
  docker compose exec -T -e VALUX_QA_LOGIN_ID="$login_id" valuation-report python -c \
    'import os; from backend.app.auth import service; from backend.app.auth.database import connection; login=os.environ["VALUX_QA_LOGIN_ID"]; manager=connection(); database=manager.__enter__(); user=database.execute("SELECT id FROM auth.users WHERE user_id = %s", (login,)).fetchone(); manager.__exit__(None, None, None); assert user, f"Missing QA login: {login}"; print(service.create_session(user["id"], "full", None, "127.0.0.1", "ValuX browser smoke test"))'
}

revoke_session() {
  local token="$1"
  [[ -z "$token" ]] && return
  docker compose exec -T -e VALUX_QA_REVOKE_TOKEN="$token" valuation-report python -c \
    'import os; from backend.app.auth import service; service.revoke_session(os.environ["VALUX_QA_REVOKE_TOKEN"], "127.0.0.1")' >/dev/null
}

stop_bootstrap() {
  if [[ -n "$bootstrap_pid" ]]; then
    kill "$bootstrap_pid" 2>/dev/null || true
    wait "$bootstrap_pid" 2>/dev/null || true
    bootstrap_pid=""
  fi
}

cleanup() {
  stop_bootstrap
  revoke_session "$ceo_token"
  revoke_session "$employee_token"
}
trap cleanup EXIT

set_browser_session() {
  local token="$1"
  stop_bootstrap
  VALUX_QA_TOKEN="$token" VALUX_QA_APP_URL="$app_url" VALUX_QA_PORT="$bootstrap_port" node -e \
    'const http=require("http"); const port=Number(process.env.VALUX_QA_PORT); http.createServer((request,response)=>{const path=new URL(request.url,"http://127.0.0.1").searchParams.get("path")||"/"; response.writeHead(302,{"Set-Cookie":`valux_session=${process.env.VALUX_QA_TOKEN}; Path=/; HttpOnly; SameSite=Strict`,Location:`${process.env.VALUX_QA_APP_URL}${path}`}); response.end();}).listen(port,"127.0.0.1");' \
    >"$qa_dir/bootstrap.log" 2>&1 &
  bootstrap_pid="$!"
  for _attempt in {1..30}; do
    curl -sS -o /dev/null "http://127.0.0.1:$bootstrap_port/" 2>/dev/null && break
    sleep 0.1
  done
}

dump_page() {
  local path="$1"
  local output="$2"
  "$chrome_bin" --headless=new --disable-gpu --no-first-run --user-data-dir="$profile_dir" \
    --virtual-time-budget=3000 --dump-dom "http://127.0.0.1:$bootstrap_port/?path=$path" >"$output" 2>>"$qa_dir/chrome.log"
}

capture_page() {
  local path="$1"
  local output="$2"
  "$chrome_bin" --headless=new --disable-gpu --no-first-run --user-data-dir="$profile_dir" \
    --window-size=1440,1000 --virtual-time-budget=3000 --screenshot="$output" "http://127.0.0.1:$bootstrap_port/?path=$path" \
    >/dev/null 2>>"$qa_dir/chrome.log"
}

capture_mobile_page() {
  local path="$1"
  local output="$2"
  "$chrome_bin" --headless=new --disable-gpu --no-first-run --user-data-dir="$profile_dir" \
    --window-size=390,844 --virtual-time-budget=3000 --screenshot="$output" "http://127.0.0.1:$bootstrap_port/?path=$path" \
    >/dev/null 2>>"$qa_dir/chrome.log"
}

ceo_token="$(create_session "${VALUX_QA_CEO_ID:-racheshiva01}")"
set_browser_session "$ceo_token"
dump_page "/" "$qa_dir/ceo-dashboard.html"
dump_page "/tasks" "$qa_dir/ceo-tasks.html"
dump_page "/tasks/new" "$qa_dir/ceo-new-task.html"
dump_page "/estimation?practice=1" "$qa_dir/ceo-estimation-practice.html"
dump_page "/progress-completion?practice=1" "$qa_dir/ceo-progress-practice.html"
capture_page "/" "$qa_dir/ceo-dashboard.png"
capture_page "/estimation?practice=1" "$qa_dir/ceo-estimation-practice.png"
capture_page "/progress-completion?practice=1" "$qa_dir/ceo-progress-practice.png"
capture_mobile_page "/" "$qa_dir/ceo-dashboard-mobile.png"
capture_mobile_page "/estimation?practice=1" "$qa_dir/ceo-estimation-practice-mobile.png"
capture_mobile_page "/progress-completion?practice=1" "$qa_dir/ceo-progress-practice-mobile.png"
stop_bootstrap

rg -q 'K\. Sivaprasad' "$qa_dir/ceo-dashboard.html"
rg -q '>CEO<' "$qa_dir/ceo-dashboard.html"
rg -q 'id="father-business"' "$qa_dir/ceo-dashboard.html"
rg -q 'class="horizontal-chart-row"' "$qa_dir/ceo-dashboard.html"
rg -q 'Canara Bank' "$qa_dir/ceo-dashboard.html"
rg -q 'href="/tasks/new"' "$qa_dir/ceo-tasks.html"
rg -q 'task-table-payment' "$qa_dir/ceo-tasks.html"
rg -q 'id="new-task-form"' "$qa_dir/ceo-new-task.html"
rg -q 'id="estimation-form"' "$qa_dir/ceo-estimation-practice.html"
rg -q 'class="estimation-utility-bar"' "$qa_dir/ceo-estimation-practice.html"
rg -q '>Report Setup<' "$qa_dir/ceo-estimation-practice.html"
rg -q 'id="progress-form"' "$qa_dir/ceo-progress-practice.html"
rg -q 'id="practice-estimation"' "$qa_dir/ceo-progress-practice.html"
rg -q '>Report setup<' "$qa_dir/ceo-progress-practice.html"

employee_token="$(create_session "${VALUX_QA_EMPLOYEE_ID:-lavk0401}")"
set_browser_session "$employee_token"
dump_page "/" "$qa_dir/employee-dashboard.html"
dump_page "/tasks" "$qa_dir/employee-tasks.html"
dump_page "/tasks/new" "$qa_dir/employee-new-task.html"
employee_task_path="$(rg -o 'href="/tasks/detail\?id=[^"]+' "$qa_dir/employee-tasks.html" | head -1 | cut -d'"' -f2)"
[[ -n "$employee_task_path" ]]
dump_page "$employee_task_path" "$qa_dir/employee-task-detail.html"
capture_page "/" "$qa_dir/employee-dashboard.png"
capture_mobile_page "/" "$qa_dir/employee-dashboard-mobile.png"
stop_bootstrap

rg -q 'Lavakumar' "$qa_dir/employee-dashboard.html"
rg -q '>Employee<' "$qa_dir/employee-dashboard.html"
rg -q 'id="father-business" hidden' "$qa_dir/employee-dashboard.html"
rg -q 'id="payment-dashboard-card"' "$qa_dir/employee-dashboard.html"
rg -q 'id="new-task-form"' "$qa_dir/employee-new-task.html"
rg -q 'id="payment-card"' "$qa_dir/employee-task-detail.html"
rg -q 'href="/tasks/new"' "$qa_dir/employee-tasks.html"
rg -q 'task-table-payment' "$qa_dir/employee-tasks.html"

echo "PASS: CEO and employee dashboards render distinct, role-correct interfaces"
echo "QA artifacts: $qa_dir"
