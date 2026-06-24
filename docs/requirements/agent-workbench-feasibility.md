# Agent Workbench Plugin — Feasibility Analysis

**Version:** 1.0  
**Author:** Nida (Business Analyst)  
**Date:** 2026-06-24  
**Status:** Draft  
**Reference:** [agent-workbench-prd.md](./agent-workbench-prd.md) v1.1

---

## 1. Scope of Analysis

รายงานนี้วิเคราะห์ feasibility ของ Agent Workbench Plugin ตามที่ระบุใน PRD v1.1 ครอบคลุม 4 มิติ:

| Dimension | Question |
|---|---|
| **Technical** | สร้างได้จริงด้วยข้อจำกัดที่มีหรือไม่? |
| **API** | `ctx.runClaude()` API มีหรือยัง? return structure คืออะไร? |
| **Implementation** | แต่ละ user story ซับซ้อนแค่ไหน? effort ประมาณเท่าไหร่? |
| **Risk** | อะไรคือตัวบล็อกที่ต้องเคลียร์ก่อนเริ่ม implement? |

---

## 2. Technical Feasibility Assessment

### 2.1 Constraint Verification

| Constraint | Feasible? | Evidence / Note |
|---|---|---|
| Plugin only (ไม่แก้ daemon/godot/shell/CLI) | ✅ Feasible | Plugin architecture รองรับการสร้าง plugin ใหม่โดยไม่แตะ core — ดูจาก Agent Pulse, Pulse Dashboard, Music Player ล้วนเป็น plugin |
| Zero external deps | ✅ Feasible | All logic in `index.js` (Node.js built-ins) + `panel.html` (vanilla HTML/CSS/JS). `ctx.runClaude()` provided by daemon |
| Single `panel.html` | ✅ Feasible | Pulse Dashboard plugin มี single `panel.html` เป็นตัวอย่าง — HTML + inline CSS + inline JS ทั้งหมด |
| taste-skill UI (dark theme `#0c1322`) | ✅ Feasible | Color palette อิงจาก office theme มาตรฐาน ใช้ CSS variables ใน `panel.html` |
| `ctx.dataDir` for persistence | ✅ Feasible | Plugin guide (plugins.md §3) documents `ctx.dataDir` as private storage |
| `ctx.reg.agents` for agent roster | ✅ Feasible | Plugin guide lists `ctx.reg` as readable registry |

**Verdict: ทุก constraint ผ่าน — ไม่มี structural blocker**

### 2.2 Core API: `ctx.runClaude()`

**นี่คือตัวบล็อกที่ใหญ่ที่สุด — ต้อง verify ก่อนเริ่ม implement**

From plugin guide (plugins.md §3):

> `ctx.runClaude(agentId, prompt, opts?)` — run a real Claude Code turn as that agent — the same engine the office uses (advanced)

**สิ่งที่เรารู้:**
- API มีอยู่จริง (documented ใน plugin guide)
- รับ 3 parameters: `agentId`, `prompt`, `opts?`
- เป็น async (return Promise)

**สิ่งที่เรายังไม่รู้ (ต้อง verify):**

| Unknown | Impact ถ้าไม่มี | Mitigation |
|---|---|---|
| Return structure — `{ text, reasoning?, usage? }` หรืออย่างอื่น? | กระทบ US-1 Response display, US-4 Compare | Verify ก่อน — ถ้า structure ต่างจากที่ assume ต้องปรับ UI |
| รองรับ streaming หรือ batch เท่านั้น? | ถ้า batch-only → Dev Agent ต้องรอจน response เสร็จ ไม่เห็น progress | แสดง spinner + elapsed time |
| Timeout behavior — default timeout? abort ได้มั้ย? | ถ้าไม่มี abort → cancel button ทำงานไม่ได้ | FR-4.3 assume 120s timeout — อาจต้อง implement timeout เองใน index.js |
| Token usage — return `input_tokens` / `output_tokens` มั้ย? | ถ้าไม่มี → Metrics Bar ขาดข้อมูล token | Fallback: แสดงเฉพาะ latency, ซ่อน token section |
| Reasoning content — แยกจาก response text หรือ mixed? | ถ้า mixed → Reasoning Tab เหลือ "Raw Response" tab เดียว (per Shino decision) | AC1.3 กำหนดให้ reasoning tab collapse by default อยู่แล้ว |

### 2.3 Plugin Registry Access

```js
// Plugin can read registry directly
const agents = ctx.reg.agents; // map of agentId → { name, role, ... }
```

**Status: ✅ Confirmed** — Agent Pulse และ Pulse Dashboard plugins ใช้ `ctx.reg` จริง

**Remaining question:** `ctx.reg.agents` มี field `status` (online/offline/idle/busy) มั้ย? หรือต้องอ่านจาก Agent Pulse's `/pulse` endpoint?

> **Decision:** MVP — ใช้ `ctx.reg.agents` อย่างเดียว (แสดงชื่อ + role). ถ้ามี status field ให้แสดง indicator. ถ้าไม่มี → ข้าม indicator ไป, เพิ่มใน Phase 2

---

## 3. Implementation Complexity Analysis

### 3.1 Per User Story

| User Story | Complexity | Files Touched | Effort (est.) | Key Challenge |
|---|---|---|---|---|
| **US-1: Run Prompt** | Medium | `plugin.json`, `index.js`, `panel.html` | 2-3 days | `ctx.runClaude()` API verification, response parsing, UI wiring |
| **US-2: Run History** | Low-Medium | `index.js`, `panel.html` | 1-2 days | In-memory array management, JSON file I/O, LRU eviction |
| **US-3: Test Cases** | Low | `index.js`, `panel.html` | 1 day | Simple CRUD on `testcases.json` |
| **US-4: Compare Runs** | Medium | `index.js`, `panel.html` | 1-2 days | Text diff algorithm (basic line-by-line), side-by-side layout |

**Total MVP (US-1 + US-2): ~3-5 days**  
**Total Phase 2 (US-3 + US-4): ~2-4 days**

### 3.2 Technical Breakdown — US-1 (Core Flow)

```
[panel.html]                    [index.js]                     [Daemon]
    │                               │                              │
    │ fetch roster                  │                              │
    │ GET /plugin/aw/roster ──────→ │                              │
    │ ←────── [{id,name,role}]      │ ctx.reg.agents               │
    │                               │                              │
    │ user clicks Send              │                              │
    │ POST /plugin/aw/cmd ────────→ │                              │
    │ {cmd:"run",agentId,prompt}    │                              │
    │                               │ ctx.runClaude(id, prompt) ──→│
    │                               │ ←── {text,...}               │
    │                               │ save to memory + JSON        │
    │ ←── {ok:true, run:{...}}      │                              │
    │                               │                              │
    │ render tabs + metrics         │                              │
```

**Complexity drivers:**
1. `ctx.runClaude()` return structure parsing — depends on actual API → low risk once verified
2. Tab switching UI — vanilla JS, straightforward
3. Elapsed time counter — `setInterval` ตั้งแต่กด Send → clear เมื่อ response กลับ → trivial
4. Error handling — try/catch ใน `onCommand` → straightforward

### 3.3 Technical Breakdown — US-2 (History)

```
[panel.html]                    [index.js]
    │                               │
    │ GET /plugin/aw/history ─────→ │
    │ ←── [{id,agentId,preview,     │ in-memory array
    │       status,latency,ts}]     │ (max 50 entries)
    │                               │
    │ click specific run            │
    │ GET /plugin/aw/run?id=X ────→ │
    │ ←── {run:{full details}}      │ find by id in array
    │                               │
    │ [auto-save trigger]           │
    │ (happens server-side)         │ fs.writeFile(data/runs.json)
```

**Complexity drivers:**
1. In-memory array + JSON file sync — straightforward
2. LRU eviction: `array.shift()` when `length > 50` → trivial
3. Text truncation for preview: `prompt.substring(0, 60)` → trivial
4. Hydration on plugin load: `JSON.parse(fs.readFileSync(...))` → array → trivial

### 3.4 Technical Breakdown — US-3 (Test Cases)

Standard CRUD on `testcases.json` — lowest complexity story:
- `save_testcase` → push to array + writeFile
- `load_testcase` → find by id → return
- `edit_testcase` → find by id → update → writeFile
- `delete_testcase` → filter out → writeFile

No performance concern (test cases rarely exceed 20-30 entries).

### 3.5 Technical Breakdown — US-4 (Compare)

**Text diff algorithm** — simple line-by-line diff:

```js
function diffLines(a, b) {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  // Simple LCS-based diff (no external library needed)
  // Return: [{type:'same'|'added'|'removed', text}]
}
```

A basic LCS diff is ~50 lines of vanilla JS — no dependency needed.

**Side-by-side layout** — CSS flexbox with 2 columns, synced scroll (optional).

---

## 4. Verification Checklist (Before Implementation Starts)

| # | Item | Owner | Priority |
|---|---|---|---|
| V1 | Verify `ctx.runClaude()` return structure — call with test agent, log result | Shino / Architect | 🔴 Blocker |
| V2 | Verify `ctx.reg.agents` has status field | Shino / Architect | 🟡 Important |
| V3 | Test `ctx.dataDir` read/write permission from plugin context | Dev Team | 🟡 Important |
| V4 | Verify `crypto.randomUUID()` available in Node.js runtime (for run IDs) | Dev Team | 🟢 Minor |
| V5 | Confirm max response size so trim threshold (10KB) is appropriate | Shino / Architect | 🟢 Minor |

### V1 Go/No-Go Decision

```
V1 unresolved → cannot start US-1 → cannot start MVP
                                    ↓
                            everything blocked
```

**Action:** Shino รัน `ctx.runClaude("nida", "Hello, return a short test response")` จาก plugin context → log return value → share structure กับทีม

---

## 5. Risk Matrix

| Risk | Likelihood | Impact | Mitigation | Post-Mitigation Risk |
|---|---|---|---|---|
| `ctx.runClaude()` API ต่างจากที่ assume | Medium | High — ต้อง redesign US-1 | V1 verification before implementation | Low |
| `ctx.runClaude()` ไม่ return token usage | Medium | Medium — Metrics Bar เสียข้อมูล | Fallback: hide token section, show latency only | Medium (UX degraded but functional) |
| `ctx.runClaude()` ไม่ return reasoning แยก | High | Low — Reasoning Tab collapse เหลือ Raw tab เดียว | Per Shino decision: collapse เหลือ "Raw Response" tab | Low (accepted limitation) |
| Plugin data dir ไม่ writable | Low | High — history/test cases persist ไม่ได้ | V3 verification; fallback to localStorage | Low |
| Response ใหญ่มาก (>100KB) → panel lag | Low | Medium | Trim at 10KB in index.js; "Show full" button ดึงเพิ่มเมื่อต้องการ | Low |

---

## 6. Dependencies on Other Office Components

| Component | Dependency Type | Status |
|---|---|---|
| **BagIdea Office Daemon** | Runtime host (plugin loading, HTTP routes, WS) | ✅ Live |
| **`ctx.runClaude()`** | Core API for agent execution | ⚠️ Documented in plugin guide, needs V1 verification |
| **`ctx.reg`** | Agent roster data source | ✅ Available |
| **`ctx.dataDir`** | File persistence | ✅ Documented in plugin guide |
| **Agent Pulse plugin** | Optional: read status indicators | 🟡 Nice-to-have, not in MVP |

**Zero external dependencies** — no npm packages, no CDN, no API keys.

---

## 7. Recommendations

### 7.1 Go/No-Go Decision

| Criterion | Verdict |
|---|---|
| Technically feasible with given constraints? | ✅ **Go** |
| Core API (`ctx.runClaude()`) available? | ⚠️ **Conditional Go** — block on V1 verification |
| Implementation effort fits team bandwidth? | ✅ **Go** — MVP 3-5 days |

### 7.2 Recommended Action Plan

```
Week 1:
  Day 1:   Shino verifies V1 (ctx.runClaude return structure)
  Day 1-2: Nida updates PRD with verified API structure
  Day 2-5: Dev Agent (Arthit/Krit/May) implements US-1 + US-2
           - plugin.json + index.js scaffolding
           - panel.html UI
           - Integration test

Week 2:
  Day 1-2: QA (Ton) tests US-1 + US-2
  Day 3-5: Implement US-3 + US-4 (Phase 2)
```

### 7.3 What to NOT Start Yet

| Item | Reason |
|---|---|
| ❌ panel.html coding | Blocked by V1 — need to know response structure for UI design |
| ❌ Compare diff algorithm | Phase 2 — not in MVP |
| ❌ Test case CRUD | Phase 2 — not in MVP |

---

## Appendix A: Field Verification Log

| Date | Item | Who | Result |
|---|---|---|---|
| 2026-06-24 | V1: `ctx.runClaude()` return structure | — | Pending |
| 2026-06-24 | V2: `ctx.reg.agents` status field | — | Pending |
| 2026-06-24 | V3: `ctx.dataDir` writable | — | Pending |
| 2026-06-24 | V4: `crypto.randomUUID()` available | — | Pending |