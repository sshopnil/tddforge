import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureLocalConfig, getConfigPath } from "../src/config/local-config.js";
import { loadResolvedConfig } from "../src/config/load-config.js";

describe("config loading", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a default config when missing", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-config-"));

    const configPath = await ensureLocalConfig(workspace);

    expect(configPath).toBe(getConfigPath(workspace));
    const config = loadResolvedConfig(workspace);
    expect(config.provider.type).toBe("ollama");
    if (config.provider.type !== "ollama") {
      throw new Error("Expected ollama provider");
    }
    expect(config.provider.model).toBe("gemma4:e4b");
    expect(config.testFramework).toBe("auto");
  });

  it("prefers environment values for openai config", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-config-"));
    const configDir = path.join(workspace, ".tddforge");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      path.join(configDir, "config.json"),
      JSON.stringify({
        provider: {
          type: "openai",
          model: "gpt-4o-mini"
        },
        testFramework: "vitest"
      }),
    );

    vi.stubEnv("OPENAI_API_KEY", "env-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
    vi.stubEnv("OPENAI_MODEL", "gpt-5-nano");

    const config = loadResolvedConfig(workspace);

    expect(config.provider.type).toBe("openai");
    if (config.provider.type !== "openai") {
      throw new Error("Expected openai provider");
    }

    expect(config.provider.apiKey).toBe("env-key");
    expect(config.provider.baseUrl).toBe("https://api.openai.com/v1");
    expect(config.provider.model).toBe("gpt-5-nano");
    expect(config.testFramework).toBe("vitest");
  });
});
