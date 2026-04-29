import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateEdgeCaseTests } from "../src/export/generated-tests.js";
import type { PlanWorkflowResult } from "../src/story-engine/planner.js";

describe("generateEdgeCaseTests", () => {
  it("writes Vitest todo cases from plan scenarios and uncovered edge cases", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-generated-tests-"));
    await mkdir(path.join(workspace, "tests"));
    await writeFile(path.join(workspace, "tests", "existing.test.ts"), "import { it } from \"vitest\";\n");
    const result: PlanWorkflowResult = {
      workspace: {
        workspaceRoot: workspace,
        packageManager: "npm",
        testFramework: "vitest",
        projectType: "node",
        language: "typescript",
        moduleSystem: "esm",
        packageName: "fixture-app",
        scripts: ["test"],
        dependencies: [],
        devDependencies: ["vitest"],
        testDirectories: ["tests"],
        checkedInTestFiles: [{ path: path.join("tests", "existing.test.ts"), framework: "vitest" }]
      },
      plan: {
        summary: "Password reset should handle edge cases",
        requirements: [{ id: "REQ-1", text: "Reset request is accepted", source: "explicit" }],
        ambiguities: [],
        edgeCases: ["Unknown email address", "Expired reset token"],
        suggestedTestScenarios: [
          {
            id: "TC-1",
            title: "Unknown email does not disclose account status",
            level: "integration",
            requirementIds: ["REQ-1"],
            given: "Given an unknown email",
            when: "When reset is requested",
            then: "Then the response stays generic"
          }
        ]
      }
    };

    const files = await generateEdgeCaseTests(workspace, result);
    const testFile = await readFile(files.testPath, "utf8");

    expect(files.testCount).toBe(3);
    expect(files.testPath).toBe(path.join(workspace, "tests", "edge-cases.test.ts"));
    expect(testFile).toContain("it.todo(\"Unknown email does not disclose account status\")");
    expect(testFile).toContain("it.todo(\"Edge case: Unknown email address\")");
    expect(testFile).toContain("it.todo(\"Edge case: Expired reset token\")");
    expect(testFile).not.toContain("//");
  });

  it("writes pytest todo cases beside checked-in pytest files", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-generated-pytest-"));
    await mkdir(path.join(workspace, "tests"));
    await writeFile(path.join(workspace, "tests", "test_existing.py"), "def test_existing():\n    assert True\n");
    const result: PlanWorkflowResult = {
      workspace: {
        workspaceRoot: workspace,
        packageManager: "unknown",
        testFramework: "pytest",
        projectType: "unknown",
        language: "unknown",
        moduleSystem: "unknown",
        scripts: [],
        dependencies: [],
        devDependencies: [],
        testDirectories: ["tests"],
        checkedInTestFiles: [{ path: path.join("tests", "test_existing.py"), framework: "pytest" }]
      },
      plan: {
        summary: "Python flow",
        requirements: [{ id: "REQ-1", text: "Requirement", source: "explicit" }],
        ambiguities: [],
        edgeCases: ["Invalid token"],
        suggestedTestScenarios: [
          {
            id: "TC-1",
            title: "Invalid token is rejected",
            level: "unit",
            requirementIds: ["REQ-1"],
            given: "Given an invalid token",
            when: "When validation runs",
            then: "Then it is rejected"
          }
        ]
      }
    };

    const files = await generateEdgeCaseTests(workspace, result);
    const testFile = await readFile(files.testPath, "utf8");

    expect(files.testPath).toBe(path.join(workspace, "tests", "test_edge_cases.py"));
    expect(testFile).toContain("import pytest");
    expect(testFile).toContain("def test_invalid_token_is_rejected():");
    expect(testFile).not.toContain("#");
  });
});
