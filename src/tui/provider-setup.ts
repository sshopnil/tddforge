import OpenAI from "openai";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getConfigPath, writeLocalConfig } from "../config/local-config.js";
import { localConfigSchema, type LocalConfig, type ProviderConfig } from "../config/schema.js";

export type ProviderType = ProviderConfig["type"];

export async function readWorkspaceConfig(workspaceRoot: string): Promise<LocalConfig> {
  const configPath = getConfigPath(workspaceRoot);
  if (!existsSync(configPath)) {
    return localConfigSchema.parse({});
  }

  return localConfigSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
}

export function hasProviderAuth(config: ProviderConfig): boolean {
  return config.type === "ollama" || Boolean(config.apiKey);
}

export async function listProviderModels(config: ProviderConfig): Promise<string[]> {
  if (config.type === "ollama") {
    const response = await fetch(new URL("/api/tags", config.host));
    if (!response.ok) {
      throw new Error(`Ollama model list failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as { models?: Array<{ name?: string }> };
    return (body.models ?? []).map((model) => model.name).filter((name): name is string => Boolean(name)).sort();
  }

  if (!config.apiKey) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
  const response = await client.models.list();
  return response.data.map((model) => model.id).sort();
}

export async function saveProviderConfig(
  workspaceRoot: string,
  provider: ProviderConfig,
): Promise<string> {
  const existing = await readWorkspaceConfig(workspaceRoot);
  return writeLocalConfig(workspaceRoot, localConfigSchema.parse({
    ...existing,
    provider
  }));
}

export function buildProviderConfig(
  type: ProviderType,
  model: string,
  options: {
    apiKey?: string;
    baseUrl?: string;
    host?: string;
  } = {},
): ProviderConfig {
  if (type === "ollama") {
    return {
      type,
      model,
      host: options.host ?? process.env.TDDFORGE_OLLAMA_HOST ?? "http://127.0.0.1:11434"
    };
  }

  return {
    type,
    model,
    apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
    baseUrl: options.baseUrl ?? process.env.OPENAI_BASE_URL
  };
}
