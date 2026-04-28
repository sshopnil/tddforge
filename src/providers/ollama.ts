import type { ProviderConfig } from "../config/schema.js";
import type { GenerateTextInput, LlmProvider, ProviderHealth } from "./types.js";
import os from "node:os";

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

interface OllamaGenerateResponse {
  response?: string;
}

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: false;
  options: {
    num_ctx: number;
    num_predict: number;
    num_thread: number;
    num_gpu: number;
  };
}

export class OllamaProvider implements LlmProvider {
  readonly type = "ollama" as const;

  async healthCheck(config: ProviderConfig): Promise<ProviderHealth> {
    if (config.type !== "ollama") {
      throw new Error("Invalid provider config for Ollama");
    }

    try {
      const response = await fetch(new URL("/api/tags", config.host));
      if (!response.ok) {
        return { ok: false, message: `HTTP ${response.status}` };
      }

      const body = (await response.json()) as OllamaTagsResponse;
      const modelExists = body.models?.some((model) => model.name === config.model);

      return modelExists
        ? { ok: true, message: "model available" }
        : { ok: false, message: `model '${config.model}' not found` };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Ollama error";
      return { ok: false, message };
    }
  }

  async generateText(config: ProviderConfig, input: GenerateTextInput): Promise<string> {
    if (config.type !== "ollama") {
      throw new Error("Invalid provider config for Ollama");
    }

    const response = await fetch(new URL("/api/generate", config.host), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        prompt: `${input.system}\n\n${input.prompt}`,
        stream: false,
        options: buildOllamaOptions()
      } satisfies OllamaGenerateRequest)
    });

    if (!response.ok) {
      throw new Error(`Ollama generation failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as OllamaGenerateResponse;
    return body.response?.trim() ?? "";
  }
}

function buildOllamaOptions(): OllamaGenerateRequest["options"] {
  const cpuCount = typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;

  return {
    num_ctx: readPositiveIntegerEnv("TDDFORGE_OLLAMA_NUM_CTX", 8192),
    num_predict: readPositiveIntegerEnv("TDDFORGE_OLLAMA_NUM_PREDICT", 2048),
    num_thread: readPositiveIntegerEnv("TDDFORGE_OLLAMA_NUM_THREAD", Math.max(1, cpuCount - 1)),
    num_gpu: readIntegerEnv("TDDFORGE_OLLAMA_NUM_GPU", 999)
  };
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  return Math.max(1, readIntegerEnv(name, fallback));
}

function readIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
