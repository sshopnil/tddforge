import path from "node:path";
import type { SupportedTestFramework, WorkspaceScanResult } from "./types.js";

export interface TestPlacement {
  directory: string;
  framework: SupportedTestFramework;
  extension: "py" | "ts" | "js";
}

export function resolveTestPlacement(scan: WorkspaceScanResult): TestPlacement {
  const preferredFile = scan.checkedInTestFiles.find((file) => file.framework === scan.testFramework) ??
    scan.checkedInTestFiles[0];

  if (preferredFile) {
    return {
      directory: path.dirname(preferredFile.path),
      framework: preferredFile.framework,
      extension: preferredFile.path.endsWith(".py") ? "py" : preferredFile.path.endsWith(".js") ? "js" : "ts"
    };
  }

  const directory = scan.testDirectories.find((candidate) => ["tests", "test", "__tests__"].includes(candidate)) ??
    scan.testDirectories[0] ??
    "tests";

  return {
    directory,
    framework: scan.testFramework,
    extension: scan.language === "javascript" ? "js" : scan.testFramework === "pytest" ? "py" : "ts"
  };
}
