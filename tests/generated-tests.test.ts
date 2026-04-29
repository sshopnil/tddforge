import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateEdgeCaseTests } from "../src/export/generated-tests.js";
import type { ResolvedConfig } from "../src/config/load-config.js";
import type { GenerateTextInput, GenerateTextResult, LlmProvider, ProviderHealth } from "../src/providers/types.js";
import type { PlanWorkflowResult } from "../src/story-engine/planner.js";

class FakeGeneratedTestsProvider implements LlmProvider {
  readonly type = "ollama" as const;
  lastInput: GenerateTextInput | null = null;

  constructor(private readonly content: string, private readonly fileName?: string) {}

  async healthCheck(): Promise<ProviderHealth> {
    return { ok: true };
  }

  async generateText(_config: ResolvedConfig["provider"], input: GenerateTextInput): Promise<GenerateTextResult> {
    this.lastInput = input;
    return {
      text: JSON.stringify({
        fileName: this.fileName,
        testCount: 2,
        content: this.content
      }),
      tokenUsage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 }
    };
  }
}

describe("generateEdgeCaseTests", () => {
  it("writes executable Vitest TDD cases from planned edge cases", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-generated-tests-"));
    await mkdir(path.join(workspace, "tests"));
    await writeFile(path.join(workspace, "tests", "existing.test.ts"), [
      "import { describe, expect, it } from \"vitest\";",
      "import { requestPasswordReset } from \"../src/password-reset\";",
      "",
      "describe(\"password reset\", () => {",
      "  it(\"accepts registered email reset requests\", async () => {",
      "    await expect(requestPasswordReset({ email: \"user@example.com\" })).resolves.toMatchObject({ status: 202 });",
      "  });",
      "});",
      ""
    ].join("\n"));
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

    const provider = new FakeGeneratedTestsProvider([
      "import { describe, expect, it } from \"vitest\";",
      "",
      "describe(\"password reset\", () => {",
      "  it(\"keeps unknown email responses generic\", () => {",
      "    expect({ status: 202, body: { message: \"If the account exists, an email will be sent\" } }).toMatchObject({ status: 202 });",
      "  });",
      "  it(\"rejects expired tokens\", () => {",
      "    expect({ status: 400, body: { code: \"TOKEN_EXPIRED\" } }).toMatchObject({ status: 400 });",
      "  });",
      "});"
    ].join("\n"));
    const files = await generateEdgeCaseTests(workspace, result, createConfig(workspace, "ollama"), undefined, provider);
    const testFile = await readFile(files.testPath, "utf8");

    expect(files.testCount).toBe(2);
    expect(files.tokenUsage?.totalTokens).toBe(12);
    expect(files.testPath).toBe(path.join(workspace, "tests", "edge-cases.test.ts"));
    expect(testFile).toContain("keeps unknown email responses generic");
    expect(testFile).toContain("TOKEN_EXPIRED");
    expect(provider.lastInput?.system).toContain("senior test engineer");
    expect(provider.lastInput?.system).toContain("Return JSON only");
    expect(provider.lastInput?.system).toContain("existing test files context");
    expect(provider.lastInput?.prompt).toContain("Unknown email address");
    expect(provider.lastInput?.prompt).toContain("requestPasswordReset");
    expect(provider.lastInput?.prompt).toContain("accepts registered email reset requests");
    expect(testFile).not.toContain("//");
  });

  it("writes executable pytest TDD cases beside checked-in pytest files", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-generated-pytest-"));
    await mkdir(path.join(workspace, "tests"));
    await writeFile(path.join(workspace, "tests", "test_existing.py"), "from app.tokens import validate_token\n\ndef test_existing():\n    assert validate_token(\"known-good\") is True\n");
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

    const provider = new FakeGeneratedTestsProvider([
      "import pytest",
      "",
      "def test_invalid_token_is_rejected():",
      "    response = {\"status\": 400, \"body\": {\"code\": \"INVALID_TOKEN\"}}",
      "    assert response[\"status\"] == 400",
      "    assert response[\"body\"][\"code\"] == \"INVALID_TOKEN\""
    ].join("\n"));
    const files = await generateEdgeCaseTests(workspace, result, createConfig(workspace, "ollama"), undefined, provider);
    const testFile = await readFile(files.testPath, "utf8");

    expect(files.testPath).toBe(path.join(workspace, "tests", "test_edge_cases.py"));
    expect(testFile).toContain("import pytest");
    expect(testFile).toContain("def test_invalid_token_is_rejected():");
    expect(testFile).toContain("INVALID_TOKEN");
    expect(provider.lastInput?.prompt).toContain("validate_token");
    expect(testFile).not.toContain("#");
  });
});

function createConfig(workspaceRoot: string, type: "ollama"): ResolvedConfig {
  return {
    workspaceRoot,
    provider: {
      type,
      model: "gemma4:e4b",
      host: "http://127.0.0.1:11434"
    },
    testFramework: "auto"
  };
}
