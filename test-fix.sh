#!/bin/bash
# test-fix.sh — Integration tests for Agent Workbench plugin
# Run after Krit's fixes: bash plugins/agent-workbench/test-fix.sh
# Expects daemon running on http://127.0.0.1:8787
set -euo pipefail

# Check dependencies
if ! command -v python3 &>/dev/null; then
  echo "[ERROR] python3 is required but not found" >&2
  exit 1
fi
if ! command -v curl &>/dev/null; then
  echo "[ERROR] curl is required but not found" >&2
  exit 1
fi

BASE="http://127.0.0.1:8787/plugin/agent-workbench"
PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS+1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL+1)); }
log_info() { echo -e "${YELLOW}[INFO]${NC} $1"; }

wait_for_run() {
  local runId="$1"
  local max_wait="${2:-120}"
  local waited=0
  while [ $waited -lt $max_wait ]; do
    local status
    status=$(curl -s "$BASE/status?runId=$runId" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
    if [ "$status" = "done" ]; then return 0; fi
    if [ "$status" = "error" ]; then return 1; fi
    sleep 2
    waited=$((waited+2))
  done
  return 2
}

# ============================================================================
# TEST 1: test-run-valid-agent
# ============================================================================
test_run_valid_agent() {
  log_info "TEST 1: test-run-valid-agent"

  local run_resp
  run_resp=$(curl -s -X POST "$BASE/run" \
    -H "content-type: application/json" \
    -d '{"agent":"ton","prompt":"Say exactly: hello","model":"haiku"}')

  local ok runId
  ok=$(echo "$run_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null)
  runId=$(echo "$run_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('runId',''))" 2>/dev/null)

  if [ "$ok" != "True" ] || [ -z "$runId" ]; then
    log_fail "POST /run did not return ok+runId: $run_resp"
    return
  fi
  log_info "  runId=$runId, waiting for completion..."

  wait_for_run "$runId" 120
  local exit_code=$?
  if [ $exit_code -eq 2 ]; then
    log_fail "Run timed out after 120s"
    return
  fi

  local result
  result=$(curl -s "$BASE/result?runId=$runId")

  local response
  response=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('run',{}).get('response',''))" 2>/dev/null)
  if [ -z "$response" ]; then
    log_fail "  response is empty (BUG-001 not fixed)"
  else
    log_pass "  response not empty: \"${response:0:60}...\""
  fi

  local input_tokens
  input_tokens=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('run',{}).get('usage',{}).get('input',0))" 2>/dev/null)
  local total_tokens
  total_tokens=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('run',{}).get('usage',{}).get('total',0))" 2>/dev/null)
  if [ "$total_tokens" -gt 0 ] 2>/dev/null; then
    log_pass "  usage.total > 0 ($total_tokens tokens, input=$input_tokens)"
  else
    log_fail "  usage.total is 0 or missing (got: $total_tokens)"
  fi

  local model
  model=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('run',{}).get('model',''))" 2>/dev/null)
  if echo "$model" | grep -qi "haiku"; then
    log_pass "  model contains 'haiku' ($model)"
  else
    log_fail "  model does not contain 'haiku' (got: $model)"
  fi
}

# ============================================================================
# TEST 2: test-run-invalid-agent
# ============================================================================
test_run_invalid_agent() {
  log_info "TEST 2: test-run-invalid-agent"

  local run_resp
  run_resp=$(curl -s -X POST "$BASE/run" \
    -H "content-type: application/json" \
    -d '{"agent":"notexist","prompt":"Hello"}')

  local ok error
  ok=$(echo "$run_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok',''))" 2>/dev/null)
  error=$(echo "$run_resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error',''))" 2>/dev/null)

  if [ "$ok" = "False" ] || [ "$ok" = "false" ]; then
    log_pass "  ok=false as expected"
  else
    log_fail "  ok is not false (got: $ok) — invalid agent not rejected"
  fi

  if [ -n "$error" ] && [ "$error" != "" ]; then
    log_pass "  error message present: \"$error\""
  else
    log_fail "  error message missing or empty"
  fi
}

# ============================================================================
# TEST 3: test-list-agents-valid
# ============================================================================
test_list_agents_valid() {
  log_info "TEST 3: test-list-agents-valid"

  local resp
  resp=$(curl -s "$BASE/agents")

  local ok count
  ok=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok',False))" 2>/dev/null)
  count=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null)

  if [ "$ok" = "True" ]; then
    log_pass "  ok=true"
  else
    log_fail "  ok is not true"
  fi

  if [ "$count" -ge 0 ] 2>/dev/null; then
    log_pass "  agent count >= 0 (${count})"
  else
    log_fail "  expected non-negative count, got $count"
  fi
}

# ============================================================================
echo "=========================================="
echo " Agent Workbench — Integration Test Suite"
echo " $(date)"
echo "=========================================="
echo ""

test_run_valid_agent
echo ""
test_run_invalid_agent
echo ""
test_list_agents_valid
echo ""

echo "=========================================="
echo -e " Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}"
echo "=========================================="

[ $FAIL -gt 0 ] && exit 1
exit 0
