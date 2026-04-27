import { Box, Text, useApp, useInput } from "ink";
import TextInput from "ink-text-input";
import React, { useEffect, useMemo, useState } from "react";
import path from "node:path";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { constants, existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { execa } from "execa";
import { generateEdgeCaseTests, type GeneratedTestFiles } from "../export/generated-tests.js";
import { loadResolvedConfig, type ResolvedConfig } from "../config/load-config.js";
import { savePlanArtifacts } from "../export/save-plan.js";
import { createProvider } from "../providers/factory.js";
import { buildPlanFromStoryFile, buildPlanFromStoryText, type PlanWorkflowResult } from "../story-engine/planner.js";
import { getWorkspaceTreeContext } from "../workspace/context.js";
import { scanWorkspace } from "../workspace/scan.js";
import type { WorkspaceScanResult } from "../workspace/types.js";
import { getSlashCommandSuggestions, HELP_TEXT, parseSlashCommand } from "./commands.js";
import {
  createTuiSessionId,
  listTuiSessions,
  readTuiSession,
  writeTuiSession,
  type TuiSessionSummary
} from "./sessions.js";
import { findStoryFiles, loadStoryFile, type StoryFile } from "./story-files.js";

type LogTone = "info" | "success" | "error" | "muted";
type TuiTab = "status" | "monitor" | "session";

const TUI_TABS: TuiTab[] = ["status", "monitor", "session"];

interface LogEntry {
  id: number;
  tone: LogTone;
  text: string;
}

interface AppProps {
  initialWorkspaceRoot: string;
}

interface TestStatus {
  framework: string;
  directories: string[];
  lastUpdated: Date | null;
  reason: string;
  suggestion: string;
}

interface PlainTextSnapshot {
  workspaceRoot: string;
  activeStoryPath: string | null;
  storyDraft: string;
  testStatus: TestStatus;
  monitorEnabled: boolean;
  lastSeenCommit: string | null;
  latestWorkspaceScan: WorkspaceScanResult | null;
  latestGeneratedTests: GeneratedTestFiles | null;
  latestPlan: PlanWorkflowResult | null;
  logEntries: LogEntry[];
}

export function TddforgeApp({ initialWorkspaceRoot }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState(path.resolve(initialWorkspaceRoot));
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionChoices, setSessionChoices] = useState<TuiSessionSummary[]>([]);
  const [awaitingSessionChoice, setAwaitingSessionChoice] = useState(true);
  const [selectedSessionIndex, setSelectedSessionIndex] = useState(0);
  const [storyDraft, setStoryDraft] = useState("");
  const [activeStoryPath, setActiveStoryPath] = useState<string | null>(null);
  const [storyChoices, setStoryChoices] = useState<StoryFile[]>([]);
  const [awaitingStoryChoice, setAwaitingStoryChoice] = useState(false);
  const [selectedStoryIndex, setSelectedStoryIndex] = useState(0);
  const [pendingQuestions, setPendingQuestions] = useState<string[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [latestPlan, setLatestPlan] = useState<PlanWorkflowResult | null>(null);
  const [latestWorkspaceScan, setLatestWorkspaceScan] = useState<WorkspaceScanResult | null>(null);
  const [latestGeneratedTests, setLatestGeneratedTests] = useState<GeneratedTestFiles | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>({
    framework: "unknown",
    directories: [],
    lastUpdated: null,
    reason: "initial",
    suggestion: "Run /monitor to refresh suggestions after new commits."
  });
  const [folderTreeContext, setFolderTreeContext] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TuiTab>("status");
  const [lastSeenCommit, setLastSeenCommit] = useState<string | null>(null);
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>(() => [
    { id: 1, tone: "success", text: "Welcome to TDDForge TUI. Type /help to see commands." }
  ]);

  const activeConfig = useMemo<ResolvedConfig>(() => loadResolvedConfig(workspaceRoot), [workspaceRoot]);
  const commandSuggestions = useMemo(() => getSlashCommandSuggestions(input), [input]);
  const monitorSuggestions = useMemo(
    () => buildMonitorSuggestions(latestWorkspaceScan, latestPlan, latestGeneratedTests),
    [latestWorkspaceScan, latestPlan, latestGeneratedTests],
  );

  useEffect(() => {
    void prepareSessionSelection();
  }, [workspaceRoot]);

  useEffect(() => {
    if (!sessionReady || !sessionId) {
      return undefined;
    }

    const timer = setTimeout(() => {
      void writeTuiSession(workspaceRoot, {
        id: sessionId,
        updatedAt: new Date().toISOString(),
        activeStoryPath,
        storyDraft,
        latestPlan,
        latestGeneratedTests,
        folderTreeContext,
        logEntries
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [
    sessionReady,
    sessionId,
    workspaceRoot,
    activeStoryPath,
    storyDraft,
    latestPlan,
    latestGeneratedTests,
    folderTreeContext,
    logEntries
  ]);

  useEffect(() => {
    if (!monitorEnabled) {
      return undefined;
    }

    try {
      setLatestWorkspaceScan(scanWorkspace(workspaceRoot));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown monitor error";
      appendLog("error", `Monitor failed: ${message}`);
    }

    const timer = setInterval(() => {
      try {
        setLatestWorkspaceScan(scanWorkspace(workspaceRoot));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown monitor error";
        appendLog("error", `Monitor failed: ${message}`);
      }
    }, 5000);

    return () => clearInterval(timer);
  }, [monitorEnabled, workspaceRoot]);

  useEffect(() => {
    void refreshAfterCommitChange("startup analysis", true);
  }, [workspaceRoot]);

  useEffect(() => {
    if (!monitorEnabled) {
      return undefined;
    }

    const watchers: FSWatcher[] = [];
    let timer: NodeJS.Timeout | undefined;

    const scheduleRefresh = (reason: string): void => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        void refreshAfterCommitChange(reason);
      }, 250);
    };

    for (const directory of getWatchDirectories(workspaceRoot, latestWorkspaceScan)) {
      try {
        watchers.push(watch(directory, { recursive: false }, (_eventType, fileName) => {
          const changedFile = typeof fileName === "string" ? fileName : "";
          if (isRelevantProjectChange(changedFile)) {
            scheduleRefresh(changedFile ? `updated ${changedFile}` : "project file update");
          }
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown watcher error";
        appendLog("error", `Monitor watcher failed for ${directory}: ${message}`);
      }
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      for (const watcher of watchers) {
        watcher.close();
      }
    };
  }, [monitorEnabled, workspaceRoot, latestWorkspaceScan?.testDirectories.join("|")]);

  useInput((_input, key) => {
    if (key.ctrl && _input === "c") {
      exit();
    }
    if (awaitingSessionChoice) {
      if (key.upArrow) {
        setSelectedSessionIndex((index) => Math.max(index - 1, 0));
      }
      if (key.downArrow) {
        setSelectedSessionIndex((index) => Math.min(index + 1, sessionChoices.length));
      }
      if (key.return) {
        void chooseSelectedSession();
      }
      return;
    }
    if (awaitingStoryChoice) {
      if (key.upArrow) {
        setSelectedStoryIndex((index) => Math.max(index - 1, 0));
      }
      if (key.downArrow) {
        setSelectedStoryIndex((index) => Math.min(index + 1, storyChoices.length - 1));
      }
      if (key.return) {
        void chooseSelectedStory();
      }
      return;
    }
    if (key.tab) {
      setActiveTab((current) => nextTab(current, key.shift));
    }
    if (key.upArrow) {
      navigateInputHistory("previous");
    }
    if (key.downArrow) {
      navigateInputHistory("next");
    }
  });

  async function submitCurrentInput(): Promise<void> {
    const value = input.trim();
    if (!value || busy) {
      return;
    }

    setInput("");
    setHistoryIndex(null);
    rememberInput(value);

    const immediateCommand = parseSlashCommand(value);
    if (immediateCommand && ["exit", "quit"].includes(immediateCommand.name)) {
      exit();
      return;
    }

    if (pendingQuestions.length > 0) {
      handleQuestionAnswer(value);
      return;
    }

    const command = immediateCommand;
    if (command) {
      await handleCommand(command.name, command.args);
      return;
    }

    setStoryDraft((existing) => (existing ? `${existing}\n${value}` : value));
    appendLog("success", "Story context updated. You can keep describing the story, edge cases, or run /plan.");
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
          setSessionId(null);
          setSessionReady(false);
          setSessionChoices([]);
          setAwaitingSessionChoice(true);
          setLatestPlan(null);
          setLatestWorkspaceScan(null);
          setLatestGeneratedTests(null);
          setActiveStoryPath(null);
          setStoryDraft("");
          setStoryChoices([]);
          setAwaitingStoryChoice(false);
          setSelectedStoryIndex(0);
          setPendingQuestions([]);
          setQuestionIndex(0);
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
          if (args[0]) {
            const candidatePath = path.resolve(workspaceRoot, args[0]);
            if (await isReadableFile(candidatePath)) {
              await loadSelectedStory(candidatePath);
              return;
            }

            setInlineStoryContext(args.join(" "));
            return;
          }

          const stories = await findStoryFiles(workspaceRoot);
          if (stories.length === 0) {
            throw new Error("No story files found in story/, stories/, or docs/.");
          }

          setStoryChoices(stories);
          setAwaitingStoryChoice(true);
          setSelectedStoryIndex(0);
          setActiveTab("session");
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
          if (plan.plan.ambiguities.length > 0) {
            setPendingQuestions(plan.plan.ambiguities);
            setQuestionIndex(0);
            appendLog("info", `Question 1/${plan.plan.ambiguities.length}: ${plan.plan.ambiguities[0]}`);
          }
          if (plan.plan.edgeCases.length > 0) {
            appendLog("info", "Run /generate-tests to create todo test cases from these edge cases.");
          }
        });
        return;
      case "generate-tests":
        await runBusyAction(async () => {
          await runGenerateTests(args[0]);
        });
        return;
      case "monitor":
        await runBusyAction(async () => {
          handleMonitorCommand(args[0]);
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
      case "copy":
        await runBusyAction(async () => {
          const copyPath = await writePlainTextCopy();
          appendLog("success", `Plain text copy written to ${copyPath}`);
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

  async function prepareSessionSelection(): Promise<void> {
    setSessionReady(false);
    setAwaitingSessionChoice(true);
    const sessions = await listTuiSessions(workspaceRoot);
    setSessionChoices(sessions);
    setSelectedSessionIndex(0);
  }

  async function chooseSelectedSession(): Promise<void> {
    if (selectedSessionIndex === sessionChoices.length) {
      startNewSession();
      return;
    }

    const selectedSession = sessionChoices[selectedSessionIndex];
    if (!selectedSession) {
      startNewSession();
      return;
    }

    await runBusyAction(async () => {
      const session = await readTuiSession(workspaceRoot, selectedSession.id);
      setSessionId(session.id);
      setActiveStoryPath(session.activeStoryPath);
      setStoryDraft(session.storyDraft);
      setLatestPlan(session.latestPlan);
      setLatestGeneratedTests(session.latestGeneratedTests);
      setFolderTreeContext(session.folderTreeContext);
      setLogEntries(session.logEntries.length > 0 ? session.logEntries : [
        { id: 1, tone: "success", text: "Loaded saved TDDForge session." }
      ]);
      setAwaitingSessionChoice(false);
      setSessionReady(true);
      setActiveTab("session");
    });
  }

  function startNewSession(): void {
    setSessionId(createTuiSessionId());
    setStoryDraft("");
    setActiveStoryPath(null);
    setLatestPlan(null);
    setLatestGeneratedTests(null);
    setPendingQuestions([]);
    setQuestionIndex(0);
    setFolderTreeContext("");
    setLogEntries([
      { id: 1, tone: "success", text: "Started a new TDDForge session. Type /help to see commands." }
    ]);
    setAwaitingSessionChoice(false);
    setSessionReady(true);
  }

  async function chooseSelectedStory(): Promise<void> {
    const selectedStory = storyChoices[selectedStoryIndex];
    if (!selectedStory) {
      return;
    }

    setAwaitingStoryChoice(false);
    await runBusyAction(async () => {
      await loadSelectedStory(selectedStory.path);
    });
  }

  function handleQuestionAnswer(answer: string): void {
    const question = pendingQuestions[questionIndex];
    setStoryDraft((existing) => [
      existing,
      "",
      "Clarification:",
      `Question: ${question}`,
      `Answer: ${answer}`
    ].filter(Boolean).join("\n"));
    appendLog("success", `Captured answer for question ${questionIndex + 1}/${pendingQuestions.length}.`);

    const nextIndex = questionIndex + 1;
    if (nextIndex >= pendingQuestions.length) {
      setPendingQuestions([]);
      setQuestionIndex(0);
      appendLog("info", "All questions answered. Run /plan again to regenerate the plan with clarifications.");
      return;
    }

    setQuestionIndex(nextIndex);
    appendLog("info", `Question ${nextIndex + 1}/${pendingQuestions.length}: ${pendingQuestions[nextIndex]}`);
  }

  function handleMonitorCommand(mode?: string): void {
    if (mode === "off") {
      setMonitorEnabled(false);
      appendLog("muted", "Monitor mode disabled.");
      return;
    }

    setMonitorEnabled(true);
    setActiveTab("monitor");
    setLatestWorkspaceScan(scanWorkspace(workspaceRoot));
    void refreshAfterCommitChange("monitor enabled", true);
    appendLog("success", "Monitor mode enabled. Test suggestions refresh after a new commit.");
  }

  async function runGenerateTests(outputFolder?: string): Promise<void> {
    if (!latestPlan) {
      throw new Error("No plan available. Run /plan first.");
    }

    const files = await generateEdgeCaseTests(workspaceRoot, latestPlan, outputFolder);
    setLatestGeneratedTests(files);
    appendLog("success", `Generated ${files.testCount} edge-case todo test(s) at ${files.testPath}`);
    void refreshAfterCommitChange("generated edge-case tests", true);
  }

  async function loadSelectedStory(storyPath: string): Promise<void> {
    const storyText = await loadStoryFile(storyPath);
    setStoryDraft(storyText);
    setActiveStoryPath(storyPath);
    setLatestPlan(null);
    setLatestGeneratedTests(null);
    setPendingQuestions([]);
    setQuestionIndex(0);
    appendLog("success", `Loaded story from ${storyPath}`);
    appendLog("muted", "Story context is active. Type more details to append updates or run /plan.");
  }

  function setInlineStoryContext(storyText: string): void {
    setStoryDraft(storyText.trim());
    setActiveStoryPath(null);
    setLatestPlan(null);
    setLatestGeneratedTests(null);
    setPendingQuestions([]);
    setQuestionIndex(0);
    appendLog("success", "Story context captured from /story input.");
    appendLog("muted", "Type more details to append updates or run /plan.");
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

  function rememberInput(value: string): void {
    setInputHistory((entries) => [...entries.filter((entry) => entry !== value), value].slice(-50));
  }

  function navigateInputHistory(direction: "previous" | "next"): void {
    if (inputHistory.length === 0) {
      return;
    }

    const nextIndex = direction === "previous"
      ? Math.max((historyIndex ?? inputHistory.length) - 1, 0)
      : Math.min((historyIndex ?? inputHistory.length - 1) + 1, inputHistory.length);

    setHistoryIndex(nextIndex === inputHistory.length ? null : nextIndex);
    setInput(nextIndex === inputHistory.length ? "" : inputHistory[nextIndex]);
  }

  async function writePlainTextCopy(): Promise<string> {
    const outputDir = path.join(workspaceRoot, ".tddforge-out");
    await mkdir(outputDir, { recursive: true });
    const copyPath = path.join(outputDir, "tui-copy.txt");
    await writeFile(copyPath, renderPlainTextSnapshot({
      workspaceRoot,
      activeStoryPath,
      storyDraft,
      testStatus,
      monitorEnabled,
      lastSeenCommit,
      latestWorkspaceScan,
      latestGeneratedTests,
      latestPlan,
      logEntries
    }), "utf8");
    return copyPath;
  }

  async function refreshAfterCommitChange(reason: string, force = false): Promise<void> {
    const commit = await getCurrentCommit(workspaceRoot);
    if (!force && commit && commit === lastSeenCommit) {
      return;
    }
    setLastSeenCommit(commit);
    refreshTestStatus(commit ? `${reason} at ${commit.slice(0, 7)}` : reason);
  }

  function refreshTestStatus(reason: string): void {
    try {
      const scan = scanWorkspace(workspaceRoot);
      setLatestWorkspaceScan(scan);
      setTestStatus({
        framework: scan.testFramework,
        directories: scan.testDirectories,
        lastUpdated: new Date(),
        reason,
        suggestion: buildLatestTestSuggestion(scan, latestPlan, latestGeneratedTests)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown test status error";
      setTestStatus((existing) => ({
        ...existing,
        lastUpdated: new Date(),
        reason,
        suggestion: `Could not analyze tests: ${message}`
      }));
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      {awaitingSessionChoice ? (
        <Box flexDirection="column">
          <Text color="cyan">TDDForge</Text>
          <Text>Workspace: {workspaceRoot}</Text>
          <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" marginTop={1}>
            <Text color="yellow">Choose Session</Text>
            {sessionChoices.slice(0, 8).map((session, index) => (
              <Text key={session.id} color={selectedSessionIndex === index ? "cyan" : "white"}>
                {selectedSessionIndex === index ? "> " : "  "}{session.title} ({new Date(session.updatedAt).toLocaleString()})
              </Text>
            ))}
            <Text color={selectedSessionIndex === sessionChoices.length ? "cyan" : "white"}>
              {selectedSessionIndex === sessionChoices.length ? "> " : "  "}New session
            </Text>
            <Text color="gray">Use Up/Down to choose, Enter to continue.</Text>
          </Box>
        </Box>
      ) : (
      <>
      <Box marginBottom={1} flexDirection="column">
        <Text color="cyan">TDDForge</Text>
        <Text>Workspace: {workspaceRoot}</Text>
        <Text>
          Provider: {activeConfig.provider.type} / {activeConfig.provider.model}
        </Text>
        <Text>Story: {activeStoryPath ? path.relative(workspaceRoot, activeStoryPath) : "draft only"}</Text>
        <Text>Story context: {storyDraft ? `${storyDraft.split("\n").length} line(s)` : "empty"}</Text>
        <Text color={monitorEnabled ? "green" : "gray"}>Monitor: {monitorEnabled ? "on" : "off"}</Text>
      </Box>

      <Box marginBottom={1}>
        {TUI_TABS.map((tab) => (
          <Text key={tab} color={activeTab === tab ? "cyan" : "gray"}>
            {activeTab === tab ? `[${tab}] ` : `${tab} `}
          </Text>
        ))}
        <Text color="gray">Tab switches panels</Text>
      </Box>

      {activeTab === "status" ? (
        <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column" marginBottom={1}>
          <Text color="magenta">Test Status</Text>
          <Text>
            Framework: {testStatus.framework} / dirs: {testStatus.directories.join(", ") || "none detected"}
          </Text>
          <Text>
            Updated: {testStatus.lastUpdated ? testStatus.lastUpdated.toLocaleTimeString() : "not yet"} / {testStatus.reason}
          </Text>
          <Text color="yellow">Suggestion: {testStatus.suggestion}</Text>
        </Box>
      ) : null}

      {activeTab === "monitor" ? (
        <Box borderStyle="round" borderColor="green" paddingX={1} flexDirection="column" marginBottom={1} minHeight={10}>
          <Text color="green">Monitor</Text>
          <Text>Status: {monitorEnabled ? "watching for committed project changes" : "off - run /monitor to start"}</Text>
          <Text>
            Tests: {latestWorkspaceScan?.testFramework ?? "unknown"} / dirs:{" "}
            {latestWorkspaceScan?.testDirectories.join(", ") || "none detected"}
          </Text>
          <Text>
            Latest generated:{" "}
            {latestGeneratedTests ? `${latestGeneratedTests.testCount} todo(s) in ${latestGeneratedTests.testPath}` : "none"}
          </Text>
          <Text>Last commit: {lastSeenCommit ? lastSeenCommit.slice(0, 7) : "unavailable"}</Text>
          {monitorSuggestions.map((suggestion) => (
            <Text key={suggestion} color="yellow">- {suggestion}</Text>
          ))}
        </Box>
      ) : null}

      {activeTab === "session" ? (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" minHeight={16}>
          <Text color="yellow">Session</Text>
          {awaitingStoryChoice ? (
            <>
              <Text color="cyan">Choose a story file</Text>
              {storyChoices.map((story, index) => (
                <Text key={story.path} color={selectedStoryIndex === index ? "cyan" : "white"}>
                  {selectedStoryIndex === index ? "> " : "  "}{story.label}
                </Text>
              ))}
              <Text color="gray">Use Up/Down to choose, Enter to load.</Text>
            </>
          ) : null}
          {pendingQuestions.length > 0 ? (
            <>
              <Text color="cyan">Question {questionIndex + 1}/{pendingQuestions.length}</Text>
              <Text>{pendingQuestions[questionIndex]}</Text>
            </>
          ) : null}
          {logEntries.slice(-14).map((entry) => (
            <LogLine key={entry.id} tone={entry.tone} text={entry.text} />
          ))}
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
        <Text color="green">Input</Text>
        {awaitingStoryChoice ? (
          <Text color="gray">Use Up/Down to choose a story file, then press Enter.</Text>
        ) : (
          <TextInput
            value={input}
            onChange={(value) => {
              setInput(value);
              setHistoryIndex(null);
            }}
            onSubmit={() => {
              void submitCurrentInput();
            }}
            placeholder={getInputPlaceholder(pendingQuestions.length > 0)}
          />
        )}
        {!awaitingStoryChoice && commandSuggestions.length > 0 ? (
          <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
            <Text color="yellow">Suggestions</Text>
            {commandSuggestions.map((command) => (
              <Text key={command.name}>
                {command.usage} - {command.description}
              </Text>
            ))}
          </Box>
        ) : null}
        <Text color={busy ? "yellow" : "gray"}>{busy ? "Working..." : "Ready"}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          Shortcuts: Tab panels Up/Down history /copy /help /doctor /scan /context /story /plan /generate-tests /monitor /save-plan /use /exit
        </Text>
      </Box>
      </>
      )}
    </Box>
  );
}

function nextTab(current: TuiTab, reverse = false): TuiTab {
  const currentIndex = TUI_TABS.indexOf(current);
  const offset = reverse ? -1 : 1;
  return TUI_TABS[(currentIndex + offset + TUI_TABS.length) % TUI_TABS.length];
}

function getInputPlaceholder(answeringQuestion: boolean): string {
  if (answeringQuestion) {
    return "Write your answer and press Enter";
  }
  return "Type /story, /plan, /monitor or add story context";
}

function LogLine({ tone, text }: { tone: LogTone; text: string }): React.JSX.Element {
  const color = tone === "success" ? "green" : tone === "error" ? "red" : tone === "muted" ? "gray" : "white";
  return <Text color={color}>{text}</Text>;
}

function renderPlanSummary(result: PlanWorkflowResult): string {
  return [
    "Plan summary",
    "",
    `Summary: ${result.plan.summary}`,
    "",
    "Requirements:",
    ...result.plan.requirements.map((requirement) => `  ${requirement.id} [${requirement.source}] ${requirement.text}`),
    "",
    "Edge cases:",
    ...result.plan.edgeCases.slice(0, 6).map((edgeCase) => `  - ${edgeCase}`),
    "",
    "Suggested tests:",
    ...result.plan.suggestedTestScenarios.slice(0, 6).map((scenario) => `  ${scenario.id} [${scenario.level}] ${scenario.title}`),
    "",
    "Ambiguities:",
    ...(result.plan.ambiguities.length > 0
      ? result.plan.ambiguities.slice(0, 4).map((ambiguity) => `  - ${ambiguity}`)
      : ["  None identified"])
  ].join("\n");
}

function buildMonitorSuggestions(
  scan: WorkspaceScanResult | null,
  plan: PlanWorkflowResult | null,
  generatedTests: GeneratedTestFiles | null,
): string[] {
  const suggestions: string[] = [];

  if (!scan) {
    return ["Run /scan or keep /monitor on to detect this workspace."];
  }

  if (scan.testFramework === "unknown") {
    suggestions.push("No test framework detected. Add Vitest or Jest before generating runnable tests.");
  }

  if (scan.testDirectories.length === 0) {
    suggestions.push("No test folder detected. Generated edge-case drafts will stay under .tddforge-out.");
  }

  if (!plan) {
    suggestions.push("Run /plan after loading a story to get edge-case based test suggestions.");
  } else if (!generatedTests) {
    suggestions.push("Run /generate-tests to create todo specs from the latest edge cases.");
  } else {
    suggestions.push("Review generated todos and replace each one with project-specific assertions.");
  }

  suggestions.push("Use /context before /plan on real repos so suggestions include folder structure.");

  return suggestions;
}

function getWatchDirectories(workspaceRoot: string, scan: WorkspaceScanResult | null): string[] {
  const directories = new Set<string>([workspaceRoot]);
  for (const directory of scan?.testDirectories ?? []) {
    directories.add(path.join(workspaceRoot, directory));
  }
  directories.add(path.join(workspaceRoot, "src"));
  directories.add(path.join(workspaceRoot, "app"));
  directories.add(path.join(workspaceRoot, "lib"));
  return [...directories].filter((directory) => existsSync(directory) && statSync(directory).isDirectory());
}

function isRelevantProjectChange(fileName: string): boolean {
  if (!fileName) {
    return true;
  }

  return /\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(fileName) ||
    /\.test\./.test(fileName) ||
    ["package.json", "package-lock.json", "vitest.config.ts", "jest.config.js", "jest.config.ts"].includes(fileName);
}

function buildLatestTestSuggestion(
  scan: WorkspaceScanResult,
  plan: PlanWorkflowResult | null,
  generatedTests: GeneratedTestFiles | null,
): string {
  if (scan.testFramework === "unknown") {
    return "No test framework detected in this repository yet.";
  }
  if (!plan) {
    return "Load a story with /story, update context in chat, then run /plan.";
  }
  if (!generatedTests) {
    return `Latest plan has ${plan.plan.edgeCases.length} edge case(s). Run /generate-tests.`;
  }
  return `Last generated ${generatedTests.testCount} todo test(s). Commit code/test changes to refresh monitor suggestions.`;
}

async function getCurrentCommit(workspaceRoot: string): Promise<string | null> {
  try {
    const result = await execa("git", ["rev-parse", "HEAD"], { cwd: workspaceRoot });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function isReadableFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function renderPlainTextSnapshot(snapshot: PlainTextSnapshot): string {
  const lines = [
    "TDDForge TUI Snapshot",
    "",
    `Workspace: ${snapshot.workspaceRoot}`,
    `Story: ${snapshot.activeStoryPath ?? "draft only"}`,
    `Story context lines: ${snapshot.storyDraft ? snapshot.storyDraft.split("\n").length : 0}`,
    "",
    "Test Status",
    `Framework: ${snapshot.testStatus.framework}`,
    `Directories: ${snapshot.testStatus.directories.join(", ") || "none detected"}`,
    `Updated: ${snapshot.testStatus.lastUpdated ? snapshot.testStatus.lastUpdated.toISOString() : "not yet"}`,
    `Reason: ${snapshot.testStatus.reason}`,
    `Suggestion: ${snapshot.testStatus.suggestion}`,
    "",
    "Monitor",
    `Enabled: ${snapshot.monitorEnabled ? "yes" : "no"}`,
    `Last commit: ${snapshot.lastSeenCommit ?? "unavailable"}`,
    `Detected tests: ${snapshot.latestWorkspaceScan?.checkedInTestFiles.map((file) => file.path).join(", ") || "none"}`,
    `Generated tests: ${snapshot.latestGeneratedTests ? `${snapshot.latestGeneratedTests.testCount} at ${snapshot.latestGeneratedTests.testPath}` : "none"}`,
    "",
    "Latest Plan",
    snapshot.latestPlan ? renderPlanSummary(snapshot.latestPlan) : "No plan generated.",
    "",
    "Session Log",
    ...snapshot.logEntries.map((entry) => `[${entry.tone}] ${entry.text}`)
  ];

  return `${lines.join("\n")}\n`;
}
