# 🧪 Agent Workbench

Plugin สำหรับ [BagIdea Office](https://github.com/bagidea/bagidea-office) — ทดสอบและ benchmark AI agents

## ความสามารถ

- **Run** — รัน prompt บน agent ไหนก็ได้ จับ response, token usage, และ elapsed time
- **Model Override** — เลือก model ได้ (haiku/sonnet/opus) เพื่อเทียบ performance/ราคา
- **Save Case** — เก็บผลลัพธ์เป็น test case ไว้เช็ค regression ภายหลัง
- **Dashboard Panel** — UI สำหรับดูผลรันย้อนหลัง, token usage, และเปรียบเทียบ runs

## ติดตั้ง

1. ใน BagIdea Office: **⋯ → 🧩 Plugins Hub** → ค้นหา "Agent Workbench" → ติดตั้ง
2. หรือ manual: `git clone https://github.com/misternay/bagidea-office-agent-workbench-plugin.git plugins/agent-workbench`

## วิธีใช้

```
POST /plugin/agent-workbench/cmd  { "cmd": "run",      "args": { "agent": "krit", "prompt": "...", "model": "haiku" } }
POST /plugin/agent-workbench/cmd  { "cmd": "list-agents" }
POST /plugin/agent-workbench/cmd  { "cmd": "save-case", "args": { "runId": "...", "name": "smoke-test" } }
```

หรือใช้ผ่าน panel: `GET /plugin/agent-workbench/panel`

## License

MIT