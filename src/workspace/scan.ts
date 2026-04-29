import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { safeJsonParse } from "../utils/json.js";
import type { CheckedInTestFile, PackageManager, SupportedTestFramework, WorkspaceScanResult } from "./types.js";

interface PackageJsonLike {
  name?: string;
  type?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function scanWorkspace(workspaceRoot: string): WorkspaceScanResult {
  const packageJsonPath = path.join(workspaceRoot, "package.json");
  const packageJson = existsSync(packageJsonPath)
    ? safeJsonParse<PackageJsonLike>(readFileSync(packageJsonPath, "utf8"))
    : undefined;

  const dependencies = Object.keys(packageJson?.dependencies ?? {});
  const devDependencies = Object.keys(packageJson?.devDependencies ?? {});
  const allDependencies = [...dependencies, ...devDependencies];
  const scripts = Object.keys(packageJson?.scripts ?? {});
  const checkedInTestFiles = detectCheckedInTestFiles(workspaceRoot);

  return {
    workspaceRoot,
    packageManager: detectPackageManager(workspaceRoot),
    testFramework: detectTestFramework(workspaceRoot, allDependencies, checkedInTestFiles),
    projectType: detectProjectType(workspaceRoot, Boolean(packageJson)),
    language: detectLanguage(workspaceRoot),
    moduleSystem: detectModuleSystem(workspaceRoot, packageJson),
    packageName: packageJson?.name,
    scripts,
    dependencies,
    devDependencies,
    testDirectories: detectTestDirectories(workspaceRoot),
    checkedInTestFiles
  };
}

function detectPackageManager(workspaceRoot: string): PackageManager {
  if (existsSync(path.join(workspaceRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(path.join(workspaceRoot, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(path.join(workspaceRoot, "package-lock.json"))) {
    return "npm";
  }
  return "unknown";
}

function detectTestFramework(
  workspaceRoot: string,
  allDependencies: string[],
  checkedInTestFiles: CheckedInTestFile[],
): SupportedTestFramework {
  const vitestConfigExists = ["ts", "js", "mts", "mjs", "cts", "cjs"].some((ext) =>
    existsSync(path.join(workspaceRoot, `vitest.config.${ext}`)),
  );
  const jestConfigExists = ["ts", "js", "mts", "mjs", "cts", "cjs"].some((ext) =>
    existsSync(path.join(workspaceRoot, `jest.config.${ext}`)),
  );
  const pytestConfigExists = ["pytest.ini", "tox.ini", "setup.cfg", "pyproject.toml"].some((file) =>
    existsSync(path.join(workspaceRoot, file)) && readFileSync(path.join(workspaceRoot, file), "utf8").includes("pytest"),
  );

  if (vitestConfigExists || allDependencies.includes("vitest")) {
    return "vitest";
  }
  if (jestConfigExists || allDependencies.includes("jest")) {
    return "jest";
  }
  if (checkedInTestFiles.some((file) => file.framework === "pytest")) {
    return "pytest";
  }
  if (pytestConfigExists) {
    return "pytest";
  }
  return "unknown";
}

function detectProjectType(workspaceRoot: string, hasPackageJson: boolean): WorkspaceScanResult["projectType"] {
  const hasPython = hasPythonProjectSignal(workspaceRoot);
  if (hasPackageJson && hasPython) {
    return "mixed";
  }
  if (hasPackageJson) {
    return "node";
  }
  if (hasPython) {
    return "python";
  }
  return "unknown";
}

function detectLanguage(workspaceRoot: string): WorkspaceScanResult["language"] {
  const entries = safeReadDir(workspaceRoot);
  const hasTs = entries.some((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx")) ||
    ["tsconfig.json", "tsconfig.base.json"].some((file) => existsSync(path.join(workspaceRoot, file)));
  const hasJs = entries.some((entry) => entry.endsWith(".js") || entry.endsWith(".jsx"));
  const hasPython = entries.some((entry) => entry.endsWith(".py")) || hasPythonProjectSignal(workspaceRoot);

  if ([hasTs || hasJs, hasPython].every(Boolean) || (hasTs && hasJs)) {
    return "mixed";
  }
  if (hasPython) {
    return "python";
  }
  if (hasTs) {
    return "typescript";
  }
  if (hasJs) {
    return "javascript";
  }
  return "unknown";
}

function hasPythonProjectSignal(workspaceRoot: string): boolean {
  return ["pyproject.toml", "requirements.txt", "requirements-dev.txt", "setup.py", "setup.cfg", "pytest.ini"].some((file) =>
    existsSync(path.join(workspaceRoot, file)),
  );
}

function detectModuleSystem(
  workspaceRoot: string,
  packageJson?: PackageJsonLike,
): WorkspaceScanResult["moduleSystem"] {
  if (packageJson?.type === "module") {
    return "esm";
  }
  if (packageJson?.type === "commonjs") {
    return "commonjs";
  }
  if (existsSync(path.join(workspaceRoot, "tsconfig.json"))) {
    return "unknown";
  }
  return "unknown";
}

function detectTestDirectories(workspaceRoot: string): string[] {
  const candidates = ["tests", "test", "__tests__", "src", "app", "lib"];
  return candidates.filter((candidate) => {
    const fullPath = path.join(workspaceRoot, candidate);
    return existsSync(fullPath) && statSync(fullPath).isDirectory();
  });
}

function safeReadDir(workspaceRoot: string): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(workspaceRoot)) {
    if (entry === "node_modules" || entry.startsWith(".")) {
      continue;
    }

    entries.push(entry);
    const fullPath = path.join(workspaceRoot, entry);
    if (statSync(fullPath).isDirectory()) {
      for (const child of readdirSync(fullPath)) {
        entries.push(path.join(entry, child));
      }
    }
  }
  return entries;
}

function detectCheckedInTestFiles(workspaceRoot: string): CheckedInTestFile[] {
  return listFiles(workspaceRoot)
    .filter((filePath) => isTestFile(filePath))
    .map((filePath) => ({
      path: path.relative(workspaceRoot, filePath),
      framework: detectTestFileFramework(filePath)
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function listFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === "dist" || entry === "coverage" || entry.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (stats.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function isTestFile(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join("/");
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized) ||
    /(^|\/)test_[^/]+\.py$/.test(normalized) ||
    /(^|\/)[^/]+_test\.py$/.test(normalized);
}

function detectTestFileFramework(filePath: string): SupportedTestFramework {
  if (filePath.endsWith(".py")) {
    return "pytest";
  }
  const content = readFileSync(filePath, "utf8");
  if (content.includes("vitest")) {
    return "vitest";
  }
  if (content.includes("@jest/globals") || content.includes("jest.")) {
    return "jest";
  }
  return "unknown";
}
