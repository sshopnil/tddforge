import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useMemo, useState } from "react";
import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { loadResolvedConfig, type ResolvedConfig } from "../config/load-config.js";
import { savePlanArtifacts } from "../export/save-plan.js";
import { createProvider } from "../providers/factory.js";
import { buildPlanFromStoryFile, buildPlanFromStoryText, type PlanWorkflowResult } from "../story-engine/planner.js";
import { getWorkspaceTreeContext } from "../workspace/context.js";
import { scanWorkspace } from "../workspace/scan.js";
import type { WorkspaceScanResult } from "../workspace/types.js";
import { HELP_TEXT, parseSlashCommand } from "./commands.js";

type LogTone = "info" | "success" | "error" | "muted";

interface LogEntry {
  id: number;
  tone: LogTone;
  text: string;
}

interface AppProps {
  initialWorkspaceRoot: string;
}

export function TddforgeApp({ initialWorkspaceRoot }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [workspaceRoot, setWorkspaceRoot] = useState(path.resolve(initialWorkspaceRoot));
  const [storyDraft, setStoryDraft] = useState("");
  const [latestPlan, setLatestPlan] = useState<PlanWorkflowResult | null>(null);
  const [latestWorkspaceScan, setLatestWorkspaceScan] = useState<WorkspaceScanResult | null>(null);
  const [folderTreeContext, setFolderTreeContext] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>(() => [
    { id: 1, tone: "success", text: "Welcome to TDDForge TUI. Type /help to see commands." }
  ]);

  const activeConfig = useMemo<ResolvedConfig>(() => loadResolvedConfig(workspaceRoot), [workspaceRoot]);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      exit();
    }
  });

  async function submitCurrentInput(): Promise<void> {
    const value = input.trim();
    if (!value || busy) {
      return;
    }

    setInput("");

    const command = parseSlashCommand(value);
    if (command) {
      await handleCommand(command.name, command.args);
      return;
    }

    setStoryDraft((existing) => (existing ? `${existing}\n${value}` : value));
    appendLog("success", "Story draft updated. Run /plan when ready.");
  }

  async function handleCommand(name: string, args: string[]): Promise<void> {
    switch (name) {
      case "help":
        appendLog("info", HELP_TEXT);
        return;
      case "pwd":
        appendLog("info", `Workspace: ${workspaceRoot}`);
        return;
      case "use":
      case "open":
        await runBusyAction(async () => {
          const nextRoot = path.resolve(workspaceRoot, args[0] ?? ".");
          await access(nextRoot, constants.R_OK);
          setWorkspaceRoot(nextRoot);
          setLatestPlan(null);
          setLatestWorkspaceScan(null);
          setFolderTreeContext("");
          appendLog("success", `Switched workspace to ${nextRoot}`);
        });
        return;
      case "doctor":
        await runBusyAction(async () => {
          const provider = createProvider(activeConfig.provider);
          const health = await provider.healthCheck(activeConfig.provider);
          appendLog(
            health.ok ? "success" : "error",
            `Doctor: provider=${activeConfig.provider.type}, model=${activeConfig.provider.model}, status=${health.ok ? "ok" : "failed"}${health.message ? ` (${health.message})` : ""}`,
          );
        });
        return;
      case "scan":
        await runBusyAction(async () => {
          const scan = scanWorkspace(workspaceRoot);
          setLatestWorkspaceScan(scan);
          appendLog(
            "success",
            `Workspace scan: packageManager=${scan.packageManager}, testFramework=${scan.testFramework}, language=${scan.language}, moduleSystem=${scan.moduleSystem}`,
          );
        });
        return;
      case "context":
        await runBusyAction(async () => {
          const tree = await getWorkspaceTreeContext(workspaceRoot);
          setFolderTreeContext(tree);
          appendLog("success", `Captured folder tree context for ${workspaceRoot}`);
          appendLog("muted", tree);
        });
        return;
      case "story":
        await runBusyAction(async () => {
          const storyPath = path.resolve(workspaceRoot, args[0] ?? "");
          const storyText = await readFile(storyPath, "utf8");
          setStoryDraft(storyText.trim());
          appendLog("success", `Loaded story from ${storyPath}`);
        });
        return;
      case "plan":
        await runBusyAction(async () => {
          const plan = await runPlan(args[0]);
          setLatestPlan(plan);
          setLatestWorkspaceScan(plan.workspace);
          if (plan.folderTree) {
            setFolderTreeContext(plan.folderTree);
          }
          appendLog("success", `Generated plan with ${plan.plan.suggestedTestScenarios.length} suggested test scenarios.`);
          appendLog("info", renderPlanSummary(plan));
        });
        return;
      case "save-plan":
        await runBusyAction(async () => {
          if (!latestPlan) {
            throw new Error("No plan available. Run /plan first.");
          }
          const files = await savePlanArtifacts(workspaceRoot, latestPlan, args[0] ?? "test-plan");
          appendLog("success", `Saved plan to ${files.markdownPath} and ${files.jsonPath}`);
        });
        return;
      case "config":
        appendLog(
          "info",
          `Config: provider=${activeConfig.provider.type}, model=${activeConfig.provider.model}, frameworkPref=${activeConfig.testFramework}`,
        );
        return;
      case "clear":
        setLogEntries([]);
        return;
      case "exit":
      case "quit":
        exit();
        return;
      default:
        appendLog("error", `Unknown command: /${name}. Type /help.`);
    }
  }

  async function runPlan(optionalStoryPath?: string): Promise<PlanWorkflowResult> {
    if (optionalStoryPath) {
      const storyPath = path.resolve(workspaceRoot, optionalStoryPath);
      return buildPlanFromStoryFile(activeConfig, storyPath, undefined, {
        folderTreeContext: folderTreeContext || undefined
      });
    }

    if (!storyDraft.trim()) {
      throw new Error("No story draft available. Paste text or use /story <file>.");
    }

    return buildPlanFromStoryText(activeConfig, storyDraft, undefined, {
      folderTreeContext: folderTreeContext || undefined
    });
  }

  async function runBusyAction(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      appendLog("error", message);
    } finally {
      setBusy(false);
    }
  }

  function appendLog(tone: LogTone, text: string): void {
    setLogEntries((entries) => [...entries, { id: entries.length + 1, tone, text }]);
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text color="cyan">TDDForge</Text>
        <Text>Workspace: {workspaceRoot}</Text>
        <Text>
          Provider: {activeConfig.provider.type} / {activeConfig.provider.model}
        </Text>
        <Text>Story draft: {storyDraft ? `${storyDraft.split("\n").length} line(s)` : "empty"}</Text>
      </Box>

      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" minHeight={16}>
        <Text color="yellow">Session</Text>
        {logEntries.slice(-14).map((entry) => (
          <LogLine key={entry.id} tone={entry.tone} text={entry.text} />
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="green">Input</Text>
        <TextInput
          value={input}
          onChange={setInput}
          onSubmit={() => {
            void submitCurrentInput();
          }}
          placeholder="Type /help, /plan, /scan, /use ../repo or paste a story and then run /plan"
        />
        <Text color={busy ? "yellow" : "gray"}>{busy ? "Working..." : "Ready"}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">Shortcuts: /help /doctor /scan /context /story /plan /save-plan /use /exit</Text>
      </Box>
    </Box>
  );
}

function LogLine({ tone, text }: { tone: LogTone; text: string }): React.JSX.Element {
  const color = tone === "success" ? "green" : tone === "error" ? "red" : tone === "muted" ? "gray" : "white";
  return <Text color={color}>{text}</Text>;
}

function renderPlanSummary(result: PlanWorkflowResult): string {
  return [
    `Summary: ${result.plan.summary}`,
    `Requirements: ${result.plan.requirements.map((requirement) => requirement.id).join(", ")}`,
    `Edge cases: ${result.plan.edgeCases.slice(0, 4).join(" | ")}`
  ].join("\n");
}
