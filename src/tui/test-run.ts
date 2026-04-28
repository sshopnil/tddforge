export interface TestCounts {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface TestRunReport {
  command: string;
  changedFile: string;
  reason: string;
  exitCode: number;
  counts: TestCounts;
  failureMessage: string | null;
  llmReadyMessage: string | null;
}

export function buildTestRunReport(options: {
  command: string[];
  changedFile: string;
  reason: string;
  exitCode: number;
  output: string;
}): TestRunReport {
  const commandText = options.command.join(" ");
  const counts = parseTestCounts(options.output);
  const failureMessage = options.exitCode === 0 ? null : extractFailureMessage(options.output);
  const report: TestRunReport = {
    command: commandText,
    changedFile: options.changedFile,
    reason: options.reason,
    exitCode: options.exitCode,
    counts,
    failureMessage,
    llmReadyMessage: null
  };

  return {
    ...report,
    llmReadyMessage: failureMessage ? renderLlmReadyTestFailureMessage(report) : null
  };
}

export function formatTestRunSummary(report: TestRunReport): string {
  const outcome = report.exitCode === 0 ? "passed" : "failed";
  const countText = `passed=${report.counts.passed}, failed=${report.counts.failed}, skipped=${report.counts.skipped}, total=${report.counts.total}`;
  return `${outcome}: ${countText} after ${report.changedFile}`;
}

export function parseTestCounts(output: string): TestCounts {
  const testsLine = output.split(/\r?\n/).find((line) => /^\s*Tests\s+/i.test(stripAnsi(line)));
  const source = testsLine ? stripAnsi(testsLine) : stripAnsi(output);
  const passed = readCount(source, "passed");
  const failed = readCount(source, "failed");
  const skipped = readCount(source, "skipped") + readCount(source, "todo");
  const explicitTotal = readCount(source, "tests?");
  const total = explicitTotal || passed + failed + skipped;

  return { passed, failed, skipped, total };
}

export function extractFailureMessage(output: string, limit = 1800): string {
  const cleanOutput = stripAnsi(output).trim();
  if (!cleanOutput) {
    return "Test command failed without output.";
  }

  const lines = cleanOutput.split(/\r?\n/);
  const firstFailureIndex = lines.findIndex((line) =>
    /^\s*(FAIL|Failed|Error|AssertionError|TypeError|ReferenceError|SyntaxError)\b/.test(line) ||
    line.includes("AssertionError") ||
    line.includes("expected") && line.includes("received")
  );
  const relevantLines = firstFailureIndex >= 0 ? lines.slice(firstFailureIndex) : lines;
  const stopIndex = relevantLines.findIndex((line, index) =>
    index > 0 && /^\s*(Test Files|Tests|Snapshots|Time|Ran all test suites)/i.test(line)
  );
  const message = (stopIndex >= 0 ? relevantLines.slice(0, stopIndex) : relevantLines).join("\n").trim();

  return message.slice(0, limit);
}

export function renderLlmReadyTestFailureMessage(report: TestRunReport): string {
  return [
    "TDDForge failing test context",
    "",
    `Changed file: ${report.changedFile}`,
    `Trigger: ${report.reason}`,
    `Command: ${report.command}`,
    `Exit code: ${report.exitCode}`,
    `Counts: ${report.counts.passed} passed, ${report.counts.failed} failed, ${report.counts.skipped} skipped, ${report.counts.total} total`,
    "",
    "Failure message:",
    report.failureMessage ?? "No failure message captured.",
    "",
    "Instruction for the LLM:",
    "Identify the failing test case and propose the smallest test-file or implementation change needed. Do not save changes until the user reviews and confirms the proposed edit."
  ].join("\n");
}

function readCount(source: string, labelPattern: string): number {
  const matches = [...source.matchAll(new RegExp(`(\\d+)\\s+${labelPattern}\\b`, "gi"))];
  return matches.reduce((sum, match) => sum + Number(match[1]), 0);
}

function stripAnsi(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 27 && value[index + 1] === "[") {
      index += 2;
      while (index < value.length && value[index] !== "m") {
        index += 1;
      }
      continue;
    }
    output += value[index];
  }
  return output;
}
