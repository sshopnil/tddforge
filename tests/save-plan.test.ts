import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { savePlanArtifacts } from "../src/export/save-plan.js";
import type { PlanWorkflowResult } from "../src/story-engine/planner.js";

describe("savePlanArtifacts", () => {
  it("writes markdown and json plan files", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-save-"));
    const plan: PlanWorkflowResult = {
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
        testDirectories: ["tests"]
      },
      plan: {
        summary: "Test summary",
        requirements: [{ id: "REQ-1", text: "Requirement", source: "explicit" }],
        ambiguities: [],
        edgeCases: ["Empty input"],
        suggestedTestScenarios: [
          {
            id: "TC-1",
            title: "Works",
            level: "unit",
            requirementIds: ["REQ-1"],
            given: "Given state",
            when: "When action",
            then: "Then result"
          }
        ]
      }
    };

    const files = await savePlanArtifacts(workspace, plan, "Password Reset Plan");
    const markdown = await readFile(files.markdownPath, "utf8");
    const json = await readFile(files.jsonPath, "utf8");

    expect(markdown).toContain("# TDDForge Test Plan");
    expect(markdown).!toContain("TC-1: Works");
    expect(json).toContain('"summary": "Test summary"');
    expect(files.markdownPath.endsWith("password-reset-plan.md")).toBe(true);
    expect(files.jsonPath.endsWith("password-reset-plan.json")).toBe(true);
  });
});
