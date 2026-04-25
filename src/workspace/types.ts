export type PackageManager = "npm" | "pnpm" | "yarn" | "unknown";
export type SupportedTestFramework = "vitest" | "jest" | "unknown";

export interface WorkspaceScanResult {
  workspaceRoot: string;
  packageManager: PackageManager;
  testFramework: SupportedTestFramework;
  projectType: "node" | "unknown";
  language: "typescript" | "javascript" | "mixed" | "unknown";
  moduleSystem: "esm" | "commonjs" | "unknown";
  packageName?: string;
  scripts: string[];
  dependencies: string[];
  devDependencies: string[];
  testDirectories: string[];
}
