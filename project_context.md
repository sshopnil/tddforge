# TDDForge Project Context

## Purpose

TDDForge is a TypeScript ESM CLI that helps turn user stories into structured TDD plans and generated test scaffolds for the current repository.

The main user-facing flows are:

- CLI commands such as `doctor`, `plan --story <file>`, and the default interactive TUI.
- A repo-aware Ink TUI for selecting sessions, loading story files, building plans, answering ambiguities, monitoring test status, and generating test todo files.
- CI/GitHub Actions workflows for normal CI, ISO-style quality checks, and npm publishing.

## Tech Stack

- Runtime: Node.js `>=20`
- Language: TypeScript ESM
- CLI: `commander`
- TUI: `ink`, `ink-text-input`, React
- Testing: Vitest
- Build: `tsup`
- Lint: ESLint flat config
- Providers: Ollama and OpenAI abstractions

Important scripts:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Key Directories

- `src/index.ts`: CLI entrypoint.
- `src/commands/`: non-interactive CLI commands.
- `src/tui/`: Ink TUI, command metadata, story discovery, session persistence.
- `src/story-engine/`: prompt creation, model planning workflow, Zod plan schema.
- `src/workspace/`: repo scanning, tree context, test framework/file detection, generated-test placement.
- `src/export/`: plan export and generated test file writing.
- `src/providers/`: LLM provider interfaces and implementations.
- `tests/`: Vitest test suite.
- `.github/workflows/`: CI, ISO quality checks, npm publish workflow.

## TUI Behavior

The TUI starts with session selection:

- Uses Up/Down to select an existing session or `New session`.
- Enter loads/creates the selected session.
- Sessions autosave under `.tddforge/sessions/`.

Navigation:

- `Tab` switches panels: `status`, `monitor`, `session`.
- `Shift+Tab` goes backward.
- `Up/Down` scroll the active panel when the input is empty and navigate input history while editing text.
- When slash command suggestions are visible, `Up/Down` selects a suggestion and Enter runs the highlighted command.
- Scrollable panels wrap long lines to the current terminal width, clamp scroll position after resize, and auto-follow the latest lines until the user scrolls upward.
- `/exit` and `/quit` should immediately close the TUI, even during unanswered questions.

Story flow:

- `/story` opens a selectable list of story files from `story/`, `stories/`, and `docs/`.
- Story selection uses Up/Down and Enter, not typed numbers.
- `/story <file>` loads a readable file.
- `/story <pasted text>` stores the text directly as story context.
- Plain text input appends to the current story context.

Plan flow:

- `/plan` builds a structured plan from active story context.
- Plan output is shown as stacked sections, not a terminal table.
- If the plan includes ambiguities, the TUI asks one question at a time.
- The user types each answer and presses Enter; answers are appended to story context.
- No forced yes/no prompt should appear after `/plan`.
- The TUI only suggests `/generate-tests` when edge cases exist.

Monitor/test flow:

- `/monitor` switches to the monitor tab.
- Monitor refreshes suggestions only after a new git commit.
- Test commands are not run continuously on startup or commit polling.
- When monitor mode sees a relevant source or test file edit, it runs the repo test command once, captures pass/fail/skipped counts, extracts the specific failure message, and stores an LLM-ready failure context.
- `/test-failure` prints the latest captured failure context so an LLM repair can use the exact failing message; test file edits should still be saved only after user review and confirmation.
- Test status is initialized on startup and displayed in the status panel.
- Busy TUI actions show an animated progress bar instead of the old `Working...` text.

Provider/model performance:

- Planning prompts compact workspace scan data, cap dependency/test-file lists, and truncate very large story/tree context before sending it to the model.
- Ollama generation sends bounded runtime options by default: `num_ctx`, `num_predict`, CPU thread count, and GPU layer offload.
- Ollama runtime options can be overridden with `TDDFORGE_OLLAMA_NUM_CTX`, `TDDFORGE_OLLAMA_NUM_PREDICT`, `TDDFORGE_OLLAMA_NUM_THREAD`, and `TDDFORGE_OLLAMA_NUM_GPU`.

Copy/export:

- `/copy` writes a clean plain-text snapshot to `.tddforge-out/tui-copy.txt`.
- Copy output must contain only text content, not Ink borders, colors, or hidden terminal formatting.

## Test Generation Rules

Generated tests are created by `src/export/generated-tests.ts`.

Rules:

- Generate files near existing checked-in test files when possible.
- Repo scan detects Vitest, Jest, and Pytest test files.
- If existing test files exist, generated files should use the same area/framework style.
- Fallback directory is `tests`.
- Generated test files must not include comments.
- Vitest/Jest output uses `it.todo(...)`.
- Pytest output uses skipped test functions.

## Workspace Scan

`scanWorkspace()` returns:

- package manager
- detected test framework: `vitest`, `jest`, `pytest`, or `unknown`
- language/module system
- test directories
- checked-in test files with detected framework

This scan is used by TUI status, monitor behavior, and generated-test placement.

## LLM JSON Parsing

Model output is parsed through `parseModelJsonObject()` in `src/utils/json.ts`.

It extracts a JSON object and repairs common model formatting issues:

- trailing commas
- missing commas between strings
- missing commas between object/array elements
- smart quotes

If parsing still fails, it throws a clearer `Model response did not contain parseable JSON...` error.

## GitHub Actions

Workflows:

- `.github/workflows/ci.yml`: typecheck, lint, test, build.
- `.github/workflows/iso-quality.yml`: stricter quality gates including package dry-run and npm audit.
- `.github/workflows/publish.yml`: release-triggered npm publish.

Both `main` and `master` are supported for push triggers.

## Implementation Preferences

- Keep changes small and aligned with existing modules.
- Prefer reusable helpers in `src/tui/`, `src/workspace/`, or `src/export/` over large inline TUI logic when behavior is testable.
- Keep generated artifacts out of git.
- Run at minimum `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` after changes.
