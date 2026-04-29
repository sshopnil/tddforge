import { Box, Text, useApp, useCleanup, useInput, useTerminal } from "@orchetron/storm";
import React, { useEffect, useMemo, useRef, useState } from "react";
import path from "node:path";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import { constants, existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { execa } from "execa";
import { generateEdgeCaseTests, type GeneratedTestFiles } from "../export/generated-tests.js";
import { loadResolvedConfig, type ResolvedConfig } from "../config/load-config.js";
import type { ProviderConfig } from "../config/schema.js";
import type { TokenUsage } from "../providers/types.js";
import { savePlanArtifacts } from "../export/save-plan.js";
import { createProvider } from "../providers/factory.js";
import { buildPlanFromStoryFile, buildPlanFromStoryText, type PlanWorkflowResult } from "../story-engine/planner.js";
import { getWorkspaceTreeContext } from "../workspace/context.js";
import { scanWorkspace } from "../workspace/scan.js";
import type { WorkspaceScanResult } from "../workspace/types.js";
import {
  getTestEnvironmentSetupSuggestions,
  setupTestEnvironment,
  type TestEnvironmentSetupSuggestion
} from "../workspace/test-setup.js";
import { getSlashCommandSuggestions, HELP_TEXT, parseSlashCommand, type SlashCommandDefinition } from "./commands.js";
import {
  buildProviderConfig,
  hasProviderAuth,
  listProviderModels,
  saveProviderConfig,
  type ProviderType
} from "./provider-setup.js";
import {
  createTuiSessionId,
  listTuiSessions,
  readTuiSession,
  writeTuiSession,
  type TuiSessionSummary
} from "./sessions.js";
import { findStoryFiles, loadStoryFile, type StoryFile } from "./story-files.js";
import { buildTestRunReport, formatTestRunSummary, type TestRunReport } from "./test-run.js";

type LogTone = "info" | "success" | "error" | "muted";
type TuiTab = "status" | "monitor" | "session";
type ProviderSetupMode = "provider" | "model" | null;
type TestSetupMode = "confirm" | "framework" | "target" | null;

const TUI_TABS: TuiTab[] = ["session", "status", "monitor"];
const PROVIDER_CHOICES: ProviderType[] = ["ollama", "openai"];
const INPUT_BACKGROUND = "#111827";

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
  latestTestRun: TestRunReport | null;
  latestWorkspaceScan: WorkspaceScanResult | null;
  latestGeneratedTests: GeneratedTestFiles | null;
  latestPlan: PlanWorkflowResult | null;
  logEntries: LogEntry[];
}

interface PanelLine {
  text: string;
  tone?: LogTone;
}

export function TddforgeApp({ initialWorkspaceRoot }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const terminal = useTerminal();
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
  const [answeringQuestion, setAnsweringQuestion] = useState(false);
  const [testSetupMode, setTestSetupMode] = useState<TestSetupMode>(null);
  const [testSetupSuggestions, setTestSetupSuggestions] = useState<TestEnvironmentSetupSuggestion[]>([]);
  const [selectedTestSetupFramework, setSelectedTestSetupFramework] = useState<TestEnvironmentSetupSuggestion["framework"] | null>(null);
  const [selectedTestSetupIndex, setSelectedTestSetupIndex] = useState(0);
  const [latestPlan, setLatestPlan] = useState<PlanWorkflowResult | null>(null);
  const [latestTokenUsage, setLatestTokenUsage] = useState<TokenUsage | null>(null);
  const [sessionTokenUsageTotal, setSessionTokenUsageTotal] = useState(0);
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
  const [activeTab, setActiveTab] = useState<TuiTab>("session");
  const [lastSeenCommit, setLastSeenCommit] = useState<string | null>(null);
  const [monitorEnabled, setMonitorEnabled] = useState(false);
  const [backgroundTestRun, setBackgroundTestRun] = useState<string>("idle - waiting for file edits");
  const [latestTestRun, setLatestTestRun] = useState<TestRunReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [uiFrame, setUiFrame] = useState(0);
  const testRunInFlight = useRef(false);
  const busyAbortControllerRef = useRef<AbortController | null>(null);
  const sessionSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const monitorTimerRef = useRef<NodeJS.Timeout | null>(null);
  const uiFrameTimerRef = useRef<NodeJS.Timeout | null>(null);
  const watcherCleanupRef = useRef<(() => void) | null>(null);
  const [configRevision, setConfigRevision] = useState(0);
  const [providerSetupMode, setProviderSetupMode] = useState<ProviderSetupMode>(null);
  const [selectedProviderIndex, setSelectedProviderIndex] = useState(0);
  const [pendingProviderType, setPendingProviderType] = useState<ProviderType | null>(null);
  const [providerModelChoices, setProviderModelChoices] = useState<string[]>([]);
  const [selectedProviderModelIndex, setSelectedProviderModelIndex] = useState(0);
  const [awaitingOpenAiApiKey, setAwaitingOpenAiApiKey] = useState(false);
  const [selectedCommandSuggestionIndex, setSelectedCommandSuggestionIndex] = useState(0);
  const [panelScroll, setPanelScroll] = useState<Record<TuiTab, number>>({
    status: 0,
    monitor: 0,
    session: 0
  });
  const [panelFollowEnd, setPanelFollowEnd] = useState<Record<TuiTab, boolean>>({
    status: true,
    monitor: true,
    session: true
  });
  const [logEntries, setLogEntries] = useState<LogEntry[]>(() => [
    { id: 1, tone: "success", text: "Welcome to TDDForge TUI. Type /help to see commands." }
  ]);

  const activeConfig = useMemo<ResolvedConfig>(() => loadResolvedConfig(workspaceRoot), [workspaceRoot, configRevision]);
  const commandSuggestions = useMemo(() => getSlashCommandSuggestions(input), [input]);
  const awaitingTestSetupChoice = testSetupMode !== null;
  const commandSuggestionsVisible = commandSuggestions.length > 0 &&
    !awaitingStoryChoice &&
    !awaitingTestSetupChoice &&
    !providerSetupMode &&
    !awaitingOpenAiApiKey &&
    !(pendingQuestions.length > 0 && !answeringQuestion);
  const monitorSuggestions = useMemo(
    () => buildMonitorSuggestions(latestWorkspaceScan, latestPlan, latestGeneratedTests),
    [latestWorkspaceScan, latestPlan, latestGeneratedTests],
  );
  const testSetupFrameworkOptions = useMemo(
    () => getTestSetupFrameworkOptions(testSetupSuggestions),
    [testSetupSuggestions],
  );
  const testSetupTargetOptions = useMemo(
    () => getTestSetupTargetOptions(testSetupSuggestions, selectedTestSetupFramework),
    [testSetupSuggestions, selectedTestSetupFramework],
  );
  const terminalColumns = Math.max(40, terminal.width ?? 80);
  const terminalRows = Math.max(12, terminal.height ?? 24);
  const headerHeight = 1;
  const tabHeight = awaitingSessionChoice ? 0 : 1;
  const footerHeight = terminalRows < 16 ? 0 : 1;
  const inputHasTray = awaitingSessionChoice ||
    awaitingStoryChoice ||
    awaitingTestSetupChoice ||
    Boolean(providerSetupMode) ||
    (pendingQuestions.length > 0 && !answeringQuestion) ||
    commandSuggestionsVisible;
  const inputHeight = getInputBandHeight(terminalRows, tabHeight, footerHeight, inputHasTray);
  const contentHeight = Math.max(3, terminalRows - headerHeight - tabHeight - inputHeight - footerHeight);
  const selectionVisibleCount = Math.max(1, Math.min(8, inputHeight - 7));
  const panelVisibleCount = Math.max(1, contentHeight - 4);
  const panelContentWidth = Math.max(10, terminalColumns - 6);
  const statusLines = useMemo(
    () => buildStatusLines({
      workspaceRoot,
      activeConfig,
      activeStoryPath,
      storyDraft,
      monitorEnabled,
      testStatus,
      latestWorkspaceScan,
      latestPlan,
      latestGeneratedTests,
      latestTestRun
    }),
    [
      workspaceRoot,
      activeConfig,
      activeStoryPath,
      storyDraft,
      monitorEnabled,
      testStatus,
      latestWorkspaceScan,
      latestPlan,
      latestGeneratedTests,
      latestTestRun
    ]
  );
  const monitorLines = useMemo(
    () => buildMonitorLines({
      monitorEnabled,
      latestWorkspaceScan,
      latestGeneratedTests,
      backgroundTestRun,
      latestTestRun,
      lastSeenCommit,
      monitorSuggestions
    }),
    [monitorEnabled, latestWorkspaceScan, latestGeneratedTests, backgroundTestRun, latestTestRun, lastSeenCommit, monitorSuggestions]
  );
  const sessionLines = useMemo(() => buildSessionLines(logEntries), [logEntries]);
  const panelLineCounts = useMemo<Record<TuiTab, number>>(() => ({
    status: countWrappedPanelLines(statusLines, panelContentWidth),
    monitor: countWrappedPanelLines(monitorLines, panelContentWidth),
    session: countWrappedPanelLines(sessionLines, panelContentWidth)
  }), [statusLines, monitorLines, sessionLines, panelContentWidth]);

  useCleanup(() => {
    if (sessionSaveTimerRef.current) {
      clearTimeout(sessionSaveTimerRef.current);
    }
    if (monitorTimerRef.current) {
      clearInterval(monitorTimerRef.current);
    }
    if (uiFrameTimerRef.current) {
      clearInterval(uiFrameTimerRef.current);
    }
    watcherCleanupRef.current?.();
  });

  useEffect(() => {
    if (uiFrameTimerRef.current) {
      clearInterval(uiFrameTimerRef.current);
      uiFrameTimerRef.current = null;
    }

    uiFrameTimerRef.current = setInterval(() => {
      setUiFrame((frame) => (frame + 1) % 1000);
    }, busy ? 90 : 500);

    return () => {
      if (uiFrameTimerRef.current) {
        clearInterval(uiFrameTimerRef.current);
        uiFrameTimerRef.current = null;
      }
    };
  }, [busy]);

  useEffect(() => {
    void prepareSessionSelection();
  }, [workspaceRoot]);

  useEffect(() => {
    if (sessionSaveTimerRef.current) {
      clearTimeout(sessionSaveTimerRef.current);
      sessionSaveTimerRef.current = null;
    }

    if (!sessionReady || !sessionId) {
      return;
    }

    sessionSaveTimerRef.current = setTimeout(() => {
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
      sessionSaveTimerRef.current = null;
    }, 300);
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
    setSelectedCommandSuggestionIndex((index) =>
      commandSuggestions.length === 0 ? 0 : Math.min(index, commandSuggestions.length - 1),
    );
  }, [commandSuggestions.length]);

  useEffect(() => {
    setPanelScroll((scroll) => {
      const nextScroll = {
        status: clampPanelScroll(scroll.status, panelLineCounts.status, panelVisibleCount),
        monitor: clampPanelScroll(scroll.monitor, panelLineCounts.monitor, panelVisibleCount),
        session: clampPanelScroll(scroll.session, panelLineCounts.session, panelVisibleCount)
      };

      return isSamePanelScroll(scroll, nextScroll) ? scroll : nextScroll;
    });
  }, [panelLineCounts, panelVisibleCount]);

  useEffect(() => {
    setPanelScroll((scroll) => {
      const nextScroll = {
        status: panelFollowEnd.status ? getMaxPanelScroll(panelLineCounts.status, panelVisibleCount) : scroll.status,
        monitor: panelFollowEnd.monitor ? getMaxPanelScroll(panelLineCounts.monitor, panelVisibleCount) : scroll.monitor,
        session: panelFollowEnd.session ? getMaxPanelScroll(panelLineCounts.session, panelVisibleCount) : scroll.session
      };

      return isSamePanelScroll(scroll, nextScroll) ? scroll : nextScroll;
    });
  }, [panelLineCounts, panelFollowEnd, panelVisibleCount]);

  useEffect(() => {
    if (monitorTimerRef.current) {
      clearInterval(monitorTimerRef.current);
      monitorTimerRef.current = null;
    }

    if (!monitorEnabled) {
      return;
    }

    try {
      setLatestWorkspaceScan(scanWorkspace(workspaceRoot));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown monitor error";
      appendLog("error", `Monitor failed: ${message}`);
    }

    monitorTimerRef.current = setInterval(() => {
      try {
        setLatestWorkspaceScan(scanWorkspace(workspaceRoot));
        void refreshAfterCommitChange("commit poll");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown monitor error";
        appendLog("error", `Monitor failed: ${message}`);
      }
    }, 5000);
  }, [monitorEnabled, workspaceRoot]);

  useEffect(() => {
    void refreshAfterCommitChange("startup analysis", true);
    try {
      const scan = scanWorkspace(workspaceRoot);
      setLatestWorkspaceScan(scan);
      promptForTestSetupIfNeeded(scan, "Startup scan");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown workspace scan error";
      appendLog("error", `Startup scan failed: ${message}`);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    watcherCleanupRef.current?.();
    watcherCleanupRef.current = null;

    if (!monitorEnabled) {
      return;
    }

    const watchers: FSWatcher[] = [];
    let timer: NodeJS.Timeout | undefined;

    const scheduleRefresh = (changedFile: string, reason: string): void => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        void runTestsAfterFileChange(changedFile, reason);
      }, 250);
    };

    for (const directory of getWatchDirectories(workspaceRoot, latestWorkspaceScan)) {
      try {
        watchers.push(watch(directory, { recursive: false }, (_eventType, fileName) => {
          const changedFile = typeof fileName === "string" ? toWorkspaceRelativePath(workspaceRoot, directory, fileName) : "";
          if (isRelevantProjectChange(changedFile)) {
            scheduleRefresh(changedFile || "unknown file", changedFile ? `updated ${changedFile}` : "project file update");
          }
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown watcher error";
        appendLog("error", `Monitor watcher failed for ${directory}: ${message}`);
      }
    }

    watcherCleanupRef.current = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      for (const watcher of watchers) {
        watcher.close();
      }
      watcherCleanupRef.current = null;
    };
  }, [monitorEnabled, workspaceRoot, latestWorkspaceScan?.testDirectories.join("|")]);

  useInput((event) => {
    if (event.ctrl && (event.key === "c" || event.char === "c")) {
      exit();
    }
    if (awaitingSessionChoice) {
      if (event.key === "up") {
        setSelectedSessionIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === "down") {
        setSelectedSessionIndex((index) => Math.min(index + 1, sessionChoices.length));
      }
      if (event.key === "return") {
        void chooseSelectedSession();
      }
      return;
    }
    if (awaitingStoryChoice) {
      if (event.key === "up") {
        setSelectedStoryIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === "down") {
        setSelectedStoryIndex((index) => Math.min(index + 1, storyChoices.length - 1));
      }
      if (event.key === "return") {
        void chooseSelectedStory();
      }
      return;
    }
    if (awaitingTestSetupChoice) {
      if (event.key === "up") {
        setSelectedTestSetupIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === "down") {
        setSelectedTestSetupIndex((index) => Math.min(index + 1, getTestSetupOptionCount(testSetupMode, testSetupFrameworkOptions, testSetupTargetOptions) - 1));
      }
      if (event.key === "return") {
        void chooseTestSetupOption();
      }
      return;
    }
    if (providerSetupMode === "provider") {
      if (event.key === "up") {
        setSelectedProviderIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === "down") {
        setSelectedProviderIndex((index) => Math.min(index + 1, PROVIDER_CHOICES.length - 1));
      }
      if (event.key === "return") {
        void chooseProviderSetupOption();
      }
      return;
    }
    if (providerSetupMode === "model") {
      if (event.key === "up") {
        setSelectedProviderModelIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === "down") {
        setSelectedProviderModelIndex((index) => Math.min(index + 1, providerModelChoices.length - 1));
      }
      if (event.key === "return") {
        void chooseProviderModelOption();
      }
      return;
    }
    if (pendingQuestions.length > 0 && !answeringQuestion) {
      if (event.key === "up") {
        setQuestionIndex((index) => Math.max(index - 1, 0));
      }
      if (event.key === "down") {
        setQuestionIndex((index) => Math.min(index + 1, pendingQuestions.length - 1));
      }
      if (event.key === "return") {
        setAnsweringQuestion(true);
        setInput("");
      }
      return;
    }
    if (event.key === "tab") {
      setActiveTab((current) => nextTab(current, event.shift));
      return;
    }
    if (event.key === "up") {
      if (commandSuggestionsVisible) {
        setSelectedCommandSuggestionIndex((index) => Math.max(index - 1, 0));
      } else if (input) {
        navigateInputHistory("previous");
      } else {
        scrollActivePanel("up");
      }
      return;
    }
    if (event.key === "down") {
      if (commandSuggestionsVisible) {
        setSelectedCommandSuggestionIndex((index) => Math.min(index + 1, commandSuggestions.length - 1));
      } else if (input) {
        navigateInputHistory("next");
      } else {
        scrollActivePanel("down");
      }
      return;
    }
    if (event.key === "return") {
      void submitCurrentInput();
      return;
    }
    if (event.key === "backspace" || event.key === "delete") {
      setInput((value) => value.slice(0, -1));
      setHistoryIndex(null);
      setSelectedCommandSuggestionIndex(0);
      return;
    }
    if (event.key === "escape") {
      if (busyAbortControllerRef.current) {
        busyAbortControllerRef.current.abort();
        appendLog("muted", "Interrupted running action.");
      }
      setInput("");
      setHistoryIndex(null);
      setSelectedCommandSuggestionIndex(0);
      return;
    }
    const printableInput = getPrintableInput(event.char, event.key);
    if (printableInput) {
      setInput((value) => value + printableInput);
      setHistoryIndex(null);
      setSelectedCommandSuggestionIndex(0);
    }
  });

  async function submitCurrentInput(): Promise<void> {
    const value = resolveSelectedCommandInput(input, commandSuggestions, selectedCommandSuggestionIndex);
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

    if (awaitingOpenAiApiKey) {
      await handleOpenAiApiKey(value);
      return;
    }

    if (pendingQuestions.length > 0 && answeringQuestion) {
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
          setLatestTokenUsage(null);
          setSessionTokenUsageTotal(0);
          setLatestWorkspaceScan(null);
          setLatestGeneratedTests(null);
          setActiveStoryPath(null);
          setStoryDraft("");
          setStoryChoices([]);
          setAwaitingStoryChoice(false);
          setSelectedStoryIndex(0);
          setPendingQuestions([]);
          setQuestionIndex(0);
          setAnsweringQuestion(false);
          setTestSetupMode(null);
          setTestSetupSuggestions([]);
          setSelectedTestSetupFramework(null);
          setSelectedTestSetupIndex(0);
          setProviderSetupMode(null);
          setPendingProviderType(null);
          setProviderModelChoices([]);
          setSelectedProviderModelIndex(0);
          setAwaitingOpenAiApiKey(false);
          setMonitorEnabled(false);
          setFolderTreeContext("");
          setActiveTab("session");
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
          promptForTestSetupIfNeeded(scan, "Workspace scan");
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
        await runBusyAction(async (signal) => {
          const plan = await runPlan(args[0], signal);
          setLatestPlan(plan);
          setLatestTokenUsage(plan.tokenUsage ?? null);
          setSessionTokenUsageTotal((total) => total + getTokenUsageTotal(plan.tokenUsage));
          setLatestWorkspaceScan(plan.workspace);
          if (plan.folderTree) {
            setFolderTreeContext(plan.folderTree);
          }
          appendLog("success", `Generated plan with ${plan.plan.suggestedTestScenarios.length} suggested test scenarios.`);
          appendLog("info", renderPlanSummary(plan));
          if (plan.plan.ambiguities.length > 0) {
            setPendingQuestions(plan.plan.ambiguities);
            setQuestionIndex(0);
            setAnsweringQuestion(false);
            appendLog("info", "Questions ready: select one with Up/Down, then press Enter to answer.");
          }
          if (plan.plan.edgeCases.length > 0) {
            appendLog("info", "Run /generate-tests to ask the LLM for production-friendly TDD tests from these edge cases.");
          }
        });
        return;
      case "generate-tests":
        await runBusyAction(async (signal) => {
          await runGenerateTests(args[0], signal);
        });
        return;
      case "monitor":
        await runBusyAction(async () => {
          handleMonitorCommand(args[0]);
        });
        return;
      case "test-failure":
        if (latestTestRun?.llmReadyMessage) {
          appendLog("info", latestTestRun.llmReadyMessage);
        } else if (latestTestRun) {
          appendLog("success", `Latest test run passed: ${formatTestRunSummary(latestTestRun)}`);
        } else {
          appendLog("muted", "No file-change test run has been captured yet.");
        }
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
      case "provider":
        await handleProviderCommand(args);
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
      setLatestTokenUsage(session.latestPlan?.tokenUsage ?? null);
      setSessionTokenUsageTotal(getTokenUsageTotal(session.latestPlan?.tokenUsage));
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
    setLatestTokenUsage(null);
    setSessionTokenUsageTotal(0);
    setLatestGeneratedTests(null);
    setPendingQuestions([]);
    setQuestionIndex(0);
    setAnsweringQuestion(false);
    setFolderTreeContext("");
    setLogEntries([
      { id: 1, tone: "success", text: "Started a new TDDForge session. Type /help to see commands." }
    ]);
    setAwaitingSessionChoice(false);
    setSessionReady(true);
    setActiveTab("session");
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

    const remainingQuestions = pendingQuestions.filter((_, index) => index !== questionIndex);
    if (remainingQuestions.length === 0) {
      setPendingQuestions([]);
      setQuestionIndex(0);
      setAnsweringQuestion(false);
      appendLog("info", "All questions answered. Run /plan again to regenerate the plan with clarifications.");
      return;
    }

    setPendingQuestions(remainingQuestions);
    setQuestionIndex(Math.min(questionIndex, remainingQuestions.length - 1));
    setAnsweringQuestion(false);
    appendLog("info", "Select the next question with Up/Down, then press Enter to answer.");
  }

  function handleMonitorCommand(mode?: string): void {
    if (mode === "off") {
      setMonitorEnabled(false);
      appendLog("muted", "Monitor mode disabled.");
      return;
    }

    const scan = scanWorkspace(workspaceRoot);
    setLatestWorkspaceScan(scan);
    if (!isTestingEnvironmentReady(scan)) {
      promptForTestSetupIfNeeded(scan, "Monitor");
      return;
    }

    setMonitorEnabled(true);
    setActiveTab("monitor");
    void refreshAfterCommitChange("monitor enabled", true);
    setBackgroundTestRun("ready - tests run after file edits");
    appendLog("success", "Monitor mode enabled. Tests run after relevant file edits; suggestions still refresh after commits.");
  }

  async function handleProviderCommand(args: string[]): Promise<void> {
    const [subcommand, ...rest] = args;

    if (!subcommand || subcommand === "setup") {
      setProviderSetupMode("provider");
      setSelectedProviderIndex(Math.max(PROVIDER_CHOICES.indexOf(activeConfig.provider.type), 0));
      setPendingProviderType(null);
      setProviderModelChoices([]);
      setAwaitingOpenAiApiKey(false);
      appendLog("info", "Provider setup: choose Ollama or OpenAI with Up/Down, then press Enter.");
      return;
    }

    if (subcommand === "models") {
      await prepareProviderModelSelection(activeConfig.provider.type, activeConfig.provider);
      return;
    }

    if (subcommand === "model") {
      const modelName = rest.join(" ").trim();
      if (!modelName) {
        throw new Error("Usage: /provider model <model-name>");
      }
      await saveSelectedProviderModel(activeConfig.provider.type, modelName, activeConfig.provider);
      return;
    }

    if (subcommand === "ollama" || subcommand === "openai") {
      await startProviderSetup(subcommand);
      return;
    }

    throw new Error("Usage: /provider [setup|ollama|openai|models|model <name>]");
  }

  async function chooseProviderSetupOption(): Promise<void> {
    await startProviderSetup(PROVIDER_CHOICES[selectedProviderIndex] ?? "ollama");
  }

  async function startProviderSetup(type: ProviderType): Promise<void> {
    setPendingProviderType(type);
    const baseConfig = activeConfig.provider.type === type
      ? activeConfig.provider
      : buildProviderConfig(type, defaultModelForProvider(type));

    if (type === "openai" && !hasProviderAuth(baseConfig)) {
      setProviderSetupMode(null);
      setAwaitingOpenAiApiKey(true);
      setInput("");
      appendLog("info", "OpenAI API key is required. Paste it into the input and press Enter.");
      return;
    }

    await prepareProviderModelSelection(type, baseConfig);
  }

  async function handleOpenAiApiKey(apiKey: string): Promise<void> {
    const provider = buildProviderConfig("openai", activeConfig.provider.type === "openai" ? activeConfig.provider.model : "gpt-4o-mini", {
      apiKey
    });
    setAwaitingOpenAiApiKey(false);
    setPendingProviderType("openai");
    await prepareProviderModelSelection("openai", provider);
  }

  async function prepareProviderModelSelection(type: ProviderType, config: ProviderConfig): Promise<void> {
    await runBusyAction(async () => {
      const models = await listProviderModels(config);
      if (models.length === 0) {
        throw new Error(`No ${type} models were returned by the provider API.`);
      }
      setPendingProviderType(type);
      setProviderModelChoices(models);
      setSelectedProviderModelIndex(Math.max(models.indexOf(config.model), 0));
      setProviderSetupMode("model");
      setActiveTab("status");
      appendLog("success", `Loaded ${models.length} ${type} model(s). Choose one with Up/Down, then press Enter.`);
    });
  }

  async function chooseProviderModelOption(): Promise<void> {
    const modelName = providerModelChoices[selectedProviderModelIndex];
    if (!modelName || !pendingProviderType) {
      return;
    }
    await saveSelectedProviderModel(pendingProviderType, modelName, activeConfig.provider);
  }

  function promptForTestSetupIfNeeded(scan: WorkspaceScanResult, source: string): void {
    if (scan.testFramework !== "unknown" || testSetupMode) {
      return;
    }

    const suggestions = getTestEnvironmentSetupSuggestions(scan);
    if (suggestions.length === 0) {
      return;
    }

    setTestSetupSuggestions(suggestions);
    setSelectedTestSetupFramework(null);
    setSelectedTestSetupIndex(0);
    setTestSetupMode("confirm");
    setActiveTab("monitor");
    appendLog("info", `${source}: no test framework detected. TDDForge can guide an interactive setup for this workspace.`);
    appendLog("muted", `Agent note: ${suggestions[0].reason}`);
  }

  async function saveSelectedProviderModel(type: ProviderType, modelName: string, baseProvider: ProviderConfig): Promise<void> {
    await runBusyAction(async () => {
      const provider = buildProviderConfig(type, modelName, {
        apiKey: baseProvider.type === "openai" ? baseProvider.apiKey : undefined,
        baseUrl: baseProvider.type === "openai" ? baseProvider.baseUrl : undefined,
        host: baseProvider.type === "ollama" ? baseProvider.host : undefined
      });
      const configPath = await saveProviderConfig(workspaceRoot, provider);
      setConfigRevision((revision) => revision + 1);
      setProviderSetupMode(null);
      setPendingProviderType(null);
      setProviderModelChoices([]);
      setSelectedProviderModelIndex(0);
      appendLog("success", `Provider set to ${provider.type} / ${provider.model}`);
      appendLog("muted", `Saved provider config to ${configPath}`);
    });
  }

  async function chooseTestSetupOption(): Promise<void> {
    if (testSetupMode === "confirm") {
      if (selectedTestSetupIndex === 0) {
        setTestSetupMode("framework");
        setSelectedTestSetupIndex(0);
        appendLog("info", "Choose the test framework TDDForge should configure for this project.");
        return;
      }

      setTestSetupMode(null);
      setTestSetupSuggestions([]);
      setSelectedTestSetupFramework(null);
      appendLog("muted", "Testing environment setup skipped. Monitor remains off.");
      return;
    }

    if (testSetupMode === "framework") {
      const framework = testSetupFrameworkOptions[selectedTestSetupIndex];
      if (!framework) {
        setTestSetupMode(null);
        setTestSetupSuggestions([]);
        setSelectedTestSetupFramework(null);
        appendLog("muted", "Testing environment setup skipped. Monitor remains off.");
        return;
      }

      setSelectedTestSetupFramework(framework);
      setSelectedTestSetupIndex(0);
      setTestSetupMode("target");
      appendLog("info", `Framework selected: ${formatTestSetupFramework(framework)}. Choose where TDDForge should create or reuse the test folder.`);
      return;
    }

    const suggestion = testSetupTargetOptions[selectedTestSetupIndex];
    if (!suggestion) {
      setTestSetupMode("framework");
      setSelectedTestSetupIndex(0);
      appendLog("muted", "Returning to framework selection.");
      return;
    }

    setTestSetupMode(null);
    await runBusyAction(async () => {
      await setupTestEnvironment(workspaceRoot, suggestion);
      const scan = scanWorkspace(workspaceRoot);
      setLatestWorkspaceScan(scan);
      setTestSetupSuggestions([]);
      setSelectedTestSetupFramework(null);
      setMonitorEnabled(true);
      setActiveTab("monitor");
      setBackgroundTestRun("ready - tests run after file edits");
      appendLog("success", `${suggestion.label.replace(/^Recommended: /, "")} complete. Monitor enabled.`);
      appendLog("info", "Agent rule: run tests after file changes, capture exact failures before code changes, and save test edits only after user review and confirmation.");
      await refreshAfterCommitChange("test environment setup", true);
    });
  }

  async function runGenerateTests(outputFolder?: string, signal?: AbortSignal): Promise<void> {
    if (!latestPlan) {
      throw new Error("No plan available. Run /plan first.");
    }

    const files = await generateEdgeCaseTests(workspaceRoot, latestPlan, activeConfig, outputFolder, undefined, signal);
    setLatestGeneratedTests(files);
    setLatestTokenUsage(files.tokenUsage ?? null);
    setSessionTokenUsageTotal((total) => total + getTokenUsageTotal(files.tokenUsage));
    appendLog("success", `Generated ${files.testCount} LLM-authored TDD test(s) at ${files.testPath}`);
    void refreshAfterCommitChange("generated edge-case tests", true);
  }

  async function loadSelectedStory(storyPath: string): Promise<void> {
    const storyText = await loadStoryFile(storyPath);
    setStoryDraft(storyText);
    setActiveStoryPath(storyPath);
    setLatestPlan(null);
    setLatestTokenUsage(null);
    setLatestGeneratedTests(null);
    setPendingQuestions([]);
    setQuestionIndex(0);
    setAnsweringQuestion(false);
    appendLog("success", `Loaded story from ${storyPath}`);
    appendLog("muted", "Story context is active. Type more details to append updates or run /plan.");
  }

  function setInlineStoryContext(storyText: string): void {
    setStoryDraft(storyText.trim());
    setActiveStoryPath(null);
    setLatestPlan(null);
    setLatestTokenUsage(null);
    setLatestGeneratedTests(null);
    setPendingQuestions([]);
    setQuestionIndex(0);
    setAnsweringQuestion(false);
    appendLog("success", "Story context captured from /story input.");
    appendLog("muted", "Type more details to append updates or run /plan.");
  }

  async function runPlan(optionalStoryPath?: string, signal?: AbortSignal): Promise<PlanWorkflowResult> {
    if (optionalStoryPath) {
      const storyPath = path.resolve(workspaceRoot, optionalStoryPath);
      return buildPlanFromStoryFile(activeConfig, storyPath, undefined, {
        folderTreeContext: folderTreeContext || undefined,
        signal
      });
    }

    if (!storyDraft.trim()) {
      throw new Error("No story draft available. Paste text or use /story <file>.");
    }

    return buildPlanFromStoryText(activeConfig, storyDraft, undefined, {
      folderTreeContext: folderTreeContext || undefined,
      signal
    });
  }

  async function runBusyAction(action: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const controller = new AbortController();
    busyAbortControllerRef.current = controller;
    setBusy(true);
    try {
      await action(controller.signal);
    } catch (error) {
      const message = isAbortError(error) ? "Action interrupted." : error instanceof Error ? error.message : "Unknown error";
      appendLog("error", message);
    } finally {
      if (busyAbortControllerRef.current === controller) {
        busyAbortControllerRef.current = null;
      }
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

  function scrollActivePanel(direction: "up" | "down"): void {
    const maxOffset = getMaxPanelScroll(panelLineCounts[activeTab], panelVisibleCount);

    setPanelScroll((scroll) => {
      const currentOffset = scroll[activeTab] ?? 0;
      const nextOffset = direction === "up"
        ? Math.max(currentOffset - 1, 0)
        : Math.min(currentOffset + 1, maxOffset);
      setPanelFollowEnd((followEnd) => ({
        ...followEnd,
        [activeTab]: nextOffset >= maxOffset
      }));
      return { ...scroll, [activeTab]: nextOffset };
    });
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
      latestTestRun,
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

  async function runTestsAfterFileChange(changedFile: string, reason: string): Promise<void> {
    if (testRunInFlight.current) {
      setBackgroundTestRun(`queued by ${changedFile} while a test run is active`);
      return;
    }

    try {
      const scan = scanWorkspace(workspaceRoot);
      setLatestWorkspaceScan(scan);
      refreshTestStatus(reason);
      await runBackgroundTests(scan, changedFile, reason);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown test status error";
      setBackgroundTestRun(`error: ${message}`);
      appendLog("error", `File-change test run failed before executing tests: ${message}`);
    }
  }

  async function runBackgroundTests(scan: WorkspaceScanResult, changedFile: string, reason: string): Promise<void> {
    const command = getTestCommand(scan);
    if (!command) {
      setBackgroundTestRun("no test command detected");
      return;
    }

    testRunInFlight.current = true;
    setBackgroundTestRun(`running ${command.join(" ")} after ${changedFile}`);
    try {
      const result = await execa(command[0], command.slice(1), { cwd: workspaceRoot, reject: false });
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      const report = buildTestRunReport({
        command,
        changedFile,
        reason,
        exitCode: result.exitCode ?? 1,
        output
      });
      setLatestTestRun(report);
      setBackgroundTestRun(formatTestRunSummary(report));
      appendLog(report.exitCode === 0 ? "success" : "error", `Tests ${formatTestRunSummary(report)} using ${report.command}`);
      if (report.failureMessage) {
        appendLog("muted", report.failureMessage);
        appendLog("info", "LLM-ready failure context captured. Run /test-failure to review it before asking for a fix.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown test run error";
      setBackgroundTestRun(`error: ${message}`);
      appendLog("error", `File-change test command failed: ${message}`);
    } finally {
      testRunInFlight.current = false;
    }
  }

  return (
    <Box flexDirection="column" width={terminalColumns} height={terminalRows} overflow="hidden" userSelect>
      <Box height={headerHeight} paddingX={1} flexDirection="row" justifyContent="space-between" overflow="hidden">
        <Text color="cyan" bold>TDDForge</Text>
        {terminalColumns >= 64 ? (
          <Text color="gray" wrap="truncate">{activeConfig.provider.type} / {activeConfig.provider.model}</Text>
        ) : null}
      </Box>

      {!awaitingSessionChoice ? (
      <Box height={tabHeight} paddingX={1} flexDirection="row" justifyContent="space-between" overflow="hidden">
        <Text color="cyan" wrap="truncate">{renderTabLabel(activeTab)}</Text>
        {terminalColumns >= 64 ? <Text color="gray" wrap="truncate">Tab switches panels</Text> : null}
      </Box>
      ) : null}

      <Box height={contentHeight} flexDirection="column" overflow="hidden">
      {awaitingSessionChoice ? (
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" height={contentHeight} overflow="hidden">
          <Text color="yellow">Session</Text>
          <Text color="gray">Select a saved session or start fresh below.</Text>
        </Box>
      ) : activeTab === "status" ? (
        <ScrollablePanel
          title="Status"
          borderColor="magenta"
          lines={statusLines}
          scrollOffset={panelScroll.status}
          visibleCount={panelVisibleCount}
          width={panelContentWidth}
        />
      ) : activeTab === "monitor" ? (
        <ScrollablePanel
          title="Monitor"
          borderColor="green"
          lines={monitorLines}
          scrollOffset={panelScroll.monitor}
          visibleCount={panelVisibleCount}
          width={panelContentWidth}
        />
      ) : (
        <ScrollablePanel
          title="Session"
          borderColor="cyan"
          lines={sessionLines}
          scrollOffset={panelScroll.session}
          visibleCount={panelVisibleCount}
          width={panelContentWidth}
        />
      )}

      </Box>

      <Box height={inputHeight} paddingX={1} flexDirection="column" overflow="hidden">
        <Text color="green">Input</Text>
        {awaitingSessionChoice ? (
          <SelectionTray
            title="Choose Session"
            items={[
              ...sessionChoices.map((session) => `${session.title} (${new Date(session.updatedAt).toLocaleString()})`),
              "New session"
            ]}
            selectedIndex={selectedSessionIndex}
            visibleCount={selectionVisibleCount}
            helpText="Use Up/Down to choose, Enter to continue."
          />
        ) : awaitingStoryChoice ? (
          <SelectionTray
            title="Choose Story File"
            items={storyChoices.map((story) => story.label)}
            selectedIndex={selectedStoryIndex}
            visibleCount={selectionVisibleCount}
            helpText="Use Up/Down to choose, Enter to load."
          />
        ) : awaitingTestSetupChoice ? (
          <SelectionTray
            title={getTestSetupTrayTitle(testSetupMode, selectedTestSetupFramework)}
            items={getTestSetupTrayItems(testSetupMode, testSetupFrameworkOptions, testSetupTargetOptions)}
            selectedIndex={selectedTestSetupIndex}
            visibleCount={selectionVisibleCount}
            helpText={getTestSetupTrayHelpText(testSetupMode)}
          />
        ) : providerSetupMode === "provider" ? (
          <SelectionTray
            title="Provider Setup"
            items={PROVIDER_CHOICES.map((provider) => provider)}
            selectedIndex={selectedProviderIndex}
            visibleCount={selectionVisibleCount}
            helpText="Use Up/Down to choose a provider, Enter to list models."
          />
        ) : providerSetupMode === "model" ? (
          <SelectionTray
            title={`${pendingProviderType ?? activeConfig.provider.type} Models`}
            items={providerModelChoices}
            selectedIndex={selectedProviderModelIndex}
            visibleCount={selectionVisibleCount}
            helpText="Use Up/Down to choose a model, Enter to save it."
          />
        ) : pendingQuestions.length > 0 && !answeringQuestion ? (
          <SelectionTray
            title="Questions"
            items={pendingQuestions.map((question, index) => `${index + 1}. ${question}`)}
            selectedIndex={questionIndex}
            visibleCount={selectionVisibleCount}
            helpText="Use Up/Down to choose a question, then press Enter to answer."
          />
        ) : (
          <InputLine
            value={input}
            placeholder={getInputPlaceholder(answeringQuestion, awaitingOpenAiApiKey)}
            width={panelContentWidth}
            frame={uiFrame}
          />
        )}
        <Text color="gray" wrap="truncate">Provider: {activeConfig.provider.type} / {activeConfig.provider.model}</Text>
        {commandSuggestionsVisible ? (
          <CommandSuggestionTray
            commands={commandSuggestions}
            selectedIndex={selectedCommandSuggestionIndex}
            visibleCount={selectionVisibleCount}
          />
        ) : null}
        {busy ? <BusyProgress width={panelContentWidth} frame={uiFrame} /> : <Text color="gray">Ready</Text>}
      </Box>

      {footerHeight > 0 ? (
      <Box height={footerHeight} paddingX={1} flexDirection="column" overflow="hidden">
        <Text color="gray" wrap="truncate">
          {formatTokenUsageFooter(latestTokenUsage, sessionTokenUsageTotal, busy, activeConfig.provider.type, activeConfig.provider.model)}
        </Text>
      </Box>
      ) : null}
    </Box>
  );
}

function nextTab(current: TuiTab, reverse = false): TuiTab {
  const currentIndex = TUI_TABS.indexOf(current);
  const offset = reverse ? -1 : 1;
  return TUI_TABS[(currentIndex + offset + TUI_TABS.length) % TUI_TABS.length];
}

function renderTabLabel(activeTab: TuiTab): string {
  return TUI_TABS
    .map((tab) => activeTab === tab ? `[${tab}]` : tab)
    .join("  ");
}

function getInputBandHeight(terminalRows: number, tabHeight: number, footerHeight: number, hasTray: boolean): number {
  const fixedRows = 1 + tabHeight + footerHeight;
  const minContentRows = terminalRows < 16 ? 3 : hasTray ? 4 : 5;
  const maxInputRows = Math.max(1, terminalRows - fixedRows - minContentRows);
  const preferredInputRows = hasTray ? Math.ceil(terminalRows * 0.55) : 5;
  const minInputRows = Math.min(hasTray ? 8 : 6, maxInputRows);
  const cappedPreferredRows = Math.min(hasTray ? 11 : 7, preferredInputRows);
  return Math.max(1, Math.min(maxInputRows, Math.max(minInputRows, cappedPreferredRows)));
}

function formatTokenUsageFooter(
  usage: TokenUsage | null,
  sessionTotal: number,
  busy: boolean,
  providerType: ProviderConfig["type"],
  model: string,
): string {
  const status = busy ? "running" : "idle";
  if (!usage) {
    return `Token usage: ${status} | total token used: ${formatTokenCount(sessionTotal)} | ${providerType}/${model} | input: -- output: -- total: --`;
  }

  return [
    `Token usage: ${status}`,
    `session total: ${formatTokenCount(sessionTotal)}`,
    `${providerType}/${model}`,
    `input: ${formatTokenCount(usage.inputTokens)}`,
    `output: ${formatTokenCount(usage.outputTokens)}`,
    `total: ${formatTokenCount(usage.totalTokens)}`
  ].join(" | ");
}

function getTokenUsageTotal(usage: TokenUsage | null | undefined): number {
  return usage?.totalTokens ?? (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function formatTokenCount(value: number | undefined): string {
  return value === undefined ? "--" : value.toLocaleString("en-US");
}

function resolveSelectedCommandInput(
  input: string,
  commandSuggestions: SlashCommandDefinition[],
  selectedIndex: number,
): string {
  const value = input.trim();
  if (commandSuggestions.length === 0) {
    return value;
  }

  const command = commandSuggestions[selectedIndex];
  if (!command) {
    return value;
  }

  const parsed = parseSlashCommand(value);
  if (parsed?.name === command.name && (parsed.args.length > 0 || value === `/${command.name}`)) {
    return value;
  }

  return `/${command.name}`;
}

function getInputPlaceholder(answeringQuestion: boolean, awaitingOpenAiApiKey: boolean): string {
  if (awaitingOpenAiApiKey) {
    return "Paste OpenAI API key and press Enter";
  }
  if (answeringQuestion) {
    return "Write your answer and press Enter";
  }
  return "Type /story, /plan, /monitor or add story context";
}

function getTestSetupFrameworkOptions(
  suggestions: TestEnvironmentSetupSuggestion[],
): TestEnvironmentSetupSuggestion["framework"][] {
  return [...new Set(suggestions.map((suggestion) => suggestion.framework))];
}

function getTestSetupTargetOptions(
  suggestions: TestEnvironmentSetupSuggestion[],
  framework: TestEnvironmentSetupSuggestion["framework"] | null,
): TestEnvironmentSetupSuggestion[] {
  if (!framework) {
    return [];
  }
  return suggestions.filter((suggestion) => suggestion.framework === framework);
}

function getTestSetupOptionCount(
  mode: TestSetupMode,
  frameworks: TestEnvironmentSetupSuggestion["framework"][],
  targets: TestEnvironmentSetupSuggestion[],
): number {
  if (mode === "confirm") {
    return 2;
  }
  if (mode === "framework") {
    return frameworks.length + 1;
  }
  if (mode === "target") {
    return targets.length + 1;
  }
  return 1;
}

function getTestSetupTrayTitle(
  mode: TestSetupMode,
  framework: TestEnvironmentSetupSuggestion["framework"] | null,
): string {
  if (mode === "framework") {
    return "Choose Test Framework";
  }
  if (mode === "target") {
    return `Choose ${framework ? formatTestSetupFramework(framework) : "Test"} Folder`;
  }
  return "Set Up Testing?";
}

function getTestSetupTrayItems(
  mode: TestSetupMode,
  frameworks: TestEnvironmentSetupSuggestion["framework"][],
  targets: TestEnvironmentSetupSuggestion[],
): string[] {
  if (mode === "framework") {
    return [
      ...frameworks.map((framework) => `Use ${formatTestSetupFramework(framework)}`),
      "Skip setup"
    ];
  }

  if (mode === "target") {
    return [
      ...targets.map((suggestion) => suggestion.label),
      "Back to framework selection"
    ];
  }

  return [
    "Yes, guide me through test setup",
    "Not now"
  ];
}

function getTestSetupTrayHelpText(mode: TestSetupMode): string {
  if (mode === "framework") {
    return "Use Up/Down to choose a framework, Enter to continue.";
  }
  if (mode === "target") {
    return "Use Up/Down to choose the test folder, Enter to let TDDForge configure it.";
  }
  return "Use Up/Down to decide, Enter to continue.";
}

function formatTestSetupFramework(framework: TestEnvironmentSetupSuggestion["framework"]): string {
  if (framework === "pytest") {
    return "Pytest";
  }
  if (framework === "jest") {
    return "Jest";
  }
  return "Vitest";
}

function InputLine({
  value,
  placeholder,
  width,
  frame
}: {
  value: string;
  placeholder: string;
  width: number;
  frame: number;
}): React.JSX.Element {
  const prompt = "> ";
  const contentWidth = Math.max(1, width - prompt.length - 4);
  const visibleText = value ? trimInputForWidth(value, contentWidth) : placeholder;
  const cursorVisible = value.length > 0 && frame % 2 === 0;
  const cursor = cursorVisible ? "|" : " ";
  const text = `${prompt}${visibleText}${value ? cursor : ""}`.padEnd(Math.max(1, width - 4));

  return (
    <Box borderStyle="round" borderColor="gray" backgroundColor={INPUT_BACKGROUND} paddingX={1} height={3} overflow="hidden">
      <Text color={value ? "white" : "gray"} bgColor={INPUT_BACKGROUND} wrap="truncate">
        {text}
      </Text>
    </Box>
  );
}

function trimInputForWidth(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }

  return value.slice(value.length - width);
}

function getPrintableInput(char: string, key: string): string | null {
  if (isPrintableInput(char)) {
    return char;
  }
  if (isPrintableInput(key)) {
    return key;
  }
  return null;
}

function isPrintableInput(value: string): boolean {
  return value.length === 1 && value >= " " && value !== "\u007f";
}

function defaultModelForProvider(type: ProviderType): string {
  return type === "openai" ? "gpt-4o-mini" : "gemma4:e4b";
}

function buildStatusLines({
  workspaceRoot,
  activeConfig,
  activeStoryPath,
  storyDraft,
  monitorEnabled,
  testStatus,
  latestWorkspaceScan,
  latestPlan,
  latestGeneratedTests,
  latestTestRun
}: {
  workspaceRoot: string;
  activeConfig: ResolvedConfig;
  activeStoryPath: string | null;
  storyDraft: string;
  monitorEnabled: boolean;
  testStatus: TestStatus;
  latestWorkspaceScan: WorkspaceScanResult | null;
  latestPlan: PlanWorkflowResult | null;
  latestGeneratedTests: GeneratedTestFiles | null;
  latestTestRun: TestRunReport | null;
}): PanelLine[] {
  return [
    { text: `Workspace: ${workspaceRoot}` },
    { text: `Provider: ${activeConfig.provider.type} / ${activeConfig.provider.model}` },
    { text: `Story: ${activeStoryPath ? path.relative(workspaceRoot, activeStoryPath) : "draft only"}` },
    { text: `Story context: ${storyDraft ? `${storyDraft.split("\n").length} line(s)` : "empty"}` },
    { text: `Monitor: ${monitorEnabled ? "on" : "off"}`, tone: monitorEnabled ? "success" : "muted" },
    { text: `Test framework: ${testStatus.framework}` },
    { text: `Test dirs: ${testStatus.directories.join(", ") || "none detected"}` },
    {
      text: `Test status: ${testStatus.lastUpdated ? testStatus.lastUpdated.toLocaleTimeString() : "not yet"} / ${testStatus.reason}`,
      tone: "muted"
    },
    { text: `Suggestion: ${testStatus.suggestion}`, tone: "info" },
    {
      text: `Workspace scan: ${latestWorkspaceScan ? `${latestWorkspaceScan.projectType}, ${latestWorkspaceScan.language}, ${latestWorkspaceScan.moduleSystem}` : "not loaded"}`
    },
    {
      text: `Checked-in tests: ${latestWorkspaceScan?.checkedInTestFiles.length ?? 0}`
    },
    {
      text: `Latest plan: ${latestPlan ? `${latestPlan.plan.requirements.length} requirement(s), ${latestPlan.plan.edgeCases.length} edge case(s)` : "none"}`
    },
    {
      text: `Generated tests: ${latestGeneratedTests ? `${latestGeneratedTests.testCount} at ${latestGeneratedTests.testPath}` : "none"}`
    },
    {
      text: `Last file test: ${latestTestRun ? formatTestRunSummary(latestTestRun) : "none captured"}`,
      tone: latestTestRun?.exitCode === 0 ? "success" : latestTestRun ? "error" : "muted"
    }
  ];
}

function buildMonitorLines({
  monitorEnabled,
  latestWorkspaceScan,
  latestGeneratedTests,
  backgroundTestRun,
  latestTestRun,
  lastSeenCommit,
  monitorSuggestions
}: {
  monitorEnabled: boolean;
  latestWorkspaceScan: WorkspaceScanResult | null;
  latestGeneratedTests: GeneratedTestFiles | null;
  backgroundTestRun: string;
  latestTestRun: TestRunReport | null;
  lastSeenCommit: string | null;
  monitorSuggestions: string[];
}): PanelLine[] {
  return [
    { text: `Status: ${monitorEnabled ? "watching relevant file edits" : "off - run /monitor to start"}`, tone: monitorEnabled ? "success" : "muted" },
    { text: `Commit suggestions: refresh after new commits` },
    { text: `File tests: ${backgroundTestRun}`, tone: latestTestRun?.exitCode === 0 ? "success" : latestTestRun ? "error" : "muted" },
    {
      text: `Detected tests: ${latestWorkspaceScan?.testFramework ?? "unknown"} / dirs: ${latestWorkspaceScan?.testDirectories.join(", ") || "none detected"}`
    },
    {
      text: `Latest generated: ${latestGeneratedTests ? `${latestGeneratedTests.testCount} todo(s) in ${latestGeneratedTests.testPath}` : "none"}`
    },
    { text: `Last commit: ${lastSeenCommit ? lastSeenCommit.slice(0, 7) : "unavailable"}` },
    ...(latestTestRun?.failureMessage
      ? [
          { text: "Last failure:", tone: "error" as const },
          ...latestTestRun.failureMessage.split(/\r?\n/).slice(0, 8).map((line) => ({ text: line, tone: "muted" as const }))
        ]
      : []),
    ...monitorSuggestions.map((suggestion) => ({ text: `- ${suggestion}`, tone: "info" as const }))
  ];
}

function buildSessionLines(logEntries: LogEntry[]): PanelLine[] {
  return logEntries.length > 0
    ? logEntries.map((entry) => ({ text: entry.text, tone: entry.tone }))
    : [{ text: "No session messages yet.", tone: "muted" }];
}

function ScrollablePanel({
  title,
  borderColor,
  lines,
  scrollOffset,
  visibleCount,
  width
}: {
  title: string;
  borderColor: string;
  lines: PanelLine[];
  scrollOffset: number;
  visibleCount: number;
  width: number;
}): React.JSX.Element {
  const safeVisibleCount = Math.max(1, visibleCount);
  const wrappedLines = wrapPanelLines(lines, width);
  const maxOffset = Math.max(wrappedLines.length - safeVisibleCount, 0);
  const offset = Math.min(scrollOffset, maxOffset);
  const visibleLines = wrappedLines.slice(offset, offset + safeVisibleCount);
  const scrollbar = renderScrollbar(wrappedLines.length, safeVisibleCount, offset);

  return (
    <Box borderStyle="round" borderColor={borderColor} paddingX={1} flexDirection="column" flexGrow={1} overflow="hidden">
      <Text color={borderColor} wrap="truncate">{title}</Text>
      {visibleLines.map((line, index) => (
        <Text key={`${offset}-${index}-${line.text}`} color={toneToColor(line.tone)}>
          {line.text}
        </Text>
      ))}
        <Text color="gray" wrap="truncate">{scrollbar}</Text>
    </Box>
  );
}

function countWrappedPanelLines(lines: PanelLine[], width: number): number {
  return wrapPanelLines(lines, width).length;
}

function wrapPanelLines(lines: PanelLine[], width: number): PanelLine[] {
  const safeWidth = Math.max(1, width);
  const wrapped: PanelLine[] = [];

  for (const line of lines) {
    const textLines = line.text.split(/\r?\n/);
    for (const textLine of textLines) {
      if (textLine.length === 0) {
        wrapped.push({ ...line, text: "" });
        continue;
      }

      for (let start = 0; start < textLine.length; start += safeWidth) {
        wrapped.push({ ...line, text: textLine.slice(start, start + safeWidth) });
      }
    }
  }

  return wrapped.length > 0 ? wrapped : [{ text: "" }];
}

function getMaxPanelScroll(lineCount: number, visibleCount: number): number {
  return Math.max(lineCount - Math.max(1, visibleCount), 0);
}

function clampPanelScroll(scrollOffset: number, lineCount: number, visibleCount: number): number {
  return Math.min(Math.max(scrollOffset, 0), getMaxPanelScroll(lineCount, visibleCount));
}

function isSamePanelScroll(left: Record<TuiTab, number>, right: Record<TuiTab, number>): boolean {
  return TUI_TABS.every((tab) => left[tab] === right[tab]);
}

function BusyProgress({ width, frame }: { width: number; frame: number }): React.JSX.Element {
  const barWidth = Math.max(10, Math.min(32, width - 14));
  const segmentWidth = Math.max(3, Math.min(8, Math.floor(barWidth / 4)));
  const maxStart = Math.max(1, barWidth - segmentWidth);
  const cycle = maxStart * 2;
  const step = frame % cycle;
  const start = step <= maxStart ? step : cycle - step;
  const track = Array.from({ length: barWidth }, (_, index) =>
    index >= start && index < start + segmentWidth ? "=" : "-"
  ).join("");

  return (
    <Box flexDirection="row" alignItems="center" gap={1}>
      <Text color="yellow">[{track}]</Text>
      <Text color="yellow">running</Text>
    </Box>
  );
}

function renderScrollbar(total: number, visibleCount: number, offset: number): string {
  if (total <= visibleCount) {
    return `[${"=".repeat(10)}] ${total}/${total}`;
  }

  const trackLength = 10;
  const thumbSize = Math.max(1, Math.floor((visibleCount / total) * trackLength));
  const maxOffset = Math.max(total - visibleCount, 1);
  const thumbStart = Math.min(trackLength - thumbSize, Math.floor((offset / maxOffset) * (trackLength - thumbSize)));
  const track = Array.from({ length: trackLength }, (_, index) =>
    index >= thumbStart && index < thumbStart + thumbSize ? "=" : "-"
  ).join("");
  return `[${track}] ${Math.min(offset + visibleCount, total)}/${total}`;
}

function toneToColor(tone?: LogTone): string | undefined {
  if (tone === "success") {
    return "green";
  }
  if (tone === "error") {
    return "red";
  }
  if (tone === "muted") {
    return "gray";
  }
  if (tone === "info") {
    return "yellow";
  }
  return undefined;
}

function SelectionTray({
  title,
  items,
  selectedIndex,
  visibleCount,
  helpText
}: {
  title: string;
  items: string[];
  selectedIndex: number;
  visibleCount: number;
  helpText: string;
}): React.JSX.Element {
  const { start, end } = getVisibleRange(items.length, selectedIndex, visibleCount);
  const visibleItems = items.slice(start, end);

  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column" overflow="hidden">
      <Text color="yellow" wrap="truncate">{title}</Text>
      {start > 0 ? <Text color="gray">...</Text> : null}
      {visibleItems.map((item, visibleIndex) => {
        const itemIndex = start + visibleIndex;
        return (
          <Text key={`${itemIndex}-${item}`} color={selectedIndex === itemIndex ? "cyan" : "white"} wrap="truncate">
            {selectedIndex === itemIndex ? "> " : "  "}{item}
          </Text>
        );
      })}
      {end < items.length ? <Text color="gray">...</Text> : null}
      <Text color="gray" wrap="truncate">{helpText}</Text>
    </Box>
  );
}

function getVisibleRange(total: number, selectedIndex: number, visibleCount: number): { start: number; end: number } {
  const safeVisibleCount = Math.max(1, visibleCount);
  if (total <= safeVisibleCount) {
    return { start: 0, end: total };
  }

  const halfWindow = Math.floor(safeVisibleCount / 2);
  const start = Math.min(Math.max(selectedIndex - halfWindow, 0), total - safeVisibleCount);
  return { start, end: start + safeVisibleCount };
}

function CommandSuggestionTray({
  commands,
  selectedIndex,
  visibleCount
}: {
  commands: SlashCommandDefinition[];
  selectedIndex: number;
  visibleCount: number;
}): React.JSX.Element {
  const { start, end } = getVisibleRange(commands.length, selectedIndex, visibleCount);
  const visibleCommands = commands.slice(start, end);

  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column" overflow="hidden">
      <Text color="yellow" wrap="truncate">Suggestions</Text>
      {start > 0 ? <Text color="gray">...</Text> : null}
      {visibleCommands.map((command, visibleIndex) => {
        const commandIndex = start + visibleIndex;
        return (
          <Text key={command.name} color={selectedIndex === commandIndex ? "cyan" : "white"} wrap="truncate">
            {selectedIndex === commandIndex ? "> " : "  "}{command.usage} - {command.description}
          </Text>
        );
      })}
      {end < commands.length ? <Text color="gray">...</Text> : null}
      <Text color="gray">Use Up/Down to choose, Enter to run.</Text>
    </Box>
  );
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
    suggestions.push("No test framework detected. Choose a suggested setup action, or run /scan to show setup choices again.");
  }

  if (scan.testDirectories.length === 0) {
    suggestions.push("No test folder detected. Setup can create a dedicated tests/, test/, or __tests__/ folder.");
  }

  if (!plan) {
    suggestions.push("Run /plan after loading a story to get edge-case based test suggestions.");
  } else if (!generatedTests) {
    suggestions.push("Run /generate-tests to ask the LLM for production-friendly TDD tests from the latest edge cases.");
  } else {
    suggestions.push("Review LLM-generated tests, wire any unknown imports to real modules, and keep the production assertions.");
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

function toWorkspaceRelativePath(workspaceRoot: string, watchedDirectory: string, fileName: string): string {
  const absolutePath = path.isAbsolute(fileName) ? fileName : path.join(watchedDirectory, fileName);
  return path.relative(workspaceRoot, absolutePath) || fileName;
}

function isRelevantProjectChange(fileName: string): boolean {
  if (!fileName) {
    return true;
  }

  const baseName = path.basename(fileName);
  return /\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(baseName) ||
    /\.test\./.test(baseName) ||
    ["package.json", "package-lock.json", "vitest.config.ts", "jest.config.js", "jest.config.ts"].includes(baseName);
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
  return `Last generated ${generatedTests.testCount} LLM-authored TDD test(s). Commit code/test changes to refresh monitor suggestions.`;
}

function isTestingEnvironmentReady(scan: WorkspaceScanResult): boolean {
  return scan.testFramework !== "unknown";
}

function getTestCommand(scan: WorkspaceScanResult): string[] | null {
  if (!scan.scripts.includes("test")) {
    return null;
  }

  if (scan.packageManager === "pnpm") {
    return ["pnpm", "test"];
  }
  if (scan.packageManager === "yarn") {
    return ["yarn", "test"];
  }
  return ["npm", "test"];
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
    `Last file test: ${snapshot.latestTestRun ? formatTestRunSummary(snapshot.latestTestRun) : "none captured"}`,
    `Last failure message: ${snapshot.latestTestRun?.failureMessage ?? "none"}`,
    `Detected tests: ${snapshot.latestWorkspaceScan?.checkedInTestFiles.map((file) => file.path).join(", ") || "none"}`,
    `Generated tests: ${snapshot.latestGeneratedTests ? `${snapshot.latestGeneratedTests.testCount} at ${snapshot.latestGeneratedTests.testPath}` : "none"}`,
    "",
    "Latest Plan",
    snapshot.latestPlan ? renderPlanSummary(snapshot.latestPlan) : "No plan generated.",
    "",
    "Session Log",
    ...snapshot.logEntries.map((entry) => `[${entry.tone}] ${entry.text}`)
  ];

  return `${stripTuiCopyArtifacts(lines.join("\n"))}\n`;
}

function stripTuiCopyArtifacts(value: string): string {
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/[\u2500-\u257f]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n");
}
