import { describe, expect, it } from "vitest";
import { getSlashCommandSuggestions, parseSlashCommand } from "../src/tui/commands.js";

describe("parseSlashCommand", () => {
  it("parses slash commands with arguments", () => {
    expect(parseSlashCommand("/use ../repo")).toEqual({
      name: "use",
      args: ["../repo"]
    });
  });

  it("supports quoted arguments", () => {
    expect(parseSlashCommand('/story "docs/sample story.md"')).toEqual({
      name: "story",
      args: ["docs/sample story.md"]
    });
  });

  it("returns null for non-command input", () => {
    expect(parseSlashCommand("As a user I want a reset flow")).toBeNull();
  });

  it("suggests commands from slash input", () => {
    expect(getSlashCommandSuggestions("/").map((command) => command.name)).toEqual([
      "help",
      "pwd",
      "use",
      "doctor",
      "scan",
      "context",
      "story",
      "plan",
      "generate-tests",
      "monitor",
      "test-failure",
      "save-plan",
      "copy",
      "config",
      "provider",
      "clear",
      "exit"
    ]);
    expect(getSlashCommandSuggestions("/mon").map((command) => command.name)).toEqual(["monitor"]);
    expect(getSlashCommandSuggestions("plain text")).toEqual([]);
  });
});
