import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { SupportedTestFramework, WorkspaceScanResult } from "./types.js";

export interface TestEnvironmentSetupSuggestion {
  framework: Exclude<SupportedTestFramework, "unknown">;
  directory: string;
  label: string;
  reason: string;
}

interface PackageJsonLike {
  private?: boolean;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const TEST_DIRECTORY_CANDIDATES = ["tests", "test", "__tests__"];

export function getTestEnvironmentSetupSuggestions(scan: WorkspaceScanResult): TestEnvironmentSetupSuggestion[] {
  const directories = getDirectoryCandidates(scan);

  if (scan.projectType === "python") {
    return directories.map((directory, index) => ({
      framework: "pytest",
      directory,
      label: `${index === 0 ? "Recommended: " : ""}Configure Pytest in ${directory}/`,
      reason: "Python project detected from Python files or project metadata."
    }));
  }

  if (scan.projectType === "node" || scan.projectType === "mixed") {
    const jsFrameworks: TestEnvironmentSetupSuggestion["framework"][] = preferVitest(scan) ? ["vitest", "jest"] : ["jest", "vitest"];
    return jsFrameworks.flatMap((framework, frameworkIndex) =>
      directories.map((directory, directoryIndex) => ({
        framework,
        directory,
        label: `${frameworkIndex === 0 && directoryIndex === 0 ? "Recommended: " : ""}Configure ${formatFrameworkName(framework)} in ${directory}/`,
        reason: buildNodeSetupReason(scan, framework)
      })),
    );
  }

  return directories.map((directory, index) => ({
    framework: "vitest",
    directory,
    label: `${index === 0 ? "Recommended: " : ""}Configure Vitest in ${directory}/`,
    reason: "No project metadata found; Vitest is the least invasive default for JavaScript/TypeScript workspaces."
  }));
}

export async function setupTestEnvironment(workspaceRoot: string, suggestion: TestEnvironmentSetupSuggestion): Promise<void> {
  if (suggestion.framework === "pytest") {
    await setupPytestEnvironment(workspaceRoot, suggestion.directory);
    return;
  }

  await setupNodeTestEnvironment(workspaceRoot, {
    ...suggestion,
    framework: suggestion.framework
  });
}

function getDirectoryCandidates(scan: WorkspaceScanResult): string[] {
  const directories = [...scan.testDirectories, ...TEST_DIRECTORY_CANDIDATES]
    .filter((directory) => !["src", "app", "lib"].includes(directory));
  return [...new Set(directories)].slice(0, 3);
}

function preferVitest(scan: WorkspaceScanResult): boolean {
  return scan.language === "typescript" ||
    scan.language === "mixed" ||
    scan.devDependencies.includes("vitest") ||
    scan.dependencies.includes("vitest") ||
    !scan.devDependencies.includes("jest");
}

function buildNodeSetupReason(scan: WorkspaceScanResult, framework: TestEnvironmentSetupSuggestion["framework"]): string {
  if (framework === "vitest") {
    return scan.language === "typescript"
      ? "TypeScript project detected; Vitest works with TypeScript with minimal config."
      : "JavaScript/TypeScript Node project detected; Vitest is a low-config setup.";
  }

  return "JavaScript/TypeScript Node project detected; Jest remains a common project test runner.";
}

async function setupNodeTestEnvironment(
  workspaceRoot: string,
  suggestion: TestEnvironmentSetupSuggestion & { framework: "vitest" | "jest" },
): Promise<void> {
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const packageJson: PackageJsonLike = existsSync(packageJsonPath)
    ? JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageJsonLike
    : { private: true };
  const packageManager = scanPackageManagerFiles(workspaceRoot);
  const packageName = suggestion.framework === "vitest" ? "vitest" : "jest";
  const installArgs = packageManager === "npm" ? ["install", "-D", packageName] : ["add", "-D", packageName];

  if (!packageJson.devDependencies?.[packageName]) {
    await execa(packageManager, installArgs, { cwd: workspaceRoot });
  }

  packageJson.scripts = packageJson.scripts ?? {};
  packageJson.scripts.test = packageJson.scripts.test ?? `${suggestion.framework} ${suggestion.framework === "vitest" ? "run" : ""}`.trim();

  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  await mkdir(path.join(workspaceRoot, suggestion.directory), { recursive: true });
  await writeNodeConfig(workspaceRoot, suggestion.framework);
}

async function writeNodeConfig(workspaceRoot: string, framework: "vitest" | "jest"): Promise<void> {
  if (framework === "vitest") {
    const configPath = path.join(workspaceRoot, "vitest.config.mjs");
    if (!hasAnyConfig(workspaceRoot, "vitest.config")) {
      await writeFile(configPath, "import { defineConfig } from \"vitest/config\";\n\nexport default defineConfig({\n  test: {\n    environment: \"node\"\n  }\n});\n", "utf8");
    }
    return;
  }

  const configPath = path.join(workspaceRoot, "jest.config.mjs");
  if (!hasAnyConfig(workspaceRoot, "jest.config")) {
    await writeFile(configPath, "export default {\n  testEnvironment: \"node\"\n};\n", "utf8");
  }
}

async function setupPytestEnvironment(workspaceRoot: string, directory: string): Promise<void> {
  await mkdir(path.join(workspaceRoot, directory), { recursive: true });

  const configPath = path.join(workspaceRoot, "pytest.ini");
  if (!existsSync(configPath)) {
    await writeFile(configPath, `[pytest]\ntestpaths = ${directory}\npython_files = test_*.py *_test.py\n`, "utf8");
  }
}

function hasAnyConfig(workspaceRoot: string, basename: string): boolean {
  return ["ts", "js", "mts", "mjs", "cts", "cjs"].some((extension) =>
    existsSync(path.join(workspaceRoot, `${basename}.${extension}`)),
  );
}

function scanPackageManagerFiles(workspaceRoot: string): "npm" | "pnpm" | "yarn" {
  if (existsSync(path.join(workspaceRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(path.join(workspaceRoot, "yarn.lock"))) {
    return "yarn";
  }
  return "npm";
}

function formatFrameworkName(framework: TestEnvironmentSetupSuggestion["framework"]): string {
  if (framework === "pytest") {
    return "Pytest";
  }
  if (framework === "jest") {
    return "Jest";
  }
  return "Vitest";
}
