// plugins/agent-workbench/index.js
// Agent Workbench — Test and benchmark AI agents
// Architecture Spec v2.0
"use strict";

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateId() {
  var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  var random = "";
  for (var i = 0; i < 4; i++) {
    random += chars[Math.floor(Math.random() * chars.length)];
  }
  return "run_" + Date.now() + "_" + random;
}

function randomString(len) {
  var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  var s = "";
  for (var i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

// ---------------------------------------------------------------------------
// RunStore — in-memory circular buffer, max 50 runs
// ---------------------------------------------------------------------------

function RunStore(log) {
  this._log = log;
  this.runs = [];  // ordered oldest → newest
}

RunStore.prototype.addRun = function (run) {
  this.runs.push(run);
  if (this.runs.length > 50) {
    this.runs.shift();  // Remove oldest
  }
};

RunStore.prototype.getRun = function (id) {
  for (var i = this.runs.length - 1; i >= 0; i--) {
    if (this.runs[i].id === id) return this.runs[i];
  }
  return null;
};

RunStore.prototype.listRuns = function (limit) {
  if (limit === undefined) limit = 50;
  var start = Math.max(0, this.runs.length - limit);
  var slice = this.runs.slice(start);
  slice.reverse();  // newest first
  return slice;
};

RunStore.prototype.clearHistory = function () {
  this.runs = [];
};

// ---------------------------------------------------------------------------
// PendingRunTracker — track in-flight runs (Map<runId → PendingRun>)
// ---------------------------------------------------------------------------

function PendingRunTracker(log) {
  this._log = log;
  this._pending = new Map();   // runId → PendingRun
  this._taskToRunId = {};      // taskId → runId (fast lookup for onBroadcast)
}

PendingRunTracker.prototype.add = function (runId, data) {
  this._pending.set(runId, data);
  if (data.taskId != null) {
    this._taskToRunId[data.taskId] = runId;
  }
  this._log("[agent-workbench] tracking run " + runId + " (task " + data.taskId + ")");
};

PendingRunTracker.prototype.update = function (runId, updates) {
  var run = this._pending.get(runId);
  if (!run) return;

  for (var key in updates) {
    if (updates.hasOwnProperty(key)) {
      run[key] = updates[key];
    }
  }
};

PendingRunTracker.prototype.get = function (runId) {
  return this._pending.get(runId) || null;
};

PendingRunTracker.prototype.findRunIdByTaskId = function (taskId) {
  return this._taskToRunId[taskId] || null;
};

PendingRunTracker.prototype.finalize = function (runId) {
  var run = this._pending.get(runId);
  if (!run) return null;

  this._pending.delete(runId);
  if (run.taskId) {
    delete this._taskToRunId[run.taskId];
  }

  // Convert PendingRun to completed Run
  return {
    id: run.runId,
    agent: run.agent,
    prompt: run.prompt,
    response: run.response || "",
    usage: run.usage || { input: 0, output: 0, total: 0 },
    elapsed: Date.now() - run.startTime,
    model: run.model || "unknown",
    timestamp: run.startTime,
    status: run.ok === false ? "error" : "success",
    ok: run.ok !== false,
  };
};

PendingRunTracker.prototype.cleanup = function () {
  var now = Date.now();
  var self = this;
  this._pending.forEach(function (run, runId) {
    if (now - run.startTime > 600000) {  // 10 min timeout
      self._log("[agent-workbench] stale run " + runId + " (>10min), removing");
      self._pending.delete(runId);
      if (run.taskId) {
        delete self._taskToRunId[run.taskId];
      }
    }
  });
};

// ---------------------------------------------------------------------------
// TestCaseStore — JSON file persistence with atomic write
// ---------------------------------------------------------------------------

function TestCaseStore(log) {
  this._log = log;
  this.cases = new Map();  // id → TestCase
}

TestCaseStore.prototype.load = function (dataDir) {
  var fs = require("fs");
  var path = require("path");
  var filePath = path.join(dataDir, "test-cases.json");

  if (fs.existsSync(filePath)) {
    try {
      var raw = fs.readFileSync(filePath, "utf8");
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.cases)) {
        for (var i = 0; i < data.cases.length; i++) {
          var c = data.cases[i];
          if (c && c.id) this.cases.set(c.id, c);
        }
        this._log("[agent-workbench] loaded " + this.cases.size + " test cases");
      }
    } catch (err) {
      this._log("[agent-workbench] test-cases.json corrupt: " + err.message + " — starting fresh");
    }
  }
};

TestCaseStore.prototype.save = function (dataDir) {
  var fs = require("fs");
  var path = require("path");
  var filePath = path.join(dataDir, "test-cases.json");

  // Collect all cases from Map into array
  var cases = [];
  var iter = this.cases.values();
  var entry = iter.next();
  while (!entry.done) {
    cases.push(entry.value);
    entry = iter.next();
  }

  var payload = { cases: cases, savedAt: new Date().toISOString() };
  try {
    // Atomic write: write to .tmp, then rename
    var tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    this._log("[agent-workbench] save error: " + err.message);
  }
};

TestCaseStore.prototype.addCase = function (testCase) {
  this.cases.set(testCase.id, testCase);
};

TestCaseStore.prototype.getCase = function (id) {
  return this.cases.get(id) || null;
};

TestCaseStore.prototype.listCases = function () {
  var result = [];
  var iter = this.cases.values();
  var entry = iter.next();
  while (!entry.done) {
    result.push(entry.value);
    entry = iter.next();
  }
  // Sort newest first
  result.sort(function (a, b) { return b.createdAt - a.createdAt; });
  return result;
};

TestCaseStore.prototype.deleteCase = function (id) {
  this.cases.delete(id);
};

// ---------------------------------------------------------------------------
// Agent roster — pull from ctx.reg
// ---------------------------------------------------------------------------

function getAgentRoster(ctx) {
  var agents = [];
  var reg = ctx.reg;

  if (reg && reg.agents) {
    var agentMap = reg.agents;
    var keys = Object.keys(agentMap);

    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      var agent = agentMap[id];
      agents.push({
        id: id,
        name: agent.name || id,
        role: agent.role || "Unknown",
        description: agent.description || "",
        model: agent.model || "default",
        status: "online",
      });
    }
  }

  return agents;
}

// ---------------------------------------------------------------------------
// Plugin factory — ctx injected by daemon/plugins.js
// ---------------------------------------------------------------------------

module.exports = function (ctx) {
  var fs = require("fs");
  var path = require("path");
  var url = require("url");

  // Ensure data directory exists
  var dataDir = ctx.dataDir;
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // Initialize stores
  var store = new RunStore(ctx.log);
  var tracker = new PendingRunTracker(ctx.log);
  var testCaseStore = new TestCaseStore(ctx.log);
  testCaseStore.load(dataDir);

  // Periodic stale-run cleanup (every 30s)
  var cleanupTimer = setInterval(function () {
    tracker.cleanup();
  }, 30000);

  ctx.log("[agent-workbench] loaded — max 50 runs, " + testCaseStore.cases.size + " test cases");

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function parseQuery(req) {
    var parsed = url.parse(req.url, true);
    return parsed.query || {};
  }

  function readBody(req, cb) {
    var chunks = [];
    req.on("data", function (chunk) { chunks.push(chunk); });
    req.on("end", function () {
      var body = Buffer.concat(chunks).toString("utf8");
      try { cb(JSON.parse(body)); } catch (_) { cb(null); }
    });
  }

  function sendJSON(res, status, data) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  }

  // ---------------------------------------------------------------------------
  // onCommand — agent command interface (POST /plugin/agent-workbench/cmd)
  // ---------------------------------------------------------------------------

  function onCommand(cmd, args, reply) {
    try {
      // ── run ──────────────────────────────────────────────────────────
      if (cmd === "run") {
        if (!args || !args.agent || !args.prompt) {
          return reply({ ok: false, error: "agent and prompt are required" });
        }

        // BUG-003: validate agent exists in registry
        if (!ctx.reg || !ctx.reg.agents || !ctx.reg.agents[args.agent]) {
          ctx.log("[agent-workbench] agent not found: " + args.agent);
          return reply({ ok: false, error: "agent not found: " + args.agent });
        }

        var runId = generateId();
        var startTime = Date.now();
        // BUG-002: accept model override from args
        var requestedModel = args.model || null;

        var taskId = ctx.runClaude(args.agent, args.prompt, {
          onDone: function (text, ok) {
            tracker.update(runId, {
              response: text,
              ok: ok,
              status: "done",
            });
            var run = tracker.finalize(runId);
            if (run) {
              // BUG-002: if user requested a model, use it in output
              if (requestedModel) run.model = requestedModel;
              store.addRun(run);
              ctx.log("[agent-workbench] run " + runId + " completed — " +
                run.usage.total + " tokens, " + run.elapsed + "ms, model=" + run.model);
            }
          }
        });

        // BUG-001 fix: guard against ctx.runClaude returning null/undefined
        if (!taskId) {
          ctx.log("[agent-workbench] runClaude returned null for agent=" + args.agent);
          return reply({ ok: false, error: "agent " + args.agent + " is unavailable" });
        }

        tracker.add(runId, {
          runId: runId,
          taskId: taskId,
          agent: args.agent,
          prompt: args.prompt,
          requestedModel: requestedModel,
          startTime: startTime,
          status: "running",
        });

        return reply({ ok: true, runId: runId, taskId: taskId });
      }

      // ── list-agents ──────────────────────────────────────────────────
      if (cmd === "list-agents") {
        var agents = getAgentRoster(ctx);
        return reply({ ok: true, count: agents.length, agents: agents });
      }

      // ── save-case ────────────────────────────────────────────────────
      if (cmd === "save-case") {
        if (!args || !args.runId) {
          return reply({ ok: false, error: "runId is required" });
        }

        var run = store.getRun(args.runId);
        if (!run) {
          return reply({ ok: false, error: "run not found" });
        }

        var testCase = {
          id: "case_" + Date.now() + "_" + randomString(4),
          name: args.name || (run.prompt || "").slice(0, 50),
          agent: run.agent,
          prompt: run.prompt,
          expectedResponse: run.response,
          baselineUsage: run.usage,
          baselineElapsed: run.elapsed,
          createdAt: Date.now(),
          runCount: 1,
          lastRunAt: run.timestamp,
        };

        testCaseStore.addCase(testCase);
        testCaseStore.save(dataDir);

        // Mark run as saved
        run.savedAsCase = testCase.id;

        return reply({ ok: true, case: testCase });
      }

      return reply({ ok: false, error: "unknown command: " + cmd });
    } catch (e) {
      ctx.log("[agent-workbench] onCommand error: " + e.message);
      return reply({ ok: false, error: e.message });
    }
  }

  // ---------------------------------------------------------------------------
  // onBroadcast — intercept task lifecycle events
  // ---------------------------------------------------------------------------

  function onBroadcast(evt) {
    try {
      if (evt.type === "task.completed") {
        // Correlate with pending run via taskId
        var runId = tracker.findRunIdByTaskId(evt.task);
        if (!runId) {
          return;
        }

        // BUG-003 fix: guard against race condition task.completed ↔ onDone.
        // If the run was already finalized (by onDone or another event),
        // silently ignore — double-finalize returns null, losing the result.
        if (!tracker.get(runId)) {
          ctx.log("[agent-workbench] task.completed for already-finalized run " + runId + " — ignoring");
          return;
        }

        // Extract token usage from broadcast event
        var usage = evt.usage || { in: 0, out: 0 };
        // BUG-001 debug: log full broadcast usage to trace input_tokens
        ctx.log("[agent-workbench] broadcast usage=" + JSON.stringify(evt.usage) + " model=" + evt.model);
        var model = evt.model || "unknown";

        // BUG-001 fix: broadcast fires BEFORE onDone (daemon L1787→L1795).
        // Only store usage/model here — finalize happens in onDone callback
        // which runs LAST and has both response text + usage metadata.
        tracker.update(runId, {
          usage: {
            input: usage.in || 0,
            output: usage.out || 0,
            total: (usage.in || 0) + (usage.out || 0),
          },
          model: model,
        });
      }

      if (evt.type === "task.failed") {
        var failedRunId = tracker.findRunIdByTaskId(evt.task);
        if (!failedRunId) return;

        // BUG-003 fix: only finalize if the run is still pending.
        // onDone callback may have already finalized it (daemon fires both
        // task.failed broadcast AND onDone callback). Double-finalize is safe
        // (returns null) but the second finalize would lose the onDone result.
        if (!tracker.get(failedRunId)) {
          ctx.log("[agent-workbench] task.failed for already-finalized run " + failedRunId + " — ignoring");
          return;
        }

        var failUsage = (evt.usage && evt.usage.in != null)
          ? { input: evt.usage.in || 0, output: evt.usage.out || 0, total: (evt.usage.in || 0) + (evt.usage.out || 0) }
          : { input: 0, output: 0, total: 0 };

        tracker.update(failedRunId, {
          response: evt.reason || "(task failed)",
          ok: false,
          status: "error",
          usage: failUsage,
          model: evt.model || "unknown",
        });

        var failedRun = tracker.finalize(failedRunId);
        if (failedRun) {
          store.addRun(failedRun);
          ctx.log("[agent-workbench] run " + failedRunId + " failed — " +
            (evt.reason || "unknown reason"));
        }
      }
    } catch (e) {
      ctx.log("[agent-workbench] onBroadcast error: " + e.message);
    }
  }

  // ---------------------------------------------------------------------------
  // REST routes — for panel.html and external clients
  // ---------------------------------------------------------------------------

  var routes = {
    // POST /run — start a run, return {ok, runId, taskId} immediately
    run: function (req, res) {
      if (req.method !== "POST") {
        return sendJSON(res, 405, { ok: false, error: "method not allowed" });
      }

      readBody(req, function (body) {
        if (!body || !body.agent || !body.prompt) {
          return sendJSON(res, 400, { ok: false, error: "agent and prompt are required" });
        }

        // BUG-003: validate agent exists in registry
        if (!ctx.reg || !ctx.reg.agents || !ctx.reg.agents[body.agent]) {
          ctx.log("[agent-workbench] agent not found: " + body.agent);
          return sendJSON(res, 400, { ok: false, error: "agent not found: " + body.agent });
        }

        var runId = generateId();
        var startTime = Date.now();
        // BUG-002: accept model override from body
        var requestedModel = body.model || null;

        var taskId = ctx.runClaude(body.agent, body.prompt, {
          onDone: function (text, ok) {
            tracker.update(runId, {
              response: text,
              ok: ok,
              status: "done",
            });
            var run = tracker.finalize(runId);
            if (run) {
              // BUG-002: if user requested a model, use it in output
              if (requestedModel) run.model = requestedModel;
              store.addRun(run);
              ctx.log("[agent-workbench] run " + runId + " completed — " +
                run.usage.total + " tokens, " + run.elapsed + "ms, model=" + run.model);
            }
          }
        });

                if (!taskId) {
          ctx.log("[agent-workbench] runClaude returned null for agent=" + body.agent);
          return sendJSON(res, 500, { ok: false, error: "agent " + body.agent + " is unavailable" });
        }

        ctx.log("[agent-workbench] POST /run taskId=" + taskId + " runId=" + runId + " model=" + (requestedModel || "default") + " _taskToRunId keys=" + JSON.stringify(Object.keys(tracker._taskToRunId)));
        tracker.add(runId, {
          runId: runId,
          taskId: taskId,
          agent: body.agent,
          prompt: body.prompt,
          requestedModel: requestedModel,
          startTime: startTime,
          status: "running",
        });

        sendJSON(res, 200, { ok: true, runId: runId, taskId: taskId });
      });
    },

    // GET /status?runId=X — poll run status (running/done/error)
    status: function (req, res) {
      var query = parseQuery(req);
      // BUG-002: PRD/panel.html send ?id=, but clients may also send ?runId=
      var runId = query.id || query.runId;
      if (!runId) {
        return sendJSON(res, 400, { ok: false, error: "id or runId is required" });
      }

      var run = tracker.get(runId);
      if (!run) {
        // Check if already completed and in RunStore
        var completed = store.getRun(runId);
        if (completed) {
          return sendJSON(res, 200, {
            ok: true,
            status: "done",
            elapsed: completed.elapsed,
          });
        }
        return sendJSON(res, 404, { ok: false, error: "run not found" });
      }

      sendJSON(res, 200, {
        ok: true,
        status: run.status,
        elapsed: Date.now() - run.startTime,
      });
    },

    // GET /result?runId=X — get completed run result
    result: function (req, res) {
      var query = parseQuery(req);
      var runId = query.id || query.runId;
      if (!runId) {
        return sendJSON(res, 400, { ok: false, error: "id or runId is required" });
      }

      var run = store.getRun(runId);
      if (!run) {
        // Check if still pending
        var pending = tracker.get(runId);
        if (pending) {
          return sendJSON(res, 200, {
            ok: true,
            status: "running",
            elapsed: Date.now() - pending.startTime,
          });
        }
        return sendJSON(res, 404, { ok: false, error: "run not found" });
      }

      sendJSON(res, 200, { ok: true, run: run });
    },

    // GET /history — list recent runs (newest first, max 50)
    history: function (req, res) {
      var query = parseQuery(req);
      var limit = query.limit ? parseInt(query.limit, 10) : 50;
      if (isNaN(limit) || limit < 1) limit = 50;

      var runs = store.listRuns(limit);
      sendJSON(res, 200, { ok: true, count: runs.length, runs: runs });
    },

    // GET /agents — list available agents from registry
    agents: function (req, res) {
      var agents = getAgentRoster(ctx);
      sendJSON(res, 200, { ok: true, count: agents.length, agents: agents });
    },

    // GET/POST/DELETE /cases — test case CRUD
    cases: function (req, res) {
      var query = parseQuery(req);

      // DELETE /cases?id=X
      if (req.method === "DELETE") {
        if (!query.id) {
          return sendJSON(res, 400, { ok: false, error: "id is required" });
        }
        testCaseStore.deleteCase(query.id);
        testCaseStore.save(dataDir);
        return sendJSON(res, 200, { ok: true, deleted: query.id });
      }

      // POST /cases — create new test case
      if (req.method === "POST") {
        return readBody(req, function (body) {
          if (!body || !body.agent || !body.prompt) {
            return sendJSON(res, 400, { ok: false, error: "agent and prompt are required" });
          }

          var testCase = {
            id: "case_" + Date.now() + "_" + randomString(4),
            name: body.name || body.prompt.slice(0, 50),
            agent: body.agent,
            prompt: body.prompt,
            expectedResponse: body.expectedResponse || null,
            baselineUsage: body.baselineUsage || null,
            baselineElapsed: body.baselineElapsed || null,
            createdAt: Date.now(),
            runCount: 0,
          };

          testCaseStore.addCase(testCase);
          testCaseStore.save(dataDir);
          sendJSON(res, 200, { ok: true, case: testCase });
        });
      }

      // GET /cases?id=X — single case
      if (query.id) {
        var testCase = testCaseStore.getCase(query.id);
        if (!testCase) {
          return sendJSON(res, 404, { ok: false, error: "not found" });
        }
        return sendJSON(res, 200, { ok: true, case: testCase });
      }

      // GET /cases — list all cases
      var cases = testCaseStore.listCases();
      sendJSON(res, 200, { ok: true, count: cases.length, cases: cases });
    },
  };

  // ---------------------------------------------------------------------------
  // Return plugin interface
  // ---------------------------------------------------------------------------

  return {
    onCommand: onCommand,
    onBroadcast: onBroadcast,
    routes: routes,
    destroy: function () {
      // BUG-002 fix: finalize pending runs BEFORE clearInterval so the
      // cleanup timer can't finalize a run out from under this loop.
      tracker._pending.forEach(function (run, runId) {
        ctx.log("[agent-workbench] destroy: finalizing pending run " + runId);
        var completed = tracker.finalize(runId);
        if (completed) store.addRun(completed);
      });
      if (cleanupTimer) clearInterval(cleanupTimer);
      testCaseStore.save(dataDir);
      ctx.log("[agent-workbench] unloaded");
    },
  };
};