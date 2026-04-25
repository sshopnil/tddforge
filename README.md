# TDDForge

TDDForge is a repo-native CLI that turns user stories into test plans, generated tests, and failure analysis for local codebases.

## Current Status

The current scaffold includes:

- TypeScript CLI foundation
- `init` and `doctor` commands
- `plan --story <file>` command
- default Ink-based TUI when running `tddforge`
- config loading and validation
- provider abstractions for Ollama and OpenAI
- workspace scanning for package manager and Jest/Vitest
- first real story-to-plan workflow
- workspace switching and folder-tree context capture in the TUI
- save/export of plans to `.tddforge-out/`
- build, lint, and test setup

Default local model: `gemma4:e4b`

The CLI also supports OpenAI via `.env`:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

## Quick Start

```bash
npm install
npm run build
node dist/index.js
node dist/index.js doctor
node dist/index.js plan --story ./story.md
```

## TUI Usage

Run the interactive UI:

```bash
tddforge
```

Inside the TUI:

- type plain text to build a story draft
- run `/plan` to generate a TDD plan from the draft
- run `/story docs/sample-story.md` to load a file
- run `/context` to capture a folder tree for the current workspace
- run `/save-plan password-reset` to save markdown and JSON outputs

Useful slash commands:

- `/help`
- `/pwd`
- `/use <dir>`
- `/doctor`
- `/scan`
- `/context`
- `/story <file>`
- `/plan [file]`
- `/save-plan [name]`
- `/config`
- `/clear`
- `/exit`

## Planned Commands

- `tddforge init`
- `tddforge doctor`
- `tddforge plan --story story.md`
- `tddforge generate --story story.md`
- `tddforge run`
- `tddforge analyze`
- `tddforge export`
