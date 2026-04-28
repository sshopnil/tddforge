import { describe, expect, it } from "vitest";
import { buildTestRunReport, extractFailureMessage, parseTestCounts } from "../src/tui/test-run.js";

describe("parseTestCounts", () => {
  it("reads Vitest pass and failure counts", () => {
    const output = [
      " Test Files  1 failed | 2 passed (3)",
      "      Tests  2 failed | 7 passed | 1 skipped (10)"
    ].join("\n");

    expect(parseTestCounts(output)).toEqual({
      passed: 7,
      failed: 2,
      skipped: 1,
      total: 10
    });
  });

  it("counts todo tests as skipped", () => {
    expect(parseTestCounts("Tests  4 passed | 2 todo (6)")).toEqual({
      passed: 4,
      failed: 0,
      skipped: 2,
      total: 6
    });
  });
});

describe("extractFailureMessage", () => {
  it("keeps the specific failure section and omits summary lines", () => {
    const output = [
      " FAIL  tests/example.test.ts > saves the record",
      "AssertionError: expected 500 to be 201",
      "Expected: 201",
      "Received: 500",
      " Tests  1 failed | 4 passed (5)"
    ].join("\n");

    expect(extractFailureMessage(output)).toBe([
      "FAIL  tests/example.test.ts > saves the record",
      "AssertionError: expected 500 to be 201",
      "Expected: 201",
      "Received: 500"
    ].join("\n"));
  });
});

describe("buildTestRunReport", () => {
  it("renders an LLM-ready message for failed file-change runs", () => {
    const report = buildTestRunReport({
      command: ["npm", "test"],
      changedFile: "tests/example.test.ts",
      reason: "updated tests/example.test.ts",
      exitCode: 1,
      output: [
        " FAIL  tests/example.test.ts > saves the record",
        "AssertionError: expected 500 to be 201",
        " Tests  1 failed | 4 passed (5)"
      ].join("\n")
    });

    expect(report.counts.failed).toBe(1);
    expect(report.llmReadyMessage).toContain("Changed file: tests/example.test.ts");
    expect(report.llmReadyMessage).toContain("Counts: 4 passed, 1 failed, 0 skipped, 5 total");
    expect(report.llmReadyMessage).toContain("Do not save changes until the user reviews and confirms the proposed edit.");
  });
});
