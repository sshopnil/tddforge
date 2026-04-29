import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedConfig } from "../config/load-config.js";
import { createProvider } from "../providers/factory.js";
import type { LlmProvider, TokenUsage } from "../providers/types.js";
import type { PlanWorkflowResult } from "../story-engine/planner.js";
import { parseModelJsonObject } from "../utils/json.js";
import { scanWorkspace } from "../workspace/scan.js";
import { resolveTestPlacement } from "../workspace/test-placement.js";
import type { SupportedTestFramework } from "../workspace/types.js";
import { z } from "zod";

export interface GeneratedTestFiles {
  testPath: string;
  testCount: number;
  tokenUsage?: TokenUsage;
}

const generatedTestArtifactSchema = z.object({
  fileName: z.string().min(1).optional(),
  testCount: z.number().int().nonnegative().optional(),
  content: z.string().min(1)
});

export async function generateEdgeCaseTests(
  workspaceRoot: string,
  result: PlanWorkflowResult,
  config: ResolvedConfig,
  outputFolder?: string,
  provider?: LlmProvider,
  signal?: globalThis.AbortSignal,
): Promise<GeneratedTestFiles> {
  const workspaceScan = scanWorkspace(workspaceRoot);
  const placement = resolveTestPlacement(workspaceScan);
  const outputDir = path.resolve(workspaceRoot, outputFolder ?? placement.directory);
  await mkdir(outputDir, { recursive: true });

  const selectedProvider = provider ?? createProvider(config.provider);
  const existingTestContext = await readExistingTestContext(workspaceRoot, workspaceScan.checkedInTestFiles.map((file) => file.path));
  const prompt = buildGeneratedTestsPrompt(result, placement.framework, placement.extension, existingTestContext);
  const response = await selectedProvider.generateText(config.provider, {
    ...prompt,
    signal
  });
  const artifact = generatedTestArtifactSchema.parse(parseModelJsonObject(response.text));
  const fileName = sanitizeGeneratedFileName(
    artifact.fileName,
    getGeneratedTestFileName(placement.framework, placement.extension),
  );
  const testPath = path.join(outputDir, fileName);
  const content = normalizeGeneratedContent(artifact.content);

  await writeFile(testPath, content, "utf8");

  return { testPath, testCount: artifact.testCount ?? countGeneratedTests(content, placement.framework), tokenUsage: response.tokenUsage };
}

function buildGeneratedTestsPrompt(
  result: PlanWorkflowResult,
  framework: SupportedTestFramework,
  extension: "py" | "ts" | "js",
  existingTestContext: ExistingTestContext[],
): { system: string; prompt: string } {
  const importSource = framework === "jest" ? "@jest/globals" : "vitest";
  return {
    system: [
      "You are TDDForge, a senior test engineer generating production-quality TDD tests.",
      "Return JSON only. Do not include markdown fences or prose.",
      "Generate the complete contents of one test file in the requested framework.",
      "Tests must be real executable test cases generated from the plan, not placeholder todos and not generic smoke tests.",
      "Use the existing test files context to match imports, setup style, fixtures, naming, assertions, and mocking patterns.",
      "Do not duplicate existing test coverage; add only new or stronger cases that cover the plan.",
      "Prefer robust production assertions based on observable behavior: status codes, persisted state, validation errors, emitted events, security boundaries, idempotency, or user-visible output.",
      "Use Arrange/Act/Assert structure through clear code, but do not include comments.",
      "Do not invent private implementation names. If the exact import or app entrypoint is unknown, use an explicit failing assertion or throw with a precise message that tells the developer what production assertion to wire to the real module.",
      "Cover planned edge cases first, then high-value happy paths from suggestedTestScenarios.",
      "For Vitest/Jest, use describe/it/expect and import from the correct framework.",
      "For Pytest, use normal test functions and assert statements or pytest.fail for missing integration wiring.",
      "Before returning content, self-check the generated file for target-language syntax errors, unused imports, undefined identifiers introduced only by the test, invalid framework APIs, and common lint violations.",
      "Return only code that you expect to pass formatting and lint rules for the detected language, except for intentional failing assertions that represent TDD red-state behavior.",
      "The generated file must not contain comments.",
      "Use this exact JSON shape:",
      JSON.stringify({
        fileName: getGeneratedTestFileName(framework, extension),
        testCount: 2,
        content: framework === "pytest"
          ? "import pytest\n\ndef test_behavior():\n    assert True\n"
          : `import { describe, expect, it } from "${importSource}";\n\ndescribe("behavior", () => {\n  it("validates behavior", () => {\n    expect(true).toBe(true);\n  });\n});\n`
      })
    ].join("\n"),
    prompt: [
      "Target framework:",
      framework,
      "Target extension:",
      extension,
      "Workspace summary:",
      JSON.stringify({
        packageManager: result.workspace.packageManager,
        testFramework: result.workspace.testFramework,
        projectType: result.workspace.projectType,
        language: result.workspace.language,
        moduleSystem: result.workspace.moduleSystem,
        packageName: result.workspace.packageName,
        scripts: result.workspace.scripts.slice(0, 20),
        dependencies: result.workspace.dependencies.slice(0, 30),
        devDependencies: result.workspace.devDependencies.slice(0, 30),
        checkedInTestFiles: result.workspace.checkedInTestFiles.slice(0, 20)
      }),
      "Existing test files context:",
      existingTestContext.length > 0 ? JSON.stringify(existingTestContext) : "[]",
      "TDD plan:",
      JSON.stringify(result.plan)
    ].join("\n")
  };
}

interface ExistingTestContext {
  path: string;
  content: string;
}

async function readExistingTestContext(workspaceRoot: string, testPaths: string[]): Promise<ExistingTestContext[]> {
  const contexts: ExistingTestContext[] = [];
  for (const testPath of testPaths.slice(0, 8)) {
    const absolutePath = path.resolve(workspaceRoot, testPath);
    if (!absolutePath.startsWith(path.resolve(workspaceRoot))) {
      continue;
    }

    try {
      const content = await readFile(absolutePath, "utf8");
      contexts.push({
        path: testPath,
        content: compactTestContent(content)
      });
    } catch {
      // Ignore files that disappeared between scan and generation.
    }
  }
  return contexts;
}

function compactTestContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.length <= 4000 ? trimmed : `${trimmed.slice(0, 4000)}\n...truncated...`;
}

function getGeneratedTestFileName(framework: SupportedTestFramework, extension: "py" | "ts" | "js"): string {
  if (framework === "pytest" || extension === "py") {
    return "test_edge_cases.py";
  }
  return `edge-cases.test.${extension}`;
}

function sanitizeGeneratedFileName(fileName: string | undefined, fallback: string): string {
  const baseName = path.basename(fileName ?? fallback).trim();
  return baseName || fallback;
}

function normalizeGeneratedContent(content: string): string {
  const trimmed = content
    .trim()
    .replace(/^```[a-zA-Z]*\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return `${trimmed}\n`;
}

function countGeneratedTests(content: string, framework: SupportedTestFramework): number {
  if (framework === "pytest") {
    return content.match(/^def test_/gm)?.length ?? 0;
  }
  return content.match(/\bit\s*\(/g)?.length ?? 0;
}
