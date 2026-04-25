export interface ParsedSlashCommand {
  name: string;
  args: string[];
}

export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const tokens = trimmed.slice(1).match(/(?:"([^"]+)")|(?:'([^']+)')|(\S+)/g) ?? [];
  const normalized = tokens.map((token) => token.replace(/^['"]|['"]$/g, ""));
  const [name, ...args] = normalized;

  if (!name) {
    return null;
  }

  return { name: name.toLowerCase(), args };
}

export const HELP_TEXT = [
  "/help                 Show slash commands",
  "/pwd                  Show current workspace",
  "/use <dir>            Switch to another workspace",
  "/doctor               Validate current provider configuration",
  "/scan                 Rescan package manager and test framework",
  "/context              Capture folder tree context for the current workspace",
  "/story <file>         Load a story file into the draft buffer",
  "/plan [file]          Build a TDD plan from the loaded story or a file",
  "/save-plan [name]     Save latest plan to .tddforge-out/<name>.{json,md}",
  "/config               Show active provider and workspace config",
  "/clear                Clear the terminal conversation log",
  "/exit                 Quit the TUI",
  "",
  "Plain text input updates the in-memory story draft. Then run /plan."
].join("\n");
