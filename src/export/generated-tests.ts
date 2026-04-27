import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlanWorkflowResult } from "../story-engine/planner.js";
import { scanWorkspace } from "../workspace/scan.js";
import { resolveTestPlacement } from "../workspace/test-placement.js";
import type { SupportedTestFramework } from "../workspace/types.js";

export interface GeneratedTestFiles {
  testPath: string;
  testCount: number;
}

export async function generateEdgeCaseTests(
  workspaceRoot: string,
  result: PlanWorkflowResult,
  outputFolder?: string,
): Promise<GeneratedTestFiles> {
  const placement = resolveTestPlacement(scanWorkspace(workspaceRoot));
  const outputDir = path.resolve(workspaceRoot, outputFolder ?? placement.directory);
  await mkdir(outputDir, { recursive: true });

  const testPath = path.join(outputDir, getGeneratedTestFileName(placement.framework, placement.extension));
  const testCases = buildEdgeCaseTestCases(result);

  await writeFile(testPath, renderEdgeCaseTestFile(placement.framework, testCases), "utf8");

  return { testPath, testCount: testCases.length };
}

interface EdgeCaseTestCase {
  title: string;
  requirementIds: string[];
  notes: string[];
}

function buildEdgeCaseTestCases(result: PlanWorkflowResult): EdgeCaseTestCase[] {
  return result.plan.edgeCases.map((edgeCase, index) => {
    const relatedScenario = result.plan.suggestedTestScenarios[index % result.plan.suggestedTestScenarios.length];

    return {
      title: edgeCase,
      requirementIds: relatedScenario?.requirementIds ?? [],
      notes: [
        relatedScenario ? `Suggested scenario: ${relatedScenario.title}` : "No matching scenario was generated.",
        relatedScenario ? `Given: ${relatedScenario.given}` : "",
        relatedScenario ? `When: ${relatedScenario.when}` : "",
        relatedScenario ? `Then: ${relatedScenario.then}` : ""
      ].filter(Boolean)
    };
  });
}

function renderEdgeCaseTestFile(framework: SupportedTestFramework, testCases: EdgeCaseTestCase[]): string {
  if (framework === "pytest") {
    return renderPytestFile(testCases);
  }

  const importSource = framework === "jest" ? "@jest/globals" : "vitest";
  const lines = [`import { describe, it } from "${importSource}";`, "", "describe(\"generated edge case coverage\", () => {"];

  for (const testCase of testCases) {
    lines.push(`  it.todo(${JSON.stringify(testCase.title)});`);
  }

  lines.push("});");

  return `${lines.join("\n")}\n`;
}

function renderPytestFile(testCases: EdgeCaseTestCase[]): string {
  const lines = ["import pytest", ""];

  for (const testCase of testCases) {
    lines.push("@pytest.mark.skip(reason=\"todo\")");
    lines.push(`def test_${slugifyPythonName(testCase.title)}():`);
    lines.push("    raise NotImplementedError");
    lines.push("");
  }

  return lines.join("\n");
}

function getGeneratedTestFileName(framework: SupportedTestFramework, extension: "py" | "ts" | "js"): string {
  if (framework === "pytest" || extension === "py") {
    return "test_edge_cases.py";
  }
  return `edge-cases.test.${extension}`;
}

function slugifyPythonName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "edge_case";
}
