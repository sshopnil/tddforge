# TDDForge Implementation Plan

## Overview

This document outlines the complete implementation plan for TDDForge, analyzing what has been completed and what remains for the remaining development phases.

---

## Progress Summary

### Completed: Days 1-3

| Day | Focus | Status |
|-----|-------|--------|
| Day 1 | Project setup, CLI foundation, config system, provider abstraction | ✅ Complete |
| Day 2 | Workspace scanning, planning workflow, OpenAI integration | ✅ Complete |
| Day 3 | Interactive TUI, slash commands, folder context capture | ✅ Complete |

### Remaining: Days 4-5

| Day | Focus | Status |
|-----|-------|--------|
| Day 4 | Test generation flow and safe file output planning | 🔄 Planned |
| Day 5 | Test execution, failure analysis foundation, docs and polish | 🔄 Planned |

---

## Day 1: Project Setup, CLI Foundation, Config System, Provider Abstraction

### What Was Built

1. **Project Structure**
   - Created standalone Node.js/TypeScript project
   - Set up build system with tsup
   - Configured ESLint, TypeScript, and Vitest
   - Initialized git repository

2. **CLI Foundation**
   - Entry point (`src/index.ts`) that bootstraps the application
   - Command system using Commander.js
   - Basic command registration (`init`, `doctor`, `plan`)
   - Argument parsing and option handling
   - Error handling and exit codes

3. **Config System**
   - Schema definition with Zod for provider config
   - Local config management in `.tddforge/config.json`
   - Config loading with environment variable support
   - Support for both Ollama and OpenAI configurations

4. **Provider Abstraction**
   - Abstract interface (`LlmProvider`) defining contract
   - `OllamaProvider` for local Ollama API
   - `OpenAiProvider` for OpenAI API
   - Factory function for provider selection
   - Health check functionality for both providers

5. **Testing Foundation**
   - Config loading tests
   - Provider factory tests
   - Doctor command behavior tests

### Key Files Created

- `src/index.ts` - Main entry point
- `src/config/schema.ts` - Zod schemas
- `src/config/local-config.ts` - Config file handling
- `src/config/load-config.ts` - Config loader
- `src/providers/types.ts` - Provider interface
- `src/providers/factory.ts` - Provider factory
- `src/providers/ollama.ts` - Ollama implementation
- `src/providers/openai.ts` - OpenAI implementation

---

## Day 2: Workspace Scanning, Planning Workflow, OpenAI Integration

### What Was Built

1. **Workspace Scanning**
   - Detect package manager (npm, pnpm, yarn)
   - Detect test framework (Vitest, Jest)
   - Detect language (TypeScript, JavaScript)
   - Detect module system (ESM, CommonJS)
   - Identify test directories
   - Extract scripts and dependencies

2. **Planning Workflow**
   - Story input from file or CLI argument
   - Requirement normalization
   - Ambiguity detection
   - Edge case generation
   - Test scenario creation
   - Structured JSON output validation

3. **OpenAI Integration**
   - Connected to OpenAI Responses API
   - Model configuration via config or environment
   - Proper error handling for API calls
   - Structured output parsing

4. **Additional Tests**
   - Workspace scanning tests
   - Planner workflow tests with mock provider

### Key Files Created

- `src/workspace/types.ts` - Workspace types
- `src/workspace/scan.ts` - Workspace scanner
- `src/story-engine/schema.ts` - Planning schemas
- `src/story-engine/prompt.ts` - Prompt builder
- `src/story-engine/planner.ts` - Planning orchestration
- `src/commands/plan.ts` - Plan command

---

## Day 3: Interactive TUI, Slash Commands, Folder Context Capture

### What Was Built

1. **Interactive Terminal UI**
   - Ink-based React terminal application
   - Default launch when running `tddforge` without arguments
   - Session log with different tone styling (info, success, error, muted)
   - Workspace-aware state management
   - Clean fallback for non-interactive terminals

2. **Slash Commands**
   - `/help` - Show available commands
   - `/pwd` - Show current workspace
   - `/use <dir>` - Switch workspace
   - `/doctor` - Validate provider config
   - `/scan` - Rescan workspace metadata
   - `/context` - Capture folder tree context
   - `/story <file>` - Load story from file
   - `/plan [file]` - Generate TDD plan
   - `/save-plan [name]` - Save plan to files
   - `/config` - Show active configuration
   - `/clear` - Clear session log
   - `/exit` - Exit TUI

3. **Folder Context Capture**
   - OS-native tree command integration
   - Fallback Node.js-based tree generation
   - Truncated output for LLM context window
   - Cross-platform support (Linux, macOS, Windows)

4. **Export System**
   - JSON export with full plan data
   - Markdown export with formatted output
   - Save to `.tddforge-out/` directory

5. **Additional Tests**
   - Slash command parsing tests
   - Save plan artifact tests

### Key Files Created

- `src/tui/run.tsx` - TUI launcher
- `src/tui/ui.tsx` - Main TUI component
- `src/tui/commands.ts` - Command parsing and help
- `src/workspace/context.ts` - Folder tree capture
- `src/export/plan-markdown.ts` - Markdown renderer
- `src/export/save-plan.ts` - Plan saving logic

---

## Day 4: Test Generation Flow and Safe File Output Planning

### What's Planned

1. **Test Generation Flow**
   - Generate actual Jest/Vitest test files from planned scenarios
   - Convert test scenarios to proper test code syntax
   - Handle different test frameworks (Vitest, Jest)
   - Support various test patterns (unit, integration, e2e)

2. **Safe File Output Planning**
   - Determine appropriate target directory for test files
   - Avoid overwriting existing tests
   - Support dry-run preview before writing
   - Handle file naming conventions
   - Create directory structure if needed

3. **Implementation Details**

   ```typescript
   // Planned test generation flow
   1. Take plan output from Day 2
   2. Detect target test file location in repo
   3. Map test scenarios to proper test code
   4. Apply framework-specific syntax (Vitest vs Jest)
   5. Preview generated files (dry-run)
   6. Write to appropriate location
   ```

4. **Key Components to Implement**
   - `src/test-engine/` directory
   - Test file generator
   - File path resolver
   - Dry-run preview system

---

## Day 5: Test Execution, Failure Analysis Foundation, Docs and Polish

### What's Planned

1. **Test Execution**
   - Run generated tests in the workspace
   - Execute using proper package manager commands
   - Handle Vitest, Jest, npm, yarn, pnpm
   - Capture test output and results

2. **Failure Analysis Foundation**
   - Parse test failure output
   - Map failures to missing behavior
   - Generate helpful feedback for developers
   - Identify which requirements are not met

3. **Implementation Details**

   ```typescript
   // Planned execution flow
   1. Take generated test files
   2. Run test command in workspace
   3. Capture stdout/stderr
   4. Parse test results
   5. Analyze failures
   6. Generate missing behavior report
   ```

4. **Documentation and Polish**
   - Complete README with all commands
   - Add command reference documentation
   - User guide for TUI and CLI
   - Architecture documentation
   - Final code polish and cleanup
   - Update project proposal

5. **Key Components to Implement**
   - `src/runner/` directory
   - Test executor
   - Output parser
   - `analyze` command
   - `run` command

---

## Architecture Summary

```
User Input
    │
    ▼
┌─────────────────────────────┐
│   CLI Entry (index.ts)     │
│   - commander              │
│   - TUI launcher          │
└─────────────────────────────┘
    │
    ├──────────────────────┬──────────────────────┐
    ▼                     ▼                      ▼
CLI Commands          Config Layer           Provider Layer
- init               - schema.ts            - factory.ts
- doctor             - local-config.ts      - openai.ts
- plan               - load-config.ts      - ollama.ts
- (future run)                              
                        │
                        ▼
                 Workspace Layer
                 - scan.ts (detection)
                 - context.ts (folder tree)
                        │
                        ▼
                Story Engine Layer
                - schema.ts (output structure)
                - prompt.ts (LLM instructions)
                - planner.ts (orchestration)
                        │
                        ▼
                 Export Layer
                 - plan-markdown.ts
                 - save-plan.ts
                        │
                        ▼
                 TUI Layer
                 - ui.tsx
                 - commands.ts
                 - run.tsx

(Future: Test Engine + Runner + Analysis)
```

---

## Next Steps

### Immediate Priorities

1. **Day 4 Implementation**
   - Implement test generation from planned scenarios
   - Create safe file writing system
   - Add dry-run preview

2. **Day 5 Implementation**
   - Add test execution capability
   - Build failure analysis system
   - Complete documentation

### Testing Strategy

- Continue unit tests for new modules
- Add integration tests for CLI workflows
- Test across different repo structures
- Validate test generation output

### Future Considerations

- Multi-language support beyond Node.js
- Enhanced failure analysis
- Team collaboration features
- Cloud execution option

---

## Summary

The project has successfully completed three days of implementation, establishing a solid foundation for a repo-native testing CLI and terminal UI. The remaining two days focus on completing the test generation and execution workflow, with attention to safe file handling and meaningful failure analysis.

The architecture is modular and extensible, making it straightforward to add new features while keeping the codebase maintainable.