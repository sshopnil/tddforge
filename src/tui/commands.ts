export interface ParsedSlashCommand {
  name: string;
  args: string[];
}

export interface SlashCommandDefinition {
  name: string;
  usage: string;
  description: string;
  aliases?: string[];
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { name: "help", usage: "/help", description: "Show slash commands" },
  { name: "pwd", usage: "/pwd", description: "Show current workspace" },
  { name: "use", usage: "/use <dir>", description: "Switch to another workspace", aliases: ["open"] },
  { name: "doctor", usage: "/doctor", description: "Validate current provider configuration" },
  { name: "scan", usage: "/scan", description: "Rescan package manager and test framework" },
  { name: "context", usage: "/context", description: "Capture folder tree context" },
  { name: "story", usage: "/story [file]", description: "Choose a story from story/, stories/, or docs/" },
  { name: "plan", usage: "/plan [file]", description: "Build a TDD plan" },
  { name: "generate-tests", usage: "/generate-tests [folder]", description: "Create failing TDD test cases from planned edge cases" },
  { name: "monitor", usage: "/monitor [on|off]", description: "Show live test suggestions for this workspace" },
  { name: "test-failure", usage: "/test-failure", description: "Show the last failing test message prepared for LLM repair" },
  { name: "save-plan", usage: "/save-plan [name]", description: "Save latest plan to .tddforge-out" },
  { name: "copy", usage: "/copy", description: "Export a plain-text TUI snapshot for copying" },
  { name: "config", usage: "/config", description: "Show active provider and workspace config" },
  { name: "provider", usage: "/provider [setup|models|model <name>]", description: "Set up Ollama/OpenAI and switch models" },
  { name: "clear", usage: "/clear", description: "Clear the terminal conversation log" },
  { name: "exit", usage: "/exit", description: "Quit the TUI", aliases: ["quit"] }
];

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

export function getSlashCommandSuggestions(input: string, limit = 6): SlashCommandDefinition[] {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("/")) {
    return [];
  }

  const query = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";

  if (!query) {
    return SLASH_COMMANDS;
  }

  return SLASH_COMMANDS
    .filter((command) => {
      const aliases = command.aliases ?? [];
      return command.name.startsWith(query) || aliases.some((alias) => alias.startsWith(query));
    })
    .slice(0, limit);
}

export const HELP_TEXT = [
  ...SLASH_COMMANDS.map((command) => `${command.usage.padEnd(24)} ${command.description}`),
  "",
  "Plain text input updates the in-memory story draft. Then run /plan."
].join("\n");
