export type PackageManager = "npm" | "pnpm" | "yarn" | "unknown";
export type SupportedTestFramework = "vitest" | "jest" | "pytest" | "unknown";

export interface CheckedInTestFile {
  path: string;
  framework: SupportedTestFramework;
}

export interface WorkspaceScanResult {
  workspaceRoot: string;
  packageManager: PackageManager;
  testFramework: SupportedTestFramework;
  projectType: "node" | "python" | "mixed" | "unknown";
  language: "typescript" | "javascript" | "python" | "mixed" | "unknown";
  moduleSystem: "esm" | "commonjs" | "unknown";
  packageName?: string;
  scripts: string[];
  dependencies: string[];
  devDependencies: string[];
  testDirectories: string[];
  checkedInTestFiles: CheckedInTestFile[];
}
