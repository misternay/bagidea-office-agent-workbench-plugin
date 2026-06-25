# 🧪 Agent Workbench

A plugin for [BagIdea Office](https://github.com/bagidea/bagidea-office) — test and benchmark AI agents.

## Features

- **Run** — run a prompt on any agent and capture the response, token usage, and elapsed time.
- **Model Override** — pick the model (haiku/sonnet/opus) to compare performance vs. cost.
- **Save Case** — save a result as a test case to check for regressions later.
- **Dashboard Panel** — a UI to review past runs, see token usage, and compare runs.

## Install

1. In BagIdea Office: **⋯ → 🧩 Plugins Hub** → search "Agent Workbench" → Install.
2. Or manually: `git clone https://github.com/misternay/bagidea-office-agent-workbench-plugin.git plugins/agent-workbench`

## Usage

```
POST /plugin/agent-workbench/cmd  { "cmd": "run",      "args": { "agent": "krit", "prompt": "...", "model": "haiku" } }
POST /plugin/agent-workbench/cmd  { "cmd": "list-agents" }
POST /plugin/agent-workbench/cmd  { "cmd": "save-case", "args": { "runId": "...", "name": "smoke-test" } }
```

Or use it through the panel: `GET /plugin/agent-workbench/panel`

## License

MIT
