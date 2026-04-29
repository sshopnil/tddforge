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

TDDForge is packaged as an npm CLI named `tddforge`. The package is not published to the public npm registry yet, so `npm install -g tddforge` does not work at the moment.

Until the first npm release is published, install it globally from the GitHub repository or link it from a local clone.

### Linux and macOS

Install globally from GitHub:

```bash
npm install -g github:sshopnil/tddforge
tddforge --help
```

Or install from a local clone:

```bash
git clone https://github.com/sshopnil/tddforge.git
cd tddforge
npm install
npm run build
npm link
tddforge --help
```

If global npm installs require administrator access on your machine, configure an npm user prefix instead of using `sudo`:

```bash
npm config set prefix ~/.npm-global
```

Then add `~/.npm-global/bin` to your shell `PATH`.

### Windows

Install globally from GitHub in PowerShell:

```powershell
npm install -g github:sshopnil/tddforge
tddforge --help
```

Or install from a local clone:

```powershell
git clone https://github.com/sshopnil/tddforge.git
cd tddforge
npm install
npm run build
npm link
tddforge --help
```

If `tddforge` is not found after installation, make sure the npm global binary directory is on your `PATH`:

```powershell
npm prefix -g
```

The executable is usually under the `bin` directory inside that global prefix.

### Run Without Global Install

From a local clone:

```bash
npm install
npm run build
node dist/index.js --help
node dist/index.js doctor
node dist/index.js plan --story ./docs/sample-story.md
```

Start the TUI from the repo:

```bash
node dist/index.js
```

### Registry Release Reminder

The repository has an npm publish workflow, but the `tddforge` package is not available on npm yet. After publishing, the normal global install command should be:

```bash
npm install -g tddforge
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

Use Node.js `20+` and npm. The repository includes `package-lock.json`, so `npm ci` is the most reproducible install for contributors and CI.

```bash
git clone https://github.com/sshopnil/tddforge.git
cd tddforge
npm ci
```

Create a workspace config for local manual testing:

```bash
npm run dev -- init
```

Run the app in development:

```bash
npm run dev
```

Run direct CLI commands in development:

```bash
npm run dev -- --help
npm run dev -- doctor
npm run dev -- plan --story ./docs/sample-story.md
```

Build and test the production entrypoint:

```bash
npm run build
node dist/index.js --help
node dist/index.js doctor
```

### Provider Setup for Development

By default, `tddforge init` creates an Ollama config using `http://127.0.0.1:11434` and model `gemma4:e4b`.

For Ollama development:

```bash
ollama serve
ollama pull gemma4:e4b
npm run dev -- doctor
```

For OpenAI development, edit `.tddforge/config.json` to use `"type": "openai"`, then set:

```bash
export OPENAI_API_KEY="..."
export OPENAI_MODEL="gpt-4o-mini"
```

On Windows PowerShell:

```powershell
$env:OPENAI_API_KEY="..."
$env:OPENAI_MODEL="gpt-4o-mini"
```

### Quality Checks

Before opening a PR or release, run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Useful scripts:

- `npm run dev`: run the TypeScript CLI entrypoint through `tsx`
- `npm run build`: build `dist/index.js` and `dist/index.d.ts` with `tsup`
- `npm run typecheck`: run TypeScript without emitting files
- `npm run lint`: run ESLint flat config
- `npm test`: run the Vitest suite once
- `npm run test:watch`: run Vitest in watch mode

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

- [`src/index.ts`](src/index.ts): CLI entrypoint and subcommand registration
- [`src/tui/ui.tsx`](src/tui/ui.tsx): main TUI state machine and interaction flow
- [`src/tui/commands.ts`](src/tui/commands.ts): slash command registry and parsing
- [`src/tui/provider-setup.ts`](src/tui/provider-setup.ts): provider auth, model discovery, config save helpers
- [`src/story-engine/planner.ts`](src/story-engine/planner.ts): story-to-plan workflow
- [`src/workspace/scan.ts`](src/workspace/scan.ts): workspace detection for language, framework, and test files
- [`src/workspace/test-setup.ts`](src/workspace/test-setup.ts): interactive test environment setup actions
- [`src/export/generated-tests.ts`](src/export/generated-tests.ts): generated test scaffold writing

## Notes

- The README documents the current implemented surface, not planned future commands
- The TUI is the primary workflow; the CLI commands are intentionally narrower
- Generated runtime artifacts under `.tddforge-out/` should stay out of commits
