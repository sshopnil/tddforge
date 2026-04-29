# TDDForge

TDDForge is a repo-native CLI for turning user stories into TDD plans, generated test scaffolds, and test-failure context for local codebases.

It has two modes:

- Non-interactive CLI commands for `init`, `doctor`, and `plan`
- An interactive terminal UI that starts when you run `tddforge` with no subcommand

## Requirements

- Node.js `20+`
- npm, pnpm, or yarn
- An interactive terminal for the TUI
- At least one model provider:
  - Ollama for local models
  - OpenAI for hosted models

## Install

### Run from this repository

```bash
npm install
npm run build
node dist/index.js --help
```

Start the TUI from the repo:

```bash
node dist/index.js
```

Run a CLI command:

```bash
node dist/index.js doctor
node dist/index.js plan --story ./docs/sample-story.md
```

### Install as a local CLI in the current environment

From the repository root:

```bash
npm install
npm run build
npm link
tddforge --help
```

## Quick Start

Initialize workspace config:

```bash
tddforge init
```

Start the interactive UI:

```bash
tddforge
```

Or run the non-interactive planner directly:

```bash
tddforge plan --story ./story.md
tddforge plan --story ./story.md --json
```

Check provider connectivity:

```bash
tddforge doctor
```

## CLI Commands

### `tddforge`

Starts the interactive TUI when no subcommand is provided.

If the current terminal is not interactive, TDDForge exits and tells you to use a non-interactive command such as `doctor` or `plan --story`.

### `tddforge init`

Creates workspace-local config at `.tddforge/config.json`.

Parameters:

- None

Example:

```bash
tddforge init
```

### `tddforge doctor`

Loads the current workspace config, resolves provider settings, and validates provider connectivity.

Parameters:

- None

Example:

```bash
tddforge doctor
```

### `tddforge plan --story <path> [--json]`

Analyzes a story file and prints a structured TDD plan.

Parameters:

- `-s, --story <path>`: required path to a story markdown or text file
- `--json`: optional raw JSON output instead of human-readable output

Examples:

```bash
tddforge plan --story ./docs/password-reset.md
tddforge plan --story ./docs/password-reset.md --json
```

## TUI Usage

Run:

```bash
tddforge
```

The TUI is repo-aware and keyboard-driven.

### Session Flow

- On startup, TDDForge shows a session picker
- Use `Up` and `Down` to choose a saved session or `New session`
- Press `Enter` to continue
- Sessions are stored under `.tddforge/sessions/`

### General Navigation

- `Tab`: switch panels
- `Shift+Tab`: switch panels backward
- `Up` and `Down`: scroll the active panel when the input is empty
- `Ctrl+C`, `/exit`, `/quit`: exit immediately

### Story Workflow

- Type plain text to build or extend an in-memory story draft
- `/story`: browse story files from `story/`, `stories/`, or `docs/`
- `/story <file>`: load a readable file from the current workspace
- `/story <text>`: treat the argument as story text if the path does not resolve to a readable file
- `/context`: capture workspace tree context before planning
- `/plan`: build a TDD plan from the active story context

### Interactive Test Environment Setup

When TDDForge detects that the workspace has no usable test framework, it starts an interactive setup flow inside the TUI.

Flow:

1. TDDForge asks whether you want to set up testing
2. You choose the framework, such as `Vitest`, `Jest`, or `Pytest`
3. You choose the target test folder such as `tests/`, `test/`, or `__tests__/`
4. TDDForge writes the config and enables monitor mode

Behavior:

- Node workspaces can be configured for Vitest or Jest
- Python workspaces can be configured for Pytest
- For JavaScript and TypeScript projects, TDDForge installs the selected test dependency if needed
- TDDForge creates the selected test directory if it does not exist
- TDDForge writes `vitest.config.mjs`, `jest.config.mjs`, or `pytest.ini` when needed

### Monitor and Failure Workflow

- `/monitor`: enable monitor mode
- Monitor watches relevant source and test files
- On a relevant file change, TDDForge runs the workspace test command once
- It captures pass/fail/skipped counts and extracts the concrete failure message
- `/test-failure`: print the latest LLM-ready failure summary

### Generated Test Workflow

- `/generate-tests`: write test todos from the latest plan
- `/generate-tests [folder]`: override the output directory
- Generated tests try to follow the repository’s existing framework and test placement
- Generated files are comment-free by design

### Save and Export

- `/save-plan [name]`: save the latest plan as markdown and JSON under `.tddforge-out/`
- `/copy`: export a plain-text TUI snapshot to `.tddforge-out/tui-copy.txt`

### TUI Slash Commands

Available commands:

- `/help`
- `/pwd`
- `/use <dir>`
- `/doctor`
- `/scan`
- `/context`
- `/story [file]`
- `/plan [file]`
- `/generate-tests [folder]`
- `/monitor [on|off]`
- `/test-failure`
- `/save-plan [name]`
- `/copy`
- `/config`
- `/provider [setup|models|model <name>]`
- `/clear`
- `/exit`
- `/quit`

## Provider and Model Setup

TDDForge supports two provider types:

- `ollama`
- `openai`

Workspace config lives at:

```json
.tddforge/config.json
```

Default generated config:

```json
{
  "provider": {
    "type": "ollama",
    "model": "gemma4:e4b",
    "host": "http://127.0.0.1:11434"
  },
  "testFramework": "auto"
}
```

### Ollama Setup

Requirements:

- Ollama installed and running
- At least one local model available

Example config:

```json
{
  "provider": {
    "type": "ollama",
    "model": "gemma4:e4b",
    "host": "http://127.0.0.1:11434"
  },
  "testFramework": "auto"
}
```

Environment override:

- `TDDFORGE_OLLAMA_HOST`

Runtime tuning env vars:

- `TDDFORGE_OLLAMA_NUM_CTX`
- `TDDFORGE_OLLAMA_NUM_PREDICT`
- `TDDFORGE_OLLAMA_NUM_THREAD`
- `TDDFORGE_OLLAMA_NUM_GPU`

Interactive model selection in TUI:

- `/provider setup`
- choose `ollama`
- pick a model returned from `GET /api/tags`

### OpenAI Setup

Example config:

```json
{
  "provider": {
    "type": "openai",
    "model": "gpt-4o-mini"
  },
  "testFramework": "auto"
}
```

Supported environment variables:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_BASE_URL`

Notes:

- `OPENAI_API_KEY` is required for OpenAI requests
- `OPENAI_MODEL` overrides the model stored in `.tddforge/config.json`
- `OPENAI_BASE_URL` is optional and useful for compatible gateways

Interactive model selection in TUI:

- `/provider setup`
- choose `openai`
- paste the API key if the current config has none
- pick a model from the provider API

### Switching Providers or Models

Inside the TUI:

- `/provider setup`: full guided provider flow
- `/provider models`: fetch models for the active provider
- `/provider model <name>`: set the active provider model directly
- `/config`: print current provider and framework preference

## Workspace Files Created by TDDForge

TDDForge may create or update:

- `.tddforge/config.json`
- `.tddforge/sessions/*.json`
- `.tddforge-out/*.md`
- `.tddforge-out/*.json`
- `.tddforge-out/tui-copy.txt`
- `vitest.config.mjs`
- `jest.config.mjs`
- `pytest.ini`
- test folders such as `tests/`, `test/`, or `__tests__/`

## Development Setup

### Create a Local Development Environment

```bash
git clone <repo-url>
cd tddforge
npm install
npm run build
npm run typecheck
npm run lint
npm test
```

Run the app in development:

```bash
npm run dev
```

Run a direct command in development:

```bash
npm run dev -- doctor
npm run dev -- plan --story ./docs/sample-story.md
```

### Contribution Checks

Before contributing, run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

### Project Structure

```text
src/
  commands/         Non-interactive CLI commands
  config/           Workspace config loading and schema
  export/           Plan export and generated test output
  providers/        Ollama and OpenAI provider implementations
  story-engine/     Prompt building, planning workflow, plan schema
  tui/              Storm TUI, slash commands, sessions, monitor flow
  utils/            Shared helpers such as JSON repair/parsing
  workspace/        Repo scan, test placement, test setup, folder context
  index.ts          CLI entrypoint

tests/              Vitest suite
.github/workflows/  CI, quality gates, publish workflow
project_context.md  Repo-local implementation notes and behavior contract
```

### Important Source Files

- [`src/index.ts`](/home/shayan/Desktop/Office/projects/code/tddforge/src/index.ts): CLI entrypoint and subcommand registration
- [`src/tui/ui.tsx`](/home/shayan/Desktop/Office/projects/code/tddforge/src/tui/ui.tsx): main TUI state machine and interaction flow
- [`src/tui/commands.ts`](/home/shayan/Desktop/Office/projects/code/tddforge/src/tui/commands.ts): slash command registry and parsing
- [`src/tui/provider-setup.ts`](/home/shayan/Desktop/Office/projects/code/tddforge/src/tui/provider-setup.ts): provider auth, model discovery, config save helpers
- [`src/story-engine/planner.ts`](/home/shayan/Desktop/Office/projects/code/tddforge/src/story-engine/planner.ts): story-to-plan workflow
- [`src/workspace/scan.ts`](/home/shayan/Desktop/Office/projects/code/tddforge/src/workspace/scan.ts): workspace detection for language, framework, and test files
- [`src/workspace/test-setup.ts`](/home/shayan/Desktop/Office/projects/code/tddforge/src/workspace/test-setup.ts): interactive test environment setup actions
- [`src/export/generated-tests.ts`](/home/shayan/Desktop/Office/projects/code/tddforge/src/export/generated-tests.ts): generated test scaffold writing

## Notes

- The README documents the current implemented surface, not planned future commands
- The TUI is the primary workflow; the CLI commands are intentionally narrower
- Generated runtime artifacts under `.tddforge-out/` should stay out of commits
