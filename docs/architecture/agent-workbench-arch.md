# Agent Workbench — Architecture Specification

**Version:** 2.0
**Author:** Arthit (System Architect)
**Date:** 2026-06-24
**Status:** Draft (Revised)
**PRD:** `docs/requirements/agent-workbench-prd.md`
**Changelog:** v1.0 → v2.0: Fixed `ctx.runClaude()` API misunderstanding, switched to polling pattern

---

## 1. Design Principles

| Principle | Rationale |
|---|---|
| **Zero external dependencies** | Plugin runs in Node.js daemon process — no npm packages, only built-in modules (fs, path, url) |
| **Async command flow** | `ctx.runClaude()` returns task ID immediately, response arrives via callback + broadcast |
| **Polling over WebSocket** | Frontend polls status every 500ms — simpler than managing WS connection for MVP |
| **In-memory + JSON persistence** | Run history is ephemeral (max 50), test cases are durable (JSON file) |
| **Observe, don't duplicate** | Agent roster comes from `ctx.reg` — no manual agent management |
| **Token budget visibility** | Every run tracks token usage to prevent context overflow |

---

## 2. Plugin Architecture

### 2.1 File Layout

```
plugins/agent-workbench/
├── plugin.json              # Plugin manifest
├── index.js                 # Server-side: RunStore, PendingRunTracker, routes, onCommand
├── panel.html               # Frontend UI (Vanilla JS, no build step)
└── data/                    # Private storage (gitignored)
    └── test-cases.json      # Saved test cases
```

### 2.2 plugin.json

```json
{
  "id": "agent-workbench",
  "name": "Agent Workbench",
  "version": "1.0.0",
  "description": "Test and benchmark AI agents with prompts, capture responses and token usage",
  "panel": "panel.html",
  "commands": [
    { "name": "run", "args": "<agent> <prompt>", "desc": "Run a prompt on an agent and capture response" },
    { "name": "list-agents", "args": "", "desc": "List all available agents from registry" },
    { "name": "save-case", "args": "<runId> [name]", "desc": "Save a run result as a reusable test case" }
  ],
  "core": false,
  "window": { "w": 1000, "h": 700, "resizable": true }
}
```

---

## 3. Data Flow (Revised — Polling Pattern)

### 3.1 Run Flow (Panel → Agent → Panel via Polling)

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Frontend: panel.html                               │
│                                                                       │
│  User selects agent + types prompt + clicks "Run"                     │
│      │                                                                │
│      ├── POST /plugin/agent-workbench/run                             │
│      │   body: { agent: "arthit", prompt: "Design API for..." }      │
│      │   response: { ok: true, runId: "run_123", taskId: "t42" }    │
│      │                                                                │
│      ├── Show "Running..." spinner with elapsed timer                 │
│      │                                                                │
│      └── Poll GET /plugin/agent-workbench/status?runId=run_123        │
│          every 500ms until status === "done"                          │
│          │                                                            │
│          ├── status: "running" → keep polling                         │
│          │                                                            │
│          └── status: "done" → GET /plugin/agent-workbench/result      │
│              ?runId=run_123 → render full result                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                Plugin: plugins/agent-workbench/index.js                │
│                                                                       │
│  POST /run → onCommand("run", {agent, prompt}, reply)                │
│      │                                                                │
│      ├── runId = generateId()                                         │
│      ├── startTime = Date.now()                                       │
│      │                                                                │
│      ├── taskId = ctx.runClaude(agent, prompt, {                      │
│      │     onDone: function(text, ok) {                               │
│      │       // Store response when agent finishes                   │
│      │       tracker.update(runId, { response: text, ok: ok });      │
│      │     }                                                          │
│      │   })                                                           │
│      │   // taskId = "t42" (string)                                  │
│      │                                                                │
│      ├── tracker.add(runId, {                                         │
│      │     taskId,                                                    │
│      │     agent,                                                     │
│      │     prompt,                                                    │
│      │     startTime,                                                 │
│      │     status: "running"                                          │
│      │   })                                                           │
│      │                                                                │
│      └── reply({ ok: true, runId: runId, taskId: taskId })           │
│          // HTTP 200 immediately — no blocking                           │
│                                                                       │
│  onBroadcast(evt) — listen for task.completed                         │
│      │                                                                │
│      └── if (evt.type === "task.completed" && evt.task === taskId) {  │
│            var usage = evt.usage || { in: 0, out: 0, win: 0 };       │
│            var model = evt.model || "unknown";                        │
│            tracker.update(runId, {                                    │
│              usage: { input: usage.in, output: usage.out,             │
│                       total: usage.in + usage.out },                  │
│              model: model,                                            │
│              status: "done"                                           │
│            });                                                        │
│            // onDone callback already stored response text           │
│            // Move completed run to RunStore                          │
│            var run = tracker.finalize(runId);                         │
│            store.addRun(run);                                         │
│          }                                                            │
└──────────────────────────────────────────────────────────────────────┘
```

### 3.2 Why Polling Instead of WebSocket?

**Decision:** Use HTTP polling (500ms interval) instead of WebSocket streaming.

**Rationale:**
1. `ctx.runClaude()` returns task ID, not Promise — must use callback + broadcast
2. Polling is simpler: no WS connection management, no reconnection logic
3. Polling is stateless: each request is independent, easier to debug
4. MVP scope: single user (CEO/Director) — polling overhead is negligible
5. Frontend shows loading spinner — 500ms latency is acceptable UX

**Trade-off:** Polling adds ~2 requests/second during run. Acceptable because:
- Runs are infrequent (testing, not production traffic)
- Daemon handles thousands of requests/second easily
- Polling stops when run completes (no idle polling)

---

## 4. State Model

### 4.1 PendingRunTracker — Track In-Flight Runs

```typescript
// In-memory structure (plugin index.js)
interface PendingRunTracker {
  pending: Map<string, PendingRun>;  // runId -> PendingRun
  
  add(runId: string, data: PendingRun): void;
  update(runId: string, updates: Partial<PendingRun>): void;
  get(runId: string): PendingRun | null;
  finalize(runId: string): Run;  // Convert to completed Run, remove from pending
  cleanup(): void;               // Remove stale runs (>10min)
}

interface PendingRun {
  runId: string;                 // e.g. "run_1719158400000_a1b2"
  taskId: string;                // e.g. "t42" (from ctx.runClaude)
  agent: string;                 // agent slug
  prompt: string;                // input prompt
  startTime: number;             // epoch ms
  status: "running" | "done" | "error";
  
  // Filled when agent completes:
  response?: string;             // from onDone callback
  ok?: boolean;                  // from onDone callback
  usage?: {                      // from task.completed broadcast
    input: number;
    output: number;
    total: number;
  };
  model?: string;                // from task.completed broadcast
}
```

**Implementation:**
```js
function PendingRunTracker(log) {
  this._log = log;
  this._pending = new Map();
}

PendingRunTracker.prototype.add = function (runId, data) {
  this._pending.set(runId, data);
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

PendingRunTracker.prototype.finalize = function (runId) {
  var run = this._pending.get(runId);
  if (!run) return null;
  
  this._pending.delete(runId);
  
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
  };
};

PendingRunTracker.prototype.cleanup = function () {
  var now = Date.now();
  var self = this;
  this._pending.forEach(function (run, runId) {
    if (now - run.startTime > 600000) {  // 10 min timeout
      self._log("[agent-workbench] stale run " + runId + " (>" + 10 + "min)");
      self._pending.delete(runId);
    }
  });
};
```

### 4.2 RunStore — In-Memory Run History

```typescript
interface RunStore {
  runs: Run[];                    // Circular buffer, max 50 runs
  addRun(run: Run): void;         // Append + prune if >50
  getRun(id: string): Run | null;
  listRuns(limit?: number): Run[];
  clearHistory(): void;
}

interface Run {
  id: string;                     // e.g. "run_1719158400000_a1b2"
  agent: string;                  // agent slug (e.g. "arthit")
  prompt: string;                 // input prompt
  response: string;               // agent response text
  usage: {
    input: number;                // input tokens
    output: number;               // output tokens
    total: number;                // input + output
  };
  elapsed: number;                // ms
  model: string;                  // e.g. "claude-sonnet-4-5-20250929"
  timestamp: number;              // epoch ms when run started
  savedAsCase?: string;           // test case id if saved
}
```

**Circular buffer logic:**
```js
RunStore.prototype.addRun = function (run) {
  this.runs.push(run);
  if (this.runs.length > 50) {
    this.runs.shift();  // Remove oldest
  }
};
```

### 4.3 TestCaseStore — JSON File Persistence

```typescript
interface TestCaseStore {
  cases: Map<string, TestCase>;   // id -> TestCase
  load(dataDir: string): void;    // Read from test-cases.json
  save(dataDir: string): void;    // Write to test-cases.json
  addCase(testCase: TestCase): void;
  getCase(id: string): TestCase | null;
  listCases(): TestCase[];
  deleteCase(id: string): void;
}

interface TestCase {
  id: string;                     // e.g. "case_1719158400000_x9y8"
  name: string;                   // User-provided or auto-generated
  agent: string;
  prompt: string;
  expectedResponse?: string;      // Optional: baseline for comparison
  baselineUsage?: {               // Optional: token budget baseline
    input: number;
    output: number;
    total: number;
  };
  baselineElapsed?: number;       // Optional: performance baseline (ms)
  createdAt: number;              // epoch ms
  runCount: number;               // How many times this case was run
  lastRunAt?: number;             // epoch ms of most recent run
}
```

**Persistence strategy (mirrors memory-board pattern):**
```js
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
      }
    } catch (err) {
      this._log("[agent-workbench] test-cases.json corrupt: " + err.message);
    }
  }
};

TestCaseStore.prototype.save = function (dataDir) {
  var fs = require("fs");
  var path = require("path");
  var filePath = path.join(dataDir, "test-cases.json");

  var cases = [];
  var iter = this.cases.values();
  var entry = iter.next();
  while (!entry.done) {
    cases.push(entry.value);
    entry = iter.next();
  }

  var data = { cases: cases, savedAt: new Date().toISOString() };
  try {
    var tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    this._log("[agent-workbench] save error: " + err.message);
  }
};
```

---

## 5. Agent Roster — Pull from ctx.reg

### 5.1 Bootstrap Strategy

```js
function getAgentRoster() {
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
      });
    }
  }

  return agents;
}
```

### 5.2 Why Not onBroadcast for Agent Discovery?

**Decision:** Agent Workbench does NOT use `onBroadcast` to discover agents.

**Rationale:**
1. Workbench is a **testing tool**, not a monitoring dashboard
2. User explicitly selects which agent to test — no need to track agent activity
3. `ctx.reg.agents` is the canonical source — updated when daemon loads registry.json
4. Simpler: no event handling, no state sync

**Trade-off:** If a new agent is added to registry.json while Workbench panel is open, user must reload panel to see it. Acceptable for MVP — agent roster changes rarely.

---

## 6. Context Budget Tracking

### 6.1 Token Usage Per Run

Token usage is captured from `task.completed` broadcast event:

```js
// In onBroadcast handler
function onBroadcast(evt) {
  if (evt.type === "task.completed") {
    // Find pending run by taskId
    var runId = findRunIdByTaskId(evt.task);
    if (!runId) return;
    
    // Extract token usage
    var usage = evt.usage || { in: 0, out: 0, win: 0 };
    var model = evt.model || "unknown";
    
    tracker.update(runId, {
      usage: {
        input: usage.in || 0,
        output: usage.out || 0,
        total: (usage.in || 0) + (usage.out || 0),
      },
      model: model,
      status: "done",
    });
    
    // Move to RunStore
    var run = tracker.finalize(runId);
    if (run) {
      store.addRun(run);
    }
  }
}
```

### 6.2 Frontend Display

Panel renders token usage prominently:

```
┌─────────────────────────────────────────┐
│ Run #run_1719158400000_a1b2             │
│ Agent: arthit | Model: claude-sonnet-4  │
│ Elapsed: 12.3s                          │
├─────────────────────────────────────────┤
│ Prompt:                                 │
│ Design API for user authentication...   │
├─────────────────────────────────────────┤
│ Response:                               │
│ ## API Design                           │
│ ### Endpoints                           │
│ POST /auth/login                        │
│ POST /auth/logout                       │
│ ...                                     │
├─────────────────────────────────────────┤
│ Token Usage:                            │
│   Input:  1,234 tokens                  │
│   Output: 2,456 tokens                  │
│   Total:  3,690 tokens                  │
├─────────────────────────────────────────┤
│ [Save as Test Case] [Run Again] [Copy]  │
└─────────────────────────────────────────┘
```

### 6.3 Budget Warning

If `usage.total > 100000` (100k tokens), frontend shows warning badge:

```
⚠️ High token usage: 123,456 tokens
Consider splitting into smaller prompts.
```

Threshold is configurable in panel (localStorage, default 100k).

---

## 7. REST Endpoints

### 7.1 Route Table

| Endpoint | Method | Response | Purpose |
|---|---|---|---|
| `/plugin/agent-workbench/run` | POST | `{ok, runId, taskId}` | Start a run, return immediately |
| `/plugin/agent-workbench/status` | GET | `{ok, status, elapsed}` | Poll run status (running/done/error) |
| `/plugin/agent-workbench/result` | GET | `{ok, run}` | Get completed run result |
| `/plugin/agent-workbench/history` | GET | `{ok, runs[]}` | List recent runs (max 50) |
| `/plugin/agent-workbench/agents` | GET | `{ok, agents[]}` | List available agents from registry |
| `/plugin/agent-workbench/cases` | GET | `{ok, cases[]}` | List saved test cases |
| `/plugin/agent-workbench/cases` | POST | `{ok, case}` | Create a new test case |
| `/plugin/agent-workbench/cases?id=X` | GET | `{ok, case}` | Get a single test case |
| `/plugin/agent-workbench/cases?id=X` | DELETE | `{ok, deleted}` | Delete a test case |

### 7.2 Route Implementation

```js
var routes = {
  // POST /run — start a run, return immediately
  run: function (req, res, helpers) {
    if (req.method !== "POST") {
      return helpers.sendJSON(res, 405, { ok: false, error: "method not allowed" });
    }

    helpers.readBody(req, function (body) {
      if (!body || !body.agent || !body.prompt) {
        return helpers.sendJSON(res, 400, { ok: false, error: "agent and prompt are required" });
      }

      var runId = generateId();
      var startTime = Date.now();

      // Start agent run with onDone callback
      var taskId = ctx.runClaude(body.agent, body.prompt, {
        onDone: function (text, ok) {
          // Store response when agent finishes
          tracker.update(runId, {
            response: text,
            ok: ok,
          });
        }
      });

      // Track pending run
      tracker.add(runId, {
        runId: runId,
        taskId: taskId,
        agent: body.agent,
        prompt: body.prompt,
        startTime: startTime,
        status: "running",
      });

      // Return immediately — frontend will poll
      helpers.sendJSON(res, 200, { ok: true, runId: runId, taskId: taskId });
    });
  },

  // GET /status — poll run status
  status: function (req, res, helpers) {
    var query = helpers.parseQuery(req);
    if (!query.runId) {
      return helpers.sendJSON(res, 400, { ok: false, error: "runId is required" });
    }

    var run = tracker.get(query.runId);
    if (!run) {
      // Check if already completed
      var completed = store.getRun(query.runId);
      if (completed) {
        return helpers.sendJSON(res, 200, {
          ok: true,
          status: "done",
          elapsed: completed.elapsed,
        });
      }
      return helpers.sendJSON(res, 404, { ok: false, error: "run not found" });
    }

    helpers.sendJSON(res, 200, {
      ok: true,
      status: run.status,
      elapsed: Date.now() - run.startTime,
    });
  },

  // GET /result — get completed run result
  result: function (req, res, helpers) {
    var query = helpers.parseQuery(req);
    if (!query.runId) {
      return helpers.sendJSON(res, 400, { ok: false, error: "runId is required" });
    }

    var run = store.getRun(query.runId);
    if (!run) {
      // Check if still pending
      var pending = tracker.get(query.runId);
      if (pending) {
        return helpers.sendJSON(res, 200, {
          ok: true,
          status: "running",
          elapsed: Date.now() - pending.startTime,
        });
      }
      return helpers.sendJSON(res, 404, { ok: false, error: "run not found" });
    }

    helpers.sendJSON(res, 200, { ok: true, run: run });
  },

  // GET /history — list recent runs
  history: function (req, res, helpers) {
    var query = helpers.parseQuery(req);
    var limit = query.limit ? parseInt(query.limit, 10) : 50;
    var runs = store.listRuns(limit);
    helpers.sendJSON(res, 200, { ok: true, count: runs.length, runs: runs });
  },

  // GET /agents — list available agents
  agents: function (req, res, helpers) {
    var agents = getAgentRoster();
    helpers.sendJSON(res, 200, { ok: true, count: agents.length, agents: agents });
  },

  // GET/POST/DELETE /cases — test case CRUD
  cases: function (req, res, helpers) {
    var query = helpers.parseQuery(req);

    // DELETE /cases?id=X
    if (req.method === "DELETE") {
      if (!query.id) {
        return helpers.sendJSON(res, 400, { ok: false, error: "id is required" });
      }
      testCaseStore.deleteCase(query.id);
      testCaseStore.save(ctx.dataDir);
      return helpers.sendJSON(res, 200, { ok: true, deleted: query.id });
    }

    // POST /cases — create new test case
    if (req.method === "POST") {
      return helpers.readBody(req, function (body) {
        if (!body || !body.agent || !body.prompt) {
          return helpers.sendJSON(res, 400, { ok: false, error: "agent and prompt are required" });
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
        testCaseStore.save(ctx.dataDir);
        helpers.sendJSON(res, 200, { ok: true, case: testCase });
      });
    }

    // GET /cases?id=X — single case
    if (query.id) {
      var testCase = testCaseStore.getCase(query.id);
      if (!testCase) {
        return helpers.sendJSON(res, 404, { ok: false, error: "not found" });
      }
      return helpers.sendJSON(res, 200, { ok: true, case: testCase });
    }

    // GET /cases — list all cases
    var cases = testCaseStore.listCases();
    helpers.sendJSON(res, 200, { ok: true, count: cases.length, cases: cases });
  },
};
```

---

## 8. Agent Commands

### 8.1 Command Table

| Command | Args | Called By | Purpose |
|---|---|---|---|
| `run` | `agent prompt` | Agent or UI | Start a run, return runId/taskId immediately |
| `list-agents` | - | Any agent | List available agents from registry |
| `save-case` | `runId [name]` | Agent or UI | Save a run result as a test case |

### 8.2 Command Implementation

```js
function onCommand(cmd, args, reply) {
  try {
    // ── run ────────────────────────────────────────────────────────────
    if (cmd === "run") {
      if (!args || !args.agent || !args.prompt) {
        return reply({ ok: false, error: "agent and prompt are required" });
      }

      var runId = generateId();
      var startTime = Date.now();

      // Start agent run with onDone callback
      var taskId = ctx.runClaude(args.agent, args.prompt, {
        onDone: function (text, ok) {
          // Store response when agent finishes
          tracker.update(runId, {
            response: text,
            ok: ok,
          });
        }
      });

      // Track pending run
      tracker.add(runId, {
        runId: runId,
        taskId: taskId,
        agent: args.agent,
        prompt: args.prompt,
        startTime: startTime,
        status: "running",
      });

      // Return immediately — caller will poll status
      return reply({ ok: true, runId: runId, taskId: taskId });
    }

    // ── list-agents ────────────────────────────────────────────────────
    if (cmd === "list-agents") {
      var agents = getAgentRoster();
      return reply({ ok: true, count: agents.length, agents: agents });
    }

    // ── save-case ──────────────────────────────────────────────────────
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
        name: args.name || run.prompt.slice(0, 50),
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
      testCaseStore.save(ctx.dataDir);

      // Mark run as saved
      run.savedAsCase = testCase.id;

      reply({ ok: true, case: testCase });
      return;
    }

    return reply({ ok: false, error: "unknown command: " + cmd });
  } catch (e) {
    ctx.log("[agent-workbench] onCommand error: " + e.message);
    return reply({ ok: false, error: e.message });
  }
}
```

---

## 9. Edge Case Handling

| EC# | Case | Architecture Solution |
|---|---|---|
| EC-1 | `ctx.runClaude()` timeout (>10min) | `tracker.cleanup()` removes stale runs every 30s. Frontend shows "Run timed out" after 10min. |
| EC-2 | Agent not found in registry | `ctx.runClaude()` may throw. Plugin catches error, marks run as `status: "error"`. |
| EC-3 | Run history >50 | Circular buffer: `runs.shift()` removes oldest when length >50. |
| EC-4 | test-cases.json corrupt | `load()` catches JSON parse error, logs warning, starts with empty cases Map. |
| EC-5 | Concurrent runs | Each run has unique `runId` + `taskId`. Tracker uses Map — concurrent runs tracked independently. |
| EC-6 | Large prompt/response | No size limit enforced. Frontend truncates display with "Show more" button. Full text in run object. |
| EC-7 | Token usage missing | `evt.usage` may be undefined. Plugin defaults to `{input: 0, output: 0, total: 0}`. |
| EC-8 | Plugin reload (`/plugins/reload`) | Tracker reinitializes empty (in-memory). TestCaseStore reloads from test-cases.json. Pending runs lost. |
| EC-9 | Agent roster changes | `getAgentRoster()` reads `ctx.reg.agents` on every call — always fresh. Frontend reloads on panel open. |
| EC-10 | High token usage (>100k) | Frontend shows warning badge. No enforcement — user decides whether to split prompt. |
| EC-11 | Polling stops before completion | Frontend continues polling until `status === "done"` or timeout (10min). If timeout, shows "Run still in progress". |
| EC-12 | onDone fires before onBroadcast | Tracker waits for both. If only one arrives, run stays in `status: "running"` until both complete. |

---

## 10. File Plan

| File | Type | Size (est.) | Purpose |
|---|---|---|---|
| `plugins/agent-workbench/plugin.json` | New | ~20 lines | Plugin manifest |
| `plugins/agent-workbench/index.js` | New | ~500 lines | RunStore + PendingRunTracker + TestCaseStore + routes + commands + onBroadcast |
| `plugins/agent-workbench/panel.html` | New | ~15KB | Frontend UI (Vanilla JS, no build) |
| `plugins/agent-workbench/data/test-cases.json` | New (runtime) | Variable | Saved test cases (JSON file) |

**No new npm dependencies. No daemon changes. No new modules.**

---

## 11. ADR: Key Decisions

### ADR-001: Polling over WebSocket for MVP

**Decision:** Use HTTP polling (500ms interval) instead of WebSocket streaming.
**Rationale:** 
1. `ctx.runClaude()` returns task ID, not Promise — must use callback + broadcast to capture response
2. Polling is simpler: no WS connection management, no reconnection logic, no partial state
3. Polling is stateless: each request is independent, easier to debug
4. MVP scope: single user (CEO/Director) — polling overhead is negligible (~2 req/sec during run)
5. Frontend shows loading spinner — 500ms latency is acceptable UX

**Trade-off:** Polling adds ~2 requests/second during run. Acceptable because:
- Runs are infrequent (testing, not production traffic)
- Daemon handles thousands of requests/second easily
- Polling stops when run completes (no idle polling)

**Future (Phase 2):** Consider WebSocket if polling becomes bottleneck or if multiple users open panel simultaneously.

### ADR-002: In-Memory Run History, JSON Test Cases

**Decision:** Run history is ephemeral (in-memory, max 50). Test cases are durable (JSON file).
**Rationale:** Runs are for exploration and debugging — most are discarded. Test cases are curated baselines — worth persisting. Mirrors memory-board pattern (in-memory + JSON).
**Trade-off:** Run history lost on plugin reload. Acceptable — user can re-run if needed.

### ADR-003: Agent Roster from ctx.reg, Not onBroadcast

**Decision:** Pull agent list from `ctx.reg.agents` on demand, not via `onBroadcast` event observation.
**Rationale:** Workbench is a testing tool, not monitoring dashboard. User explicitly selects which agent to test. `ctx.reg.agents` is canonical source. Simpler: no event handling.
**Trade-off:** If new agent added to registry while panel open, user must reload panel. Acceptable — agent roster changes rarely.

### ADR-004: No Token Budget Enforcement

**Decision:** Track token usage per run, show warning if >100k, but do not enforce limits.
**Rationale:** Workbench is for testing — users need visibility into token costs, not hard limits. Different prompts have different budgets. User decides whether to split.
**Trade-off:** User may accidentally run expensive prompts. Mitigated by warning badge and configurable threshold.

### ADR-005: Zero External Dependencies

**Decision:** Use only Node.js built-in modules (fs, path, url). No npm packages.
**Rationale:** Plugin runs in daemon process — adding dependencies risks daemon stability. Mirrors memory-board pattern. Simpler deployment.
**Trade-off:** Must implement ID generation, circular buffer, etc. manually. Acceptable — small codebase.

### ADR-006: PendingRunTracker for Async Flow

**Decision:** Use in-memory Map to track pending runs (runId → PendingRun) instead of blocking HTTP requests.
**Rationale:** `ctx.runClaude()` returns task ID immediately, response arrives via `onDone` callback + `task.completed` broadcast. Must track pending state to correlate these async events.
**Trade-off:** Pending runs lost on plugin reload. Acceptable — user can re-run if needed.

---

## 12. Constraints

| Constraint | Rationale | Enforcement |
|---|---|---|
| Zero external deps | Daemon stability, simple deployment | Only `require("fs")`, `require("path")`, `require("url")` |
| Async command flow | `ctx.runClaude()` returns task ID immediately | `onCommand` returns immediately with `runId` + `taskId`, frontend polls |
| Polling pattern | Simpler than WebSocket for MVP | Frontend polls `GET /status` every 500ms until `status === "done"` |
| In-memory run history (max 50) | Runs are ephemeral, prevent memory bloat | Circular buffer: `runs.shift()` when length >50 |
| JSON file for test cases | Durable persistence for curated baselines | Atomic write: write to `.tmp`, then `rename()` |
| Token usage tracking | Visibility into context budget consumption | Capture `usage` from `task.completed` broadcast event |
| No daemon changes | Plugin isolation — no risk to existing system | All logic in `plugins/agent-workbench/index.js` |

---

## 13. Integration Points

### 13.1 ctx.runClaude(agent, prompt, opts)

**Provided by:** Daemon (`server.js`)
**Returns:** `taskId` (string, e.g. "t42") — NOT a Promise

**Signature:**
```js
function runClaude(agent, prompt, opts = {}) {
  // ...
  return task;  // string ID
}
```

**Usage in plugin:**
```js
var taskId = ctx.runClaude(agent, prompt, {
  onDone: function (text, ok) {
    // text = agent response (string)
    // ok = true/false (success flag)
    tracker.update(runId, { response: text, ok: ok });
  }
});

// taskId is returned immediately — use to correlate with broadcast events
tracker.add(runId, { taskId: taskId, ... });
```

### 13.2 task.completed Broadcast Event

**Provided by:** Daemon (`server.js` L1787-1788)
**Payload:**
```js
{
  type: "task.completed",
  agent: "arthit",
  task: "t42",           // matches taskId from ctx.runClaude
  session: "s123",
  model: "claude-sonnet-4-5-20250929",
  usage: {
    in: 1234,            // input tokens
    out: 2456,           // output tokens
    win: 200000          // context window size
  }
}
```

**Usage in plugin:**
```js
function onBroadcast(evt) {
  if (evt.type === "task.completed") {
    var runId = findRunIdByTaskId(evt.task);
    if (!runId) return;
    
    var usage = evt.usage || { in: 0, out: 0, win: 0 };
    tracker.update(runId, {
      usage: {
        input: usage.in || 0,
        output: usage.out || 0,
        total: (usage.in || 0) + (usage.out || 0),
      },
      model: evt.model || "unknown",
      status: "done",
    });
    
    var run = tracker.finalize(runId);
    if (run) store.addRun(run);
  }
}
```

### 13.3 ctx.reg.agents

**Provided by:** Daemon (loaded from `registry.json`)
**Structure:** Object or Map with agent definitions
**Usage in plugin:**
```js
var agents = ctx.reg.agents;
var keys = Object.keys(agents);
for (var i = 0; i < keys.length; i++) {
  var agent = agents[keys[i]];
  // Extract id, name, role, etc.
}
```

### 13.4 ctx.dataDir

**Provided by:** Plugin host (`daemon/plugins.js`)
**Path:** `plugins/agent-workbench/data/`
**Usage:** Store `test-cases.json`

---

## 14. Frontend Polling Implementation

### 14.1 Polling Logic

```js
// In panel.html
async function startRun(agent, prompt) {
  // 1. POST /run — get runId and taskId
  const startRes = await fetch('/plugin/agent-workbench/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent, prompt })
  });
  const { runId, taskId } = await startRes.json();
  
  showSpinner(runId);
  
  // 2. Poll GET /status every 500ms
  const pollInterval = setInterval(async () => {
    const statusRes = await fetch(`/plugin/agent-workbench/status?runId=${runId}`);
    const { status, elapsed } = await statusRes.json();
    
    updateElapsed(elapsed);
    
    if (status === "done") {
      clearInterval(pollInterval);
      
      // 3. GET /result — fetch completed run
      const resultRes = await fetch(`/plugin/agent-workbench/result?runId=${runId}`);
      const { run } = await resultRes.json();
      
      renderResult(run);
    } else if (status === "error") {
      clearInterval(pollInterval);
      showError("Run failed");
    }
  }, 500);
  
  // Timeout after 10 minutes
  setTimeout(() => {
    clearInterval(pollInterval);
    showTimeout("Run timed out after 10 minutes");
  }, 600000);
}
```

### 14.2 UI States

```
[Idle]
  → User clicks "Run"
  → Show spinner + elapsed timer
  
[Running]
  → Polling every 500ms
  → Update elapsed time display
  → Show "Still running..." message
  
[Done]
  → Stop polling
  → Fetch result
  → Render response + token usage + elapsed time
  
[Error]
  → Stop polling
  → Show error message
  → Allow retry
  
[Timeout]
  → Stop polling after 10min
  → Show timeout message
  → Allow checking history for partial result
```

---

*Architecture spec v2.0 — revised to match daemon API reality. Ready for implementation.*
