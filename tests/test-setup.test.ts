import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanWorkspace } from "../src/workspace/scan.js";
import { getTestEnvironmentSetupSuggestions, setupTestEnvironment } from "../src/workspace/test-setup.js";

describe("test environment setup suggestions", () => {
  it("suggests Vitest first for an unconfigured TypeScript workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-setup-node-"));
    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({
        name: "fixture-ts",
        type: "module"
      }),
    );
    await writeFile(path.join(workspace, "tsconfig.json"), "{}");
    await mkdir(path.join(workspace, "src"));
    await writeFile(path.join(workspace, "src", "index.ts"), "export const value = 1;\n");

    const suggestions = getTestEnvironmentSetupSuggestions(scanWorkspace(workspace));

    expect(suggestions[0]).toMatchObject({
      framework: "vitest",
      directory: "tests"
    });
    expect(suggestions.some((suggestion) => suggestion.framework === "jest")).toBe(true);
  });

  it("configures Vitest without overwriting existing package scripts", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-setup-vitest-"));
    await writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({
        name: "fixture-vitest",
        scripts: { build: "tsc" },
        devDependencies: { vitest: "^3.0.0" }
      }),
    );

    await setupTestEnvironment(workspace, {
      framework: "vitest",
      directory: "test",
      label: "Configure Vitest in test/",
      reason: "fixture"
    });

    const packageJson = JSON.parse(await readFile(path.join(workspace, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const config = await readFile(path.join(workspace, "vitest.config.mjs"), "utf8");

    expect(packageJson.scripts.build).toBe("tsc");
    expect(packageJson.scripts.test).toBe("vitest run");
    expect(config).toContain("environment: \"node\"");
    expect(scanWorkspace(workspace).testDirectories).toContain("test");
  });

  it("configures Pytest for a Python workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-setup-pytest-"));
    await writeFile(path.join(workspace, "pyproject.toml"), "[project]\nname = \"fixture-python\"\n");

    const suggestions = getTestEnvironmentSetupSuggestions(scanWorkspace(workspace));

    expect(suggestions[0]).toMatchObject({
      framework: "pytest",
      directory: "tests"
    });

    await setupTestEnvironment(workspace, suggestions[0]);
    const pytestConfig = await readFile(path.join(workspace, "pytest.ini"), "utf8");

    expect(pytestConfig).toContain("testpaths = tests");
    expect(scanWorkspace(workspace).testFramework).toBe("pytest");
  });
});
