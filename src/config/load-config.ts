import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getConfigPath } from "./local-config.js";
import { localConfigSchema, type LocalConfig, type ProviderConfig } from "./schema.js";

export interface ResolvedConfig {
  workspaceRoot: string;
  provider: ProviderConfig;
  testFramework: LocalConfig["testFramework"];
}

export function loadResolvedConfig(workspaceRoot: string): ResolvedConfig {
  const configPath = getConfigPath(workspaceRoot);
  const fileConfig = existsSync(configPath)
    ? localConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf8")))
    : localConfigSchema.parse({});

  const provider = resolveProvider(fileConfig.provider);

  return {
    workspaceRoot: path.resolve(workspaceRoot),
    provider,
    testFramework: fileConfig.testFramework
  };
}

function resolveProvider(provider: ProviderConfig): ProviderConfig {
  if (provider.type === "ollama") {
    return {
      ...provider,
      host: process.env.TDDFORGE_OLLAMA_HOST ?? provider.host
    };
  }

  return {
    ...provider,
    model: process.env.OPENAI_MODEL ?? provider.model,
    apiKey: process.env.OPENAI_API_KEY ?? provider.apiKey,
    baseUrl: process.env.OPENAI_BASE_URL ?? provider.baseUrl
  };
}
