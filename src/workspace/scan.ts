import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { safeJsonParse } from "../utils/json.js";
import type { PackageManager, SupportedTestFramework, WorkspaceScanResult } from "./types.js";

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

  return {
    workspaceRoot,
    packageManager: detectPackageManager(workspaceRoot),
    testFramework: detectTestFramework(workspaceRoot, allDependencies),
    projectType: packageJson ? "node" : "unknown",
    language: detectLanguage(workspaceRoot),
    moduleSystem: detectModuleSystem(workspaceRoot, packageJson),
    packageName: packageJson?.name,
    scripts,
    dependencies,
    devDependencies,
    testDirectories: detectTestDirectories(workspaceRoot)
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
): SupportedTestFramework {
  const vitestConfigExists = ["ts", "js", "mts", "mjs", "cts", "cjs"].some((ext) =>
    existsSync(path.join(workspaceRoot, `vitest.config.${ext}`)),
  );
  const jestConfigExists = ["ts", "js", "mts", "mjs", "cts", "cjs"].some((ext) =>
    existsSync(path.join(workspaceRoot, `jest.config.${ext}`)),
  );

  if (vitestConfigExists || allDependencies.includes("vitest")) {
    return "vitest";
  }
  if (jestConfigExists || allDependencies.includes("jest")) {
    return "jest";
  }
  return "unknown";
}

function detectLanguage(workspaceRoot: string): WorkspaceScanResult["language"] {
  const entries = safeReadDir(workspaceRoot);
  const hasTs = entries.some((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx")) ||
    ["tsconfig.json", "tsconfig.base.json"].some((file) => existsSync(path.join(workspaceRoot, file)));
  const hasJs = entries.some((entry) => entry.endsWith(".js") || entry.endsWith(".jsx"));

  if (hasTs && hasJs) {
    return "mixed";
  }
  if (hasTs) {
    return "typescript";
  }
  if (hasJs) {
    return "javascript";
  }
  return "unknown";
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
