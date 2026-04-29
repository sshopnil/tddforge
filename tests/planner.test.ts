import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedConfig } from "../src/config/load-config.js";
import type { LlmProvider, ProviderHealth } from "../src/providers/types.js";
import { buildPlanFromStoryFile } from "../src/story-engine/planner.js";
import { buildPlanningPrompt } from "../src/story-engine/prompt.js";

class FakeProvider implements LlmProvider {
  readonly type = "ollama" as const;

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: true };
  }

  async generateText(): Promise<string> {
    return JSON.stringify({
      summary: "The story adds password reset support.",
      requirements: [
        { id: "REQ-1", text: "User can request a reset email.", source: "explicit" },
        { id: "REQ-2", text: "Invalid email should not disclose account status.", source: "inferred" }
      ],
      ambiguities: ["How long should the reset token remain valid?"],
      edgeCases: [
        "Unknown email address",
        "Expired reset token",
        "Too many reset requests"
      ],
      suggestedTestScenarios: [
        {
          id: "TC-1",
          title: "Known user can request a reset email",
          level: "integration",
          requirementIds: ["REQ-1"],
          given: "Given a registered user email",
          when: "When the reset endpoint is called",
          then: "Then a reset email is queued"
        }
      ]
    });
  }
}

describe("story planner", () => {
  it("builds a structured plan from a story file", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-plan-"));
    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({
        name: "fixture-app",
        scripts: { test: "vitest" },
        devDependencies: { vitest: "^3.0.0" }
      }),
    );
    await writeFile(path.join(workspace, "package-lock.json"), "{}");
    const storyPath = path.join(workspace, "story.md");
    await writeFile(
      storyPath,
      "As a user, I want to request a password reset email so that I can regain account access.\n",
    );

    const config: ResolvedConfig = {
      workspaceRoot: workspace,
      provider: {
        type: "ollama",
        model: "gemma4:e4b",
        host: "http://127.0.0.1:11434"
      },
      testFramework: "auto"
    };

    const result = await buildPlanFromStoryFile(config, storyPath, new FakeProvider());

    expect(result.workspace.testFramework).toBe("vitest");
    expect(result.plan.summary).toContain("password reset");
    expect(result.plan.requirements).toHaveLength(2);
    expect(result.plan.edgeCases).toContain("Expired reset token");
    expect(result.plan.suggestedTestScenarios[0]?.level).toBe("integration");
  });

  it("builds compact prompts for local model planning", () => {
    const prompt = buildPlanningPrompt(
      "A".repeat(11000),
      {
        workspaceRoot: "/repo",
        packageManager: "npm",
        testFramework: "vitest",
        projectType: "node",
        language: "typescript",
        moduleSystem: "esm",
        packageName: "fixture",
        scripts: ["test"],
        dependencies: Array.from({ length: 50 }, (_, index) => `dep-${index}`),
        devDependencies: Array.from({ length: 50 }, (_, index) => `dev-${index}`),
        testDirectories: ["tests"],
        checkedInTestFiles: Array.from({ length: 40 }, (_, index) => ({
          path: `tests/${index}.test.ts`,
          framework: "vitest"
        }))
      },
      "tree\n".repeat(2000),
    );

    expect(prompt.prompt).toContain("...truncated...");
    expect(prompt.prompt).not.toContain("workspaceRoot");
    expect(prompt.prompt).not.toContain("dep-49");
    expect(prompt.prompt).not.toContain("dev-49");
    expect(prompt.prompt).not.toContain("tests/39.test.ts");
  });

  it("instructs small models to generate concrete test scenarios from requirements and edge cases", () => {
    const prompt = buildPlanningPrompt(
      "As an admin, I want to retry due tasks so that missed work can be rescheduled.",
      {
        workspaceRoot: "/repo",
        packageManager: "npm",
        testFramework: "vitest",
        projectType: "node",
        language: "typescript",
        moduleSystem: "esm",
        packageName: "fixture",
        scripts: ["test"],
        dependencies: [],
        devDependencies: ["vitest"],
        testDirectories: ["tests"],
        checkedInTestFiles: []
      },
    );

    expect(prompt.system).toContain("For every explicit requirement");
    expect(prompt.system).toContain("For every edge case");
    expect(prompt.system).toContain("concrete Given/When/Then");
    expect(prompt.system).toContain("For small local models");
  });
});
