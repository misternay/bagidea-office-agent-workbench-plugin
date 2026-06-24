# Agent Workbench Plugin — Product Requirements Document

**Version:** 1.1  
**Author:** Nida (Business Analyst)  
**Date:** 2026-06-24  
**Status:** Draft — Revisions per Director decision (2026-06-24)  
**Primary Personas:** Dev Agents (Arthit, Krit, May), Director (Shino)

---

## 1. Executive Summary

### 1.1 Problem Statement

ทุกวันนี้การ develop และ debug agent ใน BagIdea Office มีคอขวดอยู่ที่ **Director (Shino)** — Dev Agent คนไหนต้องการทดสอบ agent ตัวใหม่ หรือส่ง prompt ไปดูว่า agent ตอบอะไร, ใช้ reasoning ยังไง, ใช้ token เท่าไหร่, latency นานแค่ไหน ล้วนต้อง **บอก Shino → Shino เป็นคนรัน → Shino relay ผลลัพธ์กลับมา**

ปัญหานี้สร้าง pain point 3 ด้าน:

| ปัญหา | ผลกระทบ |
|---|---|
| **Director เป็น single point of failure** | Shino ไม่อยู่ = dev agent ทั้งทีม test/debug ไม่ได้เลย |
| **Feedback loop ช้า** | กว่าจะบอก Shino → รัน → relay กลับ ใช้เวลาหลายนาทีต่อ prompt เดียว ทั้งที่ควรใช้เวลาไม่กี่วินาที |
| **ไม่มี history / เปรียบเทียบไม่ได้** | ทุกครั้งที่ test ผ่าน Shino ผลลัพธ์หายไปกับการสนทนา — ไม่มีทางดูย้อนหลังว่า prompt นี้เคยรันแล้วได้ผลลัพธ์อะไร, token ใช้เท่าไหร่, latency เป็นยังไง เทียบกับครั้งก่อน |

**Agent Workbench Plugin** คือ **เครื่องมือ self-service สำหรับ Dev Agent** — ให้ dev agent ทุกคนสามารถเลือก agent จาก roster, ส่ง prompt, ดู response + reasoning + token usage + latency ได้เอง โดยไม่ต้องผ่าน Director และเก็บ history ไว้ดูย้อนหลัง

### 1.2 The Core Insight

```
ปัจจุบัน (ไม่มี Workbench):               อนาคต (มี Workbench):
─────────────────────────────────────  ─────────────────────────────────────
Dev → "Shino ช่วย test agent X        Dev → เปิด Workbench panel
       ด้วย prompt Y ให้หน่อย"             → เลือก agent X จาก dropdown
      → Shino รัน                         → พิมพ์ prompt Y
      → Shino copy/paste ผลลัพธ์           → กด Send
      → Dev อ่าน                          → เห็น response + reasoning
                                          + token usage + latency ทันที
                                          → History ถูกบันทึกอัตโนมัติ
                                          → Dev ทำซ้ำได้เองไม่จำกัดรอบ
                                          → Dev เทียบ prompt เก่า vs ใหม่
                                          ได้ในคลิกเดียว
```

### 1.3 Goals

- **Self-service** — Dev Agent ทุกคน test/debug agent ได้เอง โดยไม่ต้องถาม Director
- **Full visibility** — เห็น response, reasoning, token usage, latency ในหน้าเดียว
- **History + Comparison** — ดูประวัติการรันย้อนหลัง, save/load test case, เปรียบเทียบ runs
- **Zero friction** — เปิด panel → เลือก agent → พิมพ์ prompt → กด Send → เห็นผลลัพธ์ ≤2 วินาที
- **Plugin only** — ไม่แตะ core ระบบ, ไม่ใช้ external dependency, ทำงานบน plugin architecture ของออฟฟิศล้วนๆ

### 1.4 Non-Goals (Out of Scope)

| Out of Scope | Reason |
|---|---|
| ❌ Production monitoring / alerting | นั่นคือหน้าที่ Agent Pulse |
| ❌ Agent-to-agent communication | Workbench คือ dev tool, ไม่ใช่ communication channel |
| ❌ แก้ไข core ระบบ (daemon/godot/shell/cli) | ต้องเป็น plugin เท่านั้น |
| ❌ สร้าง agent ใหม่ / แก้ไข agent config | ใช้ Workbench เพื่อ test agent ที่มีอยู่แล้วเท่านั้น |
| ❌ Batch / cron / scheduled test runs | MVP — manual invocation เท่านั้น |
| ❌ Multi-agent orchestration (ส่ง prompt ไปหลาย agent พร้อมกัน) | MVP — ทีละ 1 agent ต่อ 1 run |
| ❌ External LLM providers (OpenAI, Gemini, etc.) | ใช้ agent ใน roster ของออฟฟิศเท่านั้น |
| ❌ Collaborative features (แชร์ test case ระหว่าง dev agents) | Phase 2+ |
| ❌ Prompt library / template system | Phase 2+ |

---

## 2. Personas

| Persona | Need | Usage Pattern |
|---|---|---|
| **Dev Agent (Arthit, Krit, May)** | test/debug agent ที่ตัวเองพัฒนาอยู่ — ส่ง prompt, ดู response, ดู reasoning, วัด latency, เทียบ runs | ใช้งานระหว่าง development cycle, เปิด-ปิดหลายรอบต่อวัน |
| **Shino (Director)** | ตรวจสอบคุณภาพ agent ก่อน deploy, ดูว่ามี regression มั้ย, validate ว่า agent ตอบถูกต้อง | ใช้เป็น QA gate — รัน test cases ที่ dev agents เซฟไว้, เทียบผลลัพธ์ก่อน/หลังแก้ไข |

### 2.1 Persona Priority สำหรับ MVP

| Priority | Persona | Reason |
|---|---|---|
| P0 | **Dev Agent** | Primary user — คนที่ปวดที่สุดจากคอขวดปัจจุบัน |
| P1 | **Shino (Director)** | ใช้เป็น QA gate — มีประโยชน์แต่ pain point น้อยกว่า |

---

## 3. Core Concepts

### 3.1 Information Flow

```
┌─────────────────────────────────────────────────────────┐
│                 Agent Workbench Panel                    │
│                                                         │
│  ┌─────────────┐   ┌──────────────────┐   ┌──────────┐ │
│  │ Agent Roster │ → │  Prompt Input    │ → │  Send    │ │
│  │  (dropdown)  │   │  (textarea)      │   │  (button) │ │
│  └─────────────┘   └──────────────────┘   └──────────┘ │
│                                    ↓                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Response Panel                       │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐          │   │
│  │  │Response │  │Reasoning│  │Token Use│          │   │
│  │  │  Tab    │  │  Tab    │  │+Latency │          │   │
│  │  └─────────┘  └─────────┘  └─────────┘          │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────────┐  │
│  │Run History│  │Test Cases│  │  Compare Runs          │  │
│  │ (sidebar) │  │(save/load)│  │  (diff view)          │  │
│  └──────────┘  └──────────┘  └───────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         │                        ↑
         │ POST /plugin/aw/cmd    │ ctx.runClaude(agentId, prompt)
         ↓                        │
┌─────────────────────┐    ┌─────────────────────┐
│  Agent Workbench    │    │   BagIdea Office    │
│  index.js           │    │   Daemon            │
│                     │    │   (agent execution)  │
│  onCommand("run")   │───→│                     │
│                     │←───│   response stream    │
│  stores history     │    │                     │
└─────────────────────┘    └─────────────────────┘
```

### 3.2 Key Entities

| Entity | Fields | Description |
|---|---|---|
| **Agent** | `id`, `name`, `role`, `status` | ตัว agent ใน roster ที่ dev เลือกมาทดสอบ (อ่านจาก registry) |
| **Run** | `id`, `agentId`, `prompt`, `response`, `reasoning`, `tokensIn`, `tokensOut`, `latencyMs`, `timestamp`, `status` | 1 invocation = 1 run |
| **TestCase** | `id`, `name`, `agentId`, `prompt`, `expectedBehavior`, `tags[]`, `createdAt` | test case ที่ถูกเซฟไว้เพื่อรันซ้ำ |
| **Comparison** | `id`, `name`, `runIds[]`, `createdAt` | การเทียบ 2 runs (หรือมากกว่า) แบบ side-by-side |

### 3.3 Data Persistence

| Data | Storage | Rationale |
|---|---|---|
| **Run History** | in-memory (max 50 entries, fast read) + auto-save to `data/runs.json` ทุกครั้งที่มี run ใหม่ (persist ข้าม reload) | Hybrid strategy — อ่านจาก memory ตอน panel เปิด (เร็ว), persist ลง JSON ทุก run ใหม่ (ไม่หายตอน restart). ตอนโหลด panel: hydrate memory จาก `data/runs.json` |
| **Test Cases** | `data/testcases.json` | ต้อง persist ข้าม session |
| **Agent Roster** | อ่านจาก registry (real-time, no cache needed) | agent อาจถูกเพิ่ม/ลบ/เปลี่ยนสถานะตลอดเวลา |
| **UI State** (selected agent, open tabs, etc.) | localStorage ใน panel.html | ephemeral — ไม่ต้อง persist ข้าม restart |

---

## 4. User Stories

### US-1: Run Prompt Against Any Agent (P0)

**As a** Dev Agent (Arthit/Krit/May)  
**I want to** เลือก agent จาก roster, พิมพ์ prompt, กด Send แล้วเห็น response พร้อม reasoning, token usage และ latency ในหน้าเดียว  
**So that** ฉันสามารถ test/debug agent ที่ฉันพัฒนาได้เอง โดยไม่ต้องผ่าน Director ทุกครั้ง

**Priority:** P0 (MVP — core feature)

**Acceptance Criteria:**

> **AC1.1 — เลือก agent และส่ง prompt ได้สำเร็จ**
>
> **Given** Dev Agent เปิด Agent Workbench panel  
> **And** มี agent อย่างน้อย 1 ตัวใน roster  
> **When** Dev Agent เลือก agent จาก dropdown  
> **And** พิมพ์ prompt ใน textarea  
> **And** กดปุ่ม "Send"  
> **Then** ระบบส่ง prompt ไปยัง agent ที่เลือก  
> **And** แสดงสถานะ "Running…" พร้อม elapsed time ที่เพิ่มขึ้น real-time  
> **And** เมื่อ agent ตอบกลับ จะแสดง response ใน Response Tab โดยอัตโนมัติ

> **AC1.2 — แสดง token usage และ latency**
>
> **Given** Run เสร็จสมบูรณ์  
> **When** Dev Agent ดูผลลัพธ์  
> **Then** แสดง token input, token output, และ latency (ms) ใน Metrics Bar ด้านบน response  
> **And** Metrics Bar แสดงผลใน ≤1 วินาทีหลังจาก response มาถึง

> **AC1.3 — แสดง reasoning (ถ้ามี)**
>
> **Given** agent response มี reasoning/thinking content  
> **When** Dev Agent ดูผลลัพธ์  
> **Then** Reasoning Tab แสดงผล reasoning content  
> **And** Reasoning Tab จะถูก collapse โดย default (ไม่แย่งพื้นที่ response)  
> **And** Dev Agent สามารถคลิกเปิดเพื่อดู reasoning ได้

> **AC1.4 — Error handling**
>
> **Given** Dev Agent ส่ง prompt  
> **When** agent execution ล้มเหลว (timeout, crash, permission denied)  
> **Then** แสดง error message ที่ชัดเจน พร้อม error code (ถ้ามี)  
> **And** error message แสดงใน Response Tab ด้วยสีแดง  
> **And** ระบบไม่ crash — panel ยังใช้งานได้ปกติ

> **AC1.5 — Agent dropdown แสดงเฉพาะ agent ที่พร้อมใช้งาน**
>
> **Given** มี agent ทั้ง online และ offline ใน roster  
> **When** Dev Agent เปิด dropdown เลือก agent  
> **Then** agent ทั้งหมดจะแสดงในรายการ  
> **And** agent ที่ offline จะมี indicator (⚫ gray dot)  
> **And** agent ที่ online จะมี indicator (🟢 green dot)  
> **And** Dev Agent สามารถเลือก agent ที่ offline ได้ (แต่อาจรันไม่สำเร็จ — แสดง warning)

---

### US-2: Run History (P0)

**As a** Dev Agent  
**I want to** ดูประวัติการรันทั้งหมดของฉัน — เรียงตามเวลา, เห็น status (success/fail), token usage, latency  
**So that** ฉันกลับมาดูผลลัพธ์เก่าได้โดยไม่ต้องรันซ้ำ และรู้ว่า prompt ไหนใช้ token เท่าไหร่

**Priority:** P0 (MVP — ไม่มี history = ใช้ซ้ำไม่ได้ = ต้องบันทึกเอง manual)

**Acceptance Criteria:**

> **AC2.1 — History sidebar แสดง runs ล่าสุด**
>
> **Given** Dev Agent เคยรัน prompt มาก่อนอย่างน้อย 1 ครั้ง  
> **When** Dev Agent เปิด Agent Workbench panel  
> **Then** History sidebar (ด้านซ้ายของ panel) แสดงรายการ runs เรียงจากใหม่ไปเก่า  
> **And** แต่ละรายการแสดง: agent name, prompt preview (ตัดที่ 60 ตัวอักษร), status (✅ success / ❌ fail), latency, timestamp

> **AC2.2 — คลิกดูรายละเอียด run เก่า**
>
> **Given** มี run ใน history  
> **When** Dev Agent คลิกที่ run ใน history sidebar  
> **Then** Response Panel โหลดผลลัพธ์ของ run นั้น (response, reasoning, token usage, latency)  
> **And** prompt เดิมถูกแสดงใน textarea (disabled — ดูอย่างเดียว)  
> **And** ปุ่ม "Send" เปลี่ยนเป็น "Re-run" เพื่อให้รันซ้ำได้

> **AC2.3 — History persist ข้าม session**
>
> **Given** Dev Agent มี runs ใน history  
> **When** Dev Agent ปิด panel แล้วเปิดใหม่ (หรือ reload office)  
> **Then** runs ทั้งหมดยังอยู่ใน history

> **AC2.4 — History แยกตาม agent (filter)**
>
> **Given** Dev Agent มี runs กับหลาย agent  
> **When** Dev Agent เลือก filter เป็น agent A จาก dropdown filter  
> **Then** History sidebar แสดงเฉพาะ runs ที่รันกับ agent A

> **AC2.5 — History limit (50 in-memory)**
>
> **Given** มี runs ใน memory ครบ 50 รายการแล้ว  
> **When** การรันครั้งใหม่เสร็จสมบูรณ์  
> **Then** run ที่เก่าที่สุด (ลำดับที่ 51) จะถูกลบออกจาก memory โดยอัตโนมัติ  
> **And** `data/runs.json` ถูก overwrite ด้วย snapshot 50 runs ล่าสุด  
> **And** Dev Agent จะเห็นข้อความแจ้งเตือนครั้งแรกเมื่อถึง limit ว่า "History เต็ม 50 รายการ — run เก่าสุดถูกลบ"

---

### US-3: Save/Load Test Cases (P1)

**As a** Dev Agent  
**I want to** เซฟ prompt + expected behavior เป็น test case แล้วโหลดกลับมารันซ้ำได้  
**So that** ฉันมี regression test สำหรับ agent ที่พัฒนา — รันชุด test case เดิมซ้ำหลังแก้โค้ดเพื่อดูว่ามีอะไรพังมั้ย

**Priority:** P1 (สำคัญสำหรับ workflow จริง — แต่ MVP มี manual copy/paste แทนได้)

**Acceptance Criteria:**

> **AC3.1 — Save test case จาก run**
>
> **Given** Run เพิ่งเสร็จสมบูรณ์  
> **When** Dev Agent กดปุ่ม "Save as Test Case"  
> **And** ใส่ชื่อ test case และ expected behavior (optional)  
> **And** กด "Save"  
> **Then** test case ถูกบันทึกพร้อม: id, name, agentId, prompt, expectedBehavior, tags, createdAt  
> **And** test case ปรากฏใน Test Cases tab

> **AC3.2 — Load test case แล้วรัน**
>
> **Given** มี test case ที่ถูกเซฟไว้  
> **When** Dev Agent เปิด Test Cases tab  
> **And** คลิก test case ที่ต้องการ  
> **Then** prompt ของ test case นั้นถูกโหลดลง textarea  
> **And** agent ที่เกี่ยวข้องถูกเลือกให้โดยอัตโนมัติ  
> **And** Dev Agent กด "Send" เพื่อรันได้ทันที

> **AC3.3 — Edit/delete test case**
>
> **Given** มี test case ที่ถูกเซฟไว้  
> **When** Dev Agent กด edit (✏️) บน test case  
> **Then** สามารถแก้ไข name, prompt, expected behavior ได้  
> **When** Dev Agent กด delete (🗑) บน test case  
> **Then** ระบบถามยืนยันก่อนลบ  
> **And** เมื่อยืนยัน test case ถูกลบ

> **AC3.4 — Test case persist ข้าม session**
>
> **Given** มี test cases ที่ถูกเซฟไว้  
> **When** Dev Agent ปิด panel แล้วเปิดใหม่  
> **Then** test cases ทั้งหมดยังอยู่

---

### US-4: Compare Runs (P1)

**As a** Dev Agent  
**I want to** เลือก 2 runs มาเทียบ side-by-side — เห็นว่า response ต่างกันยังไง, token/latency เปลี่ยนไปมั้ย  
**So that** ฉันรู้ว่าแก้โค้ดแล้ว agent ดีขึ้น, แย่ลง, หรือ regression จาก version ก่อนหน้า

**Priority:** P1 (มีประโยชน์มากสำหรับ workflow จริง — แต่ MVP รันทีละ prompt ยังได้)

**Acceptance Criteria:**

> **AC4.1 — เลือก 2 runs มาเทียบ**
>
> **Given** มี runs ใน history อย่างน้อย 2 รายการกับ agent เดียวกัน  
> **When** Dev Agent คลิกปุ่ม "Compare"  
> **And** เลือก 2 runs จากรายการ  
> **And** กด "Compare Selected"  
> **Then** Compare View แสดง response ของทั้ง 2 runs แบบ side-by-side  
> **And** token usage และ latency ของแต่ละ run แสดงด้านบน  
> **And** ความแตกต่าง (delta) ของ token/latency ถูกคำนวณและแสดง

> **AC4.2 — Diff view**
>
> **Given** Compare View กำลังแสดง 2 runs  
> **When** response ของทั้ง 2 runs มีความแตกต่าง  
> **Then** ข้อความที่เหมือนกันแสดงตามปกติ  
> **And** ข้อความที่ต่างกันแสดงด้วยสี highlight (เขียว = เพิ่มมา, แดง = หายไป)  
> **And** Dev Agent เลือกดูแบบ side-by-side หรือ unified diff ได้

> **AC4.3 — Compare view รองรับ test case**
>
> **Given** Dev Agent ต้องการเทียบ run ปัจจุบันกับ test case  
> **When** Dev Agent รัน test case  
> **And** กด "Compare with Test Case Expected"  
> **Then** response ล่าสุดเทียบกับ expected behavior ใน test case  
> **And** แสดง match/mismatch status

---

## 5. Functional Requirements

### 5.1 Agent Selection

| FR-1.1 | Dropdown แสดง agent ทั้งหมดจาก roster (อ่านจาก `ctx.reg.agents`) |
| FR-1.2 | แสดง status indicator (online/offline/busy) ข้างชื่อ agent |
| FR-1.3 | Filter/search agent ตามชื่อได้ (พิมพ์เพื่อกรอง) |
| FR-1.4 | จำ agent ที่เลือกไว้ล่าสุด (localStorage) |

### 5.2 Prompt Input

| FR-2.1 | Textarea รองรับ multiline prompt (auto-resize สูงสุด 50% ของ panel) |
| FR-2.2 | Keyboard shortcut: `Cmd/Ctrl + Enter` เพื่อ Send |
| FR-2.3 | ปุ่ม Clear เพื่อล้าง textarea |
| FR-2.4 | แสดง character count |
| FR-2.5 | Placeholder text: "พิมพ์ prompt ที่ต้องการส่งให้ agent นี้…" |

### 5.3 Response Display

| FR-3.1 | 3-Tab layout: Response | Reasoning | Raw JSON |
| FR-3.2 | Response Tab — แสดง response text แบบ monospace, scrollable |
| FR-3.3 | Reasoning Tab — collapse by default, แสดง reasoning/thinking content |
| FR-3.4 | Raw JSON Tab — แสดง response ดิบจาก API (สำหรับ debug) |
| FR-3.5 | Metrics Bar (แสดงตลอด ไม่ว่าจะอยู่ tab ไหน): tokens in, tokens out, latency ms, status |
| FR-3.6 | Copy-to-clipboard button สำหรับ response text |

### 5.4 Run Execution

| FR-4.1 | ใช้ `ctx.runClaude(agentId, prompt, opts)` ในการ execute (จาก plugin API) |
| FR-4.2 | แสดง progress indicator ระหว่างรัน (spinner + elapsed time counter) |
| FR-4.3 | รองรับ timeout — ถ้าเกิน 120 วินาที ให้ abort และแสดง timeout error |
| FR-4.4 | ระหว่างรัน — ปุ่ม Send เปลี่ยนเป็น Cancel |

### 5.5 Run History

| FR-5.1 | History sidebar แสดง runs เรียงจากใหม่ไปเก่า |
| FR-5.2 | เก็บ metadata: id, agentId, prompt, response (trimmed to 10KB), reasoning (trimmed to 10KB), tokensIn, tokensOut, latencyMs, timestamp, status (success/error/timeout) |
| FR-5.3 | Filter history ตาม agent |
| FR-5.4 | Search history ตาม prompt text |
| FR-5.5 | Delete runs (single หรือ clear all with confirmation) |
| FR-5.6 | เก็บสูงสุด 50 runs ใน memory — LRU eviction เมื่อถึง limit. Auto-save to `data/runs.json` ทุก run ใหม่ |

### 5.6 Test Cases

| FR-6.1 | Save run → test case (พร้อม name, expected behavior, optional tags) |
| FR-6.2 | Load test case → populate prompt + agent selection |
| FR-6.3 | Edit/delete test cases |
| FR-6.4 | รายการ test cases แสดงใน tab แยก พร้อม search/filter |

### 5.7 Compare

| FR-7.1 | เลือก 2 runs → side-by-side view |
| FR-7.2 | Delta calculation: tokens, latency |
| FR-7.3 | Text diff: side-by-side หรือ unified view |
| FR-7.4 | Compare test case expected vs actual run |

---

## 6. UI/UX Specification

### 6.1 Layout (single `panel.html`)

```
┌──────────────────────────────────────────────────────────┐
│  Agent Workbench                              [⚙] [⤢]   │
├────────────┬─────────────────────────────────────────────┤
│            │  ┌─────────────────────────────────────┐    │
│  HISTORY   │  │ Agent: [Nida (Analyst) ▼]          │    │
│  ───────── │  │                                     │    │
│  [Filter▾] │  │ ┌─────────────────────────────────┐ │    │
│  [Search]  │  │ │ Type your prompt here...        │ │    │
│            │  │ │                                 │ │    │
│  ┌───────┐ │  │ │                                 │ │    │
│  │Run 1  │ │  │ └─────────────────────────────────┘ │    │
│  │Nida   │ │  │  chars: 0                    [Send] │    │
│  │✅ 1.2s│ │  └─────────────────────────────────────┘    │
│  └───────┘ │                                             │
│  ┌───────┐ │  ┌─────────────────────────────────────┐    │
│  │Run 2  │ │  │ Tokens: 1,234 in · 567 out          │    │
│  │Arthit │ │  │ Latency: 2.3s  ✅ Success            │    │
│  │❌ err  │ │  ├─────────────────────────────────────┤    │
│  └───────┘ │  │ [Response] [Reasoning] [Raw JSON]    │    │
│  ┌───────┐ │  │ ─────────────────────────────────── │    │
│  │Run 3  │ │  │                                     │    │
│  │Krit   │ │  │ prd สำหรับฟีเจอร์ Agent Workbench   │    │
│  │✅ 3.1s│ │  │ ควรครอบคลุม...                       │    │
│  └───────┘ │  │                                     │    │
│            │  │                                     │    │
│  ───────── │  └─────────────────────────────────────┘    │
│  [Compare] │                                             │
│  [T.Cases] │  [Save as Test Case] [Copy] [Re-run]       │
├────────────┴─────────────────────────────────────────────┤
│  Status bar: Ready · Runs: 47/50                         │
└──────────────────────────────────────────────────────────┘
```

### 6.2 Color Theme (taste-skill — match office)

| Element | Color | Usage |
|---|---|---|
| Background | `#0c1322` | panel body |
| Surface | `#111b2e` | cards, input fields |
| Text primary | `#dbe7ff` | body text |
| Text secondary | `#6b7d99` | labels, timestamps |
| Accent | `#5ec8ff` | buttons, links, active tab |
| Success | `#2ecc71` | ✅ status, token savings |
| Error | `#e74c3c` | ❌ status, error messages |
| Warning | `#f39c12` | ⚠️ timeout, warnings |
| Border | `#1a2740` | dividers, card borders |
| Monospace bg | `#0a111f` | response/reasoning text area |

### 6.3 Typography

- **UI elements**: `system-ui, "Segoe UI", "Leelawadee UI", Tahoma, sans-serif`
- **Code/response text**: `"Cascadia Code", "JetBrains Mono", "Fira Code", monospace`
- **Font sizes**: 12px (labels, meta), 13px (body), 14px (headings)

### 6.4 Responsive Behavior

- History sidebar: 250px minimum, resizable
- Response panel: fills remaining space
- เมื่อ panel ถูก pop-out เป็น window: layout fluid, history sidebar collapse ได้ (toggle button)

---

## 7. Technical Constraints

### 7.1 Architecture Constraints

| Constraint | Detail |
|---|---|
| **Plugin only** | ห้ามแก้ไข daemon, godot, shell, CLI, หรือ core ระบบใดๆ |
| **Single file UI** | `panel.html` เท่านั้น — ห้ามใช้ bundler, npm, framework |
| **Zero external deps** | ไม่มี CDN, npm package, external API call — ทุกอย่าง self-contained |
| **Data storage** | `ctx.dataDir` สำหรับ persist (JSON files), `localStorage` สำหรับ UI ephemeral state |
| **Agent execution** | ใช้ `ctx.runClaude(agentId, prompt, opts)` — API มาตรฐานของ plugin |
| **Communication** | `POST /plugin/aw/cmd` สำหรับทุก operation (agent commands) + `fetch` จาก `panel.html` |

### 7.2 Execution Model

```js
// index.js — server side
module.exports = (ctx) => ({
  onCommand(cmd, args, reply) {
    if (cmd === "run") {
      // args: { agentId, prompt }
      const start = Date.now();
      ctx.runClaude(args.agentId, args.prompt)
        .then(result => {
          const run = {
            id: crypto.randomUUID(),
            agentId: args.agentId,
            prompt: args.prompt,
            response: result.text,
            reasoning: result.reasoning || null,
            tokensIn: result.usage?.input_tokens || 0,
            tokensOut: result.usage?.output_tokens || 0,
            latencyMs: Date.now() - start,
            timestamp: new Date().toISOString(),
            status: 'success'
          };
          // persist to data/runs.json (overwrite snapshot)
          // and push to in-memory array (cap at 50, LRU eviction)
          return reply({ ok: true, run });
        })
        .catch(err => {
          return reply({ ok: false, error: err.message, latencyMs: Date.now() - start });
        });
    }
    // ... other commands: history, testcases, compare
  }
});
```

### 7.3 Data Flow Diagram

```
panel.html                    index.js                   Office Daemon
──────────                    ────────                   ─────────────
   │                             │                           │
   │ POST /plugin/aw/cmd         │                           │
   │ {cmd:"run", agentId, prompt}│                           │
   │────────────────────────────→│                           │
   │                             │ ctx.runClaude(id, prompt) │
   │                             │──────────────────────────→│
   │                             │                           │
   │                             │     {text, reasoning,     │
   │                             │      usage, ...}          │
   │                             │←──────────────────────────│
   │                             │                           │
   │                             │ store run in              │
   │                             │ data/runs.json            │
   │                             │                           │
   │   {ok:true, run:{...}}     │                           │
   │←────────────────────────────│                           │
   │                             │                           │
   │ render response + metrics   │                           │
```

### 7.4 File Structure

```
plugins/agent-workbench/
  plugin.json         ← manifest
  index.js            ← server logic (onCommand: run, history, testcases, compare)
  panel.html          ← UI (single file — all HTML/CSS/JS inline)
  data/               ← auto-created by daemon
    runs.json         ← persisted run history (max 200 entries)
    testcases.json    ← persisted test cases
```

### 7.5 Dependencies

| Dependency | Version | Purpose | Note |
|---|---|---|---|
| None | — | — | Zero external dependencies |

`ctx.runClaude()` is provided by the office daemon at runtime — no npm install needed.  
All UI is vanilla HTML/CSS/JS in a single `panel.html`.

---

## 8. Risks, Assumptions, and Open Questions

### 8.1 Risks

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| `ctx.runClaude()` อาจไม่รองรับ streaming (response ใหญ่ → ต้องรอนาน) | Dev Agent รอนาน ไม่เห็น progress | Medium | แสดง spinner + elapsed time; ถ้า response >30s เพิ่ม intermediate status |
| Agent ถูก remove จาก registry ระหว่างที่ test case อ้างอิงอยู่ | Test case โหลดไม่ได้ | Low | Test case แสดง warning "Agent not found" แทนที่จะ crash |
| `data/runs.json` โตเกินไปถ้ารันบ่อย | Disk space, load time | Low | Trim response/reasoning ที่ 10KB; in-memory cap ที่ 50 runs; JSON snapshot overwrite (ไม่ append) — file size คงที่ |
| 2 dev agents ใช้ Workbench พร้อมกัน → race condition บน `runs.json` | Data corruption | Low | JSON read-write เป็น atomic ใน Node.js (single-threaded) — แต่ถ้ามี concurrency จริง อาจต้อง lock |
| Response มี PII/secret → ถูก persist ใน history | Security leak | Medium | ไม่เก็บ credential/sensitive data ใน history (แต่ระบบไม่สามารถ detect ได้ — เป็นความรับผิดชอบของ Dev Agent) |

### 8.2 Assumptions

| # | Assumption |
|---|---|
| A1 | `ctx.runClaude(agentId, prompt)` return structure มี `{ text, reasoning?, usage: { input_tokens, output_tokens } }` — ต้อง verify กับ API จริง |
| A2 | Agent roster (`ctx.reg.agents`) มี agent ทั้งหมดที่ลงทะเบียนในออฟฟิศ |
| A3 | Dev Agent ทุกคนมีสิทธิ์รัน `ctx.runClaude()` — ไม่ต้อง permission แยก |
| A4 | Plugin's `data/` directory มี read/write permission จาก daemon process |
| A5 | Panel.html เปิดครั้งเดียวต่อ session — ไม่ต้อง sync ระหว่างหลาย instances |

### 8.3 Open Questions

| # | Question | Owner | Status |
|---|---|---|---|
| Q1 | `ctx.runClaude()` API signature จริงคืออะไร? parameters, return type, error format? | Architect | ต้อง verify ก่อน implement |
| Q2 | มี rate limit สำหรับ `ctx.runClaude()` มั้ย? | Architect | ถ้ามี ต้องแสดงใน UI |
| Q3 | Agent response มี reasoning/thinking content แยกมั้ย? หรือ reasoning รวมอยู่ใน response text? | Architect | มีผลต่อ UI tab layout |
| Q4 | Test case expected behavior จะ validate ยังไง? — string match? semantic? manual review? | Product Owner | MVP = manual review (Dev Agent อ่านเอง) |
| Q5 | History ควรเก็บ response ทั้งหมด (unlimited) หรือ trim? | Product Owner | เสนอ trim ที่ 10KB เพื่อประสิทธิภาพ |

---

## 9. Success Metrics

| Metric | Target | Measurement |
|---|---|---|
| Time to first run | ≤30 วินาที (จากเปิด panel → กด Send → เห็น response ครั้งแรก) | Manual timing |
| Feedback loop reduction | จาก ~3-5 นาที (ผ่าน Director) → ≤30 วินาที (self-service) | ลดลง ≥80% |
| Director interruption | ลดการถาม "ช่วย test agent X" กับ Shino ≥70% | Ask Shino after 1 week |
| Repeat usage | Dev Agent แต่ละคนใช้ ≥5 ครั้ง/วัน | Count from history |
| Panel load time | panel.html โหลด + render ≤1 วินาที | Browser DevTools |
| Data persistence | 0 data loss ระหว่าง restart | Manual verification |

---

## 10. Phasing

### Phase 1 — MVP (Q3 2026)

- US-1: Run prompt against any agent (full flow)
- US-2: Run history
- Basic UI: Agent dropdown, prompt input, response tabs, metrics bar
- Zero external deps, single `panel.html`

### Phase 2 — Test & Compare (Q4 2026)

- US-3: Save/load test cases
- US-4: Compare runs (side-by-side + diff)
- Test case management (edit/delete/tags)

### Phase 3 — Advanced (2027+)

- Prompt template library
- Batch runs (รันหลาย prompt กับหลาย agent)
- Export/import test cases (JSON)
- Share test cases ระหว่าง dev agents
- Integration with Agent Pulse (log test results to pulse)
- Scheduled regression tests

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| **Agent Roster** | รายชื่อ agent ทั้งหมดที่ลงทะเบียนใน BagIdea Office (`ctx.reg.agents`) |
| **Run** | 1 invocation = ส่ง 1 prompt ไป 1 agent → ได้ 1 response |
| **Test Case** | prompt + expected behavior ที่ถูกเซฟไว้สำหรับรันซ้ำ |
| **Reasoning** | thinking/reasoning content ที่ agent สร้างก่อนตอบ (chain-of-thought) |
| **Tokens** | หน่วยวัดการใช้ LLM — input tokens (prompt) + output tokens (response) |
| **Latency** | เวลาทั้งหมดตั้งแต่กด Send จน response มาถึง (ms) |
| **Side-by-side Diff** | การแสดง 2 texts คู่กัน พร้อม highlight จุดที่ต่าง |
| **LRU Eviction** | Least Recently Used — ลบข้อมูลที่เก่าที่สุดเมื่อถึงขีดจำกัด |

---

## Appendix B: References

- [BagIdea Office Plugin Guide](/Users/ar677005/BagIdeaOffice/docs/guide/plugins.md) — plugin architecture specification
- [Agent Pulse PRD](/Users/ar677005/BagIdeaOffice/workspace/docs/requirements/agent-pulse-prd.md) — related monitoring plugin (reference for PRD format)
- [Pulse Dashboard PRD](/Users/ar677005/BagIdeaOffice/workspace/projects/__Pulse Dashboard Plugin__/docs/requirements/pulse-dashboard-prd.md) — related analytics plugin (reference for PRD format)