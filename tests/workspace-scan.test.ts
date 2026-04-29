import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanWorkspace } from "../src/workspace/scan.js";

describe("workspace scan", () => {
  it("detects npm and vitest in a TypeScript repo", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-workspace-"));

    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({
        name: "fixture-app",
        type: "module",
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "^3.0.0" }
      }),
    );
    await writeFile(path.join(workspace, "package-lock.json"), "{}");
    await writeFile(path.join(workspace, "tsconfig.json"), "{}");
    await mkdir(path.join(workspace, "src"));
    await mkdir(path.join(workspace, "tests"));
    await writeFile(path.join(workspace, "src", "index.ts"), "export const value = 1;\n");
    await writeFile(path.join(workspace, "tests", "index.test.ts"), "import { it } from \"vitest\";\n");

    const result = scanWorkspace(workspace);

    expect(result.packageManager).toBe("npm");
    expect(result.testFramework).toBe("vitest");
    expect(result.projectType).toBe("node");
    expect(result.language).toBe("typescript");
    expect(result.moduleSystem).toBe("esm");
    expect(result.testDirectories).toContain("tests");
    expect(result.checkedInTestFiles).toEqual([
      { path: path.join("tests", "index.test.ts"), framework: "vitest" }
    ]);
  });

  it("detects jest config in a JavaScript repo", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-workspace-"));

    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({
        name: "fixture-jest",
        scripts: { test: "jest" }
      }),
    );
    await writeFile(path.join(workspace, "yarn.lock"), "");
    await writeFile(path.join(workspace, "jest.config.js"), "export default {};\n");
    await mkdir(path.join(workspace, "lib"));
    await writeFile(path.join(workspace, "lib", "index.js"), "module.exports = {};\n");

    const result = scanWorkspace(workspace);

    expect(result.packageManager).toBe("yarn");
    expect(result.testFramework).toBe("jest");
    expect(result.language).toBe("javascript");
    expect(result.testDirectories).toContain("lib");
  });

  it("detects checked-in pytest files", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-workspace-"));
    await mkdir(path.join(workspace, "tests"));
    await writeFile(path.join(workspace, "tests", "test_api.py"), "def test_api():\n    assert True\n");

    const result = scanWorkspace(workspace);

    expect(result.testFramework).toBe("pytest");
    expect(result.checkedInTestFiles).toEqual([
      { path: path.join("tests", "test_api.py"), framework: "pytest" }
    ]);
  });

  it("detects Python projects before tests are configured", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-python-workspace-"));

    await writeFile(path.join(workspace, "pyproject.toml"), "[project]\nname = \"fixture-python\"\n");
    await mkdir(path.join(workspace, "app"));
    await writeFile(path.join(workspace, "app", "service.py"), "def value():\n    return 1\n");

    const result = scanWorkspace(workspace);

    expect(result.projectType).toBe("python");
    expect(result.language).toBe("python");
    expect(result.testFramework).toBe("unknown");
  });
});
