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
  const scenarioCases = result.plan.suggestedTestScenarios.map((scenario) => ({
    title: scenario.title,
    requirementIds: scenario.requirementIds,
    notes: [
      `Given: ${scenario.given}`,
      `When: ${scenario.when}`,
      `Then: ${scenario.then}`
    ]
  }));

  const scenarioText = result.plan.suggestedTestScenarios
    .map((scenario) => [
      scenario.title,
      scenario.given,
      scenario.when,
      scenario.then
    ].join(" ").toLowerCase())
    .join("\n");

  const edgeCaseFallbacks = result.plan.edgeCases
    .filter((edgeCase) => !scenarioText.includes(edgeCase.toLowerCase()))
    .map((edgeCase) => ({
      title: `Edge case: ${edgeCase}`,
      requirementIds: [],
      notes: [`Plan edge case: ${edgeCase}`]
    }));

  return [...scenarioCases, ...edgeCaseFallbacks];
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
