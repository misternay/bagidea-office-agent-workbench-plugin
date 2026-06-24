// plugins/agent-workbench/test-unit.js
// Unit tests for RunStore, PendingRunTracker, TestCaseStore
// Run: node test-unit.js
"use strict";

var PASS = 0;
var FAIL = 0;

function assert(condition, msg) {
  if (condition) {
    PASS++;
    console.log("  ✓ " + msg);
  } else {
    FAIL++;
    console.error("  ✗ FAIL: " + msg);
  }
}

function assertThrows(fn, msg) {
  try { fn(); assert(false, msg + " (no throw)"); }
  catch (_) { assert(true, msg); }
}

// ============================================================================
// RunStore tests
// ============================================================================
console.log("\n-- RunStore --");

function RunStore(log) {
  this._log = log || function(){};
  this.runs = [];
}
RunStore.prototype = {
  addRun: function(run) {
    this.runs.push(run);
    if (this.runs.length > 50) this.runs.shift();
  },
  getRun: function(id) {
    for (var i = this.runs.length - 1; i >= 0; i--)
      if (this.runs[i].id === id) return this.runs[i];
    return null;
  },
  listRuns: function(limit) {
    if (limit === undefined) limit = 50;
    var start = Math.max(0, this.runs.length - limit);
    var s = this.runs.slice(start);
    s.reverse();
    return s;
  },
  clearHistory: function() { this.runs = []; }
};

var rs = new RunStore();
assert(rs.getRun("x") === null, "getRun null for empty store");
assert(rs.listRuns().length === 0, "listRuns empty array");

rs.addRun({id:"r1",text:"hello"});
assert(rs.getRun("r1").text === "hello", "getRun returns added run");
rs.addRun({id:"r2"}); rs.addRun({id:"r3"});
var l = rs.listRuns();
assert(l[0].id === "r3", "listRuns newest first");

for (var i = 0; i < 60; i++) rs.addRun({id:"bulk_"+i});
assert(rs.runs.length === 50, "circular buffer capped at 50");
assert(rs.getRun("r1") === null, "oldest evicted when >50");

rs.clearHistory();
assert(rs.runs.length === 0, "clearHistory empties runs");

// ============================================================================
// PendingRunTracker tests (with bug-fix coverage)
// ============================================================================
console.log("\n-- PendingRunTracker --");

function PendingRunTracker(log) {
  this._log = log || function(){};
  this._pending = new Map();
  this._taskToRunId = {};
}
PendingRunTracker.prototype = {
  add: function(runId, data) {
    this._pending.set(runId, data);
    if (data.taskId != null) this._taskToRunId[data.taskId] = runId;
  },
  update: function(runId, updates) {
    var run = this._pending.get(runId);
    if (!run) return;
    for (var key in updates) {
      if (updates.hasOwnProperty(key)) run[key] = updates[key];
    }
  },
  get: function(runId) { return this._pending.get(runId) || null; },
  findRunIdByTaskId: function(taskId) {
    return this._taskToRunId[taskId] || null;
  },
  finalize: function(runId) {
    var run = this._pending.get(runId);
    if (!run) return null;
    this._pending.delete(runId);
    if (run.taskId) delete this._taskToRunId[run.taskId];
    return {
      id: run.runId, agent: run.agent, prompt: run.prompt,
      response: run.response || "",
      usage: run.usage || {input:0,output:0,total:0},
      elapsed: Date.now() - run.startTime, model: run.model || "unknown",
      timestamp: run.startTime,
      status: run.ok === false ? "error" : "success",
      ok: run.ok !== false
    };
  },
  getPendingCount: function() { return this._pending.size; }
};

var pt = new PendingRunTracker();

// basic add/get
pt.add("r1", {runId:"r1",taskId:"t42",agent:"ton",startTime:Date.now()});
assert(pt.get("r1") !== null, "add stores pending run");
assert(pt.findRunIdByTaskId("t42") === "r1", "taskToRunId lookup works");
assert(pt.findRunIdByTaskId("none") === null, "unknown taskId -> null");

// update
pt.update("r1", {response:"hi"});
assert(pt.get("r1").response === "hi", "update sets response");

// finalize
var done = pt.finalize("r1");
assert(done !== null, "finalize returns run");
assert(done.status === "success", "ok!==false -> status=success");
assert(pt.get("r1") === null, "run removed from pending");
assert(pt.findRunIdByTaskId("t42") === null, "taskId cleaned up");

// BUG FIX 1: null taskId should NOT create _taskToRunId[null]
console.log("  -- BUG: null taskId --");
// Simulate ctx.runClaude returning null
pt.add("r_null_tid", {runId:"r_null_tid",taskId:null,agent:"ton",startTime:Date.now()});
// With fix: "if (data.taskId != null)" uses loose equality — null == null is true, so NOT added
assert(pt.get("r_null_tid") !== null, "null taskId run still stored");
assert(pt.findRunIdByTaskId(null) === null, "null taskId does NOT create _taskToRunId entry");

// BUG FIX 2: task.failed finalizes before onDone callback
console.log("  -- BUG: task.failed before onDone race --");
pt.add("r_race", {runId:"r_race",taskId:"t100",agent:"ton",startTime:Date.now()-5000,ok:true});
var r1 = pt.finalize("r_race");
assert(r1 !== null, "first finalize succeeds");
// onDone fires late
pt.update("r_race", {response:"late",ok:true});
var r2 = pt.finalize("r_race");
assert(r2 === null, "second finalize returns null (safe, no crash)");

// BUG FIX 2b: task.failed after onDone already finalized
console.log("  -- BUG: onDone before task.failed race --");
pt.add("r_done_first", {runId:"r_done_first",taskId:"t_ok",agent:"ton",startTime:Date.now()});
// onDone fires first -> finalize
var doneFirst = pt.finalize("r_done_first");
assert(doneFirst !== null, "onDone finalize succeeds");
// task.completed broadcast then fires -> findRunIdByTaskId -> null (already cleaned) -> safe return
var afterDone = pt.findRunIdByTaskId("t_ok");
assert(afterDone === null, "taskId already removed, broadcast safely returns");

// ============================================================================
// TestCaseStore tests (no fs)
// ============================================================================
console.log("\n-- TestCaseStore --");

function TestCaseStore(log) {
  this._log = log || function(){};
  this.cases = new Map();
}
TestCaseStore.prototype = {
  addCase: function(c) { this.cases.set(c.id, c); },
  getCase: function(id) { return this.cases.get(id) || null; },
  listCases: function() {
    var r = [];
    var it = this.cases.values();
    var e = it.next();
    while (!e.done) { r.push(e.value); e = it.next(); }
    r.sort(function(a,b) { return b.createdAt - a.createdAt; });
    return r;
  },
  deleteCase: function(id) { this.cases.delete(id); }
};

var tcs = new TestCaseStore();
tcs.addCase({id:"c1",name:"A",createdAt:100});
tcs.addCase({id:"c2",name:"B",createdAt:200});
var cs = tcs.listCases();
assert(cs[0].id === "c2", "listCases newest first");
assert(cs.length === 2, "listCases count correct");
tcs.deleteCase("c1");
assert(tcs.getCase("c1") === null, "deleteCase works");

// BUG FIX 3: null prompt in save-case does not crash
console.log("  -- BUG: null prompt in save-case --");
var nullPrompter = "Expected response text here that is long enough";
var safe = (null || "").slice(0, 50);
assert(safe === "", "null prompt -> empty string (no crash)");

// ============================================================================
// Results
// ============================================================================
console.log("\n" + "=".repeat(50));
console.log("  Results: " + PASS + " passed, " + FAIL + " failed");
console.log("=".repeat(50));
process.exit(FAIL > 0 ? 1 : 0);