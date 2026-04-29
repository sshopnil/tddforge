import type { ProviderConfig } from "../config/schema.js";
import type { GenerateTextInput, LlmProvider, ProviderHealth } from "./types.js";
import os from "node:os";

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  response?: string;
  error?: string;
}

interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  stream: false;
  format: "json";
  options: {
    num_ctx: number;
    num_predict: number;
    num_thread: number;
    num_gpu?: number;
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

    let response: Awaited<ReturnType<typeof fetch>>;
    try {
      response = await fetch(new URL("/api/chat", config.host), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.prompt }
          ],
          stream: false,
          format: "json",
          options: buildOllamaOptions()
        } satisfies OllamaChatRequest)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown fetch error";
      throw new Error(`Ollama generation request failed at ${config.host}: ${message}`);
    }

    if (!response.ok) {
      throw new Error(`Ollama generation failed at ${config.host} with HTTP ${response.status}`);
    }

    const body = (await response.json()) as OllamaChatResponse;
    if (body.error) {
      throw new Error(`Ollama generation failed for model '${config.model}' at ${config.host}: ${body.error}`);
    }

    const content = body.message?.content ?? body.response ?? "";
    if (!content.trim()) {
      throw new Error(
        `Ollama generation returned empty content for model '${config.model}' at ${config.host}: ${summarizeOllamaBody(body)}`,
      );
    }

    return content.trim();
  }
}

function buildOllamaOptions(): OllamaChatRequest["options"] {
  const cpuCount = typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;

  return {
    num_ctx: readPositiveIntegerEnv("TDDFORGE_OLLAMA_NUM_CTX", 8192),
    num_predict: readPositiveIntegerEnv("TDDFORGE_OLLAMA_NUM_PREDICT", 2048),
    num_thread: readPositiveIntegerEnv("TDDFORGE_OLLAMA_NUM_THREAD", Math.max(1, cpuCount - 1)),
    ...readOptionalIntegerEnv("TDDFORGE_OLLAMA_NUM_GPU")
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

function readOptionalIntegerEnv(name: string): { num_gpu?: number } {
  const value = process.env[name];
  if (!value) {
    return {};
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? { num_gpu: parsed } : {};
}

function summarizeOllamaBody(body: OllamaChatResponse): string {
  const serialized = JSON.stringify(body);
  if (!serialized) {
    return "{}";
  }

  return serialized.length <= 300 ? serialized : `${serialized.slice(0, 300)}...`;
}
